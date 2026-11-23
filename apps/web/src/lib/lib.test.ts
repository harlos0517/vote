import { describe, expect, it } from "vitest";
import type { GroupMetadataFile, GroupResultsFile } from "@tw-election/schema";
import { DEFAULT_VIEW, formatHash, parseHash } from "./viewState.ts";
import { NEUTRAL, NO_CANDIDATE, divergingScale, sequentialScale, snapDomain } from "./colors.ts";
import { toUnitViews, turnout, type UnitView } from "./results.ts";
import { abstained, choiceShare, denominatorOf, groupContext, localTop, partyLabel, partyShare, seatsByParty, twoPartyDiff } from "./views.ts";
import { buildMapView, ringSlices, selectedParty } from "./mapView.ts";

// --- fixtures -----------------------------------------------------------------
const unit = (code: string, votes: Record<string, number>, contestIds = ["e.president"], s: Partial<UnitView["summary"]> = {}): UnitView => {
  const valid = Object.values(votes).reduce((a, b) => a + b, 0);
  return {
    id: `town:${code}`,
    code,
    name: code,
    parentId: "cty:63000",
    contestIds,
    votes,
    summary: { valid, invalid: 10, ballotsCast: valid + 10, electors: valid + 10 + 40, population: null, ...s },
  };
};

const party = (id: string, nameZh: string, color: string | null, isIndependent = false) => ({ id, cecCode: 0, nameZh, color, colorReviewed: true, isIndependent });
const choice = (id: string, contestId: string, n: number, partyId: string, labelZh: string) => ({ id, contestId, kind: "candidate", ballotNumber: n, candidacyIds: [`${id}.c`], partyId, labelZh });

/** 總統-like: one contest, three tickets. */
const pres = {
  contests: [{ id: "e.president", nameZh: "總統", scope: { level: "national" } }],
  choices: [choice("n1", "e.president", 1, "cec-350", "甲"), choice("n2", "e.president", 2, "cec-16", "乙"), choice("n3", "e.president", 3, "cec-1", "丙")],
  candidacies: [{ id: "n1.c", elected: false }, { id: "n2.c", elected: true }, { id: "n3.c", elected: false }],
  parties: [party("cec-350", "台灣民眾黨", "#28C7C7"), party("cec-16", "民主進步黨", "#1B9431"), party("cec-1", "中國國民黨", "#000099")],
} as unknown as GroupMetadataFile;

/** 區域立委-like: two districts, KMT wins d1, DPP wins d2, plus an independent. */
const ly = {
  contests: [{ id: "e.d1", nameZh: "第01選區", scope: { level: "district" } }, { id: "e.d2", nameZh: "第02選區", scope: { level: "district" } }],
  choices: [
    choice("d1.n1", "e.d1", 1, "cec-1", "甲"), choice("d1.n2", "e.d1", 2, "cec-16", "乙"),
    choice("d2.n1", "e.d2", 1, "cec-1", "丙"), choice("d2.n2", "e.d2", 2, "cec-16", "丁"), choice("d2.n3", "e.d2", 3, "cec-999", "戊"),
  ],
  candidacies: [{ id: "d1.n1.c", elected: true }, { id: "d1.n2.c", elected: false }, { id: "d2.n1.c", elected: false }, { id: "d2.n2.c", elected: true }, { id: "d2.n3.c", elected: false }],
  parties: [party("cec-1", "中國國民黨", "#000099"), party("cec-16", "民主進步黨", "#1B9431"), party("cec-999", "無黨籍及未經政黨推薦", null, true)],
} as unknown as GroupMetadataFile;

const P = groupContext(pres, { n1: 30, n2: 50, n3: 40 });
const L = groupContext(ly);
const d0 = { invalid: false, abstain: false };

