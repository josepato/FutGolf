import * as THREE from 'three';
import { BALL_SPEC, CELESTIAL_BODIES, DEFAULT_BODY_ID } from '../physics/bodies';
import { FIXED_DT, isGroundContact, restHeight, settleOnTerrain, stepBall, type SimConfig } from '../physics/simulation';
import type { BallState, CelestialBody, ContactPoint, ShotInput, ShotResult, Terrain, Vec3, Wind } from '../physics/types';
import type { GameScene } from '../render/scene';
import { surfaceTypeAt } from '../world/field';
import { TEST_TERRAIN } from '../world/testTerrain';
import { computeShot, forwardVector, previewTrajectory } from './shot';

const MAX_FRAME_TIME = 0.1; // s, evita la espiral de la muerte tras una pausa larga
const CAMERA_BACK = 4; // m detrás del balón cuando está quieto
const CAMERA_BACK_MOVING = 12; // m detrás del balón durante el tiro: no se le pega tanto
const CAMERA_HEIGHT = 1.6; // m sobre el terreno bajo la cámara; no sube con el tiro
const CAMERA_MIN_CLEARANCE = 0.5; // m, mínimo sobre el terreno: el suavizado nunca la hunde en una loma
const CAMERA_LOOK_AHEAD = 20; // m hacia adelante cuando el balón está quieto
const CAMERA_LOOK_HEIGHT = 0.6; // m, altura a la que mira con el balón quieto
const CAMERA_LOOK_HEIGHT_FACTOR = 0.2; // fracción de la altura del balón que la cámara sigue con la vista
const CAMERA_LOOK_HEIGHT_MAX = 4; // m, tope: así la cámara no se inclina tanto hacia arriba
const CAMERA_FOLLOW_RATE = 4; // 1/s, suavizado exponencial con el balón quieto
const CAMERA_FOLLOW_RATE_MOVING = 2; // 1/s, más lento en el tiro: la cámara se queda atrás
const CAMERA_LOOK_RATE_MOVING = 3; // 1/s
const AIM_TURN_RATE = 45; // °/s al mantener A/D o las flechas
const TRACE_EVERY_STEPS = 4; // una muestra de la traza cada 4 pasos (1/60 s)

export interface GameLoop {
  readonly config: SimConfig; // mutable: cuerpo celeste y viento se cambian en caliente
  readonly state: BallState;
  readonly isBallMoving: boolean;
  setBody(body: CelestialBody): void;
  setWind(wind: Wind): void;
  setTerrain(terrain: Terrain): void; // cambia el suelo y reasienta el balón sobre él
  launch(initial: BallState): void;
  shoot(power: number, accuracy: number): void; // golpe con el rumbo y el contacto actuales
  reset(): void;
}

export interface GameLoopOptions {
  getContact: () => ContactPoint; // punto de contacto elegido en el selector
  onShotLanded?: (result: ShotResult) => void; // al primer contacto con el suelo
  onAimChange?: (headingDeg: number) => void; // cuando el jugador gira el rumbo
}

// Registro de un tiro en curso, para el HUD y la traza.
interface ShotRecord {
  origin: Vec3;
  launchSpeed: number;
  apexHeight: number; // m, la mayor altura del balón sobre el terreno que tiene debajo
  elapsed: number; // s desde el golpe
  steps: number;
  landed: boolean;
  trace: Vec3[];
}

