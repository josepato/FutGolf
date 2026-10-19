import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createScenery } from '../src/world/scenery';
import { TEST_TERRAIN } from '../src/world/testTerrain';
import { FLAT_TERRAIN } from '../src/world/terrain';

const TOLERANCE = 0.05; // m, de los criterios de aceptación

function sceneryOn(terrain: typeof TEST_TERRAIN): THREE.Scene {
  const scene = new THREE.Scene();
  createScenery(scene).setTerrain(terrain);
  return scene;
}

// Grupos del paisaje que cuelgan de una base en el suelo: casa, bandera y postes.
function groundedGroups(scene: THREE.Scene): THREE.Object3D[] {
  const spots: Array<[number, number]> = [
    [-150, -40], // casa club
    [105, -85], // bandera
    ...[1, 2, 3, 4, 5, 6].flatMap((i): Array<[number, number]> => [[-50, -i * 50], [50, -i * 50]]), // postes
  ];
  return spots.map(([x, z]) => {
    const found = scene.children.find((c) => c.type === 'Group' && c.position.x === x && c.position.z === z);
    expect(found, `grupo en (${x}, ${z})`).toBeDefined();
    return found!;
  });
}

describe('paisaje sobre el terreno', () => {
  const scene = sceneryOn(TEST_TERRAIN);

  it('la casa, la bandera y los postes tienen la base a 5 cm o menos de heightAt', () => {
    for (const group of groundedGroups(scene)) {
      const ground = TEST_TERRAIN.heightAt(group.position.x, group.position.z);
      expect(Math.abs(group.position.y - ground)).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('el relieve sí mueve algo del paisaje (no está todo a y = 0)', () => {
    const heights = groundedGroups(scene).map((g) => g.position.y);
    expect(Math.max(...heights.map(Math.abs))).toBeGreaterThan(0.5);
  });

  it('la base de cada árbol está a 5 cm o menos de heightAt', () => {
    const trunk = scene.children.find((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh)!;
    expect(trunk.count).toBeGreaterThan(300);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const size = new THREE.Vector3();
    let onRelief = 0;
    for (let i = 0; i < trunk.count; i++) {
      trunk.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, size);
      const base = position.y - 1.1 * size.y; // el tronco mide 2.2 m y su centro está a mitad
      const ground = TEST_TERRAIN.heightAt(position.x, position.z);
      expect(Math.abs(base - ground)).toBeLessThanOrEqual(TOLERANCE);
      if (Math.abs(ground) > 0.5) onRelief += 1;
    }
    expect(onRelief).toBeGreaterThan(10); // hay árboles sobre las lomas
  });

  it('con FLAT_TERRAIN todo vuelve al suelo y = 0', () => {
    const flat = sceneryOn(FLAT_TERRAIN);
    for (const group of groundedGroups(flat)) expect(group.position.y).toBe(0);
  });
});
