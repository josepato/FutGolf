import * as THREE from 'three';
import { BALL_SPEC } from '../physics/bodies';
import type { Cup, Terrain, TerrainBounds, Vec3 } from '../physics/types';
import type { Field, FlatRect } from '../world/fields';
import { createScenery, HORIZON_COLOR } from '../world/scenery';
import { FLAT_TERRAIN } from '../world/terrain';
import { addContourLines, createReliefArrows } from './reliefAids';
import { surfaceMapFor, SURFACE_COLORS } from './surfaceTexture';

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

const FLAG_HEIGHT = 2.5; // m, bandera de la copa
const GROUND_STEP = 2; // m entre vértices de la malla del terreno en pantalla
// Zona que se dibuja con malla cuando el terreno no tiene límites (FLAT_TERRAIN).
const DEFAULT_GROUND_BOUNDS: TerrainBounds = { minX: -200, maxX: 200, minZ: -360, maxZ: 120 };

// Malla del terreno: un vértice cada GROUND_STEP m muestreado de `terrain`, con normales
// suaves del propio terreno. El color por superficie va en una textura (paintSurfaceMap),
// con coordenadas uv sobre los límites de la malla.
function buildTerrainGeometry(terrain: Terrain, bounds: TerrainBounds): THREE.BufferGeometry {
  const nx = Math.floor((bounds.maxX - bounds.minX) / GROUND_STEP) + 1;
  const nz = Math.floor((bounds.maxZ - bounds.minZ) / GROUND_STEP) + 1;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);

  for (let j = 0; j < nz; j++) {
    const z = bounds.minZ + j * GROUND_STEP;
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * GROUND_STEP;
      const n = terrain.normalAt(x, z);
      const k = (j * nx + i) * 3;
      positions.set([x, terrain.heightAt(x, z), z], k);
      normals.set([n.x, n.y, n.z], k);
      uvs.set([(x - bounds.minX) / (bounds.maxX - bounds.minX), (z - bounds.minZ) / (bounds.maxZ - bounds.minZ)], (j * nx + i) * 2);
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
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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
  setReliefMarker(position: Vec3 | null, valid: boolean): void; // marca dónde quedará el balón al elegir cómo seguir tras el agua
  setField(field: Field): void; // dibuja el campo: terreno, superficies, copa, bandera, caja del tee y paisaje
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
  let surfaceColorAt: (x: number, z: number) => number = () => SURFACE_COLORS.fairway;

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

  const reliefArrows = createReliefArrows((x, z) => surfaceColorAt(x, z));
  scene.add(reliefArrows.object);
  let contours = { enabled: { value: 1 } };

  // Suelo: malla del terreno dentro de bounds con la textura de superficies, planos planos de
  // borde fuera (los define el campo) y, sobre el terreno, la copa, la bandera y la caja del tee.
  const ground = new THREE.Group();
  scene.add(ground);

  function addFlatRect(rect: FlatRect): void {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ),
      new THREE.MeshLambertMaterial({ color: SURFACE_COLORS[rect.surface] }),
    );
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2);
    ground.add(plane);
  }

  function surfaceTexture(field: Field, bounds: TerrainBounds): THREE.CanvasTexture {
    const image = surfaceMapFor(field, bounds, field.surfaceAt, field.isOutOfBounds);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // la fila 0 es z = bounds.minZ, igual que la v de la malla
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  // Copa: disco oscuro con aro claro y bandera. Caja del tee: parche claro con borde blanco.
  const props = new THREE.Group();
  scene.add(props);

  function addCup(cup: Cup): void {
    const { x, z } = cup.position;
    const y = terrain.heightAt(x, z);
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(cup.radius, 32),
      new THREE.MeshBasicMaterial({ color: 0x050505, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, y + 0.02, z);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(cup.radius, cup.radius + 0.04, 32),
      new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, y + 0.02, z);

    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, FLAG_HEIGHT, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    pole.position.y = FLAG_HEIGHT / 2;
    const cloth = new THREE.Shape();
    cloth.moveTo(0, 0);
    cloth.lineTo(0.6, 0.18);
    cloth.lineTo(0, 0.36);
    cloth.closePath();
    const pennant = new THREE.Mesh(new THREE.ShapeGeometry(cloth), new THREE.MeshBasicMaterial({ color: 0xd32f2f, side: THREE.DoubleSide }));
    pennant.position.set(0.015, FLAG_HEIGHT - 0.4, 0);
    flag.add(pole, pennant);
    flag.position.set(x, y, z);
    props.add(hole, rim, flag);
  }

  function addTeeBox(field: Field): void {
    if (!field.teeBox) return;
    const { x, z } = field.tee;
    const y = field.terrain.heightAt(x, z) + 0.03;
    const { width, depth } = field.teeBox;
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshLambertMaterial({ color: 0x6fcf6a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, y, z);
    const half = { x: width / 2, z: depth / 2 };
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x - half.x, y + 0.01, z - half.z),
        new THREE.Vector3(x + half.x, y + 0.01, z - half.z),
        new THREE.Vector3(x + half.x, y + 0.01, z + half.z),
        new THREE.Vector3(x - half.x, y + 0.01, z + half.z),
      ]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    props.add(patch, border);
  }

  // Lago: lámina de agua translúcida sobre la depresión, para que se lea como agua desde lejos.
  function addWater(water: Field['waters'][number]): void {
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshLambertMaterial({
        color: SURFACE_COLORS.water,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    surface.scale.set(water.radiusX, water.radiusZ, 1);
    // El círculo está en el plano XY: se tumba y se gira para que sus ejes sean los de la elipse.
    surface.rotation.order = 'YXZ';
    surface.rotation.set(-Math.PI / 2, -((water.rotationDeg ?? 0) * Math.PI) / 180, 0);
    surface.position.set(water.x, water.level, water.z);
    props.add(surface);
  }

  function disposeChildren(group: THREE.Group): void {
    for (const child of [...group.children]) {
      const object = child as THREE.Mesh;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        (material as THREE.MeshLambertMaterial | undefined)?.map?.dispose();
        material?.dispose();
      }
      group.remove(child);
    }
  }

  function setField(field: Field): void {
    terrain = field.terrain;
    surfaceColorAt = (x, z) => SURFACE_COLORS[field.surfaceAt(x, z)];
    scenery.setField(field.scenery, field.terrain);
    reliefArrows.setTerrain(field.terrain);
    disposeChildren(ground);
    disposeChildren(props);

    const bounds = Number.isFinite(field.terrain.bounds.minX) ? field.terrain.bounds : DEFAULT_GROUND_BOUNDS;
    const terrainMaterial = new THREE.MeshLambertMaterial({ map: surfaceTexture(field, bounds) });
    const previousContours = contours.enabled.value;
    contours = addContourLines(terrainMaterial);
    contours.enabled.value = previousContours;
    const terrainMesh = new THREE.Mesh(buildTerrainGeometry(field.terrain, bounds), terrainMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    ground.add(terrainMesh);

    for (const rect of field.surroundings(bounds)) addFlatRect(rect);
    if (field.cup) addCup(field.cup);
    field.waters.forEach(addWater);
    addTeeBox(field); // el bucle de juego llama a updateShadow después: recentra sombra y flechas
  }

  // Marca de colocación del balón (procedimiento de agua): aro cian si vale y rojo si no.
  const reliefMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
  );
  reliefMarker.rotation.x = -Math.PI / 2;
  reliefMarker.visible = false;
  scene.add(reliefMarker);

  function setReliefMarker(position: Vec3 | null, valid: boolean): void {
    reliefMarker.visible = position !== null;
    if (!position) return;
    reliefMarker.position.set(position.x, terrain.heightAt(position.x, position.z) + 0.06, position.z);
    (reliefMarker.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x00e5ff : 0xff3b30);
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
    setField,
    setReliefMarker,
    setReliefAids(aids) {
      contours.enabled.value = aids.contours ? 1 : 0;
      reliefArrows.setVisible(aids.arrows);
    },
    render: () => renderer.render(scene, camera),
  };
}
