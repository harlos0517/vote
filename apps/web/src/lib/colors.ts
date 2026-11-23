/**
 * Colour scales. Every stepped bin is exactly one whole step (5, 10 or 20 points),
 * so legend labels are exact; continuous scales use the same snapped domain so
 * switching between the two never changes the range the colours cover.
 */
import { interpolateLab } from "d3-interpolate";
import { interpolateInferno } from "d3-scale-chromatic";

export const NO_DATA = "#444444";
/** Referendum: green = 同意, red = 不同意; colour-blind-safe alternative blue / orange. */
export const REF_COLORS = {
  normal: { agree: "#1a9850", disagree: "#d73027" },
  colorblind: { agree: "#2166ac", disagree: "#e66101" },
} as const;
export const TIE = "#c8b98c"; // 當選 view: tied for the most seats / votes (khaki: no party uses it)
export const NO_CANDIDATE = "#cccccc"; // share view: the party ran no candidate here
export const NEUTRAL = "#aaaaaa"; // independents / parties without a recorded colour
export const INVALID_COLOR = "#888888";
export const ABSTAIN_COLOR = "#666666";
/** Fallback hues by ballot order for choices without a party colour (avoid blue/green). */
export const FALLBACK_PALETTE = ["#CC79A7", "#E69F00", "#6F6F6F", "#D55E00", "#F0E442", "#882255", "#AA7744"];
/** Generic ends for the two-party map if a party has no recorded colour. */
export const DEFAULT_KMT = "#1f4e9e";
export const DEFAULT_DPP = "#1b9431";

export type ScaleKind = "continuous" | "stepped";

export type LegendSpec =
  | { type: "stepped"; items: { color: string; label: string }[]; zero?: { color: string; label: string } }
  | { type: "continuous"; gradient: string; ticks: { at: number; label: string }[]; zero?: { color: string; label: string } };

export interface ColorScale {
  color: (v: number) => string;
  /** Position in [0, 1] (sequential) or [-1, 1] (diverging) after binning — used for shading. */
  t: (v: number) => number;
  legend: LegendSpec;
}

/** Bin widths in percentage points, smallest first; fractional ones serve fixed tops like 1% or 5%. */
const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50] as const;
/** Round away float noise (0.30000000000000004 → 0.3). */
const clean = (x: number) => Math.round(x * 1e6) / 1e6;

/** Snap [min, max] (fractions) outward to whole steps, choosing the smallest step with ≤ maxBins bins. */
export function snapDomain(min: number, max: number, maxBins: number): { lo: number; hi: number; stepPt: number } {
  for (const stepPt of STEPS) {
    const lo = clean(Math.floor(clean(min * 100) / stepPt + 1e-9) * stepPt);
    let hi = clean(Math.ceil(clean(max * 100) / stepPt - 1e-9) * stepPt);
    if (hi <= lo) hi = clean(lo + stepPt);
    if ((hi - lo) / stepPt <= maxBins + 1e-9) return { lo, hi, stepPt };
  }
  return { lo: Math.floor(min * 100), hi: Math.ceil(max * 100), stepPt: Math.ceil((max - min) * 100) || 1 };
}

const pct = (pt: number) => `${clean(pt)}%`;

/** Linear-interpolated quantile of a non-empty array. */
export function quantile(xs: number[], q: number): number {
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const i = Math.floor(pos);
  return a[i]! + (a[Math.min(i + 1, a.length - 1)]! - a[i]!) * (pos - i);
}

/** Legend top chosen by the viewer: null = 自動 (fit the data), else a fraction (0.5 = 50%). */
export type ScaleMax = number | null;

/** Non-zero values start this far up the ramp, so a true 0% stays distinguishable from "almost 0". */
export const ZERO_GAP = 0.05;

/**
 * Sequential, always from 0%: low → high; interp(0) is reserved for exactly 0. The top is `max`
 * when the viewer fixes one, else the 97.5th percentile (snapped to whole steps) so a few
 * outliers don't wash out the map; values above take the end colour and the legend reads ≥.
 */
