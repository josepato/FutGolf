import type { SurfaceId, TerrainBounds } from '../physics/types';

export const SURFACE_COLORS: Record<SurfaceId, number> = {
  fairway: 0x3f9b3a,
  rough: 0x2b6e2b,
  sand: 0xdcc88a,
  green: 0x4fb04a,
  water: 0x2f6fb5,
};

export const TEXTURE_CELL = 0.5; // m por píxel del mapa de superficies
const OUT_OF_BOUNDS_SHADE = 0.55; // el fuera de límites se oscurece a esta fracción de su color
const BOUNDARY_COLOR = 0xffffff; // línea blanca del límite (como las estacas)
const BOUNDARY_WIDTH = 2; // píxeles

export interface SurfaceMapImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>; // RGBA; la fila j corresponde a z = bounds.minZ + (j + 0.5)·cell
  cell: number;
  bounds: TerrainBounds;
}

const channel = (hex: number, shift: number): number => (hex >> shift) & 0xff;

// Pinta la superficie de cada punto de `bounds` en una imagen: el color de su superficie, el fuera de
// límites más oscuro y una línea blanca en su borde. Se usa como textura del terreno: así los bordes
// del green, los bunkers y el lago salen limpios aunque la malla del terreno sea gruesa.
export function paintSurfaceMap(
  bounds: TerrainBounds,
  surfaceAt: (x: number, z: number) => SurfaceId,
  isOutOfBounds?: (x: number, z: number) => boolean,
  cell: number = TEXTURE_CELL,
): SurfaceMapImage {
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const surfaces = new Array<SurfaceId>(width * height);
  const outside = new Uint8Array(width * height);

  for (let j = 0; j < height; j++) {
    const z = bounds.minZ + (j + 0.5) * cell;
    for (let i = 0; i < width; i++) {
      const x = bounds.minX + (i + 0.5) * cell;
      surfaces[j * width + i] = surfaceAt(x, z);
      if (isOutOfBounds && isOutOfBounds(x, z)) outside[j * width + i] = 1;
    }
  }

  // Un píxel es del borde si el fuera de límites cambia en los BOUNDARY_WIDTH píxeles siguientes
  // hacia la derecha o hacia arriba.
  const onBoundary = (i: number, j: number): boolean => {
    const here = outside[j * width + i];
    for (let k = 1; k <= BOUNDARY_WIDTH; k++) {
      if (i + k < width && outside[j * width + i + k] !== here) return true;
      if (j + k < height && outside[(j + k) * width + i] !== here) return true;
    }
    return false;
  };

  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const index = j * width + i;
      let hex = SURFACE_COLORS[surfaces[index]];
      let shade = outside[index] ? OUT_OF_BOUNDS_SHADE : 1;
      if (isOutOfBounds && onBoundary(i, j)) {
        hex = BOUNDARY_COLOR;
        shade = 1;
      }
      data[index * 4] = channel(hex, 16) * shade;
      data[index * 4 + 1] = channel(hex, 8) * shade;
      data[index * 4 + 2] = channel(hex, 0) * shade;
      data[index * 4 + 3] = 255;
    }
  }
  return { width, height, data, cell, bounds };
}

const surfaceMapCache = new WeakMap<object, SurfaceMapImage>();

// Como paintSurfaceMap, pero lo pinta una sola vez por `owner` (el campo): lo comparten la textura del
// terreno y el minimapa.
export function surfaceMapFor(
  owner: object,
  bounds: TerrainBounds,
  surfaceAt: (x: number, z: number) => SurfaceId,
  isOutOfBounds?: (x: number, z: number) => boolean,
): SurfaceMapImage {
  let image = surfaceMapCache.get(owner);
  if (!image) {
    image = paintSurfaceMap(bounds, surfaceAt, isOutOfBounds);
    surfaceMapCache.set(owner, image);
  }
  return image;
}

// Color (RGB, 0..255) del píxel que contiene el punto (x, z) del mapa.
export function sampleSurfaceMap(image: SurfaceMapImage, x: number, z: number): [number, number, number] {
  const i = Math.min(image.width - 1, Math.max(0, Math.floor((x - image.bounds.minX) / image.cell)));
  const j = Math.min(image.height - 1, Math.max(0, Math.floor((z - image.bounds.minZ) / image.cell)));
  const k = (j * image.width + i) * 4;
  return [image.data[k], image.data[k + 1], image.data[k + 2]];
}
