// Campo de prueba plano. El origen (0, 0, 0) es el punto de patada inicial.
// El rumbo 0 apunta hacia -z. La superficie se decide solo por la coordenada z.

import type { SurfaceId } from '../physics/types';

export interface SurfaceBand {
  surface: SurfaceId;
  zStart: number; // m, borde cercano a la cámara (z mayor)
  zEnd: number; // m, borde lejano (z menor)
}

// La física no depende de x ni del largo: la superficie se decide solo por z y fuera de
// las franjas se usa la más cercana. El dibujo se extiende igual para que el balón nunca
// quede sobre un vacío. La niebla oculta los bordes lejanos.
export const FIELD_HALF_WIDTH = 1500; // m a cada lado de x = 0 (solo visual)
export const FIELD_EXTENSION = 1000; // m que se prolongan la primera y la última franja

export const SURFACE_BANDS: readonly SurfaceBand[] = [
  { surface: 'fairway', zStart: 30, zEnd: -120 },
  { surface: 'rough', zStart: -120, zEnd: -200 },
  { surface: 'sand', zStart: -200, zEnd: -280 },
];

export function surfaceAt(z: number): SurfaceId {
  for (const band of SURFACE_BANDS) {
    if (z <= band.zStart && z > band.zEnd) return band.surface;
  }
  // Fuera del campo se usa la superficie de la franja más cercana.
  return z > SURFACE_BANDS[0].zStart ? SURFACE_BANDS[0].surface : SURFACE_BANDS[SURFACE_BANDS.length - 1].surface;
}

// Superficie bajo un punto del campo de prueba: solo depende de z, la x se ignora.
// Es la forma de `SimConfig.surfaceAt`.
export function testFieldSurfaceAt(_x: number, z: number): SurfaceId {
  return surfaceAt(z);
}
