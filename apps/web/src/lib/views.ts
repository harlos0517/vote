/**
 * View maths shared by the map, ring and sidebar (docs/ui-design.md).
 * Pure functions: no React, no MapLibre. Works for single-contest groups (總統) and
 * multi-contest groups (區域立委, 73 districts) alike.
 */
import type { BallotChoice, Contest, GroupMetadataFile, Party, ReferendumRule, ResultSummary } from "@tw-election/schema";
import { NEUTRAL, OTHER_PARTY } from "./colors.ts";
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
  /** 不分區政黨票: the ballot lists parties; seats come from the national allocation. */
  partyList: NonNullable<Contest["partyList"]> | null;
  /** Some party has several candidates in the group's one contest (原住民立委), so candidates can be picked separately. */
  candidatesPickable: boolean;
  /** Contest id → contest. */
  contest: Map<string, Contest>;
  /** National referendum case (choices "agree" / "disagree"), else null. */
  referendum: NonNullable<Contest["referendum"]> | null;
  /** Contest id → its choices (村里長 has ~15,000 choices: never scan them per unit). */
  choicesByContest: Map<string, BallotChoice[]>;
  /** Choice ids whose seat was tied and decided by lot (CEC "?"; the draw's result is not in the data). */
  byLot: Set<string>;
  /** Township and village offices: the 競爭情形 view is offered. */
  localOffice: boolean;
  /** Every contest elects one seat. */
  singleSeat: boolean;
}

/** Offices elected inside townships and villages (鄉鎮市長, 區長, 代表, 村里長). */
export const LOCAL_OFFICES = new Set<string>([
  "township-mayor",
  "indigenous-district-chief",
  "township-rep-district",
  "township-rep-lowland-indigenous",
  "indigenous-district-rep",
  "village-chief",
]);

