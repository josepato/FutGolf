import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { distanceToPolyline, pointAlong, polylineLength } from '../src/world/geometry';
import { HOLE_1_FIELD, testField, type Field } from '../src/world/fields';
import { HOLE_1 } from '../src/world/hole1';
import { createScenery } from '../src/world/scenery';

const TOLERANCE = 0.05; // m
const { def, map } = HOLE_1;

function sceneryOn(field: Field): THREE.Scene {
  const scene = new THREE.Scene();
  createScenery(scene).setField(field.scenery, field.terrain);
  return scene;
}

function trees(scene: THREE.Scene): THREE.InstancedMesh {
  return scene.children.find((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh)!;
}

function treePositions(mesh: THREE.InstancedMesh): Array<{ x: number; z: number; base: number }> {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const spots: Array<{ x: number; z: number; base: number }> = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    matrix.decompose(position, quaternion, size);
    spots.push({ x: position.x, z: position.z, base: position.y - 1.1 * size.y });
  }
  return spots;
}

describe('geometría de polilíneas', () => {
  const path = [{ x: 0, z: 0 }, { x: 0, z: -100 }, { x: 100, z: -100 }];

  it('mide la longitud y da distancias al trazo', () => {
    expect(polylineLength(path)).toBe(200);
    expect(distanceToPolyline(10, -50, path)).toBeCloseTo(10, 12);
    expect(distanceToPolyline(50, -110, path)).toBeCloseTo(10, 12);
  });

  it('pointAlong da el punto y la dirección del tramo, y prolonga los extremos', () => {
    expect(pointAlong(path, 50)).toEqual({ point: { x: 0, z: -50 }, direction: { x: 0, z: -1 } });
    expect(pointAlong(path, 150).point).toEqual({ x: 50, z: -100 });
    expect(pointAlong(path, 150).direction).toEqual({ x: 1, z: 0 });
    expect(pointAlong(path, -20).point).toEqual({ x: 0, z: 20 }); // antes del inicio
    expect(pointAlong(path, 230).point).toEqual({ x: 130, z: -100 }); // pasado el final
  });
});

describe('campos', () => {
  it('el Hoyo 1 sale del tee del hoyo con el rumbo del hoyo, con copa y fuera de límites', () => {
    expect(HOLE_1_FIELD.tee).toEqual({ x: def.tee.x, z: def.tee.z, headingDeg: def.teeHeadingDeg });
    expect(HOLE_1_FIELD.cup).toBe(def.cup);
    expect(HOLE_1_FIELD.terrain).toBe(HOLE_1.terrain);
    expect(HOLE_1_FIELD.isOutOfBounds!(100, -80)).toBe(true);
    expect(HOLE_1_FIELD.surfaceAt(def.green.center.x, def.green.center.z)).toBe('green');
  });

  it('el campo de prueba no tiene copa ni fuera de límites, y sale del origen', () => {
    for (const relief of [true, false]) {
      const field = testField(relief);
      expect(field.cup).toBeUndefined();
      expect(field.isOutOfBounds).toBeUndefined();
      expect(field.tee).toEqual({ x: 0, z: 0, headingDeg: 0 });
      expect(field.waters).toEqual([]);
      expect(field.surfaceAt(0, -50)).toBe('fairway');
      expect(field.surfaceAt(0, -150)).toBe('rough');
      expect(field.surfaceAt(0, -250)).toBe('sand');
    }
    expect(testField(true).terrain.heightAt(75, -100)).not.toBe(testField(false).terrain.heightAt(75, -100));
  });

  it('la caja del tee mide 3 m de ancho por 2 m de fondo (reglamento 3-2-16)', () => {
    expect(HOLE_1_FIELD.teeBox).toEqual({ width: 3, depth: 2 });
    expect(testField(true).teeBox).toBeUndefined();
  });

  it('el lago tiene su lámina de agua, bajo la orilla más baja y sobre el fondo', () => {
    const water = HOLE_1_FIELD.waters[0];
    expect(HOLE_1_FIELD.waters).toHaveLength(def.lakes.length);
    expect(water.level).toBeLessThan(0); // el terreno del borde del lago ronda 0
    expect(water.level).toBeGreaterThan(HOLE_1.terrain.heightAt(water.x, water.z)); // sobre el fondo hundido
    const angle = ((water.rotationDeg ?? 0) * Math.PI) / 180;
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      const u = water.radiusX * Math.cos(t);
      const v = water.radiusZ * Math.sin(t);
      const ground = HOLE_1.terrain.heightAt(
        water.x + u * Math.cos(angle) - v * Math.sin(angle),
        water.z + u * Math.sin(angle) + v * Math.cos(angle),
      );
      expect(water.level).toBeLessThanOrEqual(ground); // ninguna orilla queda bajo el agua
    }
  });

  it('los planos de borde del Hoyo 1 no cubren el terreno (taparían el lago y los valles)', () => {
    const b = HOLE_1.terrain.bounds;
    const rects = HOLE_1_FIELD.surroundings(b);
    expect(rects.length).toBe(4);
    for (const r of rects) {
      const overlapsX = r.minX < b.maxX && r.maxX > b.minX;
      const overlapsZ = r.minZ < b.maxZ && r.maxZ > b.minZ;
      expect(overlapsX && overlapsZ, `plano ${JSON.stringify(r)}`).toBe(false);
    }
    // Y juntos con el terreno cubren los alrededores: un punto lejano de cada lado cae en algún plano.
    for (const [x, z] of [[-500, -100], [500, -100], [0, 500], [0, -800]]) {
      expect(rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ)).toBe(true);
    }
  });
});

