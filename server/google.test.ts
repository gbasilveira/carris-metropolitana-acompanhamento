import { describe, expect, it } from "vitest";
import { computeRoutes, parseRequest } from "./google.ts";

const ok = { origin: { lat: 38.8, lon: -9.38 }, destination: { lat: 38.7, lon: -9.42 } };

describe("parseRequest", () => {
  it("aceita pedido válido", () => expect(parseRequest(ok)).toEqual({ ...ok, departureTime: undefined }));
  it("rejeita coordenadas fora de Portugal ou em falta", () => {
    expect(typeof parseRequest({ ...ok, origin: { lat: 0, lon: 0 } })).toBe("string");
    expect(typeof parseRequest({})).toBe("string");
    expect(typeof parseRequest({ ...ok, departureTime: "ontem" })).toBe("string");
  });
});

describe("computeRoutes", () => {
  it("sem chave devolve 503 e não chama a rede", async () => {
    let called = false;
    const r = await computeRoutes(ok, undefined, (async () => ((called = true), new Response("{}"))) as any);
    expect(r.status).toBe(503);
    expect(called).toBe(false);
  });
  it("envia a chave só em cabeçalho e TRANSIT no corpo", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => ((init = i), new Response('{"routes":[]}'))) as any;
    const r = await computeRoutes(ok, "KEY123", f);
    expect(r.status).toBe(200);
    expect((init!.headers as any)["X-Goog-Api-Key"]).toBe("KEY123");
    expect(JSON.parse(init!.body as string).travelMode).toBe("TRANSIT");
    expect(JSON.stringify(r.body)).not.toContain("KEY123");
  });
  it("não vaza o corpo de erro do upstream", async () => {
    const r = await computeRoutes(ok, "KEY123", (async () => new Response("segredo", { status: 403 })) as any);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});
