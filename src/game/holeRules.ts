import type { Vec3 } from '../physics/types';
import type { HoleMap, Vec2 } from '../world/hole';

// Reglas del hoyo: conteo de golpes, fuera de límites, procedimiento de agua y resultado.
// Puro: sin Three.js ni DOM, para poder probarlo. Cada función devuelve un estado nuevo.

export type HoleStatus = 'playing' | 'waterRelief' | 'holed';
export type HoleEvent = 'none' | 'ob' | 'water' | 'holed';

export interface HoleState {
  strokes: number; // golpes contados, con penalizaciones
  lastRest: Vec3; // último punto de golpeo (donde estaba el balón antes de golpear)
  status: HoleStatus; // waterRelief: eligiendo cómo seguir tras caer al agua
  lastEvent: HoleEvent;
  // Último punto por donde el centro del balón entró al lago, ENTRY_CLEARANCE m hacia afuera por su trayectoria.
  waterEntry: Vec2 | null;
}

export function newHoleState(start: Vec3): HoleState {
  return { strokes: 0, lastRest: { ...start }, status: 'playing', lastEvent: 'none', waterEntry: null };
}

// Solo se puede golpear mientras se juega: no al elegir cómo seguir tras el agua ni con el hoyo terminado.
export const canShoot = (state: HoleState): boolean => state.status === 'playing';

// Cada golpe lanzado suma 1 y guarda el punto desde donde se golpea.
export function registerShot(state: HoleState, restPosition: Vec3): HoleState {
  return {
    ...state,
    strokes: state.strokes + 1,
    lastRest: { ...restPosition },
    lastEvent: 'none',
    waterEntry: null,
  };
}

// --- Punto de entrada al agua ---

const ENTRY_BISECTIONS = 24;
// Cuánto se retrocede el punto de entrada, por donde vino el balón, para que un balón dropeado ahí
// quede claramente fuera del agua (al botar no vuelve a caer sobre el borde).
export const ENTRY_CLEARANCE = 0.35; // m

// Actualiza el punto de entrada cuando el centro del balón cruza el borde del lago de
// afuera hacia adentro entre dos pasos. Vale aunque el balón entre volando (el punto se
// «extiende hacia arriba y hacia abajo», reglamento 4-3-2), y si entra y sale y vuelve a
// entrar queda el último cruce.
export function trackWaterEntry(state: HoleState, before: Vec3, after: Vec3, map: HoleMap): HoleState {
  if (map.isInLake(before.x, before.z) || !map.isInLake(after.x, after.z)) return state;
  let outside = { x: before.x, z: before.z };
  let inside = { x: after.x, z: after.z };
  for (let i = 0; i < ENTRY_BISECTIONS; i++) {
    const mid = { x: (outside.x + inside.x) / 2, z: (outside.z + inside.z) / 2 };
    if (map.isInLake(mid.x, mid.z)) inside = mid;
    else outside = mid;
  }
  const travel = { x: after.x - before.x, z: after.z - before.z };
  const length = Math.hypot(travel.x, travel.z);
  // Sin movimiento horizontal (cae en vertical) no hay por dónde retroceder: se queda en el borde.
  const back = length > 1e-9 ? ENTRY_CLEARANCE / length : 0;
  return { ...state, waterEntry: { x: outside.x - travel.x * back, z: outside.z - travel.z * back } };
}

// --- Al detenerse ---

export type StopOutcome =
  | { kind: 'ok' }
  | { kind: 'ob'; returnTo: Vec3 } // +1 golpe y el balón vuelve al último punto de golpeo
  | { kind: 'water' }; // hay que elegir cómo seguir (procedimiento de agua)

// Se evalúa solo cuando el balón queda detenido: un balón que cruza OB o vuela sobre el
// lago y vuelve a la zona de juego no se penaliza.
export function onBallStopped(
  state: HoleState,
  position: Vec3,
  map: HoleMap,
  ballRadius: number,
): { state: HoleState; outcome: StopOutcome } {
  if (map.isBallInWater(position.x, position.z, ballRadius)) {
    return { state: { ...state, status: 'waterRelief', lastEvent: 'water' }, outcome: { kind: 'water' } };
  }
  if (map.isOutOfBounds(position.x, position.z)) {
    return {
      state: { ...state, strokes: state.strokes + 1, lastEvent: 'ob' },
      outcome: { kind: 'ob', returnTo: { ...state.lastRest } },
    };
  }
  return { state, outcome: { kind: 'ok' } };
}

