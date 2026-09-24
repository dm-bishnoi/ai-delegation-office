import test from 'node:test';
import assert from 'node:assert/strict';
import { answerDiscovery, decideBrief, makeConsultancyProject, completeConsultancyTask } from './consultancy.mjs';
import { collectResearch, researchPlan } from './research.mjs';
import { decide, nextTask, retry, failTask } from './workflow.mjs';
import { generateDiscoveryQuestions, parseDiscoveryQuestions } from './provider.mjs';

test('discovery saves partial answers and gates each approved stage without breaking legacy projects', () => {
  const project = makeConsultancyProject('Portfolio website');
  assert.throws(() => nextTask(project), /discovery/);
  answerDiscovery(project, { audience: 'Freelancers' });
  assert.equal(project.discovery.status, 'questions');
  answerDiscovery(project, { problem: 'unknown', outcome: 'Show case studies', constraints: 'Not decided' });
  assert.equal(project.discovery.status, 'questions');
  answerDiscovery(project, { problem: 'Hard to present work', outcome: 'Show case studies', constraints: 'Not decided' });
  assert.equal(project.discovery.status, 'followup');
  answerDiscovery(project, { scope: 'Case studies and contact; booking later', success: 'Five qualified inquiries' });
  assert.equal(project.discovery.status, 'review');
  assert.match(project.discovery.brief, /Freelancers/);
  decideBrief(project, 'approve');
  const task = nextTask(project);
  assert.equal(task.id, 1);
  completeConsultancyTask(project, task, '# Research plan — sources not collected');
  assert.throws(() => nextTask(project), /Review/);
  decide(project, 1, 'approve');
  const requirements = nextTask(project);
  assert.equal(requirements.id, 2);
  failTask(project, requirements, 'Provider timeout');
  assert.throws(() => nextTask(project), /Retry/);
  retry(project, requirements.id);
  assert.equal(project.tasks[0].output, '# Research plan — sources not collected');
  const resumed = nextTask(project);
  completeConsultancyTask(project, resumed, 'PRD draft 1');
  decide(project, 2, 'revise', 'Add keyboard access');
  const revision = nextTask(project);
  completeConsultancyTask(project, revision, 'PRD draft 2');
  assert.equal(project.tasks[1].revisions[0].content, 'PRD draft 1');
  const restored = structuredClone(project);
  assert.equal(restored.tasks[1].status, 'review');
  assert.equal(restored.discovery.status, 'approved');
});

test('Nova tailors choices to the project and saved answers without replacing the answers', async () => {
  const project = makeConsultancyProject('A pet grooming appointment app for neighborhood salons');
  const env = { AI_BASE_URL: 'https://api.example.com/v1', AI_MODEL: 'test-model', AI_API_KEY: 'test-key' };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /pet grooming appointment app/);
    if (project.discovery.status === 'followup') assert.match(request.messages[1].content, /Salons with one to three groomers/);
    const keys = project.discovery.status === 'questions' ? ['audience', 'problem', 'outcome', 'constraints'] : ['scope', 'success'];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: keys.map(key => ({
      key, question: `For pet grooming salons, what ${key} matters most?`, options: [`A concrete ${key} choice`, `A second ${key} choice`],
    })) }) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const first = await generateDiscoveryQuestions(project, 'questions', { env, fetchImpl });
  assert.equal(first.model, 'test-model');
  project.discovery.questions = first.questions;
  answerDiscovery(project, { audience: 'Salons with one to three groomers', problem: 'Phone bookings get lost', outcome: 'Let clients book a slot', constraints: 'Not decided' });
  assert.equal(project.discovery.status, 'followup');
  const follow = await generateDiscoveryQuestions(project, 'followup', { env, fetchImpl });
  project.discovery.followUpQuestions = follow.questions;
  assert.equal(project.discovery.answers.audience, 'Salons with one to three groomers');
  answerDiscovery(project, { scope: follow.questions[0].options[0], success: 'Five salons accept online appointments' });
  assert.match(project.discovery.brief, /For pet grooming salons, what scope matters most/);
  assert.match(project.discovery.brief, /A concrete scope choice/);
});

test('malformed suggested questions are rejected without changing a saved discovery project', () => {
  const project = makeConsultancyProject('An appointment app');
  answerDiscovery(project, { audience: 'Local salons' });
  const before = structuredClone(project.discovery);
  assert.throws(() => parseDiscoveryQuestions(JSON.stringify({ questions: [{ key: 'audience', question: 'Who?', options: ['Yes'] }] }), 'questions'), /incomplete/);
  assert.throws(() => parseDiscoveryQuestions('```json\n{"questions": [}\n```', 'questions'), /invalid question data/);
  assert.deepEqual(project.discovery, before);
});

test('wireframe escapes all project and provider text and stays a preview, not a claimed image', async () => {
  const project = makeConsultancyProject('<script>alert(1)</script>');
  answerDiscovery(project, { audience: '<img src=x onerror=alert(1)>', problem: 'Example', outcome: 'Portfolio', constraints: 'none' });
  answerDiscovery(project, { scope: 'Case studies first, payments later', success: 'Visitors can contact us' });
  decideBrief(project, 'approve');
  project.tasks[2].status = 'active';
  completeConsultancyTask(project, project.tasks[2], '- <script>alert(2)</script> a sufficiently long text for a card');
  assert.equal(project.designPreview.kind, 'wireframe');
  assert.doesNotMatch(project.designPreview.content, /<script>/);
  assert.match(project.designPreview.content, /&lt;script&gt;/);
  const unavailable = await collectResearch(project, { key: '' });
  assert.equal(unavailable.status, 'unavailable');
  assert.match(researchPlan(project, unavailable), /not researched findings/i);
});

test('research uses a bounded authorized search and records excerpt provenance', async () => {
  const project = makeConsultancyProject('Customer support tool');
  const research = await collectResearch(project, { key: 'temporary-key', fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://api.search.brave.com');
    assert.equal(options.headers['X-Subscription-Token'], 'temporary-key');
    return { ok: true, json: async () => ({ web: { results: [
      { title: 'Example documentation', url: 'https://example.org/guide', description: 'Excerpts only' },
      { title: 'Unsafe source', url: 'http://localhost:3001/private', description: 'ignore' },
    ] } }) };
  } });
  assert.equal(research.status, 'snippets');
  assert.deepEqual(research.sources.map(source => source.url), ['https://example.org/guide']);
  assert.ok(research.searchedAt);
});
