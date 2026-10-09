import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildGeometry, estimateEta, formatEta, movingAverageSpeed, SpeedTracker, MIN_SPEED, MAX_SPEED, DEFAULT_SPEED } from "./eta.ts";
import { projectOnLine } from "./geo.ts";
import type { Pattern, Shape } from "./types.ts";

const dir = new URL("../../docs/amostras/", import.meta.url);
const pattern = JSON.parse(readFileSync(new URL("v2_pattern_1001_0_1.json", dir), "utf8")) as Pattern;
const shape = JSON.parse(readFileSync(new URL("v2_shape_XS3H8_1.json", dir), "utf8")) as Shape;
const geom = buildGeometry(pattern, shape);
const NOW = 1_800_000_000_000;

/** Ponto da shape à distância `m` (aprox.): usa o vértice mais próximo */
function pointAt(m: number) {
  const i = geom.cum.findIndex((c) => c >= m);
  const [lon, lat] = geom.coords[i];
  return { lat, lon, along: geom.cum[i] };
}

describe("geometria", () => {
  it("shape e path.distance são coerentes (km vs m)", () => {
    const last = pattern.path[pattern.path.length - 1].distance * 1000;
    expect(Math.abs(geom.cum[geom.cum.length - 1] - last) / last).toBeLessThan(0.05);
  });
  it("projeta um vértice da shape em si próprio", () => {
    const p = pointAt(3000);
    const r = projectOnLine(geom.coords, geom.cum, p.lat, p.lon);
    expect(r.offset).toBeLessThan(1);
    expect(Math.abs(r.along - p.along)).toBeLessThan(1);
  });
});

describe("velocidade", () => {
  it("sem amostras usa o valor por omissão", () => {
    expect(movingAverageSpeed([], NOW)).toBe(DEFAULT_SPEED);
  });
  it("aplica piso (parado) e teto", () => {
    expect(movingAverageSpeed([{ t: NOW, speed: 0 }], NOW)).toBe(MIN_SPEED);
    expect(movingAverageSpeed([{ t: NOW, speed: 100 }], NOW)).toBe(MAX_SPEED);
  });
  it("faz média apenas dentro da janela", () => {
    const s = [
      { t: NOW - 10 * 60_000, speed: 20 },
      { t: NOW - 30_000, speed: 8 },
      { t: NOW - 10_000, speed: 10 },
    ];
    expect(movingAverageSpeed(s, NOW)).toBeCloseTo(9);
  });
  it("tracker converte km/h para m/s e ignora leituras nulas", () => {
    const t = new SpeedTracker();
    t.add("v", NOW - 20_000, 36);
    t.add("v", NOW - 10_000, null);
    t.add("v", NOW - 10_000, 36);
    expect(t.average("v", NOW)).toBeCloseTo(10);
    expect(t.average("outro", NOW)).toBe(DEFAULT_SPEED);
  });
});

describe("estimateEta", () => {
  const last = pattern.path[pattern.path.length - 1];
  const veh = pointAt(1000);

  it("distância e tempo até à paragem final", () => {
    const e = estimateEta(geom, last.stop_id, { lat: veh.lat, lon: veh.lon, receivedAt: NOW }, 10, NOW)!;
    expect(e.passed).toBe(false);
    const expected = geom.cum[geom.cum.length - 1] - veh.along;
    expect(e.remainingM).toBeCloseTo(expected, -1);
    expect(e.seconds!).toBeCloseTo(expected / 10, -1);
  });
  it("desconta a idade da posição", () => {
    const fresh = estimateEta(geom, last.stop_id, { lat: veh.lat, lon: veh.lon, receivedAt: NOW }, 10, NOW)!;
    const old = estimateEta(geom, last.stop_id, { lat: veh.lat, lon: veh.lon, receivedAt: NOW - 30_000 }, 10, NOW)!;
    expect(fresh.seconds! - old.seconds!).toBeCloseTo(30, 0);
    expect(old.ageS).toBe(30);
  });
  it("nunca devolve tempo negativo", () => {
    const near = pattern.path[3];
    const p = pointAt(near.distance * 1000 - 5);
    const e = estimateEta(geom, near.stop_id, { lat: p.lat, lon: p.lon, receivedAt: NOW - 600_000 }, 10, NOW)!;
    expect(e.seconds).toBe(0);
  });
  it("usa o piso de velocidade quando parado", () => {
    const e = estimateEta(geom, last.stop_id, { lat: veh.lat, lon: veh.lon, receivedAt: NOW }, 0, NOW)!;
    expect(e.speedMs).toBe(MIN_SPEED);
    expect(Number.isFinite(e.seconds!)).toBe(true);
  });
  it("marca paragens já passadas", () => {
    const first = pattern.path[1];
    const p = pointAt(first.distance * 1000 + 800);
    const e = estimateEta(geom, first.stop_id, { lat: p.lat, lon: p.lon, receivedAt: NOW }, 10, NOW)!;
    expect(e.passed).toBe(true);
    expect(e.seconds).toBeNull();
  });
  it("devolve null para paragem fora do padrão", () => {
    expect(estimateEta(geom, "000000", { lat: veh.lat, lon: veh.lon, receivedAt: NOW }, 10, NOW)).toBeNull();
  });
});

describe("formatEta", () => {
  it("formata", () => {
    expect(formatEta(20)).toBe("a chegar");
    expect(formatEta(5 * 60)).toBe("5 min");
    expect(formatEta(75 * 60)).toBe("1 h 15 min");
  });
});
