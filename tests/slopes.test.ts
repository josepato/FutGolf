import { describe, expect, it } from 'vitest';
import { BALL_SPEC, CELESTIAL_BODIES } from '../src/physics/bodies';
import {
  applyBounce,
  FIXED_DT,
  isGroundContact,
  settleOnTerrain,
  simulateFlight,
  simulateUntilStopped,
  stepBall,
  type SimConfig,
} from '../src/physics/simulation';
import { SURFACES } from '../src/physics/surfaces';
import type { BallState, SurfaceId, Terrain, Vec3 } from '../src/physics/types';
import { computeShot, previewTrajectory } from '../src/game/shot';
import { surfaceTypeAt } from '../src/world/field';
import { FLAT_TERRAIN } from '../src/world/terrain';
import { TEST_TERRAIN } from '../src/world/testTerrain';

const G = CELESTIAL_BODIES.earth.gravity;
const R = BALL_SPEC.radius;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

// Plano inclinado analítico: sube hacia +x con el ángulo dado (y = x·tanθ).
function inclinedPlane(angleDeg: number): Terrain {
  const t = Math.tan(toRad(angleDeg));
  const n: Vec3 = { x: -Math.sin(toRad(angleDeg)), y: Math.cos(toRad(angleDeg)), z: 0 };
  return {
    bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
    heightAt: (x) => x * t,
    normalAt: () => n,
    slopeDegAt: () => angleDeg,
  };
}

// Sin atmósfera: la trayectoria es una parábola exacta y se puede resolver a mano.
function airlessOn(terrain: Terrain): SimConfig {
  return {
    ball: BALL_SPEC,
    body: { ...CELESTIAL_BODIES.earth, airDensity: 0 },
    wind: { speed: 0, headingDeg: 0 },
    surfaceAt: () => SURFACES.fairway,
    terrain,
  };
}

const flying = (position: Vec3, velocity: Vec3): BallState => ({
  position,
  velocity,
  angularVelocity: { x: 0, y: 0, z: 0 },
  phase: 'flying',
});

// Distancia del centro al plano tangente, medida sobre la normal.
const distanceToSurface = (terrain: Terrain, p: Vec3): number =>
  (p.y - terrain.heightAt(p.x, p.z)) * terrain.normalAt(p.x, p.z).y;

