/**
 * Adapter for the CEC 公民投票 "rf*" format (2018–2021 cases): rfarea (names), rfprof
 * (per-unit counts incl. 同意/不同意) and rftckt (published rates and the national result).
 * Both files have an English header row. Produces the same intermediate as the el* adapter,
 * with ballot "numbers" 1 = 同意 and 2 = 不同意, so the shared hierarchy checks apply.
 */
import { join } from "node:path";
import { readCecCsv } from "../lib/csv.ts";
import { type ElDataset, type ElKey, type ElUnit, keyString, levelOf } from "./cec-el.ts";

export const AGREE = 1;
export const DISAGREE = 2;

export interface RfDataset extends ElDataset {
  /** rftckt's vote_result on the national row (it repeats the national result on every row). */
  nationalResult: "Y" | "N";
  /** rftckt's published 同意 / 不同意 counts on the national row, for cross-checking rfprof. */
  nationalPublished: { agree: number; disagree: number; electors: number };
}

function int(s: string | undefined, what: string): number {
  if (s === undefined || !/^\d+$/.test(s)) throw new Error(`rf: expected integer for ${what}, got ${JSON.stringify(s)}`);
  return Number(s);
}

const keyOf = (r: string[]): ElKey => ({ prv: r[0]!, cty: r[1]!, dist: r[2]!, town: r[3]!, vil: r[4]!, station: (r[5] ?? "0000").padStart(4, "0") });

/**
 * 2018 rf* files number townships in CEC's own sequence (臺北市松山區 = 001) instead of the
 * household-registry codes used everywhere else (= 010). `towns` maps "<county code>|<name>"
 * to the registry town code, built from a same-day el* elbase; every township must match
 * exactly one entry or reading fails. Codes below township level stay as published (they are
 * only used for the internal hierarchy checks; nothing below township is emitted).
 */
export function renumberTowns(ds: RfDataset, towns: Map<string, string>): { renamed: number } {
  const byOld = new Map<string, string>(); // "<county>|<old town>" → new town code
  const used = new Map<string, string>();
  for (const u of ds.units.filter((x) => x.level === "town")) {
    const cc = u.key.prv + u.key.cty;
    const code = towns.get(`${cc}|${u.name}`);
    if (!code) throw new Error(`rf: no registry code for township ${cc} ${u.name}`);
    const prev = used.get(`${cc}|${code}`);
    if (prev) throw new Error(`rf: ${u.name} and ${prev} both map to ${cc}${code}`);
    used.set(`${cc}|${code}`, u.name);
    byOld.set(`${cc}|${u.key.town}`, code);
  }
  for (const u of ds.units) {
    if (u.key.town === "000") continue;
    const code = byOld.get(`${u.key.prv}${u.key.cty}|${u.key.town}`);
    if (!code) throw new Error(`rf: unit below an unknown township ${u.key.prv}${u.key.cty}${u.key.town}`);
    u.key = { ...u.key, town: code };
  }
  return { renamed: byOld.size };
}

export function readRfDir(dir: string): RfDataset {
  const names = new Map<string, string>();
  for (const r of readCecCsv(join(dir, "rfarea.csv"), { header: true })) names.set(`${r[0]}${r[1]}|${r[3]}|${r[4]}`, r[5]!);
  const units: ElUnit[] = [];
  const seen = new Set<string>();
  for (const r of readCecCsv(join(dir, "rfprof.csv"), { header: true })) {
    const k = keyOf(r);
    const id = keyString(k);
    if (seen.has(id)) throw new Error(`rf: duplicate rfprof row ${id}`);
    seen.add(id);
    const level = levelOf(k);
    const [valid, agree, disagree, invalid, cast, electors, population] = [6, 7, 8, 9, 10, 11, 12].map((i) => int(r[i], `${id} col ${i}`));
    units.push({
      key: k,
      level,
      name: level === "national" ? "全國" : (names.get(`${k.prv}${k.cty}|${k.town}|${k.vil}`) ?? ""),
      valid: valid!,
      invalid: invalid!,
      cast: cast!,
      electors: electors!,
      populationRaw: population!,
      votes: new Map([[AGREE, agree!], [DISAGREE, disagree!]]),
      officialRate: new Map(),
    });
  }
  const nat = readCecCsv(join(dir, "rftckt.csv"), { header: true }).find((r) => r[0] === "00");
  if (!nat) throw new Error("rf: rftckt has no national row");
  const result = nat[12];
  if (result !== "Y" && result !== "N") throw new Error(`rf: bad vote_result ${result}`);
  return {
    units,
    candidates: [],
    parties: [],
    nationalResult: result,
    nationalPublished: { electors: int(nat[6], "rftckt electors"), agree: int(nat[7], "rftckt agree"), disagree: int(nat[9], "rftckt disagree") },
  };
}
