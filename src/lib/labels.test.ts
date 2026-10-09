import { describe, expect, it } from "vitest";
import { placeLabels, type Box, type LabelReq } from "./labels.ts";

const size = { w: 120, h: 36 };
const box = (r: LabelReq, p: { dx: number; dy: number; level: number }): Box => ({
  x: r.x + p.dx - r.sizes[p.level].w / 2, y: r.y + p.dy - r.sizes[p.level].h / 2, ...r.sizes[p.level],
});
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("placeLabels", () => {
  it("um veículo isolado usa o nível mais completo", () => {
    const m = placeLabels([{ id: "a", x: 200, y: 300, sizes: [size, { w: 40, h: 20 }] }], { width: 400, height: 800 });
    expect(m.get("a")?.level).toBe(0);
  });
  it("nunca sobrepõe etiquetas entre si nem sobre veículos", () => {
    const reqs: LabelReq[] = [];
    for (let i = 0; i < 40; i++) reqs.push({ id: String(i), x: 100 + (i % 8) * 25, y: 100 + Math.floor(i / 8) * 22, sizes: [size, { w: 56, h: 22 }, { w: 30, h: 18 }] });
    const m = placeLabels(reqs, { width: 500, height: 500 });
    const boxes: Box[] = [];
    for (const r of reqs) {
      const p = m.get(r.id);
      if (!p) continue;
      const b = box(r, p);
      for (const o of boxes) expect(hit(b, o)).toBe(false);
      for (const v of reqs) expect(hit(b, { x: v.x - 14, y: v.y - 14, w: 28, h: 28 })).toBe(false);
      boxes.push(b);
    }
    expect(boxes.length).toBeGreaterThan(0);
  });
  it("degrada o detalhe quando não há espaço e oculta se mesmo assim não cabe", () => {
    const reqs: LabelReq[] = [];
    for (let i = 0; i < 60; i++) reqs.push({ id: String(i), x: 200 + (i % 3), y: 200 + (i % 2), sizes: [size, { w: 40, h: 20 }] });
    const m = placeLabels(reqs, { width: 400, height: 400 });
    const vals = [...m.values()];
    expect(vals.some((v) => v === null)).toBe(true);
    expect(vals.some((v) => v && v.level === 1)).toBe(true);
  });
  it("oculta etiquetas fora do ecrã", () => {
    const m = placeLabels([{ id: "x", x: -500, y: 10, sizes: [size] }], { width: 400, height: 400 });
    expect(m.get("x")).toBeNull();
  });
  it("mantém as etiquetas dentro do ecrã", () => {
    const reqs: LabelReq[] = [{ id: "e", x: 385, y: 10, sizes: [size] }, { id: "f", x: 5, y: 395, sizes: [size] }];
    const m = placeLabels(reqs, { width: 400, height: 400 });
    for (const r of reqs) {
      const p = m.get(r.id);
      if (!p) continue;
      const b = box(r, p);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(400);
      expect(b.y + b.h).toBeLessThanOrEqual(400);
    }
  });
  it("é determinístico", () => {
    const reqs: LabelReq[] = [0, 1, 2].map((i) => ({ id: String(i), x: 100 + i * 10, y: 100, sizes: [size, { w: 40, h: 20 }] }));
    expect([...placeLabels(reqs, { width: 400, height: 400 })]).toEqual([...placeLabels(reqs, { width: 400, height: 400 })]);
  });
});
