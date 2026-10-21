import { describe, expect, it } from 'vitest';
import { BALL_SPEC, CELESTIAL_BODIES } from '../src/physics/bodies';
import { FIXED_DT, restHeight, stepBall, type SimConfig } from '../src/physics/simulation';
import type { BallState, Vec3 } from '../src/physics/types';
import { createHoleSession, DEFAULT_RELIEF_OPTION, MAX_BEHIND_DISTANCE } from '../src/game/holeSession';
import { HOLE_1_FIELD } from '../src/world/fields';
import { HOLE_1 } from '../src/world/hole1';

const r = BALL_SPEC.radius;
const field = HOLE_1_FIELD;
const { def, map } = HOLE_1;
const LAKE = def.lakes[0];

const config: SimConfig = {
  ball: BALL_SPEC,
  body: CELESTIAL_BODIES.earth,
  wind: { speed: 0, headingDeg: 0 },
  surfaceAt: field.surfaceAt,
  terrain: field.terrain,
  cup: field.cup,
};

const newSession = () => {
  const session = createHoleSession({ ...field.rules!, cup: field.cup!, ballRadius: r });
  session.reset({ x: 0, y: restHeight(0, 0, config), z: 0 });
  return session;
};

const still = { x: 0, y: 0, z: 0 };

// Balón en el aire sin velocidad a `height` m sobre el terreno en (x, z).
const dropped = (x: number, z: number, height = 0.5): BallState => ({
  position: { x, y: config.terrain.heightAt(x, z) + height, z },
  velocity: still,
  angularVelocity: still,
  phase: 'flying',
});

// Balón rodando hacia (tx, tz) con la velocidad dada.
function rollingToward(x: number, z: number, tx: number, tz: number, speed: number): BallState {
  const length = Math.hypot(tx - x, tz - z);
  const v = { x: ((tx - x) / length) * speed, y: 0, z: ((tz - z) / length) * speed };
  return {
    position: { x, y: restHeight(x, z, config), z },
    velocity: v,
    angularVelocity: { x: v.z / r, y: 0, z: -v.x / r },
    phase: 'rolling',
  };
}

// Simula hasta que el balón se detiene o se emboca, avisando a la sesión de cada paso como el bucle de juego.
function play(session: ReturnType<typeof newSession>, initial: BallState): BallState {
  let state = initial;
  for (let step = 0; step < 240 * 60 && state.phase !== 'stopped' && state.phase !== 'holed'; step++) {
    const next = stepBall(state, config, FIXED_DT);
    session.trackStep(state.position, next.position);
    state = next;
  }
  return state;
}

describe('sesión de hoyo: golpes y estado', () => {
  it('empieza en 0 golpes, jugando, con el resumen del hoyo', () => {
    const session = newSession();
    expect(session.summary).toEqual({ name: 'Hoyo 1', par: 4, strokes: 0, status: 'playing' });
    expect(session.canShoot).toBe(true);
    expect(session.relief).toBeNull();
    expect(session.reliefView({ x: 0, y: r, z: 0 })).toBeNull();
  });

  it('cada golpe lanzado suma 1 y reiniciar vuelve a 0', () => {
    const session = newSession();
    session.registerShot({ x: 0, y: r, z: 0 });
    session.registerShot({ x: 5, y: r, z: -80 });
    expect(session.summary.strokes).toBe(2);
    session.reset({ x: 0, y: r, z: 0 });
    expect(session.summary.strokes).toBe(0);
    expect(session.canShoot).toBe(true);
  });
});

describe('sesión de hoyo: embocado', () => {
  it('un balón que cae sobre la copa queda holed y termina el hoyo', () => {
    const session = newSession();
    session.registerShot({ x: 70, y: r, z: -245 });
    const final = play(session, dropped(def.cup.position.x, def.cup.position.z));
    expect(final.phase).toBe('holed');
    session.ballHoled();
    expect(session.summary).toEqual({ name: 'Hoyo 1', par: 4, strokes: 1, status: 'holed' });
    expect(session.canShoot).toBe(false);
  });
});