export function createGameLoop(game: GameScene, options: GameLoopOptions): GameLoop {
  const config: SimConfig = {
    ball: BALL_SPEC,
    body: CELESTIAL_BODIES[DEFAULT_BODY_ID],
    wind: { speed: 0, headingDeg: 0 },
    surfaceAt: surfaceTypeAt,
    terrain: TEST_TERRAIN,
  };
  game.setTerrain(config.terrain);

  // Balón quieto en el tee, apoyado sobre el terreno.
  const origin = (): BallState => ({
    position: { x: 0, y: restHeight(0, 0, config), z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    phase: 'idle',
  });

  let current = origin();
  game.ball.position.set(current.position.x, current.position.y, current.position.z);
  let previous = current;
  let accumulator = 0;
  let lastTime = performance.now();
  let aimHeadingDeg = 0; // rumbo elegido con el teclado (0 = hacia -z)
  const keys = new Set<string>();

  const cameraLook = new THREE.Vector3();
  let record: ShotRecord | null = null;

  const isMoving = (): boolean => current.phase === 'flying' || current.phase === 'rolling';

  function forward(): Vec3 {
    return forwardVector(aimHeadingDeg);
  }

  // A / ← giran el rumbo a la izquierda, D / → a la derecha. Solo con el balón quieto.
  function updateAim(frameTime: number): void {
    if (isMoving()) return;
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const turn = (right ? 1 : 0) - (left ? 1 : 0);
    if (turn === 0) return;
    aimHeadingDeg += turn * AIM_TURN_RATE * frameTime;
    aimHeadingDeg = ((((aimHeadingDeg + 180) % 360) + 360) % 360) - 180; // [-180, 180)
    options.onAimChange?.(aimHeadingDeg);
  }

  // Vista previa del golpe: se recalcula solo cuando cambia algo que la afecta.
  // Supone un golpe perfecto (poder 100 %, precisión perfecta) con el contacto elegido.
  let previewKey = '';
  let terrainVersion = 0; // cambia con setTerrain: la vista previa debe recalcularse
  function updateAimPreview(): void {
    if (isMoving()) {
      if (previewKey !== 'hidden') game.setAimPreview(null);
      previewKey = 'hidden';
      return;
    }
    const contact = options.getContact();
    const { position } = current;
    const key = [
      aimHeadingDeg.toFixed(2),
      contact.x.toFixed(3),
      contact.y.toFixed(3),
      config.body.id,
      config.wind.speed,
      config.wind.headingDeg,
      terrainVersion,
      position.x.toFixed(2),
      position.z.toFixed(2),
    ].join('|');
    if (key === previewKey) return;
    previewKey = key;
    const input: ShotInput = { headingDeg: aimHeadingDeg, power: 1, accuracy: 0, contact };
    game.setAimPreview(previewTrajectory(input, position, config));
  }

  function cameraTargets(ball: Vec3): { position: THREE.Vector3; look: THREE.Vector3 } {
    const f = forward();
    const moving = isMoving();
    const back = moving ? CAMERA_BACK_MOVING : CAMERA_BACK;
    const { terrain } = config;
    const camX = ball.x - f.x * back;
    const camZ = ball.z - f.z * back;
    const position = new THREE.Vector3(camX, terrain.heightAt(camX, camZ) + CAMERA_HEIGHT, camZ);
    // En el tiro mira hacia el balón, pero siguiendo solo parte de su altura sobre el terreno.
    const ballGround = terrain.heightAt(ball.x, ball.z);
    const lookHeight = Math.min(
      CAMERA_LOOK_HEIGHT_MAX,
      CAMERA_LOOK_HEIGHT + Math.max(0, ball.y - ballGround) * CAMERA_LOOK_HEIGHT_FACTOR,
    );
    const aheadX = ball.x + f.x * CAMERA_LOOK_AHEAD;
    const aheadZ = ball.z + f.z * CAMERA_LOOK_AHEAD;
    const look = moving
      ? new THREE.Vector3(ball.x, ballGround + lookHeight, ball.z)
      : new THREE.Vector3(aheadX, terrain.heightAt(aheadX, aheadZ) + CAMERA_LOOK_HEIGHT, aheadZ);
    return { position, look };
  }

  function snapCamera(): void {
    const targets = cameraTargets(current.position);
    game.camera.position.copy(targets.position);
    cameraLook.copy(targets.look);
    game.camera.lookAt(cameraLook);
  }

  function updateCamera(ball: Vec3, frameTime: number): void {
    const targets = cameraTargets(ball);
    const moving = isMoving();
    const positionRate = moving ? CAMERA_FOLLOW_RATE_MOVING : CAMERA_FOLLOW_RATE;
    const lookRate = moving ? CAMERA_LOOK_RATE_MOVING : CAMERA_FOLLOW_RATE;
    game.camera.position.lerp(targets.position, 1 - Math.exp(-positionRate * frameTime));
    // El suavizado cruza lomas con retraso: que nunca quede bajo el suelo.
    const cam = game.camera.position;
    cam.y = Math.max(cam.y, config.terrain.heightAt(cam.x, cam.z) + CAMERA_MIN_CLEARANCE);
    cameraLook.lerp(targets.look, 1 - Math.exp(-lookRate * frameTime));
    game.camera.lookAt(cameraLook);
  }

  function spinBall(omega: Vec3, frameTime: number): void {
    const rate = Math.hypot(omega.x, omega.y, omega.z);
    if (rate === 0) return;
    const axis = new THREE.Vector3(omega.x / rate, omega.y / rate, omega.z / rate);
    game.ball.rotateOnWorldAxis(axis, rate * frameTime);
  }

  function frame(now: number): void {
    const frameTime = Math.min((now - lastTime) / 1000, MAX_FRAME_TIME);
    lastTime = now;

    updateAim(frameTime);

    accumulator += frameTime;
    while (accumulator >= FIXED_DT) {
      previous = current;
      current = stepBall(current, config, FIXED_DT);
      accumulator -= FIXED_DT;
      recordStep(previous, current);
    }

    // Se interpola entre el estado anterior y el actual para un movimiento suave.
    const alpha = accumulator / FIXED_DT;
    const position: Vec3 = {
      x: previous.position.x + (current.position.x - previous.position.x) * alpha,
      y: previous.position.y + (current.position.y - previous.position.y) * alpha,
      z: previous.position.z + (current.position.z - previous.position.z) * alpha,
    };
    game.ball.position.set(position.x, position.y, position.z);
    game.updateShadow(position);
    spinBall(current.angularVelocity, frameTime);
    updateCamera(position, frameTime);
    updateAimPreview();

    game.render();
    requestAnimationFrame(frame);
  }

  // Altura del balón sobre el terreno que tiene justo debajo (0 apoyado en el suelo).
  function heightAboveTerrain(position: Vec3): number {
    return Math.max(0, position.y - config.terrain.heightAt(position.x, position.z) - config.ball.radius);
  }

  // Acumula las medidas del tiro. Distancia, altura máxima y tiempo de vuelo se
  // cierran en el primer contacto con el suelo; la traza, cuando el balón se detiene.
  function recordStep(before: BallState, after: BallState): void {
    if (!record) return;
    record.elapsed += FIXED_DT;
    record.steps += 1;
    if (!record.landed) record.apexHeight = Math.max(record.apexHeight, heightAboveTerrain(after.position));
    const contact = isGroundContact(before, after, config.terrain);
    if (record.steps % TRACE_EVERY_STEPS === 0 || contact || after.phase === 'stopped') {
      record.trace.push({ ...after.position });
    }

    if (!record.landed && contact) {
      record.landed = true;
      options.onShotLanded?.({
        distance: Math.hypot(after.position.x - record.origin.x, after.position.z - record.origin.z),
        apexHeight: record.apexHeight,
        flightTime: record.elapsed,
        launchSpeed: record.launchSpeed,
        trace: record.trace,
      });
    }
    if (after.phase === 'stopped') {
      game.setTrace(record.trace);
      record = null;
    }
  }

  function launch(initial: BallState): void {
    previous = initial;
    current = { ...initial, phase: 'flying' };
    accumulator = 0;
    record = {
      origin: { ...initial.position },
      launchSpeed: Math.hypot(initial.velocity.x, initial.velocity.y, initial.velocity.z),
      apexHeight: heightAboveTerrain(initial.position),
      elapsed: 0,
      steps: 0,
      landed: false,
      trace: [{ ...initial.position }],
    };
  }

  function reset(): void {
    record = null; // un tiro interrumpido no deja traza ni resultado
    current = origin();
    previous = current;
    accumulator = 0;
    game.ball.position.set(current.position.x, current.position.y, current.position.z);
    game.updateShadow(current.position);
    game.ball.quaternion.identity();
    snapCamera();
  }

  // Golpea desde donde está el balón con el rumbo del teclado y el contacto del selector.
  function shoot(power: number, accuracy: number): void {
    if (isMoving()) return;
    const input: ShotInput = {
      headingDeg: aimHeadingDeg,
      power,
      accuracy,
      contact: options.getContact(),
    };
    launch(computeShot(input, current.position));
  }

  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyR') reset();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  snapCamera();
  requestAnimationFrame((now) => {
    lastTime = now;
    requestAnimationFrame(frame);
  });

  return {
    config,
    get state() {
      return current;
    },
    get isBallMoving() {
      return isMoving();
    },
    setBody(body) {
      config.body = body;
    },
    setWind(wind) {
      config.wind = wind;
    },
    setTerrain(terrain) {
      config.terrain = terrain;
      terrainVersion += 1;
      game.setTerrain(terrain);
      // El balón queda sobre el nuevo suelo; si ya no puede estar quieto, empieza a rodar.
      previous = current = settleOnTerrain(current, config);
      game.ball.position.set(current.position.x, current.position.y, current.position.z);
      game.updateShadow(current.position);
    },
    launch,
    shoot,
    reset,
  };
}
