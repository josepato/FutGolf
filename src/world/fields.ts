import type { Cup, SurfaceId, Terrain, TerrainBounds } from '../physics/types';
import { FIELD_EXTENSION, FIELD_HALF_WIDTH, SURFACE_BANDS, surfaceAt as testBandSurfaceAt } from './field';
import { HOLE_1 } from './hole1';
import { TEST_FIELD_LAYOUT, type SceneryLayout } from './scenery';
import { FLAT_TERRAIN } from './terrain';
import { TEST_TERRAIN } from './testTerrain';
import type { Vec2 } from './geometry';
import type { Ellipse, HoleMap } from './hole';

// Un campo jugable: el terreno, sus superficies y lo que hay que dibujar y colocar alrededor.
// El juego, la escena y el paisaje leen todo de aquí, así que cambiar de campo es cambiar de Field.

export type FieldId = 'hole1' | 'test';

// Rectángulo plano en y = 0 con el color de una superficie.
export interface FlatRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  surface: SurfaceId;
}

export interface Field {
  id: FieldId;
  name: string;
  terrain: Terrain;
  surfaceAt: (x: number, z: number) => SurfaceId;
  // Fuera de límites (zona penalizada). Los campos sin reglas de hoyo no lo definen.
  isOutOfBounds?: (x: number, z: number) => boolean;
  tee: { x: number; z: number; headingDeg: number }; // punto de salida y rumbo inicial
  cup?: Cup; // sin copa no hay embocado
  // Reglas de hoyo (golpes, par, fuera de límites, agua). Sin esto el campo se juega libre, sin conteo.
  rules?: { name: string; par: number; map: HoleMap };
  teeBox?: { width: number; depth: number }; // caja del tee, centrada en el tee
  // Láminas de agua de los lagos: elipse (misma convención que HoleDef.lakes) y altura del agua.
  waters: Array<Ellipse & { level: number }>;
  // Región (en m) que muestra el minimapa; los campos sin reglas de hoyo no llevan minimapa.
  minimap?: TerrainBounds;
  scenery: SceneryLayout;
  // Planos planos que rodean la malla del terreno (que se dibuja solo dentro de `meshBounds`).
  surroundings(meshBounds: TerrainBounds): FlatRect[];
}

// --- Campo de prueba (SPEC 01 y 02) ---

// Franjas de superficie por z; la primera y la última se prolongan: la física las usa fuera del campo.
function testFieldSurroundings(bounds: TerrainBounds): FlatRect[] {
  const rects: FlatRect[] = [];
  SURFACE_BANDS.forEach((band, index) => {
    const zTop = index === 0 ? band.zStart + FIELD_EXTENSION : band.zStart;
    const zBottom = index === SURFACE_BANDS.length - 1 ? band.zEnd - FIELD_EXTENSION : band.zEnd;
    const add = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
      if (maxX > minX && maxZ > minZ) rects.push({ minX, maxX, minZ, maxZ, surface: band.surface });
    };
    add(-FIELD_HALF_WIDTH, bounds.minX, zBottom, zTop); // a la izquierda
    add(bounds.maxX, FIELD_HALF_WIDTH, zBottom, zTop); // a la derecha
    add(bounds.minX, bounds.maxX, Math.max(zBottom, bounds.maxZ), zTop); // delante
    add(bounds.minX, bounds.maxX, zBottom, Math.min(zTop, bounds.minZ)); // detrás
  });
  return rects;
}

// El campo de prueba con relieve (TEST_TERRAIN) o plano (FLAT_TERRAIN) para comparar el mismo tiro.
export function testField(relief: boolean): Field {
  return {
    id: 'test',
    name: 'Campo de prueba',
    terrain: relief ? TEST_TERRAIN : FLAT_TERRAIN,
    surfaceAt: (_x, z) => testBandSurfaceAt(z),
    tee: { x: 0, z: 0, headingDeg: 0 },
    waters: [],
    scenery: TEST_FIELD_LAYOUT,
    surroundings: testFieldSurroundings,
  };
}

// --- Hoyo 1 (SPEC 03) ---

