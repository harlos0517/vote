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
  /** elctks's own elected mark per ballot number ("*", …; old files only, data-corrections winners-from-ctks). */
  ctksMarks?: Map<number, string>;
  /**
   * Only candidate votes are known (2010-06-12 files list villages and 選區 in elctks alone):
   * valid = Σ votes; invalid, cast and electors are unknown (published as null).
   */
  partial?: boolean;
  /** A village row whose name repeats another's in the township (data-corrections duplicate-no-code): never given a registry code. */
  noVillageCode?: boolean;
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
  /** Set when this candidate's contest was voted on another day than its group's election (combined maps). */
  contestDate?: string;
  /** 2010-06-12 layout: every winner is marked "*" (no "!" for 婦女保障名額). */
  legacyMarks?: boolean;
  /** data-corrections winner-as-published: keep CEC's marks for this contest though they are not the top vote-getters. */
  winnerAsPublished?: boolean;
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
  /** Parent units whose children do not add up in CEC's own file (data-corrections known-mismatch): warned, not failed. */
  knownMismatch?: ElUnit[];
  /**
   * Townships whose county row is not their registry county (pre-2010 files: 臺中縣's townships
   * belong to 66001, not 66000): registry township code → county code. See countyOf().
   */
  countyOfTown?: Map<string, string>;
  /** Pre-2008 files: printed 得票率 that disagree with the votes only warn (validate/el-checks.ts). */
  ratesUnreliable?: boolean;
  /** Old party number → modern code, set by remapLegacyParties (party-list files need it too). */
  partyRemap?: Map<number, number>;
}