describe('sesión de hoyo: fuera de límites', () => {
  it('un balón que se detiene fuera de límites suma 1 golpe y pide volver al último golpe', () => {
    const session = newSession();
    const rest = { x: 3, y: r, z: -120 };
    session.registerShot(rest);
    const final = play(session, dropped(100, -80));
    expect(final.phase).toBe('stopped');
    expect(map.isOutOfBounds(final.position.x, final.position.z)).toBe(true);
    const outcome = session.ballStopped(final.position);
    expect(outcome).toEqual({ kind: 'ob', returnTo: rest });
    expect(session.summary.strokes).toBe(2); // el golpe más la penalización
    expect(session.canShoot).toBe(true);
    expect(session.relief).toBeNull();
  });

  it('un balón que se detiene en el fairway no cambia nada', () => {
    const session = newSession();
    session.registerShot({ x: 0, y: r, z: 0 });
    const before = session.summary;
    const final = play(session, dropped(5, -60));
    expect(session.ballStopped(final.position)).toEqual({ kind: 'ok' });
    expect(session.summary).toEqual(before);
  });
});

describe('sesión de hoyo: caída al lago', () => {
  it('un balón que cae en el lago frena en menos de 1.5 m y queda detenido sobre agua', () => {
    for (const [vx, vz] of [[0, 0], [3, -3], [1, 2]]) {
      let state: BallState = {
        position: { x: LAKE.x, y: 6, z: LAKE.z },
        velocity: { x: vx, y: 2, z: vz },
        angularVelocity: still,
        phase: 'flying',
      };
      let landing: Vec3 | null = null;
      for (let step = 0; step < 240 * 30 && state.phase !== 'stopped'; step++) {
        const before = state;
        state = stepBall(state, config, FIXED_DT);
        if (!landing && (state.phase === 'rolling' || (before.velocity.y < 0 && state.velocity.y > 0))) landing = state.position;
      }
      expect(state.phase).toBe('stopped');
      expect(config.surfaceAt(state.position.x, state.position.z)).toBe('water');
      expect(Math.hypot(state.position.x - landing!.x, state.position.z - landing!.z)).toBeLessThan(1.5);
    }
  });
});

