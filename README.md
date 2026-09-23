# Relay Office

An original 3D office for a four-agent, human-reviewed project workflow. **This version generates real written deliverables** through a configured OpenAI-compatible Chat Completions endpoint. It still uses simple code-generated characters and does not give agents browser, terminal, or other tool access.

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

1. Enter a brief. This creates four ordered assignments; starting a new brief replaces the previous local project.
2. Press **Step** for one AI response or **Run team** to continue automatically. The next agent sees approved earlier deliverables as context.
3. Nova's strategy and Echo's final review stop for human approval. Read the deliverable, approve it, or enter specific revision feedback. Revision reruns that assignment.
4. Provider errors leave the assignment in **Needs attention** with a retry button. The workspace and activity history are saved in `data/workspace.json` and restored after a restart. An interrupted in-flight task becomes retryable.

The model is asked for written plans, design outlines, implementation plans, and a review checklist. It does **not** execute code, browse websites, create files, or independently verify its claims. Treat generated content as a draft requiring human review. Run/pause controls do not cancel an in-flight provider request; pause takes effect after it returns.

## Verification

```bash
npm test
npm run build
```

Tests exercise approvals, revision context, failed-task recovery, and provider URL validation with a mocked response. A real provider call requires your own credentials and has not been validated by CI.

## Scope and security

- Single local workspace, bound to `127.0.0.1`. There is no login, multi-user isolation, hosted database, or deployment hardening. Do not expose the Node API to the public internet.
- The API key remains on the Node server; only provider readiness and model name are sent to the browser. Briefs and outputs are stored locally in `data/`, which is gitignored.
- The office geometry is made from primitives at runtime. No source or noncommercial assets from [The Delegation](https://github.com/arturitu/the-delegation) are included. No license has been selected for this repository.

## Next milestones

Add project history and authentication, durable database storage, typed artifacts and streaming events, task dependencies and provider budgets, then richer original office assets and movement tied to actual execution events.
