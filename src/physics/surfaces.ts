import type { SurfaceId, SurfaceType } from './types';

// Valores iniciales de afinación, ajustables al jugar.
export const SURFACES: Record<SurfaceId, SurfaceType> = {
  fairway: { id: 'fairway', restitution: 0.75, slidingFriction: 0.35, rollingResistance: 0.06 },
  rough: { id: 'rough', restitution: 0.45, slidingFriction: 0.6, rollingResistance: 0.25 },
  sand: { id: 'sand', restitution: 0.15, slidingFriction: 0.8, rollingResistance: 0.6 },
};
