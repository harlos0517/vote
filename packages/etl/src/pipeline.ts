import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type DataSource,
  GroupMetadataFile,
  GroupResultsFile,
  PartiesFile,
  ReleaseIndexFile,
  type SourceFile,
  type ValidationCheck,
} from "@tw-election/schema";
import { DATA_SOURCES, RAW_SOURCES } from "./config/sources.ts";
import { ensureRaw, findFile, sha256File, unzip } from "./lib/raw.ts";
import { parseCecCsv } from "./lib/csv.ts";
import { type ElDataset, countyCode, mergeElDatasets, readElDir, readElPartyList, townCode } from "./adapters/cec-el.ts";
import { CHIAYI_CITY, readChiayiRerun } from "./adapters/cec-wide-chiayi.ts";
import { type BuiltGroup, type ElGroupDef, buildElGroup, groupId, toParty } from "./groups/el-group.ts";
import { ALL_SNAPSHOTS, GROUPS } from "./groups/defs.ts";
import { type Boundaries, type GeoJSON, type PartAssignment, buildBoundaries, buildVillages } from "./geo/build.ts";
import { loadVillageGroups, planVillages, villageGeoCode, villageGroupKey } from "./geo/villages.ts";
import { buildComposite, planMix, snapshotCodes, snapshotNames } from "./geo/mix.ts";
import { loadPartyColors } from "./lib/party-colors.ts";
import { applyPuaNames, loadPuaNames } from "./lib/pua-names.ts";
import { loadReferendumQuestions } from "./lib/referendum-questions.ts";
import { buildTimelines, loadElectionGroups } from "./lib/timelines.ts";
import { type RfDataset, readRfDir, renumberTowns, renumberVillages } from "./adapters/cec-rf.ts";
import { buildRfGroup } from "./groups/rf-group.ts";
import { RELEASE_TOKEN, json, writeRelease, type PendingFile } from "./emit/release.ts";

export interface PipelineOptions {
  rawDir: string;
  workDir: string;
  outDir: string;
  repoRoot: string;
  log?: (s: string) => void;
}

const MAJIA = "10013280";

export async function fetchAll(o: PipelineOptions) {
  for (const s of Object.values(RAW_SOURCES)) await ensureRaw(o.rawDir, s, o.log);
}

interface GroupOutput {
  def: ElGroupDef;
  built: BuiltGroup;
  geo: Boundaries;
  checks: ValidationCheck[];
  sources: SourceFile[];
  notes: { unit: string; note: string }[];
  village?: { geo: GeoJSON; path: string };
  boundaryVersion: string;
}

