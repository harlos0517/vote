/**
 * Pre-election groups for a live feed: an election that has candidates but no results yet.
 *
 * Contests and choices come from a reviewed CSV, one row per candidate with its source:
 *  - by county (縣市長): ballot numbers from the commissions' 候選人名單公告;
 *  - by town (鄉鎮市長): CEC's registration roster, without ballot numbers; on counting night
 *    the poller matches page rows to these candidates by name.
 * A referendum needs no candidates (buildPrelimReferendum). Units and boundaries are borrowed
 * from a published group of the previous election (county and town level only, where codes are
 * stable). The group lives inside the live feed, never in a v2 release.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GroupMetadataFile,
  GroupResultsFile,
  LIVE_SCHEMA_VERSION,
  LiveManifestFile,
  LiveSnapshotFile,
  SCHEMA_VERSION,
  type BallotChoice,
  type Contest,
  type LiveGroupMetadataRef,
  type Party,
  type ReportingLevel,
} from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";
import { livePaths, writeAtomic } from "./files.ts";

export interface CandidateRow {
  election: string;
  cecType: string;
  /** County code (5 digits) or town code (8 digits): the contest's area. */
  area: string;
  areaName: string;
  /** Null when the source has no ballot numbers (registration roster). */
  ballotNumber: number | null;
  name: string;
  party: string;
  source: string;
  method: "text" | "scan";
  status: "unreviewed" | "reviewed";
}

const HEADER_COUNTY = ["election", "cec_type", "county", "county_name", "ballot_number", "name", "party", "source", "method", "status"];
const HEADER_TOWN = ["election", "cec_type", "town", "county_name", "town_name", "name", "party", "source", "method", "status"];

export function readCandidateCsv(path: string): CandidateRow[] {
  const rows = parseCecCsv(readFileSync(path, "utf8"));
  const head = rows.shift()?.join(",");
  const byTown = head === HEADER_TOWN.join(",");
  if (!byTown && head !== HEADER_COUNTY.join(",")) throw new Error(`${path}: header must be ${HEADER_COUNTY.join(",")} or ${HEADER_TOWN.join(",")}`);
  const out = rows.map((r, i) => {
    const line = i + 2;
    const [election, cecType, area, a, b, name, party, source, method, status] = r as string[];
    const areaName = byTown ? `${a}${b}` : a!;
    const n = byTown ? null : b!;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z-]+$/.test(election!)) throw new Error(`${path}:${line}: bad election "${election}"`);
    if (!/^[A-Z]\d$/.test(cecType!)) throw new Error(`${path}:${line}: bad cec_type "${cecType}"`);
    if (!(byTown ? /^\d{8}$/ : /^\d{5}$/).test(area!)) throw new Error(`${path}:${line}: bad ${byTown ? "town" : "county"} "${area}"`);
    if (n !== null && !/^[1-9]\d*$/.test(n)) throw new Error(`${path}:${line}: bad ballot_number "${n}"`);
    if (!name || !party) throw new Error(`${path}:${line}: name and party are required`);
    if (/\s/.test(name)) throw new Error(`${path}:${line}: name contains whitespace`);
    if (!/^https:\/\//.test(source!)) throw new Error(`${path}:${line}: source must be an https URL`);
    if (method !== "text" && method !== "scan") throw new Error(`${path}:${line}: method must be text or scan`);
    if (status !== "unreviewed" && status !== "reviewed") throw new Error(`${path}:${line}: status must be unreviewed or reviewed`);
    return { election: election!, cecType: cecType!, area: area!, areaName, ballotNumber: n === null ? null : Number(n), name, party, source: source!, method, status } satisfies CandidateRow;
  });
  // One contest per area: ballot numbers 1..n when known, names unique when not.
  const byArea = new Map<string, CandidateRow[]>();
  for (const r of out) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  for (const [area, rs] of byArea) {
    if (byTown) {
      const keys = rs.map((r) => nameKey(r.name));
      if (new Set(keys).size !== keys.length) throw new Error(`${path}: town ${area} has two candidates with the same name; they cannot be told apart by name`);
    } else {
      const nums = rs.map((r) => r.ballotNumber!).sort((x, y) => x - y);
      if (nums.some((x, i) => x !== i + 1)) throw new Error(`${path}: county ${area} ballot numbers are ${nums.join(",")}, expected 1..${nums.length}`);
    }
    if (new Set(rs.map((r) => r.cecType)).size !== 1) throw new Error(`${path}: ${area} mixes cec_type values`);
  }
  if (new Set(out.map((r) => r.election)).size !== 1) throw new Error(`${path}: rows from more than one election`);
  return out;
}

/**
 * Name used to match a roster name with a counting page: Han characters only. Romanised
 * indigenous names, separators and spaces vary between sources (and PDF line wraps).
 */
