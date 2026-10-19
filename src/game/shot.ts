import { FIXED_DT, stepBall, type SimConfig } from '../physics/simulation';
import type { BallState, ShotInput, Vec3 } from '../physics/types';

// Valores iniciales de afinación; no son parte del contrato salvo donde la spec los cita.
export const MAX_LAUNCH_SPEED = 35; // m/s con power = 1
export const BASE_ELEVATION_DEG = 3; // elevación con el contacto al centro
export const MAX_EXTRA_ELEVATION_DEG = 37; // se suma con el contacto en el borde inferior
export const MAX_SPIN = 60; // rad/s en cada eje
export const MAX_ACCURACY_DEVIATION_DEG = 8; // desvío de rumbo con accuracy = ±1

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

// Elevación del tiro: balón golpeado bajo el centro (y < 0) = más globo;
// sobre el centro (y > 0) = más raso, hasta 0°.
export function elevationDeg(contactY: number): number {
  const y = clamp(contactY, -1, 1);
  return y <= 0 ? BASE_ELEVATION_DEG - y * MAX_EXTRA_ELEVATION_DEG : BASE_ELEVATION_DEG * (1 - y);
}

// Convierte un golpe en la velocidad y el spin iniciales del balón.
// Spin (en ejes del jugador): contact.y < 0 da backspin (ω a lo largo de "derecha"
// positivo, el balón sube) y contact.y > 0 topspin. contact.x > 0 (golpe a la derecha
// del centro) da spin vertical positivo, que curva el balón hacia la izquierda.
export function computeShot(input: ShotInput, position: Vec3): BallState {
  const power = clamp(input.power, 0, 1);
  const accuracy = clamp(input.accuracy, -1, 1);
  const contactX = clamp(input.contact.x, -1, 1);
  const contactY = clamp(input.contact.y, -1, 1);

  const actualHeading = input.headingDeg + accuracy * MAX_ACCURACY_DEVIATION_DEG;
  const elevation = toRadians(elevationDeg(contactY));
  const speed = power * MAX_LAUNCH_SPEED;
  const forward = forwardVector(actualHeading);
  const right = rightVector(actualHeading);

  const backspin = -contactY * MAX_SPIN;
  const sidespin = contactX * MAX_SPIN;

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
    if (state.phase === 'stopped') break;
  }
  return points;
}
