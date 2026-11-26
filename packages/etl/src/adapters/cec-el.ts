/**
 * Adapter for the CEC 選舉資料庫 "el*" format (2016+ code system: MOI 戶役政 codes).
 * Spec: 選舉資料庫格式.odt (民國101年4月 v4). Older years need their own adapter.
 *
 * Produces a source-shaped intermediate (codes + numbers), no IDs or display
 * decisions — those belong to the contest builder.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readCecCsv } from "../lib/csv.ts";

export type ElLevel = "national" | "county" | "district" | "town" | "village" | "station";

export interface ElKey {
  prv: string;
  cty: string;
  dist: string;
  town: string;
  vil: string;
  station: string;
}

export interface ElUnit {
  key: ElKey;
  level: ElLevel;
  name: string;
  valid: number;
  invalid: number;
  cast: number;
  electors: number;
  /** CEC writes 0 where population is not reported; kept raw here, decided by the builder. */
  populationRaw: number;
  /** ballot number -> votes */
  votes: Map<number, number>;
  /** ballot number -> official percentage as published (2 decimals) */
  officialRate: Map<number, number>;
}

export interface ElCandidate {
  key: ElKey;
  ballotNumber: number;
  name: string;
  partyCode: number;
  gender: "M" | "F" | null;
  birthYearROC: number | null;
  incumbent: boolean | null;
  electedMark: string; // "*", "!", "-", ""
  isRunningMate: boolean;
}

export interface ElParty {
  code: number;
  name: string;
}

export interface ElDataset {
  units: ElUnit[];
  candidates: ElCandidate[];
  parties: ElParty[];
  /** Per contest key (county code for county-wide contests). */
  contestNotes?: Map<string, ElContestNote>;
}

const keyOf = (r: string[]): ElKey => ({
  prv: r[0]!,
  cty: r[1]!,
  dist: r[2]!,
  town: r[3]!,
  vil: r[4]!,
  station: (r[5] ?? "0").padStart(4, "0"),
});

export function levelOf(k: ElKey): ElLevel {
  if (k.station !== "0000") return "station";
  if (k.vil !== "0000") return "village";
  if (k.town !== "000") return "town";
  if (k.prv === "00") return "national";
  return k.dist !== "00" ? "district" : "county";
}

export const keyString = (k: ElKey) => `${k.prv}${k.cty}|${k.dist}|${k.town}|${k.vil}|${k.station}`;
export const countyCode = (k: ElKey) => k.prv + k.cty;
export const townCode = (k: ElKey) => k.prv + k.cty + k.town;

function int(s: string | undefined, what: string): number {
  if (s === undefined || !/^\d+$/.test(s)) throw new Error(`expected integer for ${what}, got ${JSON.stringify(s)}`);
  return Number(s);
}

/**
 * The 2018 files mark code fields as text with a leading apostrophe (`'63`, `'0001`), a
 * spreadsheet export artefact. Strip it from apostrophe + digits only; names are untouched.
 */
