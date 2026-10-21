import { describe, expect, it } from 'vitest';
import { BALL_SPEC, CELESTIAL_BODIES } from '../src/physics/bodies';
import { computeShot } from '../src/game/shot';
import { FIXED_DT, settleOnTerrain, simulateUntilStopped, stepBall, type SimConfig } from '../src/physics/simulation';
import type { BallState, Cup } from '../src/physics/types';
import { FLAT_TERRAIN } from '../src/world/terrain';

const r = BALL_SPEC.radius;
const CUP: Cup = { position: { x: 0, z: -1 }, radius: 0.255, depth: 0.28 };
const RIM_Y = 0; // FLAT_TERRAIN

// `null` = sin copa (con `undefined` rige la copa por defecto).
const config = (cup: Cup | null = CUP): SimConfig => ({
  ball: BALL_SPEC,
  body: CELESTIAL_BODIES.earth,
  wind: { speed: 0, headingDeg: 0 },
  surfaceAt: () => 'green',
  terrain: FLAT_TERRAIN,
  cup: cup ?? undefined,
});

// Balón rodando sin deslizar hacia -z, con el centro en (x, z).
const rolling = (x: number, z: number, speed: number): BallState => ({
  position: { x, y: r, z },
  velocity: { x: 0, y: 0, z: -speed },
  angularVelocity: { x: -speed / r, y: 0, z: 0 },
  phase: 'rolling',
});

// Balón soltado desde reposo a `height` sobre el plano del borde, a d metros del eje de la copa.
const dropped = (d: number, height = 0.4): BallState => ({
  position: { x: d, y: height, z: CUP.position.z },
  velocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  phase: 'flying',
});

const stopOrHole = (state: BallState, cfg: SimConfig): BallState => simulateUntilStopped(state, cfg).finalState;

// Primer punto del recorrido donde el centro está sobre el hueco, rodando hacia el centro:
// justo antes del borde (d = R + 1 mm).
const atEdge = (speed: number): BallState => rolling(0, CUP.position.z + CUP.radius + 0.001, speed);

describe('copa: embocado y salto', () => {
  it('un balón que rueda a 0.5 m/s por el centro de la copa queda embocado', () => {
    const final = stopOrHole(atEdge(0.5), config());
    expect(final.phase).toBe('holed');
  });

  it('un balón que rueda a 7 m/s por el centro no queda embocado: salta la copa', () => {
    const final = stopOrHole(atEdge(7), config());
    expect(final.phase).toBe('stopped');
    expect(final.position.z).toBeLessThan(CUP.position.z - CUP.radius); // siguió de largo
  });

  it('el límite de captura al rodar por el centro está entre 1 y 3.5 m/s', () => {
    for (const speed of [1, 2, 3]) expect(stopOrHole(atEdge(speed), config()).phase).toBe('holed');
    for (const speed of [3.5, 5, 6]) expect(stopOrHole(atEdge(speed), config()).phase).toBe('stopped');
  });

  it('un balón que pasa con el centro a R o más del eje no cambia su trayectoria', () => {
    for (const offset of [0.3, 0.4]) {
      const start = rolling(offset, 0, 1);
      const withCup = simulateUntilStopped(start, config());
      const without = simulateUntilStopped(start, config(null));
      expect(withCup.finalState).toEqual(without.finalState);
      expect(withCup.trace).toEqual(without.trace);
    }
  });

  it('un balón que roza el aro (centro a menos de R del eje) se desvía y no se emboca', () => {
    const final = stopOrHole(rolling(0.25, 0, 1), config());
    expect(final.phase).toBe('stopped');
    expect(Math.abs(final.position.x - 0.25)).toBeGreaterThan(0.01); // el aro lo empujó
  });

  it('un balón con el centro a 0.2 m o menos del eje que cae sobre el hueco queda embocado', () => {
    // Incluye los que se apoyan en el aro (0.145 < d < 0.255): la normal los empuja adentro.
    for (const d of [0, 0.05, 0.1, 0.145, 0.2, 0.25]) {
      expect(stopOrHole(dropped(d), config()).phase).toBe('holed');
    }
  });

  it('un balón que cae con el centro sobre suelo firme (d > R) no se emboca', () => {
    for (const d of [0.26, 0.3, 0.5]) {
      const final = stopOrHole(dropped(d), config());
      expect(final.phase).toBe('stopped');
      expect(final.position.y).toBeCloseTo(r, 6);
    }
  });
});

