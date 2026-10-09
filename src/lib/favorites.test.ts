import { describe, expect, it } from "vitest";
import { toggle } from "./favorites.ts";

describe("favoritos", () => {
  it("adiciona e remove", () => {
    expect(toggle([], "1001")).toEqual(["1001"]);
    expect(toggle(["1001", "2"], "1001")).toEqual(["2"]);
  });
});
