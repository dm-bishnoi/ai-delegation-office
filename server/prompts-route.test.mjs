// Route-level regression test for the new-project prompt flow.
//
// Reproduces the exact condition behind the TDZ shadowing bug
// (`const activeProject = activeProject()` inside the /api/prompts/route
// handler in server/index.mjs): a store WITH an active project, a valid
// new-project prompt, and a real HTTP round-trip against the actual server
// module. The bug produced a 500 ReferenceError before the fix; the test now
// pins the route to a 200 with a valid routing result.
//
// The server binds 127.0.0.1 and reads data/projects.json relative to the
// module, so the test runs it as a child process on a scratch port with a
// temporary data directory and never touches real project data.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'index.mjs');

async function startServer(port, dataDir) {
  await mkdir(dataDir, { recursive: true });
  // Seed a store with an ACTIVE project — the exact precondition of the bug.
  await writeFile(join(dataDir, 'projects.json'), `${JSON.stringify({
    activeProjectId: 'proj-seeded-active',
    projects: [{
      id: 'proj-seeded-active', brief: 'Support desk platform for small businesses with tickets', mode: 'consultancy',
      discovery: { status: 'questions', answers: {}, brief: '' }, tasks: [], activity: [], nextId: 2,
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    }],
  }, null, 2)}\n`);
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, API_PORT: String(port), RELAY_DATA_DIR: dataDir, AI_BASE_URL: '', AI_MODEL: '', AI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/workspace`);
      if (probe.ok) break;
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return { child, output: () => output };
}

const PORT = 3044;
const NEW_PROMPT = 'Build a subscription management SaaS for freelancers and small agencies with recurring payments and reminders';

test('POST /api/prompts/route succeeds with an active project and routes a new-project prompt', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'relay-route-'));
  const { child, output } = await startServer(PORT, dataDir);
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/prompts/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: NEW_PROMPT }),
    });
    const body = await response.json().catch(() => null);
    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}\nserver: ${output()}`);
    assert.equal(body?.error, undefined);
    assert.equal(body.routing.intent, 'new_project');
    assert.equal(body.routing.targetProjectId, null); // never requires an existing id
    assert.ok(body.routing.confidence === 'high' || body.routing.confidence === 'low');
    assert.ok(Array.isArray(body.projects) && body.projects.length === 1);
    // A garbage prompt still yields a sanitized 4xx, never a 500 ReferenceError.
    const bad = await fetch(`http://127.0.0.1:${PORT}/api/prompts/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    assert.equal(bad.status, 400);
    assert.doesNotMatch((await bad.json()).error, /ReferenceError|activeProject/i);
    assert.doesNotMatch(output(), /ReferenceError/);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('full create flow via the real API: route -> create -> active switch -> discovery', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'relay-route-create-'));
  const { child, output } = await startServer(PORT + 1, dataDir);
  const base = `http://127.0.0.1:${PORT + 1}`;
  try {
    // Create through the normal API (the client's create branch does exactly this).
    const created = await fetch(`${base}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: NEW_PROMPT.slice(0, 120) }),
    });
    assert.equal(created.status, 201);
    const snapshot = await created.json();
    const newId = snapshot.workspace?.id;
    assert.ok(newId && newId !== 'proj-seeded-active');
    assert.equal(snapshot.projects.length, 2); // project count increased by one
    assert.equal(snapshot.workspace.id, newId); // active project switched to the new one
    assert.equal(snapshot.workspace.discovery.status, 'questions'); // discovery opens
    // No "Not found." anywhere in a successful flow.
    assert.doesNotMatch(JSON.stringify(snapshot), /Not found/);
    // The seeded project is intact and still selectable; both boards stay distinct.
    const back = await fetch(`${base}/api/projects/proj-seeded-active/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(back.status, 200);
    const restored = await back.json();
    assert.equal(restored.workspace.id, 'proj-seeded-active');
    assert.equal(restored.workspace.tasks.length, 0); // untouched seeded tasks
    const forward = await fetch(`${base}/api/projects/${newId}/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const again = await forward.json();
    assert.equal(again.workspace.id, newId);
    assert.equal(again.workspace.brief.startsWith('Build a subscription management SaaS'), true);
    assert.doesNotMatch(output(), /ReferenceError/);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
