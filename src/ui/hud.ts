import type { ShotResult, Wind } from '../physics/types';

export interface Hud {
  readonly element: HTMLElement;
  showResult(result: ShotResult): void;
  setWind(wind: Wind): void;
  setHeading(headingDeg: number): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'padding:8px 10px',
  'border-radius:8px',
  'background:rgba(0,0,0,0.45)',
  'color:#fff',
  'font:13px/1.5 system-ui,sans-serif',
  'user-select:none',
  'pointer-events:none',
].join(';');

const WIND_SIZE = 84; // px

// HUD: resultado del último tiro (arriba a la izquierda) y flecha de viento
// (arriba a la derecha). La flecha usa el rumbo del viento en el campo: arriba es
// el rumbo 0 (hacia -z) y gira en sentido horario, igual que el panel de depuración.
export function createHud(parent: HTMLElement): Hud {
  const results = document.createElement('div');
  results.style.cssText = `${PANEL_STYLE};left:16px;top:16px;min-width:190px`;
  const resultRows = document.createElement('div');
  results.append(titleOf('Último tiro'), resultRows);

  const windPanel = document.createElement('div');
  windPanel.style.cssText = `${PANEL_STYLE};right:16px;top:16px;text-align:center`;
  const windCanvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  windCanvas.width = WIND_SIZE * dpr;
  windCanvas.height = WIND_SIZE * dpr;
  windCanvas.style.cssText = `width:${WIND_SIZE}px;height:${WIND_SIZE}px;display:block`;
  const windLabel = document.createElement('div');
  windPanel.append(titleOf('Viento'), windCanvas, windLabel);

  // Leyenda de controles y rumbo, arriba al centro (abajo taparía el balón).
  const help = document.createElement('div');
  help.style.cssText = `${PANEL_STYLE};left:50%;top:16px;transform:translateX(-50%);text-align:left;font-size:12px;max-width:480px`;
  const headingLine = document.createElement('div');
  headingLine.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:2px';
  help.append(
    headingLine,
    legendRow('#ffe14d', 'Línea amarilla: inicio del tiro si sale perfecto (poder y precisión 100%)'),
    legendRow('#00e5ff', 'Línea azul: trayectoria del tiro anterior'),
    textRow('A / D o ← →: girar el rumbo (con el balón quieto)'),
    textRow('Clic o Espacio: barra de golpe (1.º inicia, 2.º poder, 3.º precisión)'),
    textRow('R: regresar el balón al origen'),
  );

  parent.append(results, windPanel, help);

  const ctx = windCanvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  function legendRow(color: string, text: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';
    const swatch = document.createElement('span');
    swatch.style.cssText = `display:inline-block;width:18px;height:4px;background:${color};border-radius:2px`;
    const label = document.createElement('span');
    label.textContent = text;
    row.append(swatch, label);
    return row;
  }

  function textRow(text: string): HTMLElement {
    const row = document.createElement('div');
    row.textContent = text;
    row.style.opacity = '0.85';
    return row;
  }

  function setHeading(headingDeg: number): void {
    const rounded = Math.round(headingDeg);
    const side = rounded === 0 ? 'al frente' : rounded > 0 ? 'a la derecha' : 'a la izquierda';
    headingLine.textContent = `Rumbo: ${Math.abs(rounded)}° ${side}`;
  }

  function titleOf(text: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'font-weight:600;margin-bottom:2px';
    return el;
  }

  function showResult(result: ShotResult): void {
    resultRows.innerHTML = '';
    const rows: Array<[string, string]> = [
      ['Distancia', `${result.distance.toFixed(1)} m`],
      ['Altura máx.', `${result.apexHeight.toFixed(1)} m`],
      ['Tiempo de vuelo', `${result.flightTime.toFixed(2)} s`],
      ['Velocidad inicial', `${result.launchSpeed.toFixed(1)} m/s`],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      v.style.fontVariantNumeric = 'tabular-nums';
      row.append(l, v);
      resultRows.appendChild(row);
    }
  }

  function setWind(wind: Wind): void {
    const c = WIND_SIZE / 2;
    ctx.clearRect(0, 0, WIND_SIZE, WIND_SIZE);

    ctx.beginPath();
    ctx.arc(c, c, c - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('↑ rumbo 0', c, 12); // referencia: hacia -z

    if (wind.speed > 0) {
      const angle = (wind.headingDeg * Math.PI) / 180;
      const length = Math.min(c - 12, 12 + wind.speed * 2.5);
      ctx.save();
      ctx.translate(c, c + 4);
      ctx.rotate(angle);
      ctx.strokeStyle = '#4fc3f7';
      ctx.fillStyle = '#4fc3f7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, length * 0.6);
      ctx.lineTo(0, -length * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -length);
      ctx.lineTo(-7, -length * 0.55);
      ctx.lineTo(7, -length * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    windLabel.textContent = wind.speed > 0 ? `${wind.speed.toFixed(1)} m/s · ${Math.round(wind.headingDeg)}°` : 'Sin viento';
  }

  showResult({ distance: 0, apexHeight: 0, flightTime: 0, launchSpeed: 0, trace: [] });
  setWind({ speed: 0, headingDeg: 0 });
  setHeading(0);

  return { element: results, showResult, setWind, setHeading };
}
