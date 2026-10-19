import { buildTerrain, type TerrainDef } from './terrain';

// Relieve «moderado» del campo de prueba (valores iniciales de afinación). Las
// franjas de superficie son las de field.ts: fairway z 30..-120, rough -120..-200,
// arena de -200 hacia atrás. El tee (origen) queda plano.
export const TEST_TERRAIN_DEF: TerrainDef = {
  bounds: { minX: -200, maxX: 200, minZ: -360, maxZ: 120 },
  cell: 1,
  edgeFade: 25,
  flatZones: [{ x: 0, z: 0, radius: 12, blend: 20 }], // el tee
  hills: [
    { x: -80, z: -70, radiusX: 95, radiusZ: 80, height: 5 }, // loma amplia en el fairway
    { x: 75, z: -100, radiusX: 90, radiusZ: 95, height: 7, rotationDeg: 20 }, // loma con la pendiente más fuerte del fairway
    { x: 0, z: -168, radiusX: 75, radiusZ: 45, height: -4 }, // valle en el rough
    { x: -35, z: -172, radiusX: 30, radiusZ: 28, height: 5 }, // montículo empinado en el rough
    { x: -60, z: -240, radiusX: 70, radiusZ: 55, height: 4 }, // loma en la arena
    { x: 90, z: -230, radiusX: 80, radiusZ: 70, height: 6 }, // loma en la arena
  ],
};

export const TEST_TERRAIN = buildTerrain(TEST_TERRAIN_DEF);