export async function build(o: PipelineOptions): Promise<{ ok: boolean; releaseId?: string; checks: ValidationCheck[] }> {
  const log = o.log ?? console.log;
  await fetchAll(o);

  // extract
  const cecWork = join(o.workDir, "cec-votedata");
  const zipDirs = GROUPS.flatMap((g) => [...g.archiveDirs, ...(g.extra ? [g.extra.archiveDir, g.extra.refArchiveDir] : [])]);
  unzip(join(o.rawDir, "cec-votedata", "votedata.zip"), cecWork, [...new Set(zipDirs)].map((d) => `${d}*`));
  const shapefiles = new Map<string, string>(); // boundary versionId → village .shp
  const snapshotsNeeded = [...GROUPS.map((g) => g.boundary), ...(GROUPS.some((g) => g.mixSnapshots) ? ALL_SNAPSHOTS : [])];
  for (const b of new Map(snapshotsNeeded.map((s) => [s.versionId, s])).values()) {
    const raw = RAW_SOURCES[b.raw];
    const villWork = join(o.workDir, "nlsc-village-history", raw.file.replace(/\.bin$/, ""));
    unzip(join(o.rawDir, raw.id, raw.file), villWork);
    unzip(findFile(villWork, /\.zip$/), villWork);
    shapefiles.set(b.versionId, findFile(villWork, b.shapefile));
  }
  const partyColors = loadPartyColors(o.repoRoot);
  const puaNames = loadPuaNames(o.repoRoot);
  const questions = loadReferendumQuestions(o.repoRoot);

  const outputs: GroupOutput[] = [];
  const geoByLayout = new Map<string, Boundaries>();
  const villageGeo = new Map<string, GeoJSON>();
  const villageGroups = loadVillageGroups(o.repoRoot);
  const composites = new Map<string, string>();
  const checks0: ValidationCheck[] = [];
  const allChecks: ValidationCheck[] = [];
  for (const def of GROUPS) {
    const gid = groupId(def);
    log(`group ${gid}`);
    const rf = def.format === "rf";
    const ds = rf ? readRfGroup(def, cecWork) : readGroupData(def, cecWork);
    const puaCheck = applyPuaNames(ds, puaNames);
    if (rf && def.rfTownCodesFrom && def.villages) {
      checks0.push(await renumberRfVillages(def, ds as RfDataset, cecWork, { versionId: def.boundary.versionId, shp: shapefiles.get(def.boundary.versionId)! }, join(o.workDir, "geo", "codes")));
    }
    const dir = join(cecWork, def.archiveDirs[0]!);
    const built = rf
      ? buildRfGroup(def, ds as RfDataset, questions.get(`${def.election.id}#${def.referendumCase}`))
      : buildElGroup(def, ds, partyColors, def.choiceKind === "party" ? readElPartyList(dir) : undefined);
    const checks = [...built.checks, puaCheck, ...checks0.splice(0), ...checkOfficialAnnouncements(o.repoRoot, built)];

    // Mixed snapshots: townships whose reported villages the year's snapshot lacks come from the nearest one that has them.
    let boundaryVersion = def.boundary.versionId;
    let shp = shapefiles.get(def.boundary.versionId)!;
    if (def.mixSnapshots && built.results.village) {
      const vils = built.results.village.units.filter((u) => u.id.startsWith("vil:") && u.id !== `vil:${MAJIA}006`).map((u) => u.id.slice(4));
      const base = { versionId: def.boundary.versionId, shp };
      const others = ALL_SNAPSHOTS.filter((s) => s.versionId !== base.versionId).map((s) => ({ versionId: s.versionId, shp: shapefiles.get(s.versionId)! }));
      // Group members count as known villages (their votes are reported, just not separately).
      const known = new Set([...vils, `${MAJIA}006`]);
      for (const u of built.results.village.units.filter((x) => x.id.startsWith("vgrp:"))) {
        const [town, code] = u.id.slice(5).split("-") as [string, string];
        const row = villageGroups.get(villageGroupKey(def.election.id, town, code, u.nameZh));
        if (row && row.members !== "overlap") for (const m of row.members) known.add(m);
      }
      const mix = await planMix(def.election.date, base, others, vils, known, def.electorate === "general", join(o.workDir, "geo", "codes"));
      if (mix.swaps.size) {
        const alts = [...new Set([...mix.swaps.values()].map((s) => s.versionId))].sort();
        const hash = createHash("sha1").update(JSON.stringify([...mix.swaps].map(([t, s]) => [t, s.versionId]).sort())).digest("hex").slice(0, 6);
        boundaryVersion = `${base.versionId}-mix-${alts.map((a) => a.replace("nlsc-village-", "")).join("-")}-${hash}`;
        shp = composites.get(boundaryVersion) ?? (await buildComposite(base, mix, join(o.workDir, "geo", boundaryVersion)));
        composites.set(boundaryVersion, shp);
        const townName = new Map(built.results.town!.units.map((u) => [u.id.slice(u.id.indexOf(":") + 1, u.id.indexOf(":") + 9), u.nameZh.replace(/（.*）$/, "")]));
        const countyName = new Map(built.results.county!.units.map((u) => [u.id.slice(4), u.nameZh]));
        for (const alt of alts) {
          const ts = [...mix.swaps].filter(([, s]) => s.versionId === alt).map(([t]) => `${countyName.get(t.slice(0, 5)) ?? ""}${townName.get(t) ?? t}`);
          built.group.warnings.push(
            `村里整編：${ts.join("、")}的村里依 ${alt.replace("nlsc-village-", "")} 版界線繪製（${base.versionId.replace("nlsc-village-", "")} 版已是整編後的村里，與此次選舉的村里不符），其餘地區用 ${base.versionId.replace("nlsc-village-", "")} 版。`,
          );
        }
        checks.push({ id: "boundary-mix", status: "pass", detail: `${mix.swaps.size} townships drawn from ${alts.join(", ")}: ${[...mix.swaps.keys()].join(", ")}` });
      }
      if (mix.unresolved.length) checks.push({ id: "boundary-mix", status: "warn", detail: `no snapshot has all reported villages of ${mix.unresolved.join(", ")}` });
    }

    // Groups sharing a boundary version and layout share its shapes (plain "admin" towns are the same).
    const geoKey = `${boundaryVersion}/${def.layout}`;
    let geo = geoByLayout.get(geoKey);
    if (!geo) {
      log(`  boundaries (${geoKey})`);
      geo = await buildBoundaries(shp, join(o.workDir, "geo", geoKey), partsFor(def, ds, built), def.contests === "district");
      geoByLayout.set(geoKey, geo);
    }
    const unassigned: string[] = [];
    // Indigenous-councillor groups only have districts in some counties/towns: the rest is expected to be empty.
    const partial = def.electorate !== "general";
    const coveredTowns = new Set(built.townParts.map((p) => p.town));
    const coveredCounties = new Set(built.results.county!.units.map((u) => u.id.slice(4)));
    const outside = (code: string) => partial && (/^\d{5}$/.test(code) ? !coveredCounties.has(code) : /^\d{8}$/.test(code) && !coveredTowns.has(code));
    for (const level of built.group.levels) {
      if (level === "national" || level === "village") continue;
      const g = geo[level as keyof Boundaries];
      if (!g) { checks.push({ id: `geo-join-${level}`, status: "fail", detail: "no geometry built" }); continue; }
      const c = joinCheck(`geo-join-${level}`, g, built.results[level]!.units.map((u) => u.id.slice(u.id.indexOf(":") + 1)), outside);
      checks.push(c.check);
      unassigned.push(...c.extraFeatures);
    }
    const notes: GroupOutput["notes"] = [];
    // Later snapshots keep 三和村 in a separate disputed layer; up to 1091030 it is in the main layer and drawn.
    const sanheApart = !(await snapshotCodes({ versionId: def.boundary.versionId, shp: shapefiles.get(def.boundary.versionId)! }, join(o.workDir, "geo", "codes"))).has(`${MAJIA}006`);
    const majia = sanheApart ? built.results.town!.units.filter((u) => u.id.includes(MAJIA)) : [];
    for (const u of majia) {
      notes.push({ unit: u.id, note: "瑪家鄉三和村位於圖資另存的爭議圖層，與內埔鄉、鹽埔鄉、長治鄉圖面重疊，地圖未繪出；其票數依中選會資料計入瑪家鄉。" });
    }
    // 村里: one polygon per village, groups sharing stations merged (packages/etl/src/geo/villages.ts).
    let village: GroupOutput["village"];
    if (built.results.village) {
      const plan = planVillages(def.election.id, built.results.village.units, villageGroups);
      checks.push(...plan.checks);
      const hash = createHash("sha1").update(JSON.stringify([...plan.assign].sort())).digest("hex").slice(0, 8);
      const vKey = `${boundaryVersion}/vil-${hash}`;
      let g = villageGeo.get(vKey);
      if (!g) {
        log(`  villages (${vKey})`);
        g = await buildVillages(shp, join(o.workDir, "geo", vKey), plan.assign);
        villageGeo.set(vKey, g);
      }
      const noShape = new Map(plan.noShape.map((x) => [x.unit, x.note]));
      // 三和村 is drawn when the snapshot has it in its main layer (up to 1091030); later ones keep it apart.
      const sanhe = built.results.village.units.find((u) => u.id === `vil:${MAJIA}006` && !g!.features.some((f) => f.properties.code === `${MAJIA}006`));
      if (sanhe) noShape.set(sanhe.id, "三和村位於圖資另存的爭議圖層，與內埔鄉、鹽埔鄉、長治鄉圖面重疊，地圖未繪出。");
      const drawn = built.results.village.units.filter((u) => !noShape.has(u.id)).map((u) => villageGeoCode(u.id));
      // Non-village polygons (未編定 "…S01" and NLSC's other "…P01", "…I01", "…R01" areas), members of groups
      // that cannot be drawn, and — for indigenous electorates — villages without such voters have no result.
      const c = joinCheck("geo-join-village", g, drawn, (code) => partial || /[A-Z]\d+$/.test(code) || plan.covered.has(code));
      if (plan.noShape.length) {
        built.group.warnings.push(
          `村里層級：${plan.noShape.length} 個投開票所涵蓋多個村里且與其他村里的結果重疊，票數無法分配到村里，地圖未繪出、只計入鄉鎮；相關村里的數字不含這些票。`,
        );
      }
      checks.push(c.check);
      notes.push(...plan.notes, ...[...noShape].map(([unit, note]) => ({ unit, note })));
      village = { geo: g, path: `geography/${vKey}/village.geojson` };
    }
    if (unassigned.length) {
      built.group.warnings.push(`分屬兩個選區的鄉鎮中，有 ${unassigned.length} 塊圖面（未編定村里，例如河道）無法對應到選區，以「無資料」顯示。`);
    }
    for (const c of checks) log(`  [${c.status}] ${c.id}: ${c.detail}`);
    allChecks.push(...checks.map((c) => ({ ...c, id: `${def.election.date.slice(0, 4)}/${def.local}:${c.id}` })));
    const sources = [];
    for (const a of def.archiveDirs) sources.push(...(await sourceFiles(join(cecWork, a), a, rf ? RF_FILES : EL_FILES)));
    if (def.extra) sources.push(...(await sourceFiles(join(cecWork, def.extra.archiveDir), def.extra.archiveDir, ["cand.csv", "prof.csv"])));
    outputs.push({ def, built, geo, checks, sources, notes, village, boundaryVersion });
  }

  const tl = buildTimelines(
    GROUPS.map((g) => ({ id: groupId(g), office: g.office, date: g.election.date })),
    loadElectionGroups(o.repoRoot),
  );
  for (const c of tl.checks) log(`[${c.status}] ${c.id}: ${c.detail}`);
  allChecks.push(...tl.checks);

  if (allChecks.some((c) => c.status === "fail")) {
    writeReport(o.outDir, "failed", allChecks);
    return { ok: false, checks: allChecks };
  }

  // emit
  const files: PendingFile[] = [];
  const geoWritten = new Set<string>();
  const dataSources: DataSource[] = [DATA_SOURCES.cec, DATA_SOURCES.nlscVillageHistory];
  for (const { def, built, geo, checks, sources, notes, village, boundaryVersion } of outputs) {
    const gid = groupId(def);
    const resultPaths: Record<string, string> = {};
    for (const [level, rf] of Object.entries(built.results)) {
      const path = `groups/${gid}/results/${level}.json`;
      resultPaths[level] = path;
      files.push({ path, body: json(GroupResultsFile.parse(rf)) });
    }
    const geoPaths: Record<string, string> = {};
    for (const level of built.group.levels) {
      const g = geo[level as keyof Boundaries];
      if (!g) continue;
      // County shapes are identical for every layout: publish them once.
      const layout = level === "county" ? "admin" : def.layout;
      const path = `geography/${boundaryVersion}/${layout}/${level}.geojson`;
      geoPaths[level] = path;
      if (!geoWritten.has(path)) {
        files.push({ path, body: json(g) });
        geoWritten.add(path);
      }
    }
    if (village) {
      geoPaths.village = village.path;
      if (!geoWritten.has(village.path)) {
        files.push({ path: village.path, body: json(village.geo) });
        geoWritten.add(village.path);
      }
    }
    const meta = GroupMetadataFile.parse({
      schemaVersion: 2,
      release: RELEASE_TOKEN,
      election: { ...def.election, kinds: [...def.election.kinds], sources },
      group: built.group,
      contests: built.contests,
      choices: built.choices,
      candidacies: built.candidacies,
      persons: built.persons,
      parties: built.parties,
      sources: dataSources,
      boundary: { versionId: boundaryVersion, sourceId: DATA_SOURCES.nlscVillageHistory.id, files: geoPaths, notes },
      results: resultPaths,
      validation: checks,
    });
    files.push({ path: `groups/${gid}/metadata.json`, body: json(meta) });
  }

  // Newest election first: the order of the site's picker.
  const elections = [...new Map(GROUPS.map((g) => [g.election.id, g.election])).values()].sort((a, b) => b.date.localeCompare(a.date));
  files.push({
    path: "index.json",
    body: json(
      ReleaseIndexFile.parse({
        schemaVersion: 2,
        release: RELEASE_TOKEN,
        elections: elections.map((e) => ({
          id: e.id,
          date: e.date,
          nameZh: e.nameZh,
          groups: outputs.filter((x) => x.def.election.id === e.id).map((x) => ({ id: x.built.group.id, nameZh: x.built.group.nameZh, office: x.built.group.office, levels: x.built.group.levels })),
        })),
        timelines: tl.timelines,
      }),
    ),
  });
  const allParties = new Map<number, { code: number; name: string }>();
  for (const g of GROUPS.filter((x) => x.format !== "rf")) for (const a of g.archiveDirs) for (const p of readElDir(join(cecWork, a)).parties) allParties.set(p.code, p);
  files.push({ path: "parties.json", body: json(PartiesFile.parse({ schemaVersion: 2, parties: [...allParties.values()].map((p) => toParty(p, partyColors)) })) });

  const warn = allChecks.some((c) => c.status === "warn");
  const { releaseId, root } = writeRelease(o.outDir, files, {
    etlVersion: etlVersion(o.repoRoot),
    elections: elections.map((e) => e.id),
    validation: warn ? "passed-with-warnings" : "passed",
    now: new Date().toISOString(),
  });
  writeReport(o.outDir, releaseId, allChecks, root);
  log(`release ${releaseId} written to ${root}`);
  return { ok: true, releaseId, checks: allChecks };
}

