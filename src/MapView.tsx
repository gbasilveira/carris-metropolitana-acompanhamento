import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { placeLabels, type LabelReq } from "./lib/labels.ts";
import { detailLevels, type Options } from "./lib/options.ts";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface MapShape {
  id: string;
  color: string;
  /** sentido de volta: tracejado */
  dash: boolean;
  coords: [number, number][];
}
export interface MapStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
export interface MapVehicle {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
  color: string;
  label: string;
  dest: string;
  speedKmh: number | null;
  receivedAt: number;
  trail: [number, number][];
}

interface Props {
  shapes: MapShape[];
  stops: MapStop[];
  vehicles: MapVehicle[];
  marks: { origin?: [number, number]; destination?: [number, number] };
  fitKey: string;
  options: Options;
  theme: "light" | "dark" | "radar";
  onStop: (id: string) => void;
  onMapClick: (lat: number, lon: number) => void;
  onHiddenTags: (n: number) => void;
}

const empty = { type: "FeatureCollection", features: [] } as const;
const FONT = ["Open Sans Semibold"];

function arrowImage(): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(16, 4);
  g.lineTo(25, 22);
  g.lineTo(16, 18);
  g.lineTo(7, 22);
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, 32, 32);
}

/** Ajustes do mapa base por aspeto */
const RASTER: Record<Props["theme"], Record<string, number>> = {
  light: { "raster-brightness-max": 1, "raster-saturation": -0.15, "raster-contrast": 0, "raster-hue-rotate": 0, "raster-brightness-min": 0 },
  dark: { "raster-brightness-max": 0.42, "raster-saturation": -0.5, "raster-contrast": 0.1, "raster-hue-rotate": 0, "raster-brightness-min": 0 },
  radar: { "raster-brightness-max": 0.32, "raster-saturation": -0.85, "raster-contrast": 0.2, "raster-hue-rotate": 110, "raster-brightness-min": 0 },
};

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

interface Tag {
  marker: maplibregl.Marker;
  wrap: HTMLDivElement;
  card: HTMLDivElement;
  leader: HTMLDivElement;
}

