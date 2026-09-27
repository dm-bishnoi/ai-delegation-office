// Focused tests for Nova's rig animation-state mapping (src/nova-animation.ts).
// Pure logic only: they assert that animations follow the truthful application
// states and degrade safely, without any WebGL or model assets.

import test from 'node:test';
import assert from 'node:assert/strict';

import { rigMotion, resolveClip, clipAliases } from './nova-animation.ts';

test('working maps to the work clip only while Nova actually works', () => {
  const motion = rigMotion({ status: 'working', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'work');
  assert.equal(motion.loop, true);
});

test('walking maps to the walk clip and loops', () => {
  const motion = rigMotion({ status: 'working', walking: true, reducedMotion: false });
  assert.equal(motion.clip, 'walk');
  assert.equal(motion.loop, true);
});

test('waiting and retry delays never map to work', () => {
  const motion = rigMotion({ status: 'waiting', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'idle');
  assert.notEqual(motion.clip, 'work');
});

test('failed never maps to work and stays restrained on idle', () => {
  const motion = rigMotion({ status: 'failed', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'idle');
  assert.notEqual(motion.clip, 'work');
});

test('done uses a calm idle pose and never continues typing', () => {
  const motion = rigMotion({ status: 'done', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'idle');
  assert.notEqual(motion.clip, 'work');
});

test('review maps to the review clip, not to work', () => {
  const motion = rigMotion({ status: 'review', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'review');
  assert.notEqual(motion.clip, 'work');
});

test('ready (standing by) maps to idle', () => {
  const motion = rigMotion({ status: 'ready', walking: false, reducedMotion: false });
  assert.equal(motion.clip, 'idle');
});

test('reduced motion suppresses walking and work gestures in favor of stable idle', () => {
  const walkingWork = rigMotion({ status: 'working', walking: true, reducedMotion: true });
  assert.equal(walkingWork.clip, 'idle');
  const working = rigMotion({ status: 'working', walking: false, reducedMotion: true });
  assert.equal(working.clip, 'idle');
  const idleReady = rigMotion({ status: 'ready', walking: false, reducedMotion: true });
  assert.equal(idleReady.clip, 'idle');
});

test('missing animation clips fall back safely to idle', () => {
  const desired = rigMotion({ status: 'working', walking: false, reducedMotion: false }).clip;
  assert.equal(resolveClip(desired, [], 'idle'), 'idle');
  assert.equal(resolveClip('walk', ['Idle'], 'idle'), 'idle');
  assert.equal(resolveClip('work', ['Standing Idle'], 'idle'), 'idle');
});

test('unconventional but equivalent clip names resolve via aliases', () => {
  assert.equal(resolveClip('work', ['Typing'], 'idle'), 'Typing');
  assert.equal(resolveClip('idle', ['breathing_idle'], 'idle'), 'breathing_idle');
  assert.equal(resolveClip('walk', ['Fast Run'], 'idle'), 'Fast Run');
  assert.equal(resolveClip('review', ['Reading'], 'idle'), 'Reading');
  assert.equal(resolveClip('idle', ['Armature|idle'], 'idle'), 'Armature|idle');
});

test('exact clip names win over aliases and unknown names fall back', () => {
  assert.equal(resolveClip('work', ['work', 'Typing'], 'idle'), 'work');
  assert.equal(resolveClip('dance', ['idle'], 'idle'), 'idle');
});

test('alias tables only expose the four supported states', () => {
  assert.deepEqual(Object.keys(clipAliases).sort(), ['idle', 'review', 'walk', 'work']);
});
