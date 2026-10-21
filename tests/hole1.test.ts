import { describe, expect, it } from 'vitest';
import { buildHole } from '../src/world/hole';
import { HOLE_1, HOLE_1_DEF } from '../src/world/hole1';

const { terrain, map, def } = HOLE_1;
const bounds = terrain.bounds;

// Recorre la malla de 1 m de todo el terreno del hoyo.
function forEachPoint(visit: (x: number, z: number) => void): void {
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) visit(x, z);
  }
}

// Distancia de (x, z) a la línea de juego, igual que la usa el mapa.
function distanceToLine(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < def.centerline.length - 1; i++) {
    const a = def.centerline[i];
    const b = def.centerline[i + 1];
    const lengthSq = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = Math.min(1, Math.max(0, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / lengthSq));
    best = Math.min(best, Math.hypot(x - (a.x + t * (b.x - a.x)), z - (a.z + t * (b.z - a.z))));
  }
  return best;
}

describe('Hoyo 1: definición', () => {
  it('es un par 4 con el tee en el origen mirando al rumbo 0', () => {
    expect(def.par).toBe(4);
    expect(def.tee).toEqual({ x: 0, z: 0 });
    expect(def.teeHeadingDeg).toBe(0);
  });

  it('la línea de juego mide entre 270 y 290 m del tee al centro del green', () => {
    let length = 0;
    for (let i = 0; i < def.centerline.length - 1; i++) {
      const a = def.centerline[i];
      const b = def.centerline[i + 1];
      length += Math.hypot(b.x - a.x, b.z - a.z);
    }
    expect(length).toBeGreaterThanOrEqual(270);
    expect(length).toBeLessThanOrEqual(290);
    expect(def.centerline[0]).toEqual(def.tee);
    expect(def.centerline[def.centerline.length - 1]).toEqual(def.green.center);
  });

  it('el dogleg gira entre 30° y 50° hacia la derecha', () => {
    const [a, b, c] = def.centerline;
    const first = { x: b.x - a.x, z: b.z - a.z };
    const second = { x: c.x - b.x, z: c.z - b.z };
    const angle = Math.atan2(first.x * second.z - first.z * second.x, first.x * second.x + first.z * second.z);
    const degrees = (Math.abs(angle) * 180) / Math.PI;
    expect(degrees).toBeGreaterThanOrEqual(30);
    expect(degrees).toBeLessThanOrEqual(50);
    expect(c.x).toBeGreaterThan(b.x); // el green queda a la derecha del tramo recto
  });

  it('la copa sigue el reglamento: 50 a 52 cm de diámetro y 28 cm o más de profundidad', () => {
    expect(def.cup.radius).toBe(0.255);
    expect(def.cup.radius * 2).toBeGreaterThanOrEqual(0.5);
    expect(def.cup.radius * 2).toBeLessThanOrEqual(0.52);
    expect(def.cup.depth).toBeGreaterThanOrEqual(0.28);
    expect(def.cup.position).toEqual(def.green.center);
  });

  it('el terreno cubre todo el hoyo, con el fuera de límites incluido', () => {
    for (const p of def.centerline) {
      expect(p.x - def.roughHalfWidth).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x + def.roughHalfWidth).toBeLessThanOrEqual(bounds.maxX);
      expect(p.z - def.roughHalfWidth).toBeGreaterThanOrEqual(bounds.minZ);
      expect(p.z + def.roughHalfWidth).toBeLessThanOrEqual(bounds.maxZ);
    }
  });
});