describe('contacto de vuelo con un plano inclinado', () => {
  const ANGLE = 20;
  const plane = inclinedPlane(ANGLE);
  const config = airlessOn(plane);
  const cos = Math.cos(toRad(ANGLE));
  const tan = Math.tan(toRad(ANGLE));

  it('un balón soltado desde 10 m toca el plano en el instante esperado', () => {
    // Cae en vertical desde x = 0: el centro llega a y = r / cosθ.
    const expected = Math.sqrt((2 * (10 - R / cos)) / G);
    const outcome = simulateFlight(flying({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }), config);
    expect(Math.abs(outcome.flightTime - expected)).toBeLessThan(1e-4);
    expect(outcome.landingPosition.y).toBeCloseTo(R / cos, 9);
  });

  it('el centro del balón queda a un radio del plano en el punto de contacto', () => {
    const outcome = simulateFlight(flying({ x: 3, y: 12, z: -2 }, { x: 4, y: 3, z: 1 }), config);
    expect(distanceToSurface(plane, outcome.landingPosition)).toBeCloseTo(R, 9);
  });

  it('un tiro horizontal hacia la cuesta arriba aterriza antes que en suelo plano', () => {
    const vx = 10;
    const y0 = 5;
    // y0 − g t²/2 − tanθ·vx·t = r/cosθ
    const a = G / 2;
    const b = tan * vx;
    const c = -(y0 - R / cos);
    const expected = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);

    const uphill = simulateFlight(flying({ x: 0, y: y0, z: 0 }, { x: vx, y: 0, z: 0 }), config);
    const onFlat = simulateFlight(flying({ x: 0, y: y0, z: 0 }, { x: vx, y: 0, z: 0 }), airlessOn(FLAT_TERRAIN));
    expect(Math.abs(uphill.flightTime - expected)).toBeLessThan(1e-4);
    expect(Math.abs(uphill.landingPosition.x - vx * expected)).toBeLessThan(1e-3);
    expect(uphill.flightTime).toBeLessThan(onFlat.flightTime);
  });

  it('un tiro horizontal cuesta abajo aterriza después que en suelo plano', () => {
    const vx = -10;
    const y0 = 5;
    const a = G / 2;
    const b = tan * vx;
    const c = -(y0 - R / cos);
    const expected = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);

    const downhill = simulateFlight(flying({ x: 0, y: y0, z: 0 }, { x: vx, y: 0, z: 0 }), config);
    const onFlat = simulateFlight(flying({ x: 0, y: y0, z: 0 }, { x: vx, y: 0, z: 0 }), airlessOn(FLAT_TERRAIN));
    expect(Math.abs(downhill.flightTime - expected)).toBeLessThan(1e-4);
    expect(downhill.flightTime).toBeGreaterThan(onFlat.flightTime);
  });

  it('stepBall detecta el contacto en el instante esperado y no hunde el balón', () => {
    const expected = Math.sqrt((2 * (10 - R / cos)) / G);
    let state = flying({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    let time = 0;
    let contacted = false;
    for (let i = 0; i < 240 * 3 && !contacted; i++) {
      const next = stepBall(state, config);
      contacted = isGroundContact(state, next, plane);
      state = next;
      time += FIXED_DT;
    }
    expect(contacted).toBe(true);
    expect(Math.abs(time - expected)).toBeLessThanOrEqual(FIXED_DT);
    expect(distanceToSurface(plane, state.position)).toBeGreaterThanOrEqual(R - 1e-6);
  });

  it('un balón que sale de la superficie hacia afuera no cuenta como contacto', () => {
    const n = plane.normalAt(0, 0);
    const start = flying({ x: 0, y: R / cos, z: 0 }, { x: n.x * 5, y: n.y * 5, z: 0 });
    let state = start;
    for (let i = 0; i < 20; i++) {
      const next = stepBall(state, config);
      expect(next.phase).toBe('flying');
      expect(isGroundContact(state, next, plane)).toBe(false);
      state = next;
    }
  });
});

describe('isGroundContact con la normal del terreno', () => {
  const plane = inclinedPlane(20);

  it('un rebote que sigue bajando en y pero se aleja de la superficie cuenta como contacto', () => {
    const before = flying({ x: 0, y: 1, z: 0 }, { x: 0, y: -5, z: 0 });
    const after = flying({ x: 0, y: 1, z: 0 }, { x: -3, y: -0.2, z: 0 }); // v·n > 0 aunque vy < 0
    expect(isGroundContact(before, after, plane)).toBe(true);
  });

  it('seguir acercándose a la superficie no cuenta como contacto', () => {
    const before = flying({ x: 0, y: 1, z: 0 }, { x: 0, y: -5, z: 0 });
    const after = flying({ x: 0, y: 1, z: 0 }, { x: 0, y: -6, z: 0 });
    expect(isGroundContact(before, after, plane)).toBe(false);
  });

  it('con FLAT_TERRAIN equivale al signo de vy', () => {
    const before = flying({ x: 0, y: 1, z: 0 }, { x: 0, y: -5, z: 0 });
    expect(isGroundContact(before, flying({ x: 0, y: 1, z: 0 }, { x: 0, y: 3, z: 0 }), FLAT_TERRAIN)).toBe(true);
    expect(isGroundContact(before, flying({ x: 0, y: 1, z: 0 }, { x: 0, y: -3, z: 0 }), FLAT_TERRAIN)).toBe(false);
  });
});

