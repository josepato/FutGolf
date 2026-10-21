import { describe, expect, it } from 'vitest';
import { computeShot, SHOT_TYPES } from '../src/game/shot';
import { settleOnTerrain, simulateUntilStopped } from '../src/physics/simulation';
import type { BallState, ShotTypeId } from '../src/physics/types';
import { HOLE_1_FIELD } from '../src/world/fields';
import { HOLE_1 } from '../src/world/hole1';
import { configFor, maxRange, playHole, playMany } from './helpers/bot';

// Criterios de jugabilidad del SPEC 03 medidos con un jugador simulado (tests/helpers/bot.ts): juega con
// las mismas reglas que el juego, con ruido en el rumbo y el poder, y no es un experto. Es una
// medida, no una prueba humana: sirve para que una afinación futura no rompa el equilibrio sin darse cuenta.

const field = HOLE_1_FIELD;
const config = configFor(field);
const cup = field.cup!.position;
const { terrain, map } = HOLE_1;
const AVERAGE = { aimNoise: 0.25, powerNoise: 0.06 };
const SLOPPY = { aimNoise: 0.5, powerNoise: 0.12 };

const stopped = (x: number, z: number): BallState =>
  settleOnTerrain({ position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, phase: 'stopped' }, config);

describe('el par 4 es alcanzable en 4 golpes, no en 2', () => {
  const average = playMany(field, 60, AVERAGE);

  it('un jugador promedio termina todos los hoyos y la mayoría en par o mejor', () => {
    expect(average.holed).toBe(average.games);
    expect(average.atOrUnderPar / average.games).toBeGreaterThan(0.5); // alcanzable
    expect(average.atOrUnderPar / average.games).toBeLessThan(0.95); // pero no trivial
    expect(average.average).toBeGreaterThan(3.5);
    expect(average.average).toBeLessThan(5);
  });

  it('un jugador más flojo promedia por encima del par (el hoyo se puede perder golpes)', () => {
    const sloppy = playMany(field, 60, SLOPPY);
    expect(sloppy.holed).toBe(sloppy.games);
    expect(sloppy.average).toBeGreaterThan(average.average);
    expect(sloppy.average).toBeGreaterThan(4.2);
  });

  it('el jugador promedio usa el golpe Potente para salir, el Corto para acercarse y el Putt para terminar', () => {
    // Elige el golpe por la distancia que falta: tras una salida de ~136 m todavía faltan más de 97 m, así que
    // vuelve a usar el Potente; el Largo queda para cuando faltan entre 51 y 97 m.
    const used = new Set<ShotTypeId>();
    for (let seed = 1; seed <= 20; seed++) for (const shot of playHole(field, { ...AVERAGE, seed }).shots) used.add(shot.type);
    expect(used.has('powerful')).toBe(true);
    expect(used.has('short')).toBe(true);
    expect(used.has('putt')).toBe(true);
  });

  it('nadie emboca en 2 golpes: la distancia que queda tras el mejor primer golpe supera lo que cubre la copa', () => {
    const lengths: Record<number, number> = {};
    for (let seed = 1; seed <= 60; seed++) {
      const result = playHole(field, { ...AVERAGE, seed });
      lengths[result.strokes] = (lengths[result.strokes] ?? 0) + 1;
    }
    expect(lengths[1] ?? 0).toBe(0);
    expect(lengths[2] ?? 0).toBe(0);
    expect((lengths[3] ?? 0) / 60).toBeLessThan(0.3); // el birdie existe pero no es lo habitual
  });

  it('tras el primer golpe, ninguna combinación probada deja el balón a menos de 60 m de la copa', () => {
    const start = stopped(0, 0);
    let closest = Infinity;
    for (const type of ['powerful', 'long'] as ShotTypeId[]) {
      for (let heading = -10; heading <= 40; heading += 5) {
        for (const power of [0.9, 1]) {
          for (const y of [-0.6, 0, 1]) {
            const shot = computeShot({ shotType: type, headingDeg: heading, power, accuracy: 0, contact: { x: 0, y } }, start.position);
            const end = simulateUntilStopped(shot, config).finalState.position;
            if (field.isOutOfBounds!(end.x, end.z)) continue;
            closest = Math.min(closest, Math.hypot(cup.x - end.x, cup.z - end.z));
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(60);
    expect(closest).toBeLessThan(maxRange('powerful') + 20); // pero sí se puede llegar al green con el segundo golpe
  });

  it('con 4 golpes solo hay alcance si se usan los golpes largos: Potente + Largo + Corto suman más que el hoyo', () => {
    const route = maxRange('powerful') + maxRange('long') + maxRange('short');
    const line = HOLE_1.def.centerline;
    let length = 0;
    for (let i = 0; i < line.length - 1; i++) length += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].z - line[i].z);
    expect(route).toBeGreaterThan(length); // alcanza con tres golpes largos y un putt
    expect(maxRange('powerful') + maxRange('long')).toBeLessThan(length); // dos no llegan
  });
});

describe('el green se lee', () => {
  const decel = 0.035 * 9.81;
  // Putt con la velocidad justa para llegar con ~0.6 m/s, desde (x, z) hacia la copa.
  const putt = (x: number, z: number, headingOffset = 0, powerFactor = 1): boolean => {
    const distance = Math.hypot(cup.x - x, cup.z - z);
    const speed = Math.sqrt(0.36 + 2 * decel * Math.max(0, distance - 0.255));
    const heading = (Math.atan2(cup.x - x, -(cup.z - z)) * 180) / Math.PI + headingOffset;
    const power = Math.min(1, (speed / SHOT_TYPES.putt.maxSpeed) * powerFactor);
    const shot = computeShot({ shotType: 'putt', headingDeg: heading, power, accuracy: 0, contact: { x: 0, y: 0 } }, stopped(x, z).position);
    return simulateUntilStopped(shot, config).finalState.phase === 'holed';
  };
  const onRing = (distance: number, count: number): Array<[number, number]> =>
    Array.from({ length: count }, (_, k): [number, number] => {
      const angle = (k / count) * Math.PI * 2;
      return [cup.x + Math.cos(angle) * distance, cup.z + Math.sin(angle) * distance];
    }).filter(([x, z]) => field.surfaceAt(x, z) === 'green');

  it('la pendiente media del green crece al alejarse de la copa y no pasa de 3°', () => {
    const ring = (a: number, b: number): number => {
      let sum = 0;
      let n = 0;
      for (let x = cup.x - b; x <= cup.x + b; x += 0.5) {
        for (let z = cup.z - b; z <= cup.z + b; z += 0.5) {
          const d = Math.hypot(x - cup.x, z - cup.z);
          if (d >= a && d < b) {
            sum += terrain.slopeDegAt(x, z);
            n += 1;
          }
        }
      }
      return sum / n;
    };
    const near = ring(3, 5);
    const mid = ring(5, 8);
    const far = ring(8, 14);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(mid).toBeGreaterThan(0.6); // hay caída que leer a partir de 5 m
    expect(far).toBeLessThan(2.5);
    for (let x = cup.x - 14; x <= cup.x + 14; x += 1) {
      for (let z = cup.z - 14; z <= cup.z + 14; z += 1) {
        if (map.distanceToCup(x, z) <= 14) expect(terrain.slopeDegAt(x, z)).toBeLessThanOrEqual(3);
      }
    }
  });

  it('a 2–3 m un putt recto emboca siempre y a 8 m la pendiente lo desvía más de la mitad de las veces', () => {
    for (const [x, z] of onRing(3, 12)) expect(putt(x, z)).toBe(true);
    const far = onRing(8, 12);
    const holed = far.filter(([x, z]) => putt(x, z)).length;
    expect(far.length).toBeGreaterThan(6);
    expect(holed / far.length).toBeLessThan(0.5);
  }, 60000);

  it('desde cualquier punto a 5 y 8 m existe un rumbo y un poder que emboca: leer el green sirve', () => {
    for (const distance of [5, 8]) {
      for (const [x, z] of onRing(distance, 8)) {
        let found = false;
        for (const offset of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
          for (const factor of [1, 1.1, 0.9, 1.25, 1.4]) {
            if (putt(x, z, offset, factor)) found = true;
            if (found) break;
          }
          if (found) break;
        }
        expect(found, `putt a ${distance} m desde (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(true);
      }
    }
  }, 120000);
});
