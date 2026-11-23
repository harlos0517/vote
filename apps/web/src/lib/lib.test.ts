import { describe, expect, it } from "vitest";
import type { ContestMetadataFile, ResultsFile } from "@tw-election/schema";
import { DEFAULT_VIEW, formatHash, parseHash } from "./viewState.ts";
import { divergingScale, sequentialScale, snapDomain } from "./colors.ts";
import { toUnitViews, turnout, type UnitView } from "./results.ts";
import { abstained, choiceColors, denominatorOf, electedByChoice, localTop, shareOf, twoPartyDiff } from "./views.ts";
import { buildMapView } from "./mapView.ts";

// --- fixtures -----------------------------------------------------------------
const unit = (code: string, votes: number[], s: Partial<UnitView["summary"]> = {}): UnitView => {
  const valid = votes.reduce((a, b) => a + b, 0);
  return {
    id: `town:${code}`,
    code,
    name: code,
    parentId: "cty:63000",
    votes,
    summary: { valid, invalid: 10, ballotsCast: valid + 10, electors: valid + 10 + 40, population: null, ...s },
  };
};

const meta = {
  choices: [
    { id: "n1", contestId: "c", kind: "ticket", ballotNumber: 1, candidacyIds: ["a"], partyId: "cec-350", labelZh: "甲" },
    { id: "n2", contestId: "c", kind: "ticket", ballotNumber: 2, candidacyIds: ["b"], partyId: "cec-16", labelZh: "乙" },
    { id: "n3", contestId: "c", kind: "ticket", ballotNumber: 3, candidacyIds: ["c"], partyId: "cec-1", labelZh: "丙" },
  ],
  candidacies: [
    { id: "a", elected: false },
    { id: "b", elected: true },
    { id: "c", elected: false },
  ],
  parties: [
    { id: "cec-350", nameZh: "台灣民眾黨", color: "#28C7C7", isIndependent: false },
    { id: "cec-16", nameZh: "民主進步黨", color: "#1B9431", isIndependent: false },
    { id: "cec-1", nameZh: "中國國民黨", color: "#000099", isIndependent: false },
  ],
} as unknown as ContestMetadataFile;

// --- URL state ----------------------------------------------------------------
describe("view state hash", () => {
  it("round-trips every option and keeps defaults out of the URL", () => {
    const s = { ...DEFAULT_VIEW, contest: "x.president", level: "county" as const, mode: "share" as const, formula: "ratio" as const, choice: "n2", palette: "multi" as const, scale: "stepped" as const, invalid: true, abstain: true, shadeTop: false, unit: "cty:63000" };
    expect(parseHash(formatHash(s))).toEqual(s);
    expect(formatHash(DEFAULT_VIEW)).toBe("#/?");
    expect(parseHash("")).toEqual(DEFAULT_VIEW);
  });
  it("accepts the old 'leader' links and ignores junk", () => {
    expect(parseHash("#/?m=leader").mode).toBe("top");
    expect(parseHash("#/?lv=bogus&m=bogus&sc=bogus")).toMatchObject({ level: "town", mode: "diff", scale: "continuous" });
  });
});

// --- denominators -------------------------------------------------------------
describe("denominators", () => {
  const u = unit("1", [60, 30, 10]); // valid 100, invalid 10, cast 110, electors 150
  it("adds invalid and abstained ballots on request", () => {
    expect(abstained(u.summary)).toBe(40);
    expect(denominatorOf(u.summary, { invalid: false, abstain: false })).toBe(100);
    expect(denominatorOf(u.summary, { invalid: true, abstain: false })).toBe(110);
    expect(denominatorOf(u.summary, { invalid: false, abstain: true })).toBe(140);
    expect(denominatorOf(u.summary, { invalid: true, abstain: true })).toBe(150);
    expect(shareOf(u, 0, { invalid: true, abstain: true })).toBeCloseTo(0.4);
  });
  it("returns null instead of inventing a value when a part is unknown", () => {
    const v = unit("2", [1, 1, 1], { electors: null });
    expect(denominatorOf(v.summary, { invalid: false, abstain: true })).toBeNull();
    expect(turnout(v.summary)).toBeNull();
  });
});

// --- two-party difference -----------------------------------------------------
describe("兩大黨差異", () => {
  const d0 = { invalid: false, abstain: false };
  it("formula 1 = DPP% − KMT% over the chosen denominator", () => {
    const r = twoPartyDiff(unit("1", [20, 50, 30]), meta.choices, "pct", d0);
    expect(r.value).toBeCloseTo(0.2);
    expect(twoPartyDiff(unit("1", [20, 50, 30]), meta.choices, "pct", { invalid: true, abstain: true }).value).toBeCloseTo(20 / 150);
  });
  it("formula 2 = (DPP − KMT) ÷ (DPP + KMT), independent of the denominator", () => {
    expect(twoPartyDiff(unit("1", [20, 50, 30]), meta.choices, "ratio", d0).value).toBeCloseTo(0.25);
    expect(twoPartyDiff(unit("1", [20, 50, 30]), meta.choices, "ratio", { invalid: true, abstain: true }).value).toBeCloseTo(0.25);
  });
  it("counts a party with no candidate as 0 and leaves 0 ÷ 0 as no data", () => {
    const noKmt = meta.choices.slice(0, 2);
    expect(twoPartyDiff(unit("1", [40, 60]), noKmt, "ratio", d0).value).toBe(1);
    expect(twoPartyDiff(unit("1", [100]), meta.choices.slice(0, 1), "ratio", d0).value).toBeNull();
  });
});

