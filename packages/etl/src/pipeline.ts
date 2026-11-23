import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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
import { GROUPS } from "./groups/defs.ts";
import { type Boundaries, type GeoJSON, type PartAssignment, buildBoundaries } from "./geo/build.ts";
import { loadPartyColors } from "./lib/party-colors.ts";
import { applyPuaNames, loadPuaNames } from "./lib/pua-names.ts";
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
}

export async function build(o: PipelineOptions): Promise<{ ok: boolean; releaseId?: string; checks: ValidationCheck[] }> {
  const log = o.log ?? console.log;
  await fetchAll(o);

  // extract
  const cecWork = join(o.workDir, "cec-votedata");
  const zipDirs = GROUPS.flatMap((g) => [...g.archiveDirs, ...(g.extra ? [g.extra.archiveDir, g.extra.refArchiveDir] : [])]);
  unzip(join(o.rawDir, "cec-votedata", "votedata.zip"), cecWork, [...new Set(zipDirs)].map((d) => `${d}*`));
  const shapefiles = new Map<string, string>(); // boundary versionId → village .shp
  for (const b of new Map(GROUPS.map((g) => [g.boundary.versionId, g.boundary])).values()) {
    const raw = RAW_SOURCES[b.raw];
    const villWork = join(o.workDir, "nlsc-village-history", raw.file.replace(/\.bin$/, ""));
    unzip(join(o.rawDir, raw.id, raw.file), villWork);
    unzip(findFile(villWork, /\.zip$/), villWork);
    shapefiles.set(b.versionId, findFile(villWork, b.shapefile));
  }
  const partyColors = loadPartyColors(o.repoRoot);
  const puaNames = loadPuaNames(o.repoRoot);

  const outputs: GroupOutput[] = [];
  const geoByLayout = new Map<string, Boundaries>();
  const allChecks: ValidationCheck[] = [];
  for (const def of GROUPS) {
    const gid = groupId(def);
    log(`group ${gid}`);
    const ds = readGroupData(def, cecWork);
    const puaCheck = applyPuaNames(ds, puaNames);
    const dir = join(cecWork, def.archiveDirs[0]!);
    const built = buildElGroup(def, ds, partyColors, def.choiceKind === "party" ? readElPartyList(dir) : undefined);
    const checks = [...built.checks, puaCheck, ...checkOfficialAnnouncements(o.repoRoot, built)];

    // Groups sharing a boundary version and layout share its shapes (plain "admin" towns are the same).
    const geoKey = `${def.boundary.versionId}/${def.layout}`;
    let geo = geoByLayout.get(geoKey);
    if (!geo) {
      log(`  boundaries (${geoKey})`);
      geo = await buildBoundaries(shapefiles.get(def.boundary.versionId)!, join(o.workDir, "geo", geoKey), partsFor(def, ds, built), def.contests === "district");
      geoByLayout.set(geoKey, geo);
    }
    const unassigned: string[] = [];
    for (const level of built.group.levels) {
      if (level === "national") continue;
      const g = geo[level as keyof Boundaries];
      if (!g) { checks.push({ id: `geo-join-${level}`, status: "fail", detail: "no geometry built" }); continue; }
      const c = joinCheck(`geo-join-${level}`, g, built.results[level]!.units.map((u) => u.id.slice(u.id.indexOf(":") + 1)));
      checks.push(c.check);
      unassigned.push(...c.extraFeatures);
    }
    const notes: GroupOutput["notes"] = [];
    const majia = built.results.town!.units.filter((u) => u.id.includes(MAJIA));
    for (const u of majia) {
      notes.push({ unit: u.id, note: "瑪家鄉三和村位於圖資另存的爭議圖層，與內埔鄉、鹽埔鄉、長治鄉圖面重疊，地圖未繪出；其票數依中選會資料計入瑪家鄉。" });
    }
    if (unassigned.length) {
      built.group.warnings.push(`分屬兩個選區的鄉鎮中，有 ${unassigned.length} 塊圖面（未編定村里，例如河道）無法對應到選區，以「無資料」顯示。`);
    }
    for (const c of checks) log(`  [${c.status}] ${c.id}: ${c.detail}`);
    allChecks.push(...checks.map((c) => ({ ...c, id: `${def.election.date.slice(0, 4)}/${def.local}:${c.id}` })));
    const sources = [];
    for (const a of def.archiveDirs) sources.push(...(await sourceFiles(join(cecWork, a), a, EL_FILES)));
    if (def.extra) sources.push(...(await sourceFiles(join(cecWork, def.extra.archiveDir), def.extra.archiveDir, ["cand.csv", "prof.csv"])));
    outputs.push({ def, built, geo, checks, sources, notes });
  }

  if (allChecks.some((c) => c.status === "fail")) {
    writeReport(o.outDir, "failed", allChecks);
    return { ok: false, checks: allChecks };
  }

  // emit
  const files: PendingFile[] = [];
  const geoWritten = new Set<string>();
  const dataSources: DataSource[] = [DATA_SOURCES.cec, DATA_SOURCES.nlscVillageHistory];
  for (const { def, built, geo, checks, sources, notes } of outputs) {
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
      const path = `geography/${def.boundary.versionId}/${layout}/${level}.geojson`;
      geoPaths[level] = path;
      if (!geoWritten.has(path)) {
        files.push({ path, body: json(g) });
        geoWritten.add(path);
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
      boundary: { versionId: def.boundary.versionId, sourceId: DATA_SOURCES.nlscVillageHistory.id, files: geoPaths, notes },
      results: resultPaths,
      validation: checks,
    });
    files.push({ path: `groups/${gid}/metadata.json`, body: json(meta) });
  }

  const elections = [...new Map(GROUPS.map((g) => [g.election.id, g.election])).values()];
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
      }),
    ),
  });
  const allParties = new Map<number, { code: number; name: string }>();
  for (const g of GROUPS) for (const a of g.archiveDirs) for (const p of readElDir(join(cecWork, a)).parties) allParties.set(p.code, p);
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
  // Compare with each contest's own top row (national for 總統).
  const top = built.results.national!.rows[0]!.votes;
  const bad: string[] = [];
  let unreviewed = 0;
  for (const [cid, n, label, votes, , status] of rows) {
    const ch = built.choices.find((c) => c.contestId === cid && c.ballotNumber === Number(n));
    if (!ch) { bad.push(`no choice #${n} in ${cid}`); continue; }
    if (ch.labelZh !== label) bad.push(`#${n} label ${ch.labelZh}≠${label}`);
    if (top[ch.id] !== Number(votes)) bad.push(`#${n} votes ${top[ch.id]}≠${votes}`);
    if (status !== "reviewed") unreviewed++;
  }
  if (bad.length) return [{ id: "official-announcement", status: "fail", detail: bad.join("; ") }];
  return [
    unreviewed
      ? { id: "official-announcement", status: "warn", detail: `totals match, but ${unreviewed} rows are not yet human-reviewed` }
      : { id: "official-announcement", status: "pass", detail: `${rows.length} totals match the reviewed official announcement` },
  ];
}

function joinCheck(id: string, g: GeoJSON, unitCodes: string[]): { check: ValidationCheck; extraFeatures: string[] } {
  const feat = new Set(g.features.map((f) => f.properties.code!));
  const units = new Set(unitCodes);
  const noGeo = [...units].filter((c) => !feat.has(c));
  const extra = [...feat].filter((c) => !units.has(c));
  if (noGeo.length) {
    return { check: { id, status: "fail", detail: `units without polygon: ${noGeo.join(",")}` }, extraFeatures: extra };
  }
  return {
    check: extra.length
      ? { id, status: "warn", detail: `${units.size} units matched; ${extra.length} polygons have no result and show as 無資料 (${extra.join(", ")})` }
      : { id, status: "pass", detail: `${units.size} units ↔ ${feat.size} polygons, 1:1` },
    extraFeatures: extra,
  };
}

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
