// Barra de golpe de 3 clics (o barra espaciadora):
//   1.º clic: la barra empieza a subir y bajar sin parar (de 0 a 1 y de vuelta a 0).
//   2.º clic: fija el poder en el nivel que tenga la barra en ese momento y empieza
//             la bajada de precisión.
//   3.º clic: fija la precisión según qué tan cerca esté de la marca ideal.
// Si el jugador no hace el 2.º clic, la barra sigue subiendo y bajando hasta que lo
// haga. Si la bajada de precisión llega abajo sin 3.er clic, el tiro sale con la
// desviación máxima. R cancela la barra.

// Valores iniciales de afinación.
export const RISE_DURATION = 1.2; // s de 0 a poder 1.0 (y otros tantos de 1.0 a 0)
export const FALL_DURATION = 1.0; // s de la bajada completa
export const SWEET_SPOT = 0.8; // fracción de la bajada donde la precisión es perfecta
export const ACCURACY_WINDOW = 0.2; // fracción de la bajada para llegar a la desviación máxima

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// Poder (0..1) tras `elapsed` segundos desde el 1.er clic: onda triangular que sube
// de 0 a 1 en RISE_DURATION, baja de 1 a 0 en otros RISE_DURATION y se repite.
export function powerAt(elapsed: number): number {
  const phase = (((elapsed / RISE_DURATION) % 2) + 2) % 2; // 0..2
  return phase <= 1 ? phase : 2 - phase;
}

// Precisión (-1..1) tras `elapsed` segundos de bajada. 0 = marca ideal; un clic
// temprano da valores positivos (desvío a la derecha) y uno tardío negativos
// (a la izquierda). Al llegar abajo vale -1.
export function accuracyAtFall(elapsed: number): number {
  const progress = elapsed / FALL_DURATION;
  return clamp((SWEET_SPOT - progress) / ACCURACY_WINDOW, -1, 1);
}

export type PowerBarPhase = 'idle' | 'charging' | 'falling';

export interface PowerBarOptions {
  canShoot: () => boolean; // false mientras el balón se mueve
  onShot: (power: number, accuracy: number) => void;
  clickTarget: HTMLElement; // elemento sobre el que cuentan los clics
}

export interface PowerBar {
  readonly element: HTMLElement;
  readonly phase: PowerBarPhase;
  click(): void;
  cancel(): void;
}

const BAR_HEIGHT = 150; // px

export function createPowerBar(parent: HTMLElement, options: PowerBarOptions): PowerBar {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'right:24px',
    'bottom:24px',
    'padding:8px',
    'border-radius:8px',
    'background:rgba(0,0,0,0.45)',
    'color:#fff',
    'font:12px/1.4 system-ui,sans-serif',
    'user-select:none',
    'text-align:center',
    'width:150px',
  ].join(';');

  const track = document.createElement('div');
  track.style.cssText = `position:relative;margin:0 auto;width:32px;height:${BAR_HEIGHT}px;background:#222;border:2px solid #fff;border-radius:4px;overflow:hidden`;
  const fill = document.createElement('div');
  fill.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:0;background:#4caf50';
  const powerMark = document.createElement('div');
  powerMark.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:#ffeb3b;display:none';
  const sweetMark = document.createElement('div');
  sweetMark.style.cssText = 'position:absolute;left:0;right:0;height:3px;background:#00e5ff;display:none';
  track.append(fill, powerMark, sweetMark);

  const status = document.createElement('div');
  status.style.marginTop = '6px';
  const last = document.createElement('div');
  last.style.cssText = 'margin-top:2px;opacity:0.8';
  panel.append(track, status, last);
  parent.appendChild(panel);

  let phase: PowerBarPhase = 'idle';
  let phaseStart = 0; // ms, performance.now() de inicio de la fase
  let lockedPower = 0;

  function begin(now: number): void {
    phase = 'charging';
    phaseStart = now;
    lockedPower = 0;
  }

  function lockPower(power: number, now: number): void {
    lockedPower = power;
    phase = 'falling';
    phaseStart = now;
  }

  function fire(accuracy: number): void {
    const power = lockedPower;
    phase = 'idle';
    last.textContent = `Poder ${Math.round(power * 100)}% · Precisión ${accuracy >= 0 ? '+' : ''}${Math.round(accuracy * 100)}%`;
    options.onShot(power, accuracy);
  }

  function click(): void {
    const now = performance.now();
    if (phase === 'idle') {
      if (options.canShoot()) begin(now);
    } else if (phase === 'charging') {
      lockPower(powerAt((now - phaseStart) / 1000), now);
    } else {
      fire(accuracyAtFall((now - phaseStart) / 1000));
    }
  }

  function cancel(): void {
    phase = 'idle';
  }

  function tick(now: number): void {
    if (phase === 'falling' && (now - phaseStart) / 1000 >= FALL_DURATION) {
      fire(-1); // llegó abajo sin 3.er clic: desviación máxima
    }
    draw(now);
    requestAnimationFrame(tick);
  }

  function draw(now: number): void {
    if (phase === 'charging') {
      fill.style.height = `${powerAt((now - phaseStart) / 1000) * 100}%`;
      powerMark.style.display = 'none';
      sweetMark.style.display = 'none';
      status.textContent = 'Clic: fijar poder';
    } else if (phase === 'falling') {
      const progress = clamp((now - phaseStart) / 1000 / FALL_DURATION, 0, 1);
      fill.style.height = `${lockedPower * (1 - progress) * 100}%`;
      powerMark.style.display = 'block';
      powerMark.style.bottom = `${lockedPower * 100}%`;
      sweetMark.style.display = 'block';
      sweetMark.style.bottom = `${lockedPower * (1 - SWEET_SPOT) * 100}%`;
      status.textContent = 'Clic: fijar precisión';
    } else {
      fill.style.height = '0';
      powerMark.style.display = 'none';
      sweetMark.style.display = 'none';
      status.textContent = options.canShoot() ? 'Clic o Espacio para empezar' : 'Esperando al balón…';
    }
  }

  options.clickTarget.addEventListener('pointerdown', (event) => {
    if (event.button === 0) click();
  });
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      click();
    }
    if (event.code === 'KeyR') cancel();
  });

  requestAnimationFrame(tick);

  return {
    element: panel,
    get phase() {
      return phase;
    },
    click,
    cancel,
  };
}
