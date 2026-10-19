import { describe, expect, it } from 'vitest';
import { buildTerrain, FLAT_TERRAIN, type TerrainDef } from '../src/world/terrain';

const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

const HILL_DEF: TerrainDef = {
  bounds: BOUNDS,
  cell: 1,
  edgeFade: 0,
  flatZones: [],
  hills: [{ x: 0, z: 0, radiusX: 40, radiusZ: 30, height: 3 }],
};

const RELIEF_DEF: TerrainDef = {
  bounds: BOUNDS,
  cell: 1,
  edgeFade: 25,
  flatZones: [{ x: 0, z: 60, radius: 10, blend: 15 }],
  hills: [
    { x: -30, z: -20, radiusX: 45, radiusZ: 35, height: 5, rotationDeg: 30 },
    { x: 40, z: 10, radiusX: 30, radiusZ: 28, height: -4 },
    { x: 10, z: 30, radiusX: 20, radiusZ: 25, height: 6 },
  ],
};

// Generador pseudoaleatorio con semilla para que las pruebas sean repetibles.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

describe('buildTerrain: alturas', () => {
  const terrain = buildTerrain(HILL_DEF);

  it('en los nodos vale exactamente la altura de la loma', () => {
    for (const [x, z] of [[0, 0], [10, 5], [-20, 12], [30, -7], [0, -29]]) {
      const s2 = (x / 40) ** 2 + (z / 30) ** 2;
      const expected = 3 * (1 - s2) ** 2;
      expect(Math.abs(terrain.heightAt(x, z) - expected)).toBeLessThan(1e-9);
    }
  });

  it('la cima de la loma vale su altura', () => {
    expect(terrain.heightAt(0, 0)).toBeCloseTo(3, 5);
  });

  it('una loma vale 0 fuera de su radio', () => {
    expect(terrain.heightAt(45, 0)).toBe(0);
    expect(terrain.heightAt(0, -35)).toBe(0);
    expect(terrain.heightAt(80, 80)).toBe(0);
  });

  it('una depresión (altura negativa) baja el suelo', () => {
    const valley = buildTerrain({ ...HILL_DEF, hills: [{ x: 0, z: 0, radiusX: 20, radiusZ: 20, height: -2 }] });
    expect(valley.heightAt(0, 0)).toBeCloseTo(-2, 5);
  });

  it('las lomas se suman', () => {
    const one = { x: 0, z: 0, radiusX: 20, radiusZ: 20, height: 2 };
    const both = buildTerrain({ ...HILL_DEF, hills: [one, one] });
    expect(both.heightAt(0, 0)).toBeCloseTo(4, 5);
  });

  it('la rotación gira la elipse', () => {
    const hill = { x: 0, z: 0, radiusX: 40, radiusZ: 10, height: 2 };
    const plain = buildTerrain({ ...HILL_DEF, hills: [hill] });
    const turned = buildTerrain({ ...HILL_DEF, hills: [{ ...hill, rotationDeg: 90 }] });
    expect(plain.heightAt(30, 0)).toBeGreaterThan(0);
    expect(plain.heightAt(0, 30)).toBe(0);
    expect(turned.heightAt(0, 30)).toBeGreaterThan(0);
    expect(turned.heightAt(30, 0)).toBe(0);
  });

  it('la zona plana deja el suelo en 0 dentro de su radio y sube suave después', () => {
    const flat = buildTerrain({ ...HILL_DEF, flatZones: [{ x: 0, z: 0, radius: 10, blend: 20 }] });
    expect(flat.heightAt(0, 0)).toBe(0);
    expect(flat.heightAt(8, 0)).toBe(0);
    expect(flat.heightAt(20, 0)).toBeGreaterThan(0);
    expect(flat.heightAt(20, 0)).toBeLessThan(buildTerrain(HILL_DEF).heightAt(20, 0));
  });
});

