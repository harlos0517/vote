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
  const step = 0.05;
  // Work in whole 5-point steps to keep bin edges exact (0.3, not 0.30000000000000004).
  const snap = (steps: number) => Math.round(steps * 5) / 100;
  let lo = finite.length ? snap(Math.floor(Math.min(...finite) * 20 + 1e-9)) : 0;
  let hi = finite.length ? snap(Math.ceil(Math.max(...finite) * 20 - 1e-9)) : 1;
  if (hi - lo < step) hi = Math.min(1, snap(Math.round(lo * 20) + 1));
  if (hi === lo) lo = Math.max(0, snap(Math.round(hi * 20) - 1));
  const bins = Math.max(1, Math.min(8, Math.round((hi - lo) / step)));
  const colors = Array.from({ length: bins }, (_, i) => interpolateViridis(0.95 - (0.85 * i) / Math.max(1, bins - 1)));
  return scaleQuantize<string>().domain([lo, hi]).range(colors);
}

export const leaderColor = (choiceIndex: number) => LEADER_PALETTE[choiceIndex % LEADER_PALETTE.length]!;
