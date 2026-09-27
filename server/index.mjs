import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientError, completeTask, decide, failTask, nextTask, retry } from './workflow.mjs';
import { generate, generateDiscoveryQuestions, generateWebsite, listModels, testConnection } from './provider.mjs';
import { activeProviderEnv, activeProviderInfo, loadProviderSettings, publicProviderSettings,
  removeProvider, saveProvider, saveProviderSettings, selectProvider, setProviderFallback } from './provider-settings.mjs';
import { loadStore, projectSummaries, saveStore } from './store.mjs';
import { answerDiscovery, completeConsultancyTask, decideBrief, makeConsultancyProject } from './consultancy.mjs';
import { collectResearch, researchPlan } from './research.mjs';
import { applyChangeRequest, cancelChangeRequest, proposeChangeRequest, routePrompt, routePromptWithAI } from './prompts.mjs';
import { consumeTransaction, createTransaction, exchangeCode, OAuthFlowError, TRANSACTION_COOKIE } from './openrouter-oauth.mjs';
import { saveOAuthProvider, providerCredential } from './provider-settings.mjs';
import { refreshVerifiedFreeModels } from './free-model-pool.mjs';

const openRouterRedirectUri = process.env.OPENROUTER_REDIRECT_URI?.trim()
  || `http://127.0.0.1:${Number(process.env.API_PORT || 3001)}/api/providers/openrouter/callback`;
const openRouterTransactions = new Map(); // cookie value -> { verifier, expiresAt }; server-side only

function serializeCookie({ name, value, httpOnly, maxAgeSeconds }) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const port = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
let catalog = await loadStore();
let providerSettings = await loadProviderSettings();
let busy = false;
let operation = null;

function activeProject() {
  return catalog.projects.find(project => project.id === catalog.activeProjectId) || null;
}

