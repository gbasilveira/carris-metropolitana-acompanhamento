import { stripAgency, type Alert, type Arrival, type HubVehicle, type Line, type Pattern, type Shape, type Stop } from "./types.ts";
import type { RoutesResponse } from "./match.ts";

export const V2 = "https://api.carrismetropolitana.pt/v2";
export const HUB = "https://go.tmlmobilidade.pt/hub/api/v1";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

const unwrap = <T>(d: T[] | { data: T[] }): T[] => (Array.isArray(d) ? d : d.data);

export const getLines = () => json<Line[]>(`${V2}/lines`);
export const getStops = () => json<Stop[]>(`${V2}/stops`);
export const getAlerts = () => json<Alert[]>(`${V2}/alerts`);

const patternCache = new Map<string, Promise<Pattern>>();
/** A API v2 não aceita o prefixo de agência no id do padrão (404); remove-se aqui. */
export function getPattern(id: string): Promise<Pattern> {
  const key = stripAgency(id);
  let p = patternCache.get(key);
  if (!p) {
    p = json<Pattern[]>(`${V2}/patterns/${encodeURIComponent(key)}`).then((d) => d[0]);
    p.catch(() => patternCache.delete(key));
    patternCache.set(key, p);
  }
  return p;
}

const shapeCache = new Map<string, Promise<Shape>>();
export function getShape(id: string): Promise<Shape> {
  let s = shapeCache.get(id);
  if (!s) {
    s = json<Shape>(`${V2}/shapes/${encodeURIComponent(id)}`);
    s.catch(() => shapeCache.delete(id));
    shapeCache.set(id, s);
  }
  return s;
}

export async function getVehicles(signal?: AbortSignal): Promise<HubVehicle[]> {
  return unwrap(await json<HubVehicle[] | { data: HubVehicle[] }>(`${HUB}/vehicles/positions`, { signal }));
}

export async function getArrivals(stopId: string, date: string): Promise<Arrival[]> {
  return json<Arrival[]>(`${V2}/arrivals/by_stop/${encodeURIComponent(stopId)}?date=${date}`);
}

/** Chama a função de servidor (a chave Google nunca está no cliente) */
export async function googleRoutes(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  departureTime?: string,
): Promise<RoutesResponse> {
  const r = await fetch("/api/google/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, destination, departureTime }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Erro ${r.status}`);
  return body as RoutesResponse;
}

/** AAAAMMDD no fuso de Lisboa */
export function lisbonDate(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(d).replaceAll("-", "");
}
