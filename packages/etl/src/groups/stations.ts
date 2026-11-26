/**
 * Polling-station results, published per county (groups/<id>/stations/<county>.json) and
 * loaded on demand by the sidebar's station table. Ids follow ids.ts: "st:<county>-<number>",
 * or "st:<county>-<number>@<village code>" where one station's results are split between
 * villages (村里長, or a station number that repeats within a county).
 */
import type { GroupResultsFile, GroupUnit } from "@tw-election/schema";
import { type ElUnit, countyCode, keyString } from "../adapters/cec-el.ts";

export interface StationInput {
  u: ElUnit;
  /** The village-level unit this station reports under (vil:… or vgrp:…), already emitted. */
  parentId: string;
  contestIds: string[];
  votes: Record<string, number>;
}

/** Station rows grouped by county code; throws on an id that cannot be made unique. */
export function stationFiles(groupId: string, rows: StationInput[]): Record<string, GroupResultsFile> {
  const base = (r: StationInput) => `st:${countyCode(r.u.key)}-${r.u.key.station}`;
  const count = new Map<string, number>();
  for (const r of rows) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  const seen = new Set<string>();
  const byCounty = new Map<string, { unit: GroupUnit; row: GroupResultsFile["rows"][number] }[]>();
  for (const r of rows) {
    let id = base(r);
    if (count.get(id)! > 1) {
      // Split station: tell the slices apart by their village (groups have no 11-digit code).
      if (!r.parentId.startsWith("vil:")) throw new Error(`${groupId}: station ${keyString(r.u.key)} repeats under a village group`);
      id = `${id}@${r.parentId.slice(4)}`;
    }
    if (seen.has(id)) throw new Error(`${groupId}: duplicate station id ${id}`);
    seen.add(id);
    const cc = countyCode(r.u.key);
    const unit: GroupUnit = { id, level: "station", nameZh: `第 ${r.u.key.station} 號投開票所`, parentId: r.parentId, contestIds: r.contestIds };
    const row = {
      unit: id,
      summary: { electors: r.u.electors, ballotsCast: r.u.cast, valid: r.u.valid, invalid: r.u.invalid, population: null },
      votes: r.votes,
    };
    byCounty.set(cc, [...(byCounty.get(cc) ?? []), { unit, row }]);
  }
  const out: Record<string, GroupResultsFile> = {};
  for (const [cc, xs] of [...byCounty].sort(([a], [b]) => a.localeCompare(b))) {
    xs.sort((a, b) => a.unit.id.localeCompare(b.unit.id));
    out[cc] = { schemaVersion: 2, groupId, level: "station", units: xs.map((x) => x.unit), rows: xs.map((x) => x.row) };
  }
  return out;
}
