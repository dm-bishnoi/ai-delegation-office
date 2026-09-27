# Relay Office design system

Status: shared interactive 3D office implemented in `src/OfficeScene.tsx` and `src/styles.css`. It has procedural figures and furniture, status bubbles, orbit/zoom, and a textual roster. Concept images are art-direction references, not screenshots or a promise of exact fidelity. Browser-level visual review remains necessary.

## Visual character

A calm, professional project workspace with one shared, orbitable 3D office at its center. Four stylized adult human figures have distinct faces, clothes and stations, with a central walking path. The office makes the team's activity easy to read; actual research, requirements, approvals, and saved files remain first-class UI. Current figures use procedural geometry; better authored character assets can improve their realism without changing the task-state contract.

Keep the existing dark foundation as a starting point: page `#0c1015`, sidebar `#11161b`, panel `#171e22`, card `#202a2d`, primary text `#e7e8e3`, secondary text `#a1aaa9`, subtle border `#2e3638`, sand accent `#d8bb8c`, and mint live status `#a5c7a9`. Verify contrast in the final implementation; these are source colors, not proof that every small text pair passes accessibility checks. Current code uses Manrope for headings, DM Sans for UI copy, and Georgia sparingly for italic emphasis. Nova (only) is currently a rigged-GLTF prototype slot: `public/models/nova/nova.glb` (labelled placeholder) replaces the procedural figure when it loads, and any approved replacement asset must match this palette-adjacent, office-appropriate art direction and keep redistribution terms documented.

## Information hierarchy

1. Project name, saved state, active stage, and the user's next action.
2. Nova's latest question or a required approval, with a clear answer/revise control.
3. The office scene, showing each agent's actual status and latest short update.
4. A compact progress panel and named deliverables with open/preview/download actions.
5. Full task history and technical detail on demand.

Do not let the illustration crowd out the question, the deliverable list, or errors. On narrow screens, stack the controls and provide a textual agent/status list; the office should not be required to operate the product.

## 3D office states

| State | Character pose / location | Bubble copy source |
| --- | --- | --- |
| Ready | Standing by assigned station | Saved task/discovery stage |
| Discovery request | Nova moves toward the meeting table | Current question preparation operation |
| Research request | Nova moves toward the meeting table | Current authorized search operation |
| Design request | Mira moves toward the board | Current task operation |
| Build request | Atlas moves toward the computer | Current website or task operation |
| Review request | Echo moves toward the table | Current task operation |
| Awaiting user review | Standing by station | Saved draft ready for review |
| Retry delay / failure | Standing by station, visible status | Waiting for next model or retryable task |

Walking happens only when an actual server operation starts or ends; work gestures run only while it is active. A queued, delayed, failed, or completed job remains still. Motion preferences suppress walking and gestures while preserving names, status, and actions in text.

## Bubbles and interaction

- Place one short bubble near each agent, anchored to its 3D position. Keep full details in the inspector/activity panel; on narrow screens bubbles collapse to names and the roster retains state text.
- Show short public descriptions such as “Clarifying your goals…” or “Sketching user flows…”. Animated dots signal pending processing only. Never stream or store hidden chain-of-thought as a bubble.
- User can select an agent to see assignment, latest verified update, current stage, and linked deliverable. Bubble text should derive from the same saved event as the inspector, so the two cannot disagree.
- Long requests show elapsed time, current attempt/model if known, next retry delay, and a visible failure/retry state. Do not show a fabricated percentage when progress is unknown.

## UI components

Use a single clear primary action per stage, small status badges with text plus color, accessible form labels and focus rings, approval/revise controls close to the artifact they affect, and error messages that state what was saved and the next available action. Deliverables show type, version, approval state, updated time, and a direct open button. Provide loading placeholders only when content is genuinely loading; don't hide saved work behind long animations.

## Design anti-patterns to check, not universal bans

The supplied visual reference calls out common template cues. Avoid decorative gradients, glowing orbs, neon accents, emoji used as primary navigation, generic three-card feature rows, arbitrary bento layouts, fake testimonials, oversized soft radii, and movement with no purpose when they weaken this particular design. Icons, modest hover feedback, a restrained gradient, or a grid can still be used where they clarify a real function. Do not use the meme list as a mechanical lint rule. Privacy and terms become release requirements when the product is hosted or handles client data; a footer link with empty content is not enough.

## Review checklist

Check desktop and narrow layouts; keyboard access and visible focus; text contrast; reduced motion; agent state versus backend event; empty, loading, error, resumed, and approved states; long localized text; actual image assets when claimed; and full access to deliverables without interacting with the office scene.
