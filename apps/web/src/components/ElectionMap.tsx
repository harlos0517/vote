import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 looks for its worker next to its own module URL, which breaks once Vite
// pre-bundles (dev) or bundles (build) the library. Ship the worker as a URL asset instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);
import type { FeatureCollection } from "@tw-election/data-client";
import { NO_DATA } from "../lib/colors.ts";

/** Taiwan, Penghu, Kinmen and Matsu. Pratas and Taiping lie outside this default view. */
const TAIWAN_BOUNDS: [[number, number], [number, number]] = [[118.1, 21.85], [122.05, 26.4]];
const SRC = "units";

export interface ElectionMapProps {
  geo: FeatureCollection;
  colors: Map<string, string>;
  selected: string | null;
  background: string;
  /** Plain-text tooltip lines for a feature code (rendered as text, never HTML). */
  tooltip: (code: string, name: string) => string[];
  onSelect: (code: string | null) => void;
  ariaLabel: string;
}

export function ElectionMap({ geo, colors, selected, background, tooltip, onSelect, ariaLabel }: ElectionMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ tooltip, onSelect });
  cb.current = { tooltip, onSelect };

  // init once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": background } }],
      },
      bounds: TAIWAN_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      attributionControl: { compact: true, customAttribution: "圖資：內政部國土測繪中心（政府資料開放授權條款第1版）" },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 8 });
    let hovered: string | number | undefined;
    const setHover = (id: string | number | undefined) => {
      if (hovered !== undefined) map.setFeatureState({ source: SRC, id: hovered }, { hover: false });
      hovered = id;
      if (id !== undefined) map.setFeatureState({ source: SRC, id }, { hover: true });
    };
    map.on("load", () => setReady(true));
    map.on("mousemove", "units-fill", (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      setHover(f.id);
      const el = document.createElement("div");
      for (const [i, line] of cb.current.tooltip(String(f.id), String(f.properties.name ?? "")).entries()) {
        const p = document.createElement(i === 0 ? "strong" : "div");
        p.textContent = line;
        el.appendChild(p);
      }
      popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    });
    map.on("mouseleave", "units-fill", () => {
      map.getCanvas().style.cursor = "";
      setHover(undefined);
      popup.remove();
    });
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: map.getLayer("units-fill") ? ["units-fill"] : [] })[0];
      cb.current.onSelect(f ? String(f.id) : null);
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map; // dev diagnostics
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) mapRef.current?.setPaintProperty("bg", "background-color", background);
  }, [ready, background]);

  // geometry
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(geo as never);
    else {
      map.addSource(SRC, { type: "geojson", data: geo as never, promoteId: "code" });
      map.addLayer({
        id: "units-fill",
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": ["coalesce", ["feature-state", "fill"], NO_DATA],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.75, 0.92],
        },
      });
      map.addLayer({
        id: "units-line",
        type: "line",
        source: SRC,
        paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "units-selected",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "code"], ""],
        paint: { "line-color": "#111111", "line-width": 2.2 },
      });
    }
  }, [ready, geo]);

  // colours (re-applied when geometry changes because feature-state is per source data)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource(SRC)) return;
    for (const f of geo.features) {
      const code = f.properties.code!;
      map.setFeatureState({ source: SRC, id: code }, { fill: colors.get(code) ?? NO_DATA });
    }
  }, [ready, geo, colors]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("units-selected")) map.setFilter("units-selected", ["==", ["get", "code"], selected ?? ""]);
  }, [ready, geo, selected]);

  return <div ref={container} role="region" aria-label={ariaLabel} style={{ position: "absolute", inset: 0 }} />;
}
