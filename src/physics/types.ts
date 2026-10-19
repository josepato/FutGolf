// Unidades SI. Ejes de Three.js: x derecha, y arriba, z hacia la cámara.
// El rumbo 0 apunta hacia -z. El suelo es el plano y = 0.

export type Vec3 = { x: number; y: number; z: number };

export type BallPhase = 'idle' | 'flying' | 'rolling' | 'stopped';

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

export type SurfaceId = 'fairway' | 'rough' | 'sand';

export interface SurfaceType {
  id: SurfaceId;
  restitution: number; // e: fracción de velocidad normal que se conserva
  slidingFriction: number; // μ de Coulomb en el impacto
  rollingResistance: number; // μr: desaceleración al rodar = μr · g
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

export interface ShotInput {
  headingDeg: number; // rumbo elegido con el teclado
  power: number; // 0..1, fijado con el 2º clic
  accuracy: number; // -1..1, fijado con el 3º clic; 0 = centro perfecto
  contact: ContactPoint;
}

// Lo que muestra el HUD.
export interface ShotResult {
  distance: number; // m, horizontal entre origen del tiro y primer contacto con el suelo
  apexHeight: number; // m
  flightTime: number; // s
  launchSpeed: number; // m/s
  trace: Vec3[]; // puntos de la trayectoria para dibujar
}