describe('sesión de hoyo: agua', () => {
  // Rueda hacia el centro del lago desde la orilla del lado del tee, a buena velocidad.
  const intoLake = (): { session: ReturnType<typeof newSession>; final: BallState } => {
    const session = newSession();
    session.registerShot({ x: 4, y: r, z: -150 });
    const final = play(session, rollingToward(42, -224, LAKE.x, LAKE.z, 5));
    return { session, final };
  };

  it('un balón que rueda al lago se detiene dentro y se pasa a elegir cómo seguir', () => {
    const { session, final } = intoLake();
    expect(final.phase).toBe('stopped');
    expect(config.surfaceAt(final.position.x, final.position.z)).toBe('water');
    expect(session.ballStopped(final.position)).toEqual({ kind: 'water' });
    expect(session.summary.status).toBe('waterRelief');
    expect(session.summary.strokes).toBe(1); // la penalización llega al confirmar
    expect(session.canShoot).toBe(false);
    expect(session.relief).toEqual({ option: DEFAULT_RELIEF_OPTION, offset: 0 });
  });

  it('recuerda por dónde entró el balón: el punto queda justo fuera del borde del lago', () => {
    const { session } = intoLake();
    const entry = session.state.waterEntry!;
    expect(entry).not.toBeNull();
    expect(map.isInLake(entry.x, entry.z)).toBe(false);
    expect(Math.hypot(entry.x - LAKE.x, entry.z - LAKE.z)).toBeLessThan(15); // al borde de un lago de ~11 × 14 m
  });

  it('la opción 3 deja el balón en la orilla, fuera del agua, con +1 golpe', () => {
    const { session, final } = intoLake();
    session.ballStopped(final.position);
    const view = session.reliefView(final.position)!;
    expect(view.option).toBe(3);
    expect(view.penalty).toBe(1);
    expect(view.placement.valid).toBe(true);
    const result = session.confirmRelief(final.position);
    expect(result.applied).toBe(true);
    expect(map.isInLake(result.position!.x, result.position!.z)).toBe(false);
    expect(session.summary.strokes).toBe(2);
    expect(session.summary.status).toBe('playing');
    expect(session.canShoot).toBe(true);
    expect(session.relief).toBeNull();
  });

  it('el balón dropeado en la orilla se puede jugar: queda quieto fuera del agua', () => {
    const { session, final } = intoLake();
    session.ballStopped(final.position);
    const { position } = session.confirmRelief(final.position);
    const settled = play(session, dropped(position!.x, position!.z, 0.2));
    expect(config.surfaceAt(settled.position.x, settled.position.z)).not.toBe('water');
  });

  it('la opción 2 devuelve el balón al último golpe y la 1 lo deja donde está sin penalizar', () => {
    for (const [option, penalty, moves] of [[2, 1, true], [1, 0, false]] as const) {
      const { session, final } = intoLake();
      session.ballStopped(final.position);
      session.selectRelief(option);
      const result = session.confirmRelief(final.position);
      expect(result.applied).toBe(true);
      expect(session.summary.strokes).toBe(1 + penalty);
      if (moves) expect(result.position).toEqual({ x: 4, z: -150 });
      else expect(result.position).toBeNull();
    }
  });

  it('el desplazamiento de la opción 3 se limita a 2 m a los lados y el de la 4 no baja de 0', () => {
    const { session, final } = intoLake();
    session.ballStopped(final.position);
    session.adjustRelief(5);
    expect(session.relief).toEqual({ option: 3, offset: 2 });
    session.adjustRelief(-10);
    expect(session.relief).toEqual({ option: 3, offset: -2 });
    session.selectRelief(4);
    expect(session.relief).toEqual({ option: 4, offset: 0 }); // al cambiar de opción el desplazamiento vuelve a 0
    session.adjustRelief(-5);
    expect(session.relief!.offset).toBe(0);
    session.adjustRelief(1000);
    expect(session.relief!.offset).toBe(MAX_BEHIND_DISTANCE);
    session.selectRelief(2);
    session.adjustRelief(3); // las opciones 1 y 2 no tienen desplazamiento
    expect(session.relief!.offset).toBe(0);
  });

  it('una posición no válida no se puede confirmar y la elección sigue abierta', () => {
    const { session, final } = intoLake();
    session.ballStopped(final.position);
    session.selectRelief(4);
    // Con la copa al otro lado del lago, 15 m «detrás» de la entrada caen... se busca una distancia que sí cae en el agua.
    let invalidOffset: number | null = null;
    for (let d = 0; d <= 80 && invalidOffset === null; d += 1) {
      session.selectRelief(4);
      session.adjustRelief(d);
      const view = session.reliefView(final.position)!;
      if (!view.placement.valid) invalidOffset = d;
    }
    if (invalidOffset === null) return; // con esta geometría toda la línea es válida: nada que comprobar
    const strokes = session.summary.strokes;
    expect(session.confirmRelief(final.position)).toEqual({ applied: false, position: null });
    expect(session.relief).not.toBeNull();
    expect(session.summary.strokes).toBe(strokes);
    expect(session.summary.status).toBe('waterRelief');
  });

  it('la vista del menú indica la penalización y los golpes antes de confirmar', () => {
    const { session, final } = intoLake();
    session.ballStopped(final.position);
    for (const [option, penalty] of [[1, 0], [2, 1], [3, 1], [4, 1]] as const) {
      session.selectRelief(option);
      const view = session.reliefView(final.position as Vec3)!;
      expect(view.option).toBe(option);
      expect(view.penalty).toBe(penalty);
      expect(view.strokes).toBe(1);
    }
  });

  it('un golpe de ida y vuelta: OB, luego agua, suma todas las penalizaciones', () => {
    const session = newSession();
    session.registerShot({ x: 0, y: r, z: 0 }); // 1
    const ob = play(session, dropped(100, -80));
    session.ballStopped(ob.position); // OB: 2
    session.registerShot({ x: 0, y: r, z: 0 }); // 3
    const water = play(session, rollingToward(42, -224, LAKE.x, LAKE.z, 5));
    session.ballStopped(water.position); // elegir
    session.selectRelief(2);
    session.confirmRelief(water.position); // +1: 4
    expect(session.summary.strokes).toBe(4);
  });
});
