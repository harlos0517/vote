/**
 * Mixed village snapshots (Phase 2, 2020/2021): when villages were reorganised around an
 * election, some townships' village codes are missing from the year's own snapshot. For those
 * townships only, villages are taken from the snapshot nearest the election whose villages
 * contain all of that township's reported villages. The choice is recomputed from the data on
 * every build and recorded on the group (warning + boundary version id), never hand-picked.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error mapshaper ships no type declarations
import mapshaper from "mapshaper";
import { parseCecCsv } from "../lib/csv.ts";

export interface Snapshot {
  versionId: string; // "nlsc-village-1091030"
  shp: string;
}

/** ROC "1091030" in the version id → "2020-10-30". */
export const snapshotDate = (versionId: string) => {
  const m = /(\d{3})(\d{2})(\d{2})$/.exec(versionId)!;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
};

const codeCache = new Map<string, Set<string>>();
/** VILLCODEs of a snapshot (real villages only: 11 digits). */
export async function snapshotCodes(s: Snapshot, workDir: string): Promise<Set<string>> {
  const hit = codeCache.get(s.versionId);
  if (hit) return hit;
  mkdirSync(workDir, { recursive: true });
  const out = join(workDir, `${s.versionId}-codes.csv`);
  await mapshaper.runCommands(`-i ${JSON.stringify(s.shp)} encoding=utf8 -filter-fields VILLCODE -o ${JSON.stringify(out)} format=csv`);
  const codes = new Set(parseCecCsv(readFileSync(out, "utf8"), { header: true }).map((r) => r[0]!).filter((c) => /^\d{11}$/.test(c)));
  codeCache.set(s.versionId, codes);
  return codes;
}

export interface MixPlan {
  /** Township code → snapshot it is taken from instead of the base. */
  swaps: Map<string, Snapshot>;
  /** Townships no snapshot covers (their unmatched villages stay 無資料). */
  unresolved: string[];
}

/**
 * `villages`: villages reported on their own. `known`: those plus members of village groups.
 * A township is swapped when the base snapshot lacks a reported village, or — with `strict`
 * (general electorate, where every village is reported) — has villages the election does not know
 * (e.g. 新城鄉新秀村, split off after the 2021 vote). The replacement, the snapshot nearest the
 * election, must pass the same test. Pure: snapshot codes are passed in.
 */
export function chooseSwaps<S extends { versionId: string; codes: Set<string> }>(
  electionDate: string,
  base: S,
  others: S[],
  villages: string[],
  known: Set<string>,
  strict: boolean,
): { swaps: Map<string, S>; unresolved: string[] } {
  const byTown = new Map<string, string[]>();
  for (const v of villages) byTown.set(v.slice(0, 8), [...(byTown.get(v.slice(0, 8)) ?? []), v]);
  const fits = (codes: Set<string>, town: string, vs: string[]) =>
    vs.every((v) => codes.has(v)) && (!strict || [...codes].every((c) => !c.startsWith(town) || known.has(c)));
  const days = (s: S) => Math.abs(Date.parse(snapshotDate(s.versionId)) - Date.parse(electionDate));
  const nearest = [...others].sort((a, b) => days(a) - days(b));
  const swaps = new Map<string, S>();
  const unresolved: string[] = [];
  for (const [town, vs] of byTown) {
    if (fits(base.codes, town, vs)) continue;
    const found = nearest.find((s) => fits(s.codes, town, vs));
    if (found) swaps.set(town, found);
    else unresolved.push(town);
  }
  return { swaps, unresolved };
}

export async function planMix(
  electionDate: string,
  base: Snapshot,
  others: Snapshot[],
  villages: string[],
  known: Set<string>,
  strict: boolean,
  workDir: string,
): Promise<MixPlan> {
  const withCodes = async (s: Snapshot) => ({ ...s, codes: await snapshotCodes(s, workDir) });
  const r = chooseSwaps(electionDate, await withCodes(base), await Promise.all(others.map(withCodes)), villages, known, strict);
  return { swaps: new Map([...r.swaps].map(([t, s]) => [t, { versionId: s.versionId, shp: s.shp }])), unresolved: r.unresolved };
}

/** Base snapshot with the swapped townships' villages replaced; written as GeoJSON for the boundary builders. */
export async function buildComposite(base: Snapshot, plan: MixPlan, workDir: string): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const q = (p: string) => JSON.stringify(p);
  const towns = [...plan.swaps.keys()];
  const bySnap = new Map<string, { s: Snapshot; towns: string[] }>();
  for (const [t, s] of plan.swaps) bySnap.set(s.versionId, { s, towns: [...(bySnap.get(s.versionId)?.towns ?? []), t] });
  // Single-quoted JS array inside the double-quoted mapshaper expression.
  const list = (ts: string[]) => `[${ts.map((t) => `'${t}'`).join(",")}]`;
  const parts: string[] = [];
  const keep = "VILLCODE,VILLNAME,TOWNCODE,COUNTYCODE";
  parts.push(`-i ${q(base.shp)} encoding=utf8 name=base -filter "!${list(towns)}.includes(TOWNCODE)" -filter-fields ${keep}`);
  let n = 0;
  for (const { s, towns: ts } of bySnap.values()) {
    parts.push(`-i ${q(s.shp)} encoding=utf8 name=alt${n++} -filter "${list(ts)}.includes(TOWNCODE)" -filter-fields ${keep}`);
  }
  const out = join(workDir, "composite.json");
  parts.push(`-merge-layers target=* force name=village -o ${q(out)} format=geojson`);
  await mapshaper.runCommands(parts.join(" "));
  return out;
}
