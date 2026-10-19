import * as THREE from 'three';
import { BALL_SPEC } from '../physics/bodies';
import type { SurfaceId, Terrain, TerrainBounds, Vec3 } from '../physics/types';
import { FIELD_EXTENSION, FIELD_HALF_WIDTH, SURFACE_BANDS, surfaceAt } from '../world/field';
import { createScenery, HORIZON_COLOR } from '../world/scenery';
import { addContourLines, createReliefArrows } from './reliefAids';
import { FLAT_TERRAIN } from '../world/terrain';

const BALL_RADIUS = BALL_SPEC.radius;
// Hacia el sol: bajo y lateral, para que las laderas se vean claras u oscuras según su
// orientación y las lomas proyecten sombra.
const SUN_DIRECTION = new THREE.Vector3(-60, 45, 35);
// Dirección con la que se proyecta la mancha de sombra del balón: más vertical que el sol
// real para que la mancha no se aleje decenas de metros cuando el balón vuela alto.
const BALL_SHADOW_DIRECTION = new THREE.Vector3(-40, 80, 30);
const SHADOW_HALF_SIZE = 70; // m: la sombra proyectada cubre este radio alrededor del balón
const SHADOW_MAP_SIZE = 4096;

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

const GROUND_STEP = 2; // m entre vértices de la malla del terreno en pantalla
// Zona que se dibuja con malla cuando el terreno no tiene límites (FLAT_TERRAIN).
const DEFAULT_GROUND_BOUNDS: TerrainBounds = { minX: -200, maxX: 200, minZ: -360, maxZ: 120 };

