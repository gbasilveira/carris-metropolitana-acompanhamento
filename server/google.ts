// Função do lado do servidor: chama a Routes API (TRANSIT). A chave vem do ambiente e nunca sai daqui.
const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.legs.steps.travelMode,routes.legs.steps.transitDetails";

export interface RouteRequest {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  departureTime?: string;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const okPoint = (p: any) =>
  p && isNum(p.lat) && isNum(p.lon) && p.lat >= 36 && p.lat <= 43 && p.lon >= -11 && p.lon <= -5; // Portugal continental

/** Valida e normaliza o corpo recebido do cliente; devolve mensagem de erro ou o pedido */
export function parseRequest(body: unknown): RouteRequest | string {
  const b = body as any;
  if (!b || !okPoint(b.origin) || !okPoint(b.destination)) return "origin/destination inválidos (lat/lon em Portugal)";
  if (b.departureTime !== undefined && (typeof b.departureTime !== "string" || Number.isNaN(Date.parse(b.departureTime))))
    return "departureTime inválido (RFC 3339)";
  return { origin: b.origin, destination: b.destination, departureTime: b.departureTime };
}

export async function computeRoutes(req: RouteRequest, apiKey: string | undefined, fetchImpl: typeof fetch = fetch) {
  if (!apiKey) return { status: 503, body: { error: "GOOGLE_MAPS_API_KEY não configurada no servidor" } };
  const payload: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lon } } },
    destination: { location: { latLng: { latitude: req.destination.lat, longitude: req.destination.lon } } },
    travelMode: "TRANSIT",
    computeAlternativeRoutes: true,
    languageCode: "pt-PT",
  };
  if (req.departureTime) payload.departureTime = new Date(req.departureTime).toISOString();
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status === 429 ? 429 : 502, body: { error: "Erro da Routes API", upstream: res.status } };
  return { status: 200, body: JSON.parse(text) };
}
