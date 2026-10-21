import { describe, expect, it } from 'vitest';
import { surfaceAt } from '../src/world/field';
import { TEST_TERRAIN, TEST_TERRAIN_DEF } from '../src/world/testTerrain';
import { buildTerrain } from '../src/world/terrain';

const { bounds } = TEST_TERRAIN_DEF;
const STEP = 1; // m, muestreo de las pruebas

// Recorre todo bounds con un paso de 1 m.
function forEachPoint(visit: (x: number, z: number) => void): void {
  for (let z = bounds.minZ; z <= bounds.maxZ; z += STEP) {
    for (let x = bounds.minX; x <= bounds.maxX; x += STEP) visit(x, z);
  }
}

describe('TEST_TERRAIN_DEF', () => {
  it('el desnivel total es de 12 m o menos', () => {
    let min = Infinity;
    let max = -Infinity;
    forEachPoint((x, z) => {
      const h = TEST_TERRAIN.heightAt(x, z);
      min = Math.min(min, h);
      max = Math.max(max, h);
    });
    expect(max - min).toBeLessThanOrEqual(12);
    expect(max - min).toBeGreaterThan(5); // el relieve existe
  });

  it('la pendiente máxima por franja es 8° en fairway, 20° en rough y 10° en arena', () => {
    type FieldSurface = 'fairway' | 'rough' | 'sand'; // las únicas que tiene el campo de prueba
    const limit: Record<FieldSurface, number> = { fairway: 8, rough: 20, sand: 10 };
    const worst: Record<FieldSurface, number> = { fairway: 0, rough: 0, sand: 0 };
    forEachPoint((x, z) => {
      const surface = surfaceAt(z) as FieldSurface;
      worst[surface] = Math.max(worst[surface], TEST_TERRAIN.slopeDegAt(x, z));
    });
    for (const surface of ['fairway', 'rough', 'sand'] as const) {
      expect(worst[surface]).toBeLessThanOrEqual(limit[surface]);
    }
    // El fairway debe superar su ángulo de reposo (5.7°) en alguna zona: es un efecto buscado.
    expect(worst.fairway).toBeGreaterThan(5.7);
  });

  it('el tee es plano: altura 0 y pendiente menor a 1° a menos de 8 m', () => {
    expect(TEST_TERRAIN.heightAt(0, 0)).toBe(0);
    for (let angle = 0; angle < 360; angle += 10) {
      for (let r = 0; r <= 8; r += 0.5) {
        const x = r * Math.cos((angle * Math.PI) / 180);
        const z = r * Math.sin((angle * Math.PI) / 180);
        expect(TEST_TERRAIN.slopeDegAt(x, z)).toBeLessThan(1);
        expect(TEST_TERRAIN.heightAt(x, z)).toBeLessThan(0.01);
      }
    }
  });

  it('los bordes de bounds valen 0', () => {
    for (let t = 0; t <= 400; t += 5) {
      expect(TEST_TERRAIN.heightAt(bounds.minX + t, bounds.minZ)).toBe(0);
      expect(TEST_TERRAIN.heightAt(bounds.minX + t, bounds.maxZ)).toBe(0);
    }
    for (let t = 0; t <= 480; t += 5) {
      expect(TEST_TERRAIN.heightAt(bounds.minX, bounds.minZ + t)).toBe(0);
      expect(TEST_TERRAIN.heightAt(bounds.maxX, bounds.minZ + t)).toBe(0);
    }
  });

  it('construirlo tarda menos de 1 s', () => {
    const start = performance.now();
    buildTerrain(TEST_TERRAIN_DEF);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
