import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";

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
  onStop: (id: string) => void;
  onMapClick: (lat: number, lon: number) => void;
}

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const empty = { type: "FeatureCollection", features: [] } as const;

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

export function MapView({ shapes, stops, vehicles, marks, fitKey, onStop, onMapClick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const cb = useRef({ onStop, onMapClick });
  cb.current = { onStop, onMapClick };
  const latest = useRef({ shapes, stops, vehicles, marks });
  latest.current = { shapes, stops, vehicles, marks };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      center: [-9.1, 38.75],
      zoom: 9.5,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
    m.on("load", () => {
      m.addImage("arrow", arrowImage());
      for (const s of ["shapes", "stops", "vehicles", "trails", "marks"]) m.addSource(s, { type: "geojson", data: empty as never });
      m.addLayer({ id: "shapes", type: "line", source: "shapes", filter: ["!", ["get", "dash"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.75 } });
      m.addLayer({ id: "shapes-dash", type: "line", source: "shapes", filter: ["get", "dash"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "stops", type: "circle", source: "stops", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7], "circle-color": "#fff", "circle-stroke-color": "#333", "circle-stroke-width": 2 } });
      m.addLayer({ id: "stops-label", type: "symbol", source: "stops", minzoom: 14.5, layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true, "text-font": ["Open Sans Semibold"] }, paint: { "text-halo-color": "#fff", "text-halo-width": 1.5 } });
      m.addLayer({ id: "trails", type: "circle", source: "trails", paint: { "circle-radius": 2.5, "circle-color": ["get", "color"], "circle-opacity": ["get", "o"] } });
      m.addLayer({ id: "vehicles", type: "circle", source: "vehicles", paint: { "circle-radius": 13, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.addLayer({ id: "vehicles-arrow", type: "symbol", source: "vehicles", layout: { "icon-image": "arrow", "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": 0.8 } });
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
      push();
    });
    const tags = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>();
    function syncTags(vehicles: MapVehicle[]) {
      const seen = new Set<string>();
      for (const v of vehicles) {
        seen.add(v.id);
        let t = tags.get(v.id);
        if (!t) {
          const el = document.createElement("div");
          t = { el, marker: new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [9, -9] }).setLngLat([v.lon, v.lat]).addTo(m) };
          tags.set(v.id, t);
        }
        const age = Math.max(0, Math.round((Date.now() - v.receivedAt) / 1000));
        t.el.className = "tag" + (age > 60 ? " stale" : "");
        t.el.style.setProperty("--c", v.color);
        const esc = (x: string) => x.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
        t.el.innerHTML = `<b>${esc(v.label)}</b> ▸ ${esc(v.dest)}<br>${v.speedKmh != null ? Math.round(v.speedKmh) : "–"} km/h · ${Math.round(v.bearing)}° · ${age}s`;
        t.marker.setLngLat([v.lon, v.lat]);
      }
      for (const [id, t] of tags) if (!seen.has(id)) (t.marker.remove(), tags.delete(id));
      el.current?.classList.toggle("dense", vehicles.length > 6 && m.getZoom() < 12.5);
    }
    m.on("zoomend", () => latest.current && syncTags(latest.current.vehicles));
    function push() {
      const { shapes, stops, vehicles, marks } = latest.current;
      const set = (id: string, features: unknown[]) => (m.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features } as never);
      set("shapes", shapes.map((s) => ({ type: "Feature", properties: { color: s.color, dash: s.dash }, geometry: { type: "LineString", coordinates: s.coords } })));
      set("stops", stops.map((s) => ({ type: "Feature", properties: { id: s.id, name: s.name }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })));
      set("vehicles", vehicles.map((v) => ({ type: "Feature", properties: { color: v.color, bearing: v.bearing }, geometry: { type: "Point", coordinates: [v.lon, v.lat] } })));
      set("trails", vehicles.flatMap((v) => v.trail.map((c, i) => ({ type: "Feature", properties: { color: v.color, o: (i + 1) / (v.trail.length + 1) * 0.7 }, geometry: { type: "Point", coordinates: c } }))));
      syncTags(vehicles);
      set("marks", [
        marks.origin && { type: "Feature", properties: { color: "#2e7d32" }, geometry: { type: "Point", coordinates: marks.origin } },
        marks.destination && { type: "Feature", properties: { color: "#1565c0" }, geometry: { type: "Point", coordinates: marks.destination } },
      ].filter(Boolean));
    }
    (m as unknown as { _push: () => void })._push = push;
    return () => m.remove();
  }, []);

  useEffect(() => {
    if (ready.current) (map.current as unknown as { _push: () => void })._push();
  }, [shapes, stops, vehicles, marks]);

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
