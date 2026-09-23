import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { completeTask, decide, failTask, makeWorkspace, nextTask, retry } from './workflow.mjs';
import { generate, generateWebsite, providerEndpoint } from './provider.mjs';
import { loadStore, projectSummaries, saveStore } from './store.mjs';

test('approval gates block downstream tasks and revision sends feedback to the provider', async () => {
  const workspace = makeWorkspace('Launch a useful tool.');
  const first = nextTask(workspace);
  const env = { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  let prompt = '';
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    prompt = JSON.parse(options.body).messages[1].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Initial plan' } }] }) };
  };
  completeTask(workspace, first, await generate(workspace, first, { env, fetchImpl }));
  assert.equal(first.status, 'review');
  assert.throws(() => nextTask(workspace), /Review the pending/);
  assert.throws(() => decide(workspace, 1, 'revise', ''), /Tell the agent/);
  decide(workspace, 1, 'revise', 'Add a risk section.');
  assert.equal(nextTask(workspace).id, 1);
  completeTask(workspace, first, await generate(workspace, first, { env, fetchImpl }));
  assert.match(prompt, /Add a risk section/);
  assert.match(prompt, /Initial plan/);
  decide(workspace, 1, 'approve');
  const second = nextTask(workspace);
  assert.equal(second.id, 2);
  await generate(workspace, second, { env, fetchImpl });
  assert.match(prompt, /Approved earlier work/);
});

test('legacy workspace migrates without losing data and interrupted tasks become retryable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-office-'));
  const path = join(dir, 'projects.json');
  const legacyPath = join(dir, 'workspace.json');
  try {
    const workspace = makeWorkspace('Plan a test.');
    const task = nextTask(workspace);
    await writeFile(legacyPath, JSON.stringify(workspace));
    const store = await loadStore(path, legacyPath);
    const restored = store.projects[0];
    assert.equal(store.activeProjectId, workspace.id);
    assert.equal((await readFile(legacyPath, 'utf8')).length > 0, true);
    assert.equal(restored.tasks[0].status, 'failed');
    assert.match(restored.tasks[0].error, /Server stopped/);
    assert.throws(() => nextTask(restored), /Retry the failed/);
    retry(restored, task.id);
    const retried = nextTask(restored);
    failTask(restored, retried, 'Provider error');
    assert.equal(retried.status, 'failed');
    const second = makeWorkspace('A second project.');
    store.projects.push(second);
    store.activeProjectId = second.id;
    await saveStore(store, path);
    const loaded = await loadStore(path, legacyPath);
    assert.equal(loaded.projects.length, 2);
    assert.equal(loaded.projects[0].tasks[0].status, 'failed');
    assert.equal(projectSummaries(loaded).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('provider refuses an insecure remote endpoint', () => {
  assert.throws(() => providerEndpoint('http://example.com/v1'), /HTTPS/);
  assert.equal(providerEndpoint('https://example.com/v1').pathname, '/v1/chat/completions');
});

test('website generation requires an approved project, validates full HTML, and persists code', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-website-'));
  const path = join(dir, 'projects.json');
  const workspace = makeWorkspace('A portfolio website');
  const env = { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  const css = 'body{color:red}';
  const body = '<main><h1>Portfolio</h1></main>';
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, ++calls === 1 ? 1500 : 1200);
    assert.equal(payload.stream, false);
    assert.equal(options.headers.Accept, 'application/json');
    assert.match(payload.messages[1].content, /portfolio website/i);
    return { ok: true, json: async () => ({ choices: [{ message: { content: calls === 1 ? body : css }, finish_reason: 'stop' }] }) };
  };
  try {
    await assert.rejects(generateWebsite(workspace, { env, fetchImpl }), /Finish and approve/);
    for (const task of workspace.tasks) { task.status = 'done'; task.output = `Plan for ${task.title}`; }
    const artifact = await generateWebsite(workspace, { env, fetchImpl });
    assert.equal(artifact.filename, 'index.html');
    assert.match(artifact.content, /<style>\s*body\{color:red\}/);
    assert.match(artifact.content, /<main><h1>Portfolio<\/h1><\/main>/);
    workspace.artifact = artifact;
    await saveStore({ activeProjectId: workspace.id, projects: [workspace] }, path);
    const restored = await loadStore(path, join(dir, 'legacy.json'));
    assert.equal(restored.projects[0].artifact.content, artifact.content);
    await assert.rejects(generateWebsite({ ...workspace, websiteDraft: undefined }, { env, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: body }, finish_reason: 'length' }] }) }) }), /truncated/);
    await assert.rejects(generateWebsite({ ...workspace, websiteDraft: undefined }, { env, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '<h1>partial</h1>' }, finish_reason: 'stop' }] }) }) }), /valid page HTML/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed website stylesheet resumes from the saved page after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-resume-'));
  const path = join(dir, 'projects.json');
  const workspace = makeWorkspace('Portfolio website');
  for (const task of workspace.tasks) { task.status = 'done'; task.output = 'Approved plan.'; }
  const env = { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  let requests = 0;
  try {
    await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => {
      requests++;
      if (requests === 2) throw new Error('provider disconnected');
      return { ok: true, json: async () => ({ choices: [{ message: { content: '<main><h1>Portfolio</h1></main>' }, finish_reason: 'stop' }] }) };
    }, onCheckpoint: async () => saveStore({ activeProjectId: workspace.id, projects: [workspace] }, path) }), /Could not reach/);
    assert.equal(requests, 2);
    const restored = (await loadStore(path, join(dir, 'legacy.json'))).projects[0];
    assert.equal(restored.websiteDraft.body, '<main><h1>Portfolio</h1></main>');
    const artifact = await generateWebsite(restored, { env, fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).max_tokens, 1200);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'body{color:red}' }, finish_reason: 'stop' }] }) };
    } });
    assert.match(artifact.content, /body\{color:red\}/);
    assert.match(artifact.content, /<h1>Portfolio<\/h1>/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('provider explains invalid response types without exposing their body', async () => {
  const workspace = makeWorkspace('A small portfolio website');
  for (const task of workspace.tasks) { task.status = 'done'; task.output = 'Approved plan.'; }
  const env = { AI_BASE_URL: 'http://127.0.0.1:9999/v1', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
  const broken = (contentType, json, status = 200) => ({
    ok: status === 200, status, headers: { get: () => contentType }, json,
  });
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => broken('text/html', async () => { throw Error('secret body'); }) }), /HTML page instead of JSON/);
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => broken('text/event-stream', async () => { throw Error('secret body'); }) }), /streaming response/);
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => broken('application/json', async () => { throw Error('secret body'); }) }), error => {
    assert.match(error.message, /malformed JSON/);
    assert.doesNotMatch(error.message, /secret body/);
    return true;
  });
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => broken('application/json', async () => ({}), 429) }), /Rate limit or quota/);
  await assert.rejects(generateWebsite(workspace, { env, fetchImpl: async () => broken('application/json', async () => ({ error: { type: 'insufficient_quota' } }), 429) }), /billing and usage/);
});