describe('buildTerrain: continuidad', () => {
  const terrain = buildTerrain(RELIEF_DEF);

  it('dos puntos a 0.01 m difieren en menos de 0.01 m de altura', () => {
    const rand = rng(7);
    for (let n = 0; n < 5000; n++) {
      const x = -100 + rand() * 200;
      const z = -100 + rand() * 200;
      const angle = rand() * Math.PI * 2;
      const dh = Math.abs(
        terrain.heightAt(x + 0.01 * Math.cos(angle), z + 0.01 * Math.sin(angle)) - terrain.heightAt(x, z),
      );
      expect(dh).toBeLessThan(0.01);
    }
  });

  it('la altura es continua al cruzar los bordes de las celdas', () => {
    for (const x of [-10, 0, 17, 33]) {
      const eps = 1e-6;
      expect(Math.abs(terrain.heightAt(x - eps, 20.3) - terrain.heightAt(x + eps, 20.3))).toBeLessThan(1e-4);
    }
  });
});

describe('buildTerrain: normal y pendiente', () => {
  const terrain = buildTerrain(RELIEF_DEF);

  it('la normal es unitaria y con y > 0 en todo bounds', () => {
    const rand = rng(11);
    for (let n = 0; n < 5000; n++) {
      const normal = terrain.normalAt(-100 + rand() * 200, -100 + rand() * 200);
      expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 9);
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it('en la cima de una loma simétrica la normal es vertical y la pendiente 0', () => {
    const hill = buildTerrain(HILL_DEF);
    const normal = hill.normalAt(0, 0);
    expect(normal.x).toBeCloseTo(0, 6);
    expect(normal.z).toBeCloseTo(0, 6);
    expect(hill.slopeDegAt(0, 0)).toBeCloseTo(0, 4);
  });

  it('la normal se inclina alejándose de la cuesta arriba', () => {
    const hill = buildTerrain(HILL_DEF);
    // A +x de la cima el suelo baja hacia +x: la normal apunta hacia +x.
    expect(hill.normalAt(15, 0).x).toBeGreaterThan(0);
    expect(hill.normalAt(-15, 0).x).toBeLessThan(0);
    expect(hill.normalAt(0, 12).z).toBeGreaterThan(0);
  });

  it('la pendiente coincide con el gradiente numérico de la altura', () => {
    const hill = buildTerrain(HILL_DEF);
    const x = 12;
    const z = 4;
    const h = 0.01;
    const dhdx = (hill.heightAt(x + h, z) - hill.heightAt(x - h, z)) / (2 * h);
    const dhdz = (hill.heightAt(x, z + h) - hill.heightAt(x, z - h)) / (2 * h);
    const expected = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
    expect(hill.slopeDegAt(x, z)).toBeCloseTo(expected, 1);
  });
});

describe('buildTerrain: bordes', () => {
  const terrain = buildTerrain(RELIEF_DEF);

  it('en los bordes de bounds la altura es 0', () => {
    const rand = rng(3);
    for (let n = 0; n < 200; n++) {
      const t = -100 + rand() * 200;
      expect(terrain.heightAt(-100, t)).toBe(0);
      expect(terrain.heightAt(100, t)).toBe(0);
      expect(terrain.heightAt(t, -100)).toBe(0);
      expect(terrain.heightAt(t, 100)).toBe(0);
    }
  });

  it('fuera de bounds la altura es 0 y la normal (0, 1, 0)', () => {
    for (const [x, z] of [[-150, 0], [150, 20], [0, -101], [0, 500], [-1e6, 1e6]]) {
      expect(terrain.heightAt(x, z)).toBe(0);
      expect(terrain.normalAt(x, z)).toEqual({ x: 0, y: 1, z: 0 });
      expect(terrain.slopeDegAt(x, z)).toBe(0);
    }
  });

  it('el relieve baja suave hacia el borde (sin escalón a 0)', () => {
    const near = Math.abs(terrain.heightAt(-99.5, -20));
    expect(near).toBeLessThan(0.05);
  });
});

describe('FLAT_TERRAIN', () => {
  it('es y = 0 con normal vertical en todas partes', () => {
    expect(FLAT_TERRAIN.heightAt(123, -456)).toBe(0);
    expect(FLAT_TERRAIN.normalAt(123, -456)).toEqual({ x: 0, y: 1, z: 0 });
    expect(FLAT_TERRAIN.slopeDegAt(0, 0)).toBe(0);
  });
});
