import { describe, expect, it } from "vitest";
import type { ResultsFile } from "@tw-election/schema";
import { formatHash, parseHash } from "./viewState.ts";
import { NO_DATA, shareScale } from "./colors.ts";
import { toUnitViews, turnout } from "./results.ts";

describe("view state hash", () => {
  it("round-trips and applies safe defaults", () => {
    const s = { contest: "2024-01-13-x.president", level: "county" as const, choice: "n2", mode: "leader" as const, unit: "cty:63000" };
    expect(parseHash(formatHash(s))).toEqual(s);
    expect(parseHash("")).toEqual({ contest: null, level: "town", choice: null, mode: "share", unit: null });
    expect(parseHash("#/?lv=bogus&m=bogus")).toMatchObject({ level: "town", mode: "share" });
  });
});

describe("share scale", () => {
  it("bins in 5-point steps covering the data range", () => {
    const s = shareScale([0.31, 0.44, 0.58]);
    expect(s.domain()).toEqual([0.3, 0.6]);
    expect(s.range()).toHaveLength(6);
    expect(s(0.31)).not.toBe(s(0.58));
    expect(s.range()).not.toContain(NO_DATA);
  });
  it("widens to whole 10-point bins when 5-point bins would exceed 8", () => {
    const s = shareScale([0.05, 0.64]); // 5–65% → 12 five-point bins → use 10-point
    expect(s.domain()).toEqual([0, 0.7]);
    expect(s.range()).toHaveLength(7);
    for (const c of s.range()) {
      const [a, b] = s.invertExtent(c);
      expect(Math.round((b - a) * 1000)).toBe(100); // every bin exactly 10 points
    }
  });
  it("handles a single value without a zero-width domain", () => {
    const [lo, hi] = shareScale([0.5]).domain();
    expect(hi! - lo!).toBeGreaterThan(0);
  });
});

describe("unit views", () => {
  const rf: ResultsFile = {
    schemaVersion: 1,
    contestId: "2024-01-13-x.president",
    level: "town",
    countyCode: null,
    choiceIds: ["n1", "n2"],
    units: [
      { id: "town:63000010", level: "town", nameZh: "松山區", parentId: "cty:63000", memberVillageCodes: null, geo: "exact" },
      { id: "town:63000020", level: "town", nameZh: "信義區", parentId: "cty:63000", memberVillageCodes: null, geo: "exact" },
    ],
    rows: [
      { unit: "town:63000010", summary: { electors: 200, ballotsCast: 100, valid: 98, invalid: 2, population: null }, votes: [60, 38] },
      { unit: "town:63000020", summary: { electors: 10, ballotsCast: 0, valid: 0, invalid: 0, population: null }, votes: [0, 0] },
    ],
  };
  it("computes shares on valid ballots and a single leader", () => {
    const v = toUnitViews(rf).get("63000010")!;
    expect(v.name).toBe("松山區");
    expect(v.shares[0]).toBeCloseTo(60 / 98);
    expect(v.leader).toBe(0);
    expect(turnout(v.summary)).toBe(0.5);
  });
  it("never invents a share or leader when there are no valid ballots", () => {
    const v = toUnitViews(rf).get("63000020")!;
    expect(v.shares).toEqual([null, null]);
    expect(v.leader).toBeNull();
  });
});
