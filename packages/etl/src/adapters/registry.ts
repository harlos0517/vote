/**
 * Translate CEC's own sequence codes (2012 and earlier: 臺北市 = "01", 北投區 = "001") into the
 * household-registry codes used everywhere else (63000, 63000120), by name, against a later
 * registry-coded reference (the 2014 local elections' elbase).
 *
 * - Counties and townships match by exact name, or through a reviewed rename
 *   (mappings/admin-renames.csv: 桃園縣 → 桃園市, whose 鄉鎮市 became 區 and 村 became 里).
 * - Villages match by exact name in the township; anything else must be listed in
 *   mappings/village-renames.csv (variant characters, or "-" for villages reorganised before
 *   the reference, which have no registry code). An unlisted village fails the build.
 * - A village without a registry code keeps its unit as "vgrp:<town>-Z<seq>": drawn nowhere,
 *   its votes count in the township. Village groups become "vgrp:<town>-G<seq>".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";
import { type ElDataset, type ElKey, type ElUnit, keyString, levelOf } from "./cec-el.ts";

export interface AdminRename {
  /** "county": old county name → new; "town": "<old county><old town>" → new town name. */
  kind: "county" | "town";
  old: string;
  new: string;
  source: string;
  reviewed: boolean;
}

export interface VillageRename {
  /** Registry village code (11 digits), or null: reorganised before the reference, no code. */
  code: string | null;
  source: string;
  reviewed: boolean;
}

export function loadAdminRenames(repoRoot: string): AdminRename[] {
  return parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/admin-renames.csv"), "utf8"), { header: true, quotedCommas: true }).map(
    ([kind, oldName, newName, , source, status]) => {
      if ((kind !== "county" && kind !== "town") || !oldName || !newName || !source) throw new Error(`admin-renames.csv: bad row ${oldName}`);
      if (status !== "reviewed" && status !== "unreviewed") throw new Error(`admin-renames.csv: bad status ${status}`);
      return { kind, old: oldName, new: newName, source, reviewed: status === "reviewed" };
    },
  );
}

/** "<election>|<registry town code>|<village name as CEC wrote it>" → rename. */
export function loadVillageRenames(repoRoot: string): Map<string, VillageRename> {
  const out = new Map<string, VillageRename>();
  for (const [election, town, name, code, source, status] of parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/village-renames.csv"), "utf8"), { header: true, quotedCommas: true })) {
    if (!election || !/^\d{8}$/.test(town ?? "") || !name || !source) throw new Error(`village-renames.csv: bad row ${town} ${name}`);
    if (code !== "-" && !(code && code.startsWith(town!) && /^\d{11}$/.test(code))) throw new Error(`village-renames.csv: bad code ${code} for ${town} ${name}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`village-renames.csv: bad status ${status}`);
    out.set(`${election}|${town}|${name}`, { code: code === "-" ? null : code!, source, reviewed: status === "reviewed" });
  }
  return out;
}

/** Names CEC left empty (mappings/missing-names.csv): "<election>|<prv|cty|town|vil as in the file>" → name. */
export function loadMissingNames(repoRoot: string): Map<string, { name: string; reviewed: boolean }> {
  const out = new Map<string, { name: string; reviewed: boolean }>();
  for (const [election, key, name, source, status] of parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/missing-names.csv"), "utf8"), { header: true, quotedCommas: true })) {
    if (!election || !/^\d{2}\|\d{3}\|\d{3}\|\w{4}$/.test(key ?? "") || !name || !source) throw new Error(`missing-names.csv: bad row ${key}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`missing-names.csv: bad status ${status}`);
    out.set(`${election}|${key}`, { name, reviewed: status === "reviewed" });
  }
  return out;
}

