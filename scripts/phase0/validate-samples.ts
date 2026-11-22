/**
 * Phase 0 proof: map the three CEC samples into the draft schema and run the
 * numeric checks the real ETL will need. Not the production ETL — a throwaway
 * adapter prototype that keeps everything in memory.
 *
 *   pnpm phase0:validate            (expects data/raw/cec extracted, see sources/README.md)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ResultsFile,
  type ResultRow,
  type ReportingUnit,
  type ResultsFile as ResultsFileT,
} from "../../packages/schema/src/index.ts";

const RAW = "data/raw/cec";
const problems: string[] = [];
const notes: string[] = [];

function readCsv(path: string, hasHeader = false): string[][] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  // Spec forbids commas inside fields; some years quote every field, some don't.
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  return hasHeader ? rows.slice(1) : rows;
}

// BMP PUA plus supplementary PUA planes 15–16 (CEC 2021 uses U+FB56F)
const PUA = /[-\u{F0000}-\u{10FFFD}]/u;
function checkPua(label: string, rows: string[][]) {
  const hits = rows.filter((r) => r.some((c) => PUA.test(c)));
  if (hits.length) notes.push(`${label}: ${hits.length} rows contain Private-Use-Area chars (need PUA→Unicode table)`);
}

type Key = { prv: string; cty: string; dist: string; town: string; vil: string; st: string };
const key = (r: string[]): Key => ({
  prv: r[0]!, cty: r[1]!, dist: r[2]!, town: r[3]!, vil: r[4]!, st: (r[5] ?? "0").padStart(4, "0"),
});
function level(k: Key): "national" | "county" | "district" | "town" | "village" | "station" {
  if (k.st !== "0000") return "station";
  if (k.vil !== "0000") return "village";
  if (k.town !== "000") return "town";
  if (k.prv === "00") return "national";
  return k.dist !== "00" ? "district" : "county";
}
const county = (k: Key) => k.prv + k.cty;
function unitId(k: Key): string {
  switch (level(k)) {
    case "national": return "nat";
    case "county": return `cty:${county(k)}`;
    case "district": return `dist:${county(k)}-${k.dist}`;
    case "town": return `town:${county(k)}${k.town}`;
    case "village":
      return /^0\d{3}$/.test(k.vil) ? `vil:${county(k)}${k.town}${k.vil.slice(1)}` : `vgrp:${county(k)}${k.town}-${k.vil}`;
    case "station": return `st:${county(k)}-${k.st}`;
  }
}
const n = (s: string | undefined) => (s === undefined || s === "" ? null : Number.parseInt(s, 10));

/** Build county+town ResultsFile for one CEC el* contest directory filtered by a predicate. */
function buildEl(
  contestId: string,
  dir: string,
  belongs: (k: Key) => boolean,
  isNationwide: boolean,
): ResultsFileT[] {
  const prof = readCsv(join(dir, "elprof.csv"));
  const ctks = readCsv(join(dir, "elctks.csv"));
  const cand = readCsv(join(dir, "elcand.csv"));
  checkPua(`${dir}/elbase+elcand`, [...readCsv(join(dir, "elbase.csv")), ...cand]);
  const nums = [...new Set(cand.filter((r) => belongs(key(r))).map((r) => Number(r[5])))].sort((a, b) => a - b);
  const choiceIds = nums.map((x) => `n${x}`);
  const votes = new Map<string, number[]>();
  for (const r of ctks) {
    const k = key(r);
    if (!belongs(k)) continue;
    const id = JSON.stringify(k);
    const arr = votes.get(id) ?? new Array(nums.length).fill(0);
    arr[nums.indexOf(Number(r[6]))] = Number(r[7]);
    votes.set(id, arr);
  }
  const out: ResultsFileT[] = [];
  for (const lv of ["county", "town"] as const) {
    const rows: ResultRow[] = [];
    const units: ReportingUnit[] = [];
    for (const r of prof) {
      const k = key(r);
      if (!belongs(k) || level(k) !== lv) continue;
      const id = unitId(k);
      units.push({ id, level: lv, nameZh: "", parentId: null, memberVillageCodes: null, geo: "exact" });
      // population: CEC writes 0 where not provided -> null
      const pop = n(r[10]);
      rows.push({
        unit: id,
        summary: { valid: n(r[6]), invalid: n(r[7]), ballotsCast: n(r[8]), electors: n(r[9]), population: pop === 0 ? null : pop },
        votes: votes.get(JSON.stringify(k)) ?? [],
      });
      const sum = (votes.get(JSON.stringify(k)) ?? []).reduce((a, b) => a + b, 0);
      if (sum !== n(r[6])) problems.push(`${contestId} ${id}: Σvotes ${sum} ≠ valid ${r[6]}`);
      if (n(r[6])! + n(r[7])! !== n(r[8])) problems.push(`${contestId} ${id}: valid+invalid ≠ cast`);
    }
    out.push(ResultsFile.parse({
      schemaVersion: 1, contestId, level: lv, countyCode: null, choiceIds, units, rows,
    }));
  }
  // hierarchy check: Σ station = Σ town = top total (top = national row for nationwide, county row otherwise)
  const sumLevel = (lv: string) =>
    prof.filter((r) => belongs(key(r)) && level(key(r)) === lv).reduce((a, r) => a + Number(r[6]), 0);
  const top = isNationwide ? sumLevel("national") : sumLevel("county");
  for (const lv of ["town", "village", "station"]) {
    const s = sumLevel(lv);
    if (s !== top) problems.push(`${contestId}: Σ${lv} valid ${s} ≠ top ${top}`);
  }
  return out;
}

