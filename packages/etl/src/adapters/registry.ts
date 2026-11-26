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
import { type ElDataset, type ElKey, keyString } from "./cec-el.ts";

export interface AdminRename {
  kind: "county";
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
      if (kind !== "county" || !oldName || !newName || !source) throw new Error(`admin-renames.csv: bad row ${oldName}`);
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
  return ref;
}

const stem = (name: string) => name.replace(/[鄉鎮市區]$/u, "");

/**
 * Rewrite every unit and candidate key of `ds` from CEC sequence codes to registry codes.
 * Returns checks for the review status of the renames used.
 */
export function renumberToRegistry(ds: ElDataset, election: string, ref: RegistryReference, admin: AdminRename[], villages: Map<string, VillageRename>): ValidationCheck[] {
  const county = new Map<string, string>(); // old "prv+cty" → new 5-digit
  const town = new Map<string, string>(); // old "prv+cty+town" → new 8-digit
  const renamedCounty = new Set<string>(); // new codes of counties reached through a rename
  const usedAdmin: AdminRename[] = [];
  const bad: string[] = [];
  for (const u of ds.units.filter((x) => x.level === "county")) {
    const r = admin.find((a) => a.old === u.name);
    const code = ref.county.get(r ? r.new : u.name);
    if (!code) { bad.push(`county ${u.name}`); continue; }
    if (r) { usedAdmin.push(r); renamedCounty.add(code); }
    county.set(u.key.prv + u.key.cty, code);
  }
  const townsOf = new Map<string, Map<string, string>>(); // new county → stem → code (renamed counties only)
  for (const [k, code] of ref.town) {
    const [cc, name] = k.split("|") as [string, string];
    if (!townsOf.has(cc)) townsOf.set(cc, new Map());
    townsOf.get(cc)!.set(stem(name), code);
  }
  for (const u of ds.units.filter((x) => x.level === "town")) {
    const oldT = u.key.prv + u.key.cty + u.key.town;
    if (town.has(oldT)) continue; // several rows per town (districts)
    const cc = county.get(u.key.prv + u.key.cty);
    if (!cc) continue;
    // A renamed county's 鄉鎮市 became 區 with the same stem (中壢市 → 中壢區).
    const code = ref.town.get(`${cc}|${u.name}`) ?? (renamedCounty.has(cc) ? townsOf.get(cc)?.get(stem(u.name)) : undefined);
    if (!code) bad.push(`town ${u.name} (${cc})`);
    else town.set(oldT, code);
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
    if (!/^0\d{3}$/.test(u.key.vil) || u.name.includes("、")) { vil.set(oldK, `G${u.key.vil.slice(1)}`); continue; }
    const renamed = renamedCounty.has(tc.slice(0, 5)) ? u.name.replace(/村$/u, "里") : u.name; // 村 became 里 on the upgrade
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
    return { ...k, prv: cc.slice(0, 2), cty: cc.slice(2), town: t ? t.slice(5) : "000", vil: v };
  };
  for (const u of ds.units) u.key = rekey(u.key);
  for (const c of ds.candidates) c.key = rekey(c.key);
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
