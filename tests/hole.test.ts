import { describe, expect, it } from 'vitest';
import { buildHole, type HoleDef } from '../src/world/hole';

// Geometría del Hoyo 1 del SPEC 03 con terreno llano: aquí solo se prueba el mapa.
const DEF: HoleDef = {
  name: 'Hoyo de prueba',
  par: 4,
  tee: { x: 0, z: 0 },
  teeHeadingDeg: 0,
  centerline: [{ x: 0, z: 0 }, { x: 0, z: -160 }, { x: 75, z: -250 }],
  fairwayHalfWidth: 20,
  roughHalfWidth: 45,
  green: { center: { x: 75, z: -250 }, radius: 14 },
  cup: { position: { x: 75, z: -250 }, radius: 0.255, depth: 0.28 },
  bunkers: [
    { x: -14, z: -150, radiusX: 9, radiusZ: 16 },
    { x: 62, z: -246, radiusX: 7, radiusZ: 5, rotationDeg: 30 },
    { x: 90, z: -258, radiusX: 8, radiusZ: 5, rotationDeg: -20 },
  ],
  lakes: [{ x: 28, z: -236, radiusX: 11, radiusZ: 14, rotationDeg: 20 }],
  terrain: {
    bounds: { minX: -200, maxX: 200, minZ: -360, maxZ: 120 },
    cell: 1,
    edgeFade: 0,
    flatZones: [],
    hills: [],
  },
};

const { map, terrain, def } = buildHole(DEF);

// Perpendicular unitaria del segundo tramo (del codo al green), hacia la derecha del jugador.
const LEG = { x: 75, z: -90 };
const LEG_LENGTH = Math.hypot(LEG.x, LEG.z);
const PERP = { x: -LEG.z / LEG_LENGTH, z: LEG.x / LEG_LENGTH };
const onSecondLeg = (t: number, offset: number): [number, number] => [
  LEG.x * t + PERP.x * offset,
  -160 + LEG.z * t + PERP.z * offset,
];

describe('buildHole', () => {
  it('devuelve la definición y un terreno con los límites de la definición', () => {
    expect(def).toBe(DEF);
    expect(terrain.bounds).toEqual(DEF.terrain.bounds);
    expect(terrain.heightAt(10, -100)).toBe(0);
  });
});

describe('surfaceAt: franjas y distancia a la línea de juego', () => {
  it('el tee y el tramo recto son fairway', () => {
    expect(map.surfaceAt(0, 0)).toBe('fairway');
    expect(map.surfaceAt(0, -80)).toBe('fairway');
    expect(map.surfaceAt(19, -80)).toBe('fairway');
  });

  it('entre 20 y 45 m de la línea de juego es rough', () => {
    expect(map.surfaceAt(21, -80)).toBe('rough');
    expect(map.surfaceAt(44, -80)).toBe('rough');
    expect(map.surfaceAt(0, 40)).toBe('rough'); // detrás del tee
  });

  it('es simétrica respecto a la línea de juego en el tramo recto', () => {
    for (const d of [0, 10, 19, 21, 30, 44, 46, 60]) {
      expect(map.surfaceAt(d, -80)).toBe(map.surfaceAt(-d, -80));
      expect(map.isOutOfBounds(d, -80)).toBe(map.isOutOfBounds(-d, -80));
    }
  });

  it('el dogleg sigue la línea de juego en el segundo tramo', () => {
    expect(map.surfaceAt(...onSecondLeg(0.5, 0))).toBe('fairway');
    expect(map.surfaceAt(...onSecondLeg(0.5, 15))).toBe('fairway');
    expect(map.surfaceAt(...onSecondLeg(0.5, 30))).toBe('rough');
    expect(map.surfaceAt(...onSecondLeg(0.5, -30))).toBe('rough');
    // A 60 m del eje del tramo recto: sin el segundo tramo sería OB, con el dogleg es fairway.
    expect(map.surfaceAt(60, -232)).toBe('fairway');
    expect(map.isOutOfBounds(60, -232)).toBe(false);
  });

  it('el límite entre fairway y rough está en fairwayHalfWidth', () => {
    expect(map.surfaceAt(20, -80)).toBe('fairway');
    expect(map.surfaceAt(20.01, -80)).toBe('rough');
  });
});