/** Which village/town goes into which map part (town, or town-within-district). */
function partsFor(def: ElGroupDef, ds: ElDataset, built: BuiltGroup): PartAssignment {
  if (def.contests !== "district") return { towns: built.townParts.map((p) => ({ town: p.town, part: p.code, district: "" })), villages: [] };
  const byTown = new Map<string, typeof built.townParts>();
  for (const p of built.townParts) byTown.set(p.town, [...(byTown.get(p.town) ?? []), p]);
  const towns: PartAssignment["towns"] = [];
  const split = new Set<string>();
  for (const [town, ps] of byTown) {
    if (ps.length === 1) towns.push({ town, part: ps[0]!.code, district: ps[0]!.district ?? "" });
    else split.add(town);
  }
  const villages: PartAssignment["villages"] = ds.units
    .filter((u) => u.level === "village" && split.has(townCode(u.key)) && /^0\d{3}$/.test(u.key.vil))
    .map((u) => ({ village: townCode(u.key) + u.key.vil.slice(1), part: `${townCode(u.key)}-${u.key.dist}`, district: `${countyCode(u.key)}-${u.key.dist}` }));
  return { towns, villages };
}

function checkOfficialAnnouncements(repoRoot: string, built: BuiltGroup): ValidationCheck[] {
  const contestIds = new Set(built.contests.map((c) => c.id));
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/official-announcements.csv"), "utf8"), { header: true }).filter((r) =>
    contestIds.has(r[0]!),
  );
  if (rows.length === 0) {
    return [{ id: "official-announcement", status: "warn", detail: "no official announcement totals recorded for this group yet" }];
  }
  // Compare with the national row. `ballot_number` is a ballot number, a choice id (referendum
  // "agree" / "disagree"), or "electors" / "valid" for the announced 選舉人數 / 有效票數.
  const nat = built.results.national!.rows[0]!;
  const bad: string[] = [];
  let unreviewed = 0;
  for (const [cid, n, label, votes, , status] of rows) {
    if (status !== "reviewed") unreviewed++;
    if (n === "electors" || n === "valid") {
      const got = n === "electors" ? nat.summary.electors : nat.summary.valid;
      if (got !== Number(votes)) bad.push(`${cid} ${n} ${got}≠${votes}`);
      continue;
    }
    const ch = built.choices.find((c) => c.contestId === cid && (/^\d+$/.test(n!) ? c.ballotNumber === Number(n) : c.id === n));
    if (!ch) { bad.push(`no choice ${n} in ${cid}`); continue; }
    if (ch.labelZh !== label) bad.push(`${n} label ${ch.labelZh}≠${label}`);
    if (nat.votes[ch.id] !== Number(votes)) bad.push(`${n} votes ${nat.votes[ch.id]}≠${votes}`);
  }
  if (bad.length) return [{ id: "official-announcement", status: "fail", detail: bad.join("; ") }];
  return [
    unreviewed
      ? { id: "official-announcement", status: "warn", detail: `${rows.length} announced figures match, but ${unreviewed} rows are not yet human-reviewed` }
      : { id: "official-announcement", status: "pass", detail: `${rows.length} announced figures match (all reviewed)` },
  ];
}

