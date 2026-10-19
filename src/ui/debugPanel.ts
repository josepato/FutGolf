import { CELESTIAL_BODIES, DEFAULT_BODY_ID } from '../physics/bodies';
import type { CelestialBody, CelestialBodyId, Wind } from '../physics/types';

export interface DebugPanelOptions {
  onBodyChange: (body: CelestialBody) => void;
  onWindChange: (wind: Wind) => void;
  onTerrainChange: (relief: boolean) => void; // true = campo con relieve, false = campo plano
  onReliefAidsChange: (aids: { contours: boolean; arrows: boolean }) => void; // ayudas para leer el relieve
}

export interface DebugPanel {
  readonly element: HTMLElement;
}

const MAX_WIND_SPEED = 30; // m/s

// Panel de depuración: cuerpo celeste (gravedad y densidad del aire), terreno
// (relieve o plano, para comparar el mismo tiro) y viento constante (velocidad y
// rumbo). Los cambios se aplican de inmediato.
export function createDebugPanel(parent: HTMLElement, options: DebugPanelOptions): DebugPanel {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'top:160px',
    'width:190px',
    'padding:8px 10px',
    'border-radius:8px',
    'background:rgba(0,0,0,0.45)',
    'color:#fff',
    'font:12px/1.4 system-ui,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Depuración ▾';
  title.style.cssText = 'font-weight:600;cursor:pointer';
  title.title = 'Clic para plegar o desplegar';

  // Cuerpo celeste
  const bodyLabel = document.createElement('label');
  bodyLabel.textContent = 'Cuerpo celeste';
  bodyLabel.style.display = 'block';
  const bodySelect = document.createElement('select');
  bodySelect.style.cssText = 'width:100%;margin:2px 0';
  for (const body of Object.values(CELESTIAL_BODIES)) {
    const option = document.createElement('option');
    option.value = body.id;
    option.textContent = body.name;
    bodySelect.appendChild(option);
  }
  bodySelect.value = DEFAULT_BODY_ID;
  const bodyInfo = document.createElement('div');
  bodyInfo.style.cssText = 'opacity:0.8;margin-bottom:6px';

  // Terreno
  const terrainLabel = document.createElement('label');
  terrainLabel.textContent = 'Terreno';
  terrainLabel.style.display = 'block';
  const terrainSelect = document.createElement('select');
  terrainSelect.style.cssText = 'width:100%;margin:2px 0 6px';
  for (const [value, text] of [['relief', 'Con relieve'], ['flat', 'Plano']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    terrainSelect.appendChild(option);
  }
  terrainSelect.value = 'relief';

  // Ayudas para leer el relieve
  const contoursRow = checkboxRow('Curvas de nivel');
  const arrowsRow = checkboxRow('Flechas de caída');

  // Viento
  const speedRow = sliderRow('Viento', 0, MAX_WIND_SPEED, 0.5, 0, (v) => `${v.toFixed(1)} m/s`);
  const headingRow = sliderRow('Rumbo del viento', 0, 360, 5, 0, (v) => `${Math.round(v)}°`);

  const note = document.createElement('div');
  note.textContent = '0° = hacia el rumbo 0 (-z), horario';
  note.style.cssText = 'opacity:0.6;font-size:11px;margin-top:2px';

  const content = document.createElement('div');
  content.style.marginTop = '4px';
  content.append(bodyLabel, bodySelect, bodyInfo, terrainLabel, terrainSelect, contoursRow.element, arrowsRow.element, speedRow.element, headingRow.element, note);
  panel.append(title, content);
  parent.appendChild(panel);

  // Plegable: en ventanas bajas el panel puede estorbar a la barra de golpe.
  title.addEventListener('click', () => {
    const hidden = content.style.display === 'none';
    content.style.display = hidden ? '' : 'none';
    title.textContent = hidden ? 'Depuración ▾' : 'Depuración ▸';
  });

  function selectedBody(): CelestialBody {
    return CELESTIAL_BODIES[bodySelect.value as CelestialBodyId];
  }

  function currentWind(): Wind {
    return { speed: speedRow.value(), headingDeg: headingRow.value() % 360 };
  }

  function refreshBodyInfo(): void {
    const body = selectedBody();
    bodyInfo.textContent = `g ${body.gravity} m/s² · ρ ${body.airDensity} kg/m³`;
  }

  bodySelect.addEventListener('change', () => {
    refreshBodyInfo();
    options.onBodyChange(selectedBody());
    bodySelect.blur(); // para que las flechas y A/D sigan girando el rumbo
  });
  terrainSelect.addEventListener('change', () => {
    options.onTerrainChange(terrainSelect.value === 'relief');
    terrainSelect.blur(); // para que las flechas y A/D sigan girando el rumbo
  });
  const aidsChanged = (): void =>
    options.onReliefAidsChange({ contours: contoursRow.checked(), arrows: arrowsRow.checked() });
  contoursRow.onChange(aidsChanged);
  arrowsRow.onChange(aidsChanged);
  const windChanged = (): void => options.onWindChange(currentWind());
  speedRow.onInput(windChanged);
  headingRow.onInput(windChanged);

  refreshBodyInfo();

  return { element: panel };
}

interface CheckboxRow {
  element: HTMLElement;
  checked(): boolean;
  onChange(listener: () => void): void;
}

function checkboxRow(label: string): CheckboxRow {
  const element = document.createElement('label');
  element.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = true;
  input.addEventListener('change', () => input.blur()); // las flechas del teclado no deben mover el control
  element.append(input, label);
  return {
    element,
    checked: () => input.checked,
    onChange: (listener) => input.addEventListener('change', listener),
  };
}

interface SliderRow {
  element: HTMLElement;
  value(): number;
  onInput(listener: () => void): void;
}

function sliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  format: (value: number) => string,
): SliderRow {
  const element = document.createElement('div');
  element.style.marginTop = '4px';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between';
  const name = document.createElement('span');
  name.textContent = label;
  const readout = document.createElement('span');
  header.append(name, readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.style.cssText = 'width:100%;margin:0';

  element.append(header, input);

  const refresh = (): void => {
    readout.textContent = format(Number(input.value));
  };
  input.addEventListener('input', refresh);
  input.addEventListener('change', () => input.blur()); // las flechas no deben mover el control
  refresh();

  return {
    element,
    value: () => Number(input.value),
    onInput: (listener) => input.addEventListener('input', listener),
  };
}
