import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  ContestMetadataFile,
  type DataSource,
  PartiesFile,
  ReleaseIndexFile,
  ResultsFile,
  type ValidationCheck,
} from "@tw-election/schema";
import { DATA_SOURCES, RAW_SOURCES } from "./config/sources.ts";
import { ensureRaw, findFile, sha256File, unzip } from "./lib/raw.ts";
import { parseCecCsv } from "./lib/csv.ts";
import { readElDir } from "./adapters/cec-el.ts";
import { checkElDataset } from "./validate/el-checks.ts";
import { ARCHIVE_DIR, CONTEST_ID, ELECTION, buildPresident2024, toParty } from "./contests/president-2024.ts";
import { buildBoundaries, type GeoJSON } from "./geo/build.ts";
import { loadPartyColors } from "./lib/party-colors.ts";
import { RELEASE_TOKEN, json, writeRelease, type PendingFile } from "./emit/release.ts";

export interface PipelineOptions {
  rawDir: string;
  workDir: string;
  outDir: string;
  repoRoot: string;
  log?: (s: string) => void;
}

const BOUNDARY_VERSION = "nlsc-village-1120928";

export async function fetchAll(o: PipelineOptions) {
  for (const s of Object.values(RAW_SOURCES)) await ensureRaw(o.rawDir, s, o.log);
}

export async function build(o: PipelineOptions): Promise<{ ok: boolean; releaseId?: string; checks: ValidationCheck[] }> {
  const log = o.log ?? console.log;
  await fetchAll(o);

  // 1. extract
  const cecWork = join(o.workDir, "cec-votedata");
  unzip(join(o.rawDir, "cec-votedata", "votedata.zip"), cecWork, [`${ARCHIVE_DIR}*`]);
  const contestDir = join(cecWork, ARCHIVE_DIR);
  const villWork = join(o.workDir, "nlsc-village-history", "v112");
  unzip(join(o.rawDir, "nlsc-village-history", "v112.bin"), villWork);
  unzip(findFile(villWork, /\.zip$/), villWork);
  const villageShp = findFile(villWork, /^VILLAGE_NLSC_1120928\.shp$/);

  // 2. parse + validate source
  log("parse CEC el* files");
  const ds = readElDir(contestDir);
  const numbers = [...new Set(ds.candidates.map((c) => c.ballotNumber))].sort((a, b) => a - b);
  const checks: ValidationCheck[] = checkElDataset(ds, numbers);
  const partyColors = loadPartyColors(o.repoRoot);
  const built = buildPresident2024(ds, partyColors);
  checks.push(...built.checks);
  checks.push(...checkOfficialAnnouncements(o.repoRoot, built));

  // 3. geography
  log("build boundaries (mapshaper)");
  const geo = await buildBoundaries(villageShp, join(o.workDir, "geo", BOUNDARY_VERSION));
  checks.push(joinCheck("geo-join-county", geo.county, built.results.county.units.map((u) => u.id.slice(4))));
  checks.push(joinCheck("geo-join-town", geo.town, built.results.town.units.map((u) => u.id.slice(5))));

  const failed = checks.filter((c) => c.status === "fail");
  for (const c of checks) log(`  [${c.status}] ${c.id}: ${c.detail}`);
  if (failed.length) {
    writeReport(o.outDir, "failed", checks);
    return { ok: false, checks };
  }

  // 4. emit
  const sources = await sourceFiles(contestDir);
  const files: PendingFile[] = [];
  const resultPaths: Record<string, string> = {};
  for (const [level, rf] of Object.entries(built.results)) {
    const path = `contests/${CONTEST_ID}/results/${level}.json`;
    resultPaths[level] = path;
    files.push({ path, body: json(ResultsFile.parse(rf)) });
  }
  const geoPaths = {
    county: `geography/${BOUNDARY_VERSION}/county.geojson`,
    town: `geography/${BOUNDARY_VERSION}/town.geojson`,
  };
  files.push({ path: geoPaths.county, body: json(geo.county) });
  files.push({ path: geoPaths.town, body: json(geo.town) });

  const dataSources: DataSource[] = [DATA_SOURCES.cec, DATA_SOURCES.nlscVillageHistory];
  const meta = ContestMetadataFile.parse({
    schemaVersion: 1,
    release: RELEASE_TOKEN,
    election: { ...ELECTION, kinds: [...ELECTION.kinds], sources },
    contest: built.contest,
    choices: built.choices,
    candidacies: built.candidacies,
    persons: built.persons,
    parties: built.parties,
    sources: dataSources,
    boundary: {
      versionId: BOUNDARY_VERSION,
      sourceId: DATA_SOURCES.nlscVillageHistory.id,
      files: geoPaths,
      notes: [
        {
          unit: "town:10013280",
          note: "瑪家鄉三和村位於圖資另存的爭議圖層，與內埔鄉、鹽埔鄉、長治鄉圖面重疊，地圖未繪出；其票數依中選會資料計入瑪家鄉。",
        },
      ],
    },
    results: resultPaths,
    validation: checks,
  });
  files.push({ path: `contests/${CONTEST_ID}/metadata.json`, body: json(meta) });
  files.push({
    path: "index.json",
    body: json(
      ReleaseIndexFile.parse({
        schemaVersion: 1,
        release: RELEASE_TOKEN,
        elections: [
          {
            id: ELECTION.id,
            date: ELECTION.date,
            nameZh: ELECTION.nameZh,
            contests: [
              {
                id: CONTEST_ID,
                nameZh: built.contest.nameZh,
                office: built.contest.office,
                availableLevels: built.contest.availableLevels,
              },
            ],
          },
        ],
      }),
    ),
  });
  files.push({ path: "parties.json", body: json(PartiesFile.parse({ schemaVersion: 1, parties: ds.parties.map((p) => toParty(p, partyColors)) })) });

  const warn = checks.some((c) => c.status === "warn");
  const { releaseId, root } = writeRelease(o.outDir, files, {
    etlVersion: etlVersion(o.repoRoot),
    elections: [ELECTION.id],
    validation: warn ? "passed-with-warnings" : "passed",
    now: new Date().toISOString(),
  });
  writeReport(o.outDir, releaseId, checks, root);
  log(`release ${releaseId} written to ${root}`);
  return { ok: true, releaseId, checks };
}

