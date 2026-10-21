import type { ReliefView } from '../game/holeSession';
import type { ReliefOption } from '../game/holeRules';

export interface ReliefMenu {
  readonly element: HTMLElement;
  update(view: ReliefView | null): void; // null oculta el menú
}

const OPTIONS: Array<{ option: ReliefOption; title: string }> = [
  { option: 1, title: 'Jugar como queda' },
  { option: 2, title: 'Repetir desde el último golpe' },
  { option: 3, title: 'Dropear en el punto de entrada' },
  { option: 4, title: 'Línea copa–entrada, detrás del lago' },
];

// Menú del procedimiento de agua (reglamento 4-3-2): se muestra cuando el balón queda en el agua.
// Teclas 1 a 4 eligen la opción, ← → (opción 3) y ↑ ↓ (opción 4) mueven el balón y Enter confirma.
// Es solo una vista: las teclas las atiende el bucle de juego.
export function createReliefMenu(parent: HTMLElement): ReliefMenu {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:300px',
    'transform:translateX(-50%)',
    'min-width:340px',
    'padding:10px 14px',
    'border-radius:8px',
    'background:rgba(8,28,48,0.82)',
    'color:#fff',
    'font:14px/1.5 system-ui,sans-serif',
    'user-select:none',
    'pointer-events:none',
    'display:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'El balón está en el agua';
  title.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:6px;color:#4fc3f7';

  const rows = OPTIONS.map(({ option, title: text }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:2px 6px;border-radius:4px';
    const label = document.createElement('span');
    label.textContent = `${option}  ${text}`;
    const penalty = document.createElement('span');
    penalty.textContent = option === 1 ? 'sin penalización' : '+1 golpe';
    penalty.style.opacity = '0.75';
    row.append(label, penalty);
    return { option, row };
  });

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:6px;font-size:13px;opacity:0.9';
  const status = document.createElement('div');
  status.style.cssText = 'margin-top:2px;font-weight:600';

  panel.append(title, ...rows.map((r) => r.row), hint, status);
  parent.appendChild(panel);

  function hintFor(view: ReliefView): string {
    if (view.option === 3) {
      const side = view.offset === 0 ? 'en el punto de entrada' : `${Math.abs(view.offset).toFixed(1)} m a la ${view.offset > 0 ? 'derecha' : 'izquierda'}`;
      return `← →: mover hasta 2 m a los lados (${side})`;
    }
    if (view.option === 4) {
      return `↑ ↓: alejar o acercar del lago (${view.offset.toFixed(0)} m detrás de la entrada)`;
    }
    return view.option === 2 ? 'El balón vuelve al punto del último golpe' : 'El balón se juega desde donde está';
  }

  function update(view: ReliefView | null): void {
    if (!view) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    for (const { option, row } of rows) {
      row.style.background = option === view.option ? 'rgba(79,195,247,0.35)' : 'transparent';
      row.style.fontWeight = option === view.option ? '700' : '400';
    }
    hint.textContent = hintFor(view);
    const total = view.strokes + view.penalty;
    if (view.placement.valid) {
      status.textContent = `Enter: confirmar · golpes ${view.strokes} → ${total}`;
      status.style.color = '#b9f6ca';
    } else {
      status.textContent = 'Posición no válida (dentro del lago o fuera de límites)';
      status.style.color = '#ff8a80';
    }
  }

  return { element: panel, update };
}
