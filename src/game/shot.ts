import { FIXED_DT, stepBall, type SimConfig } from '../physics/simulation';
import type { BallState, ShotInput, ShotTypeId, Vec3 } from '../physics/types';

// Valores iniciales de afinación; no son parte del contrato salvo donde la spec los cita.
export const MAX_SPIN = 60; // rad/s en cada eje
export const MAX_ACCURACY_DEVIATION_DEG = 8; // desvío de rumbo con accuracy = ±1

// Tipos de golpe (selector Q/E). Cada uno fija la velocidad máxima (con power = 1) y la
// elevación; el punto de contacto solo controla el spin y en Putt no cuenta (golpe rodado).
// Las velocidades están decididas; las elevaciones son valores iniciales de afinación.
export interface ShotType {
  id: ShotTypeId;
  name: string;
  maxSpeed: number; // m/s con power = 1
  elevationDeg: number; // sobre el horizonte
  spin: boolean; // false: sin backspin ni efecto lateral
}

export const SHOT_TYPES: Record<ShotTypeId, ShotType> = {
  powerful: { id: 'powerful', name: 'Potente', maxSpeed: 35, elevationDeg: 15, spin: true },
  long: { id: 'long', name: 'Largo', maxSpeed: 24, elevationDeg: 25, spin: true },
  short: { id: 'short', name: 'Corto', maxSpeed: 14, elevationDeg: 40, spin: true },
  putt: { id: 'putt', name: 'Putt', maxSpeed: 7, elevationDeg: 0, spin: false },
};

// Orden del selector: Q va al anterior y E al siguiente, sin dar la vuelta (se detiene en los extremos).
export const SHOT_TYPE_ORDER: readonly ShotTypeId[] = ['powerful', 'long', 'short', 'putt'];
export const DEFAULT_SHOT_TYPE: ShotTypeId = 'powerful';

export function nextShotType(current: ShotTypeId, step: 1 | -1): ShotTypeId {
  const index = SHOT_TYPE_ORDER.indexOf(current) + step;
  return SHOT_TYPE_ORDER[Math.min(SHOT_TYPE_ORDER.length - 1, Math.max(0, index))];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

// Rumbo 0 = hacia -z; crece en sentido horario visto desde arriba (90° = hacia +x).
export function forwardVector(headingDeg: number): Vec3 {
  const h = toRadians(headingDeg);
  return { x: Math.sin(h), y: 0, z: -Math.cos(h) };
}

// Hacia la derecha del jugador, visto desde atrás del balón.
export function rightVector(headingDeg: number): Vec3 {
  const h = toRadians(headingDeg);
  return { x: Math.cos(h), y: 0, z: Math.sin(h) };
}

// Convierte un golpe en la velocidad y el spin iniciales del balón. La velocidad máxima y la
// elevación las fija el tipo de golpe.
// Spin (en ejes del jugador): contact.y < 0 da backspin (ω a lo largo de "derecha"
// positivo, el balón sube) y contact.y > 0 topspin. contact.x > 0 (golpe a la derecha
// del centro) da spin vertical positivo, que curva el balón hacia la izquierda.
export function computeShot(input: ShotInput, position: Vec3): BallState {
  const power = clamp(input.power, 0, 1);
  const accuracy = clamp(input.accuracy, -1, 1);
  const contactX = clamp(input.contact.x, -1, 1);
  const contactY = clamp(input.contact.y, -1, 1);

  const actualHeading = input.headingDeg + accuracy * MAX_ACCURACY_DEVIATION_DEG;
  const shotType = SHOT_TYPES[input.shotType];
  const elevation = toRadians(shotType.elevationDeg);
  const speed = power * shotType.maxSpeed;
  const forward = forwardVector(actualHeading);
  const right = rightVector(actualHeading);

  const backspin = shotType.spin ? -contactY * MAX_SPIN : 0;
  const sidespin = shotType.spin ? contactX * MAX_SPIN : 0;

  return {
    position: { ...position },
    velocity: {
      x: forward.x * speed * Math.cos(elevation),
      y: speed * Math.sin(elevation),
      z: forward.z * speed * Math.cos(elevation),
    },
    angularVelocity: { x: right.x * backspin, y: sidespin, z: right.z * backspin },
    phase: 'flying',
  };
}

export const PREVIEW_LENGTH = 36; // m de trayectoria que se muestran
export const PREVIEW_SPACING = 0.5; // m entre puntos (la línea se dibuja uniéndolos)
const PREVIEW_MAX_TIME = 4; // s, tope de seguridad

// Inicio de la trayectoria de un golpe, con la física completa (arrastre, Magnus,
// viento, cuerpo celeste). Devuelve puntos separados `spacing` m a lo largo del recorrido
// hasta cubrir `maxLength` m (con rebotes y rodadura si el tiro es rasante), o hasta que
// el balón se detenga o pasen PREVIEW_MAX_TIME segundos.
export function previewTrajectory(
  input: ShotInput,
  position: Vec3,
  config: SimConfig,
  maxLength: number = PREVIEW_LENGTH,
  spacing: number = PREVIEW_SPACING,
): Vec3[] {
  let state = computeShot(input, position);
  const points: Vec3[] = [{ ...state.position }];
  let travelled = 0;
  let nextMark = spacing;

  for (let t = 0; t < PREVIEW_MAX_TIME && travelled < maxLength; t += FIXED_DT) {
    const next = stepBall(state, config, FIXED_DT);
    travelled += Math.hypot(
      next.position.x - state.position.x,
      next.position.y - state.position.y,
      next.position.z - state.position.z,
    );
    if (travelled >= nextMark) {
      points.push({ ...next.position });
      nextMark += spacing;
    }
    state = next;
    if (state.phase === 'stopped' || state.phase === 'holed') break;
  }
  return points;
}
