import { describe, expect, it } from 'vitest';
import { BALL_SPEC } from '../src/physics/bodies';
import {
  applyRelief,
  canShoot,
  DROP_LATERAL_LIMIT,
  ENTRY_CLEARANCE,
  newHoleState,
  onBallStopped,
  RELIEF_PENALTY,
  registerShot,
  reliefPlacement,
  trackWaterEntry,
  type HoleState,
  type ReliefContext,
  type ReliefOption,
} from '../src/game/holeRules';
import { buildHole, type HoleDef } from '../src/world/hole';
import { HOLE_1 } from '../src/world/hole1';

const r = BALL_SPEC.radius;
const { map, def } = HOLE_1;
const LAKE = def.lakes[0]; // centro (28, −236), semiejes 11 × 14, girado 20°
const ANGLE = (LAKE.rotationDeg! * Math.PI) / 180;
const ctx: ReliefContext = { map, cup: def.cup.position, ballRadius: r };

const at = (x: number, z: number) => ({ x, y: r, z });
// Punto del lago a `u` m del centro sobre su eje mayor en x (eje u girado) y `v` sobre el otro.
const lakePoint = (u: number, v: number) => ({
  x: LAKE.x + u * Math.cos(ANGLE) - v * Math.sin(ANGLE),
  z: LAKE.z + u * Math.sin(ANGLE) + v * Math.cos(ANGLE),
});
// s² de la elipse: 1 = justo en el borde.
const ellipseValue = (x: number, z: number): number => {
  const dx = x - LAKE.x;
  const dz = z - LAKE.z;
  const u = dx * Math.cos(ANGLE) + dz * Math.sin(ANGLE);
  const v = -dx * Math.sin(ANGLE) + dz * Math.cos(ANGLE);
  return (u / LAKE.radiusX) ** 2 + (v / LAKE.radiusZ) ** 2;
};

describe('balón en el agua (3-2-17 y 3-3-7)', () => {
  it('con toda su proyección dentro del lago está en el agua', () => {
    expect(map.isBallInWater(LAKE.x, LAKE.z, r)).toBe(true);
    const p = lakePoint(LAKE.radiusX - 0.5, 0);
    expect(map.isBallInWater(p.x, p.z, r)).toBe(true);
  });

  it('si toca la línea del borde (su proyección no cabe entera) no está en el agua', () => {
    // Centro dentro de la elipse, a 5 cm del borde: el círculo de radio 11 cm cruza la línea.
    const p = lakePoint(LAKE.radiusX - 0.05, 0);
    expect(map.isInLake(p.x, p.z)).toBe(true);
    expect(map.isBallInWater(p.x, p.z, r)).toBe(false);
  });

  it('fuera del lago no está en el agua', () => {
    expect(map.isBallInWater(0, 0, r)).toBe(false);
    const p = lakePoint(LAKE.radiusX + 0.5, 0);
    expect(map.isBallInWater(p.x, p.z, r)).toBe(false);
  });

  it('un hoyo sin lagos nunca tiene balón en el agua', () => {
    const dry = buildHole({ ...(def as HoleDef), lakes: [] }).map;
    expect(dry.isBallInWater(LAKE.x, LAKE.z, r)).toBe(false);
    expect(dry.isInLake(LAKE.x, LAKE.z)).toBe(false);
  });

  it('al detenerse en el agua se pasa a elegir cómo seguir y no se suma penalización todavía', () => {
    const shot = registerShot(newHoleState(at(0, 0)), at(0, 0));
    const { state, outcome } = onBallStopped(shot, at(LAKE.x, LAKE.z), map, r);
    expect(outcome).toEqual({ kind: 'water' });
    expect(state.status).toBe('waterRelief');
    expect(state.lastEvent).toBe('water');
    expect(state.strokes).toBe(shot.strokes);
    expect(canShoot(state)).toBe(false);
  });

  it('un balón que vuela sobre el lago y se detiene fuera no recibe penalización', () => {
    // El vuelo cruza el lago, pero solo cuenta dónde queda detenido.
    const shot = registerShot(newHoleState(at(0, 0)), at(0, 0));
    const result = onBallStopped(shot, at(60, -236), map, r);
    expect(result.outcome).toEqual({ kind: 'ok' });
    expect(result.state.strokes).toBe(shot.strokes);
    expect(result.state.status).toBe('playing');
  });

  it('un balón detenido tocando la línea del borde se juega sin penalización', () => {
    const p = lakePoint(LAKE.radiusX - 0.05, 0);
    const shot = registerShot(newHoleState(at(0, 0)), at(0, 0));
    expect(onBallStopped(shot, at(p.x, p.z), map, r).outcome).toEqual({ kind: 'ok' });
  });
});

