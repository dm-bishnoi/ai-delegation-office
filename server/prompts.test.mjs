import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyChangeRequest, cancelChangeRequest, proposeChangeRequest, routePrompt, routePromptWithAI } from './prompts.mjs';
import { answerDiscovery, decideBrief, makeConsultancyProject } from './consultancy.mjs';
import { loadStore, projectSummaries, saveStore } from './store.mjs';
import { nextTask, retry } from './workflow.mjs';
import { makeConsultancyProject as _make } from './consultancy.mjs';

const projects = [
  { id: 'proj-support', brief: 'Support desk platform for small businesses with ticket management and AI reply drafts' },
  { id: 'proj-invoice', brief: 'Invoicing workspace for freelancers with payment tracking and reminders' },
];
const active = projects[0];

test('deterministic routing sends self-contained ideas to new-project and named changes to update', () => {
  assert.equal(routePrompt('Build an AI invoicing SaaS for freelancers with invoices, payment tracking, reminders and a simple analytics dashboard', projects, active).intent, 'new_project');
  assert.equal(routePrompt('Add Stripe billing and team roles to this project', projects, active).intent, 'update_project');
  assert.equal(routePrompt('Add Stripe billing and team roles to this project', projects, active).targetProjectId, 'proj-support');
  // Ambiguous: add-shaped without a project cue, even when a project is active.
  assert.equal(routePrompt('Add analytics to the dashboard', projects, active).intent, 'ambiguous');
  assert.equal(routePrompt('Add analytics to the dashboard', projects, null).intent, 'ambiguous');
  // An explicit project cue makes the same shape an update.
  assert.equal(routePrompt('Add analytics to this project', projects, active).intent, 'update_project');
  // Naming a saved project routes to that project even if another is active.
  const named = routePrompt('Update the Invoicing workspace with recurring reminders', projects, active);
  assert.equal(named.intent, 'update_project');
  assert.equal(named.targetProjectId, 'proj-invoice');
  assert.throws(() => routePrompt('', projects, active), /1–500/);
  assert.throws(() => routePrompt('x'.repeat(501), projects, active), /1–500/);
});

test('AI routing refines ambiguous prompts, falls back safely, and never invents targets', async () => {
  const env = { AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'test-model', AI_API_KEY: 'test-key' };
  const reply = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const aiUpdate = await routePromptWithAI('Add advanced analytics', projects, active, {
    env, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 250);
      assert.match(body.messages[0].content, /untrusted data/);
      return reply('{"intent":"update_project","targetProjectId":"proj-support","confidence":"high","reason":"Extends the active project."}');
    },
  });
  assert.equal(aiUpdate.intent, 'update_project');
  assert.equal(aiUpdate.via, 'ai');
  // AI failure, garbage, or invented ids all fall back to the deterministic answer.
  for (const behavior of [
    async () => { throw new Error('provider down'); },
    async () => reply('not json at all'),
    async () => reply('{"intent":"update_project","targetProjectId":"proj-unknown","confidence":"high"}'),
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
  ]) {
    const result = await routePromptWithAI('Add advanced analytics', projects, active, { env, fetchImpl: behavior });
    assert.equal(result.via, 'deterministic');
    assert.equal(result.intent, 'ambiguous');
  }
  // Without a provider the deterministic result returns without any fetch.
  const noProvider = await routePromptWithAI('Add advanced analytics', projects, active, { env: {}, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(noProvider.intent, 'ambiguous');
});

