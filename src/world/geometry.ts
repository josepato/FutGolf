// Geometría 2D sobre el plano del suelo (x, z), compartida por el hoyo y el paisaje.

export interface Vec2 {
  x: number;
  z: number;
}

// Distancia de (x, z) al segmento a–b.
export function distanceToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / lengthSq));
  return Math.hypot(x - (a.x + t * abx), z - (a.z + t * abz));
}

export function distanceToPolyline(x: number, z: number, points: Vec2[]): number {
  if (points.length === 1) return Math.hypot(x - points[0].x, z - points[0].z);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(x, z, points[i], points[i + 1]));
  }
  return best;
}

export function polylineLength(points: Vec2[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }
  return length;
}

// Punto de la polilínea a `distance` m del inicio, con la dirección del tramo ahí (unitaria).
// Con distance < 0 o mayor que la longitud se prolonga el primer o el último tramo.
export function pointAlong(points: Vec2[], distance: number): { point: Vec2; direction: Vec2 } {
  let index = 0;
  let remaining = distance;
  while (index < points.length - 2) {
    const length = Math.hypot(points[index + 1].x - points[index].x, points[index + 1].z - points[index].z);
    if (remaining <= length) break;
    remaining -= length;
    index += 1;
  }
  const a = points[index];
  const b = points[index + 1];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const direction = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  return { point: { x: a.x + direction.x * remaining, z: a.z + direction.z * remaining }, direction };
}
