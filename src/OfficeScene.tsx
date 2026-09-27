import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { agents, type AgentId, type Workspace } from './workflow';
import { NovaCharacter } from './NovaCharacter';
import { resolveBubbleLayout, type BubbleAnchor } from './bubble-layout';

export type OfficeOperation = { type: 'website' | 'task' | 'discovery' | 'research'; projectId: string; agent?: AgentId; phase?: 'running' | 'waiting' } | null;
type Props = { workspace: Workspace; operation: OfficeOperation; selected: AgentId; onSelect: (id: AgentId) => void };
type Status = 'working' | 'waiting' | 'review' | 'done' | 'failed' | 'ready';
type View = { status: Status; message: string };
const ids: AgentId[] = ['lead', 'design', 'build', 'qa'];
// Desk footprints (from createRoom): a desk at (x,z) spans x±.83, z±.38.
// Standing clearance keeps characters ~0.15 out from the desk edge; workers at
// a monitored desk stand on the +Z side facing -Z (toward the screen).
const positions: Record<AgentId, { home: [number, number]; work: [number, number] }> = {
  lead: { home: [-3.3, .95], work: [-1.35, 1.2] }, design: { home: [2.35, -1.25], work: [2.6, -1.2] },
  build: { home: [-3.05, 2.35], work: [-3.05, 2.3] }, qa: { home: [3.15, 2.35], work: [1.35, 1.2] },
};
const verbs: Record<AgentId, string> = { lead: 'Interviewing', design: 'Designing', build: 'Building', qa: 'Reviewing' };
const idle: Record<AgentId, string> = { lead: 'Ready to discuss your idea', design: 'Waiting for approved requirements', build: 'Waiting for approved plans', qa: 'Waiting for a draft' };

export function agentView(id: AgentId, workspace: Workspace, operation: OfficeOperation): View {
  const task = workspace.tasks.find(item => item.owner === id && ['active', 'review', 'failed'].includes(item.status)) || workspace.tasks.find(item => item.owner === id && item.status === 'queued') || workspace.tasks.find(item => item.owner === id);
  const assigned = operation !== null && operation.projectId === workspace.id && ((operation.type === 'website' && id === 'build') || (operation.type === 'discovery' && id === 'lead') || ((operation.type === 'task' || operation.type === 'research') && operation.agent === id));
  if (assigned && operation?.phase === 'waiting') return { status: 'waiting', message: 'Waiting before the next model attempt' };
  if (assigned) return { status: 'working', message: operation?.type === 'website' ? 'Generating the website prototype' : operation?.type === 'discovery' ? 'Preparing project questions' : operation?.type === 'research' ? 'Checking available search results' : `${verbs[id]} · ${task?.title ?? 'current task'}` };
  if (id === 'lead' && workspace.discovery?.status !== 'approved' && workspace.discovery) return workspace.discovery.status === 'review' ? { status: 'review', message: 'Clarified brief ready for review' } : { status: 'ready', message: 'Answer the project questions to begin' };
  if (task?.status === 'review') return { status: 'review', message: 'Draft ready for your review' };
  if (task?.status === 'failed') return { status: 'failed', message: 'Task paused · retry available' };
  if (task?.status === 'active') return { status: 'waiting', message: 'Task interrupted · check the task board' };
  if (task?.status === 'done') return { status: 'done', message: task.requiresApproval ? 'Approved and saved' : 'Draft saved' };
  return { status: 'ready', message: idle[id] };
}

