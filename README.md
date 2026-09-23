# Relay Office

An original, code-generated 3D office for exploring a team workflow. This is the first working foundation of **ai-delegation-office**.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the local URL Vite prints. Run `npm run build` for a production build and TypeScript check.

## What works today

- An interactive Three.js office with four selectable agents, built entirely from primitives; no external 3D models or textures.
- A project brief form that creates a four-stage planning workflow.
- Run, pause, and single-step controls; task board and activity log.
- Two approval gates with approve/revise actions, plus agent status and inspector views.
- Responsive layout and a text fallback if WebGL is unavailable.

**Simulation only:** The agent updates and task completions are deterministic UI events. There are no AI calls, generated deliverables, saved projects, authentication, backend, or real orchestration yet. Avoid entering sensitive information in the brief; it is displayed in your browser session. The initial brief is sample text.

## Next implementation milestones

1. Define persisted projects, task dependencies, event history, and typed artifacts in a backend.
2. Implement a server-side orchestration service with provider adapters, budgets, retries, and tool permissions. Keep provider keys on the server.
3. Stream real execution events into the existing board, inspector, approval gate, and 3D scene.
4. Add authentication, workspace isolation, observability, tests for the orchestration transitions, and deployment configuration.

## Assets and source

This repository is an independent implementation inspired by the broad idea of visual agent workspaces. It does not include source code or the noncommercial 3D assets from [The Delegation](https://github.com/arturitu/the-delegation). All current 3D geometry is created at runtime. No license has been selected for this repository yet.
