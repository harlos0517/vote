import { describe, expect, it } from "vitest";
import type { GroupMetadataFile, GroupResultsFile } from "@tw-election/schema";
import { DEFAULT_VIEW, formatHash, parseHash } from "./viewState.ts";
import { NEUTRAL, NO_CANDIDATE, NO_DATA, OTHER_PARTY, TIE, ZERO_GAP, divergingScale, sequentialScale, snapDomain } from "./colors.ts";
import { toUnitViews, turnout, type UnitView } from "./results.ts";
import { abstained, referendumStatus, choiceShare, denominatorOf, groupContext, localTop, partyLabel, partyShare, seatsByParty, showsSeats, twoPartyDiff } from "./views.ts";
import { buildMapView, effectiveMode, ringSlices, selectedParty, selectedTarget } from "./mapView.ts";
import { available, nearestGroup } from "./picker.ts";

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
    const s = { ...DEFAULT_VIEW, contest: "x.president", level: "district" as const, mode: "share" as const, formula: "ratio" as const, choice: "cec-16", palette: "multi" as const, scale: "stepped" as const, invalid: true, abstain: true, shadeTop: false, fromZero: false, max: 0.25, colorblind: true, hatchUnelected: false, unit: "cty:63000" };
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
  it("rings use one fixed party order (民進黨, 民眾黨, 國民黨, others, 無黨籍), small parties as 其他", () => {
    expect(ringSlices(unit("1", { n2: 5, n1: 3, n3: 2 }), P, d0).map((s) => s.key)).toEqual(["n2", "n1", "n3"]);
    const cty = unit("63000", { "d1.n1": 600, "d1.n2": 400, "d2.n1": 300, "d2.n2": 500, "d2.n3": 20 }, ["e.d1", "e.d2"]);
    expect(ringSlices(cty, L, { invalid: true, abstain: false }).map((s) => s.key)).toEqual(["cec-16", "cec-1", "other", "invalid"]);
  });
  it("uses party colours, with neutral grey for independents", () => {
    expect(L.choiceColor.get("d2.n3")).toBe(NEUTRAL);
    expect(P.choiceColor.get("n2")).toBe("#1B9431");
  });
});

// --- 原住民立委 and 不分區 ---------------------------------------------------------
describe("multi-seat and party-list groups", () => {
  /** 原住民立委-like: 3 seats, KMT runs two. */
  const ind = groupContext({
    contests: [{ id: "e.h", nameZh: "山地", scope: { level: "national" }, seats: 3, partyList: null }],
    choices: [choice("n1", "e.h", 1, "cec-1", "甲"), choice("n2", "e.h", 2, "cec-1", "乙"), choice("n3", "e.h", 3, "cec-16", "丙"), choice("n4", "e.h", 4, "cec-999", "丁")],
    candidacies: [{ id: "n1.c", elected: true }, { id: "n2.c", elected: false }, { id: "n3.c", elected: true }, { id: "n4.c", elected: true }],
    parties: [party("cec-1", "中國國民黨", "#000099"), party("cec-16", "民主進步黨", "#1B9431"), party("cec-999", "無黨籍及未經政黨推薦", null, true)],
  } as unknown as GroupMetadataFile);
  const u = unit("A", { n1: 10, n2: 30, n3: 40, n4: 20 }, ["e.h"]);

  it("offers candidates in the share view only when a party ran several", () => {
    expect(ind.candidatesPickable).toBe(true);
    expect(P.candidatesPickable).toBe(false);
    expect(selectedTarget(ind, { ...DEFAULT_VIEW, choice: "n2" })).toEqual({ kind: "choice", id: "n2" });
    expect(selectedTarget(P, { ...DEFAULT_VIEW, choice: "n2" }).kind).toBe("party");
    const v = buildMapView(ind, [u], { ...DEFAULT_VIEW, mode: "share", choice: "n2" });
    expect(v.describe(u)).toContain("得票率 30.00%");
    expect(buildMapView(ind, [u], { ...DEFAULT_VIEW, mode: "share", choice: "cec-1" }).describe(u)).toContain("得票率 40.00%");
  });

  const list = groupContext({
    contests: [{ id: "e.l", nameZh: "不分區", scope: { level: "national" }, seats: 3, partyList: { thresholdPct: 5, thresholdBasis: "x", allocation: [
      { partyId: "cec-1", voteSharePct: 60, qualifiedSharePct: 63, nominated: 3, seats: 2 },
      { partyId: "cec-16", voteSharePct: 35, qualifiedSharePct: 37, nominated: 2, seats: 1 },
      { partyId: "cec-79", voteSharePct: 5 - 0.01, qualifiedSharePct: null, nominated: 1, seats: 0 },
    ] } }],
    choices: [{ ...choice("n1", "e.l", 1, "cec-1", "甲黨"), kind: "party", candidacyIds: ["a1"] }, { ...choice("n2", "e.l", 2, "cec-16", "乙黨"), kind: "party", candidacyIds: ["b1"] }, { ...choice("n3", "e.l", 3, "cec-79", "丙黨"), kind: "party", candidacyIds: ["c1"] }],
    candidacies: [{ id: "a1", elected: true }, { id: "b1", elected: true }, { id: "c1", elected: false }],
    parties: [party("cec-1", "甲黨", "#000099"), party("cec-16", "乙黨", "#1B9431"), party("cec-79", "丙黨", null)],
  } as unknown as GroupMetadataFile, { n1: 60, n2: 35, n3: 5 });

  it("hatches areas topped by a party with no seats, and says so", () => {
    const a = unit("A", { n1: 10, n2: 20, n3: 70 }, ["e.l"]);
    const b = unit("B", { n1: 70, n2: 20, n3: 10 }, ["e.l"]);
    const v = buildMapView(list, [a, b], { ...DEFAULT_VIEW, mode: "top" });
    expect([...v.hatched]).toEqual(["A"]);
    expect(v.describe(a)).toContain("全國未獲席次");
    expect(v.describe(b)).toContain("全國獲 2 席");
    expect(v.legend.groups!.map((g) => g.title)).toEqual(["獲得席次", "未獲席次（斜線）"]);
    // 丙黨 has no recorded colour: the shared 其他政黨 brown, not the 無黨籍 grey.
    expect(list.partyColor.get("cec-79")).toBe(OTHER_PARTY);
  });
});

