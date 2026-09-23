import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientError, completeTask, decide, failTask, makeWorkspace, nextTask, retry } from './workflow.mjs';
import { generate, generateWebsite, providerInfo } from './provider.mjs';
import { loadStore, projectSummaries, saveStore } from './store.mjs';

const port = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
let catalog = await loadStore();
let busy = false;
let operation = null;

function activeProject() {
  return catalog.projects.find(project => project.id === catalog.activeProjectId) || null;
}

function snapshot() {
  return { workspace: activeProject(), projects: projectSummaries(catalog), provider: providerInfo(), busy, operation };
}

function requireActive(projectId) {
  const project = activeProject();
  if (!project) throw new ClientError(404, 'Create a project first.');
  if (project.id !== projectId) throw new ClientError(409, 'The active project changed. Refresh the page.');
  return project;
}

function touch(project) { project.updatedAt = new Date().toISOString(); }

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ClientError(415, 'Use application/json.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new ClientError(413, 'Request is too large.');
  }
  try { return JSON.parse(body); }
  catch { throw new ClientError(400, 'Invalid JSON.'); }
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = resolve(dist, `.${requested}`);
  if (file !== dist && !file.startsWith(dist + sep)) return json(res, 403, { error: 'Forbidden.' });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(file)] || 'application/octet-stream';
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch {
    if (!extname(requested)) return serveStatic('/index.html', res);
    json(res, 404, { error: 'Not found. Run npm run build first.' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return await serveStatic(pathname, res);
    if (req.method === 'GET' && pathname === '/api/workspace') return json(res, 200, snapshot());
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    if (busy) throw new ClientError(409, 'An AI task is still running.');
    const body = await readJson(req);
    if (busy) throw new ClientError(409, 'An AI task is still running.');
    busy = true;
    try {
      if (pathname === '/api/projects') {
        const next = makeWorkspace(body?.brief);
        const updated = { activeProjectId: next.id, projects: [...catalog.projects, next] };
        await saveStore(updated);
        catalog = updated;
        return json(res, 201, snapshot());
      }
      const selection = pathname.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/select$/);
      if (selection) {
        if (!catalog.projects.some(project => project.id === selection[1])) throw new ClientError(404, 'Project not found.');
        const updated = { ...catalog, activeProjectId: selection[1] };
        await saveStore(updated);
        catalog = updated;
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/steps') {
        if (!providerInfo().configured) throw new ClientError(503, 'Configure the AI provider in .env first.');
        const project = requireActive(body?.projectId);
        const task = nextTask(project);
        try {
          touch(project);
          await saveStore(catalog);
          const output = await generate(project, task, { onAttempt: progress => { operation = { type: 'task', projectId: project.id, ...progress }; } });
          completeTask(project, task, output);
        } catch (error) {
          failTask(project, task, error instanceof Error ? error.message : 'AI request failed.');
        }
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/website') {
        if (!providerInfo().configured) throw new ClientError(503, 'Configure the AI provider in .env first.');
        const project = requireActive(body?.projectId);
        if (project.artifact) throw new ClientError(409, 'Website already generated for this project.');
        if (!project.tasks.length || project.tasks.some(task => task.status !== 'done')) {
          throw new ClientError(409, 'Finish and approve all assignments before building a website.');
        }
        operation = { type: 'website', projectId: project.id };
        let artifact;
        try { artifact = await generateWebsite(project, { onAttempt: progress => { operation = { type: 'website', projectId: project.id, ...progress }; } }); }
        catch (cause) { throw new ClientError(502, cause instanceof Error ? cause.message : 'Could not generate website.'); }
        project.artifact = artifact;
        project.activity.unshift({ id: project.nextId++, agent: 'build', message: 'Website prototype is ready to preview and download.', time: artifact.createdAt });
        project.activity = project.activity.slice(0, 100);
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      const decision = pathname.match(/^\/api\/tasks\/(\d+)\/decision$/);
      if (decision) {
        const project = requireActive(body?.projectId);
        decide(project, Number(decision[1]), body?.decision, body?.feedback);
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      const retryMatch = pathname.match(/^\/api\/tasks\/(\d+)\/retry$/);
      if (retryMatch) {
        const project = requireActive(body?.projectId);
        retry(project, Number(retryMatch[1]));
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      return json(res, 404, { error: 'Not found.' });
    } finally { busy = false; operation = null; }
  } catch (error) {
    const status = error instanceof ClientError ? error.status : 500;
    if (status === 500) console.error('API error:', error);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Server error. Check the API console.' : error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Relay Office API listening on http://127.0.0.1:${port}`));
