import type { Cup, Vec3 } from '../physics/types';
import type { HoleMap, Vec2 } from '../world/hole';
import {
  applyRelief,
  canShoot,
  DROP_LATERAL_LIMIT,
  newHoleState,
  onBallHoled,
  onBallStopped,
  RELIEF_PENALTY,
  registerShot,
  reliefPlacement,
  trackWaterEntry,
  type HoleState,
  type HoleStatus,
  type ReliefOption,
  type ReliefPlacement,
  type StopOutcome,
} from './holeRules';

// Una partida de un hoyo: junta las reglas puras de holeRules con la opción del procedimiento de
// agua que el jugador va eligiendo. El bucle de juego solo le avisa de lo que pasa (golpe, paso del
// balón, balón detenido o embocado) y ejecuta lo que pide (volver el balón a un punto). Sin DOM
// ni Three.js.

export interface HoleSessionConfig {
  name: string;
  par: number;
  map: HoleMap;
  cup: Cup;
  ballRadius: number;
}

// Opción del procedimiento de agua que se está eligiendo y su desplazamiento (opciones 3 y 4).
export interface ReliefChoice {
  option: ReliefOption;
  offset: number; // opción 3: m a los lados (−2..2); opción 4: m detrás del punto de entrada (≥ 0)
}

export const DEFAULT_RELIEF_OPTION: ReliefOption = 3; // dropear en el punto de entrada
export const MAX_BEHIND_DISTANCE = 300; // m, tope de la opción 4

export interface ReliefView {
  option: ReliefOption;
  offset: number;
  penalty: number;
  placement: ReliefPlacement;
  strokes: number; // golpes ya contados, sin la penalización de esta opción
}

// Lo que muestra el HUD del hoyo en curso.
export interface HoleSummary {
  name: string;
  par: number;
  strokes: number;
  status: HoleStatus;
}

// Avisos de lo que pasó, para que la interfaz los muestre.
export type HoleEvent =
  | { kind: 'ob' } // fuera de límites: +1 golpe y vuelve al último golpe
  | { kind: 'water' } // al agua: hay que elegir cómo seguir
  | { kind: 'relief'; option: ReliefOption; penalty: number } // se confirmó la opción del agua
  | { kind: 'holed'; strokes: number; par: number };

export interface HoleSession {
  readonly config: HoleSessionConfig;
  readonly state: HoleState;
  readonly canShoot: boolean;
  readonly relief: ReliefChoice | null; // distinto de null mientras se elige cómo seguir tras el agua
  readonly summary: HoleSummary;
  reset(start: Vec3): void; // hoyo nuevo: 0 golpes, jugando
  registerShot(rest: Vec3): void; // un golpe lanzado desde `rest`
  trackStep(before: Vec3, after: Vec3): void; // cada paso del balón: recuerda por dónde entra al lago
  ballStopped(position: Vec3): StopOutcome; // el balón quedó detenido: OB, agua o nada
  ballHoled(): void;
  selectRelief(option: ReliefOption): void;
  adjustRelief(delta: number): void; // mueve el desplazamiento de la opción 3 o 4
  reliefView(ballPosition: Vec3): ReliefView | null;
  // Confirma la opción elegida. `position` es dónde queda el balón (null: no se mueve, opción 1).
  confirmRelief(ballPosition: Vec3): { applied: boolean; position: Vec2 | null };
}

export function createHoleSession(config: HoleSessionConfig): HoleSession {
  let state = newHoleState({ x: 0, y: 0, z: 0 });
  let relief: ReliefChoice | null = null;
  const context = { map: config.map, cup: config.cup.position, ballRadius: config.ballRadius };

  function placement(ballPosition: Vec3): ReliefPlacement | null {
    if (!relief) return null;
    return reliefPlacement(relief.option, state, ballPosition, context, relief.offset);
  }

  return {
    config,
    get state() {
      return state;
    },
    get canShoot() {
      return canShoot(state);
    },
    get relief() {
      return relief;
    },
    get summary() {
      return { name: config.name, par: config.par, strokes: state.strokes, status: state.status };
    },
    reset(start) {
      state = newHoleState(start);
      relief = null;
    },
    registerShot(rest) {
      state = registerShot(state, rest);
    },
    trackStep(before, after) {
      state = trackWaterEntry(state, before, after, config.map);
    },
    ballStopped(position) {
      const result = onBallStopped(state, position, config.map, config.ballRadius);
      state = result.state;
      if (result.outcome.kind === 'water') relief = { option: DEFAULT_RELIEF_OPTION, offset: 0 };
      return result.outcome;
    },
    ballHoled() {
      state = onBallHoled(state);
      relief = null;
    },
    selectRelief(option) {
      if (relief) relief = { option, offset: 0 };
    },
    adjustRelief(delta) {
      if (!relief) return;
      if (relief.option === 3) {
        relief = { ...relief, offset: Math.min(DROP_LATERAL_LIMIT, Math.max(-DROP_LATERAL_LIMIT, relief.offset + delta)) };
      } else if (relief.option === 4) {
        relief = { ...relief, offset: Math.min(MAX_BEHIND_DISTANCE, Math.max(0, relief.offset + delta)) };
      }
    },
    reliefView(ballPosition) {
      const chosen = placement(ballPosition);
      if (!relief || !chosen) return null;
      return {
        option: relief.option,
        offset: relief.offset,
        penalty: RELIEF_PENALTY[relief.option],
        placement: chosen,
        strokes: state.strokes,
      };
    },
    confirmRelief(ballPosition) {
      const chosen = placement(ballPosition);
      if (!relief || !chosen) return { applied: false, position: null };
      const result = applyRelief(state, relief.option, chosen);
      if (!result.applied) return { applied: false, position: null };
      const option = relief.option;
      state = result.state;
      relief = null;
      return { applied: true, position: option === 1 ? null : chosen.position };
    },
  };
}
