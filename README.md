# Relay Office

An original 3D office for a four-agent, human-reviewed project workflow. The four tasks produce written plans. After approving all four, you can also generate a **single-file website prototype** using the configured OpenAI-compatible provider. Agents do not have browser, terminal, or other tool access.

## Local setup

Requires Node.js 20 or newer.

```bash
npm ci
cp .env.example .env
```

You can connect a provider directly from **AI connections** in the sidebar; this setup is optional. Alternatively, edit `.env` on your machine:

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-provider-model-id
AI_API_KEY=your-private-key
```

OpenRouter, a self-hosted OpenAI-compatible gateway, or another provider exposing `POST /chat/completions` with `choices[0].message.content` can work. Set `AI_BASE_URL` to the prefix **before** `/chat/completions`. For a local provider, `http://127.0.0.1` or `http://localhost` is accepted; remote providers must use HTTPS. Availability and model compatibility depend on your chosen provider. Never put a key in frontend code or commit `.env`.

### Connect AI from the workspace

1. Open **AI connections** and choose OpenRouter, OpenAI, Ollama, or an OpenAI-compatible endpoint. Enter its base URL, exact model ID, and API key (optional only for a local server). **Load model IDs** queries the provider's `/models` endpoint; if that endpoint is unavailable, enter the ID manually.
2. Select **Save and select provider**, then **Test connection**. This sends one small real AI request and may consume quota. The selected provider handles subsequent tasks and website generation. Previous `.env` credentials appear as an optional Environment connection.
3. To change models, add a new connection and select it. Removing the active connection returns to `.env` if configured. A saved OpenRouter connection has its own **Free fallback** setting, enabled by default; toggle it from its connection row. The `.env` `AI_FREE_FALLBACK` value applies only when using the Environment connection. Switching to a paid provider is always a manual choice.

Connections are local to this workspace (there is no user account system). Keys are never included in API responses or project output. They are encrypted in gitignored `data/providers.json` using a randomly generated local `data/provider.key`. **Back up both files together** if you need to migrate connections. Anyone with access to the local application and its data files can use or recover those keys; do not expose the API beyond localhost. A missing encryption key cannot recover saved credentials; remove the lost connection and add it again. Model discovery lists IDs and does not verify Chat Completions support; use **Test connection** for that.

Each Step or automatic task sends your brief and relevant prior deliverables to the selected provider. Calls may consume quota or incur charges under that provider's terms. With OpenRouter (`AI_BASE_URL=https://openrouter.ai/api/v1`), a transient error or truncated response triggers at most two extra requests, after 3 and 6 seconds. The server fetches OpenRouter's current model catalog and only chooses `:free` models with zero prompt, completion, and request prices and enough listed output capacity. It never selects an unverified or paid fallback. Each attempted request may count against free-tier limits. Set `AI_FREE_FALLBACK=false` in `.env` to disable this; other OpenAI-compatible providers keep the single-model behavior.

```bash
npm run dev
```

Visit Vite's displayed URL. The script runs the browser UI and the local Node API together. To run a built app: `npm run build && npm start` and visit `http://127.0.0.1:3001`.

## Workflow

1. Enter a brief. This creates four ordered assignments and a saved project. Starting another brief keeps earlier projects in the sidebar; select one to resume it.
2. Press **Step** for one AI response or **Run team** to continue automatically. The next agent sees approved earlier deliverables as context.
3. Nova's strategy and Echo's final review stop for human approval. Read the deliverable, approve it, or enter specific revision feedback. Revision reruns that assignment.
4. Provider errors leave the assignment in **Needs attention** with a retry button. Projects and activity history are saved in `data/projects.json` and restored after a restart. Existing `data/workspace.json` data from v0.2 is imported automatically and kept as a backup. An interrupted in-flight task becomes retryable.
5. In **Project deliverables**, open each task's **Read deliverable** to see the plan. Once all four tasks are approved, click **Generate website prototype**. This makes one `index.html` containing HTML, CSS, and optional JavaScript. Use **Preview website**, **View source code**, or **Download code**. The result shows which model generated it. A project already completed on v0.3 can generate its prototype without rerunning the four tasks.

In the 3D scene, drag to orbit and scroll to zoom. Agents move to their desks when generating a task and to the shared review table while awaiting approval. During website generation, Atlas moves to the desk, shows a work label, and animates while the model responds. Their floor rings show active, review, and failed states. You can always select an agent from the sidebar if WebGL is unavailable.

The model produces written plans and, on explicit request, HTML source for a standalone website prototype. The prototype is saved inside `data/projects.json` along with the project; no website directory is created until you download `index.html` from the browser. The model does **not** run the generated code, browse websites, test the result, or deploy it. Preview runs in a sandboxed iframe, and downloaded source requires your review before publication. Run/pause controls do not cancel an in-flight provider request; pause takes effect after it returns.

## Verification

```bash
npm test
npm run build
```

Tests exercise approvals, revision context, project migration, failed-task recovery, provider URL validation, local credential encryption, provider switching, website artifact persistence, and bounded free-model fallback with mocked responses. A real provider call requires your own credentials and has not been validated by CI. Some free models may not allow enough output tokens for a complete website; after fallback attempts are exhausted, the app reports an error and lets you retry without losing existing plans.

If website generation reports an empty or invalid JSON response, the selected provider or gateway did not return a complete Chat Completions response. A short **Test connection** call can still pass while a longer website request fails. Check the active connection, selected model, and provider logs. If it repeats, choose a model with enough output capacity; for OpenRouter check whether free fallback is enabled on that connection and whether verified free models are available. HTTP status and response type are reported without echoing the raw provider response. Failed generation keeps your four completed plans; it does not save a partial website. Do not share your API key when reporting an error.

An HTTP 429 can mean a temporary rate limit or exhausted API credits/account limit. Check the configured provider's usage and limits before retrying. When the provider supplies a known quota code, the app shows a billing/usage hint and stops free-model fallback because another model cannot restore exhausted account quota. An ambiguous 429 still allows OpenRouter's bounded fallback; account-wide free request limits may block every attempt. ChatGPT subscriptions and OpenAI API billing are separate. The app does not print raw provider error bodies or API keys.

## Scope and security

- Multiple saved projects in one local workspace, bound to `127.0.0.1`. There is no login, multi-user isolation, hosted database, or deployment hardening. Do not expose the Node API to the public internet.
- The API key remains on the Node server; only provider readiness and model name are sent to the browser. Briefs and outputs are stored locally in `data/`, which is gitignored.
- The office geometry is made from primitives at runtime. No source or noncommercial assets from [The Delegation](https://github.com/arturitu/the-delegation) are included. No license has been selected for this repository.

## Next milestones

Add authentication, durable database storage, typed artifacts and streaming events, task dependencies and provider budgets, then richer original office assets and multi-user collaboration.
