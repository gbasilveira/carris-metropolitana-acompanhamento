import { carrisSteps, matchLeg, type RoutesResponse } from "./match.ts";
import type { Line, Pattern, Stop } from "./types.ts";

export interface TripLeg {
  lineId: string;
  /** padrões possíveis (vários quando o sentido é ambíguo) */
  patternIds: string[];
  boardStopId: string;
  alightStopId: string;
}

/** Uma forma de fazer o percurso (sequência de carreiras). */
export interface TripOption {
  legs: TripLeg[];
  /** true se a rota Google inclui outros operadores (só seguimos a parte Carris) */
  partial: boolean;
}

export interface Place {
  lat: number;
  lon: number;
  name?: string;
}

export interface Trip {
  id: string;
  name: string;
  category: string;
  origin: Place;
  destination: Place;
  /** hora de partida usada na pesquisa (HH:MM); ausente = todas as horas */
  time?: string;
  options: TripOption[];
}

export interface Group {
  id: string;
  name: string;
  lineIds: string[];
}

export const DEFAULT_CATEGORIES = ["Casa ↔ Trabalho", "Lazer", "Outros"];

export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Converte rotas Google em opções de percurso Carris. Opções com algum troço Carris não resolvido
 * são descartadas (não se inventa o sentido); troços de outros operadores marcam a opção como parcial.
 */
export async function optionsFromRoutes(
  responses: RoutesResponse[],
  lines: Line[],
  stops: Stop[],
  patternsFor: (line: Line) => Promise<Pattern[]>,
): Promise<TripOption[]> {
  const out = new Map<string, TripOption>();
  for (const res of responses) {
    for (const route of res.routes ?? []) {
      const steps = carrisSteps(route);
      if (!steps.length) continue;
      const transitCount = (route.legs ?? []).flatMap((l) => l.steps ?? []).filter((s) => s.transitDetails).length;
      const legs: TripLeg[] = [];
      let ok = true;
      for (const st of steps) {
        const line = lines.find((l) => l.short_name === st.transitDetails.transitLine.nameShort);
        if (!line) { ok = false; break; }
        const m = matchLeg(st, lines, stops, await patternsFor(line));
        if (!m.candidates.length) { ok = false; break; }
        const top = m.ambiguous ? m.candidates.filter((c) => c.score === m.candidates[0].score) : [m.candidates[0]];
        legs.push({ lineId: line.id, patternIds: top.map((c) => c.pattern_id), boardStopId: m.boardStopIds[0], alightStopId: m.alightStopIds[0] });
      }
      if (!ok) continue;
      const key = legs.map((l) => `${l.lineId}:${[...l.patternIds].sort().join("+")}:${l.boardStopId}>${l.alightStopId}`).join("|");
      if (!out.has(key)) out.set(key, { legs, partial: transitCount > steps.length });
    }
  }
  return [...out.values()];
}

/** Junta opções sem duplicar (mesma chave de troços) */
export function mergeOptions(a: TripOption[], b: TripOption[]): TripOption[] {
  const key = (o: TripOption) => o.legs.map((l) => `${l.lineId}:${[...l.patternIds].sort().join("+")}:${l.boardStopId}>${l.alightStopId}`).join("|");
  const seen = new Map(a.map((o) => [key(o), o]));
  for (const o of b) if (!seen.has(key(o))) seen.set(key(o), o);
  return [...seen.values()];
}

/**
 * Horas de partida (RFC 3339, UTC) para cobrir o dia quando o utilizador não indica horário:
 * 5 horas de um dia útil futuro + uma de domingo. `from` define "agora".
 */
export function searchTimes(from = new Date()): string[] {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  const sunday = new Date(day);
  while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);
  const at = (d: Date, h: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h)).toISOString();
  return [at(day, 6), at(day, 9), at(day, 13), at(day, 18), at(day, 21), at(sunday, 11)];
}

/** Todas as linhas referidas por uma viagem */
export function tripLineIds(t: Trip): string[] {
  return [...new Set(t.options.flatMap((o) => o.legs.map((l) => l.lineId)))];
}
export function tripPatternIds(t: Trip): string[] {
  return [...new Set(t.options.flatMap((o) => o.legs.flatMap((l) => l.patternIds)))];
}