function checkOfficialAnnouncements(repoRoot: string, built: ReturnType<typeof buildPresident2024>): ValidationCheck[] {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/official-announcements.csv"), "utf8"), { header: true })
    .filter((r) => r[0] === CONTEST_ID);
  const nat = built.results.national.rows[0]!;
  const bad: string[] = [];
  let unreviewed = 0;
  for (const [, n, label, votes, , status] of rows) {
    const i = built.choices.findIndex((c) => c.ballotNumber === Number(n));
    if (i < 0) { bad.push(`no choice #${n}`); continue; }
    if (built.choices[i]!.labelZh !== label) bad.push(`#${n} label ${built.choices[i]!.labelZh}≠${label}`);
    if (nat.votes[i] !== Number(votes)) bad.push(`#${n} votes ${nat.votes[i]}≠${votes}`);
    if (status !== "reviewed") unreviewed++;
  }
  if (rows.length !== built.choices.length) bad.push(`announcement rows ${rows.length} ≠ choices ${built.choices.length}`);
  if (bad.length) return [{ id: "official-announcement", status: "fail", detail: bad.join("; ") }];
  return [
    unreviewed
      ? { id: "official-announcement", status: "warn", detail: `national totals match the announcement table, but ${unreviewed} rows are not yet human-reviewed` }
      : { id: "official-announcement", status: "pass", detail: "national totals match the reviewed official announcement" },
  ];
}

function joinCheck(id: string, g: GeoJSON, unitCodes: string[]): ValidationCheck {
  const feat = new Set(g.features.map((f) => f.properties.code!));
  const units = new Set(unitCodes);
  const noGeo = [...units].filter((c) => !feat.has(c));
  const noData = [...feat].filter((c) => !units.has(c));
  if (noGeo.length || noData.length) {
    return { id, status: "fail", detail: `units without polygon: ${noGeo.join(",") || "-"}; polygons without result: ${noData.join(",") || "-"}` };
  }
  return { id, status: "pass", detail: `${units.size} units ↔ ${feat.size} polygons, 1:1` };
}

async function sourceFiles(contestDir: string) {
  const out = [];
  for (const f of ["elbase.csv", "elcand.csv", "elctks.csv", "elpaty.csv", "elprof.csv"]) {
    const p = join(contestDir, f);
    out.push({
      sourceId: RAW_SOURCES.cecVotedata.id,
      path: `${RAW_SOURCES.cecVotedata.file}:${ARCHIVE_DIR}${f}`,
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