const list = (xs: string[], n = 12) => (xs.length > n ? `${xs.slice(0, n).join(", ")}, … (+${xs.length - n})` : xs.join(", "));

/**
 * Units ↔ polygons. `outside` marks polygons expected to have no result: areas a partial group
 * (原住民議員) has no district in. Other unmatched polygons are warned about.
 */
function joinCheck(id: string, g: GeoJSON, unitCodes: string[], outside: (code: string) => boolean): { check: ValidationCheck; extraFeatures: string[] } {
  const feat = new Set(g.features.map((f) => f.properties.code!));
  const units = new Set(unitCodes);
  const noGeo = [...units].filter((c) => !feat.has(c));
  const extraAll = [...feat].filter((c) => !units.has(c));
  const extra = extraAll.filter((c) => !outside(c));
  const out = extraAll.length - extra.length;
  if (noGeo.length) {
    return { check: { id, status: "fail", detail: `units without polygon: ${list(noGeo)}` }, extraFeatures: extra };
  }
  const outText = out ? `; ${out} polygons have no result by design (outside the group's areas, non-village areas or undrawable groups)` : "";
  return {
    check: extra.length
      ? { id, status: "warn", detail: `${units.size} units matched${outText}; ${extra.length} polygons have no result and show as 無資料 (${list(extra)})` }
      : { id, status: "pass", detail: `${units.size} units ↔ ${units.size} polygons${outText || ", 1:1"}` },
    extraFeatures: extra,
  };
}

