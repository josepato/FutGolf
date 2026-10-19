import { describe, expect, it } from 'vitest';
import { BALL_SPEC, CELESTIAL_BODIES } from '../src/physics/bodies';
import {
  applyBounce,
  isGroundContact,
  simulateFlight,
  simulateUntilStopped,
  stepBall,
  STOP_SPEED,
  type SimConfig,
} from '../src/physics/simulation';
import { SURFACES } from '../src/physics/surfaces';
import { FLAT_TERRAIN } from '../src/world/terrain';
import {
  ACCURACY_WINDOW,
  FALL_DURATION,
  RISE_DURATION,
  SWEET_SPOT,
  accuracyAtFall,
  powerAt,
} from '../src/ui/powerBar';
import {
  BASE_ELEVATION_DEG,
  MAX_ACCURACY_DEVIATION_DEG,
  MAX_EXTRA_ELEVATION_DEG,
  MAX_LAUNCH_SPEED,
  MAX_SPIN,
  PREVIEW_LENGTH,
  PREVIEW_SPACING,
  computeShot,
  elevationDeg,
  previewTrajectory,
  rightVector,
} from '../src/game/shot';
import type { BallState, CelestialBodyId, ShotInput, SurfaceId, Vec3, Wind } from '../src/physics/types';

const NO_WIND: Wind = { speed: 0, headingDeg: 0 };

function configFor(bodyId: CelestialBodyId, wind: Wind = NO_WIND): SimConfig {
  return { ball: BALL_SPEC, body: CELESTIAL_BODIES[bodyId], wind, surfaceAt: () => SURFACES.fairway, terrain: FLAT_TERRAIN };
}

// Misma gravedad que el cuerpo dado pero sin atmósfera.
function airlessConfigFor(bodyId: CelestialBodyId, wind: Wind = NO_WIND): SimConfig {
  return {
    ball: BALL_SPEC,
    body: { ...CELESTIAL_BODIES[bodyId], airDensity: 0 },
    wind,
    surfaceAt: () => SURFACES.fairway,
    terrain: FLAT_TERRAIN,
  };
}

// Campo uniforme de una sola superficie.
function configOn(surface: SurfaceId, bodyId: CelestialBodyId = 'earth'): SimConfig {
  return { ...configFor(bodyId), surfaceAt: () => SURFACES[surface] };
}

// Balón saliendo del origen con rumbo 0 (hacia -z) y elevación en grados.
// Spin al rumbo 0: ω.x > 0 es backspin, ω.x < 0 topspin, ω.y > 0 curva hacia -x.
function launch(speed: number, elevationDeg: number, spin: Vec3 = { x: 0, y: 0, z: 0 }): BallState {
  const el = (elevationDeg * Math.PI) / 180;
  return {
    position: { x: 0, y: BALL_SPEC.radius, z: 0 },
    velocity: { x: 0, y: speed * Math.sin(el), z: -speed * Math.cos(el) },
    angularVelocity: spin,
    phase: 'flying',
  };
}

const relativeError = (actual: number, expected: number): number => Math.abs(actual - expected) / expected;

