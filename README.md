# Relay Office

An original 2D office for a four-agent, human-reviewed project consultancy. New projects begin with saved discovery questions and an approved brief, then move through research, requirements, design and review. The optional build produces a **single-file website prototype** using an OpenAI-compatible provider. Existing projects keep their original four tasks. The agents have no browser, terminal or image-generation access.

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
2. Select **Save and select provider**, then **Check API key** for OpenRouter or **Test connection** for another provider. OpenRouter checks `GET /api/v1/key` without running the model and reports remaining daily free requests when supplied by OpenRouter. Other providers receive one small real AI request that may consume quota. A successful key check does not verify model availability, response quality, or ability to generate a full website. The selected provider handles subsequent tasks and website generation. Previous `.env` credentials appear as an optional Environment connection.
3. To change models, add a new connection and select it. Removing the active connection returns to `.env` if configured. A saved OpenRouter connection has its own **Free fallback** setting, enabled by default; toggle it from its connection row. The `.env` `AI_FREE_FALLBACK` value applies only when using the Environment connection. Switching to a paid provider is always a manual choice.

Connections are local to this workspace (there is no user account system). Keys are never included in API responses or project output. They are encrypted in gitignored `data/providers.json` using a randomly generated local `data/provider.key`. **Back up both files together** if you need to migrate connections. Anyone with access to the local application and its data files can use or recover those keys; do not expose the API beyond localhost. A missing encryption key cannot recover saved credentials; remove the lost connection and add it again. Model discovery lists IDs and does not verify Chat Completions support; use **Test connection** for that.

Each Step or automatic task sends your brief and relevant prior deliverables to the selected provider. Calls may consume quota or incur charges under that provider's terms. With OpenRouter (`AI_BASE_URL=https://openrouter.ai/api/v1`), a recoverable error or truncated response triggers at most two extra requests, after 3 and 6 seconds, when fallback is enabled for that connection. The server first checks OpenRouter's current catalog for `:free` text models with zero prompt, completion, and request prices and enough output capacity for the request. When it finds fewer than two candidates for a 1,200-token stage, it uses OpenRouter's documented free-only `openrouter/free` router for the remaining fallback attempts; if catalog discovery fails, it can try that router directly. The router picks an available free model at random, so it may select the same underlying model again. If the catalog does not list an output maximum for an otherwise eligible zero-price model, it is tried only with a 1,200-token request; its ability to finish is not guaranteed. The website builds in two small requests: first a previewable HTML page, then its CSS. Each completed stage is saved on the project; retrying resumes at the next stage. Where listed, a fallback request stays within the model’s output limit. It never intentionally selects a paid fallback; free requests can still hit account-wide rate limits. Each attempted request may count against free-tier limits. For the Environment connection set `AI_FREE_FALLBACK=false` in `.env` to disable extra requests; for a saved OpenRouter connection use its **Free fallback** toggle. Other OpenAI-compatible providers keep the single-model behavior.

```bash
npm run dev
```

Visit Vite's displayed URL. The script runs the browser UI and the local Node API together. To run a built app: `npm run build && npm start` and visit `http://127.0.0.1:3001`.

## Workflow

1. Enter an idea. Answer Nova's four starter and two follow-up discovery questions (partial answers are saved), inspect the clarified brief and approve or edit it. New projects have four ordered consultancy assignments. Earlier projects remain selectable and use their original workflow.
2. Research optionally uses Brave Search if `BRAVE_SEARCH_API_KEY` is set in `.env`. The search record contains URLs and **unverified result excerpts**, not fetched or fact-checked webpages. With no search key it saves an explicitly labeled research plan, not findings. Review it before approving. Press **Step** for one assignment or **Run team** to stop at the next approval.
3. Review and approve each research, requirements, design and final-review draft, or enter specific revision feedback. A revision preserves the previous text. The design assignment also saves a responsive structural HTML wireframe that you can preview and download. It is not an AI-rendered image.
4. Provider errors leave the assignment in **Needs attention** with a retry button. Projects and activity history are saved in `data/projects.json` and restored after a restart. Existing `data/workspace.json` data from v0.2 is imported automatically and kept as a backup. An interrupted in-flight task becomes retryable.
5. In **Project deliverables**, open each **Read deliverable**, download the named working documents, and preview the wireframe. Once all tasks are approved, **Generate website prototype** creates one `index.html` containing HTML, CSS and optional JavaScript. Preview, inspect source or download it. Enter revision feedback to save the previous version and generate a new version. An older completed project can build without rerunning its four tasks.

