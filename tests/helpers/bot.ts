import { createHoleSession } from '../../src/game/holeSession';
import { computeShot, SHOT_TYPES } from '../../src/game/shot';
import { BALL_SPEC, CELESTIAL_BODIES } from '../../src/physics/bodies';
import { FIXED_DT, settleOnTerrain, simulateUntilStopped, stepBall, type SimConfig } from '../../src/physics/simulation';
import type { BallState, ShotInput, ShotTypeId, Vec3 } from '../../src/physics/types';
import type { Field } from '../../src/world/fields';
import { distanceToPolyline, pointAlong, polylineLength } from '../../src/world/geometry';
import { FLAT_TERRAIN } from '../../src/world/terrain';

// Jugador simulado para afinar el hoyo: juega con las mismas reglas que el bucle de juego (golpes,
// fuera de límites, agua) pero con un criterio fijo y algo de ruido en el rumbo y el poder. No es un
// jugador experto: apunta a lo largo de la línea de juego, elige el golpe por la distancia que falta y
// pone en el green sin leer las pendientes.

const r = BALL_SPEC.radius;
const MAX_STROKES = 30;
const MAX_SHOT_TIME = 90; // s de simulación por golpe

export interface BotOptions {
  seed: number;
  aimNoise: number; // desviación típica de la precisión (−1..1); 1 = ±8°
  powerNoise: number; // desviación típica relativa del poder
  readGreen?: boolean; // si es verdadero, apunta el putt compensando la pendiente media entre balón y copa
}

export interface BotShot {
  type: ShotTypeId;
  power: number;
  from: Vec3;
  to: Vec3;
  event: 'ok' | 'ob' | 'water' | 'holed';
}

export interface BotResult {
  strokes: number;
  holed: boolean;
  shots: BotShot[];
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Número con distribución normal (Box–Muller).
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function configFor(field: Field): SimConfig {
  return {
    ball: BALL_SPEC,
    body: CELESTIAL_BODIES.earth,
    wind: { speed: 0, headingDeg: 0 },
    surfaceAt: field.surfaceAt,
    terrain: field.terrain,
    cup: field.cup,
  };
}

// Distancia total (vuelo + rodadura) de un golpe perfecto de cada tipo en un campo llano de una sola superficie.
const rangeTables = new Map<string, Array<[number, number]>>();
export function rangeTable(type: ShotTypeId, surface: 'fairway' | 'green' = 'fairway'): Array<[number, number]> {
  const key = `${type}|${surface}`;
  let table = rangeTables.get(key);
  if (!table) {
    const config: SimConfig = {
      ball: BALL_SPEC,
      body: CELESTIAL_BODIES.earth,
      wind: { speed: 0, headingDeg: 0 },
      surfaceAt: () => surface,
      terrain: FLAT_TERRAIN,
    };
    table = [];
    for (let power = 0.05; power <= 1.0001; power += 0.05) {
      const shot = computeShot({ shotType: type, headingDeg: 0, power, accuracy: 0, contact: { x: 0, y: 0 } }, { x: 0, y: r, z: 0 });
      table.push([power, -simulateUntilStopped(shot, config).finalState.position.z]);
    }
    rangeTables.set(key, table);
  }
  return table;
}

// Poder que da `distance` m con ese tipo (interpolando la tabla; si no llega, 1).
export function powerForDistance(type: ShotTypeId, distance: number, surface: 'fairway' | 'green' = 'fairway'): number {
  const table = rangeTable(type, surface);
  if (distance >= table[table.length - 1][1]) return 1;
  for (let i = 0; i < table.length; i++) {
    if (distance <= table[i][1]) {
      if (i === 0) return table[0][0] * (distance / table[0][1]);
      const [p0, d0] = table[i - 1];
      const [p1, d1] = table[i];
      return p0 + ((p1 - p0) * (distance - d0)) / (d1 - d0);
    }
  }
  return 1;
}

export const maxRange = (type: ShotTypeId): number => rangeTable(type)[rangeTable(type).length - 1][1];

export function playHole(field: Field, options: BotOptions): BotResult {
  const random = rng(options.seed);
  const config = configFor(field);
  const { cup, rules } = field;
  if (!cup || !rules) throw new Error('el campo necesita copa y reglas');
  const path = field.scenery.markers.path; // línea de juego del tee al centro del green
  const total = polylineLength(path);
  const session = createHoleSession({ ...rules, cup, ballRadius: r });
  const start: BallState = settleOnTerrain(
    { position: { x: field.tee.x, y: 0, z: field.tee.z }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, phase: 'stopped' },
    config,
  );
  session.reset(start.position);
  let ball: BallState = start;
  const shots: BotShot[] = [];

  // Avance del balón sobre la línea de juego (m desde el tee): el punto más cercano.
  const progressOf = (p: Vec3): number => {
    let best = 0;
    let bestDistance = Infinity;
    for (let d = 0; d <= total; d += 2) {
      const q = pointAlong(path, d).point;
      const dist = Math.hypot(p.x - q.x, p.z - q.z);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = d;
      }
    }
    return best;
  };

  const place = (x: number, z: number): BallState =>
    settleOnTerrain({ position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, phase: 'stopped' }, config);

  // Corre el balón hasta que se detiene o se emboca, avisando a la sesión de cada paso.
  const run = (state: BallState): BallState => {
    let s = state;
    for (let t = 0; t < MAX_SHOT_TIME / FIXED_DT && s.phase !== 'stopped' && s.phase !== 'holed'; t++) {
      const next = stepBall(s, config, FIXED_DT);
      session.trackStep(s.position, next.position);
      s = next;
    }
    return s;
  };