/** rf* directory, with 2018's CEC township numbers replaced by registry codes (matched by name). */
function readRfGroup(def: ElGroupDef, cecWork: string): RfDataset {
  const ds = readRfDir(join(cecWork, def.archiveDirs[0]!));
  if (def.rfTownCodesFrom) {
    const towns = new Map<string, string>();
    for (const a of def.rfTownCodesFrom) {
      for (const u of readElDir(join(cecWork, a)).units) if (u.level === "town") towns.set(`${countyCode(u.key)}|${u.name}`, u.key.town);
    }
    renumberTowns(ds, towns);
  }
  return ds;
}

/**
 * 2018 rf* villages → registry codes by name within each (already renumbered) township: first from
 * the same day's el* elbase, then — for villages the el* files only list inside groups (連江縣) —
 * from the boundary snapshot's village names.
 */
async function renumberRfVillages(def: ElGroupDef, ds: RfDataset, cecWork: string, snap: { versionId: string; shp: string }, workDir: string): Promise<ValidationCheck> {
  const fromEl = new Map<string, string>();
  for (const a of def.rfTownCodesFrom!) {
    for (const u of readElDir(join(cecWork, a)).units) {
      if (u.level === "village" && /^0\d{3}$/.test(u.key.vil) && !u.name.includes("、")) fromEl.set(`${townCode(u.key)}|${u.name}`, u.key.vil);
    }
  }
  const fromSnap = await snapshotNames(snap, workDir);
  const fallback: string[] = [];
  renumberVillages(ds, (town, name) => {
    const el = fromEl.get(`${town}|${name}`);
    if (el) return el;
    const code = fromSnap.get(`${town}|${name}`);
    if (code) fallback.push(`${town}${name}`);
    return code ? `0${code.slice(8)}` : undefined;
  });
  return {
    id: "rf-village-codes",
    status: "pass",
    detail: `village codes matched by name within townships${fallback.length ? `; ${fallback.length} via ${snap.versionId} names (only listed inside groups in the el* files): ${fallback.join(", ")}` : " (all from the same day's el* files)"}`,
  };
}

