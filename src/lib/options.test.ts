import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, detailLevels, normalizeOptions, resolveAppearance } from "./options.ts";

describe("opções", () => {
  it("valores inválidos voltam ao padrão", () => {
    expect(normalizeOptions({ appearance: "neon", pollSeconds: 3, trails: "sim" })).toEqual(DEFAULT_OPTIONS);
    expect(normalizeOptions(null)).toEqual(DEFAULT_OPTIONS);
  });
  it("mantém valores válidos", () => {
    const o = normalizeOptions({ appearance: "radar", tagDetail: "line", trails: false, pollSeconds: 10 });
    expect(o).toMatchObject({ appearance: "radar", tagDetail: "line", trails: false, pollSeconds: 10 });
  });
  it("resolve auto", () => {
    expect(resolveAppearance("auto", true)).toBe("dark");
    expect(resolveAppearance("auto", false)).toBe("light");
    expect(resolveAppearance("radar", false)).toBe("radar");
  });
  it("níveis por preferência", () => {
    expect(detailLevels("full")).toEqual(["full", "compact", "line"]);
    expect(detailLevels("none")).toEqual([]);
  });
});
