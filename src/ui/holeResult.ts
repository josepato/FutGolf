import { resultName } from '../game/holeRules';

// Pantalla de fin de hoyo: golpes, par y el nombre del resultado.

export interface HoleResultInfo {
  name: string; // «Hoyo 1»
  par: number;
  strokes: number;
}

export type ResultTone = 'great' | 'good' | 'even' | 'bad';

// Tono del resultado por diferencia con el par (para el color del título): hoyo en uno y 2 o más bajo el
// par son «great», 1 bajo el par «good», par «even» y por encima «bad».
export function resultTone(par: number, strokes: number): ResultTone {
  if (strokes === 1 || strokes - par <= -2) return 'great';
  if (strokes - par === -1) return 'good';
  return strokes - par === 0 ? 'even' : 'bad';
}

const TONE_COLORS: Record<ResultTone, string> = {
  great: '#ffd54f',
  good: '#b9f6ca',
  even: '#ffffff',
  bad: '#ffab91',
};

export interface HoleResult {
  readonly element: HTMLElement;
  show(info: HoleResultInfo): void;
  hide(): void;
}

export function createHoleResult(parent: HTMLElement): HoleResult {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:38%',
    'transform:translate(-50%,-50%)',
    'min-width:300px',
    'padding:18px 28px',
    'border-radius:12px',
    'background:rgba(8,24,12,0.88)',
    'color:#fff',
    'font:15px/1.5 system-ui,sans-serif',
    'text-align:center',
    'user-select:none',
    'pointer-events:none',
    'display:none',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;opacity:0.8;letter-spacing:0.04em;text-transform:uppercase';
  const result = document.createElement('div');
  result.style.cssText = 'font-size:38px;font-weight:800;margin:4px 0';
  const strokes = document.createElement('div');
  strokes.style.cssText = 'font-size:18px';
  const hint = document.createElement('div');
  hint.textContent = 'R o Enter: jugar de nuevo';
  hint.style.cssText = 'margin-top:12px;font-size:13px;opacity:0.7';
  panel.append(title, result, strokes, hint);
  parent.appendChild(panel);

  return {
    element: panel,
    show(info) {
      title.textContent = `${info.name} · Par ${info.par}`;
      result.textContent = resultName(info.par, info.strokes);
      result.style.color = TONE_COLORS[resultTone(info.par, info.strokes)];
      strokes.textContent = `${info.strokes} ${info.strokes === 1 ? 'golpe' : 'golpes'}`;
      panel.style.display = 'block';
    },
    hide() {
      panel.style.display = 'none';
    },
  };
}