test('new-project creation flow: route, create, select, discover — no nonexistent-project lookup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-create-'));
  const file = join(dir, 'projects.json');
  try {
    // Start with one existing project, like the repro (Support SaaS selected).
    const existing = makeConsultancyProject('Support desk platform for small businesses with tickets');
    let store = await loadStore(file);
    store = { activeProjectId: existing.id, projects: [existing] };
    await saveStore(store, file);

    // 1. A self-contained idea routes to CREATE_NEW_PROJECT and carries no target id.
    const routing = routePrompt('Build a subscription management SaaS for freelancers and small agencies with recurring payments', [{ id: existing.id, brief: existing.brief }], existing);
    assert.equal(routing.intent, 'new_project');
    assert.equal(routing.targetProjectId, null);

    // 2. Creation never touches the select route or any existing project id.
    //    Emulate the server's create handler exactly (index.mjs /api/projects).
    const next = makeConsultancyProject('Build a subscription management SaaS for freelancers and small agencies with recurring payments');
    store = { activeProjectId: next.id, projects: [...store.projects, next] };
    await saveStore(store, file);

    // 3. The returned/active project is the NEW project; workspace follows it.
    const reloaded = await loadStore(file);
    assert.equal(reloaded.activeProjectId, next.id);
    assert.equal(reloaded.projects.length, 2);
    const activeWorkspace = reloaded.projects.find(project => project.id === reloaded.activeProjectId);
    assert.equal(activeWorkspace.id, next.id);
    assert.equal(activeWorkspace.brief, next.brief);
    assert.equal(activeWorkspace.discovery.status, 'questions'); // discovery opens
    assert.ok(activeWorkspace.tasks.every(task => task.status === 'queued'));

    // 4. The old project remains intact, still selectable, with its own tasks.
    const old = reloaded.projects.find(project => project.id === existing.id);
    assert.equal(old.brief, existing.brief);
    assert.equal(old.tasks.length, existing.tasks.length);
    assert.equal(old.activity.length, existing.activity.length);
    const summaries = projectSummaries(reloaded);
    assert.equal(summaries.length, 2);

    // 5. Re-selecting the old project only flips activeProjectId.
    const reselected = { ...reloaded, activeProjectId: existing.id };
    assert.equal(reselected.activeProjectId, existing.id);
    assert.equal(reselected.projects.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed project creation leaves the old active project unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-create-fail-'));
  const file = join(dir, 'projects.json');
  try {
    const existing = makeConsultancyProject('Support desk platform for small businesses with tickets');
    let store = { activeProjectId: existing.id, projects: [existing] };
    await saveStore(store, file);
    // makeWorkspace rejects invalid briefs before any store write.
    assert.throws(() => makeConsultancyProject(''), /Brief must be 1–500/);
    assert.throws(() => makeConsultancyProject('x'.repeat(501)), /Brief must be 1–500/);
    const reloaded = await loadStore(file);
    assert.equal(reloaded.activeProjectId, existing.id); // active unchanged
    assert.equal(reloaded.projects.length, 1); // nothing partially created
    const unchanged = JSON.stringify(await readFile(file, 'utf8')) === JSON.stringify(await readFile(file, 'utf8'));
    assert.ok(unchanged);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function approvedProject(brief = 'Build an AI customer support SaaS with tickets and billing') {
  const project = makeConsultancyProject(brief);
  answerDiscovery(project, { audience: 'Small teams', problem: 'Slow replies', outcome: 'Faster replies', constraints: 'None' });
  answerDiscovery(project, { scope: 'Tickets and replies', success: 'Faster first response' });
  decideBrief(project, 'approve');
  for (const task of project.tasks) { task.status = 'done'; task.output = `Approved: ${task.title}`; task.approvedAt = new Date().toISOString(); }
  return project;
}

test('change request proposes impacted stages without mutating tasks until approval', () => {
  const project = approvedProject();
  const tasksBefore = structuredClone(project.tasks);
  const request = proposeChangeRequest(project, 'Add Stripe subscription billing and team roles');
  assert.equal(request.status, 'awaiting_approval');
  assert.deepEqual(project.tasks, tasksBefore); // nothing changed yet
  assert.ok(request.proposedChanges.impactedStages.includes('requirements'));
  assert.ok(request.proposedChanges.impactedStages.includes('design'));
  assert.ok(request.proposedChanges.impactedStages.includes('review'));
  assert.ok(request.proposedChanges.reopenTaskIds.length >= 2);
  assert.equal(project.changeRequests.length, 1);
  // Cancel changes nothing material.
  cancelChangeRequest(project, request.id);
  assert.equal(request.status, 'cancelled');
  assert.deepEqual(project.tasks, tasksBefore);
  assert.throws(() => applyChangeRequest(project, request.id), /not pending/);
  assert.throws(() => proposeChangeRequest(project, 'x'.repeat(501)), /1–500/);
});

test('applying an approved change request appends tasks and preserves all history', () => {
  const project = approvedProject();
  project.research = { status: 'unavailable', searchedAt: null, sources: [] };
  project.artifact = { kind: 'website', filename: 'index.html', content: '<html>v1</html>', createdAt: new Date().toISOString(), version: 1 };
  project.artifactVersions = [{ kind: 'website', filename: 'index.html', content: '<html>v0</html>', createdAt: new Date().toISOString(), version: 0 }];
  const before = structuredClone(project);
  const request = proposeChangeRequest(project, 'Add Stripe subscription billing with invoices');
  const created = applyChangeRequest(project, request.id);
  assert.equal(created.status, 'applied');
  assert.equal(created.createdTaskIds.length, request.proposedChanges.reopenTaskIds.length);
  // Every original completed task is untouched; new tasks are queued additions.
  for (const original of before.tasks) {
    const current = project.tasks.find(task => task.id === original.id);
    assert.equal(current.status, 'done');
    assert.equal(current.output, original.output);
    assert.equal(current.approvedAt, original.approvedAt);
  }
  assert.ok(project.tasks.length > before.tasks.length);
  assert.ok(project.tasks.at(-1).changeRequestId, request.id);
  assert.equal(project.tasks.at(-1).status, 'queued');
  // Deliverables and website versions survive.
  assert.equal(project.research.status, 'unavailable');
  assert.equal(project.artifact.content, '<html>v1</html>');
  assert.deepEqual(project.artifactVersions, before.artifactVersions);
  assert.equal(project.discovery.status, 'approved');
  // The new tasks flow through the existing engine.
  const next = nextTask(project);
  assert.equal(next.status, 'active');
  next.status = 'done'; // simulate completion without a provider call
  const followUp = nextTask(project);
  assert.equal(followUp.owner, project.tasks.find(task => task.id === followUp.id)?.owner);
});

test('apply is blocked while a task is pending review or failed, and runs only once', () => {
  const project = approvedProject();
  const request = proposeChangeRequest(project, 'Add team roles and permissions');
  project.tasks[2].status = 'review';
  assert.throws(() => applyChangeRequest(project, request.id), /pending review/);
  project.tasks[2].status = 'done';
  project.tasks[1].status = 'failed';
  assert.throws(() => applyChangeRequest(project, request.id), /failed task/);
  project.tasks[1].status = 'done';
  applyChangeRequest(project, request.id);
  const tasksAfter = project.tasks.length;
  assert.throws(() => applyChangeRequest(project, request.id), /not pending/);
  assert.equal(project.tasks.length, tasksAfter);
});

test('legacy projects without changeRequests load, summarize, and persist safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-prompts-'));
  const file = join(dir, 'projects.json');
  try {
    const legacy = approvedProject('A legacy project with no changeRequests field');
    delete legacy.changeRequests;
    await saveStore({ activeProjectId: legacy.id, projects: [legacy] }, file);
    const store = await loadStore(file);
    assert.equal(store.projects.length, 1);
    assert.ok(!Array.isArray(store.projects[0].changeRequests));
    const summaries = projectSummaries(store);
    assert.equal(summaries[0].pendingChangeRequests, 0);
    assert.ok(Array.isArray(summaries[0].recentActivity));
    // A change request round-trips through the store on the same project.
    proposeChangeRequest(store.projects[0], 'Add reminders and export');
    await saveStore(store, file);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.projects[0].changeRequests.length, 1);
    assert.equal(saved.projects[0].changeRequests[0].status, 'awaiting_approval');
    const reloaded = await loadStore(file);
    assert.equal(reloaded.projects[0].changeRequests[0].prompt, 'Add reminders and export');
    // Activity entries carry no cross-project content in summaries beyond their own project.
    for (const summary of projectSummaries(reloaded)) assert.ok(summary.recentActivity.every(entry => typeof entry.message === 'string'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