describe("兩大黨差異 without either party", () => {
  it("marks areas where neither 民進黨 nor 國民黨 ran as 無候選人, not a tie", () => {
    const ind = groupContext({
      contests: [{ id: "e.a", nameZh: "甲", scope: { level: "district" }, seats: 1 }, { id: "e.b", nameZh: "乙", scope: { level: "district" }, seats: 1 }],
      choices: [choice("a.n1", "e.a", 1, "cec-1", "甲"), choice("a.n2", "e.a", 2, "cec-16", "乙"), choice("b.n1", "e.b", 1, "cec-999", "丙")],
      candidacies: [{ id: "a.n1.c", elected: true }, { id: "a.n2.c", elected: false }, { id: "b.n1.c", elected: true }],
      parties: [party("cec-1", "中國國民黨", "#000099"), party("cec-16", "民主進步黨", "#1B9431"), party("cec-999", "無黨籍及未經政黨推薦", null, true)],
    } as unknown as GroupMetadataFile);
    const a = unit("A", { "a.n1": 5, "a.n2": 5 }, ["e.a"]);
    const b = unit("B", { "b.n1": 9 }, ["e.b"]);
    const v = buildMapView(ind, [a, b], DEFAULT_VIEW);
    expect([v.colors.get("A"), v.colors.get("B")]).toEqual(["rgb(0, 0, 0)", NO_CANDIDATE]);
    expect(v.describe(b)).toContain("皆無候選人");
  });
});

describe("multi-seat districts (議員)", () => {
  const t1 = groupContext({
    contests: [{ id: "e.d1", nameZh: "第01選區", scope: { level: "district" }, seats: 2 }, { id: "e.d2", nameZh: "第02選區", scope: { level: "district" }, seats: 1 }],
    choices: [choice("d1.n1", "e.d1", 1, "cec-1", "甲"), choice("d1.n2", "e.d1", 2, "cec-1", "乙"), choice("d1.n3", "e.d1", 3, "cec-16", "丙"), choice("d2.n1", "e.d2", 1, "cec-16", "丁")],
    candidacies: [{ id: "d1.n1.c", elected: true }, { id: "d1.n2.c", elected: true }, { id: "d1.n3.c", elected: false }, { id: "d2.n1.c", elected: true }],
    parties: [party("cec-1", "中國國民黨", "#000099"), party("cec-16", "民主進步黨", "#1B9431")],
  } as unknown as GroupMetadataFile);
  const dist = (id: string, votes: Record<string, number>, c: string): UnitView => ({ ...unit(id, votes, [c]), id: `dist:${id}` });
  it("colours a multi-seat district by seats won, a single-seat one and towns by the local top", () => {
    const d1 = dist("63000-01", { "d1.n1": 10, "d1.n2": 5, "d1.n3": 30 }, "e.d1");
    const d2 = dist("63000-02", { "d2.n1": 10 }, "e.d2");
    expect([showsSeats(d1, t1), showsSeats(d2, t1), showsSeats(unit("T", { "d1.n1": 1 }, ["e.d1"]), t1)]).toEqual([true, false, false]);
    const v = buildMapView(t1, [d1], { ...DEFAULT_VIEW, mode: "top" });
    expect(v.describe(d1)).toBe("當選席次（共 2 席）：中國國民黨 2");
    expect(t1.candidatesPickable).toBe(false);
  });
  it("gives ties their own colour, apart from 無資料", () => {
    const tie = unit("T", { "d1.n1": 5, "d1.n3": 5 }, ["e.d1"]);
    const empty = unit("E", { "d1.n1": 0 }, ["e.d1"]);
    const v = buildMapView(t1, [tie, empty], { ...DEFAULT_VIEW, mode: "top" });
    expect([v.colors.get("T"), v.colors.get("E")]).toEqual([TIE, NO_DATA]);
    expect(v.legend.groups!.at(-1)!.items[0]!.label).toBe("得票最多者同票");
  });
});