// Malla del terreno: un vértice cada GROUND_STEP m muestreado de `terrain`, con normales
// suaves del propio terreno y color por superficie (según la franja de z).
function buildTerrainGeometry(terrain: Terrain, bounds: TerrainBounds): THREE.BufferGeometry {
  const nx = Math.floor((bounds.maxX - bounds.minX) / GROUND_STEP) + 1;
  const nz = Math.floor((bounds.maxZ - bounds.minZ) / GROUND_STEP) + 1;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const color = new THREE.Color();

  for (let j = 0; j < nz; j++) {
    const z = bounds.minZ + j * GROUND_STEP;
    color.setHex(SURFACE_COLORS[surfaceAt(z)]);
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * GROUND_STEP;
      const n = terrain.normalAt(x, z);
      const k = (j * nx + i) * 3;
      positions.set([x, terrain.heightAt(x, z), z], k);
      normals.set([n.x, n.y, n.z], k);
      colors.set([color.r, color.g, color.b], k);
    }
  }

  // Dos triángulos por celda, con la cara hacia arriba.
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = (j + 1) * nx + i;
      const c = j * nx + i + 1;
      const d = (j + 1) * nx + i + 1;
      indices.set([a, b, c, b, d, c], t);
      t += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh;
  setAimPreview(points: Vec3[] | null): void; // línea del inicio de la trayectoria de un golpe perfecto; null la oculta
  setTrace(points: Vec3[]): void; // traza del tiro anterior
  updateShadow(ballPosition: Vec3): void; // sombra del balón en el suelo; recentra sombras y flechas
  setReliefAids(aids: { contours: boolean; arrows: boolean }): void; // curvas de nivel y flechas de caída
  setTerrain(terrain: Terrain): void; // dibuja el terreno (malla en bounds y planos planos fuera)
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
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  // El cielo con degradado y el paisaje lejano los pone createScenery. La niebla
  // funde el suelo lejano con el color del horizonte.
  scene.fog = new THREE.Fog(HORIZON_COLOR, 600, 5000);
  const scenery = createScenery(scene);
  let terrain: Terrain = FLAT_TERRAIN; // el suelo vigente; la sombra se posa sobre él

  // Poca luz ambiente y mucho sol rasante: el contraste entre laderas es lo que da volumen.
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3a5530, 0.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HALF_SIZE,
    right: SHADOW_HALF_SIZE,
    top: SHADOW_HALF_SIZE,
    bottom: -SHADOW_HALF_SIZE,
    near: 1,
    far: 500,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const sunOffset = SUN_DIRECTION.clone().normalize().multiplyScalar(250);
  sun.position.copy(sunOffset);

  const reliefArrows = createReliefArrows((z) => SURFACE_COLORS[surfaceAt(z)]);
  scene.add(reliefArrows.object);
  let contours = { enabled: { value: 1 } };

  // Suelo: malla del terreno dentro de bounds y planos planos de borde fuera, con el
  // color de la franja de superficie que les toca. La primera y la última franja se
  // prolongan: la física las usa fuera del campo.
  const ground = new THREE.Group();
  scene.add(ground);

  function addFlatRect(minX: number, maxX: number, minZ: number, maxZ: number, surface: SurfaceId): void {
    if (maxX <= minX || maxZ <= minZ) return;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(maxX - minX, maxZ - minZ),
      new THREE.MeshLambertMaterial({ color: SURFACE_COLORS[surface] }),
    );
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    ground.add(plane);
  }

  function setTerrain(next: Terrain): void {
    terrain = next;
    scenery.setTerrain(next);
    reliefArrows.setTerrain(next);
    for (const child of [...ground.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      ground.remove(mesh);
    }

    const bounds = Number.isFinite(next.bounds.minX) ? next.bounds : DEFAULT_GROUND_BOUNDS;
    const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    const previousContours = contours.enabled.value;
    contours = addContourLines(terrainMaterial);
    contours.enabled.value = previousContours;
    const terrainMesh = new THREE.Mesh(buildTerrainGeometry(next, bounds), terrainMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    ground.add(terrainMesh);

    SURFACE_BANDS.forEach((band, index) => {
      const zTop = index === 0 ? band.zStart + FIELD_EXTENSION : band.zStart;
      const zBottom = index === SURFACE_BANDS.length - 1 ? band.zEnd - FIELD_EXTENSION : band.zEnd;
      addFlatRect(-FIELD_HALF_WIDTH, bounds.minX, zBottom, zTop, band.surface); // a la izquierda
      addFlatRect(bounds.maxX, FIELD_HALF_WIDTH, zBottom, zTop, band.surface); // a la derecha
      addFlatRect(bounds.minX, bounds.maxX, Math.max(zBottom, bounds.maxZ), zTop, band.surface); // delante
      addFlatRect(bounds.minX, bounds.maxX, zBottom, Math.min(zTop, bounds.minZ), band.surface); // detrás
    });
  }

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
    new THREE.MeshLambertMaterial({ map: createBallTexture() }),
  );
  ball.position.set(0, BALL_RADIUS, 0);
  scene.add(ball);

  // Sombra del balón: cae sobre el terreno siguiendo la dirección del sol, así la
  // distancia entre balón y sombra deja ver la altura. Más tenue y grande con la altura.
  // Se apoya en el plano tangente del terreno en el punto donde el rayo de sol lo toca.
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
  const PLANE_NORMAL = new THREE.Vector3(0, 0, 1); // normal de un PlaneGeometry sin girar
  const SHADOW_LIFT = 0.02; // m sobre el terreno, contra el z-fighting
  scene.add(shadow);

  function updateShadow(ballPosition: Vec3): void {
    // La sombra proyectada del sol y las flechas siguen al balón (en pasos de 1 m para
    // que el mapa de sombras no tiemble).
    const tx = Math.round(ballPosition.x);
    const tz = Math.round(ballPosition.z);
    sun.target.position.set(tx, terrain.heightAt(tx, tz), tz);
    sun.position.copy(sun.target.position).add(sunOffset);
    reliefArrows.setCenter(ballPosition);

    const height = Math.max(0, ballPosition.y - terrain.heightAt(ballPosition.x, ballPosition.z) - BALL_RADIUS);
    // El rayo baja con la dirección opuesta al sol; el punto donde toca el terreno se
    // busca iterando (la altura del terreno depende de dónde cae).
    let x = ballPosition.x;
    let z = ballPosition.z;
    let ground = terrain.heightAt(x, z);
    for (let i = 0; i < 6; i++) {
      const toGround = (ballPosition.y - ground) / BALL_SHADOW_DIRECTION.y;
      x = ballPosition.x - BALL_SHADOW_DIRECTION.x * toGround;
      z = ballPosition.z - BALL_SHADOW_DIRECTION.z * toGround;
      ground = terrain.heightAt(x, z);
    }
    const n = terrain.normalAt(x, z);
    shadow.position.set(x + n.x * SHADOW_LIFT, ground + n.y * SHADOW_LIFT, z + n.z * SHADOW_LIFT);
    shadow.quaternion.setFromUnitVectors(PLANE_NORMAL, new THREE.Vector3(n.x, n.y, n.z));
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
    setTerrain,
    setReliefAids(aids) {
      contours.enabled.value = aids.contours ? 1 : 0;
      reliefArrows.setVisible(aids.arrows);
    },
    render: () => renderer.render(scene, camera),
  };
}
