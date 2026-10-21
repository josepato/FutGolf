import { createGameLoop } from './game/gameLoop';
import type { HoleEvent } from './game/holeSession';
import { DEFAULT_SHOT_TYPE, SHOT_TYPES } from './game/shot';
import { createScene } from './render/scene';
import { createContactSelector } from './ui/contactSelector';
import { createDebugPanel } from './ui/debugPanel';
import { createHoleResult } from './ui/holeResult';
import { createHud } from './ui/hud';
import { createMinimap } from './ui/minimap';
import { createPowerBar } from './ui/powerBar';
import { createReliefMenu } from './ui/reliefMenu';
import { HOLE_1_FIELD, testField, type FieldId } from './world/fields';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = createScene(canvas);
const contactSelector = createContactSelector(document.body);
const hud = createHud(document.body);
const reliefMenu = createReliefMenu(document.body);
const holeResult = createHoleResult(document.body);
const minimap = createMinimap(document.body);

// Texto de los avisos del hoyo.
function holeMessage(event: HoleEvent): string {
  switch (event.kind) {
    case 'ob':
      return 'Fuera de límites: +1 golpe. El balón vuelve al último golpe.';
    case 'water':
      return '¡Al agua! Elige cómo seguir: teclas 1 a 4 y Enter.';
    case 'relief':
      return event.penalty === 0 ? 'Se juega como queda, sin penalización.' : `+${event.penalty} golpe por el agua.`;
    case 'holed':
      return ''; // el resultado lo muestra la pantalla de fin de hoyo
  }
}
const loop = createGameLoop(game, {
  field: HOLE_1_FIELD,
  getContact: () => contactSelector.contact,
  onShotLanded: (result) => hud.showResult(result),
  onAimChange: (headingDeg) => {
    hud.setHeading(headingDeg);
    minimap.setHeading(headingDeg);
  },
  onBallMove: (position) => minimap.setBall(position),
  onShotTypeChange: (shotType) => hud.setShotType(SHOT_TYPES[shotType]),
  onHoleChange: (summary) => {
    hud.setHole(summary);
    if (summary?.status === 'holed') holeResult.show(summary);
    else holeResult.hide();
  },
  onHoleEvent: (event) => {
    if (event.kind !== 'holed') hud.showMessage(holeMessage(event));
  },
  onReliefChange: (view) => reliefMenu.update(view),
});
minimap.setField(HOLE_1_FIELD);
hud.setWind(loop.config.wind);
hud.setShotType(SHOT_TYPES[DEFAULT_SHOT_TYPE]);
// El campo de prueba admite relieve o plano; el Hoyo 1 trae su propio relieve.
let fieldId: FieldId = 'hole1';
let testRelief = true;
const applyField = (): void => {
  const field = fieldId === 'hole1' ? HOLE_1_FIELD : testField(testRelief);
  loop.setField(field);
  minimap.setField(field);
};

createDebugPanel(document.body, {
  onBodyChange: (body) => loop.setBody(body),
  onFieldChange: (id) => {
    fieldId = id;
    applyField();
  },
  onTerrainChange: (relief) => {
    testRelief = relief;
    applyField();
  },
  onReliefAidsChange: (aids) => game.setReliefAids(aids),
  onWindChange: (wind) => {
    loop.setWind(wind);
    hud.setWind(wind);
  },
});
createPowerBar(document.body, {
  canShoot: () => loop.canShoot,
  onShot: (power, accuracy) => loop.shoot(power, accuracy),
  clickTarget: canvas,
});