describe("referendum", () => {
  const ref = groupContext({
    contests: [{ id: "e.r", nameZh: "第17案", scope: { level: "national" }, seats: null, referendum: { caseNumber: 17, questionZh: "?", rule: { agreeMustExceedDisagree: true, agreeQuorumOfElectors: 0.25, legalBasis: "公民投票法第29條" }, outcome: "failed" } }],
    choices: [{ id: "agree", contestId: "e.r", kind: "agree", ballotNumber: null, candidacyIds: [], partyId: null, labelZh: "同意" }, { id: "disagree", contestId: "e.r", kind: "disagree", ballotNumber: null, candidacyIds: [], partyId: null, labelZh: "不同意" }],
    candidacies: [],
    parties: [],
  } as unknown as GroupMetadataFile);
  const u = unit("A", { agree: 30, disagree: 20 }, ["e.r"], { electors: 100 });
  it("colours 同意 − 不同意 and has no 當選 view", () => {
    expect(effectiveMode(ref, { ...DEFAULT_VIEW, mode: "top" })).toBe("diff");
    const v = buildMapView(ref, [u], { ...DEFAULT_VIEW, mode: "top" });
    expect(v.describe(u)).toContain("同意與不同意差異 +20.00 個百分點（同意較多）");
    expect(selectedTarget(ref, { ...DEFAULT_VIEW, choice: "disagree" })).toEqual({ kind: "choice", id: "disagree" });
    expect(buildMapView(ref, [u], { ...DEFAULT_VIEW, mode: "share" }).describe(u)).toContain("同意 得票率 60.00%");
  });
  it("tests §29 locally and orders the ring 同意 first, with the colour-blind palette on request", () => {
    expect(referendumStatus(u, { agreeQuorumOfElectors: 0.25, quorumStrict: false })).toMatchObject({ agreeMore: true, quorumMet: true, needed: 25 });
    // 修憲複決: 同意 must be more than half — exactly half (50 of 100) is not enough.
    const half = unit("B", { agree: 50, disagree: 10 }, ["e.r"], { electors: 100 });
    expect(referendumStatus(half, { agreeQuorumOfElectors: 0.5, quorumStrict: true })).toMatchObject({ quorumMet: false, needed: 51 });
    const ring = ringSlices(u, ref, { invalid: false, abstain: true }, true);
    expect(ring.map((s) => [s.key, s.color])).toEqual([["agree", "#2166ac"], ["disagree", "#e66101"], ["abstain", ring[2]!.color]]);
  });
});

describe("投票率 and the election picker", () => {
  it("colours turnout (投票數 ÷ 選舉人數) in every group, referendums included", () => {
    const u = unit("A", { n1: 30, n2: 50, n3: 20 }, ["e.president"], { electors: 200, ballotsCast: 110 });
    const v = buildMapView(P, [u], { ...DEFAULT_VIEW, mode: "turnout" });
    expect(v.describe(u)).toContain("投票率 55.00%");
    expect(effectiveMode(P, { ...DEFAULT_VIEW, mode: "turnout" })).toBe("turnout");
  });
  it("opens the same office near the year being viewed, and hides empty categories", () => {
    const gs = [
      { id: "a", office: "president" as const, date: "2024-01-13", nameZh: "" },
      { id: "b", office: "president" as const, date: "2020-01-11", nameZh: "" },
      { id: "c", office: "mayor-or-magistrate" as const, date: "2022-11-26", nameZh: "" },
      { id: "d", office: "mayor-or-magistrate" as const, date: "2018-11-24", nameZh: "" },
    ];
    expect(nearestGroup(gs, "mayor-or-magistrate", "2020-01-11")?.id).toBe("d");
    expect(nearestGroup(gs, "president", "2022-11-26")?.id).toBe("a");
    expect(nearestGroup(gs, "president", null)?.id).toBe("a");
    expect(available(gs).map((c) => c.key)).toEqual(["president", "mayor"]);
  });
});

