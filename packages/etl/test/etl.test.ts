import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseCecCsv, PUA_RE } from "../src/lib/csv.ts";
import { levelOf, readElDir, readElPartyList } from "../src/adapters/cec-el.ts";
import { checkElDataset } from "../src/validate/el-checks.ts";
import { buildElGroup, largestRemainder, type ElGroupDef } from "../src/groups/el-group.ts";
import { releaseIdFor } from "../src/emit/release.ts";

const FIX = join(import.meta.dirname, "fixtures/el-mini");
const FIX_LY = join(import.meta.dirname, "fixtures/el-mini-ly");
const E = { id: "2024-01-13-test", date: "2024-01-13", nameZh: "測試", kinds: ["president" as const] };
const PRES: ElGroupDef = { election: E, local: "president", nameZh: "總統", office: "president", electorate: "general", archiveDir: "", contests: "single", choiceKind: "ticket", layout: "admin", warnings: [] };
const LY: ElGroupDef = { ...PRES, local: "legislator-district", nameZh: "區域立委", office: "legislator-district", contests: "district", choiceKind: "candidate", layout: "ly" };
const FIX_LIST = join(import.meta.dirname, "fixtures/el-mini-list");
const LIST: ElGroupDef = { ...PRES, local: "legislator-party-list", nameZh: "不分區", office: "legislator-party-list", choiceKind: "party", seats: 3 };
const all = () => [1, 2];

describe("parseCecCsv", () => {
  it("handles quoted (2024) and unquoted (2022) rows, BOM and header", () => {
    expect(parseCecCsv('﻿"63","000"," "\n')).toEqual([["63", "000", ""]]);
    expect(parseCecCsv("63,000, \n")).toEqual([["63", "000", ""]]);
    expect(parseCecCsv('"a","b"\n"1","2"\n', { header: true })).toEqual([["1", "2"]]);
  });
  it("rejects commas inside quoted fields instead of mis-splitting", () => {
    expect(() => parseCecCsv('"a,b","c"')).toThrow(/comma inside quoted field/);
  });
});

describe("PUA detection", () => {
  it("catches BMP and supplementary private-use characters", () => {
    expect(PUA_RE.test("糖里")).toBe(true);
    expect(PUA_RE.test("公\u{FB56F}里")).toBe(true);
    expect(PUA_RE.test("糖廍里")).toBe(false);
  });
});

describe("levelOf", () => {
  const k = (prv: string, cty: string, dist: string, town: string, vil: string, station: string) => ({ prv, cty, dist, town, vil, station });
  it("classifies CEC code tuples", () => {
    expect(levelOf(k("00", "000", "00", "000", "0000", "0000"))).toBe("national");
    expect(levelOf(k("63", "000", "00", "000", "0000", "0000"))).toBe("county");
    expect(levelOf(k("10", "018", "01", "000", "0000", "0000"))).toBe("district");
    expect(levelOf(k("63", "000", "01", "010", "0000", "0000"))).toBe("town");
    expect(levelOf(k("09", "007", "01", "010", "0A01", "0000"))).toBe("village");
    expect(levelOf(k("63", "000", "01", "010", "0002", "0597"))).toBe("station");
  });
});

describe("el* pipeline on a synthetic fixture", () => {
  it("passes all checks on consistent data", () => {
    const ds = readElDir(FIX);
    const checks = checkElDataset(ds, all);
    expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
  });

  it("fails hierarchy and sum checks when a station is altered", () => {
    const ds = readElDir(FIX);
    const st = ds.units.find((u) => u.level === "station")!;
    st.votes.set(1, st.votes.get(1)! + 1);
    const failed = checkElDataset(ds, all).filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toContain("sum-votes-eq-valid");
    expect(failed).toContain("hierarchy-sums");
  });

  it("builds tickets, maps population 0 to null, and keeps unknown ≠ 0", () => {
    const b = buildElGroup(PRES, readElDir(FIX), new Map());
    expect(b.choices.map((c) => c.labelZh)).toEqual(["甲／乙", "丙／丁"]);
    expect(b.results.county!.rows[0]!.summary.population).toBe(500);
    expect(b.results.town!.rows[0]!.summary.population).toBeNull();
    expect(b.results.town!.units[0]).toMatchObject({ id: "town:63000010", nameZh: "松山區", parentId: "cty:63000" });
    expect(b.results.national!.rows[0]!.votes).toEqual({ n1: 70, n2: 30 });
    expect(b.checks.filter((c) => c.status === "fail")).toEqual([]);
  });
});

