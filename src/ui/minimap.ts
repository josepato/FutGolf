import { forwardVector } from '../game/shot';
import type { TerrainBounds, Vec3 } from '../physics/types';
import type { Field } from '../world/fields';
import { surfaceMapFor } from '../render/surfaceTexture';

// Minimapa del hoyo: vista cenital con las superficies, la copa y el balón. Orientación fija:
// el tee abajo y el green arriba (el rumbo 0 es hacia -z, que queda hacia arriba). Las
// superficies se pintan una vez; cada cambio del balón o del rumbo solo repinta el balón y la línea
// de dirección.

const MAX_WIDTH = 180; // px
const MAX_HEIGHT = 220; // px
const PADDING = 6; // px de margen alrededor del hoyo
const AIM_LENGTH = 30; // m que alcanza la línea de dirección en el minimapa
const BALL_RADIUS_PX = 3.5;

export interface MinimapLayout {
  width: number; // px del lienzo
  height: number;
  scale: number; // px por metro
  toPixel(x: number, z: number): [number, number];
}

// Encaja `region` en el lienzo conservando la proporción. Orientación fija: x crece hacia la
// derecha y z hacia abajo (así el tee, con z mayor, queda abajo y el green arriba).
export function computeMinimapLayout(
  region: TerrainBounds,
  maxWidth: number = MAX_WIDTH,
  maxHeight: number = MAX_HEIGHT,
  padding: number = PADDING,
): MinimapLayout {
  const width = region.maxX - region.minX;
  const depth = region.maxZ - region.minZ;
  const scale = Math.min((maxWidth - 2 * padding) / width, (maxHeight - 2 * padding) / depth);
  return {
    width: Math.round(width * scale + 2 * padding),
    height: Math.round(depth * scale + 2 * padding),
    scale,
    toPixel: (x, z) => [padding + (x - region.minX) * scale, padding + (z - region.minZ) * scale],
  };
}

export interface Minimap {
  readonly element: HTMLElement;
  setField(field: Field): void; // sin región de minimapa en el campo, se oculta
  setBall(position: Vec3): void;
  setHeading(headingDeg: number): void; // rumbo de golpe
}

export function createMinimap(parent: HTMLElement): Minimap {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'left:16px',
    'top:150px',
    'padding:6px',
    'border-radius:8px',
    'background:rgba(0,0,0,0.45)',
    'pointer-events:none',
    'display:none',
  ].join(';');
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  panel.appendChild(canvas);
  parent.appendChild(panel);
  const ctx = canvas.getContext('2d')!;

  let field: Field | null = null;
  let layout: MinimapLayout | null = null;
  let base: HTMLCanvasElement | null = null; // superficies ya pintadas
  let ball: Vec3 = { x: 0, y: 0, z: 0 };
  let heading = 0;
  let drawnKey = '';

  // Pinta las superficies del hoyo (recortadas a la región) sobre un lienzo aparte.
  function paintBase(next: Field, region: TerrainBounds, size: MinimapLayout): HTMLCanvasElement {
    const bounds = next.terrain.bounds;
    const image = surfaceMapFor(next, bounds, next.surfaceAt, next.isOutOfBounds);
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    source.getContext('2d')!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

    const out = document.createElement('canvas');
    out.width = size.width;
    out.height = size.height;
    const o = out.getContext('2d')!;
    o.fillStyle = '#1d4a22';
    o.fillRect(0, 0, size.width, size.height);
    const [dx, dy] = size.toPixel(region.minX, region.minZ);
    o.imageSmoothingEnabled = true;
    o.drawImage(
      source,
      (region.minX - bounds.minX) / image.cell,
      (region.minZ - bounds.minZ) / image.cell,
      (region.maxX - region.minX) / image.cell,
      (region.maxZ - region.minZ) / image.cell,
      dx,
      dy,
      (region.maxX - region.minX) * size.scale,
      (region.maxZ - region.minZ) * size.scale,
    );
    return out;
  }

  function draw(): void {
    if (!field || !layout || !base) return;
    const [bx, bz] = layout.toPixel(ball.x, ball.z);
    const key = `${bx.toFixed(1)}|${bz.toFixed(1)}|${heading.toFixed(1)}`;
    if (key === drawnKey) return;
    drawnKey = key;

    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.drawImage(base, 0, 0);

    // Tee: cuadrito blanco.
    const [tx, tz] = layout.toPixel(field.tee.x, field.tee.z);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 2.5, tz - 2.5, 5, 5);

    // Copa: palo y banderita.
    if (field.cup) {
      const [cx, cz] = layout.toPixel(field.cup.position.x, field.cup.position.z);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      ctx.lineTo(cx, cz - 9);
      ctx.stroke();
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.moveTo(cx, cz - 9);
      ctx.lineTo(cx + 6, cz - 7);
      ctx.lineTo(cx, cz - 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(cx, cz, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dirección de golpe: línea amarilla desde el balón.
    const forward = forwardVector(heading);
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, bz);
    ctx.lineTo(bx + forward.x * AIM_LENGTH * layout.scale, bz + forward.z * AIM_LENGTH * layout.scale);
    ctx.stroke();

    // Balón.
    ctx.beginPath();
    ctx.arc(bx, bz, BALL_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#111111';
    ctx.stroke();
  }

  return {
    element: panel,
    setField(next) {
      field = next;
      drawnKey = '';
      if (!next.minimap) {
        panel.style.display = 'none';
        layout = null;
        base = null;
        return;
      }
      layout = computeMinimapLayout(next.minimap);
      canvas.width = layout.width;
      canvas.height = layout.height;
      base = paintBase(next, next.minimap, layout);
      panel.style.display = 'block';
      draw();
    },
    setBall(position) {
      ball = position;
      draw();
    },
    setHeading(headingDeg) {
      heading = headingDeg;
      draw();
    },
  };
}
