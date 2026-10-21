import * as THREE from 'three';
import type { Terrain } from '../physics/types';
import { distanceToPolyline, pointAlong, polylineLength, type Vec2 } from './geometry';
import { FLAT_TERRAIN } from './terrain';

// Escenografía puramente visual: sirve para orientarse al girar el rumbo. No tiene
// efecto en la física (los árboles y demás no colisionan; los obstáculos son del SPEC 04).
// Todo se asienta sobre la altura del terreno; `setTerrain` lo recoloca al cambiar de terreno
// y `setField` reparte árboles, postes y bandera según el campo.

export const HORIZON_COLOR = 0xcfe6f5;
const ZENITH_COLOR = 0x4f9fe0;
const SKY_RADIUS = 5500; // m, menor que el plano lejano de la cámara

// Generador pseudoaleatorio con semilla: el paisaje es igual en cada carga.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cómo se reparte el paisaje alrededor del campo activo.
export interface SceneryLayout {
  // Corredor de juego: línea central y semiancho. Ahí no se plantan árboles; dos hileras
  // los bordean a ROW_GAPS m del corredor.
  corridor: { path: Vec2[]; halfWidth: number };
  // Postes de distancia cada 50 m medidos sobre `path`, a `offset` m a cada lado.
  markers: { path: Vec2[]; offset: number };
  // Bandera alta lejana para orientarse (campo de prueba); null si el campo no la lleva.
  landmarkPole: Vec2 | null;
}

// Campo de prueba del SPEC 01: corredor de 60 m a cada lado de x = 0, de z = 100 a -340.
export const TEST_FIELD_LAYOUT: SceneryLayout = {
  corridor: {
    path: [
      { x: 0, z: 100 },
      { x: 0, z: -340 },
    ],
    halfWidth: 60,
  },
  markers: {
    path: [
      { x: 0, z: 0 },
      { x: 0, z: -300 },
    ],
    offset: 50,
  },
  landmarkPole: { x: 105, z: -85 },
};

const ROW_GAPS = [4, 28]; // m entre el borde del corredor y cada hilera de árboles
const ROW_SPACING = 9; // m entre árboles de una hilera
const SCATTERED_TREES = 320;
const SCATTER_CLEARANCE = 5; // m extra de separación del corredor para el bosque disperso
const MAX_TREES = 1500;
const MARKER_SPACING = 50; // m entre postes de distancia
const MARKER_COUNT = 6;

export interface Scenery {
  setTerrain(terrain: Terrain): void; // asienta árboles, casa, bandera y postes sobre el terreno
  setField(layout: SceneryLayout, terrain: Terrain): void; // reparte el paisaje del campo y lo asienta
}

export function createScenery(scene: THREE.Scene): Scenery {
  const rand = mulberry32(20261015);
  const between = (min: number, max: number): number => min + rand() * (max - min);

  addSky(scene);
  addOuterGround(scene);
  addMountains(scene, rand, between);
  addClouds(scene, rand, between);
  const trees = addTrees(scene);
  const clubhouse = addClubhouse(scene);
  const pole = addFlagPole(scene);
  const markers = addYardageMarkers(scene);

  let terrain: Terrain = FLAT_TERRAIN;
  const settle = (): void => {
    trees.settle(terrain);
    clubhouse(terrain);
    pole.settle(terrain);
    markers.settle(terrain);
  };
  const setField = (layout: SceneryLayout, next: Terrain): void => {
    trees.layout(layout);
    pole.layout(layout.landmarkPole);
    markers.layout(layout.markers);
    terrain = next;
    settle();
  };
  const setTerrain = (next: Terrain): void => {
    terrain = next;
    settle();
  };
  setField(TEST_FIELD_LAYOUT, FLAT_TERRAIN);
  return { setTerrain, setField };
}

// Cielo con degradado: más claro en el horizonte, más azul arriba.
function addSky(scene: THREE.Scene): void {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const horizon = new THREE.Color(HORIZON_COLOR);
  const zenith = new THREE.Color(ZENITH_COLOR);
  const position = geometry.attributes.position;
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, position.getY(i) / SKY_RADIUS);
    color.copy(horizon).lerp(zenith, Math.pow(t, 0.55));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
}