describe("multi-contest group (區域立委)", () => {
  const b = buildElGroup(LY, readElDir(FIX_LY), new Map());
  it("passes all checks, with one contest and winner per district", () => {
    expect(b.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(b.contests.map((c) => c.nameZh)).toEqual(["臺北市第01選區", "臺北市第02選區"]);
    expect(b.candidacies.filter((c) => c.elected).map((c) => c.personId)).toEqual([
      "2024-01-13-test.ly-63000-d01.n1.p",
      "2024-01-13-test.ly-63000-d02.n2.p",
    ]);
  });
  it("splits a town between districts into named parts", () => {
    expect(b.results.town!.units.map((u) => [u.id, u.nameZh, u.parentId])).toEqual([
      ["tp:63000010-01", "松山區（第01選區部分）", "dist:63000-01"],
      ["tp:63000010-02", "松山區（第02選區部分）", "dist:63000-02"],
      ["tp:63000020-02", "信義區", "dist:63000-02"],
    ]);
  });
  it("sums the districts' own rows for county and national (CEC publishes none there)", () => {
    const cty = b.results.county!.rows[0]!;
    expect(cty.votes).toEqual({ "63000-d01.n1": 30, "63000-d01.n2": 20, "63000-d02.n1": 25, "63000-d02.n2": 30 });
    expect(b.results.county!.units[0]!.contestIds).toHaveLength(2);
    expect(b.results.national!.rows[0]!.summary.valid).toBe(105);
  });
  it("detects a broken district total", () => {
    const ds = readElDir(FIX_LY);
    const d1 = ds.units.find((u) => u.level === "district" && u.key.dist === "01")!;
    d1.votes.set(1, 31);
    const failed = buildElGroup(LY, ds, new Map()).checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toContain("hierarchy-sums");
  });
});

describe("multi-seat and party-list groups", () => {
  it("requires the marked candidates to be the top `seats`", () => {
    const b = buildElGroup({ ...LY, contests: "single", local: "x", seats: 2 }, readElDir(FIX), new Map());
    expect(b.checks.find((c) => c.id === "winner-consistent")).toMatchObject({ status: "fail" });
    expect(b.contests[0]!.seats).toBe(2);
  });
  it("recounts 2024's 34 seats by largest remainder over the 5% threshold", () => {
    // Published 2024 shares (‱): KMT 34.5842, DPP 36.1629, TPP 22.0706, NPP 2.5653, others below 5%.
    const v = new Map([[1, 345842], [16, 361629], [350, 220706], [267, 25653], [79, 8514], [999, 38656]]);
    expect(Object.fromEntries(largestRemainder(v, 34, 5))).toEqual({ 1: 13, 16: 13, 350: 8 });
  });
  it("builds parties as choices with list members, and checks CEC's allocation", () => {
    const b = buildElGroup(LIST, readElDir(FIX_LIST), new Map(), readElPartyList(FIX_LIST));
    expect(b.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(b.choices.map((c) => [c.kind, c.labelZh, c.candidacyIds.length])).toEqual([["party", "甲黨", 3], ["party", "乙黨", 2]]);
    expect(b.candidacies.filter((c) => c.elected).map((c) => [c.partyId, c.listRank])).toEqual([["cec-1", 1], ["cec-1", 2], ["cec-16", 1]]);
    expect(b.contests[0]!.partyList!.allocation.map((a) => [a.partyId, a.seats])).toEqual([["cec-1", 2], ["cec-16", 1]]);
  });
  it("fails when published seats disagree with the recount", () => {
    const list = readElPartyList(FIX_LIST);
    list.results[0]!.seats = 3;
    list.results[1]!.seats = 0;
    const b = buildElGroup(LIST, readElDir(FIX_LIST), new Map(), list);
    expect(b.checks.find((c) => c.id === "winner-consistent")!.status).toBe("fail");
  });
});

describe("release id", () => {
  it("is a content hash independent of file order", () => {
    const a = [{ path: "a.json", body: "1" }, { path: "b.json", body: "2" }];
    expect(releaseIdFor(a)).toBe(releaseIdFor([...a].reverse()));
    expect(releaseIdFor(a)).not.toBe(releaseIdFor([{ path: "a.json", body: "1!" }, a[1]!]));
  });
});

describe("party colours", () => {
  it("loads the reviewed table and warns while colours are unreviewed", async () => {
    const { loadPartyColors, checkPartyColors } = await import("../src/lib/party-colors.ts");
    const colors = loadPartyColors(join(import.meta.dirname, "../../.."));
    expect(colors.get(16)?.color).toMatch(/^#[0-9A-F]{6}$/i);
    const unreviewed = new Map([[1, { color: "#000099", reviewed: false, source: "x" }]]);
    expect(checkPartyColors([1, 999], unreviewed).status).toBe("warn");
    const reviewed = new Map([[1, { color: "#000099", reviewed: true, source: "x" }]]);
    expect(checkPartyColors([1, 999], reviewed).status).toBe("pass");
    expect(checkPartyColors([5], reviewed).detail).toMatch(/neutral grey/);
  });
});