The 2D office illustrates four people with role-specific work areas. Their short bubbles reflect actual task and discovery states; gestures animate only while that person has an active assignment. Select a person in the office or sidebar for details. Reduced-motion settings stop the gestures.

The model produces written plans and, on explicit request, HTML source for a standalone website prototype. The prototype is saved inside `data/projects.json` along with the project; no website directory is created until you download `index.html` from the browser. The model does **not** run the generated code, browse websites, test the result, or deploy it. Preview runs in a sandboxed iframe, and downloaded source requires your review before publication. Run/pause controls do not cancel an in-flight provider request; pause takes effect after it returns.

## Verification

```bash
npm test
npm run build
```

If a project task reports `Could not save the project` or Windows `EPERM` on `data/projects.json`, the server retries short-lived file locks automatically. If the error persists, close duplicate development servers and any program holding that file, then restart the app and use **Retry task**. Check that the project directory is writable; a file-sync or security tool may also hold it temporarily. Back up `data/projects.json` before moving the project directory. Never delete that file to clear a lock: it contains the saved projects and generated outputs.

Tests exercise approvals, revision context, project migration, failed-task recovery, provider URL validation, local credential encryption, provider switching, website artifact persistence, and bounded free-model fallback with mocked responses. A real provider call requires your own credentials and has not been validated by CI. Website stages use a 60-second timeout per model attempt. During generation the UI shows the model, countdown, and retry delay. If a stage fails, the app keeps the completed stages and four approved plans. On reload or a later session, select the saved project and continue. Once automatic free-model attempts end in an error, use **Retry website** in the error banner or Project deliverables section; if the page stage was saved, this resumes with its unfinished styling stage. Live free-model availability and quota still depend on OpenRouter.

If website generation reports a dropped connection, an empty response, or invalid JSON, the selected provider or gateway did not return a complete Chat Completions response. An OpenRouter **Check API key** confirms credentials only; a short **Test connection** on other providers can still pass while a longer website request fails. Check the active connection, selected model, and provider logs. If it repeats, choose a model with enough output capacity; for OpenRouter check whether free fallback is enabled on that connection and whether verified free models are available. HTTP status and response type are reported without echoing the raw provider response. Failed generation keeps your four completed plans and any completed website stage. The saved HTML stage is previewable before CSS is generated; the completed index.html appears only when both stages finish. Do not share your API key when reporting an error.

An HTTP 429 can mean a temporary rate limit or exhausted API credits/account limit. Check the configured provider's usage and limits before retrying. When the provider supplies a known quota code, the app shows a billing/usage hint and stops free-model fallback because another model cannot restore exhausted account quota. An ambiguous 429 still allows OpenRouter's bounded fallback; account-wide free request limits may block every attempt. ChatGPT subscriptions and OpenAI API billing are separate. The app does not print raw provider error bodies or API keys.

## Scope and security

- Multiple saved projects in one local workspace, bound to `127.0.0.1`. There is no login, multi-user isolation, hosted database, or deployment hardening. Do not expose the Node API to the public internet.
- The API key remains on the Node server; only provider readiness and model name are sent to the browser. Briefs and outputs are stored locally in `data/`, which is gitignored.
- Office people and desks are original SVG/CSS drawn in the app. No source or noncommercial assets from [The Delegation](https://github.com/arturitu/the-delegation) are included. No license has been selected for this repository.

## Next milestones

Add authentication, durable database storage, typed artifacts and streaming events, task dependencies and provider budgets, then richer original office assets and multi-user collaboration.
