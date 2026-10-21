import { buildHole, type HoleDef } from './hole';
import type { TerrainDef } from './terrain';

// Relieve moderado del Hoyo 1 (valores iniciales de afinación). El tee queda plano, el
// green tiene una caída suave y plano en 3 m alrededor de la copa, y el lago va en una
// depresión. Las lomas se suman como en el campo de prueba (SPEC 02).
export const HOLE_1_TERRAIN_DEF: TerrainDef = {
  bounds: { minX: -120, maxX: 160, minZ: -330, maxZ: 80 },
  cell: 1,
  edgeFade: 25,
  flatZones: [
    { x: 0, z: 0, radius: 12, blend: 20 }, // el tee
    { x: 75, z: -250, radius: 3, blend: 8.5 }, // la copa: plano en 3 m (reglamento 3-2-8)
  ],
  hills: [
    { x: -55, z: -75, radiusX: 60, radiusZ: 55, height: 3.5 }, // loma a la izquierda del tramo recto
    { x: 55, z: -105, radiusX: 45, radiusZ: 50, height: 3, rotationDeg: 20 }, // loma a la derecha, a la altura de la caída
    { x: 40, z: -175, radiusX: 45, radiusZ: 40, height: -2.2 }, // valle en el codo del dogleg
    { x: 130, z: -205, radiusX: 65, radiusZ: 70, height: 2.5 }, // loma detrás y a la derecha del green
    { x: 28, z: -236, radiusX: 11, radiusZ: 14, height: -0.8, rotationDeg: 20 }, // depresión bajo el lago
    // Tres lomas suaves alrededor del green: dan caída para leer los putts (pendiente media de ~0.4° a
    // 3–5 m de la copa y ~1.5° a 8–14 m, máxima 2.85°) sin tocar la zona plana de 3 m. Salieron de una
    // búsqueda numérica (tests/helpers/bot.ts mide el resultado jugando).
    { x: 69.8, z: -257.8, radiusX: 18, radiusZ: 16.6, height: 0.31, rotationDeg: 13 },
    { x: 53.9, z: -251.5, radiusX: 17, radiusZ: 18.5, height: -0.32, rotationDeg: 173 },
    { x: 69.9, z: -250.4, radiusX: 19.5, radiusZ: 14.4, height: -0.37, rotationDeg: 50 },
  ],
};

export const HOLE_1_DEF: HoleDef = {
  name: 'Hoyo 1',
  par: 4,
  tee: { x: 0, z: 0 },
  teeHeadingDeg: 0,
  // Tramo recto de 160 m y codo a la derecha de ~40° hacia el green (117 m): ~277 m en total.
  centerline: [
    { x: 0, z: 0 },
    { x: 0, z: -160 },
    { x: 75, z: -250 },
  ],
  fairwayHalfWidth: 20,
  roughHalfWidth: 45,
  green: { center: { x: 75, z: -250 }, radius: 14 },
  cup: { position: { x: 75, z: -250 }, radius: 0.255, depth: 0.28 },
  bunkers: [
    { x: -14, z: -150, radiusX: 9, radiusZ: 16 }, // bunker de la zona de caída, lado interior
    { x: 55, z: -250, radiusX: 6, radiusZ: 9 }, // bunker de green, izquierda (pegado al borde del green)
    { x: 95, z: -256, radiusX: 7, radiusZ: 5, rotationDeg: -20 }, // bunker de green, derecha
  ],
  // Lago al lado izquierdo de la aproximación (centro a ~27 m de la línea de juego, borde
  // más cercano a ~16 m), que obliga a decidir entre arriesgar sobre el agua o ir por el
  // lado derecho del green.
  lakes: [{ x: 28, z: -236, radiusX: 11, radiusZ: 14, rotationDeg: 20 }],
  terrain: HOLE_1_TERRAIN_DEF,
};

export const HOLE_1 = buildHole(HOLE_1_DEF);