// Suelo enorme y más bajo que el terreno (cuyo punto más bajo es -4 m): ya no hay vacío
// más allá de su borde.
function addOuterGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshLambertMaterial({ color: 0x2b6e2b }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  scene.add(ground);
}

function addMountains(scene: THREE.Scene, rand: () => number, between: (a: number, b: number) => number): void {
  const rock = new THREE.MeshLambertMaterial({ color: 0x66788f, flatShading: true });
  const snow = new THREE.MeshLambertMaterial({ color: 0xf2f6fa, flatShading: true });
  const count = 44;
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand() * 0.6) / count) * Math.PI * 2;
    const distance = between(2300, 3000);
    const height = between(250, 700);
    const radius = height * between(0.9, 1.5);
    const x = Math.sin(angle) * distance;
    const z = -Math.cos(angle) * distance;
    const rotation = rand() * Math.PI;

    const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), rock);
    mountain.position.set(x, height / 2 - 5, z);
    mountain.rotation.y = rotation;
    scene.add(mountain);

    if (height > 520) {
      const capHeight = height * 0.28;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.28, capHeight, 7), snow);
      cap.position.set(x, height - capHeight / 2 - 5, z);
      cap.rotation.y = rotation;
      scene.add(cap);
    }
  }
}

function addClouds(scene: THREE.Scene, rand: () => number, between: (a: number, b: number) => number): void {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const puff = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 18; i++) {
    const angle = rand() * Math.PI * 2;
    const distance = between(1200, 3500);
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const mesh = new THREE.Mesh(puff, material);
      const size = between(50, 110);
      mesh.scale.set(size, size * 0.55, size * 0.8);
      mesh.position.set((j - puffs / 2) * 80 + between(-20, 20), between(-12, 12), between(-30, 30));
      cloud.add(mesh);
    }
    cloud.position.set(Math.sin(angle) * distance, between(300, 550), -Math.cos(angle) * distance);
    cloud.rotation.y = rand() * Math.PI;
    scene.add(cloud);
  }
}

// Árboles instanciados: dos hileras a cada lado del corredor de juego y bosque disperso alrededor.
// `layout` los vuelve a repartir (con una semilla fija: el mismo campo da siempre el mismo bosque);
// `settle` los asienta sobre el terreno.
function addTrees(scene: THREE.Scene): {
  layout: (layout: SceneryLayout) => void;
  settle: (terrain: Terrain) => void;
} {
  let spots: Array<{ x: number; z: number; scale: number }> = [];

  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.3, 0.45, 2.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x5b3a1e }),
    MAX_TREES,
  );
  const foliage = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.4, 7.5, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // el color real va por instancia
    MAX_TREES,
  );
  trunk.castShadow = true;
  foliage.castShadow = true;
  trunk.frustumCulled = false;
  foliage.frustumCulled = false;
  scene.add(trunk, foliage);

  const greens = [0x1f5a2a, 0x276b30, 0x2f7a35, 0x1b4d28];
  const color = new THREE.Color();

  function layout({ corridor }: SceneryLayout): void {
    const rand = mulberry32(20261016);
    const between = (min: number, max: number): number => min + rand() * (max - min);
    const outsideCorridor = (x: number, z: number, extra = 0): boolean =>
      distanceToPolyline(x, z, corridor.path) >= corridor.halfWidth + extra;

    spots = [];
    const length = polylineLength(corridor.path);
    for (const side of [-1, 1]) {
      for (const gap of ROW_GAPS) {
        for (let d = 0; d <= length; d += ROW_SPACING) {
          const { point, direction } = pointAlong(corridor.path, d + between(-3, 3));
          const lateral = side * (corridor.halfWidth + gap + between(-5, 5));
          const x = point.x - direction.z * lateral;
          const z = point.z + direction.x * lateral;
          if (outsideCorridor(x, z)) spots.push({ x, z, scale: between(0.9, 1.6) });
        }
      }
    }
    let scattered = 0;
    while (scattered < SCATTERED_TREES) {
      const angle = rand() * Math.PI * 2;
      const distance = between(180, 900);
      const x = Math.sin(angle) * distance;
      const z = -Math.cos(angle) * distance;
      if (!outsideCorridor(x, z, SCATTER_CLEARANCE)) continue;
      spots.push({ x, z, scale: between(1, 2.2) });
      scattered += 1;
    }

    spots = spots.slice(0, MAX_TREES);
    trunk.count = spots.length;
    foliage.count = spots.length;
    spots.forEach((_, i) => foliage.setColorAt(i, color.setHex(greens[Math.floor(rand() * greens.length)])));
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  }

  // La base del tronco queda en heightAt(x, z).
  const matrix = new THREE.Matrix4();
  function settle(terrain: Terrain): void {
    spots.forEach((spot, i) => {
      const s = spot.scale;
      const base = terrain.heightAt(spot.x, spot.z);
      matrix.compose(
        new THREE.Vector3(spot.x, base + 1.1 * s, spot.z),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s, s),
      );
      trunk.setMatrixAt(i, matrix);
      matrix.compose(
        new THREE.Vector3(spot.x, base + (2.2 + 3.75) * s, spot.z),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s, s),
      );
      foliage.setMatrixAt(i, matrix);
    });
    trunk.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
  }

  return { layout, settle };
}

