import * as THREE from 'three';
import type { Terrain, Vec3 } from '../physics/types';

const CONTOUR_INTERVAL = 0.25; // m de altura entre curvas de nivel
const CONTOUR_MAJOR_EVERY = 4; // una curva más marcada cada N curvas
const CONTOUR_COLOR = new THREE.Color(0x0b2a0b);

// Curvas de nivel en el propio material del terreno: líneas a alturas múltiplos de
// CONTOUR_INTERVAL (desfasadas medio intervalo para que el suelo plano a y = 0 no
// quede cubierto). El ancho es de ~1 px gracias a fwidth y se desvanece donde el suelo
// es casi plano. `enabled.value` las apaga sin recompilar el shader.
export function addContourLines(material: THREE.MeshLambertMaterial): { enabled: { value: number } } {
  const enabled = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uContourEnabled = enabled;
    shader.uniforms.uContourColor = { value: CONTOUR_COLOR };
    shader.uniforms.uContourInterval = { value: CONTOUR_INTERVAL };
    shader.uniforms.uContourMajor = { value: CONTOUR_MAJOR_EVERY };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vContourHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvContourHeight = position.y;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vContourHeight;
uniform float uContourEnabled;
uniform vec3 uContourColor;
uniform float uContourInterval;
uniform float uContourMajor;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float level = vContourHeight / uContourInterval;
  float fw = max(fwidth(level), 1e-5);
  float dist = abs(fract(level) - 0.5);
  float line = 1.0 - clamp(dist / (fw * 1.2), 0.0, 1.0);
  float index = floor(level);
  float major = step(abs(mod(index, uContourMajor)), 0.5);
  float strength = line * mix(0.28, 0.55, major);
  // sin pendiente apreciable no hay curvas (evita líneas anchas en el llano)
  strength *= smoothstep(0.0005, 0.004, fwidth(vContourHeight));
  diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, strength * uContourEnabled);
}`,
      );
  };
  return { enabled };
}

// ---- Flechas de caída ----------------------------------------------------------

const ARROW_SPACING = 6; // m entre flechas (rejilla fija en el mundo)
const ARROW_RADIUS = 48; // m alrededor del balón que muestran flechas
const ARROW_MIN_SLOPE_DEG = 0.4; // por debajo de esto no se dibuja
const ARROW_FULL_SLOPE_DEG = 12; // pendiente a la que la flecha llega al tamaño y color máximos
const ARROW_LIFT = 0.06; // m sobre el suelo, contra el z-fighting
const MAX_ARROWS = Math.ceil(((2 * ARROW_RADIUS) / ARROW_SPACING + 1) ** 2);

// Flecha plana sobre el plano XZ apuntando a +X, de longitud 1 centrada en el origen.
function arrowGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.07);
  shape.lineTo(0.1, -0.07);
  shape.lineTo(0.1, -0.22);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.1, 0.22);
  shape.lineTo(0.1, 0.07);
  shape.lineTo(-0.5, 0.07);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape); // en el plano XY, normal +Z
  geometry.rotateX(-Math.PI / 2); // a XZ con normal +Y (la y de la forma pasa a -z)
  return geometry;
}

// Tono de la flecha: el color de la superficie, más claro (u oscuro si ya es muy claro,
// como la arena) para que se lea sin gritar. Un poco más marcado cuanto más pendiente.
const TONE_SHIFT_GENTLE = 0.1;
const TONE_SHIFT_STEEP = 0.2;
const hsl = { h: 0, s: 0, l: 0 };

function arrowTone(surfaceColor: number, t: number, target: THREE.Color): THREE.Color {
  target.setHex(surfaceColor).getHSL(hsl);
  const shift = TONE_SHIFT_GENTLE + (TONE_SHIFT_STEEP - TONE_SHIFT_GENTLE) * t;
  return target.setHSL(hsl.h, hsl.s, hsl.l > 0.6 ? hsl.l - shift : hsl.l + shift);
}

export interface ReliefArrows {
  readonly object: THREE.Object3D;
  setCenter(position: Vec3): void; // recentra la rejilla en el balón (barato si no cambió de celda)
  setTerrain(terrain: Terrain): void;
  setVisible(visible: boolean): void;
}

// Flechas que apuntan hacia donde rodaría el balón (cuesta abajo), más largas y rojas
// cuanto mayor la pendiente. Rejilla fija en el mundo, solo alrededor del balón.
export function createReliefArrows(surfaceColorAt: (x: number, z: number) => number): ReliefArrows {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(arrowGeometry(), material, MAX_ARROWS);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ARROWS * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;

  let terrain: Terrain | null = null;
  let centerCell = { i: Number.NaN, j: Number.NaN };
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const normal = new THREE.Vector3();
  const down = new THREE.Vector3();
  const side = new THREE.Vector3();

  function rebuild(cx: number, cz: number): void {
    if (!terrain) return;
    const cells = Math.ceil(ARROW_RADIUS / ARROW_SPACING);
    const i0 = Math.round(cx / ARROW_SPACING);
    const j0 = Math.round(cz / ARROW_SPACING);
    let count = 0;
    for (let dj = -cells; dj <= cells; dj++) {
      for (let di = -cells; di <= cells; di++) {
        const x = (i0 + di) * ARROW_SPACING;
        const z = (j0 + dj) * ARROW_SPACING;
        if (Math.hypot(x - cx, z - cz) > ARROW_RADIUS) continue;
        const slope = terrain.slopeDegAt(x, z);
        if (slope < ARROW_MIN_SLOPE_DEG) continue;

        const n = terrain.normalAt(x, z);
        normal.set(n.x, n.y, n.z);
        // Cuesta abajo = la gravedad proyectada sobre el plano tangente.
        down.set(0, -1, 0).addScaledVector(normal, normal.y).normalize();
        side.crossVectors(down, normal);

        // Raíz de la pendiente: las caídas suaves (1° a 3°, las del green) se distinguen entre sí aunque no lleguen a las fuertes.
        const t = Math.sqrt(Math.min(1, slope / ARROW_FULL_SLOPE_DEG));
        const length = 0.5 + 0.8 * t;
        const width = 0.35 + 0.2 * t;
        matrix.makeBasis(down.clone().multiplyScalar(length), normal, side.clone().multiplyScalar(width));
        matrix.setPosition(
          x + n.x * ARROW_LIFT,
          terrain.heightAt(x, z) + n.y * ARROW_LIFT,
          z + n.z * ARROW_LIFT,
        );
        mesh.setMatrixAt(count, matrix);
        mesh.setColorAt(count, arrowTone(surfaceColorAt(x, z), t, color));
        count += 1;
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    object: mesh,
    setCenter(position) {
      const i = Math.round(position.x / ARROW_SPACING);
      const j = Math.round(position.z / ARROW_SPACING);
      if (i === centerCell.i && j === centerCell.j) return;
      centerCell = { i, j };
      rebuild(position.x, position.z);
    },
    setTerrain(next) {
      terrain = next;
      centerCell = { i: Number.NaN, j: Number.NaN }; // fuerza reconstruir en el próximo setCenter
      mesh.count = 0;
    },
    setVisible(next) {
      mesh.visible = next;
    },
  };
}