export function sequentialScale(values: number[], interp: (t: number) => string, kind: ScaleKind, max: ScaleMax = null): ColorScale {
  const finite = values.filter(Number.isFinite);
  const top = max ?? (finite.length ? quantile(finite, 0.975) : 1);
  const { lo, hi, stepPt } = snapDomain(0, Math.max(top, 0.0001), 8);
  const openHi = finite.length > 0 && Math.max(...finite) * 100 > hi + 1e-9;
  const bins = Math.round((hi - lo) / stepPt);
  const linT = (v: number) => Math.min(1, Math.max(0, (v * 100 - lo) / (hi - lo)));
  const binT = (v: number) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v * 100 - lo) / stepPt + 1e-9)));
    return bins === 1 ? 1 : b / (bins - 1);
  };
  const raw = kind === "stepped" ? binT : linT;
  const lift = (x: number) => ZERO_GAP + (1 - ZERO_GAP) * x;
  const t = (v: number) => (v === 0 ? 0 : lift(raw(v)));
  const binLabel = (b: number) => {
    const a = clean(lo + b * stepPt);
    if (b === bins - 1 && openHi) return `≥ ${pct(a)}`;
    return `${b === 0 ? "> " : ""}${pct(a)}–${pct(a + stepPt)}`;
  };
  const zero = { color: interp(0), label: "0%" };
  const legend: LegendSpec =
    kind === "stepped"
      ? {
          type: "stepped",
          items: Array.from({ length: bins }, (_, i) => bins - 1 - i).map((b) => ({
            color: interp(lift(bins === 1 ? 1 : b / (bins - 1))),
            label: binLabel(b),
          })),
          zero,
        }
      : {
          type: "continuous",
          gradient: `linear-gradient(to top, ${Array.from({ length: 11 }, (_, i) => `${interp(lift(i / 10))} ${i * 10}%`).join(", ")})`,
          ticks: [
            { at: 0, label: `> ${pct(lo)}` },
            { at: 0.5, label: pct((lo + hi) / 2) },
            { at: 1, label: `${openHi ? "≥ " : ""}${pct(hi)}` },
          ],
          zero,
        };
  return { color: (v) => interp(t(v)), t, legend };
}

/**
 * Diverging around 0 (fractions in [-1, 1]): negative → `neg`, 0 → black, positive → `pos`.
 * Symmetric: equal distances from 0 get equal strength. Its size is `max` when fixed, else the
 * 95th percentile of |value| (snapped), so a few landslide areas don't turn the rest black;
 * beyond it values take the end colour and the legend ends read ≥.
 */
export function divergingScale(
  values: number[],
  neg: string,
  pos: string,
  kind: ScaleKind,
  label: (pt: number) => string,
  max: ScaleMax = null,
): ColorScale {
  const finite = values.filter(Number.isFinite);
  const abs = finite.map(Math.abs);
  const m = max ?? (abs.length ? quantile(abs, 0.95) : 1);
  const { hi: mPt, stepPt } = snapDomain(0, Math.max(m, 0.0001), 5); // ≤ 5 bins per side
  const open = abs.length > 0 && Math.max(...abs) * 100 > mPt + 1e-9;
  const end = (pt: number) => `${open ? "≥ " : ""}${label(clean(pt))}`;
  const bins = Math.round(mPt / stepPt) * 2;
  const interp = (t: number) => (t < 0 ? interpolateLab("#000000", neg)(-t) : interpolateLab("#000000", pos)(t));
  const linT = (v: number) => Math.max(-1, Math.min(1, (v * 100) / mPt));
  const binT = (v: number) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v * 100 + mPt) / stepPt + 1e-9)));
    const mid = -mPt + (b + 0.5) * stepPt;
    return mid / mPt;
  };
  const t = kind === "stepped" ? binT : linT;
  const legend: LegendSpec =
    kind === "stepped"
      ? {
          type: "stepped",
          items: Array.from({ length: bins }, (_, i) => bins - 1 - i).map((b) => {
            const a = clean(-mPt + b * stepPt);
            const text =
              open && b === 0 ? end(a + stepPt) : open && b === bins - 1 ? end(a) : `${label(a)} ～ ${label(clean(a + stepPt))}`;
            return { color: interp((a + stepPt / 2) / mPt), label: text };
          }),
        }
      : {
          type: "continuous",
          gradient: `linear-gradient(to top, ${Array.from({ length: 21 }, (_, i) => `${interp(i / 10 - 1)} ${i * 5}%`).join(", ")})`,
          ticks: [{ at: 0, label: end(-mPt) }, { at: 0.5, label: label(0) }, { at: 1, label: end(mPt) }],
        };
  return { color: (v) => interp(t(v)), t, legend };
}

export const viridis = (t: number) => interpolateInferno(t); // lighter = higher
export const blackTo = (c: string) => (t: number) => interpolateLab("#000000", c)(t);
/** Shade a colour by strength t∈[0,1]: weak → pale, strong → full colour. */
export const shade = (c: string, t: number) => interpolateLab("#f2f2f2", c)(0.2 + 0.8 * t);
