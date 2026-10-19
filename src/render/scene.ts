import * as THREE from 'three';
import { BALL_SPEC } from '../physics/bodies';
import type { SurfaceId, Vec3 } from '../physics/types';
import { FIELD_EXTENSION, FIELD_HALF_WIDTH, SURFACE_BANDS } from '../world/field';
import { createScenery, HORIZON_COLOR } from '../world/scenery';

const BALL_RADIUS = BALL_SPEC.radius;
const SUN_DIRECTION = new THREE.Vector3(-40, 80, 30); // hacia el sol; también orienta la sombra

// Mancha suave y oscura, transparente en el borde.
function createShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const SURFACE_COLORS: Record<SurfaceId, number> = {
  fairway: 0x3f9b3a,
  rough: 0x2b6e2b,
  sand: 0xdcc88a,
};

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh;
  setAimPreview(points: Vec3[] | null): void; // línea del inicio de la trayectoria de un golpe perfecto; null la oculta
  setTrace(points: Vec3[]): void; // traza del tiro anterior
  updateShadow(ballPosition: Vec3): void; // sombra del balón en el suelo
  render(): void;
}

function createBallTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#222222';
  // Parches oscuros a posiciones fijas para que el giro del balón sea visible.
  const patches: Array<[number, number]> = [
    [0.1, 0.25], [0.35, 0.25], [0.6, 0.25], [0.85, 0.25],
    [0.22, 0.6], [0.47, 0.6], [0.72, 0.6], [0.97, 0.6],
    [0.1, 0.9], [0.5, 0.9], [0.85, 0.9],
  ];
  for (const [u, v] of patches) {
    ctx.beginPath();
    ctx.arc(u * size, v * size, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();
  // El cielo con degradado y el paisaje lejano los pone createScenery. La niebla
  // funde el suelo lejano con el color del horizonte.
  scene.fog = new THREE.Fog(HORIZON_COLOR, 600, 5000);
  createScenery(scene);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(SUN_DIRECTION);
  scene.add(sun);

  // Una franja de suelo por cada banda de superficie.
  SURFACE_BANDS.forEach((band, index) => {
    // La primera y la última franja se prolongan: la física las usa fuera del campo.
    const zStart = index === 0 ? band.zStart + FIELD_EXTENSION : band.zStart;
    const zEnd = index === SURFACE_BANDS.length - 1 ? band.zEnd - FIELD_EXTENSION : band.zEnd;
    const length = zStart - zEnd;
    const geometry = new THREE.PlaneGeometry(FIELD_HALF_WIDTH * 2, length);
    const material = new THREE.MeshLambertMaterial({ color: SURFACE_COLORS[band.surface] });
    const strip = new THREE.Mesh(geometry, material);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0, (zStart + zEnd) / 2);
    scene.add(strip);
  });

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
    new THREE.MeshLambertMaterial({ map: createBallTexture() }),
  );
  ball.position.set(0, BALL_RADIUS, 0);
  scene.add(ball);

  // Sombra del balón: cae en el suelo desplazada según la dirección del sol, así la
  // distancia entre balón y sombra deja ver la altura. Más tenue y grande con la altura.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: createShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);

  function updateShadow(ballPosition: Vec3): void {
    const height = Math.max(0, ballPosition.y - BALL_RADIUS);
    const toGround = ballPosition.y / SUN_DIRECTION.y; // cuánto avanza el rayo de sol hasta el suelo
    shadow.position.x = ballPosition.x + SUN_DIRECTION.x * -toGround;
    shadow.position.z = ballPosition.z + SUN_DIRECTION.z * -toGround;
    const size = BALL_RADIUS * 4 * (1 + 0.1 * height); // más grande que el balón para que se lea
    shadow.scale.set(size, size, 1);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 / (1 + 0.04 * height);
  }
  updateShadow({ x: 0, y: BALL_RADIUS, z: 0 });

  // Vista previa del golpe: línea amarilla sólida (un tubo) que sigue el inicio de la
  // trayectoria de un golpe perfecto. Se ensancha con la distancia para compensar la
  // perspectiva y que no se afine hasta desaparecer.
  const PREVIEW_RADIUS_START = 0.07; // m
  const PREVIEW_RADIUS_GROWTH = 0.006; // m de radio extra por metro de recorrido
  const PREVIEW_SIDES = 8;
  const previewLine = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffe14d, fog: false }),
  );
  previewLine.frustumCulled = false;
  previewLine.visible = false;
  scene.add(previewLine);

  function setAimPreview(points: Vec3[] | null): void {
    if (!points || points.length < 2) {
      previewLine.visible = false;
      return;
    }
    const vertices: number[] = [];
    const indices: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    let travelled = 0;

    points.forEach((point, i) => {
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const tangent = new THREE.Vector3(after.x - before.x, after.y - before.y, after.z - before.z).normalize();
      // Ejes del anillo perpendiculares a la tangente.
      let normal = new THREE.Vector3().crossVectors(tangent, up);
      if (normal.lengthSq() < 1e-6) normal = new THREE.Vector3(1, 0, 0);
      normal.normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      if (i > 0) {
        const prev = points[i - 1];
        travelled += Math.hypot(point.x - prev.x, point.y - prev.y, point.z - prev.z);
      }
      const radius = PREVIEW_RADIUS_START + PREVIEW_RADIUS_GROWTH * travelled;
      for (let k = 0; k < PREVIEW_SIDES; k++) {
        const angle = (k / PREVIEW_SIDES) * Math.PI * 2;
        const c = Math.cos(angle) * radius;
        const sn = Math.sin(angle) * radius;
        vertices.push(
          point.x + normal.x * c + binormal.x * sn,
          point.y + normal.y * c + binormal.y * sn,
          point.z + normal.z * c + binormal.z * sn,
        );
      }
    });

    for (let i = 0; i < points.length - 1; i++) {
      for (let k = 0; k < PREVIEW_SIDES; k++) {
        const a0 = i * PREVIEW_SIDES + k;
        const a1 = i * PREVIEW_SIDES + ((k + 1) % PREVIEW_SIDES);
        const b0 = (i + 1) * PREVIEW_SIDES + k;
        const b1 = (i + 1) * PREVIEW_SIDES + ((k + 1) % PREVIEW_SIDES);
        indices.push(a0, b0, a1, a1, b0, b1);
      }
    }

    previewLine.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    previewLine.geometry = geometry;
    previewLine.material.side = THREE.DoubleSide;
    previewLine.visible = true;
  }

  // Traza del tiro anterior: una línea que queda en pantalla para comparar tiros.
  const traceLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x00e5ff }),
  );
  traceLine.frustumCulled = false;
  scene.add(traceLine);

  function setTrace(points: Vec3[]): void {
    traceLine.geometry.dispose();
    traceLine.geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
  }

  // La posición y la orientación de la cámara las maneja el bucle de juego.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    ball,
    setAimPreview,
    setTrace,
    updateShadow,
    render: () => renderer.render(scene, camera),
  };
}