export function groupContext(meta: GroupMetadataFile, nationalVotes?: Record<string, number>): GroupContext {
  const choice = new Map(meta.choices.map((c) => [c.id, c]));
  const party = new Map(meta.parties.map((p) => [p.id, p]));
  const electedIds = new Set(meta.candidacies.filter((c) => c.elected).map((c) => c.id));
  const elected = new Map(meta.choices.map((c) => [c.id, c.candidacyIds.some((id) => electedIds.has(id))]));
  // Parties without a reviewed colour (and independents) are neutral grey, as the ETL report says.
  // No recorded colour: 無黨籍 stays grey, other parties share OTHER_PARTY so they don't look like independents.
  const partyColor = new Map(meta.parties.map((p) => [p.id, p.color ?? (p.isIndependent ? NEUTRAL : OTHER_PARTY)]));
  const choiceColor = new Map(meta.choices.map((c) => [c.id, (c.partyId && partyColor.get(c.partyId)) || NEUTRAL]));
  const totals = new Map<string, number>();
  for (const c of meta.choices) if (c.partyId) totals.set(c.partyId, (totals.get(c.partyId) ?? 0) + (nationalVotes?.[c.id] ?? 0));
  const partiesByVote = [...meta.parties].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
  const choicesByContest = new Map<string, BallotChoice[]>();
  for (const c of meta.choices) {
    const list = choicesByContest.get(c.contestId);
    if (list) list.push(c);
    else choicesByContest.set(c.contestId, [c]);
  }
  const lotIds = new Set(meta.candidacies.filter((c) => c.electedNote === "tied-decided-by-lot").map((c) => c.id));
  const byLot = new Set(meta.choices.filter((c) => c.candidacyIds.some((id) => lotIds.has(id))).map((c) => c.id));
  return {
    choicesByContest,
    byLot,
    localOffice: LOCAL_OFFICES.has(meta.group?.office ?? ""), // test fixtures may omit the group
    singleSeat: meta.contests.every((c) => (c.seats ?? 1) === 1),
    meta,
    choice,
    party,
    choiceColor,
    partyColor,
    elected,
    contestName: new Map(meta.contests.map((c) => [c.id, c.nameZh])),
    partiesByVote,
    singleContest: meta.contests.length === 1,
    partyList: meta.contests.find((c) => c.partyList)?.partyList ?? null,
    contest: new Map(meta.contests.map((c) => [c.id, c])),
    referendum: meta.contests[0]?.referendum ?? null,
    candidatesPickable: meta.contests.length === 1 && meta.contests.some((ct) => {
      const ps = meta.choices.filter((c) => c.contestId === ct.id && c.partyId && !party.get(c.partyId)?.isIndependent).map((c) => c.partyId);
      return new Set(ps).size < ps.length;
    }),
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

export function denominatorLabel(d: Denominator, referendum = false): string {
  if (d.invalid && d.abstain) return referendum ? "投票權人數" : "選舉人數";
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
  return u.contestIds.some((id) => ctx.choicesByContest.get(id)?.some((c) => c.partyId === partyId));
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

/** Referendum: (1) 同意% − 不同意% over the chosen denominator; (2) (同意 − 不同意) ÷ (同意 + 不同意). */
export function referendumDiff(u: UnitView, f: DiffFormula, d: Denominator): DiffResult {
  const a = u.votes.agree ?? 0;
  const b = u.votes.disagree ?? 0;
  if (f === "ratio") return { value: a + b > 0 ? (a - b) / (a + b) : null, dpp: a, kmt: b, den: a + b || null };
  const den = denominatorOf(u.summary, d);
  return { value: den === null ? null : (a - b) / den, dpp: a, kmt: b, den };
}

/**
 * The case's rule applied to one unit (only the national result counts; local values are for
 * reference): 公民投票法第29條 (同意 > 不同意, 同意 ≥ 25% of electors) or 憲法增修條文第12條
 * (同意 > half of electors). `needed` is the smallest 同意 count that meets the quorum.
 */
export function referendumStatus(u: UnitView, rule: Pick<ReferendumRule, "agreeQuorumOfElectors" | "quorumStrict">) {
  const a = u.votes.agree ?? 0;
  const b = u.votes.disagree ?? 0;
  const e = u.summary.electors;
  const q = rule.agreeQuorumOfElectors ?? 0;
  const needed = e === null ? null : quorumVotes(q, e, rule.quorumStrict ?? false);
  return { agreeMore: a > b, quorumMet: needed !== null && a >= needed, agreeOfElectors: e ? a / e : null, needed };
}

/** Smallest vote count meeting quorum × electors: "≥" (達…以上) or strictly "more than" (過…半數). */
export const quorumVotes = (q: number, electors: number, strict: boolean) => (strict ? Math.floor(q * electors) + 1 : Math.ceil(q * electors));

/** "同意票達投票權人數 25%" / "同意票過投票權人數 50%". */
export const quorumLabel = (rule: Pick<ReferendumRule, "agreeQuorumOfElectors" | "quorumStrict">) =>
  `同意票${rule.quorumStrict ? "過" : "達"}投票權人數 ${(rule.agreeQuorumOfElectors ?? 0) * 100}%`;

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
  const seats = new Map<string, number>();
  let total = 0;
  for (const id of u.contestIds) {
    for (const c of ctx.choicesByContest.get(id) ?? []) {
      if (!ctx.elected.get(c.id)) continue;
      const p = c.partyId ?? "none";
      seats.set(p, (seats.get(p) ?? 0) + 1);
      total++;
    }
  }
  const max = Math.max(0, ...seats.values());
  const leaders = [...seats].filter(([, n]) => n === max);
  return { partyId: max > 0 && leaders.length === 1 ? leaders[0]![0] : null, seats, total };
}

/** Party-list seats won nationally (0 when the party is below the threshold). */
export const listSeats = (ctx: GroupContext, partyId: string) => ctx.partyList?.allocation.find((a) => a.partyId === partyId)?.seats ?? 0;

export const isMultiContest = (u: UnitView) => u.contestIds.length > 1;

/** Seats of a single-contest unit's contest (1 when unknown). */
export const seatsOf = (u: UnitView, ctx: GroupContext) => (u.contestIds.length === 1 ? (ctx.contest.get(u.contestIds[0]!)?.seats ?? 1) : 1);

/**
 * Whether the 當選 view shows seats won by party instead of the local top candidate: units spanning
 * several contests, and multi-seat districts themselves (議員: up to 13 seats; their top is always elected).
 */
export const showsSeats = (u: UnitView, ctx: GroupContext) => isMultiContest(u) || (u.id.startsWith("dist:") && seatsOf(u, ctx) > 1);

/** Label for a party; in single-contest groups add the candidate(s), e.g. "民主進步黨（賴清德／蕭美琴）". */
export function partyLabel(ctx: GroupContext, partyId: string): string {
  const p = ctx.party.get(partyId);
  const name = p ? (p.isIndependent ? `${p.nameZh}（合計）` : p.nameZh) : partyId;
  if (!ctx.singleContest || ctx.partyList) return name;
  const cands = ctx.meta.choices.filter((c) => c.partyId === partyId).map((c) => c.labelZh);
  return cands.length === 1 ? `${name}（${cands[0]}）` : name;
}

/** 競爭情形 of one contest: candidates against seats. */
export interface Competition {
  candidates: number;
  seats: number;
  /** "uncontested" (同額: no more candidates than seats), "close" (≤ 2 per seat), "wide" (more than 2 per seat). */
  kind: "uncontested" | "close" | "wide";
}

export function competitionOf(ctx: GroupContext, contestId: string): Competition {
  const candidates = ctx.choicesByContest.get(contestId)?.length ?? 0;
  const seats = ctx.contest.get(contestId)?.seats ?? 1;
  return { candidates, seats, kind: candidates <= seats ? "uncontested" : candidates <= 2 * seats ? "close" : "wide" };
}

/** Share of a unit's contests that were 同額 (uncontested); null when it has none. */
export function uncontestedShare(u: UnitView, ctx: GroupContext): { share: number | null; uncontested: number; total: number } {
  const total = u.contestIds.length;
  const uncontested = u.contestIds.filter((id) => competitionOf(ctx, id).kind === "uncontested").length;
  return { share: total ? uncontested / total : null, uncontested, total };
}