function readEl(path: string): string[][] {
  return readCecCsv(path).map((r) => r.map((f) => (/^'\d+$/.test(f) ? f.slice(1) : f)));
}

/**
 * Path of one el* file: "elbase.csv", or 2016's suffixed "elbase_P1.csv" (one type code per
 * directory). Fails when neither exists or several suffixes match.
 */
export function elFile(dir: string, name: "elbase" | "elcand" | "elctks" | "elpaty" | "elprof" | "elrepm" | "elretks"): string {
  const plain = join(dir, `${name}.csv`);
  if (existsSync(plain)) return plain;
  const hits = readdirSync(dir).filter((f) => new RegExp(`^${name}_[A-Z]\\d\\.csv$`).test(f));
  if (hits.length !== 1) throw new Error(`${dir}: expected ${name}.csv or one ${name}_<type>.csv, found ${hits.length ? hits.join(", ") : "none"}`);
  return join(dir, hits[0]!);
}

export function readElDir(dir: string, belongs: (k: ElKey) => boolean = () => true): ElDataset {
  const base = readEl(elFile(dir, "elbase"));
  // Names are looked up with the district code first ("臺北市第01選區" lives at dist 01), then
  // without it: elbase may use dist "00" where results use "01" (總統), so the fallback key
  // keeps the dist-"00" row and is never overwritten by a district row.
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  for (const r of base) {
    exact.set(`${r[0]}${r[1]}|${r[2]}|${r[3]}|${r[4]}`, r[5]!);
    const lk = `${r[0]}${r[1]}|${r[3]}|${r[4]}`;
    if (r[2] === "00" || !loose.has(lk)) loose.set(lk, r[5]!);
  }
  const nameOf = (k: ElKey) =>
    levelOf(k) === "national"
      ? "全國"
      : (exact.get(`${k.prv}${k.cty}|${k.dist}|${k.town}|${k.vil}`) ?? loose.get(`${k.prv}${k.cty}|${k.town}|${k.vil}`) ?? "");

  const units = new Map<string, ElUnit>();
  for (const r of readEl(elFile(dir, "elprof"))) {
    const k = keyOf(r);
    if (!belongs(k)) continue;
    const id = keyString(k);
    if (units.has(id)) throw new Error(`duplicate elprof row ${id}`);
    units.set(id, {
      key: k,
      level: levelOf(k),
      name: nameOf(k),
      valid: int(r[6], `valid ${id}`),
      invalid: int(r[7], `invalid ${id}`),
      cast: int(r[8], `cast ${id}`),
      electors: int(r[9], `electors ${id}`),
      populationRaw: int(r[10], `population ${id}`),
      votes: new Map(),
      officialRate: new Map(),
    });
  }
  for (const r of readEl(elFile(dir, "elctks"))) {
    const k = keyOf(r);
    if (!belongs(k)) continue;
    const u = units.get(keyString(k));
    if (!u) throw new Error(`elctks row without elprof row: ${keyString(k)}`);
    const n = int(r[6], "ballot number");
    if (u.votes.has(n)) throw new Error(`duplicate elctks ${keyString(k)} #${n}`);
    u.votes.set(n, int(r[7], "votes"));
    u.officialRate.set(n, Number(r[8]));
  }

  // elcand has no station column (column 5 is the ballot number): its rows are contest keys.
  const candKey = (r: string[]): ElKey => ({ ...keyOf(r), station: "0000" });
  const candidates: ElCandidate[] = readEl(elFile(dir, "elcand"))
    .filter((r) => belongs(candKey(r)))
    .map((r) => ({
      key: candKey(r),
      ballotNumber: int(r[5], "ballot number"),
      name: r[6]!,
      partyCode: int(r[7], "party code"),
      gender: r[8] === "1" ? "M" : r[8] === "2" ? "F" : null,
      birthYearROC: /^\d{7}$/.test(r[9] ?? "") ? Number(r[9]!.slice(0, 3)) : null,
      incumbent: r[13] === "Y" ? true : r[13] === "N" ? false : null,
      electedMark: r[14] ?? "",
      isRunningMate: r[15] === "Y",
    }));

  const parties = readEl(elFile(dir, "elpaty")).map((r) => ({ code: int(r[0], "party code"), name: r[1]! }));
  return { units: [...units.values()], candidates, parties };
}

/** 不分區政黨名單 member (elrepm.csv). */
export interface ElListMember {
  partyCode: number;
  rank: number;
  name: string;
  gender: "M" | "F" | null;
  birthYearROC: number | null;
  incumbent: boolean | null;
  electedMark: string; // "*", "!" (women quota), "-" (displaced by it), ""
}

/** 不分區政黨 allocation as published (elretks.csv). */
export interface ElListResult {
  partyCode: number;
  voteSharePct: number;
  qualifiedSharePct: number;
  nominated: number;
  seats: number;
}

export interface ElPartyList {
  members: ElListMember[];
  results: ElListResult[];
}

/** Read the party-list extras that only 不分區政黨 directories have. */
export function readElPartyList(dir: string): ElPartyList {
  const members = readEl(elFile(dir, "elrepm")).map((r) => ({
    partyCode: int(r[0], "party code"),
    rank: int(r[1], "list rank"),
    name: r[2]!,
    gender: r[3] === "1" ? ("M" as const) : r[3] === "2" ? ("F" as const) : null,
    birthYearROC: /^\d{7}$/.test(r[4] ?? "") ? Number(r[4]!.slice(0, 3)) : null,
    incumbent: r[8] === "Y" ? true : r[8] === "N" ? false : null,
    electedMark: (r[9] ?? "").trim(),
  }));
  const num = (s: string | undefined, what: string) => {
    if (s === undefined || !/^\d+(\.\d+)?$/.test(s)) throw new Error(`expected number for ${what}, got ${JSON.stringify(s)}`);
    return Number(s);
  };
  const results = readEl(elFile(dir, "elretks")).map((r) => ({
    partyCode: int(r[0], "party code"),
    voteSharePct: num(r[1], "vote share"),
    qualifiedSharePct: num(r[2], "qualified share"),
    nominated: int(r[3], "nominated"),
    seats: int(r[4], "seats"),
  }));
  return { members, results };
}

/** Contest-level facts an adapter knows beyond the el* files (keyed by county code). */
export interface ElContestNote {
  /** Set when the contest was held on another day than its election (e.g. a rerun). */
  date: string | null;
  warnings: string[];
}

/**
 * Merge el* datasets of one office split over several directories (2022: `prv` and `city`).
 * Their national rows sum different contests per directory, so they are dropped and one
 * national row is rebuilt from the county rows (summary only; no candidate votes there).
 */
export function mergeElDatasets(parts: ElDataset[]): ElDataset {
  const units = parts.flatMap((p) => p.units.filter((u) => u.level !== "national"));
  const seen = new Set<string>();
  for (const u of units) {
    const k = keyString(u.key);
    if (seen.has(k)) throw new Error(`merge: unit ${k} appears in two directories`);
    seen.add(k);
  }
  const counties = units.filter((u) => u.level === "county");
  const sum = (f: (u: ElUnit) => number) => counties.reduce((a, u) => a + f(u), 0);
  const national: ElUnit = {
    key: { prv: "00", cty: "000", dist: "00", town: "000", vil: "0000", station: "0000" },
    level: "national",
    name: "全國",
    valid: sum((u) => u.valid),
    invalid: sum((u) => u.invalid),
    cast: sum((u) => u.cast),
    electors: sum((u) => u.electors),
    populationRaw: counties.some((u) => u.populationRaw === 0) ? 0 : sum((u) => u.populationRaw),
    votes: new Map(),
    officialRate: new Map(),
  };
  const parties = new Map<number, ElParty>();
  for (const p of parts) for (const x of p.parties) parties.set(x.code, x);
  return {
    units: [national, ...units],
    candidates: parts.flatMap((p) => p.candidates),
    parties: [...parties.values()],
    contestNotes: new Map(parts.flatMap((p) => [...(p.contestNotes ?? [])])),
  };
}
