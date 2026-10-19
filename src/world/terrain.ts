import type { Terrain, TerrainBounds, Vec3 } from '../physics/types';

// Suelo plano y = 0 en todas partes: el terreno del SPEC 01.
export const FLAT_TERRAIN: Terrain = {
  bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
  heightAt: () => 0,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
  slopeDegAt: () => 0,
};

export interface HillDef {
  x: number; // centro, m
  z: number;
  radiusX: number; // semiejes de la elipse, m
  radiusZ: number;
  height: number; // m; negativo = depresión
  rotationDeg?: number; // giro de la elipse sobre y; 0 si falta
}

// Plano dentro de `radius`; el relieve sube suave a lo largo de `blend`.
export interface FlatZone {
  x: number;
  z: number;
  radius: number;
  blend: number;
}

export interface TerrainDef {
  bounds: TerrainBounds;
  cell: number; // m, separación de la malla de alturas
  edgeFade: number; // m, distancia en que el relieve baja a 0 en los bordes de bounds
  flatZones: FlatZone[];
  hills: HillDef[];
}

const NORMAL_STEP = 0.25; // m, paso de las diferencias centrales de la normal

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Altura analítica de la suma de lomas y depresiones, antes de las zonas planas y los bordes.
function hillsHeight(hills: HillDef[], x: number, z: number): number {
  let total = 0;
  for (const hill of hills) {
    const angle = ((hill.rotationDeg ?? 0) * Math.PI) / 180;
    const dx = x - hill.x;
    const dz = z - hill.z;
    const u = dx * Math.cos(angle) + dz * Math.sin(angle);
    const v = -dx * Math.sin(angle) + dz * Math.cos(angle);
    const s2 = (u / hill.radiusX) ** 2 + (v / hill.radiusZ) ** 2;
    if (s2 < 1) total += hill.height * (1 - s2) * (1 - s2);
  }
  return total;
}

// Spline de Catmull-Rom entre p1 y p2 (pasa por los nodos), t en 0..1.
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  );
}

// Muestrea la definición en una malla de `cell` m e interpola con bicúbica de
// Catmull-Rom: la altura es continua y las normales también (no hay facetas por celda).
// Los bordes de `bounds` deben caer en nodos de la malla (el ancho múltiplo de `cell`).
export function buildTerrain(def: TerrainDef): Terrain {
  const { bounds, cell } = def;
  const nx = Math.round((bounds.maxX - bounds.minX) / cell) + 1;
  const nz = Math.round((bounds.maxZ - bounds.minZ) / cell) + 1;
  const grid = new Float64Array(nx * nz);

  for (let j = 0; j < nz; j++) {
    const z = bounds.minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * cell;
      let h = hillsHeight(def.hills, x, z);
      for (const zone of def.flatZones) {
        const distance = Math.hypot(x - zone.x, z - zone.z);
        h *= smoothstep((distance - zone.radius) / zone.blend);
      }
      if (def.edgeFade > 0) {
        const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z);
        h *= smoothstep(edge / def.edgeFade);
      }
      grid[j * nx + i] = h;
    }
  }

  const node = (i: number, j: number): number =>
    grid[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];

  const inside = (x: number, z: number): boolean =>
    x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

  function heightAt(x: number, z: number): number {
    if (!inside(x, z)) return 0;
    const fx = (x - bounds.minX) / cell;
    const fz = (z - bounds.minZ) / cell;
    const i = Math.min(nx - 2, Math.floor(fx));
    const j = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const row = (jj: number): number =>
      catmullRom(node(i - 1, jj), node(i, jj), node(i + 1, jj), node(i + 2, jj), tx);
    return catmullRom(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  }

  function normalAt(x: number, z: number): Vec3 {
    if (!inside(x, z)) return { x: 0, y: 1, z: 0 };
    const dhdx = (heightAt(x + NORMAL_STEP, z) - heightAt(x - NORMAL_STEP, z)) / (2 * NORMAL_STEP);
    const dhdz = (heightAt(x, z + NORMAL_STEP) - heightAt(x, z - NORMAL_STEP)) / (2 * NORMAL_STEP);
    const length = Math.hypot(dhdx, 1, dhdz);
    return { x: -dhdx / length, y: 1 / length, z: -dhdz / length };
  }

  function slopeDegAt(x: number, z: number): number {
    return (Math.acos(Math.min(1, normalAt(x, z).y)) * 180) / Math.PI;
  }

  return { bounds, heightAt, normalAt, slopeDegAt };
}