const dotv = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const energy = (s: BallState): number => {
  const inertia = BALL_SPEC.momentOfInertiaFactor * BALL_SPEC.mass * R * R;
  return 0.5 * BALL_SPEC.mass * dotv(s.velocity, s.velocity) + 0.5 * inertia * dotv(s.angularVelocity, s.angularVelocity);
};

describe('rebote en una pendiente', () => {
  const ANGLE = 20;
  const plane = inclinedPlane(ANGLE);
  const n = plane.normalAt(0, 0);
  const fairway = SURFACES.fairway;

  it('soltado desde 10 m, la velocidad normal tras el rebote es restitución · |v·n| (error < 1 %)', () => {
    const config = airlessOn(plane);
    let state = flying({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    let before = state;
    let after = state;
    for (let i = 0; i < 240 * 3; i++) {
      after = stepBall(state, config);
      if (isGroundContact(state, after, plane)) {
        before = state;
        break;
      }
      state = after;
    }
    const impactSpeedNormal = -dotv(before.velocity, n);
    expect(impactSpeedNormal).toBeGreaterThan(0);
    const expected = fairway.restitution * impactSpeedNormal;
    expect(Math.abs(dotv(after.velocity, n) - expected) / expected).toBeLessThan(0.01);
    expect(after.phase).toBe('flying');
  });

  it('con la normal vertical coincide con el rebote plano del SPEC 01', () => {
    const impact = flying({ x: 0, y: R, z: 0 }, { x: 3, y: -8, z: -12 });
    const withDefault = applyBounce({ ...impact, angularVelocity: { x: 20, y: 5, z: -10 } }, fairway, BALL_SPEC);
    const explicit = applyBounce({ ...impact, angularVelocity: { x: 20, y: 5, z: -10 } }, fairway, BALL_SPEC, {
      x: 0,
      y: 1,
      z: 0,
    });
    expect(explicit).toEqual(withDefault);
  });

  it('girar el suelo y el impacto el mismo ángulo gira el resultado (invariancia)', () => {
    const alpha = toRad(ANGLE);
    const rotate = (a: Vec3): Vec3 => ({
      x: a.x * Math.cos(alpha) - a.y * Math.sin(alpha),
      y: a.x * Math.sin(alpha) + a.y * Math.cos(alpha),
      z: a.z,
    });
    const flat = applyBounce(
      { ...flying({ x: 0, y: R, z: 0 }, { x: 3, y: -8, z: -12 }), angularVelocity: { x: 20, y: 5, z: -10 } },
      fairway,
      BALL_SPEC,
    );
    const tilted = applyBounce(
      {
        ...flying({ x: 0, y: R, z: 0 }, rotate({ x: 3, y: -8, z: -12 })),
        angularVelocity: rotate({ x: 20, y: 5, z: -10 }),
      },
      fairway,
      BALL_SPEC,
      n,
    );
    for (const key of ['velocity', 'angularVelocity'] as const) {
      const expected = rotate(flat[key]);
      expect(tilted[key].x).toBeCloseTo(expected.x, 9);
      expect(tilted[key].y).toBeCloseTo(expected.y, 9);
      expect(tilted[key].z).toBeCloseTo(expected.z, 9);
    }
  });

  it.each(['fairway', 'rough', 'sand'] as const)('en %s la energía total tras el rebote es menor que antes', (id) => {
    const before = {
      ...flying({ x: 0, y: R, z: 0 }, { x: 4, y: -9, z: -6 }),
      angularVelocity: { x: 30, y: 8, z: -15 },
    };
    const after = applyBounce(before, SURFACES[id], BALL_SPEC, n);
    expect(energy(after)).toBeLessThan(energy(before));
  });

  it('con poca velocidad normal pasa a rodar con la velocidad sobre el plano y el spin acoplado', () => {
    const slow = flying({ x: 0, y: R, z: 0 }, { x: 0, y: -0.3, z: -2 });
    const after = applyBounce(slow, fairway, BALL_SPEC, n);
    expect(after.phase).toBe('rolling');
    expect(Math.abs(dotv(after.velocity, n))).toBeLessThan(1e-9); // sobre el plano
    // Sin deslizar: la velocidad del punto de contacto es cero.
    const w = after.angularVelocity;
    const contact = {
      x: after.velocity.x - R * (w.y * n.z - w.z * n.y),
      y: after.velocity.y - R * (w.z * n.x - w.x * n.z),
      z: after.velocity.z - R * (w.x * n.y - w.y * n.x),
    };
    expect(Math.hypot(contact.x, contact.y, contact.z)).toBeLessThan(1e-9);
  });
});

// --- Rodadura en pendientes ---

const F = BALL_SPEC.momentOfInertiaFactor;

const onSurface = (terrain: Terrain, surface: SurfaceId): SimConfig => ({
  ...airlessOn(terrain),
  surfaceAt: () => SURFACES[surface],
});

// Balón rodando sin deslizar sobre `terrain` en (x, z) con velocidad tangente `velocity`.
function rollingOn(terrain: Terrain, x: number, z: number, velocity: Vec3): BallState {
  const n = terrain.normalAt(x, z);
  const spin = { x: (n.y * velocity.z - n.z * velocity.y) / R, y: (n.z * velocity.x - n.x * velocity.z) / R, z: (n.x * velocity.y - n.y * velocity.x) / R };
  const h = terrain.heightAt(x, z) + R / n.y;
  return { position: { x, y: h, z }, velocity, angularVelocity: spin, phase: 'rolling' };
}

// Cuesta abajo en el plano inclinado (sube hacia +x): hacia -x.
const downhill = (angleDeg: number, speed: number): Vec3 => ({
  x: -Math.cos(toRad(angleDeg)) * speed,
  y: -Math.sin(toRad(angleDeg)) * speed,
  z: 0,
});

function runSteps(initial: BallState, config: SimConfig, steps: number): BallState {
  let state = initial;
  for (let i = 0; i < steps; i++) state = stepBall(state, config);
  return state;
}

describe('rodadura en pendientes', () => {
  it.each<[SurfaceId, number]>([
    ['sand', 5],
    ['fairway', 10],
    ['rough', 25],
  ])('en %s a %s° cuesta abajo la aceleración es g·sinθ/(1+f) − μr·g·cosθ (error < 2 %)', (surface, angle) => {
    const plane = inclinedPlane(angle);
    const v0 = 3;
    const steps = 24; // 0.1 s
    const after = runSteps(rollingOn(plane, 0, 0, downhill(angle, v0)), onSurface(plane, surface), steps);
    expect(after.phase).toBe('rolling');
    const measured = (Math.hypot(after.velocity.x, after.velocity.y) - v0) / (steps * FIXED_DT);
    const theta = toRad(angle);
    const expected = (G * Math.sin(theta)) / (1 + F) - SURFACES[surface].rollingResistance * G * Math.cos(theta);
    expect(Math.abs(measured - expected) / Math.abs(expected)).toBeLessThan(0.02);
  });

  it('cuesta arriba frena con g·sinθ/(1+f) + μr·g·cosθ', () => {
    const angle = 12;
    const plane = inclinedPlane(angle);
    const up = downhill(angle, -6); // misma dirección invertida
    const steps = 24;
    const after = runSteps(rollingOn(plane, 0, 0, up), onSurface(plane, 'fairway'), steps);
    const measured = (6 - Math.hypot(after.velocity.x, after.velocity.y)) / (steps * FIXED_DT);
    const theta = toRad(angle);
    const expected = (G * Math.sin(theta)) / (1 + F) + SURFACES.fairway.rollingResistance * G * Math.cos(theta);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.02);
  });

  it('el balón se mueve por el plano, sin hundirse ni flotar', () => {
    const plane = inclinedPlane(15);
    let state = rollingOn(plane, 0, 0, downhill(15, 4));
    for (let i = 0; i < 300; i++) {
      state = stepBall(state, onSurface(plane, 'fairway'));
      if (state.phase !== 'rolling') break;
      expect(distanceToSurface(plane, state.position)).toBeCloseTo(R, 9);
      expect(Math.abs(dotv(state.velocity, plane.normalAt(0, 0)))).toBeLessThan(1e-9);
    }
  });

  it.each<[SurfaceId, number]>([
    ['fairway', 4],
    ['fairway', 5.5],
    ['rough', 22],
    ['sand', 20],
    ['sand', 44],
  ])('en reposo sobre %s a %s° se queda detenido (bajo el ángulo de reposo)', (surface, angle) => {
    const plane = inclinedPlane(angle);
    const state = rollingOn(plane, 0, 0, { x: 0, y: 0, z: 0 });
    const after = stepBall(state, onSurface(plane, surface));
    expect(after.phase).toBe('stopped');
    expect(after.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(after.position).toEqual(state.position);
  });

  it.each<[SurfaceId, number]>([
    ['fairway', 6],
    ['fairway', 8],
    ['rough', 24],
    ['sand', 46],
  ])('en reposo sobre %s a %s° (sobre el ángulo de reposo) empieza a rodar cuesta abajo', (surface, angle) => {
    const plane = inclinedPlane(angle);
    const config = onSurface(plane, surface);
    const after = runSteps(rollingOn(plane, 0, 0, { x: 0, y: 0, z: 0 }), config, 240);
    expect(after.phase).toBe('rolling');
    expect(after.position.x).toBeLessThan(0); // cuesta abajo = hacia -x
    // Parte del reposo con aceleración constante: tras 1 s su velocidad es a·t (a puede ser pequeña).
    const theta = toRad(angle);
    const accel = (G * Math.sin(theta)) / (1 + F) - SURFACES[surface].rollingResistance * G * Math.cos(theta);
    expect(accel).toBeGreaterThan(0);
    expect(Math.abs(Math.hypot(after.velocity.x, after.velocity.y) - accel) / accel).toBeLessThan(0.05);
  });

  it('en fairway a 8° rueda y no se detiene hasta que la pendiente baja', () => {
    // Rampa de 8° entre x = 0 y x = -40 que desemboca en suelo plano.
    const t = Math.tan(toRad(8));
    const n = { x: -Math.sin(toRad(8)), y: Math.cos(toRad(8)), z: 0 };
    const ramp: Terrain = {
      bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
      heightAt: (x) => t * Math.min(0, Math.max(-40, x)),
      normalAt: (x) => (x < 0 && x > -40 ? n : { x: 0, y: 1, z: 0 }),
      slopeDegAt: (x) => (x < 0 && x > -40 ? 8 : 0),
    };
    let state = rollingOn(ramp, -2, 0, { x: 0, y: 0, z: 0 });
    let time = 0;
    while (state.phase === 'rolling' && time < 600) {
      state = stepBall(state, onSurface(ramp, 'fairway'));
      time += FIXED_DT;
      // Mientras siga en la rampa, la pendiente vence a la resistencia: no puede haberse detenido.
      if (state.position.x > -39) expect(state.phase).toBe('rolling');
    }
    expect(state.phase).toBe('stopped');
    expect(state.position.x).toBeLessThan(-40); // se detuvo ya en el plano
  });

  it('en una cima en arista con suficiente velocidad despega y vuelve a tocar el suelo', () => {
    const angle = 20;
    const t = Math.tan(toRad(angle));
    const s = Math.sin(toRad(angle));
    const c = Math.cos(toRad(angle));
    const ridge: Terrain = {
      bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
      heightAt: (x) => -t * Math.abs(x),
      normalAt: (x) => (x < 0 ? { x: -s, y: c, z: 0 } : { x: s, y: c, z: 0 }),
      slopeDegAt: () => angle,
    };
    const config = onSurface(ridge, 'fairway');
    let state = rollingOn(ridge, -10, 0, { x: 9 * c, y: 9 * s, z: 0 });
    let tookOff = false;
    let landedAfterTakeoff = false;
    for (let i = 0; i < 240 * 20 && state.phase !== 'stopped'; i++) {
      const before = state.phase;
      state = stepBall(state, config);
      if (before === 'rolling' && state.phase === 'flying') tookOff = true;
      if (tookOff && before === 'flying' && state.phase === 'rolling') landedAfterTakeoff = true;
    }
    expect(tookOff).toBe(true);
    expect(landedAfterTakeoff).toBe(true);
    expect(state.phase).toBe('rolling'); // del otro lado hay 20°, sobre el ángulo de reposo
    expect(state.position.x).toBeGreaterThan(0);
  });

  it('a poca velocidad sobre la misma cima no despega', () => {
    const angle = 20;
    const t = Math.tan(toRad(angle));
    const s = Math.sin(toRad(angle));
    const c = Math.cos(toRad(angle));
    const ridge: Terrain = {
      bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
      heightAt: (x) => -t * Math.abs(x),
      normalAt: (x) => (x < 0 ? { x: -s, y: c, z: 0 } : { x: s, y: c, z: 0 }),
      slopeDegAt: () => angle,
    };
    const config = onSurface(ridge, 'fairway');
    // Con v0 = 1.1 m/s a 0.2 m de la arista llega con ~0.34 m/s: v·sin(2·20°) ≈ 0.22 < 0.3.
    let state = rollingOn(ridge, -0.2, 0, { x: 1.1 * c, y: 1.1 * s, z: 0 });
    for (let i = 0; i < 240 * 2; i++) {
      state = stepBall(state, config);
      expect(state.phase).toBe('rolling');
    }
    expect(state.position.x).toBeGreaterThan(0); // pasó la arista y baja por el otro lado
  });

  it('la energía mecánica de un balón que rueda cuesta abajo no aumenta de un paso al siguiente', () => {
    const plane = inclinedPlane(10);
    const config = onSurface(plane, 'fairway');
    const mass = BALL_SPEC.mass;
    const inertia = F * mass * R * R;
    const energyOf = (b: BallState): number =>
      0.5 * mass * dotv(b.velocity, b.velocity) + 0.5 * inertia * dotv(b.angularVelocity, b.angularVelocity) + mass * G * b.position.y;

    let state = rollingOn(plane, 0, 0, downhill(10, 2));
    let previous = energyOf(state);
    for (let i = 0; i < 240 * 5; i++) {
      state = stepBall(state, config);
      const e = energyOf(state);
      expect(e).toBeLessThanOrEqual(previous + 1e-9);
      previous = e;
    }
    expect(state.phase).toBe('rolling');
  });
});

describe('cambio de terreno (settleOnTerrain)', () => {
  const rest = (terrain: Terrain, x: number, z: number): number =>
    terrain.heightAt(x, z) + R / terrain.normalAt(x, z).y;
  const quiet = (phase: BallState['phase'], y = R): BallState => ({
    position: { x: 0, y, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    phase,
  });

  it('un balón detenido queda sobre la nueva superficie', () => {
    const plane = inclinedPlane(4);
    const after = settleOnTerrain(quiet('stopped'), onSurface(plane, 'fairway'));
    expect(after.position.y).toBeCloseTo(rest(plane, 0, 0), 12);
    expect(after.phase).toBe('stopped'); // 4° está bajo el ángulo de reposo del fairway (5.7°)
  });

  it('si la pendiente supera el ángulo de reposo, el balón detenido pasa a rodar con velocidad 0', () => {
    const plane = inclinedPlane(8);
    const after = settleOnTerrain(quiet('stopped'), onSurface(plane, 'fairway'));
    expect(after.phase).toBe('rolling');
    expect(after.velocity).toEqual({ x: 0, y: 0, z: 0 });
    const moved = runSteps(after, onSurface(plane, 'fairway'), 120);
    expect(moved.position.x).toBeLessThan(0); // cuesta abajo
  });

  it('en arena a 20° (bajo su ángulo de reposo de 45°) sigue detenido', () => {
    const after = settleOnTerrain(quiet('stopped'), onSurface(inclinedPlane(20), 'sand'));
    expect(after.phase).toBe('stopped');
  });

  it('un balón en el tee (idle) sobre terreno plano no cambia de fase', () => {
    expect(settleOnTerrain(quiet('idle'), airlessOn(FLAT_TERRAIN)).phase).toBe('idle');
  });

  it('un balón que rueda gira su velocidad al nuevo plano conservando el módulo', () => {
    const plane = inclinedPlane(15);
    const before: BallState = { ...quiet('rolling'), velocity: { x: 0, y: 0, z: -5 } }; // z es horizontal y tangente
    const after = settleOnTerrain(before, onSurface(plane, 'fairway'));
    expect(after.phase).toBe('rolling');
    expect(Math.abs(dotv(after.velocity, plane.normalAt(0, 0)))).toBeLessThan(1e-9);
    expect(Math.hypot(after.velocity.x, after.velocity.y, after.velocity.z)).toBeCloseTo(5, 9);
  });

  it('un balón en el aire solo se sube si quedó bajo el nuevo suelo', () => {
    const hill = raisedPlateau();
    const high = quiet('flying', 50);
    expect(settleOnTerrain(high, onSurface(hill, 'fairway')).position.y).toBe(50);
    const low = settleOnTerrain(quiet('flying', R), onSurface(hill, 'fairway'));
    expect(low.position.y).toBeGreaterThan(R); // el terreno nuevo está más alto en (0, 0)
    expect(low.phase).toBe('flying');
  });
});

// Meseta plana a 3 m de altura, para probar el cambio de suelo bajo un balón.
function raisedPlateau(): Terrain {
  return {
    bounds: { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity },
    heightAt: () => 3,
    normalAt: () => ({ x: 0, y: 1, z: 0 }),
    slopeDegAt: () => 0,
  };
}

describe('el mismo tiro con relieve y con campo plano', () => {
  const configOn = (terrain: Terrain): SimConfig => ({
    ball: BALL_SPEC,
    body: CELESTIAL_BODIES.earth,
    wind: { speed: 0, headingDeg: 0 },
    surfaceAt: surfaceTypeAt,
    terrain,
  });
  const tee: Vec3 = { x: 0, y: R, z: 0 };

  it('aterriza en lugares distintos', () => {
    const shot = computeShot({ headingDeg: 20, power: 0.8, accuracy: 0, contact: { x: 0, y: -0.5 } }, tee);
    const relief = simulateFlight(shot, configOn(TEST_TERRAIN)).landingPosition;
    const flat = simulateFlight(shot, configOn(FLAT_TERRAIN)).landingPosition;
    expect(Math.hypot(relief.x - flat.x, relief.z - flat.z)).toBeGreaterThan(0.5);
    expect(relief.y).toBeGreaterThan(flat.y); // cae sobre una loma
  });

  it.each([
    { headingDeg: 0, power: 1, contact: { x: 0, y: -0.6 } },
    { headingDeg: 40, power: 0.9, contact: { x: 0.3, y: -0.8 } },
    { headingDeg: -35, power: 0.7, contact: { x: -0.4, y: 0.2 } },
    { headingDeg: 10, power: 1, contact: { x: 0, y: 0.5 } },
  ])('la vista previa coincide con el vuelo real a menos de 10 cm (%j)', (spec) => {
    const config = configOn(TEST_TERRAIN);
    const input = { ...spec, accuracy: 0 };
    const preview = previewTrajectory(input, tee, config);
    const real = simulateUntilStopped(computeShot(input, tee), config).trace;
    expect(preview.length).toBeGreaterThan(10);
    for (const point of preview) {
      const nearest = Math.min(...real.map((p) => Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z)));
      expect(nearest).toBeLessThan(0.1);
    }
  });
});
