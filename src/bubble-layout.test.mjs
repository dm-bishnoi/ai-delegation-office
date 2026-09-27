import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleRect, resolveBubbleLayout } from './bubble-layout.ts';

const anchor = (id, x, y, width = 120, height = 44, selected = false) =>
  ({ id, x, y, width, height, selected });
const layout = (anchors, width = 800, height = 450) => {
  const previous = new Map();
  return resolveBubbleLayout(anchors, { width, height }, previous);
};

test('non-overlapping bubbles keep their exact anchor positions', () => {
  const [a, b] = layout([anchor('a', 200, 200), anchor('b', 600, 300)]);
  assert.deepEqual([a.x, a.y], [200, 200]);
  assert.deepEqual([b.x, b.y], [600, 300]);
});

test('overlapping bubbles separate deterministically and keep stable order', () => {
  const input = [anchor('a', 200, 200), anchor('b', 210, 205)];
  const first = layout(input);
  const second = layout(input); // same input, fresh state -> same result
  assert.deepEqual(first, second);
  const a = first.find(item => item.id === 'a');
  const b = first.find(item => item.id === 'b');
  assert.ok(a.x !== b.x || a.y !== b.y, 'bubbles must not share a placement');
  // The moved bubble stays anchored near its character (within a few steps).
  assert.ok(Math.abs(b.x - 210) <= 120 && Math.abs(b.y - 205) <= 120);
});

test('selected agent keeps the anchor position; others move away', () => {
  const [a, b] = layout([anchor('a', 200, 200, 120, 44, true), anchor('b', 205, 205)]);
  assert.deepEqual([a.x, a.y], [200, 200]); // selected stays put
  assert.ok(b.x !== 205 || b.y !== 205); // other yielded
});

test('placements clamp inside the viewport', () => {
  const [edge] = layout([anchor('edge', 790, 30, 155, 44)], 800, 450);
  const rect = bubbleRect({ x: edge.x, y: edge.y, width: 155, height: 44 }, 0, 0);
  assert.ok(rect.left >= 6 - 0.01 && rect.right <= 794 + 0.01, `left=${rect.left} right=${rect.right}`);
  assert.ok(rect.top >= 6 - 0.01, `top=${rect.top}`);
});

test('deep stacks still resolve without infinite loops and stay inside bounds', () => {
  const stack = [0, 1, 2, 3, 4].map(index => anchor(`s${index}`, 400 + index, 200 + index));
  const placements = layout(stack, 800, 450);
  assert.equal(placements.length, 5);
  const ids = new Set(placements.map(item => item.id));
  assert.equal(ids.size, 5); // all bubbles placed, none dropped
  for (const placement of placements) {
    const rect = bubbleRect({ x: placement.x, y: placement.y, width: 120, height: 44 }, 0, 0);
    assert.ok(rect.left >= 0 && rect.right <= 800 && rect.top >= 0 && rect.bottom <= 450);
  }
});

test('hidden bubbles are skipped and preserve input ordering in output', () => {
  const anchors = [anchor('a', 200, 200), { ...anchor('b', 205, 205), hidden: true }, anchor('c', 400, 200)];
  const placements = layout(anchors);
  assert.deepEqual(placements.map(item => item.id), ['a', 'b', 'c']);
  const b = placements.find(item => item.id === 'b');
  assert.deepEqual([b.x, b.y], [205, 205]); // untouched
  const a = placements.find(item => item.id === 'a');
  assert.deepEqual([a.x, a.y], [200, 200]); // hidden neighbor did not push it
});

test('placements stay stable across consecutive frames when characters drift slightly', () => {
  const previous = new Map();
  const viewport = { width: 800, height: 450 };
  const frame1 = resolveBubbleLayout([anchor('a', 200, 200), anchor('b', 205, 205)], viewport, previous);
  const frame2 = resolveBubbleLayout([anchor('a', 200, 200), anchor('b', 215, 208)], viewport, previous);
  const a1 = frame1.find(item => item.id === 'a'), b1 = frame1.find(item => item.id === 'b');
  const a2 = frame2.find(item => item.id === 'a'), b2 = frame2.find(item => item.id === 'b');
  assert.deepEqual([a2.x, a2.y], [a1.x, a1.y]); // a did not jitter
  assert.deepEqual(previous.get('b'), previous.get('b')); // recorded
  // b kept the same offset (its anchor moved 10px right, 3px down; placement followed by exactly that).
  assert.deepEqual([b2.x - b1.x, b2.y - b1.y], [10, 3]);
});
