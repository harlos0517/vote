/**
 * Pre-election groups for a live feed: an election that has candidates but no results yet.
 *
 * Contests and choices come from a reviewed CSV transcribed from the election commissions'
 * candidate-list notices (候選人名單公告), one row per candidate with its source. Units and
 * boundaries are borrowed from a published group of the previous election (county and town
 * level only, where codes are stable). The group lives inside the live feed, never in a v2
 * release, so the published site is not touched.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GroupMetadataFile,
  GroupResultsFile,
  SCHEMA_VERSION,
  type BallotChoice,
  type Contest,
  type LiveGroupMetadataRef,
  type Party,
  type ReportingLevel,
} from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";
import { writeAtomic } from "./files.ts";

export interface CandidateRow {
  election: string;
  cecType: string;
  county: string;
  countyName: string;
  ballotNumber: number;
  name: string;
  party: string;
  source: string;
  method: "text" | "scan";
  status: "unreviewed" | "reviewed";
}

const HEADER = ["election", "cec_type", "county", "county_name", "ballot_number", "name", "party", "source", "method", "status"];

export function readCandidateCsv(path: string): CandidateRow[] {
  const rows = parseCecCsv(readFileSync(path, "utf8"));
  const head = rows.shift();
  if (head?.join(",") !== HEADER.join(",")) throw new Error(`${path}: header must be ${HEADER.join(",")}`);
  const out = rows.map((r, i) => {
    const [election, cecType, county, countyName, n, name, party, source, method, status] = r as string[];
    const line = i + 2;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z-]+$/.test(election!)) throw new Error(`${path}:${line}: bad election "${election}"`);
    if (!/^[A-Z]\d$/.test(cecType!)) throw new Error(`${path}:${line}: bad cec_type "${cecType}"`);
    if (!/^\d{5}$/.test(county!)) throw new Error(`${path}:${line}: bad county "${county}"`);
    if (!/^[1-9]\d*$/.test(n!)) throw new Error(`${path}:${line}: bad ballot_number "${n}"`);
    if (!name || !party) throw new Error(`${path}:${line}: name and party are required`);
    if (!/^https:\/\//.test(source!)) throw new Error(`${path}:${line}: source must be an https URL`);
    if (method !== "text" && method !== "scan") throw new Error(`${path}:${line}: method must be text or scan`);
    if (status !== "unreviewed" && status !== "reviewed") throw new Error(`${path}:${line}: status must be unreviewed or reviewed`);
    return { election: election!, cecType: cecType!, county: county!, countyName: countyName!, ballotNumber: Number(n), name, party, source: source!, method, status } satisfies CandidateRow;
  });
  // One contest per county: ballot numbers 1..n, no repeats.
  const byCounty = new Map<string, CandidateRow[]>();
  for (const r of out) byCounty.set(r.county, [...(byCounty.get(r.county) ?? []), r]);
  for (const [county, rs] of byCounty) {
    const nums = rs.map((r) => r.ballotNumber).sort((a, b) => a - b);
    if (nums.some((n, i) => n !== i + 1)) throw new Error(`${path}: county ${county} ballot numbers are ${nums.join(",")}, expected 1..${nums.length}`);
    if (new Set(rs.map((r) => r.cecType)).size !== 1) throw new Error(`${path}: county ${county} mixes cec_type values`);
  }
  if (new Set(out.map((r) => r.election)).size !== 1) throw new Error(`${path}: rows from more than one election`);
  return out;
}

export interface PrelimInput {
  rows: CandidateRow[];
  election: { id: string; date: string; nameZh: string };
  /** Published group of the previous election whose units and boundaries are reused. */
  base: { metadata: GroupMetadataFile; results: Partial<Record<ReportingLevel, GroupResultsFile>>; release: string };
  /** All known parties (v2 parties.json); matched by exact name. */
  parties: Party[];
  levels: ReportingLevel[];
  /** Local part of the new group id, e.g. "mayor". */
  local: string;
}

export interface PrelimGroup {
  metadata: GroupMetadataFile;
  units: Partial<Record<ReportingLevel, GroupResultsFile>>;
  metadataRef: LiveGroupMetadataRef;
  /** Party names with no CEC party code in our table; their choices have partyId null. */
  unknownParties: string[];
}

export const prelimPaths = {
  metadata: (groupId: string) => `groups/${groupId}/metadata.json`,
  units: (groupId: string, level: ReportingLevel) => `groups/${groupId}/units/${level}.json`,
};

