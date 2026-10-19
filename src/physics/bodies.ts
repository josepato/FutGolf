import type { BallSpec, CelestialBody, CelestialBodyId } from './types';

// Balón de fútbol talla 5.
export const BALL_SPEC: BallSpec = {
  mass: 0.43,
  radius: 0.11,
  dragCoefficient: 0.25,
  momentOfInertiaFactor: 2 / 3, // cascarón esférico
};

// Mercurio y la Luna no tienen atmósfera (ρ = 0): sin arrastre ni Magnus.
// Júpiter usa los valores a 1 bar de presión, tratado como si hubiera suelo.
export const CELESTIAL_BODIES: Record<CelestialBodyId, CelestialBody> = {
  mercury: { id: 'mercury', name: 'Mercurio', gravity: 3.7, airDensity: 0 },
  venus: { id: 'venus', name: 'Venus', gravity: 8.87, airDensity: 65 },
  earth: { id: 'earth', name: 'Tierra', gravity: 9.81, airDensity: 1.225 },
  moon: { id: 'moon', name: 'Luna', gravity: 1.62, airDensity: 0 },
  mars: { id: 'mars', name: 'Marte', gravity: 3.71, airDensity: 0.02 },
  jupiter: { id: 'jupiter', name: 'Júpiter', gravity: 24.79, airDensity: 1.33 },
};

export const DEFAULT_BODY_ID: CelestialBodyId = 'earth';
