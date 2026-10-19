import type { BallSpec, BallState, CelestialBody, SurfaceType, Vec3, Wind } from './types';

// Paso de simulación fijo, integrado con RK4.
export const FIXED_DT = 1 / 240; // s

export interface SimConfig {
  ball: BallSpec;
  body: CelestialBody;
  wind: Wind;
  surfaceAt: (position: Vec3) => SurfaceType; // superficie bajo el balón
}

// Estado que integra RK4. El spin se mantiene constante durante el vuelo.
interface Kinematics {
  position: Vec3;
  velocity: Vec3;
  angularVelocity: Vec3;
}

interface Derivative {
  dPosition: Vec3; // = velocidad
  dVelocity: Vec3; // = aceleración
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

// Velocidad del aire hacia donde sopla el viento. Rumbo 0 = hacia -z; crece en
// sentido horario visto desde arriba, así que 90° sopla hacia +x.
export function windVelocity(wind: Wind): Vec3 {
  const heading = (wind.headingDeg * Math.PI) / 180;
  return { x: wind.speed * Math.sin(heading), y: 0, z: -wind.speed * Math.cos(heading) };
}

// Aceleración del balón en vuelo: gravedad, arrastre y Magnus.
// Con ρ = 0 no hay arrastre ni Magnus y el viento no tiene efecto.
function acceleration(state: Kinematics, config: SimConfig): Vec3 {
  const { ball, body, wind } = config;
  const gravity: Vec3 = { x: 0, y: -body.gravity, z: 0 };
  if (body.airDensity === 0) return gravity;

  const relative = add(state.velocity, scale(windVelocity(wind), -1)); // v_rel = v − viento
  const area = Math.PI * ball.radius * ball.radius;
  // F = −½ ρ Cd A |v_rel| v_rel  →  a = F / m
  const speed = norm(relative);
  const k = (-0.5 * body.airDensity * ball.dragCoefficient * area * speed) / ball.mass;
  const drag = scale(relative, k);

  return add(add(gravity, drag), magnus(state.angularVelocity, relative, speed, config));
}

// Sustentación de Magnus: ½ ρ CL A |v_rel|² en la dirección de ω × v_rel,
// con CL = 1 / (2 + 1/S) y S = r |ω| / |v_rel|. Con backspin (ω = +x al
// rumbo 0) el balón sube; con spin lateral se curva hacia el lado de ω × v.
function magnus(omega: Vec3, relative: Vec3, speed: number, config: SimConfig): Vec3 {
  const { ball, body } = config;
  const spin = norm(omega);
  if (spin === 0 || speed === 0) return { x: 0, y: 0, z: 0 };

  const direction = cross(omega, relative);
  const directionNorm = norm(direction);
  if (directionNorm === 0) return { x: 0, y: 0, z: 0 };

  const spinRatio = (ball.radius * spin) / speed;
  const lift = 1 / (2 + 1 / spinRatio);
  const area = Math.PI * ball.radius * ball.radius;
  const accel = (0.5 * body.airDensity * lift * area * speed * speed) / ball.mass;
  return scale(direction, accel / directionNorm);
}

function evaluate(state: Kinematics, config: SimConfig): Derivative {
  return { dPosition: state.velocity, dVelocity: acceleration(state, config) };
}

function advance(state: Kinematics, d: Derivative, dt: number): Kinematics {
  return {
    angularVelocity: state.angularVelocity,
    position: add(state.position, scale(d.dPosition, dt)),
    velocity: add(state.velocity, scale(d.dVelocity, dt)),
  };
}

// Un paso RK4 de vuelo libre.
export function stepFlight(state: BallState, config: SimConfig, dt: number = FIXED_DT): BallState {
  const k0: Kinematics = {
    position: state.position,
    velocity: state.velocity,
    angularVelocity: state.angularVelocity,
  };
  const k1 = evaluate(k0, config);
  const k2 = evaluate(advance(k0, k1, dt / 2), config);
  const k3 = evaluate(advance(k0, k2, dt / 2), config);
  const k4 = evaluate(advance(k0, k3, dt), config);

  const weigh = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 =>
    scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6);

  return {
    ...state,
    position: add(state.position, weigh(k1.dPosition, k2.dPosition, k3.dPosition, k4.dPosition)),
    velocity: add(state.velocity, weigh(k1.dVelocity, k2.dVelocity, k3.dVelocity, k4.dVelocity)),
  };
}