const mat = (color: number) => new T.MeshStandardMaterial({ color, roughness: .85 });
function block(parent: T.Object3D, size: [number, number, number], place: [number, number, number], color: number) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), mat(color)); mesh.position.set(...place);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function round(parent: T.Object3D, size: [number, number, number], place: [number, number, number], color: number) {
  const mesh = new T.Mesh(new T.SphereGeometry(1, 16, 12), mat(color)); mesh.position.set(...place); mesh.scale.set(...size);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function tube(parent: T.Object3D, from: [number, number, number], to: [number, number, number], radius: number, color: number) {
  const a = new T.Vector3(...from), b = new T.Vector3(...to), line = b.clone().sub(a);
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius * .88, line.length(), 10), mat(color));
  mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), line.normalize());
  mesh.castShadow = true; parent.add(mesh);
}
function desk(scene: T.Scene, x: number, z: number, monitor: boolean) {
  const group = new T.Group(); group.position.set(x, 0, z); scene.add(group);
  block(group, [1.65, .1, .76], [0, .82, 0], 0xc39a6f);
  for (const dx of [-.7, .7]) for (const dz of [-.28, .28]) block(group, [.075, .8, .075], [dx, .4, dz], 0x554739);
  if (monitor) {
    block(group, [.67, .44, .03], [0, 1.15, -.14], 0x243538);
    block(group, [.59, .36, .008], [0, 1.15, -.115], 0x1c3940);
    for (let i = 0; i < 3; i++) block(group, [.36 - i * .05, .015, .012], [-.04, 1.24 - i * .08, -.105], i === 0 ? 0xc79870 : 0x8ab3a6);
    block(group, [.42, .02, .17], [0, .88, .19], 0x42504a);
  } else block(group, [.38, .012, .25], [.11, .89, .02], 0xece2cc);
}
function display(scene: T.Scene, x: number, width: number, wire: boolean) {
  block(scene, [width, 1.22, .09], [x, 1.8, -3.46], 0x685946);
  block(scene, [width - .13, 1.08, .11], [x, 1.8, -3.4], 0xe9dcc3);
  if (wire) for (let i = 0; i < 3; i++) {
    const xx = x + (i - 1) * .62;
    block(scene, [.44, .7, .012], [xx, 1.75, -3.33], 0xf6eddb);
    block(scene, [.35, .08, .018], [xx, 2.02, -3.32], 0x9db8ad);
    block(scene, [.31, .015, .02], [xx, 1.69, -3.32], 0x899b92);
  } else for (let i = 0; i < 3; i++) block(scene, [.9, .035, .013], [x, 2.04 - i * .23, -3.32], i === 0 ? 0xb48a65 : 0x879e91);
}
function plant(scene: T.Scene, x: number, z: number) {
  block(scene, [.32, .36, .32], [x, .21, z], 0x946c50);
  tube(scene, [x, .4, z], [x, 1.13, z], .03, 0x465e48);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7;
    round(scene, [.11, .22, .14], [x + Math.cos(angle) * .19, .85 + i % 3 * .09, z + Math.sin(angle) * .19], i % 2 ? 0x618268 : 0x7c9b78);
  }
}
type Human = { root: T.Group; head: T.Group; arms: T.Group[]; legs: T.Group[] };
function person(id: AgentId): Human {
  const root = new T.Group(), head = new T.Group(), arms: T.Group[] = [], legs: T.Group[] = [];
  const skin = { lead: 0xbd8766, design: 0xe0ae8b, build: 0xa66d50, qa: 0xd9ab81 }[id];
  const top = { lead: 0x416f61, design: 0x303e42, build: 0x41647c, qa: 0xe8dcc3 }[id];
  const hair = { lead: 0x302924, design: 0x39291f, build: 0x2b2623, qa: 0x554136 }[id];
  round(root, [.3, .4, .24], [0, 1.19, 0], top);
  block(root, [.48, .12, .32], [0, .81, 0], 0x303a3a);
  head.position.y = 1.66; root.add(head);
  round(head, [.24, .29, .22], [0, 0, 0], skin);
  round(head, [.245, .13, .22], [0, .21, -.012], hair);
  if (id === 'design' || id === 'lead') round(head, [.12, .15, .13], [.21, .15, -.12], hair);
  if (id === 'build') for (let i = 0; i < 5; i++) round(head, [.078, .075, .08], [(i - 2) * .09, .25, .02], hair);
  for (const x of [-.09, .09]) round(head, [.012, .017, .011], [x, -.015, .211], 0x2b2825);
  tube(head, [-.04, -.14, .214], [.05, -.14, .214], .008, 0x7d5346);
  if (id === 'lead' || id === 'qa') {
    for (const x of [-.09, .09]) { const lens = new T.Mesh(new T.TorusGeometry(.055, .008, 5, 14), mat(0x39322a)); lens.position.set(x, -.018, .218); head.add(lens); }
    tube(head, [-.03, -.018, .22], [.03, -.018, .22], .007, 0x39322a);
  }
  for (const direction of [-1, 1]) {
    const arm = new T.Group(); arm.position.set(direction * .3, 1.44, 0);
    tube(arm, [0, 0, 0], [direction * .09, -.43, .05], .079, top);
    round(arm, [.06, .085, .06], [direction * .09, -.48, .05], skin); root.add(arm); arms.push(arm);
    const leg = new T.Group(); leg.position.set(direction * .14, .8, 0);
    tube(leg, [0, 0, 0], [0, -.64, 0], .112, 0x313c3e);
    round(leg, [.15, .065, .2], [0, -.68, .06], 0xe7d9c5); root.add(leg); legs.push(leg);
  }
  root.position.set(positions[id].home[0], 0, positions[id].home[1]);
  return { root, head, arms, legs };
}
function createRoom() {
  const scene = new T.Scene(); scene.background = new T.Color(0x141c1d);
  scene.add(new T.HemisphereLight(0xf8e8ce, 0x303e37, 2.3));
  const sun = new T.DirectionalLight(0xffe7bc, 2.2); sun.position.set(-2, 8, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8; scene.add(sun);
  block(scene, [11.2, .23, 7.1], [0, -.19, 0], 0x686f61);
  block(scene, [11.4, .22, 7.3], [0, -.35, 0], 0x29322c);
  block(scene, [11.2, 2.9, .12], [0, 1.37, -3.58], 0x333a34);
  block(scene, [.12, 2.9, 7], [-5.6, 1.37, 0], 0x2b322e);
  block(scene, [2.5, 1.05, .08], [-1.3, 1.88, -3.47], 0x7c907a);
  display(scene, 2.65, 2.15, true); display(scene, -4, 1.45, false);
  desk(scene, -3.2, -.65, false); desk(scene, 3, -.65, false);
  desk(scene, -3.25, 1.55, true); desk(scene, 3.2, 1.55, false);
  const table = new T.Mesh(new T.CylinderGeometry(.76, .76, .09, 28), mat(0xc99b69)); table.position.set(0, .72, .3); table.castShadow = true; scene.add(table);
  block(scene, [.18, .68, .18], [0, .35, .3], 0x5e4c39);
  block(scene, [3.95, .015, 2.8], [0, -.05, .9], 0x7b7767);
  for (const [x, z] of [[-4.95, -2.95], [4.8, -2.85], [4.9, 2.9]] as const) plant(scene, x, z);
  const humans = Object.fromEntries(ids.map(id => { const human = person(id); scene.add(human.root); return [id, human]; })) as Record<AgentId, Human>;
  return { scene, humans };
}

export default function OfficeScene({ workspace, operation, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bubbles = useRef<Record<AgentId, HTMLButtonElement | null>>({ lead: null, design: null, build: null, qa: null });
  const current = useRef({ workspace, operation, onSelect, selectedAgent: selected as AgentId }); current.current = { workspace, operation, onSelect, selectedAgent: selected as AgentId };
  const [unavailable, setUnavailable] = useState(false);
  const views = Object.fromEntries(ids.map(id => [id, agentView(id, workspace, operation)])) as Record<AgentId, View>;

  useEffect(() => {
    const element = host.current; if (!element) return;
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }); }
    catch { setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement);
    const { scene, humans } = createRoom();
    // Nova rigged-character prototype: lazily load the GLB character for Nova only.
    // On any failure the existing procedural Nova stays visible and selectable.
    let rig: NovaCharacter | null = null;
    let disposed = false;
    NovaCharacter.load().then(character => {
      if (disposed) { character.dispose(); return; }
      rig = character;
      character.root.position.copy(humans.lead.root.position);
      character.root.rotation.copy(humans.lead.root.rotation);
      scene.add(character.root);
      humans.lead.root.visible = false;
      if (import.meta.env.DEV) console.info(`Nova character loaded: ${character.describe()}`);
    }).catch(() => {
      if (!disposed && import.meta.env.DEV) console.warn('Nova GLB could not be loaded; using the procedural figure instead.');
    });
    const camera = new T.PerspectiveCamera(43, 1, .1, 60);
    camera.position.set(8.3, 8, 11.8); camera.lookAt(0, .85, 0);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .85, 0);
    controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 10; controls.maxDistance = 23;
    controls.minPolarAngle = .47; controls.maxPolarAngle = 1.29; controls.update();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return;
      camera.aspect = element.clientWidth / element.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight, false);
    }); observer.observe(element);
    const ray = new T.Raycaster(), cursor = new T.Vector2(), projected = new T.Vector3();
    function selectAt(event: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      cursor.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(cursor, camera);
      const rootFor = (id: AgentId) => id === 'lead' && rig ? rig.raycastRoot : humans[id].root;
      const hits = ray.intersectObjects(ids.map(rootFor), true);
      for (const hit of hits) { const id = ids.find(agent => rootFor(agent).getObjectById(hit.object.id)); if (id) { current.current.onSelect(id); break; } }
    }
    function contextLost(event: Event) { event.preventDefault(); setUnavailable(true); }
    renderer.domElement.addEventListener('click', selectAt); renderer.domElement.addEventListener('webglcontextlost', contextLost);
    let frame = 0, previous = 0;
    const layoutCache = new Map<string, { dx: number; dy: number }>();
    let lastViewport = { width: 0, height: 0 };
    function animate(time: number) {
      frame = requestAnimationFrame(animate);
      if (document.hidden || time - previous < 32) return;
      const delta = Math.min((time - previous) / 1000, .07); previous = time;
      controls.update();
      for (const id of ids) {
        const human = humans[id], status = agentView(id, current.current.workspace, current.current.operation).status;
        const target = positions[id][status === 'working' ? 'work' : 'home'];
        const character = id === 'lead' ? rig : null;
        const body = character ? character.root : human.root;
        const distance = Math.hypot(body.position.x - target[0], body.position.z - target[1]);
        const walking = !reduced.matches && distance > .045;
        if (walking) {
          const fraction = Math.min(1, delta * 2.3 / distance);
          body.position.x += (target[0] - body.position.x) * fraction;
          body.position.z += (target[1] - body.position.z) * fraction;
          body.rotation.y = Math.atan2(target[0] - body.position.x, target[1] - body.position.z);
        } else {
          body.position.x = target[0]; body.position.z = target[1];
          // Desk workers face their screens (-Z); table workers face the table;
          // home stances face the room. Angles = atan2 toward the focal point.
          const angle = id === 'design' || id === 'build' ? Math.PI : id === 'qa' ? -2.1 : id === 'lead' && status === 'working' ? 2.2 : -.35;
          body.rotation.y = reduced.matches ? angle : body.rotation.y + (angle - body.rotation.y) * Math.min(1, delta * 4);
        }
        if (character) {
          character.setState({ status, walking, reducedMotion: reduced.matches });
          character.update(delta);
        } else {
          const phase = time / 180 + ids.indexOf(id);
          human.legs[0].rotation.x = walking ? Math.sin(phase) * .4 : 0;
          human.legs[1].rotation.x = walking ? -Math.sin(phase) * .4 : 0;
          human.arms[0].rotation.x = walking ? -Math.sin(phase) * .3 : status === 'working' && !reduced.matches ? -.13 + Math.sin(phase) * .13 : 0;
          human.arms[1].rotation.x = walking ? Math.sin(phase) * .3 : status === 'working' && !reduced.matches ? -.13 - Math.sin(phase) * .13 : 0;
          human.head.rotation.z = status === 'working' && !reduced.matches ? Math.sin(phase * .2) * .026 : 0;
          human.root.position.y = walking ? Math.abs(Math.sin(phase)) * .035 : 0;
        }
      }
      // Bubble collision avoidance: project all anchors, resolve overlaps in
      // one deterministic pass, then apply. Kept after the movement loop so a
      // single DOM write per bubble per frame (offsets are stable frame to
      // frame; hysteresis prevents flicker).
      const viewport = { width: element!.clientWidth, height: element!.clientHeight };
      if (viewport.width && viewport.height) {
        if (viewport.width !== lastViewport.width || viewport.height !== lastViewport.height) {
          lastViewport = viewport;
          layoutCache.clear(); // container resized: recompute from scratch
        }
        const anchors: BubbleAnchor[] = [];
        for (const id of ids) {
          const bubble = bubbles.current[id];
          if (!bubble) continue;
          const human = humans[id];
          const character = id === 'lead' ? rig : null;
          if (character) character.bubbleWorldPosition(projected); else projected.set(human.root.position.x, 2.3, human.root.position.z);
          projected.project(camera);
          const offScreen = Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1;
          const rect = bubble.getBoundingClientRect();
          anchors.push({
            id, x: (projected.x + 1) * viewport.width / 2, y: (1 - projected.y) * viewport.height / 2,
            width: rect.width, height: rect.height, selected: id === current.current.selectedAgent, hidden: offScreen,
          });
        }
        for (const placement of resolveBubbleLayout(anchors, viewport, layoutCache)) {
          const bubble = bubbles.current[placement.id as AgentId];
          if (!bubble) continue;
          bubble.style.left = `${placement.x}px`;
          bubble.style.top = `${placement.y}px`;
          const anchor = anchors.find(item => item.id === placement.id);
          bubble.style.visibility = anchor?.hidden ? 'hidden' : 'visible';
        }
      }
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true; rig?.dispose();
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('click', selectAt); renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      scene.traverse(object => { if (object instanceof T.Mesh) { object.geometry.dispose(); const all = Array.isArray(object.material) ? object.material : [object.material]; all.forEach(item => item.dispose()); } });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div className="office-3d" aria-label="Interactive 3D office reflecting saved task states">
    <div className="office-3d-render" ref={host} aria-hidden="true" />
    {!unavailable && <><span className="office-3d-hint">DRAG TO ORBIT · SCROLL TO ZOOM</span>{agents.map(agent => <button key={agent.id} type="button" className={`office-3d-bubble ${views[agent.id].status} ${selected === agent.id ? 'selected' : ''}`} ref={node => { bubbles.current[agent.id] = node; }} onClick={() => onSelect(agent.id)} aria-label={`Inspect ${agent.name}: ${views[agent.id].message}`}><strong>{agent.name}</strong><span>{views[agent.id].message}</span></button>)}</>}
    {unavailable && <div className="office-3d-fallback"><strong>3D view unavailable on this device.</strong><span>Use the task board and agent list to follow progress.</span></div>}
    <div className="office-3d-roster" aria-label="Select an agent">{agents.map(agent => <button key={agent.id} type="button" className={selected === agent.id ? 'selected' : ''} onClick={() => onSelect(agent.id)} aria-pressed={selected === agent.id}><span className={`roster-dot ${views[agent.id].status}`} />{agent.name}<small>{views[agent.id].status === 'ready' ? 'standing by' : views[agent.id].status}</small></button>)}</div>
  </div>;
}
