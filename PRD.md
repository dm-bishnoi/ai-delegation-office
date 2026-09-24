# Relay Office — AI project consultancy

Status: product direction with an implemented local consultancy flow. The app now has four starter and two follow-up discovery answer slots with AI-tailored wording and selectable suggestions when a provider is connected, guided fallback questions, brief approval, optional search snippets/research plan, approval-gated requirements/design/review, a structural wireframe, 2D office and optional versioned single-file website. Open-ended conversational interviewing, verified page research, raster image generation and multi-file implementation remain planned.

## Product outcome

Help a person turn an uncertain product idea into an approved, evidence-backed brief, research report, requirements, visual design, and, optionally, an editable website prototype. Every useful result must remain visible and resumable in its project. The 2D office makes actual work understandable; it is not the source of truth for progress.

## Primary user

An individual founder, freelancer, or small product team with an idea and limited time to research, scope, and communicate it. The user can start with a short brief, answer follow-up questions, inspect each deliverable, request revisions, and return later.

## Proposed project flow

1. **Discovery:** Nova summarizes the user's idea and asks at most 2–4 high-value questions per turn. Save each answer, confirmed fact, assumption, and open question. Questions focus on audience, problem, constraints, expected outcome, and what would change the scope. Allow “I don't know”; never loop until an impossible standard of complete certainty is reached.
2. **Brief approval:** Show a concise scope, audience, goals, success criteria, exclusions, and remaining assumptions. The user can correct or approve it. Do not present guesses as confirmed requirements.
3. **Research:** When real search/browsing tools are available, collect relevant sources, dates, quoted or paraphrased findings, conflicts, and confidence. Distinguish external evidence from user statements and model suggestions. If no research tool is configured, label the result as an unverified research plan rather than researched findings.
4. **Requirements:** Produce a readable PRD for the user's project: user journeys, requirements, priorities, constraints, acceptance criteria, and unresolved decisions. Obtain approval before design.
5. **Design:** Mira produces a sitemap, task flows, wireframes, design direction, responsive states, and reviewable visual assets where supported. A text-only design brief must be labeled as such. Generated images require an image-capable provider, saved asset files, and provenance; the text model must not claim images exist when it only wrote prompts.
6. **Review and optional build:** Echo checks consistency against the approved brief and evidence. Atlas builds only after an explicit build request and approved scope; show real saved files and a safe preview. Avoid claiming that completed planning tasks mean a site has been built.

The user may pause, switch projects, resume at the last saved step, revise a previous stage, or download artifacts. Revision of an approved upstream artifact must identify downstream artifacts that need re-review.

## Agents and visible activity

| Agent | Consultancy responsibility | Example visible update |
| --- | --- | --- |
| Nova | Discovery, project framing, approval handoff | “Clarifying your goals…” |
| Research specialist (planned) | Source gathering and evidence synthesis | “Comparing three sources…” |
| Mira | UX flows, wireframes, visual direction | “Sketching user flows…” |
| Atlas | Feasibility and optional implementation | “Building the prototype…” |
| Echo | Requirements and deliverable review | “Checking the details…” |

Adapt a small, reviewed selection of [agency-agents](https://github.com/msitarzewski/agency-agents) role descriptions as inspiration, not as executable tools or proof of expertise. Keep their MIT license and copyright notice when copying substantial text. Do not use the sales-oriented Discovery Coach verbatim as a user-requirements interviewer.

## First release slices

### Slice 1 — truthful discovery and saved work

- Existing projects and approved plans remain readable after migration.
- Each project stores its discovery conversation, structured brief, assumptions, questions, stage statuses, review decisions, and artifact versions.
- The user can answer or revise questions without losing earlier approvals or saved work.
- Restarting the browser/server resumes the last saved state; interrupted jobs become visibly resumable or retryable.

### Slice 2 — real consultancy artifacts

- Research has traceable source URLs, retrieval dates, clear evidence/assumption labels, and a review checkpoint.
- Requirements and designs are saved as named, versioned artifacts with preview and download.
- Approval and revision happen per artifact; generated output never silently overwrites approved work.

### Slice 3 — office and build

- Replace the current Three.js isometric office with a straight-on, 2D illustrated office. Agents have distinguishable poses for interviewing, researching, designing, building, reviewing, waiting, failed, and done.
- Status bubbles show short, server-backed activity summaries. Animated dots mean only “request in progress”; never expose private model reasoning or pretend to stream thoughts.
- Agent movement follows actual task transitions; a paused, queued, or failed job cannot appear to be actively building.
- Optional implementation produces versioned editable files and a sandboxed preview, starting from approved outputs.

## Acceptance examples

- From “I want a portfolio for a consultant,” Nova asks relevant missing questions, saves each answer, and presents a reviewable brief. Unknown budget may remain an explicit assumption instead of blocking forever.
- Research without a live source tool cannot show fabricated citations; research with a tool links every nontrivial factual claim to a source that supports it.
- If a provider times out during design, the brief, research, requirements, and any completed design artifacts still exist after restart. Retry resumes the unfinished stage.
- The office shows Atlas typing only during a real build job; on failure the activity bubble changes to a retryable error; reduced-motion users still see the same status in text.
- A completed website exposes its actual files, preview, download, and build version. The label “Website ready” only appears when saved files exist.

## Scope boundaries and measurement

Initial release: local single-user workflow, selective agent prompts, manual approvals, source-backed research when tools exist, and saved artifacts. Hosted collaboration, accounts, marketing automation, and autonomous deployments require a separate security and product decision.

Evaluate with a small set of real briefs: proportion reaching an approved brief, correctness of cited claims, rework after user review, resumed projects with no data loss, truthful job status, and successful artifact downloads. Free-model fallback and longer waits do not guarantee availability; surface exhausted quotas honestly.

Related: [Architecture.md](Architecture.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [AGENTS.md](AGENTS.md).
