import * as THREE from 'three';

// Escenografía puramente visual: sirve para orientarse al girar el rumbo. No tiene
// efecto en la física (los árboles y demás no colisionan; los obstáculos son del SPEC 03).

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

// Corredor de juego del campo de prueba: ahí no se plantan árboles.
const inPlayCorridor = (x: number, z: number): boolean => Math.abs(x) < 60 && z < 100 && z > -340;

export function createScenery(scene: THREE.Scene): void {
  const rand = mulberry32(20261015);
  const between = (min: number, max: number): number => min + rand() * (max - min);

  addSky(scene);
  addOuterGround(scene);
  addMountains(scene, rand, between);
  addClouds(scene, rand, between);
  addTrees(scene, rand, between);
  addClubhouse(scene);
  addFlagPole(scene, 105, -85);
  addYardageMarkers(scene);
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

// Suelo enorme y más bajo que las franjas: ya no hay vacío más allá de su borde.
function addOuterGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshLambertMaterial({ color: 0x2b6e2b }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
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

// Árboles instanciados: dos hileras a cada lado del campo y bosque disperso alrededor.
function addTrees(scene: THREE.Scene, rand: () => number, between: (a: number, b: number) => number): void {
  const spots: Array<{ x: number; z: number; scale: number }> = [];

  for (const side of [-1, 1]) {
    for (const rowX of [64, 88]) {
      for (let z = 80; z > -330; z -= 9) {
        spots.push({ x: side * (rowX + between(-5, 5)), z: z + between(-3, 3), scale: between(0.9, 1.6) });
      }
    }
  }
  let scattered = 0;
  while (scattered < 320) {
    const angle = rand() * Math.PI * 2;
    const distance = between(180, 900);
    const x = Math.sin(angle) * distance;
    const z = -Math.cos(angle) * distance;
    if (inPlayCorridor(x, z)) continue;
    spots.push({ x, z, scale: between(1, 2.2) });
    scattered += 1;
  }

  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.3, 0.45, 2.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x5b3a1e }),
    spots.length,
  );
  const foliage = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.4, 7.5, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // el color real va por instancia
    spots.length,
  );

  const matrix = new THREE.Matrix4();
  const greens = [0x1f5a2a, 0x276b30, 0x2f7a35, 0x1b4d28];
  spots.forEach((spot, i) => {
    const s = spot.scale;
    matrix.compose(
      new THREE.Vector3(spot.x, 1.1 * s, spot.z),
      new THREE.Quaternion(),
      new THREE.Vector3(s, s, s),
    );
    trunk.setMatrixAt(i, matrix);
    matrix.compose(
      new THREE.Vector3(spot.x, (2.2 + 3.75) * s, spot.z),
      new THREE.Quaternion(),
      new THREE.Vector3(s, s, s),
    );
    foliage.setMatrixAt(i, matrix);
    foliage.setColorAt(i, new THREE.Color(greens[Math.floor(rand() * greens.length)]));
  });
  scene.add(trunk, foliage);
}

// Casa club: punto de referencia grande y reconocible, a la izquierda y adelante.
function addClubhouse(scene: THREE.Scene): void {
  const house = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 14), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  walls.position.y = 4;
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
  house.position.set(-150, 0, -40);
  house.rotation.y = Math.PI / 3;
  scene.add(house);
}

function addFlagPole(scene: THREE.Scene, x: number, z: number): void {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  pole.position.set(x, 4.5, z);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.4),
    new THREE.MeshBasicMaterial({ color: 0xd32f2f, side: THREE.DoubleSide }),
  );
  flag.position.set(x + 1.1, 8.2, z);
  scene.add(pole, flag);
}

// Postes de distancia a los lados del campo, cada 50 m desde la salida hacia -z.
function addYardageMarkers(scene: THREE.Scene): void {
  const colors = [0xffffff, 0xffeb3b, 0xff9800, 0xe53935, 0x8e24aa, 0x1e88e5];
  for (const side of [-1, 1]) {
    colors.forEach((color, i) => {
      const distance = (i + 1) * 50;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
      post.position.set(side * 50, 1.1, -distance);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.15), new THREE.MeshBasicMaterial({ color }));
      cap.position.set(side * 50, 2.5, -distance);
      cap.rotation.y = side * (Math.PI / 2);
      scene.add(post, cap);
    });
  }
}
