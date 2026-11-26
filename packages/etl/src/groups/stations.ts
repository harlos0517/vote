/**
 * Polling-station results, published per county (groups/<id>/stations/<county>.json) and
 * loaded on demand by the sidebar's station table. Ids follow ids.ts: "st:<county>-<number>",
 * or "st:<county>-<number>@<village unit code>" where a number repeats within a county (one
 * station split between villages, or two pre-2010 counties merged into one).
 */
import type { GroupResultsFile, GroupUnit } from "@tw-election/schema";
import { type ElUnit, countyCode } from "../adapters/cec-el.ts";

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
      // Repeated number (a station split between villages, or two pre-2010 counties merged):
      // tell them apart by the village unit they report under.
      id = `${id}@${r.parentId.slice(r.parentId.indexOf(":") + 1)}`;
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