const keyOfRow = (r: string[]): ElKey => ({
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
/** The county a key belongs to: its own code, or for a township and below its old county (ElDataset.countyOfTown). */
export const countyOf = (ds: { countyOfTown?: Map<string, string> }, k: ElKey) =>
  (k.town !== "000" && ds.countyOfTown?.get(k.prv + k.cty + k.town)) || k.prv + k.cty;
export const townCode = (k: ElKey) => k.prv + k.cty + k.town;

function int(s: string | undefined, what: string): number {
  // A minus sign is read (1996 總統 has 無效票 -9) so the non-negative check can name the row.
  if (s === undefined || !/^-?\d+$/.test(s)) throw new Error(`expected integer for ${what}, got ${JSON.stringify(s)}`);
  return Number(s);
}

/**
 * The 2018 files mark code fields as text with a leading apostrophe (`'63`, `'0001`), a
 * spreadsheet export artefact. Strip it from apostrophe + digits only; names are untouched.
 */
function readElRaw(path: string, trim = false): string[][] {
  return readCecCsv(path).map((r) => r.map((f) => (trim ? f.trim() : f)).map((f) => (/^'\d+$/.test(f) ? f.slice(1) : f)));
}

/**
 * Old (2010-06-12) layout: numbers padded with spaces, elprof only down to township, villages
 * and 選區 only in elctks (→ partial units), 3-digit birth years, old party numbers (remapped
 * afterwards by remapLegacyParties).
 */
export interface ElReadOptions {
  legacy?: boolean;
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

/**
 * @param singleContest one nationwide contest: the 選區 field means nothing and is set to "00"
 *   (2008's 不分區 writes 00 in elprof but 01 in elctks).
 */
export function readElDir(dir: string, belongs: (k: ElKey) => boolean = () => true, singleContest = false, opts: ElReadOptions = {}): ElDataset {
  const keyOf = singleContest ? (r: string[]): ElKey => ({ ...keyOfRow(r), dist: "00" }) : keyOfRow;
  const legacy = opts.legacy ?? false;
  // Unit-key columns padded to their width: 1997 縣市長's elbase writes 神岡鄉 as dist "0", town "08".
  const WIDTH = [2, 3, 2, 3, 4];
  const padKey = (r: string[]) => r.map((f, i) => (i < 5 && /^\d+$/.test(f) ? f.padStart(WIDTH[i]!, "0") : f));
  const readEl = (path: string) => readElRaw(path, legacy).map(padKey);
  const base = readEl(elFile(dir, "elbase"));
  // Names are looked up with the district code first ("臺北市第01選區" lives at dist 01), then
  // without it: elbase may use dist "00" where results use "01" (總統), so the fallback key
  // keeps the dist-"00" row and is never overwritten by a district row.
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  // 2005 任務型國代 joins a joint station's villages with ";" (西坪里;坪林里), elsewhere "、".
  for (const r of base) if (r[5]) r[5] = r[5].replace(/;/g, "、");
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
      // Old files may write a fraction here (2001: "177357.813553689"); population is then unknown.
      populationRaw: legacy && /^\d+\.\d+$/.test(r[10] ?? "") ? 0 : int(r[10], `population ${id}`),
      votes: new Map(),
      officialRate: new Map(),
    });
  }
  for (const r of readEl(elFile(dir, "elctks"))) {
    const k = keyOf(r);
    if (!belongs(k)) continue;
    let u = units.get(keyString(k));
    if (!u && legacy) {
      // Village / 選區 rows exist only here: a unit with candidate votes alone.
      u = { key: k, level: levelOf(k), name: nameOf(k), valid: 0, invalid: 0, cast: 0, electors: 0, populationRaw: 0, votes: new Map(), officialRate: new Map(), partial: true };
      units.set(keyString(k), u);
    }
    if (!u) throw new Error(`elctks row without elprof row: ${keyString(k)}`);
    const n = int(r[6], "ballot number");
    if (u.votes.has(n)) throw new Error(`duplicate elctks ${keyString(k)} #${n}`);
    u.votes.set(n, int(r[7], "votes"));
    u.officialRate.set(n, Number(r[8]));
    if (legacy && r[9]) (u.ctksMarks ??= new Map()).set(n, r[9]);
    if (u.partial) u.valid += u.votes.get(n)!;
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
      birthYearROC: /^\d{7}$/.test(r[9] ?? "") ? Number(r[9]!.slice(0, 3)) : legacy && /^\d{3}$/.test(r[9] ?? "") ? Number(r[9]) : null,
      incumbent: r[13] === "Y" ? true : r[13] === "N" ? false : null,
      electedMark: (legacy ? (r[14] ?? "").trim() : r[14]) ?? "",
      isRunningMate: r[15] === "Y",
      ...(legacy ? { legacyMarks: true } : {}),
    }));

  const parties = readElRaw(elFile(dir, "elpaty"), legacy).map((r) => ({ code: int(r[0], "party code"), name: r[1]! }));
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
  // Trimmed: 2005's files pad numbers with spaces ("7.0479 ").
  const members = readElRaw(elFile(dir, "elrepm"), true).map((r) => ({
    partyCode: int(r[0], "party code"),
    rank: int(r[1], "list rank"),
    name: r[2]!,
    gender: r[3] === "1" ? ("M" as const) : r[3] === "2" ? ("F" as const) : null,
    birthYearROC: /^\d{7}$/.test(r[4] ?? "") ? Number(r[4]!.slice(0, 3)) : /^\d{3}$/.test(r[4] ?? "") ? Number(r[4]) : null,
    incumbent: r[8] === "Y" ? true : r[8] === "N" ? false : null,
    electedMark: (r[9] ?? "").trim(),
  }));
  const num = (s: string | undefined, what: string) => {
    if (s === undefined || !/^\d+(\.\d+)?$/.test(s)) throw new Error(`expected number for ${what}, got ${JSON.stringify(s)}`);
    return Number(s);
  };
  const results = readElRaw(elFile(dir, "elretks"), true).map((r) => ({
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
    knownMismatch: parts.flatMap((p) => p.knownMismatch ?? []),
    ...(parts.some((p) => p.countyOfTown) ? { countyOfTown: new Map(parts.flatMap((p) => [...(p.countyOfTown ?? [])])) } : {}),
  };
}

/**
 * Replace old party numbers (2010-06-12 and pre-2008 files: 1 國民黨, 2 民進黨, …, 99 無) with the
 * modern CEC codes, matched by party name against `modern`; 99 ("無") is 999. Names no modern
 * file has take the site's own code from `own` (mappings/legacy-parties.csv); a name with two
 * modern codes, or none at all, fails.
 */
export function remapLegacyParties(ds: ElDataset, modern: ElParty[], own: Map<string, number> = new Map()): { mapped: string[] } {
  const byName = new Map<string, Set<number>>();
  for (const p of modern) byName.set(p.name, (byName.get(p.name) ?? new Set()).add(p.code));
  const map = new Map<number, number>();
  for (const p of ds.parties) {
    const codes = [...(byName.get(p.name) ?? [])];
    if (codes.length > 1 && !own.has(p.name)) throw new Error(`legacy party ${p.code} ${p.name}: modern codes ${codes.join(", ")} share the name — add it to legacy-parties.csv`);
    const code = p.code === 99 && p.name === "無" ? 999 : (own.get(p.name) ?? codes[0]);
    if (code === undefined) throw new Error(`legacy party ${p.code} ${p.name}: no modern party of that name — add it to legacy-parties.csv`);
    map.set(p.code, code);
  }
  ds.partyRemap = map;
  for (const c of ds.candidates) {
    const code = map.get(c.partyCode);
    if (code === undefined) throw new Error(`legacy candidate ${c.name}: unknown party ${c.partyCode}`);
    c.partyCode = code;
  }
  ds.parties = [...map].map(([old, code]) =>
    code === 999 ? (modern.find((p) => p.code === 999) ?? { code: 999, name: "無黨籍及未經政黨推薦" }) : { code, name: ds.parties.find((p) => p.code === old)!.name },
  );
  return { mapped: [...map].map(([a, b]) => `${a}→${b}`) };
}

/** Old (pre-2008, 2010-06-12) files number parties 1, 2, … with 99 = 「無」; modern files use 999. */
export const isLegacyDir = (dir: string): boolean => readElParties(dir).some((p) => p.code === 99 && p.name === "無");

/** Old party numbers without the old layout (2005 任務型國代: 2 = 民主進步黨, which is 16 in modern files). */
export const hasOldPartyNumbers = (dir: string): boolean => isLegacyDir(dir) || readElParties(dir).some((p) => p.code === 2 && p.name === "民主進步黨");

/** Apply a dataset's party remap to its party-list files. */
export function remapPartyList(list: ElPartyList, map: Map<number, number>): ElPartyList {
  const to = (c: number) => {
    const x = map.get(c);
    if (x === undefined) throw new Error(`party list: party ${c} not in elpaty`);
    return x;
  };
  return { members: list.members.map((m) => ({ ...m, partyCode: to(m.partyCode) })), results: list.results.map((r) => ({ ...r, partyCode: to(r.partyCode) })) };
}

/** A directory's party list alone (elpaty), e.g. as modern codes for remapLegacyParties. */
export const readElParties = (dir: string): ElParty[] => readElRaw(elFile(dir, "elpaty")).map((r) => ({ code: int(r[0], "party code"), name: r[1]! }));