describe('surfaceAt: green, bunkers y lago', () => {
  it('el green es green dentro de su radio, incluida la copa', () => {
    expect(map.surfaceAt(75, -250)).toBe('green');
    expect(map.surfaceAt(75 + 13.9, -250)).toBe('green');
    expect(map.surfaceAt(75, -250 + 13.9)).toBe('green');
  });

  it('el green tiene prioridad sobre un bunker que lo toca', () => {
    // (90, -258) es el centro del bunker derecho y está a 17 m del centro del green: fuera.
    expect(map.surfaceAt(90, -258)).toBe('sand');
    // (80, -254) está dentro del green y dentro de la elipse del bunker: gana el green.
    expect(map.surfaceAt(80, -254)).toBe('green');
  });

  it('los bunkers son sand dentro de su elipse, aunque estén en el fairway', () => {
    expect(map.surfaceAt(-14, -150)).toBe('sand'); // centro del bunker de la zona de caída
    expect(map.surfaceAt(-14 + 8, -150)).toBe('sand');
    expect(map.surfaceAt(-14, -150 + 15)).toBe('sand');
    expect(map.surfaceAt(-14 + 10, -150)).toBe('fairway'); // fuera del semieje x = 9
    expect(map.surfaceAt(-14, -150 + 17)).toBe('fairway'); // fuera del semieje z = 16
  });

  it('el giro de la elipse sigue la convención de HillDef', () => {
    const a = (20 * Math.PI) / 180;
    // Lago girado 20°: el eje u (radiusX = 11) apunta a (cos a, sin a) y el v (radiusZ = 14) a (-sin a, cos a).
    expect(map.surfaceAt(28, -236)).toBe('water');
    expect(map.surfaceAt(28 + 10 * Math.cos(a), -236 + 10 * Math.sin(a))).toBe('water');
    expect(map.surfaceAt(28 + 12 * Math.cos(a), -236 + 12 * Math.sin(a))).not.toBe('water');
    expect(map.surfaceAt(28 - 13 * Math.sin(a), -236 + 13 * Math.cos(a))).toBe('water');
    expect(map.surfaceAt(28 - 15 * Math.sin(a), -236 + 15 * Math.cos(a))).not.toBe('water');
  });

  it('el agua tiene prioridad sobre el fairway y el bunker', () => {
    // El centro del lago está a ~27 m de la línea de juego (rough); un punto cercano al
    // borde del fairway, dentro del lago, también es agua.
    const [x, z] = [24, -228];
    expect(map.surfaceAt(x, z)).toBe('water');
  });

  it('un hoyo sin lagos no tiene agua', () => {
    const dry = buildHole({ ...DEF, lakes: [] }).map;
    expect(dry.surfaceAt(28, -236)).not.toBe('water');
  });
});

describe('isOutOfBounds', () => {
  it('es falso a 45 m o menos de la línea de juego y verdadero más allá', () => {
    expect(map.isOutOfBounds(0, -80)).toBe(false);
    expect(map.isOutOfBounds(45, -80)).toBe(false);
    expect(map.isOutOfBounds(45.01, -80)).toBe(true);
    expect(map.isOutOfBounds(-100, -80)).toBe(true);
  });

  it('en el segundo tramo mide la distancia perpendicular', () => {
    expect(map.isOutOfBounds(...onSecondLeg(0.5, 44))).toBe(false);
    expect(map.isOutOfBounds(...onSecondLeg(0.5, 46))).toBe(true);
    expect(map.isOutOfBounds(...onSecondLeg(0.5, -46))).toBe(true);
  });

  it('detrás del tee y pasado el green mide la distancia al extremo de la línea', () => {
    expect(map.isOutOfBounds(0, 44)).toBe(false);
    expect(map.isOutOfBounds(0, 46)).toBe(true);
    expect(map.isOutOfBounds(75, -250 - 44)).toBe(false);
    expect(map.isOutOfBounds(75, -250 - 46)).toBe(true);
  });

  it('el green nunca es fuera de límites', () => {
    const wideGreen = buildHole({
      ...DEF,
      roughHalfWidth: 5,
      green: { center: { x: 75, z: -250 }, radius: 14 },
    }).map;
    expect(wideGreen.isOutOfBounds(75 + 13, -250)).toBe(false);
  });

  it('el OB no es una superficie: allí surfaceAt devuelve rough', () => {
    expect(map.isOutOfBounds(100, -80)).toBe(true);
    expect(map.surfaceAt(100, -80)).toBe('rough');
  });
});

describe('distanceToCup', () => {
  it('mide la distancia horizontal al centro de la copa', () => {
    expect(map.distanceToCup(75, -250)).toBe(0);
    expect(map.distanceToCup(78, -254)).toBeCloseTo(5, 12);
    expect(map.distanceToCup(0, 0)).toBeCloseTo(Math.hypot(75, 250), 12);
  });
});
