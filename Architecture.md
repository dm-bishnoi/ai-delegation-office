# Relay Office architecture

Status: implemented local consultancy workflow and longer-term migration targets. The local Node API, React/Vite client, interactive Three.js office and JSON store are implemented; hosted isolation, verified page research and image generation are future work.

## Current system (v0.8.0)

| Concern | Current module / behavior |
| --- | --- |
| UI and orchestration | `src/App.tsx`, `src/workflow.ts`; polls `/api/workspace`, renders tasks, review, saved project selector, and prototype preview |
| Office | `src/OfficeScene.tsx`; procedural WebGL scene with orbit controls, human figures, operation-driven walking and gestures, and DOM bubbles/roster |
| API | `server/index.mjs`; localhost `127.0.0.1`, JSON endpoints, one global in-memory busy flag, long-lived provider requests |
| Workflow | `server/workflow.mjs`, `server/consultancy.mjs`; legacy tasks preserved, new projects add saved starter and follow-up discovery answers, optional AI-tailored question wording and answer suggestions, and four approval-gated consultancy assignments |
| Research | `server/research.mjs`; optional Brave Search URLs and snippets, explicitly labeled as unverified, or a research plan without a search key |
| Provider | `server/provider.mjs`, `server/free-models.mjs`; OpenAI-compatible chat completions, bounded OpenRouter free fallback |
| Settings | `server/provider-settings.mjs`; server-side encrypted credentials in gitignored `data/providers.json`, local key in `data/provider.key` |
| Persistence | `server/store.mjs`; atomic JSON replacement for `data/projects.json`; imports legacy `data/workspace.json` |
| Prototype | Two checkpointed stages (HTML body, CSS), then one `index.html` in project JSON; iframe preview, download and saved versions with user revision feedback |

No app authentication, user ownership, hosted database, full webpage retrieval/verification, image generation, or editable multi-file output exists. Research captures search-result excerpts only; its descriptions cannot prove claims about a source page. Saved `data/` and `.env` are excluded from Git.

## Proposed modules and flow

Current new-project flow: idea → four saved starter answers → two scope/success follow-ups → clarified brief approval → optional search snippets or research plan → requirements approval → design draft and structural wireframe approval → Echo review → optional checkpointed build/version/download. Only the user approves or revises. Existing projects retain the older task order and artifacts.

- `project` owns immutable IDs, stage state, question/answer history, confirmed facts, assumptions, open questions, approvals, artifact references, and last update time.
- `artifact` holds kind, version, producer, provider/model if known, references to upstream versions, source links, saved file or content, and review decision.
- `job` records project, stage, attempt, configured model, started/updated times, bounded retry schedule, error class, and checkpoint. Persist state **before** starting an external request and after each successful stage. On restart mark interrupted work as resumable/retryable; don't fabricate completion.
- `event` is an append-only, user-visible status update, including `agentId`, `jobId`, `state`, `label`, timestamp, and optional artifact link. The office and activity log consume the same event stream or server snapshot.
- A planned research adapter exposes only approved search/fetch tools. Validate the retrieved URLs and treat fetched text as untrusted data. Store claim-to-source mapping rather than unsupported citation strings.
- A planned image adapter is separate from text generation. User uploads or generated assets are saved as versioned files, with content validation, attribution/licensing notes, and alt text.

These are proposed responsibilities and example records, not an API commitment. Preserve old `projects.json` during migration; add a versioned format and one-time upgrade path or compatible reader. Retain backups until migration tests prove old projects and their website drafts survive.

## Local-to-hosted security gates

The first attached checklist contains valuable controls but assumes features this local app does not have. Apply each at the boundary where it becomes relevant:

| Area | Now / before expansion | Before a hosted multi-user release |
| --- | --- | --- |
| Secrets | Keep API keys server-side; scan tracked files/history before release; keep `.env` and `data/` excluded; minimize provider and log output | Secret manager or protected environment, key rotation and auditing |
| Authentication | No login exists; retain loopback binding, don't expose API on the internet | Server-enforced auth, password hashing if passwords exist, secure HTTP-only cookies or safe equivalent, login rate limits, anti-bot controls as needed |
| Authorization and database | One shared local project catalog; no public DB key or SQL layer | Per-user ownership on every project/artifact/job read and write; parameterized queries; least-privilege DB credentials; row-level security only if chosen DB architecture uses it |
| Untrusted input | Validate brief and provider settings; escape user content in React; treat AI HTML as untrusted; review preview isolation | Validate all API fields and quotas server-side; upload MIME sniffing, size/type limits, path safety, SVG handling, malware policy as appropriate |
| Transport and browser | Use provider HTTPS for remote calls; avoid leaking secrets into JSON; separate generated preview from app privileges | HTTPS, strict origin and CSRF controls, CSP/security headers, safe preview origin/sandbox, response minimization, privacy/terms pages |
| Supply chain | Review dependencies and scan for known issues before a release | Repeat scans, pin/update dependencies, monitor security advisories |

Do not equate local encryption with user separation: anyone who controls the machine and both `data/providers.json` and `data/provider.key` can recover local credentials. Current POST origin validation accepts any `http://localhost:*` origin, so revisit CSRF and same-origin policy before broadening access. The current completed preview uses `srcDoc` with `sandbox="allow-scripts"`; generated scripts still execute within the sandbox. Treat generated markup as untrusted and design stronger isolation before public hosting. A meme checklist is not a substitute for a threat review and verification.

## Delivery sequence

1. Confirm scope and design state contract; add migration tests for old projects. Document security threats and keep the API local.
2. Implement saved discovery Q&A, structured brief and approvals. Separate durable project state from in-memory provider requests.
3. Add source-backed research, requirements and design artifacts with versions and review; never substitute model prose for retrieved evidence or image files.
4. Keep the task-driven 3D characters and status bubbles aligned with server operation snapshots. Provide a textual fallback and reduced motion; improve authored assets and visual QA separately.
5. Add resumable background jobs and editable website files/versions, safe preview, file download/ZIP, and selective regeneration.
6. Only if hosting is approved, complete identity, authorization, storage, abuse controls, security headers, privacy requirements, and release gates above.

## Verification targets

Existing `npm test` and `npm run build` remain useful for changed code. New coverage should include: migration of a v0.7.1 project with approved plans and saved website stage; restore after a crashed job; per-stage retry without overwriting approved artifacts; source-link validation; honest event-to-bubble status; unsafe preview isolation; and hosted ownership checks if hosting is implemented. Real provider reliability and UI animation require separate integration and visual review; passing mock tests does not prove live model availability.
