import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { carrisSteps, headsignScore, isCarris, matchLeg, nearbyStops, type GoogleTransitStep, type RoutesResponse } from "./match.ts";
import type { Line, Pattern, Stop } from "./types.ts";

const dir = new URL("../../docs/amostras/", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const fx = read("match_1623.json") as { step: GoogleTransitStep; line: Line; patterns: Pattern[]; stops: Stop[] };
const routes = read("google_routes_sintra_cascais.json") as RoutesResponse;

describe("agência", () => {
  it("identifica só Carris Metropolitana", () => {
    const all = routes.routes!.flatMap((r) => r.legs!.flatMap((l) => l.steps!)).filter((s) => s.transitDetails);
    const carris = all.filter((s) => isCarris(s as GoogleTransitStep));
    expect(carris.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(carris.length); // há Sintra 434
    expect(carrisSteps(routes.routes![0]).every(isCarris)).toBe(true);
  });
});

describe("headsignScore", () => {
  it("compara palavras", () => {
    expect(headsignScore("Lisboa (Campo Grande) via Cabeço", "Campo Grande")).toBeCloseTo(2 / 5);
    expect(headsignScore("Cascais (Terminal)", "Cascais (Terminal)")).toBe(1);
    expect(headsignScore(undefined, "x")).toBe(0);
  });
});

describe("nearbyStops", () => {
  it("encontra paragens ≤120 m do embarque, ordenadas", () => {
    const b = fx.step.transitDetails.stopDetails.departureStop.location.latLng;
    const n = nearbyStops(fx.stops, b.latitude, b.longitude);
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => x.dist <= 120)).toBe(true);
    expect(n[0].dist).toBeLessThanOrEqual(n[n.length - 1].dist);
  });
});

describe("matchLeg (Google → Carris)", () => {
  const m = matchLeg(fx.step, [fx.line], fx.stops, fx.patterns);
  it("liga a linha pelo nameShort", () => {
    expect(m.line?.short_name).toBe("1623");
  });
  it("resolve o padrão com embarque antes de desembarque, pelo headsign", () => {
    expect(m.candidates[0].pattern_id).toBe("1623_0_2");
    expect(m.candidates[0].headsign).toBe("Cascais (Terminal)");
    expect(m.candidates[0].score).toBe(1);
    expect(m.ambiguous).toBe(false);
  });
  it("o sentido oposto não é candidato", () => {
    expect(m.candidates.map((c) => c.pattern_id)).not.toContain("1623_0_1");
  });
  it("sem linha conhecida não há candidatos", () => {
    const r = matchLeg(fx.step, [], fx.stops, fx.patterns);
    expect(r.line).toBeUndefined();
    expect(r.candidates).toEqual([]);
  });
  it("marca ambiguidade quando dois padrões empatam", () => {
    const dup: Pattern = { ...fx.patterns.find((p) => p.id === "1623_0_2")!, id: "1623_0_9" };
    const r = matchLeg(fx.step, [fx.line], fx.stops, [...fx.patterns, dup]);
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.length).toBe(2);
  });
  it("sem paragens próximas não há candidatos", () => {
    const r = matchLeg(fx.step, [fx.line], [], fx.patterns);
    expect(r.candidates).toEqual([]);
  });
});
