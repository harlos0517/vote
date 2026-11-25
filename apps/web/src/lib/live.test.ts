import { describe, expect, it } from "vitest";
import type { GroupMetadataFile, GroupResultsFile, LiveSnapshotFile } from "@tw-election/schema";
import { fmtTaipei, isStale, liveLevels, liveResults, newer, progressByUnit } from "./live.ts";

const meta = {
  choices: [
    { id: "63000.n1", contestId: "c-63000" },
    { id: "63000.n2", contestId: "c-63000" },
    { id: "65000.n1", contestId: "c-65000" },
  ],
} as unknown as GroupMetadataFile;
const units = {
  schemaVersion: 2,
  groupId: "g",
  level: "county",
  units: [
    { id: "cty:63000", level: "county", nameZh: "臺北市", parentId: "nat", contestIds: ["c-63000"] },
    { id: "cty:65000", level: "county", nameZh: "新北市", parentId: "nat", contestIds: ["c-65000"] },
  ],
  rows: [],
} as GroupResultsFile;
const snap = (seq: number, rows: LiveSnapshotFile["rows"], extra: Partial<LiveSnapshotFile> = {}): LiveSnapshotFile => ({
  liveSchemaVersion: 1, feedId: "f", groupId: "g", seq, status: "counting", asOf: "2026-11-28T17:05:00+08:00", generatedAt: "2026-11-28T09:05:00.000Z", progressUnit: "station", rows, ...extra,
});
const nulls = { electors: null, ballotsCast: null, valid: null, invalid: null, population: null };

describe("liveResults", () => {
  it("gives every unit a row: reported numbers, or zeros", () => {
    const r = liveResults(meta, units, snap(1, [{ unit: "cty:63000", level: "county", reported: 3, total: 10, summary: nulls, votes: { "63000.n1": 30, "63000.n2": 20 } }]));
    expect(r.rows).toEqual([
      { unit: "cty:63000", summary: { ...nulls, valid: 50 }, votes: { "63000.n1": 30, "63000.n2": 20 } },
      { unit: "cty:65000", summary: { ...nulls, valid: 0 }, votes: { "65000.n1": 0 } },
    ]);
    expect(r.units).toBe(units.units);
  });
  it("keeps a source's own summary (referendum pages carry one)", () => {
    const s = { electors: 100, ballotsCast: 60, valid: 55, invalid: 5, population: null };
    const r = liveResults(meta, units, snap(1, [{ unit: "cty:63000", level: "county", reported: 1, total: 1, summary: s, votes: { "63000.n1": 30, "63000.n2": 25 } }]));
    expect(r.rows[0]!.summary).toEqual(s);
  });
  it("draws zeros before the first snapshot", () => {
    expect(liveResults(meta, units, null).rows.map((r) => r.summary.valid)).toEqual([0, 0]);
  });
});

describe("snapshot handling", () => {
  it("never steps back to an older snapshot of the same group", () => {
    const a = snap(5, []);
    expect(newer(a, snap(4, []))).toBe(a);
    expect(newer(a, snap(6, []))!.seq).toBe(6);
    expect(newer(a, snap(1, [], { groupId: "other" }))!.groupId).toBe("other");
    expect(newer(a, undefined)).toBe(a);
  });
  it("flags a counting feed that has not been written for three poll intervals", () => {
    const s = snap(1, []);
    const t = Date.parse(s.generatedAt);
    expect(isStale(s, 60, t + 179_000)).toBe(false);
    expect(isStale(s, 60, t + 181_000)).toBe(true);
    expect(isStale({ ...s, status: "final" }, 60, t + 10_000_000)).toBe(false);
  });
  it("reports progress per unit and Taiwan time", () => {
    const p = progressByUnit(snap(1, [{ unit: "cty:63000", level: "county", reported: 3, total: 10, summary: nulls, votes: {}, stale: true }]));
    expect(p.get("cty:63000")).toEqual({ reported: 3, total: 10, stale: true, asOf: null });
    expect(fmtTaipei("2026-11-28T09:05:00.000Z")).toBe("11/28 17:05");
    expect(fmtTaipei("2026-11-28T17:05:00+08:00")).toBe("11/28 17:05");
  });
});

describe("liveLevels", () => {
  const row = (unit: string, level: "national" | "county" | "town") => ({ unit, level, reported: 1, total: 2, summary: nulls, votes: {} });
  it("offers only levels with numbers, never 村里 before counting", () => {
    expect(liveLevels(["county", "town", "village"], null)).toEqual(["county", "town"]);
    expect(liveLevels(["county", "town", "village"], snap(1, [row("nat", "national"), row("cty:63000", "county")]))).toEqual(["county"]);
    expect(liveLevels(["county", "town", "village"], snap(1, [row("cty:63000", "county"), row("town:63000010", "town")]))).toEqual(["county", "town"]);
  });
});