export function MapView({ shapes, stops, vehicles, marks, fitKey, options, theme, onStop, onMapClick, onHiddenTags }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const api = useRef<{ push: () => void; relayout: () => void; theme: () => void } | null>(null);
  const cb = useRef({ onStop, onMapClick, onHiddenTags });
  cb.current = { onStop, onMapClick, onHiddenTags };
  const latest = useRef({ shapes, stops, vehicles, marks, options, theme });
  latest.current = { shapes, stops, vehicles, marks, options, theme };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      center: [-9.1, 38.75],
      zoom: 9.5,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");

    const tags = new Map<string, Tag>();

    const set = (id: string, features: unknown[]) =>
      (m.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features } as never);

    function applyTheme() {
      const t = latest.current.theme;
      for (const [k, v] of Object.entries(RASTER[t])) m.setPaintProperty("osm", k as "raster-opacity", v);
      const dark = t !== "light";
      m.setPaintProperty("stops", "circle-color", dark ? "#1c2530" : "#fff");
      m.setPaintProperty("stops", "circle-stroke-color", dark ? "#9fb3c8" : "#334155");
      m.setPaintProperty("stops-label", "text-color", dark ? "#dbe7f3" : "#1e293b");
      m.setPaintProperty("stops-label", "text-halo-color", dark ? "#0b1220" : "#fff");
    }

    /** Cria/atualiza o conteúdo das etiquetas e coloca-as sem sobreposição */
    function layoutTags() {
      const { vehicles, options } = latest.current;
      const levels = detailLevels(options.tagDetail);
      const seen = new Set<string>();
      if (levels.length) {
        for (const v of vehicles) {
          seen.add(v.id);
          let t = tags.get(v.id);
          if (!t) {
            const wrap = document.createElement("div");
            wrap.className = "tagwrap";
            const leader = document.createElement("div");
            leader.className = "leader";
            const card = document.createElement("div");
            card.className = "tag";
            wrap.append(leader, card);
            t = { wrap, card, leader, marker: new maplibregl.Marker({ element: wrap, anchor: "center" }).setLngLat([v.lon, v.lat]).addTo(m) };
            tags.set(v.id, t);
          }
          const age = Math.max(0, Math.round((Date.now() - v.receivedAt) / 1000));
          t.wrap.style.setProperty("--c", v.color);
          t.card.classList.toggle("stale", age > 60);
          const speed = v.speedKmh != null ? `${Math.round(v.speedKmh)} km/h` : "– km/h";
          t.card.innerHTML =
            `<span class="ln">${esc(v.label)}</span>` +
            `<span class="tx"><span class="dst">${esc(v.dest)}</span><span class="meta">${speed} · ${Math.round(v.bearing)}° · ${age}s</span></span>` +
            `<span class="sp">${speed}</span>`;
          t.marker.setLngLat([v.lon, v.lat]);
        }
      }
      for (const [id, t] of tags) if (!seen.has(id)) (t.marker.remove(), tags.delete(id));
      if (!levels.length) return cb.current.onHiddenTags(0);

      // medir cada nível de detalhe e colocar sem sobreposição (prioridade: dados frescos primeiro)
      const rect = el.current!.getBoundingClientRect();
      const ordered = [...vehicles].sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id));
      const reqs: LabelReq[] = [];
      for (const v of ordered) {
        const t = tags.get(v.id)!;
        t.wrap.style.display = "";
        t.wrap.style.visibility = "hidden";
        const sizes = levels.map((lv) => {
          t.card.dataset.level = lv;
          return { w: t.card.offsetWidth, h: t.card.offsetHeight };
        });
        const p = m.project([v.lon, v.lat]);
        reqs.push({ id: v.id, x: p.x, y: p.y, sizes });
      }
      const placed = placeLabels(reqs, { width: rect.width, height: rect.height });
      let hidden = 0;
      for (const r of reqs) {
        const t = tags.get(r.id)!;
        const pl = placed.get(r.id);
        if (!pl) {
          t.wrap.style.display = "none";
          if (r.x >= 0 && r.y >= 0 && r.x <= rect.width && r.y <= rect.height) hidden++; // só conta as que estão no ecrã
          continue;
        }
        t.card.dataset.level = levels[pl.level];
        t.marker.setOffset([pl.dx, pl.dy]);
        const len = Math.hypot(pl.dx, pl.dy);
        t.leader.style.cssText = `width:${len}px;transform:rotate(${Math.atan2(-pl.dy, -pl.dx)}rad)`;
        t.wrap.style.visibility = "visible";
      }
      cb.current.onHiddenTags(hidden);
    }

    function push() {
      const { shapes, stops, vehicles, marks, options } = latest.current;
      set("shapes", shapes.map((s) => ({ type: "Feature", properties: { color: s.color, dash: s.dash }, geometry: { type: "LineString", coordinates: s.coords } })));
      set("stops", stops.map((s) => ({ type: "Feature", properties: { id: s.id, name: s.name }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })));
      set("vehicles", vehicles.map((v) => ({ type: "Feature", properties: { color: v.color, bearing: v.bearing }, geometry: { type: "Point", coordinates: [v.lon, v.lat] } })));
      set("trails", options.trails ? vehicles.flatMap((v) => v.trail.map((c, i) => ({ type: "Feature", properties: { color: v.color, o: ((i + 1) / (v.trail.length + 1)) * 0.7 }, geometry: { type: "Point", coordinates: c } }))) : []);
      set("marks", [
        marks.origin && { type: "Feature", properties: { color: "#16a34a" }, geometry: { type: "Point", coordinates: marks.origin } },
        marks.destination && { type: "Feature", properties: { color: "#2563eb" }, geometry: { type: "Point", coordinates: marks.destination } },
      ].filter(Boolean));
      m.setLayoutProperty("stops-label", "visibility", options.stopNames ? "visible" : "none");
      layoutTags();
    }
    api.current = { push, relayout: layoutTags, theme: applyTheme };

    m.on("load", () => {
      m.addImage("arrow", arrowImage());
      for (const s of ["shapes", "stops", "vehicles", "trails", "marks"]) m.addSource(s, { type: "geojson", data: empty as never });
      m.addLayer({ id: "shapes", type: "line", source: "shapes", filter: ["!", ["get", "dash"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.8 } });
      m.addLayer({ id: "shapes-dash", type: "line", source: "shapes", filter: ["get", "dash"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "stops", type: "circle", source: "stops", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7], "circle-color": "#fff", "circle-stroke-color": "#334155", "circle-stroke-width": 2 } });
      m.addLayer({ id: "stops-label", type: "symbol", source: "stops", minzoom: 14.5, layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true, "text-font": FONT }, paint: { "text-halo-color": "#fff", "text-halo-width": 1.5, "text-color": "#1e293b" } });
      m.addLayer({ id: "trails", type: "circle", source: "trails", paint: { "circle-radius": 2.5, "circle-color": ["get", "color"], "circle-opacity": ["get", "o"] } });
      m.addLayer({ id: "vehicles", type: "circle", source: "vehicles", paint: { "circle-radius": 12, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5, "circle-blur": 0.05 } });
      m.addLayer({ id: "vehicles-arrow", type: "symbol", source: "vehicles", layout: { "icon-image": "arrow", "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": 0.75 } });
      m.addLayer({ id: "marks", type: "circle", source: "marks", paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
      m.on("click", "stops", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) cb.current.onStop(String(id));
      });
      m.on("click", (e) => {
        if (!m.queryRenderedFeatures(e.point, { layers: ["stops", "vehicles"] }).length) cb.current.onMapClick(e.lngLat.lat, e.lngLat.lng);
      });
      m.on("mouseenter", "stops", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "stops", () => (m.getCanvas().style.cursor = ""));
      ready.current = true;
      applyTheme();
      push();
    });
    // as etiquetas acompanham o mapa sozinhas ao deslocar; ao mudar o zoom/tamanho recalcula-se a colocação
    m.on("zoomend", () => ready.current && layoutTags());
    m.on("resize", () => ready.current && layoutTags());
    return () => m.remove();
  }, []);

  useEffect(() => {
    if (ready.current) api.current?.push();
  }, [shapes, stops, vehicles, marks, options.trails, options.stopNames, options.tagDetail]);

  useEffect(() => {
    if (ready.current) api.current?.theme();
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    const all = latest.current.shapes.flatMap((s) => s.coords);
    if (!m || !all.length) return;
    const b = new maplibregl.LngLatBounds(all[0], all[0]);
    for (const c of all) b.extend(c);
    m.fitBounds(b, { padding: { top: 60, left: 40, right: 40, bottom: 320 }, maxZoom: 15, duration: 600 });
  }, [fitKey]);

  return <div ref={el} className="map" />;
}
