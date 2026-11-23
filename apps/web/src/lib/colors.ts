/**
 * Colour rules (kept neutral and identical for every candidate):
 *  - share mode: one sequential, colour-blind-safe ramp (viridis, darker = higher)
 *    with equal-width 5-point bins fitted to the visible level's range;
 *  - leader mode: a fixed categorical palette by ballot order that deliberately
 *    avoids the blue/green hues commonly read as party colours.
 * Party colours are intentionally NOT used until a sourced, reviewed table exists.
 */
import { scaleQuantize, type ScaleQuantize } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";

export const NO_DATA = "#c9c9c9";
export const LEADER_PALETTE = ["#CC79A7", "#E69F00", "#6F6F6F", "#D55E00", "#F0E442", "#882255", "#AA7744"];

export function shareScale(values: number[]): ScaleQuantize<string> {
  const finite = values.filter((v) => Number.isFinite(v));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  // Every bin is exactly one whole step (5, 10 or 20 points) so legend labels are exact;
  // pick the smallest step that keeps the legend at ≤ 8 bins. Work in integer points
  // to avoid float drift (0.3, not 0.30000000000000004).
  const MAX_BINS = 8;
  let loPt = 0;
  let hiPt = 100;
  for (const stepPt of [5, 10, 20]) {
    loPt = Math.floor((min * 100 + 1e-7) / stepPt) * stepPt;
    hiPt = Math.ceil((max * 100 - 1e-7) / stepPt) * stepPt;
    if (hiPt <= loPt) hiPt = Math.min(100, loPt + stepPt);
    if (hiPt <= loPt) loPt = hiPt - stepPt;
    if ((hiPt - loPt) / stepPt <= MAX_BINS) {
      const bins = Math.round((hiPt - loPt) / stepPt);
      const colors = Array.from({ length: bins }, (_, i) => interpolateViridis(0.95 - (0.85 * i) / Math.max(1, bins - 1)));
      return scaleQuantize<string>().domain([loPt / 100, hiPt / 100]).range(colors);
    }
  }
  throw new Error("unreachable: 20-point steps always fit in 5 bins");
}

export const leaderColor = (choiceIndex: number) => LEADER_PALETTE[choiceIndex % LEADER_PALETTE.length]!;
