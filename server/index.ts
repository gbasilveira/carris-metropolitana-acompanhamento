import { createServer } from "node:http";
import { computeRoutes, parseRequest } from "./google.ts";

const PORT = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || req.url !== "/api/google/routes") return send(404, { error: "não encontrado" });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return send(413, { error: "pedido demasiado grande" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return send(400, { error: "JSON inválido" });
  }
  const r = parseRequest(parsed);
  if (typeof r === "string") return send(400, { error: r });
  try {
    const out = await computeRoutes(r, process.env.GOOGLE_MAPS_API_KEY);
    send(out.status, out.body);
  } catch {
    send(502, { error: "falha ao contactar a Routes API" });
  }
}).listen(PORT, () => console.log(`Servidor Google em http://localhost:${PORT}`));
