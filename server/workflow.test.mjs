import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { completeTask, decide, failTask, makeWorkspace, nextTask, retry } from './workflow.mjs';
import { generate, providerEndpoint } from './provider.mjs';
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