export interface FlightOutcome {
  landingPosition: Vec3; // centro del balón en el primer contacto con el suelo
  flightTime: number; // s
  apexY: number; // m, altura máxima del centro del balón
  trace: Vec3[]; // posiciones del centro, una por paso
  finalState: BallState; // estado en el primer paso bajo el suelo
}

const MAX_FLIGHT_TIME = 600; // s, tope de seguridad

// Simula el vuelo hasta el primer contacto con el suelo: el centro del balón
// baja hasta y = radio. El instante exacto se interpola entre dos pasos.
export function simulateFlight(initial: BallState, config: SimConfig, dt: number = FIXED_DT): FlightOutcome {
  const groundY = config.ball.radius;
  let state: BallState = { ...initial, phase: 'flying' };
  let time = 0;
  let apexY = state.position.y;
  const trace: Vec3[] = [state.position];

  while (time < MAX_FLIGHT_TIME) {
    const next = stepFlight(state, config, dt);
    const crossed = state.position.y > groundY && next.position.y <= groundY;

    if (crossed) {
      const fraction = (state.position.y - groundY) / (state.position.y - next.position.y);
      const landingPosition: Vec3 = {
        x: state.position.x + (next.position.x - state.position.x) * fraction,
        y: groundY,
        z: state.position.z + (next.position.z - state.position.z) * fraction,
      };
      trace.push(landingPosition);
      return {
        landingPosition,
        flightTime: time + dt * fraction,
        apexY,
        trace,
        finalState: next,
      };
    }

    state = next;
    time += dt;
    apexY = Math.max(apexY, state.position.y);
    trace.push(state.position);
  }

  return { landingPosition: state.position, flightTime: time, apexY, trace, finalState: state };
}

// --- Rebote, rodadura y detención ---

// Tras un rebote, si la velocidad normal es menor que esto el balón pasa a rodar.
export const ROLLING_THRESHOLD = 0.5; // m/s
// Por debajo de esta velocidad horizontal el balón se considera detenido.
export const STOP_SPEED = 0.05; // m/s

// Impacto con el suelo (plano y = 0, centro del balón en y = radio, vy < 0).
// La componente normal se multiplica por −restitución. La tangencial recibe un
// impulso de fricción de Coulomb (limitado por μ·J_normal) que también cambia
// el spin. Si queda poca velocidad normal pasa a rodar con el spin acoplado.
export function applyBounce(state: BallState, surface: SurfaceType, ball: BallSpec): BallState {
  const { radius, momentOfInertiaFactor: f } = ball;
  const { velocity: v, angularVelocity: w } = state;
  const normalSpeed = -v.y; // > 0 al impactar

  // Velocidad del punto de contacto (r_c = −r·ŷ): u = v + ω × r_c, componentes x y z.
  const ux = v.x + w.z * radius;
  const uz = v.z - w.x * radius;
  const slip = Math.hypot(ux, uz);

  let dvx = 0;
  let dvz = 0;
  if (slip > 0) {
    const maxImpulse = surface.slidingFriction * (1 + surface.restitution) * normalSpeed; // μ·J_n / m
    const stickImpulse = slip / (1 + 1 / f); // el que anula el deslizamiento
    const impulse = Math.min(maxImpulse, stickImpulse);
    dvx = (-ux / slip) * impulse;
    dvz = (-uz / slip) * impulse;
  }

  const velocity: Vec3 = { x: v.x + dvx, y: surface.restitution * normalSpeed, z: v.z + dvz };
  // Δω = (r_c × J) / I con I = f·m·r²  →  (−Δvz, 0, Δvx) / (f·r)
  const angularVelocity: Vec3 = { x: w.x - dvz / (f * radius), y: w.y, z: w.z + dvx / (f * radius) };

  if (velocity.y < ROLLING_THRESHOLD) {
    return {
      position: { x: state.position.x, y: radius, z: state.position.z },
      velocity: { x: velocity.x, y: 0, z: velocity.z },
      angularVelocity: coupleSpinToRolling(angularVelocity, velocity, radius),
      phase: 'rolling',
    };
  }
  return { position: state.position, velocity, angularVelocity, phase: 'flying' };
}

// Rodar sin deslizar: u = 0  →  ω.z = −vx/r, ω.x = vz/r. El spin vertical se conserva.
function coupleSpinToRolling(w: Vec3, v: Vec3, radius: number): Vec3 {
  return { x: v.z / radius, y: w.y, z: -v.x / radius };
}

