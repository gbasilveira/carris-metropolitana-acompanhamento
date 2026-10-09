export type LonLat = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em metros (haversine) */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distâncias acumuladas (m) em cada vértice de uma linha [lon,lat][] */
export function cumulative(coords: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return out;
}

export interface Projection {
  /** distância ao longo da linha (m) */
  along: number;
  /** distância do ponto à linha (m) */
  offset: number;
}

/**
 * Projeta um ponto na polilinha. `minAlong` ignora troços anteriores (ajuda em percursos que passam duas vezes
 * no mesmo local, p. ex. circulares).
 */
export function projectOnLine(coords: LonLat[], cum: number[], lat: number, lon: number, minAlong = 0): Projection {
  const k = Math.cos(rad(lat));
  let best: Projection = { along: 0, offset: Infinity };
  for (let i = 0; i < coords.length - 1; i++) {
    if (cum[i + 1] < minAlong) continue;
    // plano local em metros
    const ax = (coords[i][0] - lon) * k * 111320;
    const ay = (coords[i][1] - lat) * 110540;
    const bx = (coords[i + 1][0] - lon) * k * 111320;
    const by = (coords[i + 1][1] - lat) * 110540;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const offset = Math.hypot(px, py);
    if (offset < best.offset) best = { offset, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}