// --- scales -------------------------------------------------------------------
describe("scales", () => {
  it("snaps to whole steps with at most the requested bins", () => {
    expect(snapDomain(0.31, 0.58, 8)).toEqual({ lo: 30, hi: 60, stepPt: 5 });
    expect(snapDomain(0.05, 0.64, 8)).toEqual({ lo: 0, hi: 70, stepPt: 10 });
  });
  it("snaps small fixed tops with fractional steps", () => {
    expect(snapDomain(0, 0.01, 8)).toEqual({ lo: 0, hi: 1, stepPt: 0.2 });
    expect(snapDomain(0, 0.05, 8)).toEqual({ lo: 0, hi: 5, stepPt: 1 });
  });
  it("starts at 0%, keeps exactly 0 apart from small values, and labels exact bins", () => {
    const s = sequentialScale([0.31, 0.58], () => "#000", "stepped");
    expect(s.legend.type === "stepped" && s.legend.items.map((i) => i.label)).toEqual(["50%–60%", "40%–50%", "30%–40%", "20%–30%", "10%–20%", "> 0%–10%"]);
    expect(s.t(0)).toBe(0);
    expect(s.t(0.001)).toBeCloseTo(ZERO_GAP);
    expect(s.legend.zero?.label).toBe("0%");
  });
  it("can start at the data's low end instead of 0%, still keeping exactly 0 apart", () => {
    const s = sequentialScale([0.31, 0.58, 0], () => "#000", "stepped", null, false);
    expect(s.legend.type === "stepped" && s.legend.items.map((i) => i.label).at(-1)).toBe("> 0%–10%");
    const t = sequentialScale([0.31, 0.58], () => "#000", "stepped", null, false);
    expect(t.legend.type === "stepped" && t.legend.items.map((i) => i.label)).toEqual(["55%–60%", "50%–55%", "45%–50%", "40%–45%", "35%–40%", "30%–35%"]);
    expect(t.t(0.31)).toBeCloseTo(ZERO_GAP);
    expect(t.t(0)).toBe(0);
  });
  it("uses a fixed top when chosen, marking values above it", () => {
    const s = sequentialScale([0.02, 0.3], () => "#000", "continuous", 0.1);
    expect(s.legend.type === "continuous" && s.legend.ticks.map((t) => t.label)).toEqual(["> 0%", "5%", "≥ 10%"]);
    expect(s.t(0.3)).toBe(1);
    const d = divergingScale([-0.3, 0.3], "#00f", "#0f0", "continuous", (pt) => `${pt}`, 0.25);
    expect(d.t(0.25)).toBe(1);
  });
  it("fits the data when 自動, so outliers don't wash out the map", () => {
    const vals = [...Array.from({ length: 98 }, (_, i) => -0.2 + (0.4 * i) / 97), -0.8, 0.85];
    const d = divergingScale(vals, "#0000ff", "#00ff00", "stepped", (pt) => `${pt}`);
    const labels = d.legend.type === "stepped" ? d.legend.items.map((i) => i.label) : [];
    expect(labels[0]!.startsWith("≥")).toBe(true);
    expect(labels.at(-1)!.startsWith("≥")).toBe(true);
    const s2 = sequentialScale([...Array.from({ length: 98 }, (_, i) => 0.3 + (0.2 * i) / 97), 0.05, 0.95], () => "#000", "continuous");
    expect(s2.legend.type === "continuous" && s2.legend.ticks.map((t) => t.label)).toEqual(["> 0%", "25%", "≥ 50%"]);
  });
  it("diverging scales keep black for an exact tie: any lead starts 5% toward its side, also when stepped", () => {
    const c = divergingScale([-0.2, 0.2], "#0000ff", "#00ff00", "continuous", (pt) => `${pt}`);
    expect(c.t(0.0001)).toBeCloseTo(ZERO_GAP, 2);
    expect(c.t(-0.0001)).toBeCloseTo(-ZERO_GAP, 2);
    const s = divergingScale([-0.2, 0.2], "#0000ff", "#00ff00", "stepped", (pt) => (pt === 0 ? "平手" : `${pt}`));
    expect(s.t(0)).toBe(0);
    expect(s.color(0)).toBe("rgb(0, 0, 0)");
    expect(s.t(0.001)).toBeGreaterThan(ZERO_GAP);
    expect(s.legend.zero?.label).toBe("平手");
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