export const nameKey = (name: string) => [...name.matchAll(/[\p{Script=Han}\p{Co}]/gu)].map((m) => m[0]).join("");

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
  const codeOf = (c: Contest) => ("code" in c.scope ? c.scope.code : "");
  const baseByArea = new Map(base.metadata.contests.map((c) => [codeOf(c), c]));
  // Same local id as the base contest ("c1-63000", "d1-10002010"), moved to the new election.
  const contestIdOf = (area: string) => `${election.id}.${baseByArea.get(area)!.id.split(".")[1]}`;

  const areas = [...new Set(rows.map((r) => r.area))];
  const missing = base.metadata.contests.filter((c) => !areas.includes(codeOf(c)));
  if (missing.length > 0) throw new Error(`no candidates for ${missing.map((c) => c.nameZh).join("、")}`);

  const contests: Contest[] = areas.map((area) => {
    const b = baseByArea.get(area);
    if (!b) throw new Error(`${area} has no contest in ${base.metadata.group.id}`);
    return { ...b, id: contestIdOf(area), electionId: election.id, cecTypeCode: rows.find((r) => r.area === area)!.cecType, availableLevels: p.levels, date: null, warnings: [] };
  });

  const partyByName = new Map(p.parties.map((x) => [x.nameZh, x]));
  const independent = p.parties.find((x) => x.isIndependent);
  const partyOf = (name: string) => (name === "無" ? independent : partyByName.get(name));
  const unknownParties = [...new Set(rows.map((r) => r.party).filter((n) => !partyOf(n)))];

  // Without ballot numbers, ids follow the CSV order within the area ("r1", "r2", …).
  const rank = new Map<string, number>();
  const choices: BallotChoice[] = rows.map((r) => ({
    id: r.ballotNumber !== null ? `${r.area}.n${r.ballotNumber}` : `${r.area}.r${rank.set(r.area, (rank.get(r.area) ?? 0) + 1).get(r.area)}`,
    contestId: contestIdOf(r.area),
    kind: "candidate",
    ballotNumber: r.ballotNumber,
    candidacyIds: [],
    partyId: partyOf(r.party)?.id ?? null,
    labelZh: r.name,
  }));
  const usedParties = p.parties.filter((x) => choices.some((c) => c.partyId === x.id));

  // Units: same ids, contest ids moved to the new election.
  const idMap = new Map(base.metadata.contests.map((c) => [c.id, contestIdOf(codeOf(c))]));
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
  const noNumbers = rows.some((r) => r.ballotNumber === null);
  const warnings = [
    noNumbers
      ? `候選人依中選會候選人登記彙總表${unreviewed > 0 ? `（${unreviewed} 筆尚未人工審核）` : ""}；登記後若有資格不符或撤回，名單可能多於實際候選人。號次未預先登錄，開票時依中選會頁面的姓名對應。`
      : `尚未開票：候選人與號次依各選舉委員會候選人名單公告${unreviewed > 0 ? `轉錄，${unreviewed} 筆尚未人工審核` : ""}${scanned > 0 ? `（其中 ${scanned} 筆取自掃描檔）` : ""}。`,
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

export interface PrelimReferendumInput {
  election: { id: string; date: string; nameZh: string };
  caseNumber: number;
  question: { text: string; source: string; reviewed: boolean };
  rule: NonNullable<Contest["referendum"]>["rule"];
  /** A published national referendum group whose units and boundaries are reused. */
  base: PrelimInput["base"];
  levels: ReportingLevel[];
}

/** A national referendum case with no results yet: 同意／不同意, the question and the rule. */
export function buildPrelimReferendum(p: PrelimReferendumInput): PrelimGroup {
  const { base, election } = p;
  if (base.metadata.contests.length !== 1 || base.metadata.contests[0]!.choiceKind !== "referendum") throw new Error(`${base.metadata.group.id} is not a single referendum case`);
  const b = base.metadata.contests[0]!;
  const local = `case-${p.caseNumber}`;
  const groupId = `${election.id}.${local}`;
  const contestId = groupId;
  const nameZh = `全國性公民投票案第${p.caseNumber}案`;
  const contest: Contest = {
    ...b,
    id: contestId,
    electionId: election.id,
    office: "referendum-national",
    nameZh,
    cecTypeCode: null,
    availableLevels: p.levels,
    date: null,
    referendum: { caseNumber: p.caseNumber, questionZh: p.question.text, questionSource: p.question.source, questionReviewed: p.question.reviewed, rule: p.rule, outcome: null },
    warnings: [],
  };
  const choices: BallotChoice[] = (["agree", "disagree"] as const).map((k) => ({ id: k, contestId, kind: k, ballotNumber: null, candidacyIds: [], partyId: null, labelZh: k === "agree" ? "同意" : "不同意" }));
  const units: PrelimGroup["units"] = {};
  for (const level of p.levels) {
    const f = base.results[level];
    if (!f) throw new Error(`${base.metadata.group.id} has no ${level} units`);
    units[level] = GroupResultsFile.parse({ schemaVersion: SCHEMA_VERSION, groupId, level, units: f.units.map((u) => ({ ...u, contestIds: [contestId] })), rows: [] });
  }
  const levelSet = new Set<string>(p.levels);
  const metadata = GroupMetadataFile.parse({
    schemaVersion: SCHEMA_VERSION,
    release: base.release,
    election: { id: election.id, date: election.date, nameZh: election.nameZh, kinds: ["referendum"], sources: [] },
    group: {
      ...base.metadata.group,
      id: groupId,
      nameZh,
      office: "referendum-national",
      levels: p.levels,
      warnings: [
        `尚未開票。主文取自中央選舉委員會公告${p.question.reviewed ? "" : "，尚未人工核對"}。`,
        `統計單位與界線沿用 ${base.metadata.election.nameZh}（${base.metadata.boundary.versionId}），只到鄉鎮市區層級。`,
      ],
    },
    contests: [contest],
    choices,
    candidacies: [],
    persons: [],
    parties: [],
    sources: [
      { id: "cec-referendum-announcement", publisher: "中央選舉委員會", title: nameZh, url: p.question.source.match(/https:\/\/\S+/)?.[0] ?? "https://web.cec.gov.tw/central", license: "未標示", attribution: "主文：中央選舉委員會公告" },
      ...base.metadata.sources.filter((x) => x.id === base.metadata.boundary.sourceId),
    ],
    boundary: {
      ...base.metadata.boundary,
      files: Object.fromEntries(Object.entries(base.metadata.boundary.files).filter(([l]) => levelSet.has(l))),
      notes: base.metadata.boundary.notes.filter((n) => /^(cty|town|nat)/.test(n.unit)),
    },
    results: Object.fromEntries(p.levels.map((l) => [l, prelimPaths.units(groupId, l)])),
    validation: [{ id: "referendum-question", status: p.question.reviewed ? "pass" : "warn", detail: p.question.reviewed ? "主文已人工核對。" : "主文尚未人工核對。" }],
  });
  return { metadata, units, metadataRef: { feedPath: prelimPaths.metadata(groupId), geographyRelease: base.release }, unknownParties: [] };
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

/**
 * Before counting: give the group a seq-0 "not-started" snapshot and an entry in the feed's
 * manifest (created if missing), so the live page works before the poller first runs.
 * An existing latest.json is left alone: the poller may already be running.
 */
export function announcePrelimGroup(feedDir: string, feedId: string, g: PrelimGroup, now = new Date()) {
  const groupId = g.metadata.group.id;
  const latest = join(feedDir, livePaths.latest(groupId));
  if (!existsSync(latest)) {
    const s = LiveSnapshotFile.parse({
      liveSchemaVersion: LIVE_SCHEMA_VERSION, feedId, groupId, seq: 0, status: "not-started",
      asOf: now.toISOString(), generatedAt: now.toISOString(), progressUnit: "station", rows: [],
    });
    writeAtomic(join(feedDir, livePaths.snapshot(groupId, 0)), JSON.stringify(s));
    writeAtomic(latest, JSON.stringify(s));
  }
  const current = LiveSnapshotFile.parse(JSON.parse(readFileSync(latest, "utf8")));
  const path = join(feedDir, livePaths.manifest());
  const old = existsSync(path) ? LiveManifestFile.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
  const entry = { groupId, nameZh: g.metadata.group.nameZh, metadata: g.metadataRef, latest: livePaths.latest(groupId), seq: current.seq, status: current.status };
  const manifest = LiveManifestFile.parse({
    liveSchemaVersion: LIVE_SCHEMA_VERSION,
    feedId,
    mode: "cec-public",
    labelZh: "開票中數字取自中央選舉委員會開票網站，非最終結果，以中央選舉委員會公告為準",
    election: { id: g.metadata.election.id, nameZh: g.metadata.election.nameZh, date: g.metadata.election.date },
    source: { id: "cec-live", publisher: "中央選舉委員會", title: "計票資訊查詢網站", url: null, license: "未標示", attribution: "資料來源：中央選舉委員會" },
    pollIntervalSeconds: 120,
    ...(old ?? {}),
    updatedAt: now.toISOString(),
    groups: [...(old?.groups.filter((x) => x.groupId !== groupId) ?? []), entry],
  });
  writeAtomic(path, JSON.stringify(manifest, null, 2) + "\n");
}
