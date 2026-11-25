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
  { name: "連江縣", src: [119.85, 25.9, 120.6, 26.45], to: [120.3, 25.1], k: 1 },
  { name: "金門縣", src: [118.1, 24.1, 118.55, 24.6], to: [119.9, 24.3], k: 1 },
  { name: "金門縣烏坵", src: [119.4, 24.97, 119.5, 25.01], to: [120.3, 24.52], k: 1 },
  { name: "東沙島", src: [116.7, 20.68, 116.75, 20.72], to: [120, 22.6], k: 1 },
  { name: "太平島", src: [114.35, 10.365, 114.38, 10.39], to: [120, 22.3], k: 1 },
  { name: "釣魚臺列嶼", src: [123.45, 25.7, 123.7, 25.95], to: [122.1, 24.6], k: 1 },
  { name: "釣魚臺列嶼(赤尾嶼)", src: [124.55, 25.91, 124.57, 25.94], to: [122.1, 24.9], k: 1 },
  { name: "花瓶嶼", src: [121.945, 25.423, 121.947, 25.425], to: [121.88, 25.2], k: 1 },
  { name: "彭佳嶼、棉花嶼", src: [122.06, 25.48, 122.11, 25.64], to: [122.03, 25.2], k: 1 },
];

/** Default view: Taiwan, 澎湖, 彭佳嶼 and the insets. Panning and zooming out stay inside LOCK. */
export const VIEW_BOUNDS: [[number, number], [number, number]] = [[119.25, 21.85], [122.3, 25.4]];
export const LOCK_BOUNDS: [[number, number], [number, number]] = [[117, 21.65], [124.3, 25.6]];

type Ring = number[][];
const centre = (b: Inset["src"]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (ring: Ring, b: Inset["src"]) => ring.every(([x, y]) => x! >= b[0] && x! <= b[2] && y! >= b[1] && y! <= b[3]);

function moveRing(ring: Ring, used?: Set<string>): Ring {
  const inset = INSETS.find((i) => inside(ring, i.src));
  if (!inset) return ring;
  used?.add(inset.name);
  const [cx, cy] = centre(inset.src);
  return ring.map(([x, y]) => [inset.to[0] + (x! - cx) * inset.k, inset.to[1] + (y! - cy) * inset.k]);
}

/** Copy of a FeatureCollection with island rings moved into their insets; `used` collects the insets that got shapes. */
export function applyInsets(fc: FeatureCollection, used?: Set<string>): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const g = f.geometry as { type: string; coordinates: unknown } | null;
      if (!g) return f;
      // A polygon moves as a whole when its outer ring lies inside a source box.
      const poly = (p: Ring[]) => {
        const moved = moveRing(p[0]!, used);
        return moved === p[0] ? p : [moved, ...p.slice(1).map((r) => moveRing(r))];
      };
      if (g.type === "Polygon") return { ...f, geometry: { ...g, coordinates: poly(g.coordinates as Ring[]) } };
      if (g.type === "MultiPolygon") return { ...f, geometry: { ...g, coordinates: (g.coordinates as Ring[][]).map(poly) } };
      return f;
    }),
  } as FeatureCollection;
}

/** Frame rectangles (lon/lat) around each inset (only those in `names`, if given), with some padding. */
export function insetFrames(names?: Set<string>): { name: string; box: [number, number, number, number] }[] {
  return INSETS.filter((i) => !names || names.has(i.name)).map((i) => {
    const hw = ((i.src[2] - i.src[0]) / 2) * i.k + 0.05;
    const hh = ((i.src[3] - i.src[1]) / 2) * i.k + 0.05;
    return { name: i.name, box: [i.to[0] - hw, i.to[1] - hh, i.to[0] + hw, i.to[1] + hh] };
  });
}
