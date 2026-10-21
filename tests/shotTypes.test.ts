import { describe, expect, it } from 'vitest';
import { BALL_SPEC } from '../src/physics/bodies';
import {
  DEFAULT_SHOT_TYPE,
  MAX_ACCURACY_DEVIATION_DEG,
  MAX_SPIN,
  SHOT_TYPES,
  SHOT_TYPE_ORDER,
  computeShot,
  nextShotType,
} from '../src/game/shot';
import type { ShotInput, ShotTypeId, Vec3 } from '../src/physics/types';

const origin: Vec3 = { x: 0, y: BALL_SPEC.radius, z: 0 };
const TYPES: ShotTypeId[] = ['powerful', 'long', 'short', 'putt'];

const shot = (shotType: ShotTypeId, overrides: Partial<ShotInput> = {}): ShotInput => ({
  shotType,
  headingDeg: 0,
  power: 1,
  accuracy: 0,
  contact: { x: 0, y: 0 },
  ...overrides,
});

const speedOf = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const elevationOf = (v: Vec3): number => (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI;
const headingOf = (v: Vec3): number => (Math.atan2(v.x, -v.z) * 180) / Math.PI;

describe('tipos de golpe: velocidad', () => {
  it.each<[ShotTypeId, number]>([
    ['powerful', 35],
    ['long', 24],
    ['short', 14],
    ['putt', 7],
  ])('con poder 100 %% y precisión 100 %% el golpe %s sale a %f m/s', (type, speed) => {
    expect(speedOf(computeShot(shot(type), origin).velocity)).toBeCloseTo(speed, 9);
    expect(SHOT_TYPES[type].maxSpeed).toBe(speed);
  });

  it('el poder escala la velocidad desde 0 hasta el máximo de cada tipo', () => {
    for (const type of TYPES) {
      const max = SHOT_TYPES[type].maxSpeed;
      expect(speedOf(computeShot(shot(type, { power: 0 }), origin).velocity)).toBeCloseTo(0, 9);
      expect(speedOf(computeShot(shot(type, { power: 0.5 }), origin).velocity)).toBeCloseTo(max / 2, 9);
      expect(speedOf(computeShot(shot(type, { power: 5 }), origin).velocity)).toBeCloseTo(max, 9); // se recorta
    }
  });
});

describe('tipos de golpe: elevación', () => {
  it.each<[ShotTypeId, number]>([
    ['powerful', 15],
    ['long', 25],
    ['short', 40],
    ['putt', 0],
  ])('el golpe %s sale con %f° de elevación', (type, elevation) => {
    expect(elevationOf(computeShot(shot(type), origin).velocity)).toBeCloseTo(elevation, 9);
  });

  it('la elevación no depende del punto de contacto vertical, que solo cambia el spin', () => {
    for (const type of TYPES) {
      const base = computeShot(shot(type), origin);
      for (const y of [-1, -0.5, 0.5, 1]) {
        const hit = computeShot(shot(type, { contact: { x: 0, y } }), origin);
        expect(hit.velocity).toEqual(base.velocity);
        expect(elevationOf(hit.velocity)).toBeCloseTo(SHOT_TYPES[type].elevationDeg, 9);
      }
    }
  });

  it('cada tipo de golpe tiene su propia elevación: de menos a más globo, Putt < Potente < Largo < Corto', () => {
    expect(SHOT_TYPES.putt.elevationDeg).toBeLessThan(SHOT_TYPES.powerful.elevationDeg);
    expect(SHOT_TYPES.powerful.elevationDeg).toBeLessThan(SHOT_TYPES.long.elevationDeg);
    expect(SHOT_TYPES.long.elevationDeg).toBeLessThan(SHOT_TYPES.short.elevationDeg);
  });
});

describe('tipos de golpe: spin', () => {
  it('Putt no tiene backspin ni efecto lateral, aunque el selector de contacto marque otra cosa', () => {
    for (const contact of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: -0.7, y: 0.7 }, { x: 9, y: -9 }]) {
      const putt = computeShot(shot('putt', { contact }), origin);
      expect(putt.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
      expect(elevationOf(putt.velocity)).toBeCloseTo(0, 9);
    }
  });

  it('Potente, Largo y Corto siguen respondiendo al contacto: backspin, topspin y efecto lateral', () => {
    for (const type of ['powerful', 'long', 'short'] as ShotTypeId[]) {
      const low = computeShot(shot(type, { contact: { x: 0, y: -1 } }), origin).angularVelocity;
      const high = computeShot(shot(type, { contact: { x: 0, y: 1 } }), origin).angularVelocity;
      const side = computeShot(shot(type, { contact: { x: 1, y: 0 } }), origin).angularVelocity;
      expect(low.x).toBeCloseTo(MAX_SPIN, 9);
      expect(high.x).toBeCloseTo(-MAX_SPIN, 9);
      expect(side.y).toBeCloseTo(MAX_SPIN, 9);
    }
  });
});

describe('tipos de golpe: rumbo y precisión', () => {
  it('el rumbo y la precisión valen igual en todos los tipos, incluido el Putt', () => {
    for (const type of TYPES) {
      expect(headingOf(computeShot(shot(type, { headingDeg: 90 }), origin).velocity)).toBeCloseTo(90, 9);
      expect(headingOf(computeShot(shot(type, { accuracy: 1 }), origin).velocity)).toBeCloseTo(MAX_ACCURACY_DEVIATION_DEG, 9);
    }
  });
});

describe('selector de tipo de golpe', () => {
  it('el tipo por defecto es Potente', () => {
    expect(DEFAULT_SHOT_TYPE).toBe('powerful');
  });

  it('el orden es Potente, Largo, Corto, Putt y cubre todos los tipos sin repetir', () => {
    expect(SHOT_TYPE_ORDER).toEqual(['powerful', 'long', 'short', 'putt']);
    expect(new Set(SHOT_TYPE_ORDER).size).toBe(Object.keys(SHOT_TYPES).length);
    for (const id of SHOT_TYPE_ORDER) expect(SHOT_TYPES[id].id).toBe(id);
  });

  it('E avanza al siguiente y Q vuelve al anterior', () => {
    expect(nextShotType('powerful', 1)).toBe('long');
    expect(nextShotType('long', 1)).toBe('short');
    expect(nextShotType('short', 1)).toBe('putt');
    expect(nextShotType('putt', -1)).toBe('short');
    expect(nextShotType('short', -1)).toBe('long');
    expect(nextShotType('long', -1)).toBe('powerful');
  });

  it('se detiene en los extremos y no da la vuelta', () => {
    expect(nextShotType('powerful', -1)).toBe('powerful');
    expect(nextShotType('putt', 1)).toBe('putt');
  });

  it('los nombres para el HUD son los del spec', () => {
    expect(TYPES.map((id) => SHOT_TYPES[id].name)).toEqual(['Potente', 'Largo', 'Corto', 'Putt']);
  });
});
