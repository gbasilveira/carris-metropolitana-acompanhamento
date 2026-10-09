import { haversine } from "./geo.ts";
import type { Line, Pattern, Stop } from "./types.ts";

/** Raio máximo (m) entre paragem Google e paragem Carris */
export const MAX_STOP_DIST = 120;

/** Troço de transporte público devolvido pela Routes API (transitDetails) */
export interface GoogleTransitStep {
  transitDetails: {
    headsign?: string;
    transitLine: { nameShort?: string; agencies?: { name?: string }[] };
    stopDetails: {
      departureStop: { name?: string; location: { latLng: { latitude: number; longitude: number } } };
      arrivalStop: { name?: string; location: { latLng: { latitude: number; longitude: number } } };
    };
  };
}

export interface RoutesResponse {
  routes?: { legs?: { steps?: Partial<GoogleTransitStep & { travelMode: string }>[] }[] }[];
}

export interface PatternCandidate {
  pattern_id: string;
  line_id: string;
  headsign: string;
  /** palavras comuns com o headsign Google (0–1) */
  score: number;
}

export interface LegMatch {
  line?: Line;
  boardStopIds: string[];
  alightStopIds: string[];
  /** candidatos ordenados por pontuação; >1 com o mesmo score → pedir ao utilizador */
  candidates: PatternCandidate[];
  /** true quando há mais do que um candidato plausível (empate no topo) */
  ambiguous: boolean;
  step: GoogleTransitStep;
}

const words = (s?: string) => new Set((s ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

export function isCarris(step: GoogleTransitStep): boolean {
  return (step.transitDetails.transitLine.agencies ?? []).some((a) => (a.name ?? "").includes("Carris Metropolitana"));
}

export function headsignScore(google?: string, carris?: string): number {
  const g = words(google);
  if (g.size === 0) return 0;
  const c = words(carris);
  let n = 0;
  for (const w of g) if (c.has(w)) n++;
  return n / g.size;
}

/** Paragens Carris a ≤ MAX_STOP_DIST de um ponto, da mais próxima para a mais distante */
export function nearbyStops(stops: Stop[], lat: number, lon: number, maxM = MAX_STOP_DIST): { stop: Stop; dist: number }[] {
  return stops
    .filter((s) => Math.abs(s.lat - lat) < 0.003 && Math.abs(s.lon - lon) < 0.004)
    .map((stop) => ({ stop, dist: haversine(lat, lon, stop.lat, stop.lon) }))
    .filter((x) => x.dist <= maxM)
    .sort((a, b) => a.dist - b.dist);
}

/** Extrai os troços TP Carris Metropolitana de uma rota Google */
export function carrisSteps(route: NonNullable<RoutesResponse["routes"]>[number]): GoogleTransitStep[] {
  const out: GoogleTransitStep[] = [];
  for (const leg of route.legs ?? [])
    for (const st of leg.steps ?? [])
      if (st.transitDetails && isCarris(st as GoogleTransitStep)) out.push(st as GoogleTransitStep);
  return out;
}

/**
 * Algoritmo validado (docs/validacao.md §6):
 *  1. nameShort → linha (short_name)
 *  2. paragens Carris ≤ 120 m do embarque e do desembarque
 *  3. padrões da linha que contêm embarque antes de desembarque
 *  4. desempate por headsign; se o topo estiver empatado → ambíguo (utilizador escolhe)
 * `patterns` deve conter os padrões da linha.
 */
export function matchLeg(step: GoogleTransitStep, lines: Line[], stops: Stop[], patterns: Pattern[]): LegMatch {
  const td = step.transitDetails;
  const line = lines.find((l) => l.short_name === td.transitLine.nameShort);
  const b = td.stopDetails.departureStop.location.latLng;
  const a = td.stopDetails.arrivalStop.location.latLng;
  const boardStopIds = nearbyStops(stops, b.latitude, b.longitude).map((x) => x.stop.id);
  const alightStopIds = nearbyStops(stops, a.latitude, a.longitude).map((x) => x.stop.id);
  const board = new Set(boardStopIds);
  const alight = new Set(alightStopIds);

  const candidates: PatternCandidate[] = [];
  if (line) {
    for (const p of patterns.filter((p) => p.line_id === line.id)) {
      const seq = p.path.map((x) => x.stop_id);
      const i = seq.findIndex((s) => board.has(s));
      if (i >= 0 && seq.slice(i + 1).some((s) => alight.has(s))) {
        candidates.push({
          pattern_id: p.id,
          line_id: p.line_id,
          headsign: p.headsign,
          score: headsignScore(td.headsign, p.headsign),
        });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  const ambiguous = candidates.length > 1 && candidates[0].score === candidates[1].score;
  return { line, boardStopIds, alightStopIds, candidates, ambiguous, step };
}