/** Fill units whose name CEC left empty; returns how many (and how many unreviewed). */
export function fillMissingNames(ds: ElDataset, election: string, names: Map<string, { name: string; reviewed: boolean }>): { filled: number; unreviewed: number } {
  let filled = 0;
  let unreviewed = 0;
  for (const u of ds.units) {
    if (u.name !== "" || u.level === "national" || u.level === "station") continue;
    const m = names.get(`${election}|${u.key.prv}|${u.key.cty}|${u.key.town}|${u.key.vil}`);
    if (!m) continue;
    u.name = m.name;
    filled++;
    if (!m.reviewed) unreviewed++;
  }
  return { filled, unreviewed };
}

/** Registry names of the reference: counties, townships per county, villages per township. */
export interface RegistryReference {
  county: Map<string, string>; // name → 5-digit code
  town: Map<string, string>; // "<county code>|<name>" → 8-digit code
  village: Map<string, string>; // "<town code>|<name>" → 11-digit code
}

export function registryReference(datasets: ElDataset[]): RegistryReference {
  const ref: RegistryReference = { county: new Map(), town: new Map(), village: new Map() };
  for (const ds of datasets) {
    for (const u of ds.units) {
      const cc = u.key.prv + u.key.cty;
      if (u.level === "county") ref.county.set(u.name, cc);
      else if (u.level === "town") ref.town.set(`${cc}|${u.name}`, cc + u.key.town);
      else if (u.level === "village" && /^0\d{3}$/.test(u.key.vil) && !u.name.includes("、")) ref.village.set(`${cc}${u.key.town}|${u.name}`, `${cc}${u.key.town}${u.key.vil.slice(1)}`);
    }
  }
  // The 2014 files give 臺南市北門區 塩田里 and 公塭里 each other's codes; NLSC (every snapshot) and
  // CEC's 2016, 2020 and 2022 files have 塩田里 = 67000350019, 公塭里 = 67000350024.
  const swapped = [["67000350|塩田里", "67000350024", "67000350019"], ["67000350|公塭里", "67000350019", "67000350024"]] as const;
  if (swapped.every(([k, bad]) => ref.village.get(k) === bad)) for (const [k, , good] of swapped) ref.village.set(k, good);
  return ref;
}

const stem = (name: string) => name.replace(/[鄉鎮市區]$/u, "");
/** 台 / 臺 are the same character in place names (2008: 台西鄉, 台東市; later 臺西鄉, 臺東市). */
const tai = (name: string) => name.replace(/台/gu, "臺");

/**
 * Rewrite every unit and candidate key of `ds` from CEC sequence codes to registry codes.
 * Returns checks for the review status of the renames used.
 */
/**
 * Counties merged on 2010-12-25 whose two halves both held county-wide elections before then
 * (admin-renames.csv: 臺中縣 → 臺中市, …): [old 縣, old 市]. 臺北縣 became 新北市 alone.
 */
export const MERGED_2010: [string, string][] = [["臺中縣", "臺中市"], ["臺南縣", "臺南市"], ["高雄縣", "高雄市"]];

export interface RenumberOptions {
  /**
   * Pre-2010 maps where both halves of a MERGED_2010 county elected their own 縣市長 / 議員:
   * county-wide files put the old 縣 under 選區 "01" and the old 市 under "02" (two contests in
   * one county, the county row their sum); districted files number the old 市's 選區 from 51.
   */
  oldCountyContests?: boolean;
}

