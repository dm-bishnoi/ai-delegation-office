// Nova rig animation-state mapping.
//
// Pure logic only: it turns the truthful application states already produced by
// `agentView` (working | waiting | review | done | failed | ready) into a desired
// animation clip name plus how the clip should be played. It never invents a
// work state and it never runs timers; callers pass the real state each frame.

import type { AgentId } from './workflow';

export type RigStatus = 'working' | 'waiting' | 'review' | 'done' | 'failed' | 'ready';

export type RigMotion = {
  clip: string;
  loop: boolean;
  /** Cross-fade duration in seconds when switching clips. */
  fade: number;
};

export type RigMotionOptions = {
  /** Status from the existing truthful view mapping (`agentView`). */
  status: RigStatus;
  /** True only while Nova is actually moving between standing and work spots. */
  walking: boolean;
  /** Honors the existing `prefers-reduced-motion` product behavior. */
  reducedMotion: boolean;
};

/** Alias tables so differently-named but common clip names still resolve. */
export const clipAliases: Record<string, string[]> = {
  idle: ['idle', 'idle_normal', 'idle_breathing', 'breathing_idle', 'standing', 'stand', 'tpose', 't-pose', 'reference_pose', 'rest', 'armature|idle', 'mixamo.com'],
  walk: ['walk', 'walking', 'walking_forward', 'fast_run', 'jog', 'armature|walk', 'run'],
  work: ['work', 'working', 'typing', 'computer_work', 'desk_work', 'writing', 'read_write', 'armature|work', 'debugging', 'examine', 'search'],
  review: ['review', 'reviewing', 'read', 'reading', 'tablet', 'tablet_idle', 'clipboard', 'inspect', 'checking', 'armature|review', 'pointing'],
};

const states: Record<RigStatus, { clip: string; loop: boolean; fade: number }> = {
  working: { clip: 'work', loop: true, fade: .3 },
  review: { clip: 'review', loop: true, fade: .35 },
  waiting: { clip: 'idle', loop: true, fade: .3 },
  failed: { clip: 'idle', loop: true, fade: .3 },
  done: { clip: 'idle', loop: true, fade: .35 },
  ready: { clip: 'idle', loop: true, fade: .3 },
};

/** Maps a truthful Nova state to the desired rig motion. Never produces "work" off a real operation. */
export function rigMotion(options: RigMotionOptions): RigMotion {
  const { status, walking, reducedMotion } = options;
  if (reducedMotion && (walking || status === 'working')) return { clip: 'idle', loop: true, fade: .4 };
  if (walking) return { clip: 'walk', loop: true, fade: .25 };
  const state = states[status];
  if (reducedMotion) return { clip: 'idle', loop: true, fade: .4 };
  return { clip: state.clip, loop: state.loop, fade: state.fade };
}

/**
 * Resolves a desired clip name against the clips actually present on the rig,
 * first by exact match, then by alias, then by a shortened prefix. Returns the
 * matched clip name or `fallback` so a missing clip can never break the scene.
 */
export function resolveClip(desired: string, available: string[], fallback = 'idle'): string {
  const names = available.map(name => name.trim());
  if (names.includes(desired)) return desired;
  for (const alias of clipAliases[desired] ?? []) if (names.includes(alias)) return alias;
  const lower = names.map(name => name.toLowerCase());
  const wanted = desired.toLowerCase();
  const partial = lower.find(name => name.includes(wanted) || (clipAliases[wanted] ?? []).some(alias => name.includes(alias.toLowerCase())));
  return partial ? names[lower.indexOf(partial)] : fallback;
}

/** True when the agent whose rig is being animated owns the running operation (lead = Nova). */
export function isNovaAgent(id: AgentId): boolean {
  return id === 'lead';
}
