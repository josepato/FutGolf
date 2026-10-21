import { describe, expect, it } from 'vitest';
import { BALL_SPEC } from '../src/physics/bodies';
import {
  applyRelief,
  canShoot,
  newHoleState,
  onBallHoled,
  onBallStopped,
  registerShot,
  reliefPlacement,
  resultName,
} from '../src/game/holeRules';
import { HOLE_1 } from '../src/world/hole1';

const { map, def } = HOLE_1;
const r = BALL_SPEC.radius;
const TEE = { x: 0, y: r, z: 0 };

describe('conteo de golpes', () => {
  it('empieza en 0 golpes, jugando, con el tee como último punto de golpeo', () => {
    const state = newHoleState(TEE);
    expect(state.strokes).toBe(0);
    expect(state.status).toBe('playing');
    expect(state.lastEvent).toBe('none');
    expect(state.lastRest).toEqual(TEE);
    expect(state.waterEntry).toBeNull();
  });

  it('cada golpe lanzado suma 1 y guarda el punto desde donde se golpea', () => {
    let state = newHoleState(TEE);
    state = registerShot(state, TEE);
    expect(state.strokes).toBe(1);
    const second = { x: 5, y: r, z: -80 };
    state = registerShot(state, second);
    expect(state.strokes).toBe(2);
    expect(state.lastRest).toEqual(second);
  });

  it('no muta el estado anterior ni comparte el punto de golpeo', () => {
    const before = newHoleState(TEE);
    const rest = { x: 1, y: r, z: -2 };
    const after = registerShot(before, rest);
    expect(before.strokes).toBe(0);
    rest.x = 99;
    expect(after.lastRest.x).toBe(1);
  });

  it('solo se puede golpear mientras se juega', () => {
    const state = newHoleState(TEE);
    expect(canShoot(state)).toBe(true);
    expect(canShoot({ ...state, status: 'waterRelief' })).toBe(false);
    expect(canShoot(onBallHoled(state))).toBe(false);
  });
});

describe('fuera de límites', () => {
  it('un balón que se detiene en OB suma 1 golpe y vuelve al último punto de golpeo', () => {
    const rest = { x: 3, y: r, z: -120 };
    const shot = registerShot(newHoleState(TEE), rest);
    const { state, outcome } = onBallStopped(shot, { x: 100, y: r, z: -80 }, map, r);
    expect(outcome).toEqual({ kind: 'ob', returnTo: rest });
    expect(state.strokes).toBe(shot.strokes + 1);
    expect(state.status).toBe('playing');
    expect(state.lastEvent).toBe('ob');
  });

  it('un balón que se detiene dentro de límites no recibe penalización', () => {
    // Pudo cruzar el OB rodando y volver: solo cuenta dónde queda detenido.
    const shot = registerShot(newHoleState(TEE), TEE);
    const result = onBallStopped(shot, { x: 10, y: r, z: -90 }, map, r);
    expect(result.outcome).toEqual({ kind: 'ok' });
    expect(result.state).toBe(shot);
  });

  it('el green nunca es OB', () => {
    const shot = registerShot(newHoleState(TEE), TEE);
    const { outcome } = onBallStopped(shot, { x: def.green.center.x + 13, y: r, z: def.green.center.z }, map, r);
    expect(outcome).toEqual({ kind: 'ok' });
  });

  it('tras el OB se puede volver a golpear y el golpe siguiente cuenta', () => {
    let state = registerShot(newHoleState(TEE), TEE); // golpe 1
    state = onBallStopped(state, { x: 100, y: r, z: -80 }, map, r).state; // OB: 2 golpes
    expect(canShoot(state)).toBe(true);
    state = registerShot(state, TEE); // se repite desde el tee: golpe 3
    expect(state.strokes).toBe(3);
  });
});

describe('embocado', () => {
  it('termina el hoyo con el estado holed', () => {
    const state = onBallHoled(registerShot(newHoleState(TEE), TEE));
    expect(state.status).toBe('holed');
    expect(state.lastEvent).toBe('holed');
    expect(state.strokes).toBe(1);
  });
});

describe('resultName', () => {
  it.each<[number, number, string]>([
    [4, 1, 'Hoyo en uno'],
    [3, 1, 'Hoyo en uno'], // con 1 golpe siempre es hoyo en uno
    [5, 2, 'Albatros'],
    [4, 2, 'Eagle'],
    [4, 3, 'Birdie'],
    [4, 4, 'Par'],
    [4, 5, 'Bogey'],
    [4, 6, 'Doble bogey'],
    [4, 8, '+4'],
    [4, 12, '+8'],
  ])('par %i con %i golpes es «%s»', (par, strokes, expected) => {
    expect(resultName(par, strokes)).toBe(expected);
  });

  it('una diferencia por debajo de albatros se muestra con su signo', () => {
    expect(resultName(8, 3)).toBe('-5');
  });
});

describe('golpes totales con penalizaciones', () => {
  it('suma golpes, penalización por OB y por el procedimiento de agua', () => {
    const ctx = { map, cup: def.cup.position, ballRadius: r };
    let state = registerShot(newHoleState(TEE), TEE); // 1
    state = onBallStopped(state, { x: 100, y: r, z: -80 }, map, r).state; // OB: 2
    state = registerShot(state, TEE); // 3
    const inWater = { x: 28, y: r, z: -236 };
    state = onBallStopped(state, inWater, map, r).state; // al agua: sin cambio hasta elegir
    expect(state.strokes).toBe(3);
    const placement = reliefPlacement(2, state, inWater, ctx);
    const applied = applyRelief(state, 2, placement);
    expect(applied.applied).toBe(true);
    expect(applied.state.strokes).toBe(4); // repetir desde el último golpe: +1
    expect(resultName(def.par, applied.state.strokes)).toBe('Par');
  });
});
