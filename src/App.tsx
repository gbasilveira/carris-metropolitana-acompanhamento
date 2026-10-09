import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OptionsDialog } from "./OptionsDialog.tsx";
import { loadOptions, resolveAppearance, saveOptions, type Options } from "./lib/options.ts";
import { MapView, type MapShape, type MapStop, type MapVehicle } from "./MapView.tsx";
import { getAlerts, getArrivals, getLines, getPattern, getShape, getStops, getVehicles, googleRoutes, lisbonDate } from "./lib/api.ts";
import { buildGeometry, estimateEta, formatEta, SpeedTracker, type PatternGeometry } from "./lib/eta.ts";
import { loadFavorites, saveFavorites, toggle, type Favorites } from "./lib/favorites.ts";
import { mergeOptions, newId, optionsFromRoutes, searchTimes, tripLineIds, tripPatternIds, type Group, type Trip, type TripOption } from "./lib/trips.ts";
import { stripAgency, type Alert, type Arrival, type HubVehicle, type Line, type Pattern, type Stop } from "./lib/types.ts";

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
  const [view, setView] = useState<"min" | "split" | "panel" | "map">("split");
  const setMin = (m: boolean) => setView((v) => (m ? "min" : v === "panel" ? v : "split"));
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
  const [options, setOptions] = useState<Options>(loadOptions);
  const [showOptions, setShowOptions] = useState(false);
  const [hiddenTags, setHiddenTags] = useState(0);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = resolveAppearance(options.appearance, systemDark);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#ffffff" : theme === "radar" ? "#07121a" : "#121826");
    saveOptions(options);
  }, [theme, options]);
  const [favs, setFavs] = useState<Favorites>(loadFavorites);
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
    const t = setInterval(tick, options.pollSeconds * 1000);
    return () => ((stop = true), ctl.abort(), clearInterval(t));
  }, [followedKey, options.pollSeconds]);

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

  const ensureLine = async (line: Line) => {
    if (!followed.some((l) => l.id === line.id)) await toggleLine(line);
  };
  const followTrip = async (t: { options: TripOption[] }) => {
    const ids = new Set(t.options.flatMap((o) => o.legs.map((l) => l.lineId)));
    await Promise.all(
      t.options.flatMap((o) => o.legs).flatMap((leg) => {
        const line = lines.find((l) => l.id === leg.lineId);
        return line ? leg.patternIds.map((pid) => followPattern(line, pid)) : [];
      }),
    );
    if (ids.size) setFitKey("trip" + Date.now());
  };
  const followGroup = (g: Group) => Promise.all(g.lineIds.map((id) => lines.find((l) => l.id === id)).filter(Boolean).map((l) => ensureLine(l as Line)));

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
      <MapView shapes={mapShapes} stops={mapStops} vehicles={mapVehicles} marks={{ origin: gOrigin, destination: gDest }} fitKey={fitKey} options={options} theme={theme} onStop={openStop} onMapClick={onMapClick} onHiddenTags={setHiddenTags} />
      {followed.length > 0 && (
        <div className="topbar">
          <span className={`dot${newestAge > 60 ? " old" : ""}`} />
          {vehicles.length} veículos · dado mais recente há {newestAge} s{hiddenTags > 0 ? ` · ${hiddenTags} etiquetas ocultas` : ""}{oldestAge > 120 ? ` (mais antigo ${oldestAge} s)` : ""}
        </div>
      )}
      {view === "map" && (
        <>
          <button className="fab sm" aria-label="Opções" onClick={() => setShowOptions(true)}>⚙</button>
          <button className="fab" aria-label="Mostrar painel" onClick={() => setView("split")}>☰</button>
        </>
      )}
      {showOptions && <OptionsDialog options={options} onChange={setOptions} onClose={() => setShowOptions(false)} />}
      <div className={`sheet ${view}`}>
        <div className="sheet-head">
          <button className="grab" aria-label="Expandir/recolher" onClick={() => setView(view === "min" ? "split" : "min")} />
          <button className="ibtn l1" aria-label="Opções" onClick={() => setShowOptions(true)}>⚙</button>
          <button className="ibtn r1" aria-label={view === "panel" ? "Reduzir painel" : "Painel em ecrã inteiro"} onClick={() => setView(view === "panel" ? "split" : "panel")}>{view === "panel" ? "⤓" : "⤢"}</button>
          <button className="ibtn r2" aria-label="Mapa em ecrã inteiro" onClick={() => setView("map")}>🗺</button>
        </div>
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
            <LinesPanel groups={favs.groups} saveGroup={(name) => setFavs((f) => ({ ...f, groups: [...f.groups, { id: newId(), name, lineIds: followed.map((l) => l.id) }] }))} lines={lines} query={query} setQuery={setQuery} sel={sel} followed={followed} available={available} favs={favs.lines} toggleLine={toggleLine} togglePattern={togglePattern}
              toggleFav={(id) => setFavs((f) => ({ ...f, lines: toggle(f.lines, id) }))} />
          )}
          {tab === "paragem" && (
            <StopPanel stop={stopId ? stopById.get(stopId) : undefined} sel={sel} vehicles={vehicles} tracker={tracker.current} now={now} fav={!!stopId && favs.stops.includes(stopId)}
              toggleFav={() => stopId && setFavs((f) => ({ ...f, stops: toggle(f.stops, stopId) }))} />
          )}
          {tab === "alertas" && <AlertsPanel alerts={alerts} sel={sel} />}
          {tab === "favoritos" && (
            <FavsPanel lines={lines} stopById={stopById} favs={favs} setFavs={setFavs} followed={followed} sel={sel} openLine={toggleLine} openStop={openStop} followTrip={followTrip} followGroup={followGroup} unfollow={removePattern} />
          )}
          {tab === "google" && (
            <GooglePanel lines={lines} stops={stops} gPick={gPick} setGPick={(p) => (setGPick(p), p && setMin(true))} gOrigin={gOrigin} gDest={gDest}
              sel={sel} stopById={stopById} categories={favs.categories} setFavs={setFavs} follow={followPattern} unfollow={removePattern} followTrip={followTrip} />
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
  groups: Group[]; saveGroup: (name: string) => void;
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
      {p.followed.length > 1 && <SaveGroup onSave={p.saveGroup} />}
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

function SaveGroup({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      <input style={{ margin: 0 }} placeholder="Guardar linhas seguidas como grupo…" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn" disabled={!name.trim()} onClick={() => (onSave(name.trim()), setName(""))}>Guardar</button>
    </div>
  );
}

function OptionView({ option, lines, stopById, sel, onFollow, onUnfollow, showDepartures }: {
  option: TripOption; lines: Line[]; stopById: Map<string, Stop>; sel: Sel[]; onFollow: () => void; onUnfollow: () => void; showDepartures: boolean;
}) {
  const on = option.legs.every((l) => l.patternIds.every((p) => sel.some((s) => s.pattern.id === p)));
  const first = option.legs[0];
  const [deps, setDeps] = useState<number[] | null>(null);
  useEffect(() => {
    if (!showDepartures) return;
    let live = true;
    getArrivals(first.boardStopId, lisbonDate())
      .then((a) => {
        if (!live) return;
        const nowS = Date.now() / 1000;
        const ids = new Set(first.patternIds);
        setDeps(a.filter((x) => ids.has(stripAgency(x.pattern_id)) && x.scheduled_arrival_unix >= nowS).map((x) => x.scheduled_arrival_unix).sort((x, y) => x - y).slice(0, 4));
      })
      .catch(() => live && setDeps([]));
    return () => { live = false; };
  }, [showDepartures, first.boardStopId, first.patternIds.join()]);
  return (
    <div className="opt">
      {option.legs.map((leg, i) => {
        const line = lines.find((l) => l.id === leg.lineId);
        return (
          <div className="row" key={i} style={{ borderBottom: 0 }}>
            {line ? <Badge line={line} /> : <span className="badge">{leg.lineId}</span>}
            <div className="grow">{stopById.get(leg.boardStopId)?.long_name ?? leg.boardStopId} → {stopById.get(leg.alightStopId)?.long_name ?? leg.alightStopId}</div>
          </div>
        );
      })}
      {option.partial && <div className="mut">Inclui outros operadores (só se segue a parte Carris).</div>}
      {showDepartures && (
        <div className="mut">
          {deps === null ? "A obter horários…" : deps.length ? `Próximas partidas (previstas): ${deps.map(fmtTime).join(" · ")}` : "Sem mais partidas previstas hoje neste percurso."}
        </div>
      )}
      <button className={`btn${on ? " sec" : ""}`} style={{ marginTop: 4 }} onClick={on ? onUnfollow : onFollow}>{on ? "A seguir ✓" : "Seguir esta opção"}</button>
    </div>
  );
}

function TripCard({ trip, lines, stopById, sel, onFollowAll, onFollow, onUnfollow, onDelete, onCategory, categories }: {
  trip: Trip; lines: Line[]; stopById: Map<string, Stop>; sel: Sel[]; categories: string[];
  onFollowAll: () => void; onFollow: (o: TripOption) => void; onUnfollow: (o: TripOption) => void; onDelete: () => void; onCategory: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--bd)", padding: "6px 0" }}>
      <div className="row" style={{ borderBottom: 0 }}>
        <div className="grow" onClick={() => setOpen(!open)}>
          <b>{trip.name}</b>
          <div className="mut">{trip.options.length} opç{trip.options.length === 1 ? "ão" : "ões"} · {trip.time ? `partida ${trip.time}` : "todas as horas"} · {tripLineIds(trip).join(", ")}</div>
        </div>
        <button className="btn" onClick={onFollowAll}>Seguir</button>
      </div>
      {open && (
        <>
          {trip.options.map((o, i) => (
            <OptionView key={i} option={o} lines={lines} stopById={stopById} sel={sel} showDepartures onFollow={() => onFollow(o)} onUnfollow={() => onUnfollow(o)} />
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <select style={{ margin: 0 }} value={trip.category} onChange={(e) => onCategory(e.target.value)} aria-label="Categoria">
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn sec" onClick={() => confirm(`Apagar “${trip.name}”?`) && onDelete()}>Apagar</button>
          </div>
        </>
      )}
    </div>
  );
}

function FavsPanel({ lines, stopById, favs, setFavs, followed, sel, openLine, openStop, followTrip, followGroup, unfollow }: {
  lines: Line[]; stopById: Map<string, Stop>; favs: Favorites; setFavs: (f: (f: Favorites) => Favorites) => void; followed: Line[]; sel: Sel[];
  openLine: (l: Line) => void; openStop: (id: string) => void; followTrip: (t: { options: TripOption[] }) => void; followGroup: (g: Group) => void; unfollow: (patternId: string) => void;
}) {
  const fl = lines.filter((l) => favs.lines.includes(l.id));
  const fs = favs.stops.map((id) => stopById.get(id)).filter(Boolean) as Stop[];
  const [newGroup, setNewGroup] = useState("");
  const [addTo, setAddTo] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const tripsBy = (c: string) => favs.trips.filter((t) => t.category === c);
  const cats = [...new Set([...favs.categories, ...favs.trips.map((t) => t.category)])];
  const upd = (t: Trip) => setFavs((f) => ({ ...f, trips: f.trips.map((x) => (x.id === t.id ? t : x)) }));
  const pats = (o: TripOption) => o.legs.flatMap((l) => l.patternIds);

  return (
    <>
      <h4>Viagens</h4>
      {favs.trips.length === 0 && <p className="mut">Sem viagens guardadas. Faça uma pesquisa em “Viagem” e toque em “Guardar viagem”.</p>}
      {cats.map((c) => tripsBy(c).length > 0 && (
        <div key={c}>
          <div className="mut" style={{ textTransform: "uppercase", letterSpacing: ".04em", marginTop: 6 }}>{c}</div>
          {tripsBy(c).map((t) => (
            <TripCard key={t.id} trip={t} lines={lines} stopById={stopById} sel={sel} categories={cats}
              onFollowAll={() => followTrip(t)} onFollow={(o) => followTrip({ options: [o] })}
              onUnfollow={(o) => pats(o).forEach(unfollow)}
              onDelete={() => setFavs((f) => ({ ...f, trips: f.trips.filter((x) => x.id !== t.id) }))}
              onCategory={(cat) => upd({ ...t, category: cat })} />
          ))}
        </div>
      ))}
      <button className="btn sec" style={{ marginTop: 6 }} onClick={() => {
        const n = prompt("Nome da nova categoria de percursos");
        if (n?.trim()) setFavs((f) => ({ ...f, categories: [...new Set([...f.categories, n.trim()])] }));
      }}>+ Categoria</button>

      <h4>Grupos de carreiras</h4>
      {favs.groups.map((g) => (
        <div key={g.id} style={{ borderBottom: "1px solid var(--bd)", padding: "6px 0" }}>
          <div className="row" style={{ borderBottom: 0 }}>
            <div className="grow"><b>{g.name}</b>
              <div className="line-chips">
                {g.lineIds.map((id) => {
                  const l = lines.find((x) => x.id === id);
                  return l ? (
                    <span className="chip" key={id}><Badge line={l} /><button aria-label="Remover linha do grupo" onClick={() => setFavs((f) => ({ ...f, groups: f.groups.map((x) => (x.id === g.id ? { ...x, lineIds: x.lineIds.filter((y) => y !== id) } : x)) }))}>✕</button></span>
                  ) : null;
                })}
              </div>
            </div>
            <button className="btn" onClick={() => followGroup(g)}>Seguir</button>
            <button className="star" aria-label="Apagar grupo" onClick={() => confirm(`Apagar o grupo “${g.name}”?`) && setFavs((f) => ({ ...f, groups: f.groups.filter((x) => x.id !== g.id) }))}>🗑</button>
          </div>
          {addTo === g.id ? (
            <>
              <input placeholder="Linha a adicionar" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
              {q.trim() && lines.filter((l) => l.short_name.startsWith(q.trim())).slice(0, 6).map((l) => (
                <div className="row" key={l.id} onClick={() => (setFavs((f) => ({ ...f, groups: f.groups.map((x) => (x.id === g.id && !x.lineIds.includes(l.id) ? { ...x, lineIds: [...x.lineIds, l.id] } : x)) })), setQ(""), setAddTo(null))}>
                  <Badge line={l} /><div className="grow">{l.long_name}</div>
                </div>
              ))}
            </>
          ) : <button className="btn sec" onClick={() => (setAddTo(g.id), setQ(""))}>+ Linha</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input style={{ margin: 0 }} placeholder="Novo grupo (vazio ou com as linhas seguidas)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        <button className="btn" disabled={!newGroup.trim()} onClick={() => (setFavs((f) => ({ ...f, groups: [...f.groups, { id: newId(), name: newGroup.trim(), lineIds: followed.map((l) => l.id) }] })), setNewGroup(""))}>Criar</button>
      </div>

      <h4>Linhas e paragens</h4>
      {!fl.length && !fs.length && <p className="mut">Toque em ★ numa linha ou paragem.</p>}
      {fl.map((l) => <div className="row" key={l.id} onClick={() => openLine(l)}><Badge line={l} /><div className="grow">{l.long_name}<div className="mut">{followed.some((f) => f.id === l.id) ? "A seguir ✓" : "Toque para seguir"}</div></div></div>)}
      {fs.map((s) => <div className="row" key={s.id} onClick={() => openStop(s.id)}><span>🚏</span><div className="grow">{s.long_name}<div className="mut">{s.id}</div></div></div>)}
    </>
  );
}

function GooglePanel({ lines, stops, gPick, setGPick, gOrigin, gDest, sel, stopById, categories, setFavs, follow, unfollow, followTrip }: {
  lines: Line[]; stops: Stop[]; gPick: "origin" | "destination" | null; setGPick: (p: "origin" | "destination" | null) => void;
  gOrigin?: [number, number]; gDest?: [number, number]; sel: Sel[]; stopById: Map<string, Stop>; categories: string[];
  setFavs: (f: (f: Favorites) => Favorites) => void;
  follow: (line: Line, patternId: string) => void; unfollow: (patternId: string) => void; followTrip: (t: { options: TripOption[] }) => void;
}) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [options, setOptions] = useState<TripOption[]>();
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "Outros");
  const [saved, setSaved] = useState(false);

  const search = async () => {
    if (!gOrigin || !gDest) return;
    setBusy(true); setErr(""); setOptions(undefined); setSaved(false);
    try {
      // sem hora: cobre o dia (5 horas num dia útil + domingo) para listar todas as opções válidas do percurso
      const times = when ? [new Date(when).toISOString()] : searchTimes();
      const settled = await Promise.allSettled(times.map((t) => googleRoutes({ lat: gOrigin[1], lon: gOrigin[0] }, { lat: gDest[1], lon: gDest[0] }, t)));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
      const cache = new Map<string, Promise<Pattern[]>>();
      const patternsFor = (line: Line) => {
        let p = cache.get(line.id);
        if (!p) (p = Promise.all(line.pattern_ids.map((id) => getPattern(id).catch(() => null))).then((r) => r.filter(Boolean) as Pattern[]), cache.set(line.id, p));
        return p;
      };
      const opts = (await Promise.all(ok.map((r) => optionsFromRoutes([r], lines, stops, patternsFor)))).reduce(mergeOptions, [] as TripOption[]);
      setOptions(opts);
      const f = opts[0]?.legs[0], l = opts[0]?.legs[opts[0].legs.length - 1];
      setName(f && l ? `${stopById.get(f.boardStopId)?.long_name ?? "Origem"} → ${stopById.get(l.alightStopId)?.long_name ?? "Destino"}` : "");
      if (!opts.length) setErr("Nenhuma opção totalmente identificável na rede Carris Metropolitana para este percurso.");
      else if (ok.length < times.length) setErr(`${times.length - ok.length} de ${times.length} pesquisas falharam; podem faltar opções.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!options || !gOrigin || !gDest) return;
    const hhmm = when ? when.slice(11, 16) : undefined;
    const trip: Trip = {
      id: newId(), name: name.trim() || "Viagem", category,
      origin: { lat: gOrigin[1], lon: gOrigin[0] }, destination: { lat: gDest[1], lon: gDest[0] },
      time: hhmm, options,
    };
    setFavs((f) => ({ ...f, trips: [...f.trips, trip] }));
    setSaved(true);
  };

  const lineOf = (id: string) => lines.find((l) => l.id === id);
  return (
    <>
      <div className="chips">
        <button className={`btn${gPick === "origin" ? "" : " sec"}`} onClick={() => setGPick(gPick === "origin" ? null : "origin")}>{gOrigin ? "Origem ✓" : "Origem no mapa"}</button>
        <button className={`btn${gPick === "destination" ? "" : " sec"}`} onClick={() => setGPick(gPick === "destination" ? null : "destination")}>{gDest ? "Destino ✓" : "Destino no mapa"}</button>
      </div>
      {gPick && <div className="warn">Toque no mapa para marcar a {gPick === "origin" ? "origem" : "destino"}.</div>}
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Partida (vazio = todas as horas)" />
      <div className="mut" style={{ marginBottom: 6 }}>{when ? "Uma pesquisa para essa hora." : "Sem hora: 6 pesquisas (várias horas do dia) para listar todas as opções válidas."}</div>
      <button className="btn" disabled={!gOrigin || !gDest || busy} onClick={search}>{busy ? "A pesquisar…" : "Procurar autocarros Carris"}</button>
      {err && <div className="err">{err}</div>}
      {options && options.length > 0 && (
        <>
          <h4>{options.length} opç{options.length === 1 ? "ão" : "ões"}</h4>
          {options.map((o, i) => (
            <OptionView key={i} option={o} lines={lines} stopById={stopById} sel={sel} showDepartures={false}
              onFollow={() => o.legs.forEach((l) => { const line = lineOf(l.lineId); if (line) l.patternIds.forEach((p) => follow(line, p)); })}
              onUnfollow={() => o.legs.forEach((l) => l.patternIds.forEach(unfollow))} />
          ))}
          <button className="btn sec" style={{ marginTop: 8 }} onClick={() => followTrip({ options })}>Seguir todas as opções</button>
          <h4>Guardar viagem</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da viagem" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn" disabled={saved} onClick={save}>{saved ? "Guardada ✓ (ver em ★)" : "Guardar viagem"}</button>
        </>
      )}
    </>
  );
}
