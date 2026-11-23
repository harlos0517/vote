import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 looks for its worker next to its own module URL, which breaks once Vite
// pre-bundles (dev) or bundles (build) the library. Ship the worker as a URL asset instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection } from "@tw-election/data-client";
import { NO_DATA } from "../lib/colors.ts";

maplibregl.setWorkerUrl(workerUrl);

/** Taiwan, Penghu, Kinmen and Matsu. Pratas and Taiping lie outside this default view. */
const TAIWAN_BOUNDS: [[number, number], [number, number]] = [[118.1, 21.85], [122.05, 26.4]];
const SRC = "units";
const DSRC = "districts";

export interface ElectionMapProps {
  geo: FeatureCollection;
  colors: Map<string, string>;
  /** Units drawn with diagonal hatching (e.g. local top candidate who was not elected). */
  hatched: Set<string>;
  hovered: string | null;
  locked: string | null;
  /** Electoral-district outlines drawn over finer levels (towns), if the group has districts. */
  districts?: FeatureCollection;
  /** District codes to outline strongly (the hovered / locked unit's district). */
  highlightDistricts: string[];
  background: string;
  onHover: (code: string | null) => void;
  /** Click on a unit (code) or on empty map (null). */
  onClick: (code: string | null) => void;
  ariaLabel: string;
}

/** 8×8 tile with a dark and a light diagonal stripe, visible over any fill colour. */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const n = 8;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = (x + y) % n;
      const o = (y * n + x) * 4;
      if (d === 0) data.set([255, 255, 255, 230], o);
      else if (d === 1) data.set([20, 20, 20, 200], o);
    }
  }
  return { width: n, height: n, data };
}

export function ElectionMap(p: ElectionMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onHover: p.onHover, onClick: p.onClick });
  cb.current = { onHover: p.onHover, onClick: p.onClick };

  // init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": p.background } }],
      },
      bounds: TAIWAN_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      attributionControl: { compact: true, customAttribution: "圖資：內政部國土測繪中心（政府資料開放授權條款第1版）" },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addImage("hatch", hatchImage(), { pixelRatio: 1 });
      setReady(true);
    });
    let hovered: string | null = null;
    map.on("mousemove", "units-fill", (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      const code = f ? String(f.id) : null;
      map.getCanvas().style.cursor = code ? "pointer" : "";
      if (code !== hovered) {
        hovered = code;
        cb.current.onHover(code);
      }
    });
    map.on("mouseleave", "units-fill", () => {
      map.getCanvas().style.cursor = "";
      hovered = null;
      cb.current.onHover(null);
    });
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: map.getLayer("units-fill") ? ["units-fill"] : [] })[0];
      cb.current.onClick(f ? String(f.id) : null);
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map; // dev diagnostics
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) mapRef.current?.setPaintProperty("bg", "background-color", p.background);
  }, [ready, p.background]);

  // geometry + layers
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      src.setData(p.geo as never);
      return;
    }
    map.addSource(SRC, { type: "geojson", data: p.geo as never, promoteId: "code" });
    map.addLayer({
      id: "units-fill",
      type: "fill",
      source: SRC,
      paint: { "fill-color": ["coalesce", ["feature-state", "fill"], NO_DATA], "fill-opacity": 0.95 },
    });
    map.addLayer({ id: "units-hatch", type: "fill", source: SRC, filter: ["in", ["get", "code"], ["literal", []]], paint: { "fill-pattern": "hatch" } });
    map.addLayer({ id: "units-line", type: "line", source: SRC, paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.8 } });
    map.addLayer({
      id: "units-hover",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "code"], ""],
      paint: { "line-color": "#ffffff", "line-width": 2.5 },
    });
    map.addLayer({
      id: "units-locked",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "code"], ""],
      paint: { "line-color": "#ff3d7f", "line-width": 2.5 },
    });
  }, [ready, p.geo]);

  // colours (feature-state; re-applied when geometry changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource(SRC)) return;
    for (const f of p.geo.features) {
      const code = f.properties.code!;
      map.setFeatureState({ source: SRC, id: code }, { fill: p.colors.get(code) ?? NO_DATA });
    }
  }, [ready, p.geo, p.colors]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("units-hatch")) map.setFilter("units-hatch", ["in", ["get", "code"], ["literal", [...p.hatched]]]);
  }, [ready, p.geo, p.hatched]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("units-hover")) return;
    map.setFilter("units-hover", ["==", ["get", "code"], p.hovered ?? ""]);
    map.setFilter("units-locked", ["==", ["get", "code"], p.locked ?? ""]);
  }, [ready, p.geo, p.hovered, p.locked]);

  // district overlay (thin outlines always, strong outline for the highlighted district)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(DSRC) as GeoJSONSource | undefined;
    if (!p.districts) {
      for (const id of ["districts-line", "districts-hl"]) if (map.getLayer(id)) map.removeLayer(id);
      if (src) map.removeSource(DSRC);
      return;
    }
    if (src) src.setData(p.districts as never);
    else {
      map.addSource(DSRC, { type: "geojson", data: p.districts as never });
      map.addLayer({ id: "districts-line", type: "line", source: DSRC, paint: { "line-color": "#1a1a1a", "line-width": 1.1, "line-opacity": 0.7 } }, "units-hover");
      map.addLayer({ id: "districts-hl", type: "line", source: DSRC, filter: ["in", ["get", "code"], ["literal", []]], paint: { "line-color": "#ffd400", "line-width": 3 } }, "units-hover");
    }
  }, [ready, p.districts, p.geo]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("districts-hl")) map.setFilter("districts-hl", ["in", ["get", "code"], ["literal", p.highlightDistricts]]);
  }, [ready, p.districts, p.highlightDistricts]);

  return <div ref={container} role="region" aria-label={p.ariaLabel} style={{ position: "absolute", inset: 0 }} />;
}