export function onBallHoled(state: HoleState): HoleState {
  return { ...state, status: 'holed', lastEvent: 'holed' };
}

// --- Procedimiento de agua (reglamento 4-3-2) ---

export type ReliefOption = 1 | 2 | 3 | 4;

// 1 jugar como queda · 2 repetir desde el último golpe · 3 dropear en el punto de entrada ·
// 4 sobre la línea entre la copa y el punto de entrada, detrás del lago.
export const RELIEF_PENALTY: Record<ReliefOption, number> = { 1: 0, 2: 1, 3: 1, 4: 1 };

export const DROP_LATERAL_LIMIT = 2; // m a los lados del punto de entrada (opción 3)

export interface ReliefContext {
  map: HoleMap;
  cup: Vec2;
  ballRadius: number;
}

export interface ReliefPlacement {
  position: Vec2; // dónde queda el balón
  valid: boolean; // si se puede confirmar
}

const length = (v: Vec2): number => Math.hypot(v.x, v.z);

// Posición del balón con la opción elegida. `offset` solo cuenta en las opciones 3 y 4:
// en la 3 es el desplazamiento lateral en m (a la derecha, mirando desde el punto de
// entrada hacia la copa; negativo = izquierda); en la 4, la distancia en m detrás del
// punto de entrada, alejándose de la copa. Una posición vale si el centro queda fuera del
// lago y dentro de límites; la 3 además no puede pasar de DROP_LATERAL_LIMIT a los lados.
// (Desplazarse perpendicular a la línea hacia la copa nunca acerca el balón a ella, así
// que la regla «sin acercarse a la copa» de la opción 3 se cumple siempre.)
export function reliefPlacement(
  option: ReliefOption,
  state: HoleState,
  ballPosition: Vec3,
  ctx: ReliefContext,
  offset = 0,
): ReliefPlacement {
  const playable = (p: Vec2): boolean => !ctx.map.isInLake(p.x, p.z) && !ctx.map.isOutOfBounds(p.x, p.z);

  if (option === 1) return { position: { x: ballPosition.x, z: ballPosition.z }, valid: true };
  if (option === 2) {
    const rest = { x: state.lastRest.x, z: state.lastRest.z };
    return { position: rest, valid: playable(rest) };
  }

  const entry = state.waterEntry;
  if (!entry) return { position: { x: ballPosition.x, z: ballPosition.z }, valid: false };

  const toCup = { x: ctx.cup.x - entry.x, z: ctx.cup.z - entry.z };
  const distance = length(toCup);
  if (distance === 0) return { position: { ...entry }, valid: false };
  const forward = { x: toCup.x / distance, z: toCup.z / distance }; // del punto de entrada a la copa

  if (option === 3) {
    // «A la derecha» mirando hacia la copa: con z hacia la cámara, la derecha de (fx, fz) es (−fz, fx).
    const right = { x: -forward.z, z: forward.x };
    const position = { x: entry.x + right.x * offset, z: entry.z + right.z * offset };
    return { position, valid: Math.abs(offset) <= DROP_LATERAL_LIMIT && playable(position) };
  }

  const behind = Math.max(0, offset);
  const position = { x: entry.x - forward.x * behind, z: entry.z - forward.z * behind };
  return { position, valid: playable(position) };
}

// Confirma la opción: suma su penalización y vuelve a `playing`. Con una posición no
// válida o fuera del estado de agua no hace nada.
export function applyRelief(
  state: HoleState,
  option: ReliefOption,
  placement: ReliefPlacement,
): { state: HoleState; applied: boolean } {
  if (state.status !== 'waterRelief' || !placement.valid) return { state, applied: false };
  return {
    state: {
      ...state,
      strokes: state.strokes + RELIEF_PENALTY[option],
      status: 'playing',
      waterEntry: null,
    },
    applied: true,
  };
}

// --- Resultado ---

// Nombre del resultado por diferencia con el par; con un solo golpe, «Hoyo en uno».
export function resultName(par: number, strokes: number): string {
  if (strokes === 1) return 'Hoyo en uno';
  const diff = strokes - par;
  switch (diff) {
    case -3:
      return 'Albatros';
    case -2:
      return 'Eagle';
    case -1:
      return 'Birdie';
    case 0:
      return 'Par';
    case 1:
      return 'Bogey';
    case 2:
      return 'Doble bogey';
    default:
      return diff > 0 ? `+${diff}` : `${diff}`;
  }
}