function report(label: string, files: ResultsFileT[]) {
  const c = files.find((f) => f.level === "county")!;
  const t = files.find((f) => f.level === "town")!;
  console.log(`  ✓ ${label}: ${c.choiceIds.length} choices, ${c.rows.length} county rows, ${t.rows.length} town rows`);
}

// ---------- 1. 2024 presidential (single nationwide contest, ticket choices)
{
  const dir = join(RAW, "voteData/2024總統立委/總統");
  console.log("2024 presidential");
  report("president", buildEl("2024-01-13-president-legislative.president", dir, () => true, true));
}

// ---------- 2. 2022 local: one contest per county for C1; national row is a cross-contest sum
{
  console.log("2022 local — C1 mayor/magistrate (one contest per county)");
  let contests = 0;
  for (const sub of ["prv", "city"]) {
    const dir = join(RAW, "voteData/2022-111年地方公職人員選舉/C1", sub);
    const counties = [...new Set(readCsv(join(dir, "elcand.csv")).map((r) => r[0]! + r[1]!))];
    for (const cc of counties) {
      buildEl(`2022-11-26-local.c1-${cc}`, dir, (k) => county(k) === cc, false);
      contests++;
    }
  }
  console.log(`  ✓ ${contests} C1 contests parsed and validated`);
  // Multi-seat district contests (T1): contest = (county, district)
  const dir = join(RAW, "voteData/2022-111年地方公職人員選舉/T1/prv");
  const ds = [...new Set(readCsv(join(dir, "elcand.csv")).map((r) => `${r[0]}${r[1]}-${r[2]}`))];
  for (const d of ds) {
    const [cc, dd] = d.split("-");
    // district contests: Σ station must equal district row; use district as "top"
    const prof = readCsv(join(dir, "elprof.csv")).filter((r) => county(key(r)) === cc && r[2] === dd);
    const top = prof.filter((r) => level(key(r)) === "district").reduce((a, r) => a + Number(r[6]), 0);
    const st = prof.filter((r) => level(key(r)) === "station").reduce((a, r) => a + Number(r[6]), 0);
    if (top !== st) problems.push(`T1 ${d}: Σstation ${st} ≠ district ${top}`);
  }
  console.log(`  ✓ ${ds.length} T1 (直轄市議員) district contests: station sums match district rows`);
}

// ---------- 3. 2021 referendum cases 17–20 (agree / disagree)
{
  console.log("2021 referendum");
  for (const [no, fw] of [[17, "１７"], [18, "１８"], [19, "１９"], [20, "２０"]] as const) {
    const dir = join(RAW, `2018_2021公投_2022修憲複決/第${fw}案全國性公投`);
    if (!existsSync(dir)) { problems.push(`missing ${dir}`); continue; }
    const prof = readCsv(join(dir, "rfprof.csv"), true);
    checkPua(`ref${no} rfarea`, readCsv(join(dir, "rfarea.csv"), true));
    const files: ResultsFileT[] = [];
    for (const lv of ["county", "town"] as const) {
      const rows: ResultRow[] = []; const units: ReportingUnit[] = [];
      for (const r of prof) {
        const k = key(r);
        if (level(k) !== lv) continue;
        const id = unitId(k);
        units.push({ id, level: lv, nameZh: "", parentId: null, memberVillageCodes: null, geo: "exact" });
        const pop = n(r[12]);
        rows.push({
          unit: id,
          summary: { valid: n(r[6]), invalid: n(r[9]), ballotsCast: n(r[10]), electors: n(r[11]), population: pop === 0 ? null : pop },
          votes: [Number(r[7]), Number(r[8])],
        });
        if (Number(r[7]) + Number(r[8]) !== Number(r[6])) problems.push(`ref${no} ${id}: agree+disagree ≠ valid`);
      }
      files.push(ResultsFile.parse({
        schemaVersion: 1, contestId: `2021-12-18-referendum.ref${no}`, level: lv, countyCode: null,
        choiceIds: ["agree", "disagree"], units, rows,
      }));
    }
    const nat = prof.find((r) => r[0] === "00")!;
    const agree = Number(nat[7]), dis = Number(nat[8]), electors = Number(nat[11]);
    const passes = agree > dis && agree >= Math.ceil(electors / 4);
    report(`ref${no} (agree ${agree}, disagree ${dis}, ¼ electors ${Math.ceil(electors / 4)} → ${passes ? "passed" : "failed"})`, files);
  }
}

console.log("\nNotes:");
for (const x of [...new Set(notes)]) console.log("  - " + x);
console.log(problems.length ? `\n✗ ${problems.length} problems:\n  ${problems.slice(0, 30).join("\n  ")}` : "\n✓ all numeric checks passed");
process.exitCode = problems.length ? 1 : 0;
