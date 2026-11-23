/**
 * View maths shared by the map, ring and sidebar (docs/ui-design.md).
 * Pure functions: no React, no MapLibre. Works for single-contest groups (總統) and
 * multi-contest groups (區域立委, 73 districts) alike.
 */
import type { BallotChoice, GroupMetadataFile, Party, ResultSummary } from "@tw-election/schema";
import { NEUTRAL } from "./colors.ts";
import type { UnitView } from "./results.ts";

export const KMT = "cec-1";
export const DPP = "cec-16";

/** Indexes built once per group. */
export interface GroupContext {
  meta: GroupMetadataFile;
  choice: Map<string, BallotChoice>;
  party: Map<string, Party>;
  /** Display colour per choice id (its party's colour). */
  choiceColor: Map<string, string>;
  /** Display colour per party id. */
  partyColor: Map<string, string>;
  /** Whether each choice won its contest's seat. */
  elected: Map<string, boolean>;
  /** Seats per contest (sum of elected choices) — 1 for every contest so far. */
  contestName: Map<string, string>;
  /** Parties with candidates in the group, largest national vote first. */
  partiesByVote: Party[];
  singleContest: boolean;
}

export function groupContext(meta: GroupMetadataFile, nationalVotes?: Record<string, number>): GroupContext {
  const choice = new Map(meta.choices.map((c) => [c.id, c]));
  const party = new Map(meta.parties.map((p) => [p.id, p]));
  const electedIds = new Set(meta.candidacies.filter((c) => c.elected).map((c) => c.id));
  const elected = new Map(meta.choices.map((c) => [c.id, c.candidacyIds.some((id) => electedIds.has(id))]));
  // Parties without a reviewed colour (and independents) are neutral grey, as the ETL report says.
  const partyColor = new Map(meta.parties.map((p) => [p.id, p.color ?? NEUTRAL]));
  const choiceColor = new Map(meta.choices.map((c) => [c.id, (c.partyId && partyColor.get(c.partyId)) || NEUTRAL]));
  const totals = new Map<string, number>();
  for (const c of meta.choices) if (c.partyId) totals.set(c.partyId, (totals.get(c.partyId) ?? 0) + (nationalVotes?.[c.id] ?? 0));
  const partiesByVote = [...meta.parties].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
  return {
    meta,
    choice,
    party,
    choiceColor,
    partyColor,
    elected,
    contestName: new Map(meta.contests.map((c) => [c.id, c.nameZh])),
    partiesByVote,
    singleContest: meta.contests.length === 1,
  };
}

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

/** Votes for all of a party's candidates in this unit; a party with no candidate counts as 0. */
export function partyVotes(u: UnitView, ctx: GroupContext, partyId: string): number {
  let sum = 0;
  for (const [id, v] of Object.entries(u.votes)) if (ctx.choice.get(id)?.partyId === partyId) sum += v;
  return sum;
}

/** Whether the party had a candidate in any of the unit's contests. */
export function partyRan(u: UnitView, ctx: GroupContext, partyId: string): boolean {
  const contests = new Set(u.contestIds);
  return ctx.meta.choices.some((c) => c.partyId === partyId && contests.has(c.contestId));
}

export const partyShare = (u: UnitView, ctx: GroupContext, partyId: string, d: Denominator): number | null => {
  const den = denominatorOf(u.summary, d);
  return den === null ? null : partyVotes(u, ctx, partyId) / den;
};

export const choiceShare = (u: UnitView, choiceId: string, d: Denominator): number | null => {
  const den = denominatorOf(u.summary, d);
  return den === null ? null : (u.votes[choiceId] ?? 0) / den;
};

export type DiffFormula = "pct" | "ratio";

export interface DiffResult {
  value: number | null; // positive = DPP ahead
  dpp: number;
  kmt: number;
  den: number | null; // the denominator actually used
}

/** (1) DPP% − KMT% over the chosen denominator; (2) (DPP − KMT) ÷ (DPP + KMT). */
export function twoPartyDiff(u: UnitView, ctx: GroupContext, f: DiffFormula, d: Denominator): DiffResult {
  const dpp = partyVotes(u, ctx, DPP);
  const kmt = partyVotes(u, ctx, KMT);
  if (f === "ratio") return { value: dpp + kmt > 0 ? (dpp - kmt) / (dpp + kmt) : null, dpp, kmt, den: dpp + kmt || null };
  const den = denominatorOf(u.summary, d);
  return { value: den === null ? null : (dpp - kmt) / den, dpp, kmt, den };
}

export interface TopResult {
  choiceId: string | null; // null on a tie or no votes
  share: number | null;
  elected: boolean;
}

/** The candidate with the most votes in a single-contest unit, elected or not (ties → null). */
export function localTop(u: UnitView, ctx: GroupContext, d: Denominator): TopResult {
  const entries = Object.entries(u.votes);
  const max = Math.max(0, ...entries.map(([, v]) => v));
  const top = entries.filter(([, v]) => v === max);
  if (max <= 0 || top.length !== 1) return { choiceId: null, share: null, elected: false };
  const id = top[0]![0];
  return { choiceId: id, share: choiceShare(u, id, d), elected: ctx.elected.get(id) ?? false };
}

export interface SeatsResult {
  /** Party with the most seats won among the unit's contests (ties → null). */
  partyId: string | null;
  seats: Map<string, number>; // partyId → seats
  total: number;
}

/** Seats won per party among the contests of a unit spanning several contests (縣市, 全國). */
export function seatsByParty(u: UnitView, ctx: GroupContext): SeatsResult {
  const contests = new Set(u.contestIds);
  const seats = new Map<string, number>();
  let total = 0;
  for (const c of ctx.meta.choices) {
    if (!contests.has(c.contestId) || !ctx.elected.get(c.id)) continue;
    const p = c.partyId ?? "none";
    seats.set(p, (seats.get(p) ?? 0) + 1);
    total++;
  }
  const max = Math.max(0, ...seats.values());
  const leaders = [...seats].filter(([, n]) => n === max);
  return { partyId: max > 0 && leaders.length === 1 ? leaders[0]![0] : null, seats, total };
}

export const isMultiContest = (u: UnitView) => u.contestIds.length > 1;

/** Label for a party; in single-contest groups add the candidate(s), e.g. "民主進步黨（賴清德／蕭美琴）". */
export function partyLabel(ctx: GroupContext, partyId: string): string {
  const p = ctx.party.get(partyId);
  const name = p ? (p.isIndependent ? `${p.nameZh}（合計）` : p.nameZh) : partyId;
  if (!ctx.singleContest) return name;
  const cands = ctx.meta.choices.filter((c) => c.partyId === partyId).map((c) => c.labelZh);
  return cands.length === 1 ? `${name}（${cands[0]}）` : name;
}
