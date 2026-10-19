import { createGameLoop } from './game/gameLoop';
import { createScene } from './render/scene';
import { createContactSelector } from './ui/contactSelector';
import { createDebugPanel } from './ui/debugPanel';
import { createHud } from './ui/hud';
import { createPowerBar } from './ui/powerBar';
import { FLAT_TERRAIN } from './world/terrain';
import { TEST_TERRAIN } from './world/testTerrain';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = createScene(canvas);
const contactSelector = createContactSelector(document.body);
const hud = createHud(document.body);
const loop = createGameLoop(game, {
  getContact: () => contactSelector.contact,
  onShotLanded: (result) => hud.showResult(result),
  onAimChange: (headingDeg) => hud.setHeading(headingDeg),
});
hud.setWind(loop.config.wind);
createDebugPanel(document.body, {
  onBodyChange: (body) => loop.setBody(body),
  onTerrainChange: (relief) => loop.setTerrain(relief ? TEST_TERRAIN : FLAT_TERRAIN),
  onReliefAidsChange: (aids) => game.setReliefAids(aids),
  onWindChange: (wind) => {
    loop.setWind(wind);
    hud.setWind(wind);
  },
});
createPowerBar(document.body, {
  canShoot: () => !loop.isBallMoving,
  onShot: (power, accuracy) => loop.shoot(power, accuracy),
  clickTarget: canvas,
});