// --- local top & elected view --------------------------------------------------
describe("當選候選人 view", () => {
  const elected = electedByChoice(meta);
  it("shows the local top even when not elected, flagged for hatching", () => {
    expect(elected).toEqual([false, true, false]);
    expect(localTop(unit("1", [20, 30, 50]), elected, { invalid: false, abstain: false })).toMatchObject({ index: 2, elected: false });
    expect(localTop(unit("1", [30, 30, 10]), elected, { invalid: false, abstain: false }).index).toBeNull();
  });
  it("hatches exactly the units won locally by unelected candidates", () => {
    const units = [unit("A", [20, 30, 50]), unit("B", [10, 60, 30])];
    const v = buildMapView(meta, units, { ...DEFAULT_VIEW, mode: "top" });
    expect([...v.hatched]).toEqual(["A"]);
    expect(v.legend.groups?.map((g) => g.title)).toEqual(["當選", "未當選（斜線）"]);
  });
  it("uses party colours, with neutral grey for independents", () => {
    const withInd = {
      ...meta,
      choices: [...meta.choices, { ...meta.choices[0]!, id: "n4", partyId: "cec-999" }],
      parties: [...meta.parties, { id: "cec-999", nameZh: "無黨籍", color: null, isIndependent: true }],
    } as unknown as ContestMetadataFile;
    expect(choiceColors(withInd)).toEqual(["#28C7C7", "#1B9431", "#000099", "#8c8c8c"]);
  });
});

// --- scales -------------------------------------------------------------------
describe("scales", () => {
  it("snaps to whole steps with at most the requested bins", () => {
    expect(snapDomain(0.31, 0.58, 8)).toEqual({ lo: 30, hi: 60, stepPt: 5 });
    expect(snapDomain(0.05, 0.64, 8)).toEqual({ lo: 0, hi: 70, stepPt: 10 });
  });
  it("stepped legends have exact, contiguous labels", () => {
    const s = sequentialScale([0.31, 0.58], () => "#000", "stepped");
    expect(s.legend.type === "stepped" && s.legend.items.map((i) => i.label)).toEqual(["55%–60%", "50%–55%", "45%–50%", "40%–45%", "35%–40%", "30%–35%"]);
  });
  it("fits the middle 95% so outliers don't wash out the map, and labels open ends", () => {
    const vals = [...Array.from({ length: 98 }, (_, i) => -0.2 + (0.4 * i) / 97), -0.8, 0.85];
    const d = divergingScale(vals, "#0000ff", "#00ff00", "stepped", (pt) => `${pt}`);
    const labels = d.legend.type === "stepped" ? d.legend.items.map((i) => i.label) : [];
    expect(labels[0]!.startsWith("≥")).toBe(true);
    expect(labels.at(-1)!.startsWith("≥")).toBe(true);
    expect(d.t(0.85)).toBeLessThanOrEqual(1); // clamped to the end colour
    const s2 = sequentialScale([...Array.from({ length: 98 }, (_, i) => 0.3 + (0.2 * i) / 97), 0.05, 0.95], () => "#000", "continuous");
    expect(s2.legend.type === "continuous" && s2.legend.ticks.map((t) => t.label)).toEqual(["≤ 30%", "40%", "≥ 50%"]);
  });
  it("diverging scale is symmetric and black at zero", () => {
    const s = divergingScale([-0.12, 0.3], "#0000ff", "#00ff00", "continuous", (pt) => `${pt}`);
    expect(s.t(0)).toBe(0);
    expect(s.t(0.3)).toBeCloseTo(-s.t(-0.3));
    expect(s.color(0)).toBe("rgb(0, 0, 0)");
  });
});

describe("toUnitViews", () => {
  it("keeps names, parents and raw votes", () => {
    const rf: ResultsFile = {
      schemaVersion: 1, contestId: "2024-01-13-x.president", level: "town", countyCode: null, choiceIds: ["n1"],
      units: [{ id: "town:63000010", level: "town", nameZh: "松山區", parentId: "cty:63000", memberVillageCodes: null, geo: "exact" }],
      rows: [{ unit: "town:63000010", summary: { electors: 2, ballotsCast: 1, valid: 1, invalid: 0, population: null }, votes: [1] }],
    };
    expect(toUnitViews(rf).get("63000010")).toMatchObject({ name: "松山區", parentId: "cty:63000", votes: [1] });
  });
});