const { def: HOLE_DEF, terrain: HOLE_TERRAIN, map: HOLE_MAP } = HOLE_1;

// Línea de juego prolongada 80 m antes del tee y después del green para repartir árboles y postes.
function extendedPath(path: Vec2[], extension: number): Vec2[] {
  const first = path[0];
  const second = path[1];
  const penultimate = path[path.length - 2];
  const last = path[path.length - 1];
  const unit = (a: Vec2, b: Vec2): Vec2 => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  };
  const head = unit(second, first);
  const tail = unit(penultimate, last);
  return [
    { x: first.x + head.x * extension, z: first.z + head.z * extension },
    ...path,
    { x: last.x + tail.x * extension, z: last.z + tail.z * extension },
  ];
}

// Región del minimapa: la caja que envuelve la línea de juego con un margen.
function minimapRegion(path: Vec2[], margin: number): TerrainBounds {
  return {
    minX: Math.min(...path.map((p) => p.x)) - margin,
    maxX: Math.max(...path.map((p) => p.x)) + margin,
    minZ: Math.min(...path.map((p) => p.z)) - margin,
    maxZ: Math.max(...path.map((p) => p.z)) + margin,
  };
}

// El agua queda 5 cm bajo la orilla más baja del lago, así se ve en todo su contorno.
function waterLevel(lake: Ellipse, terrain: Terrain): number {
  const angle = ((lake.rotationDeg ?? 0) * Math.PI) / 180;
  let lowest = Infinity;
  for (let k = 0; k < 72; k++) {
    const t = (k / 72) * Math.PI * 2;
    const u = lake.radiusX * Math.cos(t);
    const v = lake.radiusZ * Math.sin(t);
    const x = lake.x + u * Math.cos(angle) - v * Math.sin(angle);
    const z = lake.z + u * Math.sin(angle) + v * Math.cos(angle);
    lowest = Math.min(lowest, terrain.heightAt(x, z));
  }
  return lowest - 0.05;
}

const HOLE_1_SCENERY: SceneryLayout = {
  corridor: { path: extendedPath(HOLE_DEF.centerline, 80), halfWidth: HOLE_DEF.roughHalfWidth },
  markers: { path: HOLE_DEF.centerline, offset: HOLE_DEF.fairwayHalfWidth + 4 },
  landmarkPole: null,
};

export const HOLE_1_FIELD: Field = {
  id: 'hole1',
  name: HOLE_DEF.name,
  terrain: HOLE_TERRAIN,
  surfaceAt: HOLE_MAP.surfaceAt,
  isOutOfBounds: HOLE_MAP.isOutOfBounds,
  tee: { x: HOLE_DEF.tee.x, z: HOLE_DEF.tee.z, headingDeg: HOLE_DEF.teeHeadingDeg },
  cup: HOLE_DEF.cup,
  rules: { name: HOLE_DEF.name, par: HOLE_DEF.par, map: HOLE_MAP },
  minimap: minimapRegion(HOLE_DEF.centerline, HOLE_DEF.roughHalfWidth + 5),
  teeBox: { width: 3, depth: 2 }, // reglamento 3-2-16: 2 m de fondo y 3 m de ancho como mínimo
  waters: HOLE_DEF.lakes.map((lake) => ({ ...lake, level: waterLevel(lake, HOLE_TERRAIN) })),
  scenery: HOLE_1_SCENERY,
  // El terreno baja a 0 en su borde: cuatro planos en y = 0 lo prolongan como rough. No pueden
  // cubrir el terreno (taparían el lago y los valles, que quedan bajo y = 0).
  surroundings: (bounds) => {
    const far = 6000;
    return [
      { minX: -far, maxX: bounds.minX, minZ: -far, maxZ: far, surface: 'rough' }, // a la izquierda
      { minX: bounds.maxX, maxX: far, minZ: -far, maxZ: far, surface: 'rough' }, // a la derecha
      { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.maxZ, maxZ: far, surface: 'rough' }, // delante
      { minX: bounds.minX, maxX: bounds.maxX, minZ: -far, maxZ: bounds.minZ, surface: 'rough' }, // detrás
    ];
  },
};