// --- URL state ----------------------------------------------------------------
describe("view state hash", () => {
  it("round-trips every option and keeps defaults out of the URL", () => {
    const s = { ...DEFAULT_VIEW, contest: "x.president", level: "district" as const, mode: "share" as const, formula: "ratio" as const, choice: "cec-16", palette: "multi" as const, scale: "stepped" as const, invalid: true, abstain: true, shadeTop: false, hatchUnelected: false, unit: "cty:63000" };
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
  const u = unit("1", { n1: 60, n2: 30, n3: 10 }); // valid 100, invalid 10, cast 110, electors 150
  it("adds invalid and abstained ballots on request", () => {
    expect(abstained(u.summary)).toBe(40);
    expect(denominatorOf(u.summary, d0)).toBe(100);
    expect(denominatorOf(u.summary, { invalid: true, abstain: false })).toBe(110);
    expect(denominatorOf(u.summary, { invalid: false, abstain: true })).toBe(140);
    expect(denominatorOf(u.summary, { invalid: true, abstain: true })).toBe(150);
    expect(choiceShare(u, "n1", { invalid: true, abstain: true })).toBeCloseTo(0.4);
  });
  it("returns null instead of inventing a value when a part is unknown", () => {
    const v = unit("2", { n1: 1 }, undefined, { electors: null });
    expect(denominatorOf(v.summary, { invalid: false, abstain: true })).toBeNull();
    expect(turnout(v.summary)).toBeNull();
  });
});

// --- two-party difference -----------------------------------------------------
describe("兩大黨差異", () => {
  it("formula 1 = DPP% − KMT% over the chosen denominator", () => {
    expect(twoPartyDiff(unit("1", { n1: 20, n2: 50, n3: 30 }), P, "pct", d0).value).toBeCloseTo(0.2);
    expect(twoPartyDiff(unit("1", { n1: 20, n2: 50, n3: 30 }), P, "pct", { invalid: true, abstain: true }).value).toBeCloseTo(20 / 150);
  });
  it("formula 2 = (DPP − KMT) ÷ (DPP + KMT), independent of the denominator", () => {
    expect(twoPartyDiff(unit("1", { n1: 20, n2: 50, n3: 30 }), P, "ratio", d0).value).toBeCloseTo(0.25);
  });
  it("counts a party with no candidate as 0 and leaves 0 ÷ 0 as no data", () => {
    expect(twoPartyDiff(unit("1", { n1: 40, n2: 60 }), P, "ratio", d0).value).toBe(1);
    expect(twoPartyDiff(unit("1", { n1: 100 }), P, "ratio", d0).value).toBeNull();
  });
  it("sums a party's candidates across districts at county level", () => {
    const cty = unit("63000", { "d1.n1": 60, "d1.n2": 40, "d2.n1": 30, "d2.n2": 50, "d2.n3": 20 }, ["e.d1", "e.d2"]);
    expect(twoPartyDiff(cty, L, "ratio", d0).value).toBeCloseTo((90 - 90) / 180);
  });
});

// --- elected view ---------------------------------------------------------------
describe("當選候選人 view", () => {
  it("shows the local top even when not elected, flagged for hatching", () => {
    expect(localTop(unit("1", { n1: 20, n2: 30, n3: 50 }), P, d0)).toMatchObject({ choiceId: "n3", elected: false });
    expect(localTop(unit("1", { n1: 30, n2: 30, n3: 10 }), P, d0).choiceId).toBeNull();
  });
  it("hatches only units won locally by unelected candidates, and the toggle removes it", () => {
    const units = [unit("A", { n1: 20, n2: 30, n3: 50 }), unit("B", { n1: 10, n2: 60, n3: 30 })];
    const on = buildMapView(P, units, { ...DEFAULT_VIEW, mode: "top" });
    expect([...on.hatched]).toEqual(["A"]);
    expect(on.legend.groups?.map((g) => g.title)).toEqual(["當選", "未當選（斜線）"]);
    const off = buildMapView(P, units, { ...DEFAULT_VIEW, mode: "top", hatchUnelected: false });
    expect(off.hatched.size).toBe(0);
    expect(off.legend.groups?.flatMap((g) => g.items).some((i) => i.hatched)).toBe(false);
  });
  it("colours a unit spanning several districts by the party with most seats, never hatched", () => {
    const cty = unit("63000", { "d1.n1": 60, "d1.n2": 40, "d2.n1": 30, "d2.n2": 50, "d2.n3": 20 }, ["e.d1", "e.d2"]);
    const r = seatsByParty(cty, L);
    expect(r.total).toBe(2);
    expect(r.partyId).toBeNull(); // 1 : 1 tie
    const v = buildMapView(L, [cty], { ...DEFAULT_VIEW, mode: "top" });
    expect(v.hatched.size).toBe(0);
    expect(v.describe(cty)).toContain("共 2 席");
  });
});

// --- party share & ring ----------------------------------------------------------
describe("party share and ring", () => {
  it("defaults to the largest party and sums its candidates", () => {
    expect(selectedParty(P, DEFAULT_VIEW)).toBe("cec-16");
    const cty = unit("63000", { "d1.n1": 60, "d1.n2": 40, "d2.n1": 30, "d2.n2": 50, "d2.n3": 20 }, ["e.d1", "e.d2"]);
    expect(partyShare(cty, L, "cec-16", d0)).toBeCloseTo(90 / 200);
    expect(partyLabel(P, "cec-16")).toBe("民主進步黨（乙）");
    expect(partyLabel(L, "cec-999")).toBe("無黨籍及未經政黨推薦（合計）");
  });
  it("greys out units where the party ran no candidate, keeping them out of the scale", () => {
    const d1 = unit("63000-01", { "d1.n1": 60, "d1.n2": 40 }, ["e.d1"]);
    const d2 = unit("63000-02", { "d2.n1": 30, "d2.n2": 50, "d2.n3": 20 }, ["e.d2"]);
    const v = buildMapView(L, [d1, d2], { ...DEFAULT_VIEW, mode: "share", choice: "cec-999" });
    expect(v.colors.get(d1.code)).toBe(NO_CANDIDATE);
    expect(v.colors.get(d2.code)).not.toBe(NO_CANDIDATE);
    expect(v.describe(d1)).toContain("無候選人");
    expect(v.legend.groups?.[0]?.items[0]?.label).toBe("該黨無候選人");
    expect(buildMapView(L, [d1, d2], { ...DEFAULT_VIEW, mode: "share", choice: "cec-16" }).legend.groups).toBeUndefined();
  });
  it("rings show candidates for one contest, parties (small ones as 其他) for several", () => {
    expect(ringSlices(unit("1", { n2: 5, n1: 3, n3: 2 }), P, d0).map((s) => s.key)).toEqual(["n1", "n2", "n3"]);
    const cty = unit("63000", { "d1.n1": 600, "d1.n2": 400, "d2.n1": 300, "d2.n2": 500, "d2.n3": 20 }, ["e.d1", "e.d2"]);
    expect(ringSlices(cty, L, { invalid: true, abstain: false }).map((s) => s.key)).toEqual(["cec-1", "cec-16", "other", "invalid"]);
  });
  it("uses party colours, with neutral grey for independents", () => {
    expect(L.choiceColor.get("d2.n3")).toBe(NEUTRAL);
    expect(P.choiceColor.get("n2")).toBe("#1B9431");
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
  it("keeps names, parents, contests and votes", () => {
    const rf: GroupResultsFile = {
      schemaVersion: 2, groupId: "2024-01-13-x.legislator-district", level: "town",
      units: [{ id: "tp:63000020-07", level: "town", nameZh: "松山區（第07選區部分）", parentId: "dist:63000-07", contestIds: ["2024-01-13-x.ly-63000-d07"] }],
      rows: [{ unit: "tp:63000020-07", summary: { electors: 2, ballotsCast: 1, valid: 1, invalid: 0, population: null }, votes: { "63000-d07.n1": 1 } }],
    };
    expect(toUnitViews(rf).get("63000020-07")).toMatchObject({ name: "松山區（第07選區部分）", parentId: "dist:63000-07", votes: { "63000-d07.n1": 1 } });
  });
});
