/**
 * Generic builder: one CEC el* directory → one contest group (all contests of one office
 * in one election). Handles a single nationwide contest (總統) and many district contests
 * (區域立委) with the same code; election-specific facts live in the group definitions.
 */
import type {
  BallotChoice,
  Candidacy,
  Contest,
  ContestGroup,
  Electorate,
  GroupResultsFile,
  GroupUnit,
  Office,
  Party,
  Person,
  ReportingLevel,
  ValidationCheck,
} from "@tw-election/schema";
import { type ElDataset, type ElKey, type ElPartyList, type ElUnit, countyCode, keyString, townCode } from "../adapters/cec-el.ts";
import { PUA_RE } from "../lib/csv.ts";
import { checkPartyColors, type PartyColor } from "../lib/party-colors.ts";
import { checkElDataset } from "../validate/el-checks.ts";

export interface ElectionDef {
  id: string;
  date: string;
  nameZh: string;
  kinds: ("president" | "legislative" | "local" | "referendum")[];
}

export interface ElGroupDef {
  election: ElectionDef;
  /** Local part of the group id, e.g. "president", "legislator-district". */
  local: string;
  nameZh: string;
  office: Office;
  electorate: Electorate;
  /** Path of the contest files inside votedata.zip. */
  archiveDir: string;
  /** "single": one nationwide contest. "district": one contest per (county, 選區). */
  contests: "single" | "district";
  /** "party": 不分區政黨票 — the ballot lists parties; list members come from elrepm.csv. */
  choiceKind: "ticket" | "candidate" | "party";
  /** Seats per contest (default 1); 原住民立委 elect 3 in one nationwide contest. */
  seats?: number;
  /** Boundary layout name used in geography paths ("admin" = plain counties/towns). */
  layout: string;
  warnings: string[];
}

export const partyId = (code: number) => `cec-${code}`;
export const toParty = (p: { code: number; name: string }, colors: Map<number, PartyColor>): Party => ({
  id: partyId(p.code),
  cecCode: p.code,
  nameZh: p.name,
  isIndependent: p.code === 999,
  color: colors.get(p.code)?.color ?? null,
  colorReviewed: colors.get(p.code)?.reviewed ?? false,
});

export const groupId = (d: ElGroupDef) => `${d.election.id}.${d.local}`;

export function levelsOf(d: ElGroupDef): ReportingLevel[] {
  return d.contests === "district" ? ["national", "county", "district", "town"] : ["national", "county", "town"];
}

interface ContestInfo {
  key: string; // "main" or "63000-07"
  id: string;
  county: string | null;
  dist: string | null;
  choicePrefix: string; // "" or "63000-d07."
}

export interface BuiltGroup {
  group: ContestGroup;
  contests: Contest[];
  choices: BallotChoice[];
  candidacies: Candidacy[];
  persons: Person[];
  parties: Party[];
  results: Partial<Record<ReportingLevel, GroupResultsFile>>;
  /** District membership per town-part code, for geometry: "63000010-07" → "63000-07". */
  townParts: { code: string; town: string; district: string | null }[];
  checks: ValidationCheck[];
}

/** 憲法增修條文第4條: party-list seats go to parties with at least 5% of the party vote. */
export const PARTY_LIST_THRESHOLD = { pct: 5, basis: "中華民國憲法增修條文第4條" };

/**
 * Largest-remainder allocation among parties at or above the threshold; used only to
 * cross-check CEC's published seats (CEC's numbers are what we publish).
 */
export function largestRemainder(votes: Map<number, number>, seats: number, thresholdPct: number): Map<number, number> {
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  const q = [...votes].filter(([, v]) => total > 0 && (v / total) * 100 >= thresholdPct);
  const qTotal = q.reduce((a, [, v]) => a + v, 0);
  const out = new Map<number, number>(q.map(([p]) => [p, 0]));
  if (!qTotal) return out;
  const quotas = q.map(([p, v]) => ({ p, exact: (v * seats) / qTotal }));
  let left = seats;
  for (const x of quotas) { out.set(x.p, Math.floor(x.exact)); left -= Math.floor(x.exact); }
  quotas.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  for (const x of quotas.slice(0, left)) out.set(x.p, out.get(x.p)! + 1);
  return out;
}

