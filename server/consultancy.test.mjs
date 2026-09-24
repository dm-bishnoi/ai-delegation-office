import test from 'node:test';
import assert from 'node:assert/strict';
import { answerDiscovery, decideBrief, makeConsultancyProject, completeConsultancyTask } from './consultancy.mjs';
import { collectResearch, researchPlan } from './research.mjs';
import { decide, nextTask, retry, failTask } from './workflow.mjs';

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
