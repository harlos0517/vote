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
import { type StationInput, stationFiles } from "./stations.ts";

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
  /** Paths of the el* directories inside votedata.zip (2022 splits an office into prv/ and city/). */
  archiveDirs: string[];
  /** Extra non-el* source merged into the group (adapter name + its path in the zip). */
  extra?: { adapter: "chiayi-2022-rerun"; archiveDir: string; refArchiveDir: string; date: string };
  /**
   * "single": one nationwide contest. "county": one contest per county (縣市長).
   * "district": one contest per (county, 選區). "town": one per township (鄉鎮市長, 區長).
   * "village": one per village (村里長). "town-district": one per 選區 inside a township
   * (鄉鎮市民代表), mapped at township and village level without district shapes.
   */
  contests: "single" | "county" | "district" | LocalContests;
  /** CEC 選舉種類代碼 (2022: "C1", "T1"); none for 2024's national elections. */
  cecTypeCode?: string;
  /** Contest id infix, e.g. "ly" → `<election>.ly-63000-d01`, "c1" → `<election>.c1-63000`. */
  contestPrefix?: string;
  /** Contest name after the county name for "county" groups, e.g. "長" → 臺北市長. */
  contestNameSuffix?: string;
  /** Village-boundary snapshot used for every map level. */
  boundary: BoundaryDef;
  /** Publish the 村里 level (Phase 2). */
  villages?: boolean;
  /** Take townships whose villages are missing from `boundary` from the nearest snapshot that has them (geo/mix.ts). */
  mixSnapshots?: boolean;
  /** "party": 不分區政黨票 — the ballot lists parties; list members come from elrepm.csv. */
  choiceKind: "ticket" | "candidate" | "party" | "referendum";
  /** 2018 rf*: el* directories (same day) whose elbase gives each township's registry code by name. */
  rfTownCodesFrom?: string[];
  /** "rf": a national referendum case in rf* files (built by rf-group.ts); default "el". */
  format?: "el" | "rf";
  referendumCase?: number;
  /**
   * Read only township rows and above: 2016's 原住民立委 vote files list stations and village
   * groups that their summary file folds into other villages, so only township totals and up agree.
   */
  townsAndAbove?: boolean;
  /** Seats per contest (default 1); 原住民立委 elect 3 in one nationwide contest. */
  seats?: number;
  /** Boundary layout name used in geography paths ("admin" = plain counties/towns). */
  layout: string;
  warnings: string[];
}

export interface BoundaryDef {
  /** Published id, e.g. "nlsc-village-1120928". */
  versionId: string;
  /** Key of the raw source in RAW_SOURCES and the shapefile name inside it. */
  raw: "nlscVillage106" | "nlscVillage107" | "nlscVillage108" | "nlscVillage109" | "nlscVillage110" | "nlscVillage111" | "nlscVillage112";
  shapefile: RegExp;
  /** The published coordinates are corrupt: restore them by an affine fit against this sound snapshot (geo/restore.ts). */
  restoreFrom?: BoundaryDef;
}

/** Contest modes below the county: each township or village has its own race(s). */
export type LocalContests = "town" | "village" | "town-district";
export const isLocalContests = (c: ElGroupDef["contests"]): c is LocalContests => c === "town" || c === "village" || c === "town-district";

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
  const base: ReportingLevel[] = d.contests === "district" ? ["national", "county", "district", "town"] : ["national", "county", "town"];
  return d.villages ? [...base, "village"] : base;
}

/**
 * 村里 unit id: "vil:<MOI village code>" for a single village, "vgrp:<town>-<CEC code>" for a group
 * sharing stations. Groups have letter codes ("0A01") or, in 2021's rf* files, numeric codes that
 * look like villages ("0010") but are named with 「、」 (復興村、福沃村), so the name decides too.
 */
