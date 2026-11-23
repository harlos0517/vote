/**
 * Adapter for the CEC 選舉資料庫 "el*" format (2016+ code system: MOI 戶役政 codes).
 * Spec: 選舉資料庫格式.odt (民國101年4月 v4). Older years need their own adapter.
 *
 * Produces a source-shaped intermediate (codes + numbers), no IDs or display
 * decisions — those belong to the contest builder.
 */
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

export function readElDir(dir: string, belongs: (k: ElKey) => boolean = () => true): ElDataset {
  const base = readCecCsv(join(dir, "elbase.csv"));
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
  for (const r of readCecCsv(join(dir, "elprof.csv"))) {
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
  for (const r of readCecCsv(join(dir, "elctks.csv"))) {
    const k = keyOf(r);
    if (!belongs(k)) continue;
    const u = units.get(keyString(k));
    if (!u) throw new Error(`elctks row without elprof row: ${keyString(k)}`);
    const n = int(r[6], "ballot number");
    if (u.votes.has(n)) throw new Error(`duplicate elctks ${keyString(k)} #${n}`);
    u.votes.set(n, int(r[7], "votes"));
    u.officialRate.set(n, Number(r[8]));
  }

  const candidates: ElCandidate[] = readCecCsv(join(dir, "elcand.csv"))
    .filter((r) => belongs(keyOf(r)))
    .map((r) => ({
      key: keyOf(r),
      ballotNumber: int(r[5], "ballot number"),
      name: r[6]!,
      partyCode: int(r[7], "party code"),
      gender: r[8] === "1" ? "M" : r[8] === "2" ? "F" : null,
      birthYearROC: /^\d{7}$/.test(r[9] ?? "") ? Number(r[9]!.slice(0, 3)) : null,
      incumbent: r[13] === "Y" ? true : r[13] === "N" ? false : null,
      electedMark: r[14] ?? "",
      isRunningMate: r[15] === "Y",
    }));

  const parties = readCecCsv(join(dir, "elpaty.csv")).map((r) => ({ code: int(r[0], "party code"), name: r[1]! }));
  return { units: [...units.values()], candidates, parties };
}