function snapshot() {
  return { workspace: activeProject(), projects: projectSummaries(catalog), provider: activeProviderInfo(providerSettings), researchSearchConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()), busy, operation };
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
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return await serveStatic(pathname, res);

    if (req.method === 'GET' && pathname === '/api/providers/openrouter/connect') {
      const { transaction, authorizationUrl, cookie } = createTransaction();
      openRouterTransactions.set(transaction.cookie, { verifier: transaction.verifier, expiresAt: transaction.expiresAt });
      res.writeHead(302, {
        Location: authorizationUrl.replace('__CALLBACK__', openRouterRedirectUri),
        'Set-Cookie': serializeCookie(cookie),
        'Cache-Control': 'no-store',
      });
      return res.end();
    }

    if (req.method === 'GET' && pathname === '/api/providers/openrouter/callback') {
      const failure = reason => {
        res.writeHead(302, { Location: '/?view=providers&openrouter=error', 'Set-Cookie': `${TRANSACTION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`, 'Cache-Control': 'no-store' });
        console.warn(`OpenRouter authorization failed: ${reason}`);
        return res.end();
      };
      try {
        const transaction = consumeTransaction(openRouterTransactions, readCookie(req, TRANSACTION_COOKIE));
        const key = await exchangeCode(searchParams.get('code'), transaction.verifier);
        // Non-generation credential check via the existing OpenRouter key endpoint.
        const check = await fetch('https://openrouter.ai/api/v1/key', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10000), redirect: 'error',
        });
        if (!check.ok) throw new OAuthFlowError('OpenRouter key check failed.');
        await saveOAuthProvider(providerSettings, { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: key });
        providerSettings = await loadProviderSettings();
        // Discover and verify usable free models now that the key is stored.
        try {
          const credential = await providerCredential(providerSettings);
          const { pool } = await refreshVerifiedFreeModels({ apiKey: credential });
          if (pool.length) {
            providerSettings = { ...providerSettings, providers: providerSettings.providers.map(item => item.id === providerSettings.activeId ? { ...item, verifiedFreeModels: pool, model: pool[0].id } : item) };
            await saveProviderSettings(providerSettings);
            providerSettings = await loadProviderSettings();
          }
        } catch (cause) { console.warn(`OpenRouter model discovery skipped: ${cause instanceof Error ? cause.message : 'unavailable'}`); }
        console.warn('OpenRouter authorization completed.');
        res.writeHead(302, { Location: '/?view=providers&openrouter=connected', 'Set-Cookie': `${TRANSACTION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`, 'Cache-Control': 'no-store' });
        return res.end();
      } catch (cause) {
        const reason = cause instanceof OAuthFlowError ? cause.message : 'Unexpected error';
        return failure(reason);
        }
    }
    if (req.method === 'GET' && pathname === '/api/workspace') return json(res, 200, snapshot());
    if (req.method === 'GET' && pathname === '/api/providers') return json(res, 200, publicProviderSettings(providerSettings));
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { throw new ClientError(403, 'Invalid request origin.'); }
      if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new ClientError(403, 'Invalid request origin.');
    }
    if (busy) throw new ClientError(409, 'An AI task is still running.');
    const body = await readJson(req);
    if (busy) throw new ClientError(409, 'An AI task is still running.');
    busy = true;
    try {
      if (pathname === '/api/providers/free-models') {
        const credential = await providerCredential(providerSettings);
        if (!credential) throw new ClientError(400, 'Connect an OpenRouter provider with a key first.');
        try {
          const { pool, note } = await refreshVerifiedFreeModels({ apiKey: credential });
          providerSettings = { ...providerSettings, providers: providerSettings.providers.map(item => item.id === providerSettings.activeId
            ? { ...item, verifiedFreeModels: pool, model: pool.length ? pool[0].id : item.model } : item) };
          await saveProviderSettings(providerSettings);
          providerSettings = await loadProviderSettings();
          return json(res, 200, { verifiedFreeModels: pool, note, provider: activeProviderInfo(providerSettings) });
        } catch (cause) { throw new ClientError(502, cause instanceof Error ? cause.message : 'Model discovery failed.'); }
      }
      if (pathname === '/api/providers/models') {
        try { return json(res, 200, { models: await listModels({ baseUrl: body?.baseUrl, apiKey: body?.apiKey }) }); }
        catch (cause) { throw new ClientError(400, cause instanceof Error ? cause.message : 'Could not load models.'); }
      }
      if (pathname === '/api/providers') {
        try { providerSettings = await saveProvider(providerSettings, body); }
        catch (cause) {
          if (/^(Enter a provider|API URL|An API key|AI_BASE_URL)/.test(cause.message)) throw new ClientError(400, cause.message);
          throw cause;
        }
        return json(res, 201, publicProviderSettings(providerSettings));
      }
      if (pathname === '/api/providers/select') {
        try { providerSettings = selectProvider(providerSettings, body?.id); }
        catch (cause) { throw new ClientError(404, cause.message); }
        await saveProviderSettings(providerSettings);
        return json(res, 200, publicProviderSettings(providerSettings));
      }
      if (pathname === '/api/providers/models/select') {
        const provider = providerSettings.providers.find(item => item.id === body?.id);
        if (!provider || !Array.isArray(provider.verifiedFreeModels) || !provider.verifiedFreeModels.some(model => model?.id === body?.model)) throw new ClientError(400, 'Choose a verified model from the list.');
        providerSettings = { ...providerSettings, providers: providerSettings.providers.map(item => item.id === body.id ? { ...item, model: body.model } : item) };
        await saveProviderSettings(providerSettings);
        providerSettings = await loadProviderSettings();
        return json(res, 200, publicProviderSettings(providerSettings));
      }
      if (pathname === '/api/providers/fallback') {
        try { providerSettings = setProviderFallback(providerSettings, body?.id, body?.enabled); }
        catch (cause) { throw new ClientError(400, cause.message); }
        await saveProviderSettings(providerSettings);
        return json(res, 200, publicProviderSettings(providerSettings));
      }
      if (pathname === '/api/providers/remove') {
        try { providerSettings = removeProvider(providerSettings, body?.id); }
        catch (cause) { throw new ClientError(404, cause.message); }
        await saveProviderSettings(providerSettings);
        return json(res, 200, publicProviderSettings(providerSettings));
      }
      if (pathname === '/api/providers/test') {
        if (body?.id !== publicProviderSettings(providerSettings).activeId) throw new ClientError(400, 'Select this provider before testing.');
        if (!activeProviderInfo(providerSettings).configured) throw new ClientError(400, 'Connect a provider first.');
        try { return json(res, 200, await testConnection({ env: await activeProviderEnv(providerSettings) })); }
        catch (cause) { throw new ClientError(502, cause instanceof Error ? cause.message : 'Connection test failed.'); }
      }
      if (pathname === '/api/projects') {
        const next = makeConsultancyProject(body?.brief);
        const updated = { activeProjectId: next.id, projects: [...catalog.projects, next] };
        await saveStore(updated);
        catalog = updated;
        return json(res, 201, snapshot());
      }
      if (pathname === '/api/prompts/route') {
        const text = typeof body?.prompt === 'string' ? body.prompt : '';
        const routing = await routePromptWithAI(text, catalog.projects, activeProject(), { env: await activeProviderEnv(providerSettings) });
        return json(res, 200, { routing, projects: projectSummaries(catalog) });
      }
      if (pathname === '/api/projects/route-change') {
        const project = requireActive(body?.projectId);
        const request = proposeChangeRequest(project, body?.prompt);
        await saveStore(catalog);
        return json(res, 201, snapshot());
      }
      const changeCancel = pathname.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/change-requests\/([a-zA-Z0-9-]+)\/cancel$/);
      if (changeCancel) {
        const project = requireActive(changeCancel[1]);
        cancelChangeRequest(project, changeCancel[2]);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      const changeApply = pathname.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/change-requests\/([a-zA-Z0-9-]+)\/apply$/);
      if (changeApply) {
        const project = requireActive(changeApply[1]);
        applyChangeRequest(project, changeApply[2]);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      const selection = pathname.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/select$/);
      if (selection) {
        if (!catalog.projects.some(project => project.id === selection[1])) throw new ClientError(404, 'Project not found.');
        const updated = { ...catalog, activeProjectId: selection[1] };
        await saveStore(updated);
        catalog = updated;
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/discovery/answers') {
        const project = requireActive(body?.projectId);
        answerDiscovery(project, body?.answers);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/discovery/questions') {
        const project = requireActive(body?.projectId);
        const stage = project.discovery?.status;
        if (project.mode !== 'consultancy' || !['questions', 'followup'].includes(stage)) throw new ClientError(409, 'This project is not awaiting discovery questions.');
        if (!activeProviderInfo(providerSettings).configured) throw new ClientError(503, 'Connect an AI provider to ask Nova tailored questions. You can still answer the guided questions.');
        operation = { type: 'discovery', projectId: project.id, stage };
        let result;
        try {
          result = await generateDiscoveryQuestions(project, stage, { env: await activeProviderEnv(providerSettings), onAttempt: progress => {
            operation = { type: 'discovery', projectId: project.id, stage, ...progress,
              readyAt: progress.phase === 'waiting' ? Date.now() + progress.delayMs : null,
              deadlineAt: progress.phase === 'running' ? Date.now() + progress.timeoutMs : null };
          } });
        } catch (cause) {
          if (Array.isArray(cause?.attemptHistory)) project.discovery.questionAttempts = cause.attemptHistory;
          await saveStore(catalog);
          throw new ClientError(502, `${cause instanceof Error ? cause.message : 'Could not prepare questions.'} Your saved answers are safe; use the guided questions or retry.`);
        }
        delete project.discovery.questionAttempts;
        project.discovery[stage === 'questions' ? 'questions' : 'followUpQuestions'] = result.questions;
        project.discovery[stage === 'questions' ? 'questionModel' : 'followUpModel'] = result.model;
        project.activity.unshift({ id: project.nextId++, agent: 'lead', message: 'Nova prepared project-specific discovery questions and answer suggestions.', time: new Date().toISOString() });
        project.activity = project.activity.slice(0, 100);
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/discovery/decision') {
        const project = requireActive(body?.projectId);
        decideBrief(project, body?.decision);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/steps') {
        const project = requireActive(body?.projectId);
        if (!activeProviderInfo(providerSettings).configured && !(project.mode === 'consultancy' && project.tasks[0]?.status === 'queued' && !process.env.BRAVE_SEARCH_API_KEY)) {
          throw new ClientError(503, 'Connect an AI provider in AI connections first.');
        }
        const task = nextTask(project);
        try {
          touch(project);
          await saveStore(catalog);
          let research;
          if (project.mode === 'consultancy' && task.id === 1) {
            operation = { type: 'research', projectId: project.id, agent: task.owner, stage: 'search' };
            research = await collectResearch(project);
            project.research = research;
            touch(project);
            await saveStore(catalog);
          }
          const output = research && research.status !== 'snippets' ? researchPlan(project, research) : await generate(project, task, { research, env: await activeProviderEnv(providerSettings), onAttempt: progress => { operation = { type: 'task', projectId: project.id, agent: task.owner, ...progress,
            readyAt: progress.phase === 'waiting' ? Date.now() + progress.delayMs : null,
            deadlineAt: progress.phase === 'running' ? Date.now() + progress.timeoutMs : null }; } });
          if (project.mode === 'consultancy') completeConsultancyTask(project, task, output);
          else completeTask(project, task, output);
        } catch (error) {
          failTask(project, task, error instanceof Error ? error.message : 'AI request failed.', error?.attemptHistory);
        }
        touch(project);
        await saveStore(catalog);
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/website') {
        if (!activeProviderInfo(providerSettings).configured) throw new ClientError(503, 'Connect an AI provider in Settings first.');
        const project = requireActive(body?.projectId);
        if (project.artifact) throw new ClientError(409, 'Website already generated for this project.');
        if (!project.tasks.length || project.tasks.some(task => task.status !== 'done')) {
          throw new ClientError(409, 'Finish and approve all assignments before building a website.');
        }
        operation = { type: 'website', projectId: project.id };
        delete project.websiteError;
        delete project.websiteAttempts;
        let artifact;
        try { artifact = await generateWebsite(project, { env: await activeProviderEnv(providerSettings), onAttempt: progress => { operation = { type: 'website', projectId: project.id, ...progress,
          readyAt: progress.phase === 'waiting' ? Date.now() + progress.delayMs : null,
          deadlineAt: progress.phase === 'running' ? Date.now() + progress.timeoutMs : null }; }, onCheckpoint: async () => { touch(project); await saveStore(catalog); } }); }
        catch (cause) {
          project.websiteError = cause instanceof Error ? cause.message : 'Could not generate website.';
          if (Array.isArray(cause?.attemptHistory)) project.websiteAttempts = cause.attemptHistory;
          touch(project);
          await saveStore(catalog);
          throw new ClientError(502, project.websiteError);
        }
        const updated = structuredClone(catalog);
        const completed = updated.projects.find(item => item.id === project.id);
        completed.artifact = { ...artifact, version: (completed.artifactVersions?.length || 0) + 1, files: [{ filename: artifact.filename, content: artifact.content }] };
        delete completed.websiteDraft;
        delete completed.websiteError;
        delete completed.websiteAttempts;
        completed.activity.unshift({ id: completed.nextId++, agent: 'build', message: 'Website prototype is ready to preview and download.', time: artifact.createdAt });
        completed.activity = completed.activity.slice(0, 100);
        touch(completed);
        await saveStore(updated);
        catalog = updated;
        return json(res, 200, snapshot());
      }
      if (pathname === '/api/website/revise') {
        const project = requireActive(body?.projectId);
        if (!project.artifact) throw new ClientError(409, 'Build a website before requesting a revision.');
        if (typeof body?.feedback !== 'string' || !body.feedback.trim() || body.feedback.length > 800) throw new ClientError(400, 'Describe the website change in 1–800 characters.');
        project.artifactVersions ||= [];
        project.artifactVersions.push(project.artifact);
        project.websiteFeedback = body.feedback.trim();
        delete project.artifact;
        delete project.websiteDraft;
        project.activity.unshift({ id: project.nextId++, agent: 'build', message: 'Website revision requested. The previous version is saved.', time: new Date().toISOString() });
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
    const status = error?.code === 'STORE_BUSY' ? 503 : error instanceof ClientError ? error.status : 500;
    if (status === 500) console.error('API error:', error);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Server error. Check the API console.' : error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Relay Office API listening on http://127.0.0.1:${port}`));