  // «Leer el green»: prueba varios rumbos y poderes con la física (sin ruido) y se queda con el que emboca o,
  // si ninguno, el que deja el balón más cerca de la copa sin pasarse mucho.
  function readPutt(here: Vec3, straightHeading: number, straightPower: number): { heading: number; power: number } {
    let best = { heading: straightHeading, power: straightPower, score: Infinity };
    // Primero los rumbos y poderes más cercanos al putt recto: el primero que emboca es el más robusto.
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
    for (const offset of offsets) {
      for (const factor of [1, 1.1, 0.9, 1.25, 1.4]) {
        const power = Math.min(1, straightPower * factor);
        const trial: ShotInput = { shotType: 'putt', headingDeg: straightHeading + offset, power, accuracy: 0, contact: { x: 0, y: 0 } };
        const end = simulateUntilStopped(computeShot(trial, here), config).finalState;
        const miss = end.phase === 'holed' ? 0 : Math.hypot(end.position.x - cup!.position.x, end.position.z - cup!.position.z);
        if (miss < best.score) best = { heading: straightHeading + offset, power, score: miss };
        if (miss === 0) return { heading: best.heading, power: best.power };
      }
    }
    return { heading: best.heading, power: best.power };
  }

  while (session.summary.strokes < MAX_STROKES && session.summary.status !== 'holed') {
    const here = ball.position;
    const distance = Math.hypot(cup.position.x - here.x, cup.position.z - here.z);

    // Tipo de golpe y poder.
    let type: ShotTypeId;
    let power: number;
    let heading: number;
    if (distance <= rules.map.distanceToCup(cup.position.x + 14, cup.position.z)) {
      // En el green: putt hacia la copa, con la velocidad justa para llegar con ~0.6 m/s.
      type = 'putt';
      const decel = 0.035 * CELESTIAL_BODIES.earth.gravity;
      const speed = Math.sqrt(0.36 + 2 * decel * Math.max(0, distance - cup.radius));
      power = Math.min(1, speed / SHOT_TYPES.putt.maxSpeed);
      heading = (Math.atan2(cup.position.x - here.x, -(cup.position.z - here.z)) * 180) / Math.PI;
      if (options.readGreen) ({ heading, power } = readPutt(here, heading, power));
    } else {
      type = distance > maxRange('long') ? 'powerful' : distance > maxRange('short') ? 'long' : 'short';
      if (distance > maxRange('powerful')) power = 1;
      else power = powerForDistance(type, distance);
      // Apunta a lo largo de la línea de juego, tanto como alcanza el golpe, o a la copa si ya llega.
      const reach = Math.min(distance, maxRange(type));
      const progress = progressOf(here);
      const target = total - progress <= reach ? cup.position : pointAlong(path, progress + reach).point;
      heading = (Math.atan2(target.x - here.x, -(target.z - here.z)) * 180) / Math.PI;
    }

    const noisyPower = Math.min(1, Math.max(0.02, power * (1 + options.powerNoise * gaussian(random))));
    const accuracy = Math.max(-1, Math.min(1, options.aimNoise * gaussian(random)));
    const input: ShotInput = { shotType: type, headingDeg: heading, power: noisyPower, accuracy, contact: { x: 0, y: 0 } };

    session.registerShot(here);
    let event: BotShot['event'] = 'ok';
    ball = run(computeShot(input, here));
    if (ball.phase === 'holed') {
      session.ballHoled();
      event = 'holed';
    } else {
      // Puede quedar en OB o en el agua; se resuelve como el bucle de juego y, si el balón se coloca
      // en una pendiente, rueda hasta quedar quieto y se vuelve a evaluar.
      const outcome = session.ballStopped(ball.position);
      if (outcome.kind === 'ob') {
        event = 'ob';
        ball = place(outcome.returnTo.x, outcome.returnTo.z);
      } else if (outcome.kind === 'water') {
        event = 'water';
        const result = session.confirmRelief(ball.position); // opción 3 por defecto: dropear en el punto de entrada
        if (result.position) ball = place(result.position.x, result.position.z);
      }
    }
    shots.push({ type, power: noisyPower, from: { ...here }, to: { ...ball.position }, event });
  }
  return { strokes: session.summary.strokes, holed: session.summary.status === 'holed', shots };
}

export interface BotStats {
  games: number;
  holed: number;
  average: number;
  distribution: Record<number, number>;
  atOrUnderPar: number;
  ob: number;
  water: number;
}

export function playMany(field: Field, games: number, options: Omit<BotOptions, 'seed'>): BotStats {
  const distribution: Record<number, number> = {};
  let total = 0;
  let holed = 0;
  let ob = 0;
  let water = 0;
  let atOrUnderPar = 0;
  for (let seed = 1; seed <= games; seed++) {
    const result = playHole(field, { ...options, seed });
    distribution[result.strokes] = (distribution[result.strokes] ?? 0) + 1;
    total += result.strokes;
    if (result.holed) holed += 1;
    if (result.holed && result.strokes <= field.rules!.par) atOrUnderPar += 1;
    for (const shot of result.shots) {
      if (shot.event === 'ob') ob += 1;
      if (shot.event === 'water') water += 1;
    }
  }
  return { games, holed, average: total / games, distribution, atOrUnderPar, ob, water };
}

export { distanceToPolyline };
