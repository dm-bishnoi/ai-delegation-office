import { ClientError, completeTask, makeWorkspace } from './workflow.mjs';

export const discoveryQuestions = [
  { key: 'audience', question: 'Who will use this, and what do you know about them?' },
  { key: 'problem', question: 'What problem do they face today?' },
  { key: 'outcome', question: 'What would a successful first version achieve?' },
  { key: 'constraints', question: 'Any deadline, budget, platform, or other constraints? (You can say “not decided”.)' },
];
export const followUpQuestions = [
  { key: 'scope', question: 'What must the first version include, and what should wait until later?' },
  { key: 'success', question: 'How will you tell that the first version has worked?' },
];

function log(project, agent, message) {
  project.activity.unshift({ id: project.nextId++, agent, message, time: new Date().toISOString() });
  project.activity = project.activity.slice(0, 100);
  project.updatedAt = new Date().toISOString();
}

export function makeConsultancyProject(idea) {
  const project = makeWorkspace(idea);
  project.mode = 'consultancy';
  project.discovery = { status: 'questions', answers: {}, brief: '' };
  project.tasks = [
    { id: 1, title: 'Research the opportunity', description: 'Examine available sources, compare alternatives, and distinguish evidence from assumptions.', owner: 'lead', status: 'queued', requiresApproval: true },
    { id: 2, title: 'Define requirements', description: 'Write user journeys, scope, acceptance criteria, and unresolved decisions.', owner: 'lead', status: 'queued', requiresApproval: true },
    { id: 3, title: 'Design the experience', description: 'Describe screens, interactions, responsive states, and a visual direction; include a saved wireframe preview.', owner: 'design', status: 'queued', requiresApproval: true },
    { id: 4, title: 'Review the proposal', description: 'Check consistency, risks, open questions, and readiness for an optional build.', owner: 'qa', status: 'queued', requiresApproval: true },
  ];
  project.activity[0].message = 'Project saved. Nova is waiting for your discovery answers.';
  return project;
}

export function answerDiscovery(project, answers) {
  if (project?.mode !== 'consultancy' || !['questions', 'followup'].includes(project.discovery?.status)) throw new ClientError(409, 'This project is not awaiting discovery answers.');
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new ClientError(400, 'Answer the discovery questions.');
  const merged = { ...project.discovery.answers };
  for (const { key } of [...discoveryQuestions, ...followUpQuestions]) {
    const value = answers[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.trim().length > 500) throw new ClientError(400, 'Each answer must be at most 500 characters.');
      merged[key] = value.trim();
    }
  }
  project.discovery.answers = merged;
  const missing = discoveryQuestions.filter(item => !merged[item.key]);
  const vague = ['audience', 'problem', 'outcome'].filter(key => /^(?:not decided|unknown|i don.t know|unsure|\?|n\/a)$/i.test(merged[key] || ''));
  if (missing.length || vague.length) {
    log(project, 'lead', missing.length ? `Saved discovery answers. ${missing.length} question(s) remain.` : 'Please clarify the audience, problem and goal before approving the brief. Constraints can stay undecided.');
    return project.discovery;
  }
  if (project.discovery.status === 'questions') {
    project.discovery.status = 'followup';
    log(project, 'lead', 'The core answers are saved. Nova has two final scope and success questions.');
    return project.discovery;
  }
  const pending = followUpQuestions.filter(item => !merged[item.key]);
  if (pending.length) {
    log(project, 'lead', `Saved follow-up answers. ${pending.length} remain.`);
    return project.discovery;
  }
  project.discovery.brief = [
    `Original idea: ${project.brief}`,
    ...[...discoveryQuestions, ...followUpQuestions].map(({ key, question }) => `${question}\n${merged[key]}`),
    'An answer of “unknown” or “not decided” remains an explicit assumption to confirm during later review.',
  ].join('\n\n');
  project.discovery.status = 'review';
  log(project, 'lead', 'Clarified brief is ready for your review.');
  return project.discovery;
}

export function decideBrief(project, decision) {
  if (project?.mode !== 'consultancy' || project.discovery?.status !== 'review') throw new ClientError(409, 'There is no brief awaiting approval.');
  if (!['approve', 'revise'].includes(decision)) throw new ClientError(400, 'Choose approve or revise.');
  project.discovery.status = decision === 'approve' ? 'approved' : 'questions';
  log(project, 'lead', decision === 'approve' ? 'You approved the clarified brief. Research is ready.' : 'You returned the brief to discovery. Your answers are saved.');
  return project.discovery;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function makeDesignPreview(project, output) {
  const title = escapeHtml(project.brief.slice(0, 100));
  const audience = escapeHtml(project.discovery?.answers?.audience || 'Your audience');
  const points = output.split('\n').map(line => line.replace(/^\s*(?:[-*\d.)]+)\s*/, '').trim())
    .filter(line => line.length > 15 && line.length < 130).slice(0, 3);
  const cards = (points.length ? points : ['Understand the user need', 'Explore the solution', 'Make the next step clear'])
    .map(point => `<article><span>SECTION</span><h2>${escapeHtml(point)}</h2><div class="line"></div><div class="line short"></div></article>`).join('');
  const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wireframe concept</title><style>body{margin:0;background:#f3f0e8;color:#202927;font:16px system-ui,sans-serif}header,main,footer{max-width:1000px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:1px solid #c8c8bd}main{padding-top:70px}small,article span{font-size:11px;letter-spacing:.15em;color:#777b75}h1{max-width:650px;font-size:clamp(34px,6vw,65px);line-height:1.08}p{color:#56615c}.button{display:inline-block;padding:13px 21px;background:#304d43;color:white;border-radius:4px}section{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:74px 0}article{border:1px solid #c9cec7;background:white;padding:25px;min-height:180px}h2{font-size:18px}.line{height:8px;background:#e3e8e0;margin-top:10px}.short{width:60%}footer{border-top:1px solid #c8c8bd}@media(max-width:700px){section{grid-template-columns:1fr}main{padding-top:30px}}</style></head><body><header><strong>WIREFRAME / CONCEPT</strong><small>Draft for review</small></header><main><small>PROJECT DIRECTION</small><h1>${title}</h1><p>For ${audience}. This is a structural wireframe, not a finished visual design or tested website.</p><span class="button">Primary action →</span><section>${cards}</section></main><footer>Saved concept · Review the written design deliverable alongside this preview.</footer></body></html>`;
  return { filename: 'design-concept.html', content, kind: 'wireframe', createdAt: new Date().toISOString() };
}

export function completeConsultancyTask(project, task, output) {
  completeTask(project, task, output);
  if (project.mode === 'consultancy' && task.id === 3) project.designPreview = makeDesignPreview(project, output);
}
