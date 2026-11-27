/**
 * Year-slider timelines: one per office, slots oldest → newest.
 *
 * Proposal: within an office, elections less than 12 months after the first election of a
 * slot join that slot (e.g. a rerun weeks later). The fixed record in
 * packages/etl/mappings/election-groups.csv decides; the proposal only checks it, so a
 * reviewed grouping never shifts when new elections are added.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Office, ReleaseIndexFile, ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "./csv.ts";

export const OFFICE_LABEL: Partial<Record<Office, string>> = {
  president: "總統副總統",
  "legislator-district": "區域立委",
  "legislator-highland-indigenous": "山地原住民立委",
  "legislator-lowland-indigenous": "平地原住民立委",
  "legislator-party-list": "不分區政黨票",
  "mayor-or-magistrate": "縣市長",
  "councilor-district": "區域議員",
  "councilor-lowland-indigenous": "平地原住民議員",
  "councilor-highland-indigenous": "山地原住民議員",
  "township-mayor": "鄉鎮市長",
  "indigenous-district-chief": "山地原住民區長",
  "township-rep-district": "區域鄉鎮市民代表",
  "township-rep-lowland-indigenous": "平地原住民鄉鎮市民代表",
  "indigenous-district-rep": "山地原住民區民代表",
  "village-chief": "村里長",
  "referendum-national": "全國性公投",
  "provincial-governor": "臺灣省長",
  "provincial-councilor-district": "區域省議員",
  "provincial-councilor-lowland-indigenous": "平地原住民省議員",
  "provincial-councilor-highland-indigenous": "山地原住民省議員",
  "national-assembly-district": "區域國大代表",
  "national-assembly-lowland-indigenous": "平地原住民國大代表",
  "national-assembly-highland-indigenous": "山地原住民國大代表",
  "national-assembly-party-list": "任務型國大代表",
  "councilor-indigenous": "原住民議員（平地山地合選）",
  "constitutional-referendum": "修憲複決",
};

export interface TimelineGroup {
  id: string;
  office: Office;
  date: string;
}

export interface SlotRecord {
  slot: string;
  reviewed: boolean;
}

export function loadElectionGroups(repoRoot: string): Map<string, SlotRecord> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/election-groups.csv"), "utf8"), { header: true });
  const out = new Map<string, SlotRecord>();
  for (const [group, , slot, status] of rows) {
    if (!group || !/^\d{4}$/.test(slot ?? "")) throw new Error(`election-groups.csv: bad row ${group} ${slot}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`election-groups.csv: bad status ${status}`);
    if (out.has(group)) throw new Error(`election-groups.csv: ${group} twice`);
    out.set(group, { slot: slot!, reviewed: status === "reviewed" });
  }
  return out;
}

const monthsBetween = (a: string, b: string) => {
  const [ya, ma, da] = a.split("-").map(Number) as [number, number, number];
  const [yb, mb, db] = b.split("-").map(Number) as [number, number, number];
  return (yb - ya) * 12 + (mb - ma) + (db - da) / 31;
};

/** The 12-month proposal: group id → slot label (year of the slot's first election). */
export function proposeSlots(groups: TimelineGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  const byOffice = new Map<Office, TimelineGroup[]>();
  for (const g of groups) byOffice.set(g.office, [...(byOffice.get(g.office) ?? []), g]);
  for (const list of byOffice.values()) {
    let first: string | null = null;
    for (const g of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      if (first === null || monthsBetween(first, g.date) >= 12) first = g.date;
      out.set(g.id, first.slice(0, 4));
    }
  }
  return out;
}

export function buildTimelines(groups: TimelineGroup[], record: Map<string, SlotRecord>): { timelines: ReleaseIndexFile["timelines"]; checks: ValidationCheck[] } {
  const proposed = proposeSlots(groups);
  const missing: string[] = [];
  const differs: string[] = [];
  const unreviewed: string[] = [];
  const slotOf = new Map<string, string>();
  for (const g of groups) {
    const r = record.get(g.id);
    const p = proposed.get(g.id)!;
    if (!r) missing.push(`${g.id},${g.office},${p},unreviewed`);
    else {
      if (r.slot !== p) differs.push(`${g.id}: recorded ${r.slot}, 12-month rule gives ${p}`);
      if (!r.reviewed) unreviewed.push(g.id);
    }
    slotOf.set(g.id, r?.slot ?? p);
  }
  const stale = [...record.keys()].filter((id) => !groups.some((g) => g.id === id));

  const timelines: ReleaseIndexFile["timelines"] = [];
  const offices = [...new Set(groups.map((g) => g.office))];
  for (const office of offices) {
    const mine = groups.filter((g) => g.office === office);
    const labels = [...new Set(mine.map((g) => slotOf.get(g.id)!))].sort();
    timelines.push({
      office,
      nameZh: OFFICE_LABEL[office] ?? office,
      slots: labels.map((label) => {
        const gs = mine.filter((g) => slotOf.get(g.id) === label).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        return { label, date: gs[0]!.date, groupIds: gs.map((g) => g.id) };
      }),
    });
  }

  const checks: ValidationCheck[] = [];
  checks.push(
    missing.length
      ? { id: "election-groups", status: "warn", detail: `${missing.length} groups have no slot record; add to election-groups.csv: ${missing.join(" ; ")}` }
      : unreviewed.length
        ? { id: "election-groups", status: "warn", detail: `${unreviewed.length} slot records not yet reviewed: ${unreviewed.join(", ")}` }
        : { id: "election-groups", status: "pass", detail: `${groups.length} groups in ${timelines.reduce((a, t) => a + t.slots.length, 0)} slots, all reviewed` },
  );
  if (differs.length) checks.push({ id: "election-groups-rule", status: "warn", detail: `fixed record differs from the 12-month rule: ${differs.join("; ")}` });
  if (stale.length) checks.push({ id: "election-groups-stale", status: "warn", detail: `records for groups not in this release: ${stale.join(", ")}` });
  return { timelines, checks };
}
