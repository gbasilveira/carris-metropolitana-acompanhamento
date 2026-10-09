import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView, type MapShape, type MapStop, type MapVehicle } from "./MapView.tsx";
import { getAlerts, getArrivals, getLines, getPattern, getShape, getStops, getVehicles, googleRoutes, lisbonDate } from "./lib/api.ts";
import { buildGeometry, estimateEta, formatEta, SpeedTracker, type PatternGeometry } from "./lib/eta.ts";
import { loadFavorites, saveFavorites, toggle } from "./lib/favorites.ts";
import { carrisSteps, matchLeg, type LegMatch } from "./lib/match.ts";
import { stripAgency, type Alert, type Arrival, type HubVehicle, type Line, type Pattern, type Stop } from "./lib/types.ts";

const POLL_MS = 7000;
type Tab = "linhas" | "paragem" | "alertas" | "favoritos" | "google";
interface Sel {
  line: Line;
  pattern: Pattern;
  geom: PatternGeometry;
  /** cor única por linha seguida (os dois sentidos partilham a cor; o de volta é tracejado) */
  color: string;
  dash: boolean;
}

const PALETTE = ["#e6194b", "#1e88e5", "#2e9d3f", "#f58231", "#8e24aa", "#00a3a3", "#c79100", "#d81b9a", "#6d4c41", "#546e7a"];

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
const txt = (t?: { translation: { text: string }[] }) => t?.translation?.[0]?.text ?? "";

