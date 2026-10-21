import type { SurfaceId, SurfaceType } from './types';

// Valores iniciales de afinación, ajustables al jugar.
export const SURFACES: Record<SurfaceId, SurfaceType> = {
  fairway: { id: 'fairway', restitution: 0.75, slidingFriction: 0.35, rollingResistance: 0.06 },
  rough: { id: 'rough', restitution: 0.45, slidingFriction: 0.6, rollingResistance: 0.25 },
  sand: { id: 'sand', restitution: 0.15, slidingFriction: 0.8, rollingResistance: 0.6 },
  green: { id: 'green', restitution: 0.6, slidingFriction: 0.3, rollingResistance: 0.035 },
  // Muy absorbente: el balón apenas rebota y se frena en menos de un metro ("se hunde").
  water: { id: 'water', restitution: 0.05, slidingFriction: 1.0, rollingResistance: 1.5 },
};