export function renumberToRegistry(ds: ElDataset, election: string, ref: RegistryReference, admin: AdminRename[], villages: Map<string, VillageRename>, opts: RenumberOptions = {}): ValidationCheck[] {
  const county = new Map<string, string>(); // old "prv+cty" → new 5-digit
  const town = new Map<string, string>(); // old "prv+cty+town" → new 8-digit
  const renamedCounty = new Set<string>(); // new codes of counties reached through a rename
  const usedAdmin: AdminRename[] = [];
  const bad: string[] = [];
  for (const u of ds.units.filter((x) => x.level === "county")) {
    const r = admin.find((a) => a.kind === "county" && a.old === u.name);
    const code = ref.county.get(r ? r.new : u.name);
    if (!code) { bad.push(`county ${u.name}`); continue; }
    if (r) { usedAdmin.push(r); renamedCounty.add(code); }
    county.set(u.key.prv + u.key.cty, code);
  }
  const townByTai = new Map([...ref.town].map(([k, c]) => [tai(k), c]));
  const stemTowns = new Set<string>(); // townships matched by stem: their 村 may have become 里
  const townsOf = new Map<string, Map<string, string | null>>(); // new county → stem → code (null: two towns share it)
  for (const [k, code] of ref.town) {
    const [cc, name] = k.split("|") as [string, string];
    if (!townsOf.has(cc)) townsOf.set(cc, new Map());
    const m = townsOf.get(cc)!;
    m.set(stem(name), m.has(stem(name)) ? null : code);
  }
  const oldCountyName = new Map(ds.units.filter((x) => x.level === "county").map((u) => [u.key.prv + u.key.cty, u.name]));
  const mergedTowns = new Set<string>(); // new codes reached by an admin-renames town row (several old townships may share one)
  for (const u of ds.units.filter((x) => x.level === "town")) {
    const oldT = u.key.prv + u.key.cty + u.key.town;
    if (town.has(oldT)) continue; // several rows per town (districts)
    const cc = county.get(u.key.prv + u.key.cty);
    if (!cc) continue;
    // A township renamed outright (高雄縣三民鄉 → 那瑪夏區): its row wins over name matching.
    const tr = admin.find((a) => a.kind === "town" && a.old === `${oldCountyName.get(u.key.prv + u.key.cty)}${u.name}`);
    if (tr) {
      const code = ref.town.get(`${cc}|${tr.new}`);
      if (!code) bad.push(`town rename ${tr.old} → ${tr.new}: no such town in ${cc}`);
      else { town.set(oldT, code); usedAdmin.push(tr); mergedTowns.add(code); }
      continue;
    }
    // A renamed county's 鄉鎮市 became 區 with the same stem (中壢市 → 中壢區).
    const exact = ref.town.get(`${cc}|${u.name}`) ?? townByTai.get(`${cc}|${tai(u.name)}`);
    // Otherwise the same name with another suffix: a renamed county's 鄉鎮市 became 區, and many
    // townships were upgraded (鄉 → 市, 鎮 → 市) over the years. Only stems unique in the county.
    const byStem = exact ? undefined : (townsOf.get(cc)?.get(stem(u.name)) ?? undefined);
    const code = exact ?? byStem;
    if (!code) bad.push(`town ${u.name} (${cc})`);
    else {
      town.set(oldT, code);
      if (byStem) stemTowns.add(code);
    }
  }
  // Two old townships may not land on one registry township.
  // (代表 files also have a row per 選區 inside a township, under the same old code: compare codes.)
  const byNewTown = new Map<string, string[]>();
  for (const [oldT, t] of town) byNewTown.set(t, [...(byNewTown.get(t) ?? []), oldT]);
  // (Except townships merged by an admin-renames row: 臺南市中區 + 西區 → 中西區, summed below.)
  for (const [t, names] of byNewTown) if (names.length > 1 && !mergedTowns.has(t)) bad.push(`townships ${names.join(" and ")} both map to ${t}`);
  // Counties merged on 2010-12-25 (臺中縣 + 臺中市 → 臺中市, …) numbered their 選區 from 01 each:
  // later old counties' 選區 continue after the earlier ones' (CEC's 選區 names are kept).
  const distOffset = new Map<string, number>(); // old county → offset
  const nextDist = new Map<string, number>(); // new county → highest 選區 so far
  for (const [oldC, newC] of [...county].sort(([a], [b]) => a.localeCompare(b))) {
    const dists = ds.units.filter((u) => u.key.prv + u.key.cty === oldC && u.key.dist !== "00").map((u) => Number(u.key.dist));
    if (!dists.length) continue;
    const off = nextDist.get(newC) ?? 0;
    distOffset.set(oldC, off);
    nextDist.set(newC, off + Math.max(...dists));
  }
  const splitDist = new Map<string, string>(); // old county → its 選區 in a county-wide file
  if (opts.oldCountyContests) {
    const oldName = new Map(ds.units.filter((x) => x.level === "county").map((u) => [u.key.prv + u.key.cty, u.name]));
    for (const [oldC] of county) {
      const half = MERGED_2010.flatMap(([a, b]) => (oldName.get(oldC) === a ? [1] : oldName.get(oldC) === b ? [2] : []))[0];
      if (!half) continue;
      const districted = ds.units.some((u) => u.key.prv + u.key.cty === oldC && u.key.dist !== "00");
      if (districted) distOffset.set(oldC, half === 2 ? 50 : 0);
      else splitDist.set(oldC, half === 1 ? "01" : "02");
    }
  }
  // Villages: old "prv+cty+town|vil" → new 4-char village field ("0xxx", or "Zxxx" without a code).
  const vil = new Map<string, string>();
  const usedRenames: VillageRename[] = [];
  let noCode = 0;
  const claimed = new Map<string, string>();
  for (const u of ds.units.filter((x) => x.level === "village")) {
    const oldK = `${u.key.prv}${u.key.cty}${u.key.town}|${u.key.vil}`;
    if (vil.has(oldK)) continue;
    const tc = town.get(u.key.prv + u.key.cty + u.key.town);
    if (!tc) continue;
    // Village groups keep CEC's number, prefixed "G" so it cannot collide with a registry village code.
    // (A group is named with 「、」 or has a letter code; CEC's county-wide numbers may exceed 999.)
    if (!/^\d{4}$/.test(u.key.vil) || u.name.includes("、")) { vil.set(oldK, `G${u.key.vil.slice(1)}`); continue; }
    if (u.noVillageCode) { noCode++; vil.set(oldK, `Z${u.key.vil.slice(1)}`); continue; }
    // 村 became 里 when a county became a municipality or a township became a 市.
    const renamed = renamedCounty.has(tc.slice(0, 5)) || stemTowns.has(tc) ? u.name.replace(/村$/u, "里") : u.name;
    let code = ref.village.get(`${tc}|${u.name}`) ?? ref.village.get(`${tc}|${renamed}`) ?? null;
    if (!code) {
      const r = villages.get(`${election}|${tc}|${u.name}`);
      if (!r) { bad.push(`village ${tc} ${u.name}`); continue; }
      usedRenames.push(r);
      code = r.code;
    }
    if (code) {
      const prev = claimed.get(code);
      if (prev) { bad.push(`villages ${prev} and ${u.name} both map to ${code}`); continue; }
      claimed.set(code, u.name);
      vil.set(oldK, `0${code.slice(8)}`);
    } else {
      noCode++;
      vil.set(oldK, `Z${u.key.vil.slice(1)}`);
    }
  }
  if (bad.length) throw new Error(`renumber ${election}: no registry code for ${bad.slice(0, 12).join("; ")}${bad.length > 12 ? ` … (+${bad.length - 12})` : ""} — add rows to admin-renames.csv / village-renames.csv`);
  const rekey = (k: ElKey): ElKey => {
    if (k.prv === "00") return k;
    const oldC = k.prv + k.cty;
    const cc = county.get(oldC)!;
    const t = k.town === "000" ? null : town.get(oldC + k.town)!;
    const v = k.vil === "0000" ? "0000" : vil.get(`${oldC}${k.town}|${k.vil}`)!;
    if (!cc || (k.town !== "000" && !t) || !v) throw new Error(`renumber ${election}: unmapped key ${keyString(k)}`);
    const off = distOffset.get(oldC) ?? 0;
    const split = splitDist.get(oldC);
    const dist = split && k.dist === "00" ? split : k.dist === "00" || off === 0 ? k.dist : String(Number(k.dist) + off).padStart(2, "0");
    return { ...k, prv: cc.slice(0, 2), cty: cc.slice(2), dist, town: t ? t.slice(5) : "000", vil: v };
  };
  for (const u of ds.units) { u.key = rekey(u.key); u.level = levelOf(u.key); }
  for (const c of ds.candidates) c.key = rekey(c.key);
  // Split old counties' own rows are now 選區 rows: the county row is their sum (built below with the merged ones).
  for (const oldC of splitDist.keys()) {
    const row = ds.units.find((u) => u.level === "district" && u.key.town === "000" && oldCountyName.get(oldC) === u.name);
    if (!row) throw new Error(`renumber ${election}: no county row for ${oldCountyName.get(oldC)}`);
    // No candidate votes: the row spans two contests whose ballot numbers mean different people.
    ds.units.push({ ...row, key: { ...row.key, dist: "00" }, level: "county", votes: new Map(), officialRate: new Map() });
  }
  // Merged counties (高雄縣 + 高雄市 → 64000) each had a county row: sum them into one.
  const byKey = new Map<string, ElUnit[]>();
  for (const u of ds.units) byKey.set(keyString(u.key), [...(byKey.get(keyString(u.key)) ?? []), u]);
  const dupes = [...byKey.values()].filter((us) => us.length > 1);
  const notCounty = dupes.filter((us) => us[0]!.level !== "county" && !(us[0]!.level === "town" && mergedTowns.has(us[0]!.key.prv + us[0]!.key.cty + us[0]!.key.town)));
  if (notCounty.length) throw new Error(`renumber ${election}: units collide after renumbering: ${notCounty.slice(0, 6).map((us) => `${keyString(us[0]!.key)} (${us.map((u) => u.name || "∅").join(" / ")})`).join("; ")}`);
  for (const us of dupes) {
    const [first, ...rest] = us as [ElUnit, ...ElUnit[]];
    for (const u of rest) {
      first.valid += u.valid; first.invalid += u.invalid; first.cast += u.cast; first.electors += u.electors;
      first.populationRaw = first.populationRaw && u.populationRaw ? first.populationRaw + u.populationRaw : 0;
      for (const [n, v] of u.votes) first.votes.set(n, (first.votes.get(n) ?? 0) + v);
    }
    // Shares of the summed row are recomputed (the published ones belong to the old counties).
    for (const [n, v] of first.votes) first.officialRate.set(n, first.valid ? Math.round((v / first.valid) * 10000) / 100 : 0);
    const renamedTo = first.level === "town"
      ? admin.find((a) => a.kind === "town" && us.some((u) => a.old.endsWith(u.name)))?.new
      : admin.find((a) => a.kind === "county" && us.some((u) => u.name === a.old))?.new;
    if (renamedTo) first.name = renamedTo;
    ds.units = ds.units.filter((u) => !rest.includes(u));
  }
  const unrevA = usedAdmin.filter((a) => !a.reviewed).length;
  const unrevV = usedRenames.filter((r) => !r.reviewed).length;
  return [
    {
      id: "registry-codes",
      status: unrevA || unrevV ? "warn" : "pass",
      detail:
        `CEC sequence codes → registry codes by name: ${county.size} counties, ${town.size} townships, ${vil.size} villages` +
        `${usedAdmin.length ? `; via renamed county ${[...new Set(usedAdmin.map((a) => `${a.old}→${a.new}`))].join(", ")}` : ""}` +
        `${usedRenames.length ? `; ${usedRenames.length} villages via village-renames.csv (${noCode} with no registry code)` : ""}` +
        `${unrevA || unrevV ? `; ${unrevA + unrevV} rename rows not yet reviewed` : ""}`,
    },
  ];
}
