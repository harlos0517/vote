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
import { type ElDataset, type ElKey, type ElUnit, countyCode, keyString, townCode } from "../adapters/cec-el.ts";
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
  choiceKind: "ticket" | "candidate";
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

export function buildElGroup(d: ElGroupDef, ds: ElDataset, colors: Map<number, PartyColor>): BuiltGroup {
  const gid = groupId(d);
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

  // ---- winners (single-seat contests): the marked candidate must top the contest's own row
  const topRowOf = (ci: ContestInfo) =>
    ds.units.find((u) => (multi ? u.level === "district" && contestKeyOf(u.key) === ci.key : u.level === "national"));
  const winnerBad: string[] = [];
  for (const ci of contestList) {
    const row = topRowOf(ci);
    if (!row) { winnerBad.push(`${ci.id}: no contest-level row`); continue; }
    const nums = ballotsByContest.get(ci.key)!;
    const top = nums.reduce((a, b) => ((row.votes.get(b) ?? 0) > (row.votes.get(a) ?? 0) ? b : a));
    const marked = candidacies.filter((c) => c.contestId === ci.id && c.elected).map((c) => c.ballotNumber);
    if (marked.length !== 1 || marked[0] !== top) winnerBad.push(`${ci.id}: marked ${marked.join(",") || "none"} vs top #${top}`);
  }
  checks.push(
    winnerBad.length
      ? { id: "winner-consistent", status: "fail", detail: winnerBad.slice(0, 5).join("; ") }
      : { id: "winner-consistent", status: "pass", detail: `${contestList.length} contests: the elected candidate has the most votes` },
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
    seats: 1,
    choiceKind: d.choiceKind,
    districtId: multi ? `${ci.county}-${ci.dist}` : null,
    scope: multi ? { level: "district", districtId: `${ci.county}-${ci.dist}` } : { level: "national" },
    availableLevels: levels,
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