function stepRolling(state: BallState, config: SimConfig, dt: number): BallState {
  const { ball, body } = config;
  const surface = config.surfaceAt(state.position);
  const decel = surface.rollingResistance * body.gravity;
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  const newSpeed = speed - decel * dt;

  if (newSpeed < STOP_SPEED) {
    return {
      position: state.position,
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      phase: 'stopped',
    };
  }

  const dirX = state.velocity.x / speed;
  const dirZ = state.velocity.z / speed;
  const travelled = speed * dt - 0.5 * decel * dt * dt;
  const velocity: Vec3 = { x: dirX * newSpeed, y: 0, z: dirZ * newSpeed };
  // El spin vertical decae con la misma fricción: α = μr·g / r.
  const wy = state.angularVelocity.y;
  const wyDecay = (decel / ball.radius) * dt;
  const newWy = Math.abs(wy) <= wyDecay ? 0 : wy - Math.sign(wy) * wyDecay;

  return {
    position: { x: state.position.x + dirX * travelled, y: ball.radius, z: state.position.z + dirZ * travelled },
    velocity,
    angularVelocity: coupleSpinToRolling({ x: 0, y: newWy, z: 0 }, velocity, ball.radius),
    phase: 'rolling',
  };
}

function stepFlying(state: BallState, config: SimConfig, dt: number): BallState {
  const groundY = config.ball.radius;
  const next = stepFlight(state, config, dt);
  if (next.position.y > groundY || next.velocity.y >= 0) return { ...next, phase: 'flying' };

  // Contacto con el suelo dentro de este paso: se interpola el instante.
  const drop = state.position.y - next.position.y;
  const fraction = drop > 0 ? Math.min(1, Math.max(0, (state.position.y - groundY) / drop)) : 1;
  const contact: BallState = {
    position: {
      x: state.position.x + (next.position.x - state.position.x) * fraction,
      y: groundY,
      z: state.position.z + (next.position.z - state.position.z) * fraction,
    },
    velocity: next.velocity,
    angularVelocity: next.angularVelocity,
    phase: 'flying',
  };
  const bounced = applyBounce(contact, config.surfaceAt(contact.position), config.ball);

  // El resto del paso se avanza con la velocidad posterior al rebote.
  const remaining = (1 - fraction) * dt;
  return {
    ...bounced,
    position: {
      x: bounced.position.x + bounced.velocity.x * remaining,
      y: Math.max(groundY, bounced.position.y + bounced.velocity.y * remaining),
      z: bounced.position.z + bounced.velocity.z * remaining,
    },
  };
}

// Un paso de simulación completo, según la fase del balón.
export function stepBall(state: BallState, config: SimConfig, dt: number = FIXED_DT): BallState {
  switch (state.phase) {
    case 'flying':
      return stepFlying(state, config, dt);
    case 'rolling':
      return stepRolling(state, config, dt);
    default:
      return state; // idle y stopped no se mueven
  }
}

// ¿Hubo un contacto con el suelo entre dos pasos consecutivos del vuelo?
// (un rebote que sube de nuevo, o el paso directo a rodar)
export function isGroundContact(before: BallState, after: BallState): boolean {
  return (
    before.phase === 'flying' &&
    (after.phase === 'rolling' || (before.velocity.y < 0 && after.velocity.y > 0))
  );
}

export interface RunOutcome {
  finalState: BallState;
  time: number; // s hasta detenerse (o hasta el tope de seguridad)
  bounces: number; // contactos con el suelo durante el vuelo
  trace: Vec3[]; // posición del centro, una por paso
}

// Simula desde un tiro hasta que el balón se detiene.
export function simulateUntilStopped(initial: BallState, config: SimConfig, dt: number = FIXED_DT): RunOutcome {
  let state: BallState = { ...initial, phase: initial.phase === 'idle' ? 'flying' : initial.phase };
  let time = 0;
  let bounces = 0;
  const trace: Vec3[] = [state.position];

  while (state.phase !== 'stopped' && time < MAX_FLIGHT_TIME) {
    const next = stepBall(state, config, dt);
    if (isGroundContact(state, next)) bounces += 1;
    state = next;
    time += dt;
    trace.push(state.position);
  }
  return { finalState: state, time, bounces, trace };
}