export function villageUnitId(k: ElKey, name: string): string {
  const tc = townCode(k);
  return /^0\d{3}$/.test(k.vil) && !name.includes("、") ? `vil:${tc}${k.vil.slice(1)}` : `vgrp:${tc}-${k.vil}`;
}

function contestIdOf(d: ElGroupDef, county: string | null, dist: string | null, key: string): string {
  const prefix = d.contestPrefix ?? "ly";
  if (isLocalContests(d.contests)) return `${d.election.id}.${prefix}-${key}`;
  if (d.contests === "district") return `${d.election.id}.${prefix}-${county}-d${dist}`;
  if (d.contests === "county") return `${d.election.id}.${prefix}-${county}`;
  return groupId(d);
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
  /** Polling-station results per county code (only for groups published to 村里 level). */
  stations?: Record<string, GroupResultsFile>;
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
  const seats = d.seats ?? 1; // party list only; candidate contests use seatsOf()
  const isList = d.choiceKind === "party";
  if (isList && !list) throw new Error(`${gid}: party-list group needs elrepm/elretks`);
  const multi = d.contests === "district";
  const byCounty = d.contests === "county";
  const local = isLocalContests(d.contests) ? d.contests : null;
  const contestKeyOf = (k: ElKey): string | null => {
    switch (d.contests) {
      case "district":
        return k.dist === "00" ? null : `${countyCode(k)}-${k.dist}`;
      case "county":
        return k.prv === "00" ? null : countyCode(k);
      case "town":
        return k.town === "000" ? null : townCode(k);
      case "village":
        return k.vil === "0000" ? null : `${townCode(k)}-${k.vil}`;
      case "town-district":
        return k.town === "000" || k.dist === "00" ? null : `${townCode(k)}-${k.dist}`;
      default:
        return "main";
    }
  };

  // ---- contests
  const countyName = new Map(ds.units.filter((u) => u.level === "county").map((u) => [countyCode(u.key), u.name]));
  const districtName = new Map(ds.units.filter((u) => u.level === "district").map((u) => [`${countyCode(u.key)}-${u.key.dist}`, u.name]));
  const infos = new Map<string, ContestInfo>();
  for (const c of ds.candidates) {
    const key = contestKeyOf(c.key);
    if (!key || infos.has(key)) continue;
    const county = multi || byCounty || local ? countyCode(c.key) : null;
    const dist = multi || local === "town-district" ? c.key.dist : null;
    infos.set(key, {
      key,
      id: contestIdOf(d, county, dist, key),
      county,
      dist,
      choicePrefix: multi ? `${county}-d${dist}.` : byCounty ? `${county}.` : local ? `${key}.` : "",
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
          // Tickets carry the elected mark on the principal row only. "?" = tied, decided by lot (result not published here).
          elected: c.isRunningMate || mark === "?" ? null : mark === "*" || mark === "!",
          electedNote: c.isRunningMate ? null : mark === "!" ? "women-quota" : mark === "-" ? "displaced-by-women-quota" : mark === "?" ? "tied-decided-by-lot" : null,
        });
      }
      choices.push({
        id: choiceId(ci, n),
        contestId: ci.id,
        kind: d.choiceKind as "ticket" | "candidate",
        ballotNumber: n,
        candidacyIds: [principal, ...(mate ? [mate] : [])].map((c) => `${ci.id}.n${n}.${c.isRunningMate ? "vp" : "p"}.candidacy`),
        partyId: partyId(principal.partyCode),
        labelZh: mate ? `${principal.name}／${mate.name}` : principal.name,
      });
    }
  }

  // Seats per contest: fixed by the definition, else the number CEC marks elected (議員 districts vary),
  // plus the one seat a draw decides where two candidates tied for it (every "?" case is 2-for-1).
  const seatsOf = (ci: ContestInfo) => {
    if (d.seats) return d.seats;
    const mine = candidacies.filter((c) => c.contestId === ci.id && c.role === "principal");
    return Math.max(1, mine.filter((c) => c.elected).length + (mine.some((c) => c.electedNote === "tied-decided-by-lot") ? 1 : 0));
  };

  // ---- winners: the marked candidates must be the contest's top seats (ties fail loudly)
  const contestLevel = multi ? "district" : byCounty ? "county" : local === "village" ? "village" : local ? "town" : "national";
  const topRowOf = (ci: ContestInfo) => ds.units.find((u) => u.level === contestLevel && (contestLevel === "national" || contestKeyOf(u.key) === ci.key));
  const winnerBad: string[] = [];
  let partyList: Contest["partyList"] = null;
  for (const ci of contestList) {
    const row = topRowOf(ci);
    if (!row) { winnerBad.push(`${ci.id}: no contest-level row`); continue; }
    if (isList) {
      partyList = checkPartyList(ci, row, list!, candidacies, seats, ballotsByContest.get(ci.key)!, ds, winnerBad);
      continue;
    }
    const n = seatsOf(ci);
    const nums = [...ballotsByContest.get(ci.key)!].sort((a, b) => (row.votes.get(b) ?? 0) - (row.votes.get(a) ?? 0));
    const cut = row.votes.get(nums[n - 1]!) ?? 0;
    const top = new Set(nums.slice(0, n));
    const mine = candidacies.filter((c) => c.contestId === ci.id && c.role === "principal");
    const votesOf = (c: Candidacy) => row.votes.get(c.ballotNumber) ?? 0;
    // 婦女保障名額: a woman outside the top n ("!") takes the place of the lowest-ranked man in it.
    const quota = mine.filter((c) => c.electedNote === "women-quota");
    const regular = mine.filter((c) => c.elected && c.electedNote !== "women-quota");
    // "?": two candidates tied for the last seat, decided by lot; both must have the cut-off votes.
    const lot = mine.filter((c) => c.electedNote === "tied-decided-by-lot");
    const tiedAtCut = nums.filter((x) => (row.votes.get(x) ?? 0) === cut);
    const explained = lot.length > 0 || quota.some((c) => votesOf(c) === cut);
    if (nums.length > n && (row.votes.get(nums[n]!) ?? 0) === cut && !explained) winnerBad.push(`${ci.id}: tie for the last seat`);
    const bad = lot.length
      ? lot.length !== 2 ||
        lot.some((c) => votesOf(c) !== cut) ||
        tiedAtCut.length !== 2 ||
        regular.length + quota.length !== n - 1 ||
        regular.some((c) => votesOf(c) <= cut)
      : regular.length + quota.length !== n ||
        regular.some((c) => !top.has(c.ballotNumber) && votesOf(c) !== cut) ||
        quota.some((c) => c.gender !== "F" || (top.has(c.ballotNumber) && votesOf(c) !== cut));
    if (bad) {
      const marked = mine.filter((c) => c.elected).map((c) => c.ballotNumber).sort((a, b) => a - b);
      winnerBad.push(`${ci.id}: marked ${marked.join(",") || "none"} vs top ${[...top].sort((a, b) => a - b).map((x) => `#${x}`).join(",")}`);
    }
  }
  const lotSeats = new Set(candidacies.filter((c) => c.electedNote === "tied-decided-by-lot").map((c) => c.contestId)).size;
  checks.push(
    winnerBad.length
      ? { id: "winner-consistent", status: "fail", detail: winnerBad.slice(0, 5).join("; ") }
      : isList
        ? { id: "winner-consistent", status: "pass", detail: `${seats} seats: CEC's per-party seats match the elected list members, the ${PARTY_LIST_THRESHOLD.pct}% threshold and a largest-remainder recount; published vote shares reproduce` }
        : {
            id: "winner-consistent",
            status: "pass",
            detail: `${contestList.length} contests, ${contestList.reduce((a, ci) => a + seatsOf(ci), 0)} seats: the elected candidates have the most votes${candidacies.some((c) => c.electedNote === "women-quota") ? " (women-quota seats replace the lowest-ranked man)" : ""}${lotSeats ? `; ${lotSeats} seats tied between two candidates and decided by lot (the draw's result is not in the data)` : ""}`,
          },
  );

  // ---- units and results per level
  const contestTopVotes = new Map<string, Record<string, number>>();
  for (const ci of contestList) {
    const row = topRowOf(ci)!;
    contestTopVotes.set(ci.key, Object.fromEntries([...row.votes].map(([n, v]) => [choiceId(ci, n), v])));
  }
  const contestsInCounty = (cc: string) => contestList.filter((ci) => ci.county === null || ci.county === cc);
  const contestsInTown = new Map<string, ContestInfo[]>();
  if (local) for (const ci of contestList) contestsInTown.set(ci.key.slice(0, 8), [...(contestsInTown.get(ci.key.slice(0, 8)) ?? []), ci]);
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
        const tc = townCode(u.key);
        if (local) {
          // The township as a whole (dist "00"); 代表 files also have a row per 選區 inside it, not mapped.
          if (u.key.dist !== "00") return null;
          const cs = contestsInTown.get(tc) ?? [];
          if (!cs.length) return null;
          return { unit: { id: `town:${tc}`, level: "town", nameZh: u.name, parentId: `cty:${cc}`, contestIds: cs.map((c) => c.id) }, contests: cs };
        }
        if (!ci) return null;
        if (!multi) return { unit: { id: `town:${tc}`, level: "town", nameZh: u.name, parentId: `cty:${cc}`, contestIds: [ci.id] }, contests: [ci] };
        const name = splitTowns.has(tc) ? `${u.name}（第${u.key.dist}選區部分）` : u.name;
        return { unit: { id: `tp:${tc}-${u.key.dist}`, level: "town", nameZh: name, parentId: `dist:${cc}-${u.key.dist}`, contestIds: [ci.id] }, contests: [ci] };
      }
      case "village": {
        if (!ci || !d.villages) return null;
        const tc = townCode(u.key);
        const parentId = multi ? `tp:${tc}-${u.key.dist}` : `town:${tc}`;
        return { unit: { id: villageUnitId(u.key, u.name), level: "village", nameZh: u.name, parentId, contestIds: [ci.id] }, contests: [ci] };
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
        // A 2022 directory's national row sums different counties' contests: never use it.
        // A row spanning several contests sums ballot numbers of different races: never use its votes.
        if (u.votes.size > 0 && m.contests.length === 1) {
          votes = Object.fromEntries([...u.votes].map(([n, v]) => [choiceId(m.contests[0]!, n), v]));
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

  // ---- polling stations (village groups only), each under the village unit it reports in
  let stations: Record<string, GroupResultsFile> | undefined;
  if (d.villages && results.village) {
    const emitted = new Set(results.village.units.map((u) => u.id));
    const villageRow = new Map(ds.units.filter((u) => u.level === "village").map((u) => [keyString(u.key), u]));
    const rows: StationInput[] = [];
    for (const u of ds.units) {
      if (u.level !== "station") continue;
      const v = villageRow.get(keyString({ ...u.key, station: "0000" }));
      const m = v ? unitOf(v) : null;
      if (!m || !emitted.has(m.unit.id) || m.contests.length !== 1) continue;
      const ci = m.contests[0]!;
      rows.push({ u, parentId: m.unit.id, contestIds: [ci.id], votes: Object.fromEntries([...u.votes].map(([n, x]) => [choiceId(ci, n), x])) });
    }
    stations = stationFiles(gid, rows);
    checks.push({ id: "stations", status: "pass", detail: `${rows.length} station rows in ${Object.keys(stations).length} counties (sums checked against their villages above)` });
  }

  // ---- each unit once per level (a village split between two 代表 選區 would appear twice)
  const dup = Object.values(results).flatMap((r) => {
    const seen = new Set<string>();
    return r!.units.map((u) => u.id).filter((id) => seen.has(id) || !seen.add(id));
  });
  checks.push(
    dup.length
      ? { id: "unique-units", status: "fail", detail: `units listed twice: ${[...new Set(dup)].slice(0, 5).join(", ")}` }
      : { id: "unique-units", status: "pass", detail: "every unit appears once per level" },
  );

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
  // "臺北市松山區莊敬里長", "連江縣南竿鄉長", "連江縣南竿鄉第1選舉區".
  const townName = new Map(ds.units.filter((u) => u.level === "town" && u.key.dist === "00").map((u) => [townCode(u.key), u.name]));
  const villageName = new Map(ds.units.filter((u) => u.level === "village").map((u) => [`${townCode(u.key)}-${u.key.vil}`, u.name]));
  const localContestName = (ci: ContestInfo) => {
    const place = `${countyName.get(ci.county!) ?? ""}${townName.get(ci.key.slice(0, 8)) ?? ""}`;
    if (local === "village") return `${place}${villageName.get(ci.key) ?? ""}${d.contestNameSuffix ?? "長"}`;
    if (local === "town-district") return `${place}第${Number(ci.dist)}選舉區`;
    return `${place}${d.contestNameSuffix ?? "長"}`;
  };
  const contests: Contest[] = contestList.map((ci) => ({
    id: ci.id,
    electionId: d.election.id,
    office: d.office,
    cecTypeCode: d.cecTypeCode ?? null,
    nameZh: multi
      ? (districtName.get(ci.key) ?? `${countyName.get(ci.county!) ?? ""}第${ci.dist}選區`)
      : byCounty
        ? `${countyName.get(ci.county!) ?? ci.county}${d.contestNameSuffix ?? ""}`
        : local
          ? localContestName(ci)
          : d.nameZh,
    electorate: d.electorate,
    seats: isList ? seats : seatsOf(ci),
    choiceKind: d.choiceKind,
    districtId: multi ? `${ci.county}-${ci.dist}` : null,
    scope: multi
      ? { level: "district", districtId: `${ci.county}-${ci.dist}` }
      : local === "village" && /^0\d{3}$/.test(ci.key.slice(9))
        ? { level: "village", code: ci.key.slice(0, 8) + ci.key.slice(10) }
        : local
          ? { level: "town", code: ci.key.slice(0, 8) }
          : byCounty
            ? { level: "county", code: ci.county! }
        : { level: "national" },
    availableLevels: levels,
    date: ds.contestNotes?.get(ci.key)?.date ?? null,
    partyList: isList ? partyList : null,
    referendum: null,
    warnings: ds.contestNotes?.get(ci.key)?.warnings ?? [],
  }));

  const townParts = multi
    ? results.town!.units.map((u) => {
        const code = u.id.slice(3); // "63000010-07"
        return { code, town: code.slice(0, 8), district: `${code.slice(0, 5)}-${code.slice(9)}` };
      })
    : results.town!.units.map((u) => ({ code: u.id.slice(5), town: u.id.slice(5), district: null }));

  return {
    group: { id: gid, nameZh: d.nameZh, office: d.office, electorate: d.electorate, levels, warnings: [...d.warnings] }, // own copy: the pipeline appends to it
    contests,
    choices,
    candidacies,
    persons,
    parties: usedCodes.map((code) => toParty(partyByCode.get(code)!, colors)),
    results,
    townParts,
    ...(stations ? { stations } : {}),
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
  // 2016's elretks also lists parties that were not on the ballot, all zero: allowed, nothing else extra.
  const extra = list.results.filter((r) => !votes.has(r.partyCode));
  if (extra.some((r) => r.voteSharePct !== 0 || r.seats !== 0 || r.nominated !== 0)) {
    bad.push(`${ci.id}: elretks has non-zero rows for parties not on the ballot: ${extra.filter((r) => r.voteSharePct || r.seats || r.nominated).map((r) => r.partyCode).join(", ")}`);
  }
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