export function buildPrelimGroup(p: PrelimInput): PrelimGroup {
  const { rows, election, base } = p;
  const groupId = `${election.id}.${p.local}`;
  const contestIdOf = (county: string) => `${election.id}.c1-${county}`;
  const baseByCounty = new Map(base.metadata.contests.map((c) => [c.scope.level === "county" ? c.scope.code : "", c]));

  const counties = [...new Set(rows.map((r) => r.county))];
  const missing = base.metadata.contests.filter((c) => c.scope.level === "county" && !counties.includes(c.scope.code));
  if (missing.length > 0) throw new Error(`no candidates for ${missing.map((c) => c.nameZh).join("、")}`);

  const contests: Contest[] = counties.map((county) => {
    const b = baseByCounty.get(county);
    if (!b) throw new Error(`county ${county} has no contest in ${base.metadata.group.id}`);
    return { ...b, id: contestIdOf(county), electionId: election.id, cecTypeCode: rows.find((r) => r.county === county)!.cecType, availableLevels: p.levels, date: null, warnings: [] };
  });

  const partyByName = new Map(p.parties.map((x) => [x.nameZh, x]));
  const independent = p.parties.find((x) => x.isIndependent);
  const partyOf = (name: string) => (name === "無" ? independent : partyByName.get(name));
  const unknownParties = [...new Set(rows.map((r) => r.party).filter((n) => !partyOf(n)))];

  const choices: BallotChoice[] = rows.map((r) => ({
    id: `${r.county}.n${r.ballotNumber}`,
    contestId: contestIdOf(r.county),
    kind: "candidate",
    ballotNumber: r.ballotNumber,
    candidacyIds: [],
    partyId: partyOf(r.party)?.id ?? null,
    labelZh: r.name,
  }));
  const usedParties = p.parties.filter((x) => choices.some((c) => c.partyId === x.id));

  // Units: same ids, contest ids moved to the new election.
  const idMap = new Map(base.metadata.contests.map((c) => [c.id, c.scope.level === "county" ? contestIdOf(c.scope.code) : null]));
  const units: PrelimGroup["units"] = {};
  for (const level of p.levels) {
    const f = base.results[level];
    if (!f) throw new Error(`${base.metadata.group.id} has no ${level} units`);
    units[level] = GroupResultsFile.parse({
      schemaVersion: SCHEMA_VERSION,
      groupId,
      level,
      units: f.units.map((u) => ({ ...u, contestIds: u.contestIds.map((id) => idMap.get(id) ?? (() => { throw new Error(`unit ${u.id}: contest ${id} has no 2026 counterpart`); })()) })),
      rows: [],
    });
  }

  const unreviewed = rows.filter((r) => r.status !== "reviewed").length;
  const scanned = rows.filter((r) => r.method === "scan").length;
  const warnings = [
    `尚未開票：候選人與號次依各選舉委員會候選人名單公告${unreviewed > 0 ? `轉錄，${unreviewed} 筆尚未人工審核` : ""}${scanned > 0 ? `（其中 ${scanned} 筆取自掃描檔）` : ""}。`,
    `統計單位與界線沿用 ${base.metadata.election.nameZh}（${base.metadata.boundary.versionId}），只到鄉鎮市區層級。`,
    ...(unknownParties.length > 0 ? [`以下推薦政黨在本站政黨表中沒有中選會代碼，地圖以未分類顯示：${unknownParties.join("、")}。`] : []),
  ];
  const levelSet = new Set<string>(p.levels);
  const metadata = GroupMetadataFile.parse({
    schemaVersion: SCHEMA_VERSION,
    release: base.release,
    election: { id: election.id, date: election.date, nameZh: election.nameZh, kinds: base.metadata.election.kinds, sources: [] },
    group: { ...base.metadata.group, id: groupId, levels: p.levels, warnings },
    contests,
    choices,
    candidacies: [],
    persons: [],
    parties: usedParties,
    sources: [
      {
        id: "cec-2026-candidate-notices",
        publisher: "中央選舉委員會、各直轄市及縣（市）選舉委員會",
        title: "115年地方公職人員選舉候選人名單公告",
        url: "https://web.cec.gov.tw/central/article/64709",
        license: "未標示",
        attribution: "候選人名單：各直轄市及縣（市）選舉委員會公告",
      },
      ...base.metadata.sources.filter((s) => s.id === base.metadata.boundary.sourceId),
    ],
    boundary: {
      ...base.metadata.boundary,
      files: Object.fromEntries(Object.entries(base.metadata.boundary.files).filter(([l]) => levelSet.has(l))),
      notes: base.metadata.boundary.notes.filter((n) => /^(cty|town|nat)/.test(n.unit)),
    },
    results: Object.fromEntries(p.levels.map((l) => [l, prelimPaths.units(groupId, l)])),
    validation: [
      { id: "candidates-transcribed", status: unreviewed > 0 ? "warn" : "pass", detail: `${rows.length} 位候選人、${contests.length} 個選區；${unreviewed} 筆待審核。` },
    ],
  });
  return { metadata, units, metadataRef: { feedPath: prelimPaths.metadata(groupId), geographyRelease: base.release }, unknownParties };
}

export function writePrelimGroup(feedDir: string, g: PrelimGroup) {
  writeAtomic(join(feedDir, prelimPaths.metadata(g.metadata.group.id)), JSON.stringify(g.metadata));
  for (const [level, f] of Object.entries(g.units)) writeAtomic(join(feedDir, prelimPaths.units(g.metadata.group.id, level as ReportingLevel)), JSON.stringify(f));
}

/** Loads a pre-election group a feed carries, in the shape the poller wants. */
export function loadFeedGroup(feedDir: string, groupId: string) {
  const path = join(feedDir, prelimPaths.metadata(groupId));
  if (!existsSync(path)) return null;
  const metadata = GroupMetadataFile.parse(JSON.parse(readFileSync(path, "utf8")));
  const results: Partial<Record<ReportingLevel, GroupResultsFile>> = {};
  for (const [level, rel] of Object.entries(metadata.results)) results[level as ReportingLevel] = GroupResultsFile.parse(JSON.parse(readFileSync(join(feedDir, rel), "utf8")));
  return { metadata, results, metadataRef: { feedPath: prelimPaths.metadata(groupId), geographyRelease: metadata.release } as LiveGroupMetadataRef };
}
