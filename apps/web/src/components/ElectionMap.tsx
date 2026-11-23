import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 looks for its worker next to its own module URL, which breaks once Vite
// pre-bundles (dev) or bundles (build) the library. Ship the worker as a URL asset instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection } from "@tw-election/data-client";
import { NO_CANDIDATE, NO_DATA } from "../lib/colors.ts";
import { LOCK_BOUNDS, VIEW_BOUNDS, applyInsets, insetFrames } from "../lib/insets.ts";

maplibregl.setWorkerUrl(workerUrl);

const SRC = "units";
const DSRC = "districts";
const OSRC = "outline";

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
  /** Draw the white outline of every area (off at 村里 level, where ~7,900 outlines hide the colours). */
  borders?: boolean;
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

/**
 * 6×6 tile with a thin, faint "/" stripe: marks areas without a value (無資料, 該黨無候選人) so they
 * read as "nothing here" rather than as a colour on the scale. Opposite direction to the
 * unelected hatch, which is "\\" with a dark and a light stripe.
 */
function emptyImage(): { width: number; height: number; data: Uint8Array } {
  const n = 6;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if ((x + (n - 1 - y)) % n === 0) data.set([255, 255, 255, 110], (y * n + x) * 4);
    }
  }
  return { width: n, height: n, data };
}

