/**
 * Restore NLSC's 1070205 village snapshot (村里界歷史圖資_106), whose coordinates were published
 * corrupt: every polygon lies in a ~6 m box near 118.7556°E 0.0002°N. The shapes and attributes
 * are intact and the distortion is linear, so an affine transform fitted on villages that did not
 * change between 1070205 and a later, sound snapshot (1071130) puts them back. This is our
 * correction, not NLSC's data as published: the fit is redone on every build and must stay within
 * a few metres, or the build fails.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error mapshaper ships no type declarations
import mapshaper from "mapshaper";
import type { ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";

/** Fit limits (metres) on the inliers, and how many matched villages must be inliers. */
export const RESTORE_LIMITS = { medianM: 2, p90M: 5, outlierM: 50, minInlierShare: 0.9 };
const M_PER_DEG = 111_000; // rough metres per degree, only for reporting residuals

export interface Affine {
  /** Centre and scale applied to the corrupt coordinates before the linear map (conditioning). */
  cx: number;
  cy: number;
  k: number;
  /** [lon, lat] = [a·x + b·y + c, d·x + e·y + f] with x, y = (coord − centre) · k. */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const applyAffine = (t: Affine, x: number, y: number): [number, number] => {
  const u = (x - t.cx) * t.k;
  const v = (y - t.cy) * t.k;
  return [t.a * u + t.b * v + t.c, t.d * u + t.e * v + t.f];
};

/** Least-squares affine from point pairs (pure; exported for tests). */
export function fitAffine(from: [number, number][], to: [number, number][]): Affine {
  const n = from.length;
  const cx = from.reduce((s, p) => s + p[0], 0) / n;
  const cy = from.reduce((s, p) => s + p[1], 0) / n;
  const spread = Math.max(...from.map((p) => Math.max(Math.abs(p[0] - cx), Math.abs(p[1] - cy)))) || 1;
  const k = 1 / spread;
  // Normal equations for [u v 1] → lon and → lat, solved by Gaussian elimination.
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const R = [[0, 0], [0, 0], [0, 0]];
  for (let i = 0; i < n; i++) {
    const f = [(from[i]![0] - cx) * k, (from[i]![1] - cy) * k, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) M[r]![c]! += f[r]! * f[c]!;
      R[r]![0]! += f[r]! * to[i]![0];
      R[r]![1]! += f[r]! * to[i]![1];
    }
  }
  const A = M.map((row, r) => [...row, ...R[r]!]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const q = A[r]![i]! / A[i]![i]!;
      A[r] = A[r]!.map((v, c) => v - q * A[i]![c]!);
    }
  }
  const sol = A.map((row, i) => [row[3]! / row[i]!, row[4]! / row[i]!]);
  return { cx, cy, k, a: sol[0]![0]!, b: sol[1]![0]!, c: sol[2]![0]!, d: sol[0]![1]!, e: sol[1]![1]!, f: sol[2]![1]! };
}

const residualM = (t: Affine, from: [number, number], to: [number, number]) => {
  const [x, y] = applyAffine(t, from[0], from[1]);
  return Math.hypot(x - to[0], y - to[1]) * M_PER_DEG;
};
const quantile = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

/**
 * Fit on villages with the same code and name in both snapshots, refitting once without the
 * pairs off by more than `outlierM` (villages whose boundaries really changed in 2018).
 */
export function fitRestore(pairs: { from: [number, number]; to: [number, number] }[]): { t: Affine; check: ValidationCheck } {
  let t = fitAffine(pairs.map((p) => p.from), pairs.map((p) => p.to));
  const inliers = pairs.filter((p) => residualM(t, p.from, p.to) <= RESTORE_LIMITS.outlierM);
  t = fitAffine(inliers.map((p) => p.from), inliers.map((p) => p.to));
  const res = inliers.map((p) => residualM(t, p.from, p.to)).sort((a, b) => a - b);
  const median = quantile(res, 0.5);
  const p90 = quantile(res, 0.9);
  const share = inliers.length / pairs.length;
  const ok = median <= RESTORE_LIMITS.medianM && p90 <= RESTORE_LIMITS.p90M && share >= RESTORE_LIMITS.minInlierShare;
  const detail = `affine fit on ${inliers.length} of ${pairs.length} unchanged villages (${(share * 100).toFixed(1)}%): centroid residual median ${median.toFixed(2)} m, p90 ${p90.toFixed(2)} m (limits ${RESTORE_LIMITS.medianM} / ${RESTORE_LIMITS.p90M} m)`;
  return { t, check: { id: "boundary-restore", status: ok ? "pass" : "fail", detail } };
}

async function centroids(shp: string, out: string): Promise<Map<string, { name: string; at: [number, number] }>> {
  await mapshaper.runCommands(`-i ${JSON.stringify(shp)} encoding=utf8 -each 'cx=this.centroidX, cy=this.centroidY' -filter-fields VILLCODE,VILLNAME,cx,cy -o ${JSON.stringify(out)} format=csv`);
  const m = new Map<string, { name: string; at: [number, number] }>();
  for (const [code, name, cx, cy] of parseCecCsv(readFileSync(out, "utf8"), { header: true, quotedCommas: true })) {
    if (/^\d{11}$/.test(code ?? "") && cx && cy) m.set(code!, { name: name ?? "", at: [Number(cx), Number(cy)] });
  }
  return m;
}

type Ring = [number, number][];
type Geom = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } | null;

/** Restored copy of `corrupt` as GeoJSON (same features and properties), fitted against `reference`. */
export async function restoreSnapshot(corrupt: string, reference: string, workDir: string): Promise<{ path: string; check: ValidationCheck }> {
  mkdirSync(workDir, { recursive: true });
  const [bad, good] = await Promise.all([centroids(corrupt, join(workDir, "corrupt-centroids.csv")), centroids(reference, join(workDir, "reference-centroids.csv"))]);
  const pairs = [...bad].flatMap(([code, v]) => {
    const g = good.get(code);
    return g && g.name === v.name ? [{ from: v.at, to: g.at }] : [];
  });
  const { t, check } = fitRestore(pairs);
  const raw = join(workDir, "corrupt.json");
  await mapshaper.runCommands(`-i ${JSON.stringify(corrupt)} encoding=utf8 -o ${JSON.stringify(raw)} format=geojson`);
  const fc = JSON.parse(readFileSync(raw, "utf8")) as { features: { geometry: Geom }[] };
  const fix = (r: Ring): Ring => r.map(([x, y]) => applyAffine(t, x, y));
  for (const f of fc.features) {
    if (f.geometry?.type === "Polygon") f.geometry.coordinates = f.geometry.coordinates.map(fix);
    else if (f.geometry?.type === "MultiPolygon") f.geometry.coordinates = f.geometry.coordinates.map((p) => p.map(fix));
  }
  const path = join(workDir, "restored.json");
  writeFileSync(path, JSON.stringify(fc));
  return { path, check };
}
