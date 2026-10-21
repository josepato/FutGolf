import type { Cup, SurfaceId, Terrain } from '../physics/types';
import { distanceToPolyline, distanceToSegment, type Vec2 } from './geometry';
import { buildTerrain, type TerrainDef } from './terrain';

export type { Cup, Vec2 };

export interface Ellipse {
  x: number; // centro, m
  z: number;
  radiusX: number; // semiejes, m
  radiusZ: number;
  rotationDeg?: number; // giro sobre y; 0 si falta (misma convención que HillDef)
}

export interface HoleDef {
  name: string;
  par: number; // 3 a 5
  tee: Vec2; // punto de patada inicial
  teeHeadingDeg: number; // rumbo inicial hacia el hoyo
  centerline: Vec2[]; // línea de juego, del tee al centro del green
  fairwayHalfWidth: number; // m a cada lado de la línea de juego
  roughHalfWidth: number; // m; más allá empieza OB
  green: { center: Vec2; radius: number };
  cup: Cup;
  bunkers: Ellipse[];
  lakes: Ellipse[]; // vacío si el hoyo no lleva lago
  terrain: TerrainDef; // relieve del hoyo (SPEC 02)
}

export interface HoleMap {
  // 'fairway' | 'rough' | 'sand' | 'green' | 'water'. El OB no es una superficie: allí
  // devuelve 'rough' y la penalización la decide isOutOfBounds.
  surfaceAt(x: number, z: number): SurfaceId;
  isOutOfBounds(x: number, z: number): boolean;
  distanceToCup(x: number, z: number): number;
  // ¿El centro está dentro de algún lago? (aunque otra superficie tenga prioridad en surfaceAt)
  isInLake(x: number, z: number): boolean;
  // Reglamento 3-2-17 y 3-3-7: el balón está en el agua solo si toda su proyección vertical
  // (un círculo de `radius`) queda dentro del lago; si toca la línea del borde, está fuera.
  isBallInWater(x: number, z: number, radius: number): boolean;
}

export interface Hole {
  def: HoleDef;
  terrain: Terrain;
  map: HoleMap;
}

function insideEllipse(e: Ellipse, x: number, z: number): boolean {
  const angle = ((e.rotationDeg ?? 0) * Math.PI) / 180;
  const dx = x - e.x;
  const dz = z - e.z;
  const u = dx * Math.cos(angle) + dz * Math.sin(angle);
  const v = -dx * Math.sin(angle) + dz * Math.cos(angle);
  return (u / e.radiusX) ** 2 + (v / e.radiusZ) ** 2 <= 1;
}

const BOUNDARY_SAMPLES = 720;

// Contorno de la elipse como polígono cerrado, para medir la distancia al borde.
function ellipseOutline(e: Ellipse): Vec2[] {
  const angle = ((e.rotationDeg ?? 0) * Math.PI) / 180;
  const points: Vec2[] = [];
  for (let k = 0; k < BOUNDARY_SAMPLES; k++) {
    const t = (k / BOUNDARY_SAMPLES) * Math.PI * 2;
    const u = e.radiusX * Math.cos(t);
    const v = e.radiusZ * Math.sin(t);
    points.push({
      x: e.x + u * Math.cos(angle) - v * Math.sin(angle),
      z: e.z + u * Math.sin(angle) + v * Math.cos(angle),
    });
  }
  return points;
}

function distanceToOutline(x: number, z: number, outline: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    best = Math.min(best, distanceToSegment(x, z, outline[i], outline[(i + 1) % outline.length]));
  }
  return best;
}

// Construye el terreno del hoyo y su mapa de superficies. Prioridad de superficie:
// green > agua > bunker > fairway > rough.
export function buildHole(def: HoleDef): Hole {
  const terrain = buildTerrain(def.terrain);
  const { green, cup } = def;

  const inGreen = (x: number, z: number): boolean =>
    Math.hypot(x - green.center.x, z - green.center.z) <= green.radius;

  const lakeOutlines = def.lakes.map(ellipseOutline);
  const inLake = (x: number, z: number): boolean => def.lakes.some((lake) => insideEllipse(lake, x, z));

  const map: HoleMap = {
    surfaceAt(x, z) {
      if (inGreen(x, z)) return 'green';
      if (inLake(x, z)) return 'water';
      if (def.bunkers.some((bunker) => insideEllipse(bunker, x, z))) return 'sand';
      return distanceToPolyline(x, z, def.centerline) <= def.fairwayHalfWidth ? 'fairway' : 'rough';
    },
    isOutOfBounds(x, z) {
      return !inGreen(x, z) && distanceToPolyline(x, z, def.centerline) > def.roughHalfWidth;
    },
    distanceToCup(x, z) {
      return Math.hypot(x - cup.position.x, z - cup.position.z);
    },
    isInLake: inLake,
    isBallInWater(x, z, radius) {
      return def.lakes.some(
        (lake, i) => insideEllipse(lake, x, z) && distanceToOutline(x, z, lakeOutlines[i]) >= radius,
      );
    },
  };

  return { def, terrain, map };
}
