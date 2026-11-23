/**
 * View maths shared by the map, ring and sidebar (docs/ui-design.md).
 * Pure functions: no React, no MapLibre.
 */
import type { BallotChoice, ContestMetadataFile, ResultSummary } from "@tw-election/schema";
import { FALLBACK_PALETTE, NEUTRAL } from "./colors.ts";
import type { UnitView } from "./results.ts";

export const KMT = "cec-1";
export const DPP = "cec-16";

export interface Denominator {
  invalid: boolean; // 計入無效票
  abstain: boolean; // 計入未投票
}

/** 未投票 = 選舉人數 − 投票數 (null when either is unknown). */
export function abstained(s: ResultSummary): number | null {
  return s.electors !== null && s.ballotsCast !== null ? Math.max(0, s.electors - s.ballotsCast) : null;
}

/** 有效票 (+ 無效票) (+ 未投票). Null when a required part is unknown or the total is 0. */
export function denominatorOf(s: ResultSummary, d: Denominator): number | null {
  if (s.valid === null) return null;
  let total = s.valid;
  if (d.invalid) {
    if (s.invalid === null) return null;
    total += s.invalid;
  }
  if (d.abstain) {
    const a = abstained(s);
    if (a === null) return null;
    total += a;
  }
  return total > 0 ? total : null;
}

export function denominatorLabel(d: Denominator): string {
  if (d.invalid && d.abstain) return "選舉人數";
  if (d.invalid) return "投票數";
  if (d.abstain) return "有效票＋未投票";
  return "有效票數";
}

export const shareOf = (u: UnitView, i: number, d: Denominator): number | null => {
  const den = denominatorOf(u.summary, d);
  return den === null ? null : (u.votes[i] ?? 0) / den;
};

/** Votes for all choices of a party in this unit; a party with no candidate counts as 0. */
export function partyVotes(u: UnitView, choices: BallotChoice[], partyId: string): number {
  return choices.reduce((sum, c, i) => (c.partyId === partyId ? sum + (u.votes[i] ?? 0) : sum), 0);
}

export type DiffFormula = "pct" | "ratio";

export interface DiffResult {
  value: number | null; // positive = DPP ahead
  dpp: number;
  kmt: number;
  den: number | null; // the denominator actually used
}

/** (1) DPP% − KMT% over the chosen denominator; (2) (DPP − KMT) ÷ (DPP + KMT). */
export function twoPartyDiff(u: UnitView, choices: BallotChoice[], f: DiffFormula, d: Denominator): DiffResult {
  const dpp = partyVotes(u, choices, DPP);
  const kmt = partyVotes(u, choices, KMT);
  if (f === "ratio") return { value: dpp + kmt > 0 ? (dpp - kmt) / (dpp + kmt) : null, dpp, kmt, den: dpp + kmt || null };
  const den = denominatorOf(u.summary, d);
  return { value: den === null ? null : (dpp - kmt) / den, dpp, kmt, den };
}

export interface TopResult {
  index: number | null; // null on a tie or no votes
  share: number | null;
  elected: boolean;
}

/** The candidate with the most votes in this unit, elected or not (ties → null). */
export function localTop(u: UnitView, electedChoice: boolean[], d: Denominator): TopResult {
  const max = Math.max(...u.votes);
  const idx = u.votes.flatMap((v, i) => (v === max ? [i] : []));
  if (max <= 0 || idx.length !== 1) return { index: null, share: null, elected: false };
  const i = idx[0]!;
  return { index: i, share: shareOf(u, i, d), elected: electedChoice[i] ?? false };
}

/** Whether each choice won a seat in the contest (any of its candidacies elected). */
export function electedByChoice(meta: ContestMetadataFile): boolean[] {
  const elected = new Set(meta.candidacies.filter((c) => c.elected).map((c) => c.id));
  return meta.choices.map((c) => c.candidacyIds.some((id) => elected.has(id)));
}

/** Display colour per choice: reviewed-or-not party colour, else neutral (independents) or fallback. */
export function choiceColors(meta: ContestMetadataFile): string[] {
  const party = new Map(meta.parties.map((p) => [p.id, p]));
  let fallback = 0;
  return meta.choices.map((c) => {
    const p = c.partyId ? party.get(c.partyId) : undefined;
    if (p?.color) return p.color;
    if (p?.isIndependent) return NEUTRAL;
    return FALLBACK_PALETTE[fallback++ % FALLBACK_PALETTE.length]!;
  });
}

export const partyColor = (meta: ContestMetadataFile, partyId: string) =>
  meta.parties.find((p) => p.id === partyId)?.color ?? null;
