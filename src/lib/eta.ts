import type { Pattern, Shape } from "./types.ts";
import { cumulative, projectOnLine, type LonLat } from "./geo.ts";

/** Velocidade mínima (m/s) para não dividir por ~0 quando o autocarro está parado; ≈ 10,8 km/h */
export const MIN_SPEED = 3;
/** Velocidade máxima plausível (m/s); ≈ 90 km/h */
export const MAX_SPEED = 25;
/** Velocidade por omissão em meio urbano quando não há dados (m/s); ≈ 21,6 km/h */
export const DEFAULT_SPEED = 6;
/** Janela da média móvel (ms) */
export const WINDOW_MS = 3 * 60_000;

export interface SpeedSample {
  t: number;
  /** m/s */
  speed: number;
}

/** Média móvel das velocidades (m/s) dentro da janela, com piso e teto. Amostras a 0 contam (para-arranca). */
export function movingAverageSpeed(samples: SpeedSample[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= WINDOW_MS);
  if (recent.length === 0) return DEFAULT_SPEED;
  const avg = recent.reduce((a, s) => a + s.speed, 0) / recent.length;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, avg));
}

/** Guarda amostras recentes por veículo */
export class SpeedTracker {
  private data = new Map<string, SpeedSample[]>();
  /** `speedKmh` null/indefinido é ignorado (sem leitura) */
  add(vehicleId: string, t: number, speedKmh: number | null | undefined) {
    if (speedKmh == null || !Number.isFinite(speedKmh)) return;
    const list = this.data.get(vehicleId) ?? [];
    if (list.length && list[list.length - 1].t === t) return;
    list.push({ t, speed: speedKmh / 3.6 });
    this.data.set(vehicleId, list.filter((s) => t - s.t <= WINDOW_MS));
  }
  average(vehicleId: string, now: number): number {
    return movingAverageSpeed(this.data.get(vehicleId) ?? [], now);
  }
}

/** Geometria pré-calculada de um padrão */
export interface PatternGeometry {
  coords: LonLat[];
  cum: number[];
  /** posição ao longo da shape de cada paragem (m), alinhada com pattern.path */
  stopAlong: Map<string, number[]>;
}

export function buildGeometry(pattern: Pattern, shape: Shape): PatternGeometry {
  const coords = shape.geojson.geometry.coordinates as LonLat[];
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || shape.extension;
  const last = pattern.path[pattern.path.length - 1]?.distance ?? 0;
  // path[].distance está em km; ajusta pela razão entre a shape real e a distância do padrão
  const scale = last > 0 ? total / (last * 1000) : 1;
  const stopAlong = new Map<string, number[]>();
  for (const p of pattern.path) {
    const list = stopAlong.get(p.stop_id) ?? [];
    list.push(p.distance * 1000 * scale);
    stopAlong.set(p.stop_id, list);
  }
  return { coords, cum, stopAlong };
}

export interface EtaEstimate {
  /** metros até à paragem (negativo = já passou) */
  remainingM: number;
  /** segundos até à chegada (≥ 0); null se já passou */
  seconds: number | null;
  passed: boolean;
  speedMs: number;
  /** idade da posição em segundos */
  ageS: number;
  /** distância do veículo à shape (m): valor alto indica veículo fora do percurso */
  offsetM: number;
}

/** Margem (m) para considerar que o veículo já passou a paragem */
const PASSED_MARGIN = 30;

/**
 * Estima a chegada de um veículo a uma paragem do padrão.
 * - projeta a posição do veículo na shape;
 * - distância restante = posição da paragem − posição do veículo;
 * - tempo = distância / velocidade média móvel − idade do dado (o veículo andou desde a leitura).
 * Com paragens repetidas (circulares) usa a primeira ocorrência à frente do veículo.
 */
export function estimateEta(
  geom: PatternGeometry,
  stopId: string,
  vehicle: { lat: number; lon: number; receivedAt: number },
  speedMs: number,
  now: number,
): EtaEstimate | null {
  const positions = geom.stopAlong.get(stopId);
  if (!positions) return null;
  const proj = projectOnLine(geom.coords, geom.cum, vehicle.lat, vehicle.lon);
  const target = positions.find((p) => p >= proj.along - PASSED_MARGIN) ?? positions[positions.length - 1];
  const remaining = target - proj.along;
  const ageS = Math.max(0, (now - vehicle.receivedAt) / 1000);
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speedMs));
  const passed = remaining < -PASSED_MARGIN;
  return {
    remainingM: remaining,
    seconds: passed ? null : Math.max(0, remaining / speed - ageS),
    passed,
    speedMs: speed,
    ageS,
    offsetM: proj.offset,
  };
}

export function formatEta(seconds: number): string {
  if (seconds < 45) return "a chegar";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
