import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { agents, type AgentId, type Workspace } from './workflow';

interface Props {
  workspace: Workspace;
  selected: AgentId;
  onSelect: (agent: AgentId) => void;
}

const positions: [number, number][] = [[-2.5, -1.55], [2.5, -1.55], [-2.5, 1.55], [2.5, 1.55]];

export default function OfficeScene({ workspace, selected, onSelect }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const data = useRef({ workspace, selected, onSelect });
  data.current = { workspace, selected, onSelect };

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10171a');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const view = { azimuth: 0.6, elevation: 0.64, distance: 16 };
    function updateCamera() {
      camera.position.set(
        Math.sin(view.azimuth) * Math.cos(view.elevation) * view.distance,
        Math.sin(view.elevation) * view.distance,
        Math.cos(view.azimuth) * Math.cos(view.elevation) * view.distance,
      );
      camera.lookAt(0, 0.55, 0);
    }
    updateCamera();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      container.classList.add('scene-unavailable');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#dce9e4', '#3b4641', 2.2));
    const key = new THREE.DirectionalLight('#ffe6bc', 3.4);
    key.position.set(-4, 11, 7);
    scene.add(key);

    const material = (hex: string, roughness = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness });
    const floorMat = material('#46534f');
    const deskMat = material('#a78664');
    const metalMat = material('#262e30', 0.45);
    const monitorMat = new THREE.MeshStandardMaterial({ color: '#1c363b', emissive: '#214e52', emissiveIntensity: 0.6, roughness: 0.3 });
    const wallMat = material('#303b3a');
    const geometries: THREE.BufferGeometry[] = [];
    const textures: THREE.Texture[] = [];
    const box = (width: number, height: number, depth: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    };

    box(10.3, 0.28, 8.4, floorMat, 0, -0.16, 0);
    box(10.3, 2.5, 0.18, wallMat, 0, 1.12, -4.13);
    box(0.18, 2.5, 8.4, wallMat, -5.08, 1.12, 0);
    // Thin floor grid gives the scene scale without external textures.
    const grid = new THREE.GridHelper(10, 20, '#71847a', '#5b6961');
    grid.position.y = 0.002;
    scene.add(grid);
    box(3.0, 1.35, 0.08, material('#667777'), 0, 1.48, -4.0);
    box(1.0, 0.08, 0.32, deskMat, 3.7, 0.72, -3.72);
    box(0.42, 0.72, 0.42, material('#648674'), 3.85, 0.36, -3.65);
    box(1.5, 0.1, 0.6, deskMat, -3.8, 0.85, -3.73);
    // Shared review table: agents walk here when a deliverable needs approval.
    const tableGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.1, 32);
    geometries.push(tableGeometry);
    const table = new THREE.Mesh(tableGeometry, deskMat);
    table.position.set(0, 0.74, 0);
    scene.add(table);
    box(0.15, 0.7, 0.15, metalMat, 0, 0.36, 0);
    box(1.4, 0.04, 0.06, material('#c6ac80'), 0, 2.1, -4.0);

    const avatarMeshes: THREE.Group[] = [];
    const accentMaterials: THREE.MeshStandardMaterial[] = [];
    const haloMaterials: THREE.MeshBasicMaterial[] = [];
    agents.forEach((agent, index) => {
      const [x, z] = positions[index];
      const deskZ = z - 0.5;
      box(2.45, 0.13, 1.12, deskMat, x, 0.8, deskZ);
      for (const dx of [-1.03, 1.03]) {
        box(0.08, 0.75, 0.08, metalMat, x + dx, 0.4, deskZ - 0.42);
        box(0.08, 0.75, 0.08, metalMat, x + dx, 0.4, deskZ + 0.42);
      }
      box(0.72, 0.48, 0.06, monitorMat, x, 1.18, deskZ - 0.14);
      box(0.08, 0.18, 0.07, metalMat, x, 0.91, deskZ - 0.14);
      box(0.66, 0.04, 0.25, material('#333d3a'), x, 0.89, deskZ + 0.28);
      box(0.66, 0.08, 0.65, metalMat, x, 0.43, z + 0.44);
      box(0.65, 0.65, 0.09, metalMat, x, 0.72, z + 0.77);

      const group = new THREE.Group();
      group.position.set(x + 0.62, 0, z + 0.73);
      group.userData.agentId = agent.id;
      const accent = new THREE.MeshStandardMaterial({ color: agent.color, roughness: 0.7, emissive: agent.color, emissiveIntensity: 0 });
      accentMaterials.push(accent);
      const bodyGeometry = new THREE.CylinderGeometry(0.26, 0.36, 0.66, 16);
      geometries.push(bodyGeometry);
      const body = new THREE.Mesh(bodyGeometry, accent);
      body.position.y = 0.46;
      group.add(body);
      const headGeometry = new THREE.SphereGeometry(0.26, 18, 12);
      geometries.push(headGeometry);
      const head = new THREE.Mesh(headGeometry, material('#e6c9ad'));
      head.position.y = 0.99;
      group.add(head);
      const haloGeometry = new THREE.RingGeometry(0.38, 0.42, 32);
      geometries.push(haloGeometry);
      const haloMaterial = new THREE.MeshBasicMaterial({ color: agent.color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
      haloMaterials.push(haloMaterial);
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.02;
      group.add(halo);
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 256;
      labelCanvas.height = 64;
      const context = labelCanvas.getContext('2d');
      if (context) {
        context.fillStyle = '#162126';
        context.fillRect(0, 0, 256, 64);
        context.fillStyle = agent.color;
        context.fillRect(0, 0, 6, 64);
        context.fillStyle = '#f2eee4';
        context.font = 'bold 29px sans-serif';
        context.fillText(agent.name.toUpperCase(), 22, 42);
        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        textures.push(labelTexture);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
        label.position.y = 1.53;
        label.scale.set(1.55, 0.39, 1);
        group.add(label);
      }
      scene.add(group);
      avatarMeshes.push(group);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let drag: { x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    function pointerDown(event: PointerEvent) {
      drag = { x: event.clientX, y: event.clientY, moved: false };
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    }
    function pointerMove(event: PointerEvent) {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.moved) {
        view.azimuth -= dx * 0.006;
        view.elevation = THREE.MathUtils.clamp(view.elevation + dy * 0.005, 0.28, 1.22);
        updateCamera();
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
    function pointerUp() {
      suppressClick = Boolean(drag?.moved);
      window.setTimeout(() => { suppressClick = false; }, 0);
      drag = null;
      renderer.domElement.style.cursor = 'grab';
    }
    function zoom(event: WheelEvent) {
      event.preventDefault();
      view.distance = THREE.MathUtils.clamp(view.distance + event.deltaY * 0.014, 12, 25);
      updateCamera();
    }
    function selectAgent(event: MouseEvent) {
      if (suppressClick) { suppressClick = false; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(avatarMeshes, true);
      if (hits.length) {
        let object: THREE.Object3D | null = hits[0].object;
        while (object && !object.userData.agentId) object = object.parent;
        if (object?.userData.agentId) data.current.onSelect(object.userData.agentId as AgentId);
      }
    }
    renderer.domElement.addEventListener('click', selectAgent);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    renderer.domElement.addEventListener('wheel', zoom, { passive: false });
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    observer.observe(container);
    let frame = 0;
    const clock = new THREE.Clock();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function animate() {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      agents.forEach((agent, index) => {
        const task = data.current.workspace.tasks.find(item => item.owner === agent.id);
        const status = task?.status ?? 'queued';
        const [deskX, deskZ] = positions[index];
        const targetX = status === 'review' ? (index % 2 ? 1.15 : -1.15) : status === 'active' ? deskX : deskX + 0.62;
        const targetZ = status === 'review' ? (index < 2 ? -0.65 : 0.95) : status === 'active' ? deskZ + 0.33 : deskZ + 0.73;
        const avatar = avatarMeshes[index];
        const easing = reduceMotion ? 1 : Math.min(delta * 2.8, 1);
        avatar.position.x = THREE.MathUtils.lerp(avatar.position.x, targetX, easing);
        avatar.position.z = THREE.MathUtils.lerp(avatar.position.z, targetZ, easing);
        avatar.position.y = reduceMotion ? 0 : status === 'active' ? Math.sin(t * 3 + index) * 0.035 : Math.sin(t * 1.4 + index) * 0.01;
        const ring = haloMaterials[index];
        ring.color.set(status === 'failed' ? '#db8276' : status === 'review' ? '#c4a2e2' : status === 'active' ? '#e6c782' : agent.color);
        ring.opacity = status === 'active' && !reduceMotion ? 0.6 + Math.sin(t * 4) * 0.25 : 0.78;
        accentMaterials[index].emissiveIntensity = data.current.selected === agent.id ? 0.35 : status === 'active' ? 0.2 : 0;
      });
      renderer.render(scene, camera);
    }
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('click', selectAgent);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('wheel', zoom);
      container.removeChild(renderer.domElement);
      renderer.dispose();
      geometries.forEach(geometry => geometry.dispose());
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          mats.forEach(mat => mat.dispose());
        }
      });
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach(mat => mat.dispose());
      else grid.material.dispose();
      textures.forEach(texture => texture.dispose());
    };
  }, []);

  return <div className="office-canvas" ref={mount}><div className="scene-hint">DRAG TO ORBIT · SCROLL TO ZOOM</div><div className="scene-fallback">3D preview needs WebGL. The workspace controls remain available.</div></div>;
}
