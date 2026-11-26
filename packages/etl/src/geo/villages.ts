/**
 * Which polygon each 村里 unit gets.
 *
 * - "vil:<code>": its own NLSC village.
 * - "vgrp:<town>-<code>": CEC reports one result for several villages sharing stations; the
 *   members come from packages/etl/mappings/village-groups.csv (reviewed, with source) and are
 *   dissolved into one shape. Votes are never split between members.
 * - A group whose members are also reported on their own (e.g. 嘉義市「各里平地、山地原住民」,
 *   a station for the whole district) overlaps them: it gets no shape, only a note. Its votes
 *   still count in the township.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GroupUnit, ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";

export interface VillageGroupRow {
  /** Member VILLCODEs, or "overlap" when the group covers villages reported separately. */
  members: string[] | "overlap";
  source: string;
  reviewed: boolean;
}

export const villageGroupKey = (election: string, town: string, code: string, name: string) => `${election}|${town}|${code}|${name}`;

export function loadVillageGroups(repoRoot: string): Map<string, VillageGroupRow> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/village-groups.csv"), "utf8"), { header: true, quotedCommas: true });
  const out = new Map<string, VillageGroupRow>();
  for (const [election, town, code, name, members, source, status] of rows) {
    if (!election || !/^\d{8}$/.test(town ?? "") || !code || !name || !members || !source) throw new Error(`village-groups.csv: bad row ${town} ${code}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`village-groups.csv: bad status ${status}`);
    const list = members === "*" ? "overlap" : members.split(/\s+/);
    if (list !== "overlap" && !list.every((m) => m.startsWith(town!) && /^\d{11}$/.test(m))) throw new Error(`village-groups.csv: members of ${town} ${code} must be village codes in that town`);
    out.set(villageGroupKey(election, town!, code, name), { members: list, source, reviewed: status === "reviewed" });
  }
  return out;
}

/** Geometry code of a 村里 unit (what the village GeoJSON's `code` holds). */
export const villageGeoCode = (unitId: string) => unitId.slice(unitId.indexOf(":") + 1);

export interface VillagePlan {
  /** NLSC VILLCODE → geometry code. */
  assign: Map<string, string>;
  /** Units drawn without a shape, with the reason shown in the sidebar. */
  noShape: { unit: string; note: string }[];
  /** Notes for merged groups. */
  notes: { unit: string; note: string }[];
  /** Villages left undrawn on purpose (members of overlapping groups). */
  covered: Set<string>;
  checks: ValidationCheck[];
}

/**
 * @param electorsOf electors of a 村里-level unit, for notes (e.g. how many voted at a district-wide station).
 */
export function planVillages(
  election: string,
  units: GroupUnit[],
  groups: Map<string, VillageGroupRow>,
  electorsOf: (unitId: string) => number | null = () => null,
): VillagePlan {
  const claims = new Map<string, string[]>(); // VILLCODE → unit ids
  const claim = (v: string, unit: string) => claims.set(v, [...(claims.get(v) ?? []), unit]);
  const noShape: VillagePlan["noShape"] = [];
  const notes: VillagePlan["notes"] = [];
  const covered = new Set<string>();
  const missing: string[] = [];
  const unreviewed: string[] = [];
  const membersOf = new Map<string, string[]>();

  for (const u of units) {
    if (u.id.startsWith("vil:")) { claim(u.id.slice(4), u.id); continue; }
    const [town, code] = u.id.slice(5).split("-") as [string, string];
    // "Z…": a village reorganised before the registry reference (adapters/registry.ts) — no code, no shape.
    if (code.startsWith("Z")) {
      noShape.push({ unit: u.id, note: `${u.nameZh}在這次選舉之後、2014 年之前已整編，戶政代碼與國土測繪中心圖資都已沒有此村里，地圖未繪出；票數計入鄉鎮。` });
      continue;
    }
    const row = groups.get(villageGroupKey(election, town, code, u.nameZh));
    if (!row) {
      missing.push(`${election},${town},${code},${u.nameZh}`);
      noShape.push({ unit: u.id, note: `此投開票所涵蓋多個村里（${u.nameZh}），組成尚未登錄，地圖未繪出；票數計入鄉鎮。` });
      continue;
    }
    if (!row.reviewed) unreviewed.push(`${town}-${code}`);
    if (row.members === "overlap") {
      noShape.push({ unit: u.id, note: `「${u.nameZh}」投開票所的範圍與一般村里重疊，地圖未繪出；票數計入鄉鎮。` });
      // The station itself is never drawn, so say it where people look: on its township.
      // No note where the station had no electors in this race (區域立委: its voters vote for the 原住民立委 instead).
      const n = electorsOf(u.id);
      if (u.parentId && n !== 0) {
        notes.push({ unit: u.parentId, note: `本區另有全區各里共用的原住民投開票所（「${u.nameZh}」${n === null ? "" : `，選舉人 ${n.toLocaleString("en-US")} 人`}），票數計入本區，但未分配到任何村里，因此各村里數字合計少於本區。` });
      }
      continue;
    }
    membersOf.set(u.id, row.members);
    for (const m of row.members) claim(m, u.id);
  }

  // A village claimed twice: single villages keep it; groups involved lose their shape.
  const clashing = new Set<string>();
  for (const ids of claims.values()) if (ids.length > 1) for (const id of ids) if (id.startsWith("vgrp:")) clashing.add(id);
  const assign = new Map<string, string>();
  for (const [v, ids] of claims) {
    const keep = ids.filter((id) => !clashing.has(id));
    if (keep.length === 1) assign.set(v, villageGeoCode(keep[0]!));
    else if (keep.length === 0) covered.add(v);
  }
  // Villages reported on their own but also covered by such a group: their figure misses the group's votes.
  const alsoIn = new Map<string, string[]>(); // village unit id → group names
  for (const id of clashing) {
    const u = units.find((x) => x.id === id)!;
    noShape.push({ unit: id, note: `此投開票所涵蓋多個村里（${u.nameZh}），其中有村里另有結果或屬於其他群組，地圖未繪出；票數計入鄉鎮。` });
    for (const m of membersOf.get(id) ?? []) {
      if (!assign.has(m)) covered.add(m);
      if (units.some((x) => x.id === `vil:${m}`)) alsoIn.set(`vil:${m}`, [...(alsoIn.get(`vil:${m}`) ?? []), u.nameZh]);
    }
  }
  for (const [unit, gs] of alsoIn) {
    notes.push({ unit, note: `本村里部分選舉人在跨村里的投開票所投票（${gs.join("；")}），該投開票所只公布合計，這部分票數未計入本村里，只計入鄉鎮。` });
  }
  for (const [id, ms] of membersOf) {
    if (clashing.has(id)) continue;
    notes.push({ unit: id, note: `此投開票所涵蓋 ${ms.length} 個村里，中選會只公布合計，票數無法拆分；地圖上合併為一塊。` });
  }

  const checks: ValidationCheck[] = [];
  const groupCount = units.filter((u) => u.id.startsWith("vgrp:")).length;
  checks.push(
    missing.length
      ? { id: "village-groups", status: "warn", detail: `${missing.length} village groups have no row in village-groups.csv (drawn as 無資料): ${missing.slice(0, 8).join(" ; ")}` }
      : unreviewed.length
        ? { id: "village-groups", status: "warn", detail: `${groupCount} village groups; ${unreviewed.length} rows not yet reviewed` }
        : { id: "village-groups", status: "pass", detail: `${groupCount} village groups, all rows reviewed` },
  );
  if (clashing.size) checks.push({ id: "village-group-clash", status: "warn", detail: `${clashing.size} groups share villages with other units and are not drawn: ${[...clashing].slice(0, 8).join(", ")}` });
  return { assign, noShape, notes, covered, checks };
}