describe('vuelo sin aire (solo gravedad)', () => {
  it.each<CelestialBodyId>(['earth', 'moon', 'mars', 'jupiter'])(
    'alcance de un tiro a 20 m/s y 45° coincide con v²·sin(2θ)/g en %s',
    (bodyId) => {
      const config = airlessConfigFor(bodyId);
      const outcome = simulateFlight(launch(20, 45), config);
      const expectedRange = (20 * 20 * Math.sin((2 * 45 * Math.PI) / 180)) / config.body.gravity;
      const range = Math.hypot(outcome.landingPosition.x, outcome.landingPosition.z);
      expect(relativeError(range, expectedRange)).toBeLessThan(0.01);
    },
  );

  it('altura máxima coincide con (v·sinθ)²/(2g)', () => {
    const config = airlessConfigFor('earth');
    const outcome = simulateFlight(launch(20, 45), config);
    const expectedApex = (20 * Math.sin(Math.PI / 4)) ** 2 / (2 * config.body.gravity);
    expect(relativeError(outcome.apexY - BALL_SPEC.radius, expectedApex)).toBeLessThan(0.01);
  });

  it.each<CelestialBodyId>(['earth', 'moon'])('balón soltado desde 10 m toca el suelo en √(2h/g) en %s', (bodyId) => {
    const config = airlessConfigFor(bodyId);
    const height = 10;
    const initial: BallState = {
      position: { x: 0, y: BALL_SPEC.radius + height, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      phase: 'flying',
    };
    const outcome = simulateFlight(initial, config);
    const expectedTime = Math.sqrt((2 * height) / config.body.gravity);
    expect(relativeError(outcome.flightTime, expectedTime)).toBeLessThan(0.01);
  });

  it('la dirección del rumbo 0 es hacia -z y no desvía en x', () => {
    const outcome = simulateFlight(launch(20, 45), configFor('earth'));
    expect(outcome.landingPosition.z).toBeLessThan(0);
    expect(Math.abs(outcome.landingPosition.x)).toBeLessThan(1e-9);
  });
});

const horizontalRange = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

describe('arrastre del aire', () => {
  it('con aire el mismo tiro llega menos lejos que sin aire', () => {
    const withAir = simulateFlight(launch(30, 30), configFor('earth'));
    const noAir = simulateFlight(launch(30, 30), airlessConfigFor('earth'));
    expect(horizontalRange(withAir.landingPosition)).toBeLessThan(horizontalRange(noAir.landingPosition));
  });

  it('con aire el balón en caída libre se acerca a la velocidad terminal √(2mg/(ρ·Cd·A))', () => {
    const config = configFor('earth');
    const area = Math.PI * BALL_SPEC.radius ** 2;
    const terminal = Math.sqrt(
      (2 * BALL_SPEC.mass * config.body.gravity) / (config.body.airDensity * BALL_SPEC.dragCoefficient * area),
    );
    const initial: BallState = {
      position: { x: 0, y: BALL_SPEC.radius + 500, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      phase: 'flying',
    };
    const outcome = simulateFlight(initial, config);
    expect(relativeError(Math.abs(outcome.finalState.velocity.y), terminal)).toBeLessThan(0.01);
  });

  it('en la Luna (ρ = 0) el tiro coincide con el de vuelo sin aire', () => {
    const moon = simulateFlight(launch(30, 30), configFor('moon'));
    const expected = (30 * 30 * Math.sin((2 * 30 * Math.PI) / 180)) / CELESTIAL_BODIES.moon.gravity;
    expect(relativeError(horizontalRange(moon.landingPosition), expected)).toBeLessThan(0.01);
  });

  it('Venus (aire denso) acorta el tiro más que la Tierra', () => {
    const venus = simulateFlight(launch(30, 30), configFor('venus'));
    const earth = simulateFlight(launch(30, 30), configFor('earth'));
    expect(horizontalRange(venus.landingPosition)).toBeLessThan(horizontalRange(earth.landingPosition));
  });
});

describe('viento', () => {
  const crosswind: Wind = { speed: 10, headingDeg: 90 }; // sopla hacia +x

  it('un viento de 10 m/s hacia +x desplaza el aterrizaje hacia +x', () => {
    const calm = simulateFlight(launch(30, 30), configFor('earth'));
    const windy = simulateFlight(launch(30, 30), configFor('earth', crosswind));
    expect(Math.abs(calm.landingPosition.x)).toBeLessThan(1e-9);
    expect(windy.landingPosition.x).toBeGreaterThan(1);
  });

  it('un viento en contra (rumbo 180°, hacia +z) acorta el tiro y uno a favor lo alarga', () => {
    const calm = simulateFlight(launch(30, 30), configFor('earth'));
    const headwind = simulateFlight(launch(30, 30), configFor('earth', { speed: 10, headingDeg: 180 }));
    const tailwind = simulateFlight(launch(30, 30), configFor('earth', { speed: 10, headingDeg: 0 }));
    expect(Math.abs(headwind.landingPosition.z)).toBeLessThan(Math.abs(calm.landingPosition.z));
    expect(Math.abs(tailwind.landingPosition.z)).toBeGreaterThan(Math.abs(calm.landingPosition.z));
  });

  it('sin atmósfera el viento no tiene efecto', () => {
    const calm = simulateFlight(launch(30, 30), configFor('moon'));
    const windy = simulateFlight(launch(30, 30), configFor('moon', crosswind));
    expect(windy.landingPosition.x).toBeCloseTo(calm.landingPosition.x, 9);
    expect(windy.landingPosition.z).toBeCloseTo(calm.landingPosition.z, 9);
  });
});

describe('efecto Magnus', () => {
  const backspin: Vec3 = { x: 50, y: 0, z: 0 };
  const topspin: Vec3 = { x: -50, y: 0, z: 0 };
  const sidespin: Vec3 = { x: 0, y: 40, z: 0 };

  it('con backspin el balón llega más alto que sin spin', () => {
    const plain = simulateFlight(launch(30, 30), configFor('earth'));
    const spun = simulateFlight(launch(30, 30, backspin), configFor('earth'));
    expect(spun.apexY).toBeGreaterThan(plain.apexY);
  });

  it('con backspin el balón llega más lejos que sin spin (sustentación)', () => {
    const plain = simulateFlight(launch(30, 20), configFor('earth'));
    const spun = simulateFlight(launch(30, 20, backspin), configFor('earth'));
    expect(horizontalRange(spun.landingPosition)).toBeGreaterThan(horizontalRange(plain.landingPosition));
  });

  it('con topspin el balón llega menos alto que sin spin', () => {
    const plain = simulateFlight(launch(30, 30), configFor('earth'));
    const spun = simulateFlight(launch(30, 30, topspin), configFor('earth'));
    expect(spun.apexY).toBeLessThan(plain.apexY);
  });

  it('con spin lateral ω.y > 0 la trayectoria se desvía hacia -x y con ω.y < 0 hacia +x', () => {
    const left = simulateFlight(launch(30, 30, sidespin), configFor('earth'));
    const right = simulateFlight(launch(30, 30, { x: 0, y: -40, z: 0 }), configFor('earth'));
    expect(left.landingPosition.x).toBeLessThan(-1);
    expect(right.landingPosition.x).toBeGreaterThan(1);
    expect(left.landingPosition.x).toBeCloseTo(-right.landingPosition.x, 6);
  });

  it('la desviación lateral es de un orden de magnitud razonable (1 a 40 m)', () => {
    const outcome = simulateFlight(launch(30, 30, sidespin), configFor('earth'));
    expect(Math.abs(outcome.landingPosition.x)).toBeGreaterThan(1);
    expect(Math.abs(outcome.landingPosition.x)).toBeLessThan(40);
  });

  it.each<CelestialBodyId>(['moon', 'mercury'])('en %s (ρ = 0) el spin no modifica la trayectoria', (bodyId) => {
    const plain = simulateFlight(launch(30, 30), configFor(bodyId));
    const spun = simulateFlight(launch(30, 30, { x: 50, y: 40, z: 0 }), configFor(bodyId));
    expect(spun.landingPosition.x).toBeCloseTo(plain.landingPosition.x, 9);
    expect(spun.landingPosition.z).toBeCloseTo(plain.landingPosition.z, 9);
    expect(spun.apexY).toBeCloseTo(plain.apexY, 9);
  });
});

const kineticEnergy = (s: BallState): number => {
  const speed2 = s.velocity.x ** 2 + s.velocity.y ** 2 + s.velocity.z ** 2;
  const spin2 = s.angularVelocity.x ** 2 + s.angularVelocity.y ** 2 + s.angularVelocity.z ** 2;
  const inertia = BALL_SPEC.momentOfInertiaFactor * BALL_SPEC.mass * BALL_SPEC.radius ** 2;
  return 0.5 * BALL_SPEC.mass * speed2 + 0.5 * inertia * spin2;
};

describe('rebote', () => {
  const impact = (vx: number, vy: number, vz: number, w: Vec3 = { x: 0, y: 0, z: 0 }): BallState => ({
    position: { x: 0, y: BALL_SPEC.radius, z: 0 },
    velocity: { x: vx, y: vy, z: vz },
    angularVelocity: w,
    phase: 'flying',
  });

  it.each<SurfaceId>(['fairway', 'rough', 'sand'])('en %s la energía total tras el rebote es menor que antes', (id) => {
    const before = impact(3, -8, -12, { x: 20, y: 5, z: -10 });
    const after = applyBounce(before, SURFACES[id], BALL_SPEC);
    expect(kineticEnergy(after)).toBeLessThan(kineticEnergy(before));
  });

  it('la velocidad normal se multiplica por la restitución de la superficie', () => {
    const after = applyBounce(impact(0, -10, -5), SURFACES.fairway, BALL_SPEC);
    expect(after.velocity.y).toBeCloseTo(SURFACES.fairway.restitution * 10, 9);
    expect(after.phase).toBe('flying');
  });

  it('con backspin el balón sale más frenado (hacia atrás) que sin spin', () => {
    // Avance de 3 m/s hacia -z: la fricción no llega a saturar el límite de Coulomb sin spin.
    const plain = applyBounce(impact(0, -8, -3), SURFACES.fairway, BALL_SPEC);
    const backspin = applyBounce(impact(0, -8, -3, { x: 80, y: 0, z: 0 }), SURFACES.fairway, BALL_SPEC);
    expect(backspin.velocity.z).toBeGreaterThan(plain.velocity.z);
    expect(backspin.angularVelocity.x).toBeLessThan(80);
  });

  it('un rebote con poca velocidad normal pasa a rodar con el spin acoplado a la velocidad', () => {
    const after = applyBounce(impact(0, -0.5, -4), SURFACES.fairway, BALL_SPEC);
    expect(after.phase).toBe('rolling');
    expect(after.velocity.y).toBe(0);
    expect(after.angularVelocity.x).toBeCloseTo(after.velocity.z / BALL_SPEC.radius, 9);
  });

  it('un balón soltado con aire rebota cada vez menos alto hasta rodar y detenerse', () => {
    const initial: BallState = {
      position: { x: 0, y: BALL_SPEC.radius + 5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      phase: 'flying',
    };
    const outcome = simulateUntilStopped(initial, configOn('fairway'));
    expect(outcome.bounces).toBeGreaterThan(1);
    expect(outcome.finalState.phase).toBe('stopped');
    expect(outcome.finalState.position.y).toBeCloseTo(BALL_SPEC.radius, 9);
  });
});

describe('rodadura y detención', () => {
  const rolling = (speed: number): BallState => ({
    position: { x: 0, y: BALL_SPEC.radius, z: 0 },
    velocity: { x: 0, y: 0, z: -speed },
    angularVelocity: { x: speed / BALL_SPEC.radius, y: 0, z: 0 },
    phase: 'rolling',
  });

  it.each<SurfaceId>(['fairway', 'rough', 'sand'])('rodando a 5 m/s en %s recorre v²/(2·μr·g) y se detiene', (id) => {
    const config = configOn(id);
    const outcome = simulateUntilStopped(rolling(5), config);
    const expected = 25 / (2 * SURFACES[id].rollingResistance * config.body.gravity);
    expect(outcome.finalState.phase).toBe('stopped');
    expect(relativeError(Math.abs(outcome.finalState.position.z), expected)).toBeLessThan(0.01);
    expect(Math.hypot(outcome.finalState.velocity.x, outcome.finalState.velocity.z)).toBeLessThan(STOP_SPEED);
  });

  it('la distancia de rodadura es menor en arena que en rough y menor en rough que en césped', () => {
    const distance = (id: SurfaceId): number =>
      Math.abs(simulateUntilStopped(rolling(5), configOn(id)).finalState.position.z);
    expect(distance('sand')).toBeLessThan(distance('rough'));
    expect(distance('rough')).toBeLessThan(distance('fairway'));
  });

  it.each<SurfaceId>(['fairway', 'rough', 'sand'])('un tiro completo en %s llega a phase = stopped', (id) => {
    const outcome = simulateUntilStopped(launch(30, 25, { x: 40, y: 10, z: 0 }), configOn(id));
    expect(outcome.finalState.phase).toBe('stopped');
    expect(outcome.time).toBeLessThan(120);
  });

  it('un balón detenido o inactivo no se mueve', () => {
    const stopped: BallState = { ...rolling(0), velocity: { x: 0, y: 0, z: 0 }, phase: 'stopped' };
    expect(stepBall(stopped, configOn('fairway'))).toBe(stopped);
  });
});

describe('conversión de golpe a tiro', () => {
  const origin: Vec3 = { x: 0, y: BALL_SPEC.radius, z: 0 };
  const shot = (overrides: Partial<ShotInput> = {}): ShotInput => ({
    headingDeg: 0,
    power: 1,
    accuracy: 0,
    contact: { x: 0, y: 0 },
    ...overrides,
  });
  const speedOf = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
  const headingOf = (v: Vec3): number => (Math.atan2(v.x, -v.z) * 180) / Math.PI;
  const elevationOf = (v: Vec3): number => (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI;

  it('poder 1.0 da una velocidad inicial de 35 m/s y poder 0.5 da la mitad', () => {
    expect(speedOf(computeShot(shot(), origin).velocity)).toBeCloseTo(MAX_LAUNCH_SPEED, 9);
    expect(speedOf(computeShot(shot({ power: 0.5 }), origin).velocity)).toBeCloseTo(MAX_LAUNCH_SPEED / 2, 9);
  });

  it('el rumbo 0 va hacia -z, el 90° hacia +x y el -90° hacia -x', () => {
    expect(headingOf(computeShot(shot({ headingDeg: 0 }), origin).velocity)).toBeCloseTo(0, 9);
    expect(headingOf(computeShot(shot({ headingDeg: 90 }), origin).velocity)).toBeCloseTo(90, 9);
    expect(headingOf(computeShot(shot({ headingDeg: -90 }), origin).velocity)).toBeCloseTo(-90, 9);
  });

  it('un rumbo distinto gira el punto de aterrizaje en el campo sin cambiar el alcance', () => {
    const config = configFor('earth');
    const contact = { x: 0, y: -0.3 };
    const straight = simulateFlight(computeShot(shot({ power: 0.8, contact, headingDeg: 0 }), origin), config);
    const turned = simulateFlight(computeShot(shot({ power: 0.8, contact, headingDeg: 30 }), origin), config);
    const range = horizontalRange(straight.landingPosition);
    expect(Math.abs(straight.landingPosition.x)).toBeLessThan(1e-9);
    expect(relativeError(horizontalRange(turned.landingPosition), range)).toBeLessThan(1e-6);
    expect(relativeError(turned.landingPosition.x, range * Math.sin(Math.PI / 6))).toBeLessThan(1e-6);
  });

  it('la elevación crece al golpear más abajo y baja a 0° al golpear arriba', () => {
    expect(elevationDeg(0)).toBeCloseTo(BASE_ELEVATION_DEG, 9);
    expect(elevationDeg(-1)).toBeCloseTo(BASE_ELEVATION_DEG + MAX_EXTRA_ELEVATION_DEG, 9);
    expect(elevationDeg(1)).toBeCloseTo(0, 9);
    expect(elevationDeg(-0.5)).toBeGreaterThan(elevationDeg(0));
    expect(elevationDeg(0.5)).toBeLessThan(elevationDeg(0));
    expect(elevationOf(computeShot(shot({ contact: { x: 0, y: -1 } }), origin).velocity)).toBeCloseTo(40, 9);
  });

  it('golpear abajo da backspin, arriba topspin, y a los lados spin vertical', () => {
    const low = computeShot(shot({ contact: { x: 0, y: -1 } }), origin).angularVelocity;
    const high = computeShot(shot({ contact: { x: 0, y: 1 } }), origin).angularVelocity;
    const side = computeShot(shot({ contact: { x: 1, y: 0 } }), origin).angularVelocity;
    expect(low.x).toBeCloseTo(MAX_SPIN, 9);
    expect(high.x).toBeCloseTo(-MAX_SPIN, 9);
    expect(side.y).toBeCloseTo(MAX_SPIN, 9);
    expect(side.x).toBeCloseTo(0, 9);
  });

  it('el eje del backspin gira con el rumbo', () => {
    const w = computeShot(shot({ headingDeg: 90, contact: { x: 0, y: -1 } }), origin).angularVelocity;
    const right = rightVector(90);
    expect(w.x).toBeCloseTo(right.x * MAX_SPIN, 9);
    expect(w.z).toBeCloseTo(right.z * MAX_SPIN, 9);
  });

  it('la precisión desvía el rumbo hasta ±8° y 0 no desvía', () => {
    expect(headingOf(computeShot(shot({ accuracy: 0 }), origin).velocity)).toBeCloseTo(0, 9);
    expect(headingOf(computeShot(shot({ accuracy: 1 }), origin).velocity)).toBeCloseTo(MAX_ACCURACY_DEVIATION_DEG, 9);
    expect(headingOf(computeShot(shot({ accuracy: -1 }), origin).velocity)).toBeCloseTo(-MAX_ACCURACY_DEVIATION_DEG, 9);
  });

  it('un golpe con contacto abajo vuela más alto que uno con contacto al centro', () => {
    const config = configFor('earth');
    const centre = simulateFlight(computeShot(shot({ power: 0.8 }), origin), config);
    const low = simulateFlight(computeShot(shot({ power: 0.8, contact: { x: 0, y: -0.6 } }), origin), config);
    expect(low.apexY).toBeGreaterThan(centre.apexY);
  });

  it('un golpe con contacto a un lado curva el balón hacia el lado esperado', () => {
    const config = configFor('earth');
    const hitRight = simulateFlight(computeShot(shot({ power: 0.8, contact: { x: 0.6, y: -0.3 } }), origin), config);
    const hitLeft = simulateFlight(computeShot(shot({ power: 0.8, contact: { x: -0.6, y: -0.3 } }), origin), config);
    expect(hitRight.landingPosition.x).toBeLessThan(-1); // golpe a la derecha curva a la izquierda
    expect(hitLeft.landingPosition.x).toBeGreaterThan(1);
  });

  it('los valores fuera de rango se recortan', () => {
    const crazy = computeShot(shot({ power: 5, accuracy: 9, contact: { x: 9, y: -9 } }), origin);
    expect(speedOf(crazy.velocity)).toBeCloseTo(MAX_LAUNCH_SPEED, 9);
    expect(crazy.angularVelocity.y).toBeCloseTo(MAX_SPIN, 9);
  });
});

describe('barra de golpe', () => {
  it('el poder sube linealmente de 0 a 1 en RISE_DURATION', () => {
    expect(powerAt(0)).toBe(0);
    expect(powerAt(RISE_DURATION / 2)).toBeCloseTo(0.5, 9);
    expect(powerAt(RISE_DURATION)).toBeCloseTo(1, 9);
  });

  it('si no se hace clic, el poder baja de 1 a 0 y sigue subiendo y bajando sin parar', () => {
    expect(powerAt(RISE_DURATION * 1.5)).toBeCloseTo(0.5, 9);
    expect(powerAt(RISE_DURATION * 2)).toBeCloseTo(0, 9);
    expect(powerAt(RISE_DURATION * 2.5)).toBeCloseTo(0.5, 9); // vuelve a subir
    expect(powerAt(RISE_DURATION * 3)).toBeCloseTo(1, 9);
    expect(powerAt(RISE_DURATION * 11)).toBeCloseTo(1, 9); // se sigue repitiendo
    expect(powerAt(RISE_DURATION * 10.5)).toBeCloseTo(0.5, 9);
  });

  it('el poder nunca sale de 0..1', () => {
    for (let t = 0; t < 30; t += 0.037) {
      const power = powerAt(t);
      expect(power).toBeGreaterThanOrEqual(0);
      expect(power).toBeLessThanOrEqual(1);
    }
  });

  it('la precisión es 0 en la marca ideal', () => {
    expect(accuracyAtFall(SWEET_SPOT * FALL_DURATION)).toBeCloseTo(0, 9);
  });

  it('un clic temprano da precisión positiva y uno tardío negativa', () => {
    expect(accuracyAtFall((SWEET_SPOT - 0.05) * FALL_DURATION)).toBeGreaterThan(0);
    expect(accuracyAtFall((SWEET_SPOT + 0.05) * FALL_DURATION)).toBeLessThan(0);
  });

  it('al llegar abajo (sin 3.er clic) la precisión es la desviación máxima -1', () => {
    expect(accuracyAtFall(FALL_DURATION)).toBeCloseTo(-1, 9);
    expect(accuracyAtFall(FALL_DURATION * 2)).toBe(-1);
    expect(SWEET_SPOT + ACCURACY_WINDOW).toBeCloseTo(1, 9); // el borde de la ventana coincide con el final
  });

  it('la precisión se recorta a ±1 y crece con la distancia a la marca', () => {
    expect(accuracyAtFall(0)).toBe(1);
    expect(Math.abs(accuracyAtFall((SWEET_SPOT - 0.1) * FALL_DURATION))).toBeGreaterThan(
      Math.abs(accuracyAtFall((SWEET_SPOT - 0.05) * FALL_DURATION)),
    );
  });
});

describe('detección de contacto con el suelo', () => {
  const state = (vy: number, phase: BallState['phase'] = 'flying'): BallState => ({
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: vy, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    phase,
  });

  it('un rebote que vuelve a subir cuenta como contacto', () => {
    expect(isGroundContact(state(-5), state(3), FLAT_TERRAIN)).toBe(true);
  });

  it('el paso directo de vuelo a rodadura cuenta como contacto', () => {
    expect(isGroundContact(state(-0.2), state(0, 'rolling'), FLAT_TERRAIN)).toBe(true);
  });

  it('seguir en el aire no cuenta como contacto', () => {
    expect(isGroundContact(state(5), state(4), FLAT_TERRAIN)).toBe(false);
    expect(isGroundContact(state(-5), state(-6), FLAT_TERRAIN)).toBe(false);
  });

  it('rodar o estar detenido no cuenta como contacto', () => {
    expect(isGroundContact(state(0, 'rolling'), state(0, 'rolling'), FLAT_TERRAIN)).toBe(false);
    expect(isGroundContact(state(0, 'rolling'), state(0, 'stopped'), FLAT_TERRAIN)).toBe(false);
  });

  it('un tiro completo registra tantos contactos como rebotes', () => {
    const outcome = simulateUntilStopped(launch(30, 25), configOn('fairway'));
    expect(outcome.bounces).toBeGreaterThanOrEqual(1);
  });
});

describe('vista previa del golpe', () => {
  const origin: Vec3 = { x: 0, y: BALL_SPEC.radius, z: 0 };
  const perfect = (overrides: Partial<ShotInput> = {}): ShotInput => ({
    headingDeg: 0,
    power: 1,
    accuracy: 0,
    contact: { x: 0, y: -0.5 },
    ...overrides,
  });
  const pathLength = (points: Vec3[]): number =>
    points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y, p.z - points[i].z), 0);

  it('empieza en el balón y solo cubre el inicio de la trayectoria', () => {
    const points = previewTrajectory(perfect(), origin, configFor('earth'));
    expect(points[0]).toEqual(origin);
    expect(pathLength(points)).toBeLessThanOrEqual(PREVIEW_LENGTH + PREVIEW_SPACING);
    expect(points.length).toBeGreaterThan(10);
  });

  it('sigue la misma trayectoria que el vuelo real de un golpe perfecto', () => {
    const config = configFor('earth');
    const points = previewTrajectory(perfect(), origin, config);
    const real = simulateFlight(computeShot(perfect(), origin), config);
    const last = points[points.length - 1];
    const match = real.trace.reduce((best, p) => Math.min(best, Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z)), Infinity);
    expect(match).toBeLessThan(0.1);
  });

  it('el rumbo gira la vista previa y el spin la curva', () => {
    const config = configFor('earth');
    const straight = previewTrajectory(perfect(), origin, config);
    const turned = previewTrajectory(perfect({ headingDeg: 90 }), origin, config);
    const curved = previewTrajectory(perfect({ contact: { x: 0.8, y: -0.5 } }), origin, config);
    expect(Math.abs(straight[straight.length - 1].x)).toBeLessThan(1e-9);
    expect(turned[turned.length - 1].x).toBeGreaterThan(10);
    expect(curved[curved.length - 1].x).toBeLessThan(-0.1); // golpe a la derecha curva a la izquierda
  });

  it('un tiro rasante sigue por el suelo (rebotes y rodadura) hasta cubrir el largo de la vista previa', () => {
    const points = previewTrajectory(perfect({ contact: { x: 0, y: 0 }, power: 0.3 }), origin, configFor('earth'));
    expect(pathLength(points)).toBeGreaterThan(PREVIEW_LENGTH * 0.9);
    expect(Math.max(...points.map((p) => p.y))).toBeLessThan(1);
    expect(points[points.length - 1].z).toBeLessThan(-PREVIEW_LENGTH * 0.8); // avanza hacia el rumbo
  });

  it('un tiro con elevación casi cero (0.1°) tampoco se queda en un punto', () => {
    const points = previewTrajectory(perfect({ contact: { x: 0, y: 1 } }), origin, configFor('earth'));
    expect(points.length).toBeGreaterThan(10);
    expect(pathLength(points)).toBeGreaterThan(PREVIEW_LENGTH * 0.9);
  });

  it('el cuerpo celeste y el viento cambian la vista previa', () => {
    const earth = previewTrajectory(perfect(), origin, configFor('earth'));
    const moon = previewTrajectory(perfect(), origin, configFor('moon'));
    const windy = previewTrajectory(perfect(), origin, configFor('earth', { speed: 15, headingDeg: 90 }));
    expect(moon[moon.length - 1].y).toBeGreaterThan(earth[earth.length - 1].y);
    expect(windy[windy.length - 1].x).toBeGreaterThan(earth[earth.length - 1].x);
  });
});