export function ElectionMap(p: ElectionMapProps) {
  // Island rings moved into their insets (drawing only; codes, colours and events are unchanged).
  const { shapes, islands } = useMemo(() => {
    const used = new Set<string>();
    return { shapes: applyInsets(p.geo, used), islands: [...used].sort().join("|") };
  }, [p.geo]);
  const districtShapes = useMemo(() => (p.districts ? applyInsets(p.districts) : undefined), [p.districts]);
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
      bounds: VIEW_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      // Zoom in freely, but never pan or zoom out beyond Taiwan and the island insets.
      maxBounds: LOCK_BOUNDS,
      attributionControl: { compact: true, customAttribution: "圖資：內政部國土測繪中心（政府資料開放授權條款第1版）" },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addImage("hatch", hatchImage(), { pixelRatio: 1 });
      map.addImage("empty", emptyImage(), { pixelRatio: 1 });
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
    const map = mapRef.current;
    if (ready && map?.getLayer("units-line")) map.setLayoutProperty("units-line", "visibility", p.borders === false ? "none" : "visible");
  }, [ready, p.borders, p.geo]);

  useEffect(() => {
    if (ready) mapRef.current?.setPaintProperty("bg", "background-color", p.background);
  }, [ready, p.background]);

  // geometry + layers
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      src.setData(shapes as never);
      return;
    }
    map.addSource(SRC, { type: "geojson", data: shapes as never, promoteId: "code" });
    map.addLayer({
      id: "units-fill",
      type: "fill",
      source: SRC,
      paint: { "fill-color": ["coalesce", ["feature-state", "fill"], NO_DATA], "fill-opacity": 0.95 },
    });
    // No antialiasing: with thousands of small 村里 shapes, antialiased edges add up into light seams.
    map.addLayer({ id: "units-empty", type: "fill", source: SRC, filter: ["!", ["in", ["get", "code"], ["literal", []]]], paint: { "fill-pattern": "empty", "fill-antialias": false } });
    map.addLayer({ id: "units-hatch", type: "fill", source: SRC, filter: ["in", ["get", "code"], ["literal", []]], paint: { "fill-pattern": "hatch" } });
    map.addLayer({ id: "units-line", type: "line", source: SRC, layout: { visibility: p.borders === false ? "none" : "visible" }, paint: {
      "line-color": "#ffffff",
      // Fade borders when zoomed out so ~7,900 村里 outlines don't wash out the colours.
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.2, 10, 0.6],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.35, 9, 0.8],
    } });
    // Hover and lock outlines come from a tiny source holding just those one or two shapes.
    // Changing a filter or feature-state on the main source makes MapLibre re-evaluate every
    // shape (~7,900 at 村里), which made hovering lag.
    map.addSource(OSRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "units-hover", type: "line", source: OSRC, filter: ["==", ["get", "kind"], "hover"], paint: { "line-color": "#ffffff", "line-width": 2.5 } });
    map.addLayer({ id: "units-locked", type: "line", source: OSRC, filter: ["==", ["get", "kind"], "locked"], paint: { "line-color": "#ff3d7f", "line-width": 2.5 } });
  }, [ready, shapes]);

  // colours (feature-state; re-applied when geometry changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource(SRC)) return;
    for (const f of p.geo.features) {
      const code = f.properties.code!;
      map.setFeatureState({ source: SRC, id: code }, { fill: p.colors.get(code) ?? NO_DATA });
    }
  }, [ready, p.geo, p.colors]);

  // Empty-area pattern on everything without a value: no result at all, 無資料 or 該黨無候選人.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("units-empty")) return;
    const valued = [...p.colors].filter(([, c]) => c !== NO_DATA && c !== NO_CANDIDATE).map(([code]) => code);
    map.setFilter("units-empty", ["!", ["in", ["get", "code"], ["literal", valued]]]);
  }, [ready, p.geo, p.colors]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("units-hatch")) map.setFilter("units-hatch", ["in", ["get", "code"], ["literal", [...p.hatched]]]);
  }, [ready, p.geo, p.hatched]);

  // Hover / lock outlines: put just those shapes into the small outline source.
  const byCode = useMemo(() => new Map(shapes.features.map((f) => [f.properties.code!, f])), [shapes]);
  useEffect(() => {
    const src = mapRef.current?.getSource(OSRC) as GeoJSONSource | undefined;
    if (!ready || !src) return;
    const pick = (code: string | null, kind: string) => {
      const f = code ? byCode.get(code) : undefined;
      return f ? [{ ...f, properties: { kind } }] : [];
    };
    src.setData({ type: "FeatureCollection", features: [...pick(p.locked, "locked"), ...pick(p.hovered, "hover")] } as never);
  }, [ready, byCode, p.hovered, p.locked]);

  // Frames and names of the island insets that have shapes in this map (1071130 lacks 東沙島/太平島,
  // for example). The style has no glyphs, so names are DOM markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const frames = insetFrames(new Set(islands.split("|").filter(Boolean)));
    const data = {
      type: "FeatureCollection" as const,
      features: frames.map(({ box: [x0, y0, x1, y1] }) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] },
      })),
    };
    const src = map.getSource("insets") as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource("insets", { type: "geojson", data });
      map.addLayer({ id: "insets-frame", type: "line", source: "insets", paint: { "line-color": "#8a8f98", "line-width": 1, "line-dasharray": [3, 2] } });
    }
    const markers = frames.map(({ name, box }) => {
      const el = document.createElement("div");
      el.textContent = name;
      el.style.cssText = "font-size:10px;color:#6b7078;pointer-events:none;white-space:nowrap;transform:translateY(-100%);padding-bottom:1px";
      return new maplibregl.Marker({ element: el, anchor: "bottom-left" }).setLngLat([box[0], box[3]]).addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
  }, [ready, islands]);

  // district overlay (thin outlines always, strong outline for the highlighted district)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(DSRC) as GeoJSONSource | undefined;
    if (!districtShapes) {
      for (const id of ["districts-line", "districts-hl"]) if (map.getLayer(id)) map.removeLayer(id);
      if (src) map.removeSource(DSRC);
      return;
    }
    if (src) src.setData(districtShapes as never);
    else {
      map.addSource(DSRC, { type: "geojson", data: districtShapes as never, promoteId: "code" });
      map.addLayer({ id: "districts-line", type: "line", source: DSRC, paint: { "line-color": "#1a1a1a", "line-width": 1.1, "line-opacity": 0.7 } }, "units-hover");
      map.addLayer({ id: "districts-hl", type: "line", source: DSRC, paint: { "line-color": "#ffd400", "line-width": 3, "line-opacity": ["case", ["boolean", ["feature-state", "hl"], false], 1, 0] } }, "units-hover");
    }
  }, [ready, districtShapes, p.geo]);

  const highlighted = useRef<string[]>([]);
  const hlKey = p.highlightDistricts.join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource(DSRC)) return;
    for (const c of highlighted.current) map.setFeatureState({ source: DSRC, id: c }, { hl: false });
    for (const c of p.highlightDistricts) map.setFeatureState({ source: DSRC, id: c }, { hl: true });
    highlighted.current = p.highlightDistricts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, districtShapes, hlKey]);

  return <div ref={container} role="region" aria-label={p.ariaLabel} style={{ position: "absolute", inset: 0 }} />;
}