// Casa club: punto de referencia grande y reconocible, a la izquierda y adelante.
// Los muros se prolongan 1 m bajo su base para que en una ladera no quede un hueco.
function addClubhouse(scene: THREE.Scene): (terrain: Terrain) => void {
  const house = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 14), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  walls.position.y = 3.5;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(19, 6, 4),
    new THREE.MeshLambertMaterial({ color: 0xb23a2e, flatShading: true }),
  );
  roof.position.y = 8 + 3;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.1, 1, 0.6);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 0.3), new THREE.MeshLambertMaterial({ color: 0x4a3322 }));
  door.position.set(0, 2.5, 7.1);
  house.add(walls, roof, door);
  house.rotation.y = Math.PI / 3;
  scene.add(house);
  return (terrain) => house.position.set(-150, terrain.heightAt(-150, -40), -40);
}

// Bandera alta de referencia lejana. Sin posición (null) queda oculta.
function addFlagPole(scene: THREE.Scene): { layout: (at: Vec2 | null) => void; settle: (terrain: Terrain) => void } {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  pole.position.y = 4.5;
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.4),
    new THREE.MeshBasicMaterial({ color: 0xd32f2f, side: THREE.DoubleSide }),
  );
  flag.position.set(1.1, 8.2, 0);
  group.add(pole, flag);
  scene.add(group);

  let at: Vec2 | null = null;
  return {
    layout(next) {
      at = next;
      group.visible = next !== null;
    },
    settle(terrain) {
      if (at) group.position.set(at.x, terrain.heightAt(at.x, at.z), at.z);
    },
  };
}

// Postes de distancia a los lados de la línea de juego, cada 50 m desde la salida.
function addYardageMarkers(scene: THREE.Scene): {
  layout: (markers: SceneryLayout['markers']) => void;
  settle: (terrain: Terrain) => void;
} {
  const colors = [0xffffff, 0xffeb3b, 0xff9800, 0xe53935, 0x8e24aa, 0x1e88e5];
  const markers: Array<{ group: THREE.Group; side: number; index: number; x: number; z: number }> = [];
  for (const side of [-1, 1]) {
    colors.slice(0, MARKER_COUNT).forEach((color, i) => {
      const group = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
      post.position.y = 1.1;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.15), new THREE.MeshBasicMaterial({ color }));
      cap.position.y = 2.5;
      cap.rotation.y = side * (Math.PI / 2);
      group.add(post, cap);
      scene.add(group);
      markers.push({ group, side, index: i, x: 0, z: 0 });
    });
  }

  return {
    layout({ path, offset }) {
      const length = polylineLength(path);
      for (const marker of markers) {
        const distance = (marker.index + 1) * MARKER_SPACING;
        marker.group.visible = distance <= length;
        const { point, direction } = pointAlong(path, distance);
        const lateral = marker.side * offset;
        marker.x = point.x - direction.z * lateral;
        marker.z = point.z + direction.x * lateral;
      }
    },
    settle(terrain) {
      for (const m of markers) m.group.position.set(m.x, terrain.heightAt(m.x, m.z), m.z);
    },
  };
}
