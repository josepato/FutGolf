import { describe, expect, it } from 'vitest';
import { paintSurfaceMap, sampleSurfaceMap, SURFACE_COLORS, TEXTURE_CELL } from '../src/render/surfaceTexture';
import { HOLE_1_FIELD, testField } from '../src/world/fields';
import { HOLE_1 } from '../src/world/hole1';

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const shaded = (hex: number, k: number): number[] => rgb(hex).map((c) => Math.round(c * k));

const hole = HOLE_1_FIELD;
const image = paintSurfaceMap(hole.terrain.bounds, hole.surfaceAt, hole.isOutOfBounds);
const { def } = HOLE_1;

describe('mapa de superficies pintado', () => {
  it('tiene el tamaño de los límites del terreno a 0.5 m por píxel', () => {
    const b = hole.terrain.bounds;
    expect(image.cell).toBe(TEXTURE_CELL);
    expect(image.width).toBe(Math.ceil((b.maxX - b.minX) / TEXTURE_CELL));
    expect(image.height).toBe(Math.ceil((b.maxZ - b.minZ) / TEXTURE_CELL));
    expect(image.data.length).toBe(image.width * image.height * 4);
  });

  it('cada superficie tiene su color: fairway, rough, green, bunker y agua', () => {
    expect(sampleSurfaceMap(image, 0, 0)).toEqual(rgb(SURFACE_COLORS.fairway)); // el tee
    expect(sampleSurfaceMap(image, 25, -80)).toEqual(rgb(SURFACE_COLORS.rough));
    expect(sampleSurfaceMap(image, def.cup.position.x, def.cup.position.z)).toEqual(rgb(SURFACE_COLORS.green));
    for (const bunker of def.bunkers) expect(sampleSurfaceMap(image, bunker.x, bunker.z)).toEqual(rgb(SURFACE_COLORS.sand));
    const lake = def.lakes[0];
    expect(sampleSurfaceMap(image, lake.x, lake.z)).toEqual(rgb(SURFACE_COLORS.water));
  });

  it('el fuera de límites se ve más oscuro que el rough, con una línea blanca en el borde', () => {
    // A 60 m del eje del tramo recto: OB. Más oscuro que el rough a 25 m.
    expect(sampleSurfaceMap(image, 60, -80)).toEqual(shaded(SURFACE_COLORS.rough, 0.55));
    // La línea blanca cae sobre el borde (a 45 m del eje).
    const onBoundary = sampleSurfaceMap(image, 45 - TEXTURE_CELL / 2, -80);
    expect(onBoundary).toEqual([255, 255, 255]);
  });

  it('sin función de fuera de límites no hay zona oscura ni línea blanca', () => {
    const plain = paintSurfaceMap(hole.terrain.bounds, hole.surfaceAt);
    expect(sampleSurfaceMap(plain, 60, -80)).toEqual(rgb(SURFACE_COLORS.rough));
    expect(sampleSurfaceMap(plain, 45 - TEXTURE_CELL / 2, -80)).toEqual(rgb(SURFACE_COLORS.rough));
  });

  it('todos los píxeles son opacos', () => {
    for (let k = 3; k < image.data.length; k += 4 * 997) expect(image.data[k]).toBe(255);
  });

  it('el campo de prueba pinta sus franjas por z', () => {
    const field = testField(true);
    const test = paintSurfaceMap(field.terrain.bounds, field.surfaceAt, field.isOutOfBounds);
    expect(sampleSurfaceMap(test, 0, -50)).toEqual(rgb(SURFACE_COLORS.fairway));
    expect(sampleSurfaceMap(test, 0, -150)).toEqual(rgb(SURFACE_COLORS.rough));
    expect(sampleSurfaceMap(test, 0, -250)).toEqual(rgb(SURFACE_COLORS.sand));
  });
});