describe('Hoyo 1: superficies', () => {
  it('el tee es fairway y la copa está en el green', () => {
    expect(map.surfaceAt(0, 0)).toBe('fairway');
    expect(map.surfaceAt(def.cup.position.x, def.cup.position.z)).toBe('green');
  });

  it('los tres bunkers se ven: ningún centro queda tapado por el green o el agua', () => {
    for (const bunker of def.bunkers) {
      expect(map.surfaceAt(bunker.x, bunker.z)).toBe('sand');
    }
  });

  it('el lago queda a 15 m o más de la línea de juego, a 30 m o más del centro del green y dentro del rough', () => {
    let minToLine = Infinity;
    let maxToLine = 0;
    let minToGreen = Infinity;
    let waterPoints = 0;
    forEachPoint((x, z) => {
      if (map.surfaceAt(x, z) !== 'water') return;
      waterPoints += 1;
      minToLine = Math.min(minToLine, distanceToLine(x, z));
      maxToLine = Math.max(maxToLine, distanceToLine(x, z));
      minToGreen = Math.min(minToGreen, map.distanceToCup(x, z));
    });
    expect(waterPoints).toBeGreaterThan(300); // el lago existe (la elipse mide ~480 m²)
    expect(minToLine).toBeGreaterThanOrEqual(15);
    expect(maxToLine).toBeLessThan(def.roughHalfWidth);
    expect(minToGreen).toBeGreaterThanOrEqual(30);
    expect(map.surfaceAt(0, 0)).not.toBe('water');
    expect(map.surfaceAt(def.cup.position.x, def.cup.position.z)).not.toBe('water');
  });
});

describe('Hoyo 1: relieve', () => {
  it('el desnivel total es de 12 m o menos y el relieve existe', () => {
    let min = Infinity;
    let max = -Infinity;
    forEachPoint((x, z) => {
      const h = terrain.heightAt(x, z);
      min = Math.min(min, h);
      max = Math.max(max, h);
    });
    expect(max - min).toBeLessThanOrEqual(12);
    expect(max - min).toBeGreaterThan(4);
  });

  it('la pendiente máxima es de 6° en fairway y de 15° en rough', () => {
    const worst = { fairway: 0, rough: 0, sand: 0 };
    forEachPoint((x, z) => {
      const surface = map.surfaceAt(x, z);
      if (surface === 'fairway' || surface === 'rough' || surface === 'sand') {
        worst[surface] = Math.max(worst[surface], terrain.slopeDegAt(x, z));
      }
    });
    expect(worst.fairway).toBeLessThanOrEqual(6);
    expect(worst.rough).toBeLessThanOrEqual(15);
    // El fairway tiene pendientes que se notan (el reposo en fairway es 5.7°) pero no extremas.
    expect(worst.fairway).toBeGreaterThan(2);
  });

  it('el tee es plano (menos de 1° a menos de 8 m) y está a altura 0', () => {
    expect(terrain.heightAt(def.tee.x, def.tee.z)).toBe(0);
    forEachPoint((x, z) => {
      if (Math.hypot(x - def.tee.x, z - def.tee.z) < 8) {
        expect(terrain.slopeDegAt(x, z)).toBeLessThan(1);
      }
    });
  });

  it('el terreno es plano (menos de 1°) en 3 m alrededor de la copa', () => {
    for (let r = 0; r <= 3; r += 0.25) {
      for (let k = 0; k < 24; k++) {
        const angle = (k / 24) * Math.PI * 2;
        const x = def.cup.position.x + r * Math.cos(angle);
        const z = def.cup.position.z + r * Math.sin(angle);
        expect(terrain.slopeDegAt(x, z)).toBeLessThan(1);
      }
    }
  });

  it('la pendiente en todo el green es de 3° o menos, pero el green tiene caída', () => {
    let worst = 0;
    forEachPoint((x, z) => {
      if (map.distanceToCup(x, z) <= def.green.radius) worst = Math.max(worst, terrain.slopeDegAt(x, z));
    });
    expect(worst).toBeLessThanOrEqual(3);
    expect(worst).toBeGreaterThan(1.5); // la caída que hace que los putts se lean
  });

  it('el lago está hundido: su centro queda por debajo del terreno de alrededor', () => {
    const lake = def.lakes[0];
    const center = terrain.heightAt(lake.x, lake.z);
    expect(center).toBeLessThanOrEqual(-0.5);
    // Un punto a 20 m del centro, fuera de la elipse, está más alto.
    expect(terrain.heightAt(lake.x - 20, lake.z)).toBeGreaterThan(center + 0.5);
  });
});

describe('Hoyo 1: construcción', () => {
  it('construir el hoyo (terreno incluido) tarda menos de 1 s', () => {
    const start = performance.now();
    const built = buildHole(HOLE_1_DEF);
    const elapsed = performance.now() - start;
    expect(built.terrain.heightAt(30, -100)).toBeDefined();
    expect(elapsed).toBeLessThan(1000);
  });
});
