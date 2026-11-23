/**
 * Colour scales. Every stepped bin is exactly one whole step (5, 10 or 20 points),
 * so legend labels are exact; continuous scales use the same snapped domain so
 * switching between the two never changes the range the colours cover.
 */
import { interpolateLab } from "d3-interpolate";
import { interpolatePlasma } from "d3-scale-chromatic";

export const NO_DATA = "#444444";
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
  | { type: "stepped"; items: { color: string; label: string }[] }
  | { type: "continuous"; gradient: string; ticks: { at: number; label: string }[] };

export interface ColorScale {
  color: (v: number) => string;
  /** Position in [0, 1] (sequential) or [-1, 1] (diverging) after binning — used for shading. */
  t: (v: number) => number;
  legend: LegendSpec;
}

const STEPS = [5, 10, 20, 25, 50] as const;

/** Snap [min, max] (fractions) outward to whole steps, choosing the smallest step with ≤ maxBins bins. */
export function snapDomain(min: number, max: number, maxBins: number): { lo: number; hi: number; stepPt: number } {
  for (const stepPt of STEPS) {
    let lo = Math.floor((min * 100 + 1e-7) / stepPt) * stepPt;
    let hi = Math.ceil((max * 100 - 1e-7) / stepPt) * stepPt;
    if (hi <= lo) hi = lo + stepPt;
    if ((hi - lo) / stepPt <= maxBins) return { lo, hi, stepPt };
  }
  return { lo: Math.floor(min * 100), hi: Math.ceil(max * 100), stepPt: Math.ceil((max - min) * 100) || 1 };
}

const pct = (pt: number) => `${pt}%`;

/** Sequential: low → high over the snapped data range; interp(0) is the low end. */
/** Linear-interpolated quantile of a non-empty array. */
export function quantile(xs: number[], q: number): number {
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const i = Math.floor(pos);
  return a[i]! + (a[Math.min(i + 1, a.length - 1)]! - a[i]!) * (pos - i);
}

/**
 * Sequential: low → high; interp(0) is the low end. The domain covers the middle 95% of
 * values (2.5th–97.5th percentile, snapped to whole steps) so a few outliers don't wash
 * out the map; values beyond it take the end colour and the legend ends read ≤ / ≥.
 */
export function sequentialScale(values: number[], interp: (t: number) => string, kind: ScaleKind): ColorScale {
  const finite = values.filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const { lo, hi, stepPt } = snapDomain(finite.length ? quantile(finite, 0.025) : 0, finite.length ? quantile(finite, 0.975) : 1, 8);
  const openLo = min * 100 < lo - 1e-9;
  const openHi = max * 100 > hi + 1e-9;
  const bins = Math.round((hi - lo) / stepPt);
  const linT = (v: number) => Math.min(1, Math.max(0, (v * 100 - lo) / (hi - lo)));
  const binT = (v: number) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v * 100 - lo) / stepPt)));
    return bins === 1 ? 1 : b / (bins - 1);
  };
  const t = kind === "stepped" ? binT : linT;
  const binLabel = (b: number) => {
    const a = lo + b * stepPt;
    if (b === bins - 1 && openHi) return `≥ ${pct(a)}`;
    if (b === 0 && openLo) return `< ${pct(a + stepPt)}`;
    return `${pct(a)}–${pct(a + stepPt)}`;
  };
  const legend: LegendSpec =
    kind === "stepped"
      ? {
          type: "stepped",
          items: Array.from({ length: bins }, (_, i) => bins - 1 - i).map((b) => ({
            color: interp(bins === 1 ? 1 : b / (bins - 1)),
            label: binLabel(b),
          })),
        }
      : {
          type: "continuous",
          gradient: `linear-gradient(to top, ${Array.from({ length: 11 }, (_, i) => `${interp(i / 10)} ${i * 10}%`).join(", ")})`,
          ticks: [
            { at: 0, label: `${openLo ? "≤ " : ""}${pct(lo)}` },
            { at: 0.5, label: pct((lo + hi) / 2) },
            { at: 1, label: `${openHi ? "≥ " : ""}${pct(hi)}` },
          ],
        };
  return { color: (v) => interp(t(v)), t, legend };
}

/**
 * Diverging around 0 (fractions in [-1, 1]): negative → `neg`, 0 → black, positive → `pos`.
 * The domain is symmetric so equal distances from 0 get equal colour strength. Its size is
 * the 95th percentile of |value| (snapped), so a few landslide areas don't turn the rest
 * black; beyond it values take the end colour and the legend ends read ≥.
 */
export function divergingScale(
  values: number[],
  neg: string,
  pos: string,
  kind: ScaleKind,
  label: (pt: number) => string,
): ColorScale {
  const finite = values.filter(Number.isFinite);
  const abs = finite.map(Math.abs);
  const m = abs.length ? quantile(abs, 0.95) : 1;
  const { hi: mPt, stepPt } = snapDomain(0, Math.max(m, 0.0001), 5); // ≤ 5 bins per side
  const open = abs.length > 0 && Math.max(...abs) * 100 > mPt + 1e-9;
  const end = (pt: number) => `${open ? "≥ " : ""}${label(pt)}`;
  const bins = Math.round(mPt / stepPt) * 2;
  const interp = (t: number) => (t < 0 ? interpolateLab("#000000", neg)(-t) : interpolateLab("#000000", pos)(t));
  const linT = (v: number) => Math.max(-1, Math.min(1, (v * 100) / mPt));
  const binT = (v: number) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v * 100 + mPt) / stepPt)));
    const mid = -mPt + (b + 0.5) * stepPt;
    return mid / mPt;
  };
  const t = kind === "stepped" ? binT : linT;
  const legend: LegendSpec =
    kind === "stepped"
      ? {
          type: "stepped",
          items: Array.from({ length: bins }, (_, i) => bins - 1 - i).map((b) => {
            const a = -mPt + b * stepPt;
            const text =
              open && b === 0 ? end(a + stepPt) : open && b === bins - 1 ? end(a) : `${label(a)} ～ ${label(a + stepPt)}`;
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

export const viridis = (t: number) => interpolatePlasma(0.1 + 0.85 * t); // lighter = higher
export const blackTo = (c: string) => (t: number) => interpolateLab("#000000", c)(t);
/** Shade a colour by strength t∈[0,1]: weak → pale, strong → full colour. */
export const shade = (c: string, t: number) => interpolateLab("#f2f2f2", c)(0.2 + 0.8 * t);