describe('copa: el estado embocado', () => {
  it('queda en el fondo, entero bajo el plano del borde y dentro del cilindro', () => {
    const final = stopOrHole(atEdge(0.5), config());
    expect(final.phase).toBe('holed');
    expect(final.position.y + r).toBeLessThan(RIM_Y); // toda la esfera bajo el borde
    expect(final.position.y).toBeCloseTo(RIM_Y - CUP.depth + r, 9); // en el fondo
    const d = Math.hypot(final.position.x - CUP.position.x, final.position.z - CUP.position.z);
    expect(d).toBeLessThanOrEqual(CUP.radius - r + 1e-9);
    expect(final.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('un balón embocado no sale: no se mueve en pasos posteriores ni lo reasienta el terreno', () => {
    const holed = stopOrHole(atEdge(0.5), config());
    let state = holed;
    for (let i = 0; i < 600; i++) state = stepBall(state, config(), FIXED_DT);
    expect(state).toEqual(holed);
    expect(settleOnTerrain(holed, config())).toEqual(holed);
  });

  it('solo se emboca con toda la esfera bajo el plano del borde', () => {
    // Barrido de velocidades y desvíos: antes de `holed` siempre queda algo del balón sobre el plano.
    for (const offset of [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) {
      for (const speed of [0.8, 1, 1.5, 2, 3, 5]) {
        let state = rolling(offset, 0, speed);
        let steps = 0;
        while (state.phase !== 'stopped' && state.phase !== 'holed' && steps < 240 * 30) {
          state = stepBall(state, config(), FIXED_DT);
          steps += 1;
          if (state.phase !== 'holed') expect(state.position.y).toBeGreaterThan(RIM_Y - r - 1e-9);
        }
        if (state.phase === 'holed') expect(state.position.y + r).toBeLessThan(RIM_Y);
      }
    }
  });
});

describe('copa: putt', () => {
  const PUTT_CUP: Cup = { position: { x: 0, z: -2 }, radius: 0.255, depth: 0.28 };
  const putt = (speed: number): BallState => rolling(0, 0, speed);

  it('un putt de 2 m en el green llano con la velocidad justa emboca', () => {
    // v0² = v_borde² + 2·μr·g·(2 − R), con v_borde ≈ 0.5 m/s.
    const mu = 0.035;
    const speed = Math.sqrt(0.25 + 2 * mu * 9.81 * (2 - PUTT_CUP.radius));
    expect(stopOrHole(putt(speed), config(PUTT_CUP)).phase).toBe('holed');
  });

  it('con la mitad de esa velocidad no llega a la copa', () => {
    const final = stopOrHole(putt(0.6), config(PUTT_CUP));
    expect(final.phase).toBe('stopped');
    expect(final.position.z).toBeGreaterThan(PUTT_CUP.position.z + PUTT_CUP.radius);
  });

  it('con mucha más velocidad pasa de largo', () => {
    const final = stopOrHole(putt(5), config(PUTT_CUP));
    expect(final.phase).toBe('stopped');
    expect(final.position.z).toBeLessThan(PUTT_CUP.position.z - PUTT_CUP.radius);
  });
});

describe('copa: sin efecto lejos o ausente', () => {
  it('con la copa lejos de la trayectoria, un tiro completo da el mismo resultado que sin copa', () => {
    const shot = computeShot({ shotType: 'powerful', headingDeg: 0, power: 1, accuracy: 0, contact: { x: 0, y: 0 } }, { x: 0, y: r, z: 0 });
    const farCup: Cup = { position: { x: 60, z: -20 }, radius: 0.255, depth: 0.28 };
    const withCup = simulateUntilStopped(shot, config(farCup));
    const without = simulateUntilStopped(shot, config(null));
    expect(withCup.finalState).toEqual(without.finalState);
    expect(withCup.trace).toEqual(without.trace);
    expect(withCup.bounces).toBe(without.bounces);
  });

  it('sin copa nada se emboca: un balón que cae en el mismo punto se detiene sobre el suelo', () => {
    const final = stopOrHole(dropped(0), config(null));
    expect(final.phase).toBe('stopped');
    expect(final.position.y).toBeCloseTo(r, 6);
  });
});