describe('paisaje del Hoyo 1', () => {
  const scene = sceneryOn(HOLE_1_FIELD);
  const { corridor } = HOLE_1_FIELD.scenery;
  const spots = treePositions(trees(scene));

  it('el corredor de juego sigue la línea del hoyo y es tan ancho como el rough', () => {
    expect(corridor.halfWidth).toBe(def.roughHalfWidth);
    for (const p of def.centerline) expect(distanceToPolyline(p.x, p.z, corridor.path)).toBeLessThan(1e-9);
    expect(polylineLength(corridor.path)).toBeGreaterThan(polylineLength(def.centerline) + 100); // prolongado en ambos extremos
  });

  it('hay un bosque (cientos de árboles) y ninguno cae dentro del corredor de juego', () => {
    expect(spots.length).toBeGreaterThan(300);
    for (const spot of spots) {
      expect(distanceToPolyline(spot.x, spot.z, corridor.path)).toBeGreaterThanOrEqual(corridor.halfWidth);
    }
  });

  it('ningún árbol queda en el fairway, el rough, el green, un bunker ni el lago', () => {
    for (const spot of spots) {
      expect(map.isOutOfBounds(spot.x, spot.z), `árbol en (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)})`).toBe(true);
    }
  });

  it('hay árboles a ambos lados del hoyo, siguiendo el dogleg', () => {
    const near = spots.filter((s) => distanceToPolyline(s.x, s.z, def.centerline) < 80);
    expect(near.length).toBeGreaterThan(80);
    const side = (s: { x: number; z: number }): number => {
      // Lado del tramo recto de arriba: izquierda o derecha de la línea (z < -20 y z > -160, x relativo a 0).
      return Math.sign(s.x);
    };
    const straight = near.filter((s) => s.z < -20 && s.z > -150);
    expect(straight.some((s) => side(s) < 0)).toBe(true);
    expect(straight.some((s) => side(s) > 0)).toBe(true);
    // Y a lo largo del segundo tramo (más allá del codo hacia el green).
    expect(near.some((s) => s.z < -200 && s.x > 60)).toBe(true);
  });

  it('la base de cada árbol está a 5 cm o menos de heightAt', () => {
    for (const spot of spots) {
      expect(Math.abs(spot.base - HOLE_1.terrain.heightAt(spot.x, spot.z))).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('la bandera lejana del campo de prueba queda oculta y los postes siguen la línea de juego', () => {
    const groups = scene.children.filter((c): c is THREE.Group => c.type === 'Group' && c.children.length === 2);
    const visible = groups.filter((g) => g.visible);
    // 5 postes por lado a 50, 100, 150, 200 y 250 m (el hoyo mide ~277 m): 10 visibles, 2 ocultos.
    expect(visible.length).toBe(10);
    for (const post of visible) {
      const ground = HOLE_1.terrain.heightAt(post.position.x, post.position.z);
      expect(Math.abs(post.position.y - ground)).toBeLessThanOrEqual(TOLERANCE);
      const distance = distanceToPolyline(post.position.x, post.position.z, def.centerline);
      expect(distance).toBeCloseTo(HOLE_1_FIELD.scenery.markers.offset, 6); // a `offset` m de la línea
    }
    // Ningún grupo visible está en la posición de la bandera lejana del campo de prueba.
    expect(visible.some((g) => g.position.x === 105 && g.position.z === -85)).toBe(false);
  });

  it('volver al campo de prueba reparte el paisaje como antes', () => {
    const test = sceneryOn(testField(true));
    const testTrees = treePositions(trees(test));
    expect(testTrees.length).toBeGreaterThan(300);
    // En el campo de prueba el corredor es |x| < 60: ningún árbol dentro.
    for (const s of testTrees) {
      expect(Math.abs(s.x) >= 60 || s.z >= 100 || s.z <= -340).toBe(true);
    }
    const groups = test.children.filter((c): c is THREE.Group => c.type === 'Group');
    expect(groups.some((g) => g.visible && g.position.x === 105 && g.position.z === -85)).toBe(true); // bandera lejana
  });
});
