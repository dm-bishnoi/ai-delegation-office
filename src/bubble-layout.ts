// Deterministic bubble collision-avoidance for the office scene.
//
// Pure layout logic, intentionally tiny (no layout engine, no physics):
// 1. project each character's head anchor to intended screen-space rectangles
// 2. resolve overlaps in priority order (selected agent first, then roster
//    order), stepping vertically in fixed increments
// 3. clamp every bubble inside the office container
// 4. apply hysteresis: keep the previous offset when the change would be
//    smaller than `switchMargin` px, so placement never jitters frame to frame
//
// Anchors keep their exact projected point; only whole-bubble offsets move, so
// bubbles remain attached to their character. All coordinates are container
// pixels, matching how OfficeScene sets `left/top` with a
// `translate(-50%, -100%)` transform (rect = anchor minus width, minus height).

export type BubbleAnchor = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  hidden?: boolean;
};

export type BubblePlacement = {
  id: string;
  /** Horizontal container-space position for CSS `left` (the anchor point). */
  x: number;
  /** Vertical container-space position for CSS `top` (the anchor point). */
  y: number;
};

const STEP = 18;
const PADDING = 6;
/** Horizontal bias stays small so bubbles remain near their character. */
const MAX_STEPS = 6;

/** Screen-space rect for a bubble anchored at (x, y) with translate(-50%,-100%). */
export function bubbleRect(anchor: { x: number; y: number; width: number; height: number }, dx: number, dy: number) {
  const left = anchor.x + dx - anchor.width / 2;
  const top = anchor.y + dy - anchor.height;
  return { left, top, right: left + anchor.width, bottom: top + anchor.height };
}

function overlap(a: ReturnType<typeof bubbleRect>, b: ReturnType<typeof bubbleRect>) {
  return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

function clampOffsets(anchor: BubbleAnchor, dx: number, dy: number, viewport: { width: number; height: number }) {
  const rect = bubbleRect(anchor, dx, dy);
  let clampedDx = dx;
  if (rect.left < PADDING) clampedDx += PADDING - rect.left;
  if (rect.right > viewport.width - PADDING) clampedDx -= rect.right - (viewport.width - PADDING);
  let clampedDy = dy;
  if (rect.top < PADDING) clampedDy += PADDING - rect.top;
  // The bottom edge may grow down to just above the container; the bubble tail
  // still points at the character because the anchor stays fixed.
  if (rect.bottom > viewport.height - PADDING) clampedDy -= rect.bottom - (viewport.height - PADDING);
  return { dx: clampedDx, dy: clampedDy };
}

/**
 * Resolves bubble placements for one frame.
 * - `previous` maps id -> { dx, dy } from the last frame (stability/hysteresis).
 * - Selected bubbles are placed first and never displaced by others.
 * - Returns new placements and updates `previous` in place.
 */
export function resolveBubbleLayout(
  anchors: BubbleAnchor[],
  viewport: { width: number; height: number },
  previous: Map<string, { dx: number; dy: number }>,
): BubblePlacement[] {
  const placements: BubblePlacement[] = [];
  const placedRects: ReturnType<typeof bubbleRect>[] = [];
  const ordered = [...anchors.filter(a => !a.hidden)]
    .sort((a, b) => Number(b.selected) - Number(a.selected) || anchors.indexOf(a) - anchors.indexOf(b));
  for (const anchor of ordered) {
    const last = previous.get(anchor.id);
    // Stability first: reuse the previous offset whenever it is still valid
    // (collision-free and inside the viewport). This keeps bubbles from
    // flipping sides or drifting between frames; only a genuinely invalid
    // placement (new overlap or resize) triggers the re-sweep below.
    if (last) {
      const { dx, dy } = clampOffsets(anchor, last.dx, last.dy, viewport);
      const rect = bubbleRect(anchor, dx, dy);
      if (!placedRects.some(other => overlap(rect, other))) {
        previous.set(anchor.id, { dx, dy });
        placedRects.push(rect);
        placements.push({ id: anchor.id, x: anchor.x + dx, y: anchor.y + dy });
        continue;
      }
    }
    let best: { dx: number; dy: number; score: number } | null = null;
    // Deterministic candidate sweep: prefer the anchor position, then step
    // upward (bubbles naturally sit above heads), then sideways.
    for (let step = 0; step <= MAX_STEPS && !best; step++) {
      const candidates: Array<[number, number]> = step === 0
        ? [[0, 0]]
        : [
          [0, -step * STEP],
          [-step * STEP, -step * STEP],
          [step * STEP, -step * STEP],
          [-step * STEP, 0],
          [step * STEP, 0],
          [0, step * STEP],
        ];
      for (const [rawDx, rawDy] of candidates) {
        const { dx, dy } = clampOffsets(anchor, rawDx, rawDy, viewport);
        const rect = bubbleRect(anchor, dx, dy);
        if (placedRects.some(other => overlap(rect, other))) continue;
        // Minimal total displacement wins; ties break deterministically by
        // candidate order (up, then diagonals, then sides, then down).
        const distance = Math.abs(dx) + Math.abs(dy);
        if (!best || distance < best.score) best = { dx, dy, score: distance };
        if (distance === 0) break;
      }
    }
    const chosen = best ?? clampOffsets(anchor, 0, 0, viewport);
    previous.set(anchor.id, { dx: chosen.dx, dy: chosen.dy });
    placedRects.push(bubbleRect(anchor, chosen.dx, chosen.dy));
    placements.push({ id: anchor.id, x: anchor.x + chosen.dx, y: anchor.y + chosen.dy });
  }
  // Preserve input order in the result for stable rendering.
  return anchors.map(anchor => {
    const placement = placements.find(item => item.id === anchor.id);
    return placement ?? { id: anchor.id, x: anchor.x, y: anchor.y };
  });
}
