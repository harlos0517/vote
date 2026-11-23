/**
 * Far-off islands drawn as framed insets in a column east of Taiwan (問題 1), so the default view can
 * stay tight around the main island. 澎湖 stays in place. Only the drawing moves: every polygon
 * ring lying inside an island's source box is scaled and shifted into its frame, so hover, click
 * and colours keep working on the same features.
 */
import type { FeatureCollection } from "@tw-election/data-client";

export interface Inset {
  name: string;
  /** Source box [minLon, minLat, maxLon, maxLat]: rings fully inside are moved. */
  src: [number, number, number, number];
  /** Where the source box's centre goes, and the scale factor. */
  to: [number, number];
  k: number;
}

export const INSETS: Inset[] = [
  { name: "連江縣", src: [119.85, 25.9, 120.6, 26.45], to: [122.72, 24.8], k: 0.7 },
  { name: "金門縣", src: [118.1, 24.1, 118.55, 24.6], to: [122.72, 24.2], k: 0.9 },
  { name: "東沙島", src: [116.66, 20.66, 116.79, 20.74], to: [122.72, 23.6], k: 3 },
  { name: "太平島", src: [114.35, 10.365, 114.38, 10.39], to: [122.72, 23.1], k: 10 },
  { name: "釣魚臺列嶼", src: [123.4, 25.65, 124.65, 26.0], to: [122.72, 25.3], k: 0.35 },
];

/** Default view: Taiwan, 澎湖, 彭佳嶼 and the insets. Panning and zooming out stay inside LOCK. */
export const VIEW_BOUNDS: [[number, number], [number, number]] = [[119.25, 21.85], [123.25, 25.7]];
export const LOCK_BOUNDS: [[number, number], [number, number]] = [[118.3, 21.0], [124.2, 26.4]];

type Ring = number[][];
const centre = (b: Inset["src"]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (ring: Ring, b: Inset["src"]) => ring.every(([x, y]) => x! >= b[0] && x! <= b[2] && y! >= b[1] && y! <= b[3]);

function moveRing(ring: Ring): Ring {
  const inset = INSETS.find((i) => inside(ring, i.src));
  if (!inset) return ring;
  const [cx, cy] = centre(inset.src);
  return ring.map(([x, y]) => [inset.to[0] + (x! - cx) * inset.k, inset.to[1] + (y! - cy) * inset.k]);
}

/** Copy of a FeatureCollection with island rings moved into their insets. */
export function applyInsets(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const g = f.geometry as { type: string; coordinates: unknown } | null;
      if (!g) return f;
      // A polygon moves as a whole when its outer ring lies inside a source box.
      const poly = (p: Ring[]) => {
        const moved = moveRing(p[0]!);
        return moved === p[0] ? p : [moved, ...p.slice(1).map(moveRing)];
      };
      if (g.type === "Polygon") return { ...f, geometry: { ...g, coordinates: poly(g.coordinates as Ring[]) } };
      if (g.type === "MultiPolygon") return { ...f, geometry: { ...g, coordinates: (g.coordinates as Ring[][]).map(poly) } };
      return f;
    }),
  } as FeatureCollection;
}

/** Frame rectangles (lon/lat) around each inset, with some padding. */
export function insetFrames(): { name: string; box: [number, number, number, number] }[] {
  return INSETS.map((i) => {
    const hw = ((i.src[2] - i.src[0]) / 2) * i.k + 0.05;
    const hh = ((i.src[3] - i.src[1]) / 2) * i.k + 0.05;
    return { name: i.name, box: [i.to[0] - hw, i.to[1] - hh, i.to[0] + hw, i.to[1] + hh] };
  });
}