export function buildElGroup(d: ElGroupDef, ds: ElDataset, colors: Map<number, PartyColor>, list?: ElPartyList): BuiltGroup {
  const gid = groupId(d);
  const seats = d.seats ?? 1;
  const isList = d.choiceKind === "party";
  if (isList && !list) throw new Error(`${gid}: party-list group needs elrepm/elretks`);
  const multi = d.contests === "district";
  const contestKeyOf = (k: ElKey): string | null => (multi ? (k.dist === "00" ? null : `${countyCode(k)}-${k.dist}`) : "main");

  // ---- contests
  const countyName = new Map(ds.units.filter((u) => u.level === "county").map((u) => [countyCode(u.key), u.name]));
  const districtName = new Map(ds.units.filter((u) => u.level === "district").map((u) => [`${countyCode(u.key)}-${u.key.dist}`, u.name]));
  const infos = new Map<string, ContestInfo>();
  for (const c of ds.candidates) {
    const key = contestKeyOf(c.key);
    if (!key || infos.has(key)) continue;
    const county = multi ? countyCode(c.key) : null;
    const dist = multi ? c.key.dist : null;
    infos.set(key, {
      key,
      id: multi ? `${d.election.id}.ly-${county}-d${dist}` : gid,
      county,
      dist,
      choicePrefix: multi ? `${county}-d${dist}.` : "",
    });
  }
  const contestList = [...infos.values()].sort((a, b) => a.key.localeCompare(b.key));
  const ballotsByContest = new Map<string, number[]>();
  for (const c of ds.candidates) {
    const key = contestKeyOf(c.key)!;
    const list = ballotsByContest.get(key) ?? [];
    if (!list.includes(c.ballotNumber)) list.push(c.ballotNumber);
    ballotsByContest.set(key, list.sort((a, b) => a - b));
  }
  const choiceId = (ci: ContestInfo, n: number) => `${ci.choicePrefix}n${n}`;

  const checks: ValidationCheck[] = checkElDataset(ds, (k) => {
    const key = contestKeyOf(k);
    if (key === null) return null;
    // Town/village/station rows belong to one contest; district rows too.
    return ballotsByContest.get(key) ?? null;
  });

  // ---- candidates, persons, choices
  const partyByCode = new Map(ds.parties.map((p) => [p.code, p]));
  const persons: Person[] = [];
  const candidacies: Candidacy[] = [];
  const choices: BallotChoice[] = [];
  for (const ci of contestList) {
    const cands = ds.candidates.filter((c) => contestKeyOf(c.key) === ci.key);
    for (const n of ballotsByContest.get(ci.key)!) {
      const principal = cands.find((c) => c.ballotNumber === n && !c.isRunningMate);
      const mate = cands.find((c) => c.ballotNumber === n && c.isRunningMate);
      if (!principal) throw new Error(`${ci.id}: ballot ${n} has no principal candidate`);
      if (d.choiceKind === "ticket" && !mate) throw new Error(`${ci.id}: ticket ${n} has no running mate`);
      if (isList) {
        // The ballot row is the party itself; its people are the list members.
        if (!partyByCode.has(principal.partyCode)) throw new Error(`unknown party code ${principal.partyCode}`);
        const members = list!.members.filter((m) => m.partyCode === principal.partyCode).sort((a, b) => a.rank - b.rank);
        const ids: string[] = [];
        for (const m of members) {
          const pid = `${ci.id}.p${principal.partyCode}.r${m.rank}`;
          persons.push({ id: pid, nameZh: m.name, identity: "single-candidacy" });
          ids.push(`${pid}.candidacy`);
          candidacies.push({
            id: `${pid}.candidacy`,
            contestId: ci.id,
            personId: pid,
            role: "list-member",
            listRank: m.rank,
            ballotNumber: n,
            partyId: partyId(m.partyCode),
            gender: m.gender,
            birthYearROC: m.birthYearROC,
            incumbent: m.incumbent,
            elected: m.electedMark === "*" || m.electedMark === "!",
            electedNote: m.electedMark === "!" ? "women-quota" : m.electedMark === "-" ? "displaced-by-women-quota" : null,
          });
        }
        choices.push({ id: choiceId(ci, n), contestId: ci.id, kind: "party", ballotNumber: n, candidacyIds: ids, partyId: partyId(principal.partyCode), labelZh: principal.name });
        continue;
      }
      for (const c of [principal, ...(mate ? [mate] : [])]) {
        if (!partyByCode.has(c.partyCode)) throw new Error(`unknown party code ${c.partyCode}`);
        const pid = `${ci.id}.n${n}.${c.isRunningMate ? "vp" : "p"}`;
        persons.push({ id: pid, nameZh: c.name, identity: "single-candidacy" });
        const mark = c.electedMark;
        candidacies.push({
          id: `${pid}.candidacy`,
          contestId: ci.id,
          personId: pid,
          role: c.isRunningMate ? "running-mate" : "principal",
          listRank: null,
          ballotNumber: n,
          partyId: partyId(c.partyCode),
          gender: c.gender,
          birthYearROC: c.birthYearROC,
          incumbent: c.incumbent,
          // Tickets carry the elected mark on the principal row only.
          elected: c.isRunningMate ? null : mark === "*" || mark === "!",
          electedNote: c.isRunningMate ? null : mark === "!" ? "women-quota" : mark === "-" ? "displaced-by-women-quota" : null,
        });
      }
      choices.push({
        id: choiceId(ci, n),
        contestId: ci.id,
        kind: d.choiceKind,
        ballotNumber: n,
        candidacyIds: [principal, ...(mate ? [mate] : [])].map((c) => `${ci.id}.n${n}.${c.isRunningMate ? "vp" : "p"}.candidacy`),
        partyId: partyId(principal.partyCode),
        labelZh: mate ? `${principal.name}／${mate.name}` : principal.name,
      });
    }
  }

  // ---- winners: the marked candidates must be the contest's top `seats` (ties fail loudly)
  const topRowOf = (ci: ContestInfo) =>
    ds.units.find((u) => (multi ? u.level === "district" && contestKeyOf(u.key) === ci.key : u.level === "national"));
  const winnerBad: string[] = [];
  let partyList: Contest["partyList"] = null;
  for (const ci of contestList) {
    const row = topRowOf(ci);
    if (!row) { winnerBad.push(`${ci.id}: no contest-level row`); continue; }
    if (isList) {
      partyList = checkPartyList(ci, row, list!, candidacies, seats, ballotsByContest.get(ci.key)!, ds, winnerBad);
      continue;
    }
    const nums = [...ballotsByContest.get(ci.key)!].sort((a, b) => (row.votes.get(b) ?? 0) - (row.votes.get(a) ?? 0));
    const cut = row.votes.get(nums[seats - 1]!) ?? 0;
    if (nums.length > seats && (row.votes.get(nums[seats]!) ?? 0) === cut) winnerBad.push(`${ci.id}: tie for the last seat`);
    const top = nums.slice(0, seats).sort((a, b) => a - b);
    const marked = candidacies.filter((c) => c.contestId === ci.id && c.elected).map((c) => c.ballotNumber).sort((a, b) => a - b);
    if (marked.join(",") !== top.join(",")) winnerBad.push(`${ci.id}: marked ${marked.join(",") || "none"} vs top ${top.map((n) => `#${n}`).join(",")}`);
  }
  checks.push(
    winnerBad.length
      ? { id: "winner-consistent", status: "fail", detail: winnerBad.slice(0, 5).join("; ") }
      : isList
        ? { id: "winner-consistent", status: "pass", detail: `${seats} seats: CEC's per-party seats match the elected list members, the ${PARTY_LIST_THRESHOLD.pct}% threshold and a largest-remainder recount; published vote shares reproduce` }
        : { id: "winner-consistent", status: "pass", detail: `${contestList.length} contests: the ${seats === 1 ? "elected candidate has" : `${seats} elected candidates have`} the most votes` },
  );

  // ---- units and results per level
  const contestTopVotes = new Map<string, Record<string, number>>();
  for (const ci of contestList) {
    const row = topRowOf(ci)!;
    contestTopVotes.set(ci.key, Object.fromEntries([...row.votes].map(([n, v]) => [choiceId(ci, n), v])));
  }
  const contestsInCounty = (cc: string) => contestList.filter((ci) => !multi || ci.county === cc);
  const splitTowns = new Set<string>();
  if (multi) {
    const distsPerTown = new Map<string, Set<string>>();
    for (const u of ds.units.filter((u) => u.level === "town")) {
      const s = distsPerTown.get(townCode(u.key)) ?? new Set();
      s.add(u.key.dist);
      distsPerTown.set(townCode(u.key), s);
    }
    for (const [t, s] of distsPerTown) if (s.size > 1) splitTowns.add(t);
  }

  const unitOf = (u: ElUnit): { unit: GroupUnit; contests: ContestInfo[] } | null => {
    const cc = countyCode(u.key);
    const ckey = contestKeyOf(u.key);
    const ci = ckey ? infos.get(ckey) : undefined;
    switch (u.level) {
      case "national":
        return { unit: { id: "nat", level: "national", nameZh: "全國", parentId: null, contestIds: contestList.map((c) => c.id) }, contests: contestList };
      case "county": {
        const cs = contestsInCounty(cc);
        return { unit: { id: `cty:${cc}`, level: "county", nameZh: u.name, parentId: "nat", contestIds: cs.map((c) => c.id) }, contests: cs };
      }
      case "district":
        if (!multi || !ci) return null;
        return {
          unit: { id: `dist:${cc}-${u.key.dist}`, level: "district", nameZh: u.name, parentId: `cty:${cc}`, contestIds: [ci.id] },
          contests: [ci],
        };
      case "town": {
        if (!ci) return null;
        const tc = townCode(u.key);
        if (!multi) return { unit: { id: `town:${tc}`, level: "town", nameZh: u.name, parentId: `cty:${cc}`, contestIds: [ci.id] }, contests: [ci] };
        const name = splitTowns.has(tc) ? `${u.name}（第${u.key.dist}選區部分）` : u.name;
        return { unit: { id: `tp:${tc}-${u.key.dist}`, level: "town", nameZh: name, parentId: `dist:${cc}-${u.key.dist}`, contestIds: [ci.id] }, contests: [ci] };
      }
      default:
        return null;
    }
  };

  const results: Partial<Record<ReportingLevel, GroupResultsFile>> = {};
  for (const level of levelsOf(d)) {
    const rows = ds.units
      .filter((u) => u.level === level)
      .flatMap((u) => {
        const m = unitOf(u);
        if (!m) return [];
        let votes: Record<string, number>;
        if (u.votes.size > 0) {
          const ci = m.contests.length === 1 ? m.contests[0]! : null;
          if (!ci) throw new Error(`${keyString(u.key)} has candidate rows but spans several contests`);
          votes = Object.fromEntries([...u.votes].map(([n, v]) => [choiceId(ci, n), v]));
        } else {
          // CEC publishes no candidate rows above district level: sum the contests' own rows.
          votes = Object.assign({}, ...m.contests.map((c) => contestTopVotes.get(c.key)!));
        }
        return [{ m, u, votes }];
      })
      .sort((a, b) => a.m.unit.id.localeCompare(b.m.unit.id));
    results[level] = {
      schemaVersion: 2,
      groupId: gid,
      level,
      units: rows.map((r) => r.m.unit),
      rows: rows.map(({ m, u, votes }) => ({
        unit: m.unit.id,
        summary: {
          electors: u.electors,
          ballotsCast: u.cast,
          valid: u.valid,
          invalid: u.invalid,
          // CEC writes 0 where population is not reported (below county level).
          population: u.populationRaw === 0 ? null : u.populationRaw,
        },
        votes,
      })),
    };
  }

  // ---- names must be plain Unicode
  const strings = [
    ...choices.map((c) => c.labelZh),
    ...persons.map((p) => p.nameZh),
    ...Object.values(results).flatMap((r) => r!.units.map((u) => u.nameZh)),
  ];
  const pua = strings.filter((s) => PUA_RE.test(s) || s === "");
  checks.push(
    pua.length
      ? { id: "no-pua-or-empty-names", status: "fail", detail: `unmapped PUA/empty: ${pua.slice(0, 5).join(", ")}` }
      : { id: "no-pua-or-empty-names", status: "pass", detail: `${strings.length} emitted names are plain Unicode` },
  );

  const usedCodes = [...new Set(ds.candidates.map((c) => c.partyCode))];
  checks.push(checkPartyColors(usedCodes, colors));

  const levels = levelsOf(d);
  const contests: Contest[] = contestList.map((ci) => ({
    id: ci.id,
    electionId: d.election.id,
    office: d.office,
    cecTypeCode: null,
    nameZh: multi ? (districtName.get(ci.key) ?? `${countyName.get(ci.county!) ?? ""}第${ci.dist}選區`) : d.nameZh,
    electorate: d.electorate,
    seats,
    choiceKind: d.choiceKind,
    districtId: multi ? `${ci.county}-${ci.dist}` : null,
    scope: multi ? { level: "district", districtId: `${ci.county}-${ci.dist}` } : { level: "national" },
    availableLevels: levels,
    partyList: isList ? partyList : null,
    referendum: null,
    warnings: [],
  }));

  const townParts = multi
    ? results.town!.units.map((u) => {
        const code = u.id.slice(3); // "63000010-07"
        return { code, town: code.slice(0, 8), district: `${code.slice(0, 5)}-${code.slice(9)}` };
      })
    : results.town!.units.map((u) => ({ code: u.id.slice(5), town: u.id.slice(5), district: null }));

  return {
    group: { id: gid, nameZh: d.nameZh, office: d.office, electorate: d.electorate, levels, warnings: d.warnings },
    contests,
    choices,
    candidacies,
    persons,
    parties: usedCodes.map((code) => toParty(partyByCode.get(code)!, colors)),
    results,
    townParts,
    checks,
  };
}

/** Cross-check CEC's party-list allocation against the votes and the elected list members. */
function checkPartyList(
  ci: ContestInfo,
  row: ElUnit,
  list: ElPartyList,
  candidacies: Candidacy[],
  seats: number,
  ballots: number[],
  ds: ElDataset,
  bad: string[],
): NonNullable<Contest["partyList"]> {
  const codeOfBallot = new Map(ds.candidates.map((c) => [c.ballotNumber, c.partyCode]));
  const votes = new Map(ballots.map((n) => [codeOfBallot.get(n)!, row.votes.get(n) ?? 0]));
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  const published = new Map(list.results.map((r) => [r.partyCode, r]));
  const recount = largestRemainder(votes, seats, PARTY_LIST_THRESHOLD.pct);
  let seatSum = 0;
  for (const [code, v] of votes) {
    const r = published.get(code);
    if (!r) { bad.push(`${ci.id}: party ${code} missing from elretks`); continue; }
    seatSum += r.seats;
    const share = total ? (v / total) * 100 : 0;
    if (Math.abs(share - r.voteSharePct) > 0.00006) bad.push(`${ci.id}: party ${code} share ${share.toFixed(4)} vs published ${r.voteSharePct}`);
    if ((recount.get(code) ?? 0) !== r.seats) bad.push(`${ci.id}: party ${code} seats ${r.seats} vs recount ${recount.get(code) ?? 0}`);
    const elected = candidacies.filter((c) => c.partyId === partyId(code) && c.elected).length;
    if (elected !== r.seats) bad.push(`${ci.id}: party ${code} has ${elected} elected list members vs ${r.seats} seats`);
    const nominated = list.members.filter((m) => m.partyCode === code).length;
    if (nominated !== r.nominated) bad.push(`${ci.id}: party ${code} lists ${nominated} members vs ${r.nominated} published`);
  }
  if (seatSum !== seats) bad.push(`${ci.id}: published seats sum to ${seatSum}, expected ${seats}`);
  if (published.size !== votes.size) bad.push(`${ci.id}: elretks has ${published.size} parties, ballot has ${votes.size}`);
  return {
    thresholdPct: PARTY_LIST_THRESHOLD.pct,
    thresholdBasis: PARTY_LIST_THRESHOLD.basis,
    allocation: [...votes.keys()].map((code) => {
      const r = published.get(code)!;
      return {
        partyId: partyId(code),
        voteSharePct: r.voteSharePct,
        qualifiedSharePct: r.voteSharePct >= PARTY_LIST_THRESHOLD.pct ? r.qualifiedSharePct : null,
        nominated: r.nominated,
        seats: r.seats,
      };
    }),
  };
}
