import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mergeOptions, optionsFromRoutes, searchTimes, tripLineIds, tripPatternIds, type Trip } from "./trips.ts";
import { normalizeFavorites } from "./favorites.ts";
import type { RoutesResponse } from "./match.ts";
import type { Line, Pattern, Stop } from "./types.ts";

const dir = new URL("../../docs/amostras/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const fx = read("match_1623.json") as { line: Line; patterns: Pattern[]; stops: Stop[] };
const routes = read("google_routes_sintra_cascais.json") as RoutesResponse;
const lines = [fx.line];
const patternsFor = async (l: Line) => (l.id === "1623" ? fx.patterns : []);

describe("optionsFromRoutes", () => {
  it("só devolve opções totalmente resolvidas (1623 → padrão para Cascais)", async () => {
    const opts = await optionsFromRoutes([routes], lines, fx.stops, patternsFor);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) for (const l of o.legs) expect(l.lineId).toBe("1623");
    expect(opts[0].legs[0].patternIds).toEqual(["1623_0_2"]);
  });
  it("descarta rotas com linha desconhecida", async () => {
    expect(await optionsFromRoutes([routes], [], fx.stops, patternsFor)).toEqual([]);
  });
  it("não duplica opções repetidas em várias respostas", async () => {
    const once = await optionsFromRoutes([routes], lines, fx.stops, patternsFor);
    const twice = await optionsFromRoutes([routes, routes], lines, fx.stops, patternsFor);
    expect(twice.length).toBe(once.length);
  });
});

describe("mergeOptions", () => {
  it("junta sem repetir", async () => {
    const a = await optionsFromRoutes([routes], lines, fx.stops, patternsFor);
    expect(mergeOptions(a, a).length).toBe(a.length);
    expect(mergeOptions([], a).length).toBe(a.length);
  });
});

describe("searchTimes", () => {
  it("6 horas futuras, 5 em dia útil e 1 em domingo", () => {
    const from = new Date("2026-10-09T12:00:00Z"); // sexta
    const t = searchTimes(from).map((x) => new Date(x));
    expect(t.length).toBe(6);
    expect(t.every((d) => d > from)).toBe(true);
    expect(t.slice(0, 5).every((d) => ![0, 6].includes(d.getUTCDay()))).toBe(true);
    expect(t[5].getUTCDay()).toBe(0);
  });
});

describe("viagem", () => {
  const trip: Trip = {
    id: "t", name: "x", category: "c", origin: { lat: 1, lon: 1 }, destination: { lat: 2, lon: 2 },
    options: [
      { partial: false, legs: [{ lineId: "1", patternIds: ["1_0_1"], boardStopId: "a", alightStopId: "b" }] },
      { partial: false, legs: [{ lineId: "1", patternIds: ["1_0_1", "1_0_2"], boardStopId: "a", alightStopId: "c" }, { lineId: "2", patternIds: ["2_0_1"], boardStopId: "c", alightStopId: "d" }] },
    ],
  };
  it("lista linhas e padrões sem repetir", () => {
    expect(tripLineIds(trip)).toEqual(["1", "2"]);
    expect(tripPatternIds(trip)).toEqual(["1_0_1", "1_0_2", "2_0_1"]);
  });
});

describe("normalizeFavorites", () => {
  it("migra a versão antiga (só linhas/paragens)", () => {
    const f = normalizeFavorites({ lines: ["1001"], stops: ["010001"] });
    expect(f.lines).toEqual(["1001"]);
    expect(f.trips).toEqual([]);
    expect(f.groups).toEqual([]);
    expect(f.categories.length).toBeGreaterThan(0);
  });
  it("tolera lixo", () => {
    expect(normalizeFavorites("x").lines).toEqual([]);
    expect(normalizeFavorites(null).categories.length).toBeGreaterThan(0);
  });
});
