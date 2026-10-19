import type { BallSpec, BallState, CelestialBody, SurfaceType, Terrain, Vec3, Wind } from './types';

// Paso de simulación fijo, integrado con RK4.
export const FIXED_DT = 1 / 240; // s

export interface SimConfig {
  ball: BallSpec;
  body: CelestialBody;
  wind: Wind;
  surfaceAt: (position: Vec3) => SurfaceType; // superficie bajo el balón
  terrain: Terrain;
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
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

// Holgura del balón sobre el terreno: distancia con signo desde el centro hasta el plano
// tangente (medida sobre la normal) menos el radio. Hay contacto cuando vale 0 o menos.
function clearance(position: Vec3, config: SimConfig): number {
  const { terrain, ball } = config;
  const n = terrain.normalAt(position.x, position.z);
  return (position.y - terrain.heightAt(position.x, position.z)) * n.y - ball.radius;
}

// Altura del centro del balón apoyado en el terreno en (x, z).
export function restHeight(x: number, z: number, config: SimConfig): number {
  const { terrain, ball } = config;
  return terrain.heightAt(x, z) + ball.radius / terrain.normalAt(x, z).y;
}

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

// Simula el vuelo hasta el primer contacto con el terreno: el centro del balón baja
// hasta quedar a un radio de la superficie (sobre la normal). El instante exacto se
// interpola entre dos pasos.
export function simulateFlight(initial: BallState, config: SimConfig, dt: number = FIXED_DT): FlightOutcome {
  let state: BallState = { ...initial, phase: 'flying' };
  let time = 0;
  let apexY = state.position.y;
  const trace: Vec3[] = [state.position];

  while (time < MAX_FLIGHT_TIME) {
    const next = stepFlight(state, config, dt);
    const before = clearance(state.position, config);
    const after = clearance(next.position, config);

    if (before > 0 && after <= 0) {
      const fraction = before / (before - after);
      const x = state.position.x + (next.position.x - state.position.x) * fraction;
      const z = state.position.z + (next.position.z - state.position.z) * fraction;
      const landingPosition: Vec3 = { x, y: restHeight(x, z, config), z };
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

const UP: Vec3 = { x: 0, y: 1, z: 0 };

// Impacto con el suelo de normal `normal` (unitaria, hacia arriba; ŷ por defecto), con el
// centro del balón a un radio de la superficie y v·n < 0. La componente normal se
// multiplica por −restitución. La tangencial recibe un impulso de fricción de Coulomb
// (limitado por μ·J_normal) que también cambia el spin. Si queda poca velocidad normal
// pasa a rodar con el spin acoplado.
export function applyBounce(
  state: BallState,
  surface: SurfaceType,
  ball: BallSpec,
  normal: Vec3 = UP,
): BallState {
  const { radius, momentOfInertiaFactor: f } = ball;
  const { velocity: v, angularVelocity: w } = state;
  const n = normal;
  const normalSpeed = -dot(v, n); // > 0 al impactar
  const tangential = sub(v, scale(n, dot(v, n)));

  // Velocidad del punto de contacto (r_c = −r·n): u = v + ω × r_c; solo cuenta su parte tangencial.
  const u = sub(v, scale(cross(w, n), radius));
  const slipVelocity = sub(u, scale(n, dot(u, n)));
  const slip = norm(slipVelocity);

  let impulse: Vec3 = { x: 0, y: 0, z: 0 }; // por unidad de masa
  if (slip > 0) {
    const maxImpulse = surface.slidingFriction * (1 + surface.restitution) * normalSpeed; // μ·J_n / m
    const stickImpulse = slip / (1 + 1 / f); // el que anula el deslizamiento
    impulse = scale(slipVelocity, -Math.min(maxImpulse, stickImpulse) / slip);
  }

  const bouncedNormalSpeed = surface.restitution * normalSpeed;
  // Δω = (r_c × J) / I con I = f·m·r²  →  −(n × J) / (f·r)
  const angularVelocity = sub(w, scale(cross(n, impulse), 1 / (f * radius)));

  if (bouncedNormalSpeed < ROLLING_THRESHOLD) {
    const alongSurface = add(tangential, impulse);
    return {
      position: state.position,
      velocity: alongSurface,
      angularVelocity: coupleSpinToRolling(angularVelocity, alongSurface, radius, n),
      phase: 'rolling',
    };
  }
  return {
    position: state.position,
    velocity: add(add(tangential, impulse), scale(n, bouncedNormalSpeed)),
    angularVelocity,
    phase: 'flying',
  };
}

// Rodar sin deslizar sobre una superficie de normal n: u = 0  →  ω_t = (n × v) / r. El
// spin sobre la normal (ω·n) se conserva.
function coupleSpinToRolling(w: Vec3, v: Vec3, radius: number, n: Vec3): Vec3 {
  return add(scale(cross(n, v), 1 / radius), scale(n, dot(w, n)));
}

// Si al rodar la velocidad apunta hacia afuera de la nueva superficie más que esto
// (por ejemplo al pasar una cima en arista), el balón despega.
export const TAKEOFF_THRESHOLD = 0.3; // m/s

// Un paso de rodadura sobre el terreno. Aceleración tangencial: gravedad tangencial
// g_t / (1 + f) (rueda sin deslizar) menos la resistencia de rodadura μr·g·cosθ opuesta
// a la velocidad. El balón solo se detiene si la pendiente no vence a la resistencia
// (tan θ ≤ μr·(1 + f)), así que en una cuesta fuerte arranca solo desde el reposo.
function stepRolling(state: BallState, config: SimConfig, dt: number): BallState {
  const { ball, body, terrain } = config;
  const n = terrain.normalAt(state.position.x, state.position.z);
  const surface = config.surfaceAt(state.position);
  const resistance = surface.rollingResistance * body.gravity * n.y; // m/s², módulo
  const g = body.gravity;
  const slopeAccel = scale(
    { x: g * n.y * n.x, y: g * n.y * n.y - g, z: g * n.y * n.z },
    1 / (1 + ball.momentOfInertiaFactor),
  );
  const slopeStrength = norm(slopeAccel);
  const holds = slopeStrength <= resistance; // la pendiente no vence a la resistencia

  const stopped: BallState = {
    position: state.position,
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    phase: 'stopped',
  };

  const tangential = sub(state.velocity, scale(n, dot(state.velocity, n)));
  const speed = norm(tangential);
  let velocity: Vec3;
  if (speed > 1e-9) {
    velocity = add(tangential, scale(sub(slopeAccel, scale(tangential, resistance / speed)), dt));
    if (dot(velocity, tangential) <= 0) {
      // Se pararía dentro de este paso: o se queda quieto o la cuesta lo devuelve.
      if (holds) return stopped;
      velocity = scale(slopeAccel, (1 - resistance / slopeStrength) * dt);
    }
  } else {
    if (holds) return stopped;
    velocity = scale(slopeAccel, (1 - resistance / slopeStrength) * dt);
  }
  if (holds && norm(velocity) < STOP_SPEED) return stopped;

  // Desplazamiento con la velocidad media (exacto con aceleración constante).
  const displacement = scale(add(tangential, velocity), dt / 2);
  const moved = add(state.position, displacement);
  const newNormal = terrain.normalAt(moved.x, moved.z);

  // El spin sobre la normal decae con la misma fricción: α = μr·g·cosθ / r.
  const wn = dot(state.angularVelocity, n);
  const wnDecay = (resistance / ball.radius) * dt;
  const newWn = Math.abs(wn) <= wnDecay ? 0 : wn - Math.sign(wn) * wnDecay;

  if (dot(velocity, newNormal) > TAKEOFF_THRESHOLD) {
    return {
      position: moved,
      velocity,
      angularVelocity: coupleSpinToRolling(scale(n, newWn), velocity, ball.radius, n),
      phase: 'flying',
    };
  }

  // Sigue pegado al terreno: la velocidad se gira al nuevo plano tangente conservando su módulo.
  const onPlane = sub(velocity, scale(newNormal, dot(velocity, newNormal)));
  const planeSpeed = norm(onPlane);
  const rolled = planeSpeed > 0 ? scale(onPlane, norm(velocity) / planeSpeed) : onPlane;
  return {
    position: { x: moved.x, y: restHeight(moved.x, moved.z, config), z: moved.z },
    velocity: rolled,
    angularVelocity: coupleSpinToRolling(scale(newNormal, newWn), rolled, ball.radius, newNormal),
    phase: 'rolling',
  };
}

function stepFlying(state: BallState, config: SimConfig, dt: number): BallState {
  const next = stepFlight(state, config, dt);
  const nextNormal = config.terrain.normalAt(next.position.x, next.position.z);
  const after = clearance(next.position, config);
  if (after > 0 || dot(next.velocity, nextNormal) >= 0) return { ...next, phase: 'flying' };

  // Contacto con el terreno dentro de este paso: se interpola el instante.
  const before = clearance(state.position, config);
  const gap = before - after;
  const fraction = gap > 0 ? Math.min(1, Math.max(0, before / gap)) : 1;
  const x = state.position.x + (next.position.x - state.position.x) * fraction;
  const z = state.position.z + (next.position.z - state.position.z) * fraction;
  const contact: BallState = {
    position: { x, y: restHeight(x, z, config), z },
    velocity: next.velocity,
    angularVelocity: next.angularVelocity,
    phase: 'flying',
  };
  const normal = config.terrain.normalAt(x, z);
  if (dot(contact.velocity, normal) >= 0) return { ...next, phase: 'flying' }; // ya se aleja de la superficie
  const bounced = applyBounce(contact, config.surfaceAt(contact.position), config.ball, normal);

  // El resto del paso se avanza con la velocidad posterior al rebote, sin bajar del terreno.
  const remaining = (1 - fraction) * dt;
  const nx = bounced.position.x + bounced.velocity.x * remaining;
  const nz = bounced.position.z + bounced.velocity.z * remaining;
  return {
    ...bounced,
    position: {
      x: nx,
      y: Math.max(restHeight(nx, nz, config), bounced.position.y + bounced.velocity.y * remaining),
      z: nz,
    },
  };
}

// ¿La pendiente en `position` es menor que el ángulo de reposo de su superficie? Es la
// condición de reposo del balón: g·sinθ/(1+f) ≤ μr·g·cosθ  (tan θ ≤ μr·(1+f)).
export function holdsOnSlope(position: Vec3, config: SimConfig): boolean {
  const n = config.terrain.normalAt(position.x, position.z);
  const surface = config.surfaceAt(position);
  return Math.hypot(n.x, n.z) / (1 + config.ball.momentOfInertiaFactor) <= surface.rollingResistance * n.y;
}

// Reasienta el balón tras cambiar el terreno bajo sus pies. Un balón quieto queda sobre la
// nueva superficie y, si la pendiente vence a la resistencia, empieza a rodar desde el
// reposo; uno que rueda gira su velocidad al nuevo plano; uno en el aire solo se sube si
// quedó bajo el suelo.
export function settleOnTerrain(state: BallState, config: SimConfig): BallState {
  const { x, z } = state.position;
  const rest = restHeight(x, z, config);
  const n = config.terrain.normalAt(x, z);

  switch (state.phase) {
    case 'flying':
      return state.position.y >= rest ? state : { ...state, position: { x, y: rest, z } };
    case 'rolling': {
      const onPlane = sub(state.velocity, scale(n, dot(state.velocity, n)));
      const planeSpeed = norm(onPlane);
      const velocity = planeSpeed > 0 ? scale(onPlane, norm(state.velocity) / planeSpeed) : onPlane;
      return {
        ...state,
        position: { x, y: rest, z },
        velocity,
        angularVelocity: coupleSpinToRolling(state.angularVelocity, velocity, config.ball.radius, n),
      };
    }
    default: {
      const position = { x, y: rest, z };
      const quiet: BallState = {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        phase: state.phase,
      };
      return holdsOnSlope(position, config) ? quiet : { ...quiet, phase: 'rolling' };
    }
  }
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
// (un rebote que sale por la normal, o el paso directo a rodar). Se mide la velocidad
// sobre la normal del terreno, no sobre y: en una pendiente un rebote puede seguir
// bajando en y y aun así estar alejándose de la superficie.
export function isGroundContact(before: BallState, after: BallState, terrain: Terrain): boolean {
  if (before.phase !== 'flying') return false;
  if (after.phase === 'rolling') return true;
  const n = terrain.normalAt(after.position.x, after.position.z);
  return dot(before.velocity, n) < 0 && dot(after.velocity, n) > 0;
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
    if (isGroundContact(state, next, config.terrain)) bounces += 1;
    state = next;
    time += dt;
    trace.push(state.position);
  }
  return { finalState: state, time, bounces, trace };
}
