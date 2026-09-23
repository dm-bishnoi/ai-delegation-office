# Relay Office

An original 3D office for a four-agent, human-reviewed project workflow. The four tasks produce written plans. After approving all four, you can also generate a **single-file website prototype** using the configured OpenAI-compatible provider. Agents do not have browser, terminal, or other tool access.

## Local setup

Requires Node.js 20 or newer.

```bash
npm ci
cp .env.example .env
```

Edit `.env` on your machine:

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-provider-model-id
AI_API_KEY=your-private-key
```

OpenRouter, a self-hosted OpenAI-compatible gateway, or another provider exposing `POST /chat/completions` with `choices[0].message.content` can work. Set `AI_BASE_URL` to the prefix **before** `/chat/completions`. For a local provider, `http://127.0.0.1` or `http://localhost` is accepted; remote providers must use HTTPS. Availability and model compatibility depend on your chosen provider. Never put a key in frontend code or commit `.env`.

Each Step or automatic task sends your brief and relevant prior deliverables to the selected provider. Calls may consume quota or incur charges under that provider's terms.

```bash
npm run dev
```

Visit Vite's displayed URL. The script runs the browser UI and the local Node API together. To run a built app: `npm run build && npm start` and visit `http://127.0.0.1:3001`.

## Workflow

1. Enter a brief. This creates four ordered assignments and a saved project. Starting another brief keeps earlier projects in the sidebar; select one to resume it.
2. Press **Step** for one AI response or **Run team** to continue automatically. The next agent sees approved earlier deliverables as context.
3. Nova's strategy and Echo's final review stop for human approval. Read the deliverable, approve it, or enter specific revision feedback. Revision reruns that assignment.
4. Provider errors leave the assignment in **Needs attention** with a retry button. Projects and activity history are saved in `data/projects.json` and restored after a restart. Existing `data/workspace.json` data from v0.2 is imported automatically and kept as a backup. An interrupted in-flight task becomes retryable.
5. In **Project deliverables**, open each task's **Read deliverable** to see the plan. Once all four tasks are approved, click **Generate website prototype**. This makes one `index.html` containing HTML, CSS, and optional JavaScript. Use **Preview website**, **View source code**, or **Download code**. A project already completed on v0.3 can generate its prototype without rerunning the four tasks.

In the 3D scene, drag to orbit and scroll to zoom. Agents move to their desks when generating a task and to the shared review table while awaiting approval. During website generation, Atlas moves to the desk, shows a work label, and animates while the model responds. Their floor rings show active, review, and failed states. You can always select an agent from the sidebar if WebGL is unavailable.

The model produces written plans and, on explicit request, HTML source for a standalone website prototype. The prototype is saved inside `data/projects.json` along with the project; no website directory is created until you download `index.html` from the browser. The model does **not** run the generated code, browse websites, test the result, or deploy it. Preview runs in a sandboxed iframe, and downloaded source requires your review before publication. Run/pause controls do not cancel an in-flight provider request; pause takes effect after it returns.

## Verification

```bash
npm test
npm run build
```

Tests exercise approvals, revision context, project migration, failed-task recovery, provider URL validation, and website artifact persistence with mocked responses. A real provider call requires your own credentials and has not been validated by CI. Some free models may not allow enough output tokens for a complete website; the app reports an error and lets you retry without losing existing plans.

## Scope and security

- Multiple saved projects in one local workspace, bound to `127.0.0.1`. There is no login, multi-user isolation, hosted database, or deployment hardening. Do not expose the Node API to the public internet.
- The API key remains on the Node server; only provider readiness and model name are sent to the browser. Briefs and outputs are stored locally in `data/`, which is gitignored.
- The office geometry is made from primitives at runtime. No source or noncommercial assets from [The Delegation](https://github.com/arturitu/the-delegation) are included. No license has been selected for this repository.

## Next milestones

Add authentication, durable database storage, typed artifacts and streaming events, task dependencies and provider budgets, then richer original office assets and multi-user collaboration.
