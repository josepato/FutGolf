import { elevationDeg, MAX_SPIN } from '../game/shot';
import type { ContactPoint } from '../physics/types';

const SIZE = 140; // px, lado del dibujo del balón
const MARGIN = 8; // px entre el balón y el borde del lienzo
const RADIUS = SIZE / 2 - MARGIN;

export interface ContactSelector {
  readonly element: HTMLElement;
  readonly contact: ContactPoint;
  onChange(listener: (contact: ContactPoint) => void): void;
  reset(): void;
}

// Balón 2D visto desde atrás con un punto arrastrable. El punto es el lugar donde
// se golpea: arriba = balón raso, abajo = globo (backspin), a los lados = efecto.
export function createContactSelector(parent: HTMLElement): ContactSelector {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'left:16px',
    'bottom:16px',
    'padding:8px',
    'border-radius:8px',
    'background:rgba(0,0,0,0.45)',
    'color:#fff',
    'font:12px/1.4 system-ui,sans-serif',
    'user-select:none',
    'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Punto de contacto';
  title.style.marginBottom = '4px';

  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;cursor:crosshair;touch-action:none;display:block`;

  const readout = document.createElement('div');
  readout.style.marginTop = '4px';
  const hint = document.createElement('div');
  hint.textContent = 'Doble clic: centro';
  hint.style.cssText = 'opacity:0.7;font-size:11px';

  panel.append(title, canvas, readout, hint);
  parent.appendChild(panel);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  let contact: ContactPoint = { x: 0, y: 0 };
  let dragging = false;
  const listeners: Array<(contact: ContactPoint) => void> = [];

  function draw(): void {
    const c = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.beginPath();
    ctx.arc(c, c, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#f5f5f5';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#222';
    ctx.stroke();

    // Pentágono central y líneas guía del balón.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, RADIUS - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const px = c + Math.cos(a) * RADIUS * 0.28;
      const py = c + Math.sin(a) * RADIUS * 0.28;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - RADIUS, c);
    ctx.lineTo(c + RADIUS, c);
    ctx.moveTo(c, c - RADIUS);
    ctx.lineTo(c, c + RADIUS);
    ctx.stroke();
    ctx.restore();

    // Punto de contacto: x a la derecha, y hacia arriba en pantalla.
    const dx = c + contact.x * RADIUS;
    const dy = c - contact.y * RADIUS;
    ctx.beginPath();
    ctx.arc(dx, dy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#e53935';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    const elevation = elevationDeg(contact.y).toFixed(1);
    const backspin = Math.round(-contact.y * MAX_SPIN);
    const sidespin = Math.round(contact.x * MAX_SPIN);
    readout.textContent = `Elevación ${elevation}° · Backspin ${backspin} · Lateral ${sidespin}`;
  }

  // Convierte la posición del puntero a ContactPoint, recortado al disco unitario.
  function setFromPointer(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const scale = SIZE / rect.width;
    const px = (event.clientX - rect.left) * scale - SIZE / 2;
    const py = (event.clientY - rect.top) * scale - SIZE / 2;
    let x = px / RADIUS;
    let y = -py / RADIUS;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    update({ x, y });
  }

  function update(next: ContactPoint): void {
    contact = next;
    draw();
    for (const listener of listeners) listener(contact);
  }

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    setFromPointer(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging) setFromPointer(event);
  });
  const stopDragging = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('dblclick', () => update({ x: 0, y: 0 }));

  draw();

  return {
    element: panel,
    get contact() {
      return contact;
    },
    onChange(listener) {
      listeners.push(listener);
    },
    reset() {
      update({ x: 0, y: 0 });
    },
  };
}
