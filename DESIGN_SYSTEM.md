# Relay Office design system

Status: illustrated 2D office implemented in `src/OfficeScene.tsx` and `src/styles.css`; the reference mockup remains a direction, not a claim of exact visual fidelity. Browser-level visual review remains useful.

## Visual character

A calm, professional project workspace with a small, charming 2D illustrated office at its center. The office makes the team's activity easy to read; the actual research, requirements, approvals, and saved files remain first-class UI. Use a straight-on side view with adult cartoon characters, simple outlines, restrained gestures, legible work surfaces, and no 3D/isometric camera. Characters should be recognizably working, not decorative pawn markers.

Keep the existing dark foundation as a starting point: page `#0c1015`, sidebar `#11161b`, panel `#171e22`, card `#202a2d`, primary text `#e7e8e3`, secondary text `#a1aaa9`, subtle border `#2e3638`, sand accent `#d8bb8c`, and mint live status `#a5c7a9`. Verify contrast in the final implementation; these are source colors, not proof that every small text pair passes accessibility checks. Current code uses Manrope for headings, DM Sans for UI copy, and Georgia sparingly for italic emphasis.

## Information hierarchy

1. Project name, saved state, active stage, and the user's next action.
2. Nova's latest question or a required approval, with a clear answer/revise control.
3. The office scene, showing each agent's actual status and latest short update.
4. A compact progress panel and named deliverables with open/preview/download actions.
5. Full task history and technical detail on demand.

Do not let the illustration crowd out the question, the deliverable list, or errors. On narrow screens, stack the controls and provide a textual agent/status list; the office should not be required to operate the product.

## 2D office states

| State | Character pose / location | Bubble copy source |
| --- | --- | --- |
| Waiting | Relaxed at desk | “Ready for your brief” from saved stage |
| Discovering | Nova interviews at meeting table | Latest user-facing question |
| Researching | Research role compares sources at desk | Real search/job event and count |
| Designing | Mira sketches at whiteboard | Current design artifact/stage |
| Building | Atlas types at monitor | Actual build job and checkpoint |
| Reviewing | Echo marks up a document | Review artifact or issue count |
| Awaiting approval | Agent pauses beside completed work | “Ready for your review” |
| Paused / failed | Seated or stopped, visible alert | Accurate reason and Retry/Resume action |

Use a small number of purposeful movement transitions between locations when state changes. An idle animation may breathe or blink; it must not make a failed or queued agent look productive. Motion preferences should suppress movement while preserving names, status, and actions in text.

## Bubbles and interaction

- Place one short bubble near each active agent, with an anchored tail, a status indicator, and no overlap with faces or important work surfaces. Keep full details in the inspector/activity panel.
- Show short public descriptions such as “Clarifying your goals…” or “Sketching user flows…”. Animated dots signal pending processing only. Never stream or store hidden chain-of-thought as a bubble.
- User can select an agent to see assignment, latest verified update, current stage, and linked deliverable. Bubble text should derive from the same saved event as the inspector, so the two cannot disagree.
- Long requests show elapsed time, current attempt/model if known, next retry delay, and a visible failure/retry state. Do not show a fabricated percentage when progress is unknown.

## UI components

Use a single clear primary action per stage, small status badges with text plus color, accessible form labels and focus rings, approval/revise controls close to the artifact they affect, and error messages that state what was saved and the next available action. Deliverables show type, version, approval state, updated time, and a direct open button. Provide loading placeholders only when content is genuinely loading; don't hide saved work behind long animations.

## Design anti-patterns to check, not universal bans

The supplied visual reference calls out common template cues. Avoid decorative gradients, glowing orbs, neon accents, emoji used as primary navigation, generic three-card feature rows, arbitrary bento layouts, fake testimonials, oversized soft radii, and movement with no purpose when they weaken this particular design. Icons, modest hover feedback, a restrained gradient, or a grid can still be used where they clarify a real function. Do not use the meme list as a mechanical lint rule. Privacy and terms become release requirements when the product is hosted or handles client data; a footer link with empty content is not enough.

## Review checklist

Check desktop and narrow layouts; keyboard access and visible focus; text contrast; reduced motion; agent state versus backend event; empty, loading, error, resumed, and approved states; long localized text; actual image assets when claimed; and full access to deliverables without interacting with the office scene.
