// NovaCharacter — one rigged GLTF/GLB character instance for Nova only.
//
// Responsibilities (kept deliberately small):
// - load a GLB from a configurable URL (default `models/nova/nova.glb`, relative
//   so it works under both the Vite dev server and the built `/dist` app)
// - create an AnimationMixer, normalize clip names, and expose `setState`
// - auto-fit the character to the office's ~1.9m human scale and floor (y = 0)
// - expose a selectable root group and a head anchor for the speech bubble
// - dispose everything it created
//
// If loading fails, callers in `src/OfficeScene.tsx` fall back to the existing
// procedural Nova; this module never throws into the render loop.

import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveClip, rigMotion } from './nova-animation';

/** Where to find the Nova model. Override via `VITE_NOVA_MODEL_URL` if needed. */
export const NOVA_MODEL_URL: string =
  (import.meta.env?.VITE_NOVA_MODEL_URL as string | undefined) || 'models/nova/nova.glb';

/** Target eye height in office units; the procedural figures are ~1.9m tall. */
export const NOVA_TARGET_HEIGHT = 1.9;

export type NovaCharacterState = {
  status: 'working' | 'waiting' | 'review' | 'done' | 'failed' | 'ready';
  walking: boolean;
  reducedMotion: boolean;
};

type Bounds = { min: T.Vector3; max: T.Vector3 };

export class NovaCharacter {
  readonly root = new T.Group();
  readonly name = 'NovaCharacter';

  private mixer: T.AnimationMixer | null = null;
  private actions = new Map<string, T.AnimationAction>();
  private active: T.AnimationAction | null = null;
  private activeName: string | null = null;
  private anchor: T.Object3D;
  private disposeHooks: (() => void)[] = [];
  private bounds: Bounds | null = null;

  private constructor(model: T.Object3D, clips: T.AnimationClip[], private modelUrl: string) {
    this.root.add(model);
    this.root.name = this.name;
    this.bounds = computeBounds(model);
    fitCharacter(model, this.bounds, NOVA_TARGET_HEIGHT);
    // Head/upper-body anchor for the speech bubble; follows the character in world space.
    this.anchor = new T.Object3D();
    this.anchor.name = 'nova-bubble-anchor';
    this.anchor.position.copy(bubbleAnchorLocal(this.bounds));
    this.root.add(this.anchor);
    if (clips.length) {
      this.mixer = new T.AnimationMixer(model);
      for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
  }

  /** Loads and prepares the Nova model; rejects if the asset is missing or unusable. */
  static async load(url = NOVA_MODEL_URL): Promise<NovaCharacter> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene ?? gltf.scenes?.[0];
    if (!scene) throw new Error('Nova model has no scene.');
    scene.traverse(object => {
      if (object instanceof T.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) object.frustumCulled = false;
      }
    });
    return new NovaCharacter(scene, gltf.animations ?? [], url);
  }

  /** True when the model carries at least one playable animation clip. */
  get animated(): boolean {
    return this.actions.size > 0;
  }

  /** World-space bubble anchor into `target`; matches the procedural figure's ~2.3 head height. */
  bubbleWorldPosition(target: T.Vector3): T.Vector3 {
    return this.anchor.getWorldPosition(target);
  }

  /** Selectable root for raycasting; delegates to the model subtree. */
  get raycastRoot(): T.Object3D {
    return this.root;
  }

  setState(state: NovaCharacterState): void {
    if (!this.mixer) return;
    const motion = rigMotion(state);
    const desired = resolveClip(motion.clip, [...this.actions.keys()], 'idle');
    const action = this.actions.get(desired) ?? this.actions.get('idle') ?? firstValue(this.actions);
    if (!action) return;
    if (this.active === action) {
      // Already playing this clip; keep it (looping) without restarting.
      action.paused = false;
      return;
    }
    action.reset();
    action.setLoop(motion.loop ? T.LoopRepeat : T.LoopOnce, Infinity);
    action.clampWhenFinished = !motion.loop;
    action.enabled = true;
    action.fadeIn(motion.fade);
    this.active?.fadeOut(motion.fade);
    action.play();
    this.active = action;
    this.activeName = desired;
  }

  /** Called each frame from the office render loop with the real frame delta. */
  update(delta: number): void {
    this.mixer?.update(delta);
  }

  /** Stops all mixer activity and frees GPU resources owned by this character. */
  dispose(): void {
    for (const hook of this.disposeHooks) hook();
    this.disposeHooks = [];
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions.clear();
    this.root.traverse(object => {
      if (object instanceof T.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof T.Texture) value.dispose();
          }
          material.dispose();
        }
      }
    });
    this.root.removeFromParent();
  }

  /** Diagnostics only; not user-facing. */
  describe(): string {
    return `NovaCharacter(url=${this.modelUrl}, active=${this.activeName ?? 'none'}, clips=[${[...this.actions.keys()].join(', ')}])`;
  }
}

function firstValue(actions: Map<string, T.AnimationAction>): T.AnimationAction | undefined {
  for (const action of actions.values()) return action;
  return undefined;
}

function computeBounds(model: T.Object3D): Bounds {
  const box = new T.Box3().setFromObject(model);
  return { min: box.min.clone(), max: box.max.clone() };
}

/** Uniformly scales and grounds the model so feet touch the floor (y = 0). */
function fitCharacter(model: T.Object3D, bounds: Bounds, targetHeight: number): void {
  const rawHeight = bounds.max.y - bounds.min.y;
  if (rawHeight > 0) {
    const scale = targetHeight / rawHeight;
    model.scale.setScalar(scale);
  }
  model.position.x -= (bounds.min.x + bounds.max.x) / 2 * model.scale.x;
  model.position.z -= (bounds.min.z + bounds.max.z) / 2 * model.scale.z;
  model.position.y -= bounds.min.y * model.scale.y;
  model.updateMatrixWorld(true);
}

/** Local anchor height for the speech bubble: head top of the normalized figure. */
function bubbleAnchorLocal(_bounds: Bounds): T.Vector3 {
  // fitCharacter() always normalizes total height to NOVA_TARGET_HEIGHT, so the
  // anchor can be expressed in final units regardless of the source asset.
  return new T.Vector3(0, NOVA_TARGET_HEIGHT * .95, 0);
}