describe('punto de entrada al agua', () => {
  const start = (): HoleState => registerShot(newHoleState(at(0, 0)), at(0, 0));
  const outsideNW = at(10, -215); // fuera del lago, hacia el tee
  const outsideE = at(45, -236); // fuera del lago, a la derecha

  it('es el cruce del borde de afuera hacia adentro, retrocedido ENTRY_CLEARANCE por la trayectoria: fuera del lago y cerca del borde', () => {
    const state = trackWaterEntry(start(), outsideNW, at(LAKE.x, LAKE.z), map);
    const entry = state.waterEntry!;
    expect(entry).not.toBeNull();
    expect(map.isInLake(entry.x, entry.z)).toBe(false);
    expect(ellipseValue(entry.x, entry.z)).toBeGreaterThan(1);
    expect(ellipseValue(entry.x, entry.z)).toBeLessThan(1.1); // a unos 0.35 m del borde de un lago de ~11 m
  });

  it('queda sobre la trayectoria del balón, antes de llegar al lago y a ENTRY_CLEARANCE del cruce', () => {
    const before = outsideNW;
    const after = at(LAKE.x, LAKE.z);
    const entry = trackWaterEntry(start(), before, after, map).waterEntry!;
    // Colineal con el paso (producto cruz ≈ 0)...
    const cross = (entry.x - before.x) * (after.z - before.z) - (entry.z - before.z) * (after.x - before.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    // ... y entre el punto de partida y el borde: más cerca de `before` que el cruce.
    const toEntry = Math.hypot(entry.x - before.x, entry.z - before.z);
    const toAfter = Math.hypot(after.x - before.x, after.z - before.z);
    expect(toEntry).toBeLessThan(toAfter);
    // Un balón colocado ahí queda a más de su radio del borde: no cuenta como en el agua aunque bote un poco.
    expect(map.isBallInWater(entry.x, entry.z, r)).toBe(false);
    expect(ENTRY_CLEARANCE).toBeGreaterThan(r);
  });

  it('vale también cuando el balón entra volando (la posición en el aire cruza la proyección del borde)', () => {
    // Sube y baja en el aire: solo importa la proyección horizontal de los pasos.
    const state = trackWaterEntry(start(), { x: 10, y: 8, z: -215 }, { x: LAKE.x, y: 3, z: LAKE.z }, map);
    expect(state.waterEntry).not.toBeNull();
    expect(map.isInLake(state.waterEntry!.x, state.waterEntry!.z)).toBe(false);
  });

  it('un paso que no cruza el borde no cambia el estado', () => {
    const state = start();
    expect(trackWaterEntry(state, at(0, -10), at(0, -20), map)).toBe(state); // lejos del lago
    expect(trackWaterEntry(state, at(LAKE.x, LAKE.z), at(LAKE.x + 1, LAKE.z), map)).toBe(state); // dentro
    expect(trackWaterEntry(state, at(LAKE.x, LAKE.z), outsideNW, map)).toBe(state); // salir no cuenta
  });

  it('si entra, sale y vuelve a entrar vale el último cruce', () => {
    let state = trackWaterEntry(start(), outsideNW, at(LAKE.x, LAKE.z), map);
    const first = state.waterEntry!;
    state = trackWaterEntry(state, at(LAKE.x, LAKE.z), outsideE, map); // sale por la derecha
    expect(state.waterEntry).toEqual(first);
    state = trackWaterEntry(state, outsideE, at(LAKE.x, LAKE.z), map); // vuelve a entrar por la derecha
    const last = state.waterEntry!;
    expect(last).not.toEqual(first);
    expect(last.x).toBeGreaterThan(LAKE.x + 5); // el cruce es el de la derecha
    expect(map.isInLake(last.x, last.z)).toBe(false);
  });

  it('un golpe nuevo borra el punto de entrada anterior', () => {
    const entered = trackWaterEntry(start(), outsideNW, at(LAKE.x, LAKE.z), map);
    expect(registerShot(entered, at(0, 0)).waterEntry).toBeNull();
  });
});

describe('opciones del procedimiento de agua', () => {
  // Balón que entró al lago desde el tee y quedó detenido en el agua.
  const inWater = at(LAKE.x, LAKE.z);
  const rest = at(4, -150);
  function relief(): HoleState {
    let state = registerShot(newHoleState(at(0, 0)), rest);
    state = trackWaterEntry(state, at(10, -215), inWater, map);
    return onBallStopped(state, inWater, map, r).state;
  }

  it('las opciones suman 0, +1, +1 y +1 golpes', () => {
    expect(RELIEF_PENALTY).toEqual({ 1: 0, 2: 1, 3: 1, 4: 1 });
    for (const option of [1, 2, 3, 4] as ReliefOption[]) {
      const state = relief();
      const placement = reliefPlacement(option, state, inWater, ctx, option === 4 ? 10 : 0);
      const applied = applyRelief(state, option, placement);
      expect(applied.applied).toBe(true);
      expect(applied.state.strokes).toBe(state.strokes + RELIEF_PENALTY[option]);
      expect(applied.state.status).toBe('playing');
      expect(applied.state.waterEntry).toBeNull();
      expect(canShoot(applied.state)).toBe(true);
    }
  });

  it('1: jugar como queda deja el balón donde está', () => {
    expect(reliefPlacement(1, relief(), inWater, ctx).position).toEqual({ x: inWater.x, z: inWater.z });
  });

  it('2: repetir desde el último golpe coloca el balón en el último punto de golpeo', () => {
    const placement = reliefPlacement(2, relief(), inWater, ctx);
    expect(placement.position).toEqual({ x: rest.x, z: rest.z });
    expect(placement.valid).toBe(true);
  });

  it('3: dropear en el punto de entrada, a 2 m o menos a los lados, fuera del agua y sin acercarse a la copa', () => {
    const state = relief();
    const entry = state.waterEntry!;
    const entryToCup = Math.hypot(ctx.cup.x - entry.x, ctx.cup.z - entry.z);
    for (const offset of [0, 0.5, -0.5, 1.5]) {
      const placement = reliefPlacement(3, state, inWater, ctx, offset);
      const { x, z } = placement.position;
      expect(Math.hypot(x - entry.x, z - entry.z)).toBeCloseTo(Math.abs(offset), 9);
      expect(Math.hypot(ctx.cup.x - x, ctx.cup.z - z)).toBeGreaterThanOrEqual(entryToCup - 1e-9);
      if (placement.valid) expect(map.isInLake(x, z)).toBe(false);
    }
    expect(reliefPlacement(3, state, inWater, ctx, 0).valid).toBe(true); // el propio punto de entrada
  });

  it('3: a más de 2 m a los lados no vale', () => {
    const placement = reliefPlacement(3, relief(), inWater, ctx, DROP_LATERAL_LIMIT + 0.5);
    expect(placement.valid).toBe(false);
    expect(applyRelief(relief(), 3, placement).applied).toBe(false);
  });

  it('3: el desplazamiento lateral es perpendicular a la línea entre el punto de entrada y la copa', () => {
    // Entrada sintética lejos del lago: copa 100 m «hacia adelante» (−z), la derecha es +x.
    const state: HoleState = { ...relief(), waterEntry: { x: 0, z: -100 } };
    const cupAhead = { ...ctx, cup: { x: 0, z: -200 } };
    expect(reliefPlacement(3, state, inWater, cupAhead, 1.5).position).toEqual({ x: 1.5, z: -100 });
    expect(reliefPlacement(3, state, inWater, cupAhead, -1.5).position).toEqual({ x: -1.5, z: -100 });
  });

  it('4: sobre la línea copa–entrada, detrás de la entrada y a la distancia pedida', () => {
    const state: HoleState = { ...relief(), waterEntry: { x: 0, z: -100 } };
    const cupAhead = { ...ctx, cup: { x: 0, z: -200 } };
    const placement = reliefPlacement(4, state, inWater, cupAhead, 30);
    expect(placement.position).toEqual({ x: 0, z: -70 }); // se aleja de la copa 30 m
    expect(placement.valid).toBe(true);
    expect(reliefPlacement(4, state, inWater, cupAhead, -5).position).toEqual({ x: 0, z: -100 }); // no pasa de la entrada
  });

  it('4: una posición dentro del lago no vale, pero detrás del lago sí', () => {
    // Entrada al borde derecho del lago y copa más a la derecha: «detrás» cruza el lago.
    const state: HoleState = { ...relief(), waterEntry: { x: 45, z: -236 } };
    const cupRight = { ...ctx, cup: { x: 80, z: -236 } };
    expect(reliefPlacement(4, state, inWater, cupRight, 15).valid).toBe(false); // (30, −236) está en el lago
    expect(reliefPlacement(4, state, inWater, cupRight, 40).valid).toBe(true); // (5, −236), al otro lado
  });

  it('las opciones 3 y 4 no valen sin punto de entrada', () => {
    const state: HoleState = { ...relief(), waterEntry: null };
    expect(reliefPlacement(3, state, inWater, ctx).valid).toBe(false);
    expect(reliefPlacement(4, state, inWater, ctx, 10).valid).toBe(false);
  });

  it('no se puede confirmar una opción si no se está en el procedimiento de agua', () => {
    const playing = registerShot(newHoleState(at(0, 0)), rest);
    const placement = reliefPlacement(2, playing, at(0, 0), ctx);
    expect(applyRelief(playing, 2, placement)).toEqual({ state: playing, applied: false });
  });

  it('mientras se elige, no se puede golpear', () => {
    expect(canShoot(relief())).toBe(false);
  });
});