const RF_FILES = ["rfarea.csv", "rfprof.csv", "rftckt.csv"];
const EL_FILES = ["elbase.csv", "elcand.csv", "elctks.csv", "elpaty.csv", "elprof.csv"];

/** All el* directories of a group (merged when there are several), plus any extra adapter. */
function readGroupData(def: ElGroupDef, cecWork: string): ElDataset {
  const parts = def.archiveDirs.map((a) => readElDir(join(cecWork, a)));
  if (def.extra?.adapter === "chiayi-2022-rerun") {
    const ref = readElDir(join(cecWork, def.extra.refArchiveDir), (k) => countyCode(k) === CHIAYI_CITY);
    const parties = parts.flatMap((p) => p.parties);
    parts.push(readChiayiRerun(join(cecWork, def.extra.archiveDir), ref, parties, def.extra.date));
  }
  return parts.length === 1 ? parts[0]! : mergeElDatasets(parts);
}

async function sourceFiles(dir: string, archiveDir: string, names: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const f of names) {
    const p = join(dir, f);
    out.push({
      sourceId: RAW_SOURCES.cecVotedata.id,
      path: `${RAW_SOURCES.cecVotedata.file}:${archiveDir}${f}`,
      sha256: await sha256File(p),
      bytes: statSync(p).size,
      retrievedAt: RAW_SOURCES.cecVotedata.retrievedAt,
      upstreamLastModified: "Mon, 26 Jan 2026 06:54:52 GMT",
    });
  }
  return out;
}

function etlVersion(repoRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "packages/etl/package.json"), "utf8")) as { version: string };
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "";
  if (!sha) {
    try {
      sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).toString().trim();
      const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot }).toString().trim();
      if (dirty) sha += "-dirty";
    } catch {
      sha = "unknown";
    }
  }
  return `${pkg.version}+${sha}`;
}

function writeReport(outDir: string, name: string, checks: ValidationCheck[], root?: string) {
  const dir = join(outDir, "reports");
  mkdirSync(dir, { recursive: true });
  const md = [
    `# ETL report — ${name}`,
    "",
    root ? `Output: \`${root}\`` : "No release written (validation failed).",
    "",
    "| check | status | detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.id} | ${c.status} | ${c.detail.replaceAll("|", "\\|")} |`),
    "",
  ].join("\n");
  writeFileSync(join(dir, `${name}.md`), md);
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(checks, null, 2));
}
