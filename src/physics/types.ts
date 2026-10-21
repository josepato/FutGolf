// Unidades SI. Ejes de Three.js: x derecha, y arriba, z hacia la cámara.
// El rumbo 0 apunta hacia -z. La altura del suelo la da Terrain.heightAt (FLAT_TERRAIN: y = 0).

export type Vec3 = { x: number; y: number; z: number };

// 'holed': el balón quedó dentro de la copa (todo él bajo el plano del borde); ya no se mueve.
export type BallPhase = 'idle' | 'flying' | 'rolling' | 'stopped' | 'holed';

export interface BallState {
  position: Vec3; // m, centro del balón
  velocity: Vec3; // m/s
  angularVelocity: Vec3; // rad/s
  phase: BallPhase;
}

export interface BallSpec {
  mass: number; // kg
  radius: number; // m
  dragCoefficient: number; // Cd, valor inicial ajustable
  momentOfInertiaFactor: number; // I = factor · m · r²
}

export type CelestialBodyId = 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'jupiter';

export interface CelestialBody {
  id: CelestialBodyId;
  name: string;
  gravity: number; // m/s²
  airDensity: number; // kg/m³ en la superficie
}

export type SurfaceId = 'fairway' | 'rough' | 'sand' | 'green' | 'water';

export interface SurfaceType {
  id: SurfaceId;
  restitution: number; // e: fracción de velocidad normal que se conserva
  slidingFriction: number; // μ de Coulomb en el impacto
  rollingResistance: number; // μr: desaceleración al rodar = μr · g
}

// Copa: cilindro vertical hundido bajo el borde, en un terreno plano alrededor de su centro.
export interface Cup {
  position: { x: number; z: number };
  radius: number; // m; 0.255 (diámetro 51 cm; reglamento: 50 a 52 cm)
  depth: number; // m bajo el borde; 0.28 (reglamento: mínimo 28 cm)
}

export interface Wind {
  speed: number; // m/s
  headingDeg: number; // 0 = hacia -z, crece en sentido horario visto desde arriba
}

// Punto golpeado, en el disco unitario del balón visto desde atrás.
export interface ContactPoint {
  x: number; // -1..1: negativo = efecto a un lado, positivo = al otro
  y: number; // -1..1: negativo = bajo el centro (globo, backspin), positivo = sobre el centro (raso, topspin)
}

// Tipo de golpe: fija la velocidad máxima y la elevación (ver SHOT_TYPES en game/shot.ts).
export type ShotTypeId = 'powerful' | 'long' | 'short' | 'putt';

export interface ShotInput {
  shotType: ShotTypeId; // elegido con Q/E
  headingDeg: number; // rumbo elegido con el teclado
  power: number; // 0..1, fijado con el 2º clic
  accuracy: number; // -1..1, fijado con el 3º clic; 0 = centro perfecto
  contact: ContactPoint;
}

export interface TerrainBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Superficie del suelo como campo de alturas y(x, z).
export interface Terrain {
  readonly bounds: TerrainBounds;
  heightAt(x: number, z: number): number; // m; fuera de bounds vale 0
  normalAt(x: number, z: number): Vec3; // unitaria, y > 0
  slopeDegAt(x: number, z: number): number; // ángulo con la horizontal, 0..90
}

// Lo que muestra el HUD.
export interface ShotResult {
  distance: number; // m, horizontal entre origen del tiro y primer contacto con el suelo
  apexHeight: number; // m
  flightTime: number; // s
  launchSpeed: number; // m/s
  trace: Vec3[]; // puntos de la trayectoria para dibujar
}