export function App() {
  const [tab, setTab] = useState<Tab>("linhas");
  const [min, setMin] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Sel[]>([]);
  const [followed, setFollowed] = useState<Line[]>([]);
  const [available, setAvailable] = useState<Record<string, Pattern[]>>({});
  const colors = useRef(new Map<string, string>());
  const trails = useRef(new Map<string, [number, number][]>());
  const [fitKey, setFitKey] = useState("");
  const [vehicles, setVehicles] = useState<HubVehicle[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [favs, setFavs] = useState(loadFavorites);
  const [stopId, setStopId] = useState<string | null>(null);
  const tracker = useRef(new SpeedTracker());

  useEffect(() => {
    Promise.all([getLines(), getStops()]).then(([l, s]) => (setLines(l), setStops(s))).catch((e) => setLoadErr(String(e)));
    getAlerts().then(setAlerts).catch(() => {});
  }, []);
  useEffect(() => saveFavorites(favs), [favs]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const selKey = sel.map((s) => s.pattern.id).join(",");

  // Polling das posições: todos os veículos das linhas seguidas (qualquer padrão/sentido), enquanto a página está visível
  const followedKey = followed.map((l) => l.short_name).join(",");
  useEffect(() => {
    if (!followed.length) return setVehicles([]);
    const names = new Set(followed.map((l) => l.short_name));
    const ctl = new AbortController();
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const all = await getVehicles(ctl.signal);
        if (stop) return;
        const mine = all.filter((v) => v.route_short_name && names.has(v.route_short_name));
        for (const v of mine) {
          tracker.current.add(v.vehicle_id, v.received_at, v.speed);
          const tr = trails.current.get(v.vehicle_id) ?? [];
          const last = tr[tr.length - 1];
          if (!last || last[0] !== v.longitude || last[1] !== v.latitude) tr.push([v.longitude, v.latitude]);
          trails.current.set(v.vehicle_id, tr.slice(-7));
        }
        for (const id of trails.current.keys()) if (!mine.some((v) => v.vehicle_id === id)) trails.current.delete(id);
        setVehicles(mine);
        setFetchedAt(Date.now());
      } catch {
        /* mantém últimos dados; a idade mostra o atraso */
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => ((stop = true), ctl.abort(), clearInterval(t));
  }, [followedKey]);

  const colorFor = (lineId: string) => {
    let c = colors.current.get(lineId);
    if (!c) (c = PALETTE[colors.current.size % PALETTE.length], colors.current.set(lineId, c));
    return c;
  };

  const addPattern = useCallback(async (line: Line, pattern: Pattern, fit = true) => {
    const shape = await getShape(pattern.shape_id);
    const geom = buildGeometry(pattern, shape);
    const color = colorFor(line.id);
    setSel((s) => [...s.filter((x) => x.pattern.id !== pattern.id), { line, pattern, geom, color, dash: pattern.direction_id === 1 }]);
    if (fit) setFitKey(pattern.id + Date.now());
  }, []);
  const removePattern = (patternId: string) => setSel((s) => s.filter((x) => x.pattern.id !== patternId));

  /** Carrega todos os padrões da linha; por omissão mostra um por sentido (ambos os sentidos em simultâneo). */
  const loadPatterns = async (line: Line) => {
    const all = (await Promise.all(line.pattern_ids.map((id) => getPattern(id).catch(() => null)))).filter(Boolean) as Pattern[];
    setAvailable((a) => ({ ...a, [line.id]: all }));
    setFollowed((f) => (f.some((l) => l.id === line.id) ? f : [...f, line]));
    return all;
  };

  const toggleLine = async (line: Line) => {
    if (followed.some((l) => l.id === line.id)) {
      setFollowed((f) => f.filter((l) => l.id !== line.id));
      return setSel((s) => s.filter((x) => x.line.id !== line.id));
    }
    try {
      const all = await loadPatterns(line);
      const byDir = new Map<number, Pattern>();
      for (const p of all) if (!byDir.has(p.direction_id)) byDir.set(p.direction_id, p);
      await Promise.all([...byDir.values()].map((p) => addPattern(line, p, false)));
      setFitKey(line.id + Date.now());
    } catch (e) {
      setLoadErr(`Não foi possível carregar a linha ${line.short_name}: ${e}`);
    }
  };
  const togglePattern = (line: Line, p: Pattern) =>
    sel.some((s) => s.pattern.id === p.id) ? removePattern(p.id) : addPattern(line, p);

  /** Usado pela pesquisa Google: segue um padrão concreto sem tirar os outros */
  const followPattern = async (line: Line, patternId: string) => {
    try {
      const all = available[line.id] ?? (await loadPatterns(line));
      const p = all.find((x) => x.id === patternId) ?? (await getPattern(patternId));
      setFollowed((f) => (f.some((l) => l.id === line.id) ? f : [...f, line]));
      if (!sel.some((s) => s.pattern.id === p.id)) await addPattern(line, p);
    } catch (e) {
      setLoadErr(String(e));
    }
  };

  const mapShapes: MapShape[] = useMemo(() => sel.map((s) => ({ id: s.pattern.id, color: s.color, dash: s.dash, coords: s.geom.coords })), [selKey]);
  const mapStops: MapStop[] = useMemo(() => {
    const seen = new Set<string>();
    const out: MapStop[] = [];
    for (const s of sel) for (const p of s.pattern.path) {
      const st = stopById.get(p.stop_id);
      if (st && !seen.has(st.id)) (seen.add(st.id), out.push({ id: st.id, name: st.long_name, lat: st.lat, lon: st.lon }));
    }
    return out;
  }, [selKey, stopById]);
  const mapVehicles: MapVehicle[] = useMemo(
    () =>
      vehicles.map((v) => {
        const line = followed.find((l) => l.short_name === v.route_short_name);
        const pid = v.pattern_id ? stripAgency(v.pattern_id) : "";
        const pat = (line && available[line.id]?.find((p) => p.id === pid)) || sel.find((x) => x.pattern.id === pid)?.pattern;
        return {
          id: v.vehicle_id, lat: v.latitude, lon: v.longitude, bearing: v.bearing ?? 0,
          color: (line && colors.current.get(line.id)) ?? "#555", label: v.route_short_name ?? "", dest: pat?.headsign ?? "",
          speedKmh: v.speed, receivedAt: v.received_at, trail: (trails.current.get(v.vehicle_id) ?? []).slice(0, -1),
        };
      }),
    [vehicles, followedKey, available, selKey],
  );
  const oldestAge = vehicles.length ? Math.round((now - Math.min(...vehicles.map((v) => v.received_at))) / 1000) : 0;
  const newestAge = vehicles.length ? Math.round((now - Math.max(...vehicles.map((v) => v.received_at))) / 1000) : 0;

  // Google: origem/destino escolhidos no mapa
  const [gPick, setGPick] = useState<"origin" | "destination" | null>(null);
  const [gOrigin, setGOrigin] = useState<[number, number]>();
  const [gDest, setGDest] = useState<[number, number]>();
  const onMapClick = (lat: number, lon: number) => {
    if (!gPick) return;
    (gPick === "origin" ? setGOrigin : setGDest)([lon, lat]);
    setGPick(null);
    setMin(false);
  };

  const openStop = (id: string) => (setStopId(id), setTab("paragem"), setMin(false));

  return (
    <>
      <MapView shapes={mapShapes} stops={mapStops} vehicles={mapVehicles} marks={{ origin: gOrigin, destination: gDest }} fitKey={fitKey} onStop={openStop} onMapClick={onMapClick} />
      {followed.length > 0 && (
        <div className="topbar">
          <span className={`dot${newestAge > 60 ? " old" : ""}`} />
          {vehicles.length} veículos · dado mais recente há {newestAge} s{oldestAge > 120 ? ` (mais antigo ${oldestAge} s)` : ""}
        </div>
      )}
      <div className={`sheet${min ? " min" : ""}`}>
        <button className="grab" aria-label="Expandir/recolher" onClick={() => setMin(!min)} />
        <div className="tabs">
          {(["linhas", "paragem", "alertas", "favoritos", "google"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => (setTab(t), setMin(false))}>
              {{ linhas: "Linhas", paragem: "Paragem", alertas: "Alertas", favoritos: "★", google: "Viagem" }[t]}
            </button>
          ))}
        </div>
        <div className="body">
          {loadErr && <div className="err">{loadErr}</div>}
          {tab === "linhas" && (
            <LinesPanel lines={lines} query={query} setQuery={setQuery} sel={sel} followed={followed} available={available} favs={favs.lines} toggleLine={toggleLine} togglePattern={togglePattern}
              toggleFav={(id) => setFavs((f) => ({ ...f, lines: toggle(f.lines, id) }))} />
          )}
          {tab === "paragem" && (
            <StopPanel stop={stopId ? stopById.get(stopId) : undefined} sel={sel} vehicles={vehicles} tracker={tracker.current} now={now} fav={!!stopId && favs.stops.includes(stopId)}
              toggleFav={() => stopId && setFavs((f) => ({ ...f, stops: toggle(f.stops, stopId) }))} />
          )}
          {tab === "alertas" && <AlertsPanel alerts={alerts} sel={sel} />}
          {tab === "favoritos" && (
            <FavsPanel lines={lines} stopById={stopById} favs={favs} followed={followed} openLine={toggleLine} openStop={openStop} />
          )}
          {tab === "google" && (
            <GooglePanel lines={lines} stops={stops} gPick={gPick} setGPick={(p) => (setGPick(p), p && setMin(true))} gOrigin={gOrigin} gDest={gDest}
              sel={sel} follow={followPattern} unfollow={removePattern} />
          )}
        </div>
      </div>
    </>
  );
}

function Badge({ line }: { line: Line }) {
  return <span className="badge" style={{ background: line.color, color: line.text_color }}>{line.short_name}</span>;
}

function LinesPanel(p: {
  lines: Line[]; query: string; setQuery: (q: string) => void; sel: Sel[]; followed: Line[]; available: Record<string, Pattern[]>; favs: string[];
  toggleLine: (l: Line) => void; togglePattern: (l: Line, pattern: Pattern) => void; toggleFav: (id: string) => void;
}) {
  const q = p.query.trim().toLowerCase();
  const results = q ? p.lines.filter((l) => l.short_name.toLowerCase().startsWith(q) || l.long_name.toLowerCase().includes(q)).slice(0, 30) : [];
  const isFollowed = (l: Line) => p.followed.some((f) => f.id === l.id);
  return (
    <>
      {p.followed.map((line) => {
        const color = p.sel.find((s) => s.line.id === line.id)?.color ?? "#777";
        return (
          <div key={line.id} style={{ marginBottom: 6 }}>
            <div className="row" style={{ borderBottom: 0, paddingBottom: 0 }}>
              <span className="badge" style={{ background: color, color: "#fff" }}>{line.short_name}</span>
              <div className="grow mut">{line.long_name}</div>
              <button className="star" aria-label="Deixar de seguir" onClick={() => p.toggleLine(line)}>✕</button>
            </div>
            <div className="line-chips">
              {(p.available[line.id] ?? []).map((pt) => {
                const on = p.sel.some((s) => s.pattern.id === pt.id);
                return (
                  <button key={pt.id} className={`pchip${on ? " on" : ""}${pt.direction_id === 1 ? " dash" : ""}`} style={on ? { background: color } : undefined} onClick={() => p.togglePattern(line, pt)}>
                    {pt.direction_id === 0 ? "→" : "←"} {pt.headsign}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <input placeholder="Procurar linha (nº ou localidade)" value={p.query} onChange={(e) => p.setQuery(e.target.value)} inputMode="search" />
      {results.map((l) => (
        <div className="row" key={l.id}>
          <Badge line={l} />
          <div className="grow" onClick={() => p.toggleLine(l)}>{l.long_name}<div className="mut">{isFollowed(l) ? "A seguir ✓ (toque para deixar)" : "Toque para seguir (ambos os sentidos)"}</div></div>
          <button className={`star${p.favs.includes(l.id) ? " on" : ""}`} aria-label="Favorito" onClick={() => p.toggleFav(l.id)}>★</button>
        </div>
      ))}
      {!q && !p.followed.length && <p className="mut">Escolha uma ou mais linhas: aparecem os dois sentidos e todos os autocarros em simultâneo (sentido de volta a tracejado).</p>}
    </>
  );
}

function StopPanel({ stop, sel, vehicles, tracker, now, fav, toggleFav }: {
  stop?: Stop; sel: Sel[]; vehicles: HubVehicle[]; tracker: SpeedTracker; now: number; fav: boolean; toggleFav: () => void;
}) {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setArrivals([]); setErr("");
    if (!stop) return;
    getArrivals(stop.id, lisbonDate()).then(setArrivals).catch((e) => setErr(String(e)));
  }, [stop?.id]);
  if (!stop) return <p className="mut">Toque numa paragem no mapa (aparecem as das linhas escolhidas).</p>;

  const ownEtas = sel.flatMap((s) =>
    vehicles.filter((v) => v.pattern_id && stripAgency(v.pattern_id) === s.pattern.id).flatMap((v) => {
      const e = estimateEta(s.geom, stop.id, { lat: v.latitude, lon: v.longitude, receivedAt: v.received_at }, tracker.average(v.vehicle_id, now), now);
      return e && !e.passed && e.offsetM < 300 ? [{ s, v, e }] : [];
    }),
  ).sort((a, b) => a.e.seconds! - b.e.seconds!);

  const nowS = now / 1000;
  const upcoming = arrivals.filter((a) => a.scheduled_arrival_unix >= nowS - 300).sort((a, b) => a.scheduled_arrival_unix - b.scheduled_arrival_unix).slice(0, 12);
  const lineColor = (id: string) => sel.find((s) => s.line.id === id)?.line.color ?? "#777";

  return (
    <>
      <div className="row">
        <div className="grow"><b>{stop.long_name}</b><div className="mut">Paragem {stop.id}</div></div>
        <button className={`star${fav ? " on" : ""}`} onClick={toggleFav} aria-label="Favorito">★</button>
      </div>
      <h4>Próximos veículos (estimativa nossa)</h4>
      {ownEtas.length === 0 && <p className="mut">Sem veículos a caminho entre as linhas escolhidas. Escolha a linha no separador “Linhas”.</p>}
      {ownEtas.map(({ s, v, e }) => (
        <div className="row" key={v.vehicle_id}>
          <Badge line={s.line} />
          <div className="grow">{s.pattern.headsign}<div className="mut">estimativa · {(e.remainingM / 1000).toFixed(1)} km · dado com {Math.round(e.ageS)} s · {Math.round(e.speedMs * 3.6)} km/h médios</div></div>
          <span className="eta">{formatEta(e.seconds!)}</span>
        </div>
      ))}
      <h4>Horários previstos</h4>
      {err && <div className="err">Não foi possível obter os horários ({err}).</div>}
      {upcoming.map((a, i) => (
        <div className="row" key={i}>
          <span className="badge" style={{ background: lineColor(a.line_id), color: "#fff" }}>{a.line_id}</span>
          <div className="grow">{a.headsign}<div className="mut">previsto (horário)</div></div>
          <span className="eta">{fmtTime(a.scheduled_arrival_unix)}</span>
        </div>
      ))}
    </>
  );
}

function AlertsPanel({ alerts, sel }: { alerts: Alert[]; sel: Sel[] }) {
  const nowS = Date.now() / 1000;
  const active = alerts.filter((a) => a.active_period.some((p) => p.start <= nowS && (!p.end || p.end >= nowS)));
  const mine = new Set(sel.map((s) => stripAgency(s.pattern.route_id ?? s.line.id)));
  const rel = (a: Alert) => a.informed_entity.some((e) => e.route_id && mine.has(stripAgency(e.route_id)));
  const list = [...active].sort((a, b) => Number(rel(b)) - Number(rel(a)));
  return (
    <>
      {list.length === 0 && <p className="mut">Sem alertas ativos.</p>}
      {list.slice(0, 40).map((a, i) => (
        <div className="row" key={i}>
          <div className="grow"><b>{txt(a.header_text)}</b>{rel(a) && " · nas suas linhas"}<div className="mut" style={{ whiteSpace: "pre-line" }}>{txt(a.description_text)}</div></div>
        </div>
      ))}
    </>
  );
}

function FavsPanel({ lines, stopById, favs, followed, openLine, openStop }: {
  lines: Line[]; stopById: Map<string, Stop>; favs: { lines: string[]; stops: string[] }; followed: Line[]; openLine: (l: Line) => void; openStop: (id: string) => void;
}) {
  const fl = lines.filter((l) => favs.lines.includes(l.id));
  const fs = favs.stops.map((id) => stopById.get(id)).filter(Boolean) as Stop[];
  if (!fl.length && !fs.length) return <p className="mut">Sem favoritos. Toque em ★ numa linha ou paragem.</p>;
  return (
    <>
      {fl.map((l) => <div className="row" key={l.id} onClick={() => openLine(l)}><Badge line={l} /><div className="grow">{l.long_name}<div className="mut">{followed.some((f) => f.id === l.id) ? "A seguir ✓" : "Toque para seguir"}</div></div></div>)}
      {fs.map((s) => <div className="row" key={s.id} onClick={() => openStop(s.id)}><span>🚏</span><div className="grow">{s.long_name}<div className="mut">{s.id}</div></div></div>)}
    </>
  );
}

function GooglePanel({ lines, stops, gPick, setGPick, gOrigin, gDest, sel, follow, unfollow }: {
  lines: Line[]; stops: Stop[]; gPick: "origin" | "destination" | null; setGPick: (p: "origin" | "destination" | null) => void;
  gOrigin?: [number, number]; gDest?: [number, number]; sel: Sel[]; follow: (line: Line, patternId: string) => void; unfollow: (patternId: string) => void;
}) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [matches, setMatches] = useState<LegMatch[]>();

  const search = async () => {
    if (!gOrigin || !gDest) return;
    setBusy(true); setErr(""); setMatches(undefined);
    try {
      const res = await googleRoutes({ lat: gOrigin[1], lon: gOrigin[0] }, { lat: gDest[1], lon: gDest[0] }, when ? new Date(when).toISOString() : undefined);
      const out: LegMatch[] = [];
      const seen = new Set<string>();
      for (const r of res.routes ?? []) for (const st of carrisSteps(r)) {
        const line = lines.find((l) => l.short_name === st.transitDetails.transitLine.nameShort);
        if (!line) continue;
        const pats = (await Promise.all(line.pattern_ids.map((id) => getPattern(id).catch(() => null)))).filter(Boolean) as Pattern[];
        const m = matchLeg(st, lines, stops, pats);
        const key = line.id + m.candidates.map((c) => c.pattern_id).join();
        if (!seen.has(key)) (seen.add(key), out.push(m));
      }
      setMatches(out);
      if (!out.length) setErr("Nenhum troço da Carris Metropolitana nas rotas devolvidas pelo Google.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="chips">
        <button className={`btn${gPick === "origin" ? "" : " sec"}`} onClick={() => setGPick(gPick === "origin" ? null : "origin")}>{gOrigin ? "Origem ✓" : "Origem no mapa"}</button>
        <button className={`btn${gPick === "destination" ? "" : " sec"}`} onClick={() => setGPick(gPick === "destination" ? null : "destination")}>{gDest ? "Destino ✓" : "Destino no mapa"}</button>
      </div>
      {gPick && <div className="warn">Toque no mapa para marcar a {gPick === "origin" ? "origem" : "destino"}.</div>}
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Partida (vazio = agora)" />
      <button className="btn" disabled={!gOrigin || !gDest || busy} onClick={search}>{busy ? "A pesquisar…" : "Procurar autocarros Carris"}</button>
      {err && <div className="err">{err}</div>}
      {matches?.map((m, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div className="row">
            {m.line && <Badge line={m.line} />}
            <div className="grow">{m.step.transitDetails.stopDetails.departureStop.name} → {m.step.transitDetails.stopDetails.arrivalStop.name}<div className="mut">Google: “{m.step.transitDetails.headsign}”</div></div>
          </div>
          {m.candidates.length === 0 && <div className="warn">Não foi possível identificar o sentido na rede Carris; escolha a linha manualmente em “Linhas”.</div>}
          {m.ambiguous && <div className="warn">Vários percursos possíveis — escolha o correto:</div>}
          {m.candidates.map((c, j) => {
            const on = sel.some((s) => s.pattern.id === c.pattern_id);
            return (
              <div className="row" key={c.pattern_id}>
                <div className="grow">{c.headsign}{j === 0 && !m.ambiguous ? " (mais provável)" : ""}</div>
                <button className={`btn${on ? " sec" : ""}`} onClick={() => (on ? unfollow(c.pattern_id) : m.line && follow(m.line, c.pattern_id))}>{on ? "A seguir ✓" : "Seguir"}</button>
              </div>
            );
          })}
          {m.candidates.length > 1 && <button className="btn sec" onClick={() => m.line && m.candidates.forEach((c) => follow(m.line!, c.pattern_id))}>Seguir todas as opções</button>}
        </div>
      ))}
    </>
  );
}
