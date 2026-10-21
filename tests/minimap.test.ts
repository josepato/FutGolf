import { describe, expect, it } from 'vitest';
import { forwardVector } from '../src/game/shot';
import { HOLE_1_FIELD, testField } from '../src/world/fields';
import { HOLE_1 } from '../src/world/hole1';
import { computeMinimapLayout } from '../src/ui/minimap';
import { resultTone } from '../src/ui/holeResult';

const { def } = HOLE_1;
const region = HOLE_1_FIELD.minimap!;

describe('región del minimapa', () => {
  it('el Hoyo 1 tiene región de minimapa y el campo de prueba no', () => {
    expect(region).toBeDefined();
    expect(testField(true).minimap).toBeUndefined();
    expect(testField(false).minimap).toBeUndefined();
  });

  it('envuelve la línea de juego con el rough y el borde del fuera de límites', () => {
    for (const p of def.centerline) {
      expect(p.x - def.roughHalfWidth).toBeGreaterThanOrEqual(region.minX);
      expect(p.x + def.roughHalfWidth).toBeLessThanOrEqual(region.maxX);
      expect(p.z - def.roughHalfWidth).toBeGreaterThanOrEqual(region.minZ);
      expect(p.z + def.roughHalfWidth).toBeLessThanOrEqual(region.maxZ);
    }
  });

  it('incluye el lago, los bunkers, el green y el tee', () => {
    const inside = (x: number, z: number): boolean => x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;
    for (const lake of def.lakes) expect(inside(lake.x, lake.z)).toBe(true);
    for (const bunker of def.bunkers) expect(inside(bunker.x, bunker.z)).toBe(true);
    expect(inside(def.green.center.x, def.green.center.z)).toBe(true);
    expect(inside(def.tee.x, def.tee.z)).toBe(true);
  });
});

describe('diseño del minimapa', () => {
  const layout = computeMinimapLayout(region);

  it('cabe en 180 × 220 px y usa el máximo de la dimensión limitante', () => {
    expect(layout.width).toBeLessThanOrEqual(180);
    expect(layout.height).toBeLessThanOrEqual(220);
    expect(Math.max(layout.width / 180, layout.height / 220)).toBeGreaterThan(0.97);
  });

  it('conserva la proporción: los metros miden lo mismo en x que en z', () => {
    const [x0, z0] = layout.toPixel(0, 0);
    const [x1, z1] = layout.toPixel(10, 10);
    expect(x1 - x0).toBeCloseTo(z1 - z0, 9);
    expect(x1 - x0).toBeCloseTo(10 * layout.scale, 9);
  });

  it('las esquinas de la región quedan dentro del lienzo, con margen', () => {
    const [left, top] = layout.toPixel(region.minX, region.minZ);
    const [right, bottom] = layout.toPixel(region.maxX, region.maxZ);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(right).toBeLessThan(layout.width);
    expect(bottom).toBeLessThan(layout.height);
  });

  it('el tee queda abajo y el green arriba, con el green a la derecha del tee (dogleg a la derecha)', () => {
    const [teeX, teeY] = layout.toPixel(def.tee.x, def.tee.z);
    const [cupX, cupY] = layout.toPixel(def.cup.position.x, def.cup.position.z);
    expect(cupY).toBeLessThan(teeY);
    expect(cupX).toBeGreaterThan(teeX);
    // Y el tee está en la mitad de abajo, el green en la de arriba.
    expect(teeY).toBeGreaterThan(layout.height / 2);
    expect(cupY).toBeLessThan(layout.height / 2);
  });

  it('el rumbo 0 apunta hacia arriba en el minimapa y el rumbo 90° hacia la derecha', () => {
    const [x0, y0] = layout.toPixel(0, -100);
    const north = forwardVector(0);
    const east = forwardVector(90);
    const [nx, ny] = layout.toPixel(0 + north.x * 20, -100 + north.z * 20);
    const [ex, ey] = layout.toPixel(0 + east.x * 20, -100 + east.z * 20);
    expect(ny).toBeLessThan(y0);
    expect(nx).toBeCloseTo(x0, 6);
    expect(ex).toBeGreaterThan(x0);
    expect(ey).toBeCloseTo(y0, 6);
  });

  it('con una región ancha el ancho es la dimensión limitante', () => {
    const wide = computeMinimapLayout({ minX: 0, maxX: 400, minZ: 0, maxZ: 100 });
    expect(wide.width).toBe(180);
    expect(wide.height).toBeLessThan(220);
  });
});

describe('tono del resultado', () => {
  it.each<[number, number, string]>([
    [4, 1, 'great'], // hoyo en uno
    [4, 2, 'great'], // eagle
    [5, 2, 'great'], // albatros
    [4, 3, 'good'], // birdie
    [4, 4, 'even'], // par
    [4, 5, 'bad'], // bogey
    [4, 9, 'bad'],
    [3, 1, 'great'],
  ])('par %i con %i golpes es «%s»', (par, strokes, tone) => {
    expect(resultTone(par, strokes)).toBe(tone);
  });
});
