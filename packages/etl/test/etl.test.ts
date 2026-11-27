import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseCecCsv, PUA_RE } from "../src/lib/csv.ts";
import { levelOf, mergeElDatasets, readElDir, readElPartyList } from "../src/adapters/cec-el.ts";
import { sameVillageName } from "../src/adapters/cec-wide-chiayi.ts";
import { readRfDir, renumberTowns, renumberVillages } from "../src/adapters/cec-rf.ts";
import { CONSTITUTIONAL_RULE, REFERENDUM_RULE, buildRfGroup, ruleOf, rulePasses } from "../src/groups/rf-group.ts";
import { buildTimelines, proposeSlots } from "../src/lib/timelines.ts";
import { planVillages } from "../src/geo/villages.ts";
import { chooseSwaps } from "../src/geo/mix.ts";
import { villageUnitId } from "../src/groups/el-group.ts";
import { checkElDataset } from "../src/validate/el-checks.ts";
import { buildElGroup, largestRemainder, type ElGroupDef } from "../src/groups/el-group.ts";
import { releaseIdFor } from "../src/emit/release.ts";

const FIX = join(import.meta.dirname, "fixtures/el-mini");
const FIX_LY = join(import.meta.dirname, "fixtures/el-mini-ly");
const E = { id: "2024-01-13-test", date: "2024-01-13", nameZh: "測試", kinds: ["president" as const] };
const PRES: ElGroupDef = { election: E, local: "president", nameZh: "總統", office: "president", electorate: "general", archiveDirs: [], boundary: { versionId: "nlsc-village-1120928", raw: "nlscVillage112", shapefile: /x/ }, contests: "single", choiceKind: "ticket", layout: "admin", warnings: [] };
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

describe("2022 local elections", () => {
  it("builds one contest per county with county-level units as single contests", () => {
    const ds = readElDir(FIX);
    // 2022 C1 lists candidates on the county row, not the national one.
    for (const c of ds.candidates) c.key = { ...c.key, prv: "63", cty: "000", dist: "00" };
    const b = buildElGroup({ ...PRES, local: "mayor", contests: "county", contestPrefix: "c1", contestNameSuffix: "長" }, mergeElDatasets([ds]), new Map());
    expect(b.contests.map((c) => [c.id, c.nameZh, c.scope])).toEqual([["2024-01-13-test.c1-63000", "臺北市長", { level: "county", code: "63000" }]]);
    expect(b.results.county!.units[0]!.contestIds).toEqual(["2024-01-13-test.c1-63000"]);
    expect(b.results.county!.rows[0]!.votes).toEqual({ "63000.n1": 70, "63000.n2": 30 });
    expect(b.checks.filter((c) => c.status === "fail")).toEqual([]);
  });
  it("merges directories, rebuilding the national row from counties", () => {
    const a = readElDir(FIX);
    const m = mergeElDatasets([a]);
    const nat = m.units.find((u) => u.level === "national")!;
    const cty = a.units.find((u) => u.level === "county")!;
    expect([nat.valid, nat.electors, nat.votes.size]).toEqual([cty.valid, cty.electors, 0]);
    expect(() => mergeElDatasets([a, a])).toThrow(/two directories/);
  });
  it("accepts a women-quota winner outside the top only for a woman", () => {
    const run = (gender: "F" | "M") => {
      const ds = readElDir(FIX_LY);
      const d1 = ds.candidates.filter((c) => c.key.dist === "01");
      d1.find((c) => c.ballotNumber === 1)!.electedMark = "";
      const q = d1.find((c) => c.ballotNumber === 2)!;
      q.electedMark = "!";
      q.gender = gender;
      return buildElGroup(LY, ds, new Map()).checks.find((c) => c.id === "winner-consistent")!.status;
    };
    expect(run("F")).toBe("pass");
    expect(run("M")).toBe("fail");
  });
  it("matches 嘉義市 rerun village names, tolerating private-use characters only", () => {
    expect(sameVillageName("磚磘里", "磚\uE000里")).toBe(true);
    expect(sameVillageName("磚磘里", "磚瑤里")).toBe(false);
  });
});

describe("referendum (rf*)", () => {
  const FIX_RF = join(import.meta.dirname, "fixtures/rf-mini");
  const REF: ElGroupDef = { ...PRES, local: "case-17", nameZh: "全國性公民投票案第17案", office: "referendum-national", format: "rf", referendumCase: 17, choiceKind: "referendum" };
  it("reads rf* into agree/disagree units that pass the shared checks, and applies §29", () => {
    const b = buildRfGroup(REF, readRfDir(FIX_RF), { text: "問題？", source: "x", reviewed: false });
    expect(b.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(b.checks.find((c) => c.id === "referendum-question")!.status).toBe("warn");
    expect(b.results.town!.rows[0]).toMatchObject({ unit: "town:63000010", votes: { agree: 40, disagree: 60 }, summary: { electors: 200, population: 300 } });
    expect(b.contests[0]!.referendum).toMatchObject({ caseNumber: 17, outcome: "failed", questionZh: "問題？", rule: { agreeQuorumOfElectors: 0.25 } });
  });
  it("renumbers 2018-style township codes by name, refusing unknown or clashing names", () => {
    const ds = readRfDir(FIX_RF);
    renumberTowns(ds, new Map([["63000|松山區", "020"]]));
    expect(ds.units.filter((u) => u.key.town !== "000").every((u) => u.key.town === "020")).toBe(true);
    expect(() => renumberTowns(readRfDir(FIX_RF), new Map())).toThrow(/no registry code/);
  });
  it("renumbers 2018-style village codes by name, keeping 「、」 groups and refusing unknown names", () => {
    const ds = readRfDir(FIX_RF);
    renumberVillages(ds, (town, name) => (town === "63000010" && name === "莊敬里" ? "0002" : undefined));
    expect(ds.units.filter((u) => u.key.vil !== "0000").every((u) => u.key.vil === "0002")).toBe(true);
    expect(() => renumberVillages(readRfDir(FIX_RF), () => undefined)).toThrow(/no registry code for village/);
  });
  it("fails when the published national result disagrees with the rule", () => {
    const ds = readRfDir(FIX_RF);
    ds.nationalResult = "Y";
    expect(buildRfGroup(REF, ds, undefined).checks.find((c) => c.id === "referendum-outcome")!.status).toBe("fail");
  });
  it("applies 憲法增修條文第12條 to 修憲複決: 同意 must be more than half of electors", () => {
    expect(ruleOf({ ...REF, office: "constitutional-referendum" })).toBe(CONSTITUTIONAL_RULE);
    expect(rulePasses(CONSTITUTIONAL_RULE, 50, 0, 100)).toBe(false); // exactly half is not 過半數
    expect(rulePasses(CONSTITUTIONAL_RULE, 51, 49, 100)).toBe(true);
    expect(rulePasses(CONSTITUTIONAL_RULE, 51, 60, 140)).toBe(false);
    expect(rulePasses(REFERENDUM_RULE, 25, 24, 100)).toBe(true); // 達四分之一以上
    expect(rulePasses(REFERENDUM_RULE, 30, 30, 100)).toBe(false); // 同意 must exceed 不同意
  });
});

describe("year-slider timelines", () => {
  const gs = [
    { id: "a.mayor", office: "mayor-or-magistrate" as const, date: "2022-11-26" },
    { id: "b.mayor", office: "mayor-or-magistrate" as const, date: "2022-12-18" },
    { id: "c.mayor", office: "mayor-or-magistrate" as const, date: "2018-11-24" },
    { id: "d.pres", office: "president" as const, date: "2024-01-13" },
  ];
  it("groups elections less than 12 months apart into one slot per office", () => {
    expect(Object.fromEntries(proposeSlots(gs))).toEqual({ "c.mayor": "2018", "a.mayor": "2022", "b.mayor": "2022", "d.pres": "2024" });
  });
  it("follows the fixed record, warning where it differs or is unreviewed", () => {
    const rec = new Map([
      ["a.mayor", { slot: "2022", reviewed: true }],
      ["b.mayor", { slot: "2023", reviewed: true }],
      ["c.mayor", { slot: "2018", reviewed: false }],
    ]);
    const { timelines, checks } = buildTimelines(gs, rec);
    expect(timelines.find((t) => t.office === "mayor-or-magistrate")!.slots.map((x) => [x.label, x.groupIds])).toEqual([["2018", ["c.mayor"]], ["2022", ["a.mayor"]], ["2023", ["b.mayor"]]]);
    expect(checks.map((c) => [c.id, c.status])).toEqual([["election-groups", "warn"], ["election-groups-rule", "warn"]]);
    expect(checks[0]!.detail).toContain("d.pres,president,2024,unreviewed");
  });
});

describe("mixed village snapshots", () => {
  const snap = (v: string, codes: string[]) => ({ versionId: `nlsc-village-${v}`, codes: new Set(codes) });
  const base = snap("1101214", ["10014010001", "10015040001", "10015040009"]);
  const older = snap("1091030", ["10014010001", "10014010002", "10015040001"]);
  const oldest = snap("1081121", ["10014010001", "10014010002", "10015040001"]);
  it("swaps townships missing reported villages, or (general electorate) having unknown ones, to the nearest fitting snapshot", () => {
    const vils = ["10014010001", "10014010002", "10015040001"];
    const r = chooseSwaps("2021-12-18", base, [oldest, older], vils, new Set(vils), true);
    expect([...r.swaps].map(([t, s]) => [t, s.versionId])).toEqual([["10014010", "nlsc-village-1091030"], ["10015040", "nlsc-village-1091030"]]);
    // Indigenous electorates: villages without such voters are normal, so extra villages do not trigger a swap.
    expect([...chooseSwaps("2021-12-18", base, [older], vils, new Set(vils), false).swaps.keys()]).toEqual(["10014010"]);
    expect(chooseSwaps("2021-12-18", base, [], vils, new Set(vils), true).unresolved).toEqual(["10014010", "10015040"]);
  });
});

describe("村里 level", () => {
  const unit = (id: string, nameZh: string) => ({ id, level: "village" as const, nameZh, parentId: "town:09007010", contestIds: ["e.c"] });
  const row = (members: string[] | "overlap") => ({ members, source: "x", reviewed: true });
  it("ids single villages by MOI code and station-sharing groups by CEC code", () => {
    expect(villageUnitId({ prv: "09", cty: "007", dist: "00", town: "010", vil: "0002", station: "0000" }, "莊敬里")).toBe("vil:09007010002");
    expect(villageUnitId({ prv: "09", cty: "007", dist: "00", town: "010", vil: "0A01", station: "0000" }, "復興村、福沃村")).toBe("vgrp:09007010-0A01");
  });
  it("merges groups, skips overlapping or clashing ones, and notes villages missing a group's votes", () => {
    const units = [unit("vil:09007010001", "甲村"), unit("vgrp:09007010-0A01", "乙村、丙村"), unit("vgrp:09007010-0A02", "甲村、丁村"), unit("vgrp:09007010-0A03", "各里原住民")];
    const groups = new Map([
      ["e|09007010|0A01|乙村、丙村", row(["09007010002", "09007010003"])],
      ["e|09007010|0A02|甲村、丁村", row(["09007010001", "09007010004"])],
      ["e|09007010|0A03|各里原住民", row("overlap")],
    ]);
    const p = planVillages("e", units, groups);
    expect(Object.fromEntries(p.assign)).toEqual({ "09007010001": "09007010001", "09007010002": "09007010-0A01", "09007010003": "09007010-0A01" });
    expect(p.noShape.map((x) => x.unit).sort()).toEqual(["vgrp:09007010-0A02", "vgrp:09007010-0A03"]);
    expect([...p.covered]).toEqual(["09007010004"]);
    expect(p.notes.find((n) => n.unit === "vil:09007010001")!.note).toContain("甲村、丁村");
    expect(p.checks.map((c) => [c.id, c.status])).toEqual([["village-groups", "pass"], ["village-group-clash", "warn"]]);
  });
  it("explains a district-wide station on its township, since the station itself is never drawn", () => {
    const units = [unit("vil:09007010001", "甲村"), unit("vgrp:09007010-0A03", "各里原住民")];
    const p = planVillages("e", units, new Map([["e|09007010|0A03|各里原住民", row("overlap")]]), (id) => (id === "vgrp:09007010-0A03" ? 475 : null));
    expect(p.notes.find((n) => n.unit === "town:09007010")!.note).toContain("選舉人 475 人");
    const none = planVillages("e", units, new Map([["e|09007010|0A03|各里原住民", row("overlap")]]), () => 0);
    expect(none.notes.some((n) => n.unit === "town:09007010")).toBe(false);
  });
});

describe("group warnings", () => {
  it("are copied per group, so notes appended to one group never leak into another sharing a definition", () => {
    const shared = ["共同說明"];
    const def = { ...PRES, warnings: shared };
    const a = buildElGroup(def, readElDir(FIX), new Map());
    const b = buildElGroup(def, readElDir(FIX), new Map());
    a.group.warnings.push("只屬於 a");
    expect(b.group.warnings).toEqual(["共同說明"]);
    expect(shared).toEqual(["共同說明"]);
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
    expect(checkPartyColors([5], reviewed).detail).toMatch(/其他政黨 colour/);
  });
});

describe("township and village offices", () => {
  // One township (10013080) with two villages; each village elects its own chief. Village 0002's
  // two candidates tied and CEC marks both "?" (decided by lot).
  const key = (vil: string, station = "0000") => ({ prv: "10", cty: "013", dist: "00", town: vil === "0000" && station === "T" ? "000" : "080", vil, station: station === "T" ? "0000" : station });
  const unit = (k: ReturnType<typeof key>, level: "national" | "county" | "town" | "village", votes: [number, number][], electors: number) => {
    const valid = votes.reduce((a, [, v]) => a + v, 0);
    return { key: k, level, name: level === "village" ? `村${k.vil}` : level === "town" ? "某鄉" : level === "county" ? "屏東縣" : "全國", valid, invalid: 1, cast: valid + 1, electors, populationRaw: 0, votes: new Map(votes), officialRate: new Map(votes.map(([n, v]) => [n, Math.round((v / valid) * 10000) / 100])) };
  };
  const cand = (vil: string, n: number, mark: string, partyCode = 999) => ({ key: key(vil), ballotNumber: n, name: `候選人${vil}-${n}`, partyCode, gender: "M" as const, birthYearROC: 50, incumbent: false, electedMark: mark, isRunningMate: false });
  const ds = {
    units: [
      unit({ prv: "00", cty: "000", dist: "00", town: "000", vil: "0000", station: "0000" }, "national", [], 300),
      unit(key("0000", "T"), "county", [], 300),
      unit(key("0000"), "town", [], 300),
      unit(key("0001"), "village", [[1, 60], [2, 40]], 150),
      unit(key("0002"), "village", [[1, 50], [2, 50]], 150),
    ],
    candidates: [cand("0001", 1, "*", 1), cand("0001", 2, ""), cand("0002", 1, "?"), cand("0002", 2, "?")],
    parties: [{ code: 1, name: "中國國民黨" }, { code: 999, name: "無黨籍及未經政黨推薦" }],
  };
  // Summary rows above the village are the sums of the villages.
  for (const u of ds.units.slice(0, 3)) Object.assign(u, { valid: 200, invalid: 2, cast: 202 });
  const V1: ElGroupDef = { ...PRES, local: "village-chief", nameZh: "村里長", office: "village-chief", contests: "village", choiceKind: "candidate", contestPrefix: "v1", contestNameSuffix: "長", villages: true };
  const b = buildElGroup(V1, ds, new Map());
  it("builds one contest per village, named after the place", () => {
    expect(b.contests.map((c) => [c.id, c.nameZh, c.seats, c.scope])).toEqual([
      ["2024-01-13-test.v1-10013080-0001", "屏東縣某鄉村0001長", 1, { level: "village", code: "10013080001" }],
      ["2024-01-13-test.v1-10013080-0002", "屏東縣某鄉村0002長", 1, { level: "village", code: "10013080002" }],
    ]);
    expect(b.results.town!.units[0]!.contestIds).toHaveLength(2);
    expect(b.results.village!.rows.find((r) => r.unit === "vil:10013080001")!.votes).toEqual({ "10013080-0001.n1": 60, "10013080-0001.n2": 40 });
  });
  it("accepts a tie whose draw winner is already marked (2014: no '?', just '*')", () => {
    const decided = { ...ds, candidates: [cand("0001", 1, "*", 1), cand("0001", 2, ""), cand("0002", 1, "*"), cand("0002", 2, "")] };
    const w = buildElGroup(V1, decided, new Map()).checks.find((c) => c.id === "winner-consistent")!;
    expect(w.status).toBe("pass");
    expect(w.detail).toContain("1 seats tied at the cut-off and decided by lot, the draw's winner marked elected");
  });
  it("accepts a tie decided by lot and leaves both candidates' result open", () => {
    expect(b.checks.find((c) => c.id === "winner-consistent")!.status).toBe("pass");
    const lot = b.candidacies.filter((c) => c.contestId.endsWith("0002"));
    expect(lot.map((c) => [c.elected, c.electedNote])).toEqual([[null, "tied-decided-by-lot"], [null, "tied-decided-by-lot"]]);
  });
});

describe("restoring a linearly distorted snapshot", () => {
  it("fits an affine map, ignores changed villages, and reports the residual", async () => {
    const { applyAffine, fitRestore } = await import("../src/geo/restore.ts");
    // Corrupt coordinates: true lon/lat shrunk by ~1e5 around a point, as in 1070205.
    const shrink = ([lon, lat]: [number, number]): [number, number] => [118.7556 + (lon - 120.8) / 111000, 0.0002 + (lat - 23.7) / 110500];
    const pairs = Array.from({ length: 400 }, (_, i) => {
      const to: [number, number] = [120 + (i % 20) * 0.08, 22 + Math.floor(i / 20) * 0.15];
      return { from: shrink(to), to };
    });
    pairs[7] = { from: pairs[7]!.from, to: [pairs[7]!.to[0] + 0.01, pairs[7]!.to[1]] }; // a village that changed (~1 km)
    const { t, check } = fitRestore(pairs);
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("399 of 400");
    const back = applyAffine(t, ...shrink([121.5, 25.04]));
    expect(Math.hypot(back[0] - 121.5, back[1] - 25.04) * 111000).toBeLessThan(0.01);
  });
  it("fails when the distortion is not linear", async () => {
    const { fitRestore } = await import("../src/geo/restore.ts");
    const pairs = Array.from({ length: 400 }, (_, i) => {
      const to: [number, number] = [120 + (i % 20) * 0.08, 22 + Math.floor(i / 20) * 0.15];
      return { from: [to[0] + 0.05 * Math.sin(to[1] * 20), to[1]] as [number, number], to }; // a wobble, not a linear map
    });
    expect(fitRestore(pairs).check.status).toBe("fail");
  });
});

describe("polling-station files", () => {
  it("ids stations per county and tells repeated numbers apart by their village unit", async () => {
    const { stationFiles } = await import("../src/groups/stations.ts");
    const st = (vil: string, station: string) => ({ key: { prv: "63", cty: "000", dist: "00", town: "010", vil, station }, level: "station" as const, name: "", valid: 10, invalid: 0, cast: 10, electors: 20, populationRaw: 0, votes: new Map(), officialRate: new Map() });
    const row = (vil: string, station: string, parentId: string) => ({ u: st(vil, station), parentId, contestIds: ["e.c"], votes: { a: 10 } });
    const f = stationFiles("e.g", [row("0001", "0597", "vil:63000010001"), row("0002", "0598", "vil:63000010002"), row("0003", "0598", "vil:63000010003")]);
    expect(Object.keys(f)).toEqual(["63000"]);
    expect(f["63000"]!.units.map((u) => [u.id, u.parentId, u.nameZh])).toEqual([
      ["st:63000-0597", "vil:63000010001", "第 0597 號投開票所"],
      ["st:63000-0598@63000010002", "vil:63000010002", "第 0598 號投開票所"],
      ["st:63000-0598@63000010003", "vil:63000010003", "第 0598 號投開票所"],
    ]);
    expect(stationFiles("e.g", [row("0001", "0597", "vgrp:63000010-0A01"), row("0002", "0597", "vil:63000010002")])["63000"]!.units.map((u) => u.id)).toEqual([
      "st:63000-0597@63000010-0A01",
      "st:63000-0597@63000010002",
    ]);
  });
});

describe("CEC sequence codes → registry codes", () => {
  const mk = (prv: string, cty: string, town: string, vil: string, station: string, level: "national" | "county" | "town" | "village" | "station", name: string) => ({ key: { prv, cty, dist: "00", town, vil, station }, level, name, valid: 1, invalid: 0, cast: 1, electors: 1, populationRaw: 0, votes: new Map(), officialRate: new Map() });
  const ref = {
    county: new Map([["桃園市", "68000"]]),
    town: new Map([["68000|中壢區", "68000020"]]),
    village: new Map([["68000020|中原里", "68000020005"], ["68000020|興國里", "68000020009"]]),
  };
  const admin = [{ kind: "county" as const, old: "桃園縣", new: "桃園市", source: "x", reviewed: false }];
  const ds = () => ({
    units: [
      mk("03", "000", "000", "0000", "0000", "county", "桃園縣"),
      mk("03", "000", "004", "0000", "0000", "town", "中壢市"),
      mk("03", "000", "004", "0001", "0000", "village", "中原村"),
      mk("03", "000", "004", "0001", "0012", "station", ""),
      mk("03", "000", "004", "0002", "0000", "village", "甲村、乙村"),
      mk("03", "000", "004", "0003", "0000", "village", "舊村"),
    ],
    candidates: [],
    parties: [],
  });
  it("maps a renamed county's township by stem and 村 → 里, prefixes groups G, and codeless villages Z", async () => {
    const { renumberToRegistry } = await import("../src/adapters/registry.ts");
    const d = ds();
    const checks = renumberToRegistry(d, "e", ref, admin, new Map([["e|68000020|舊村", { code: null, source: "x", reviewed: false }]]));
    expect(d.units.map((u) => `${u.key.prv}${u.key.cty}${u.key.town}-${u.key.vil}-${u.key.station}`)).toEqual([
      "68000000-0000-0000", "68000020-0000-0000", "68000020-0005-0000", "68000020-0005-0012", "68000020-G002-0000", "68000020-Z003-0000",
    ]);
    expect(checks[0]!.status).toBe("warn"); // the rename rows are unreviewed
  });
  it("fails on a village that is neither matched nor listed", async () => {
    const { renumberToRegistry } = await import("../src/adapters/registry.ts");
    expect(() => renumberToRegistry(ds(), "e", ref, admin, new Map())).toThrow(/舊村/);
  });
});

describe("pre-2010 merged counties and file corrections", () => {
  const mk = (prv: string, cty: string, dist: string, town: string, vil: string, station: string, level: "county" | "district" | "town" | "village" | "station", name: string, valid = 1) => ({ key: { prv, cty, dist, town, vil, station }, level, name, valid, invalid: 0, cast: valid, electors: valid, populationRaw: 0, votes: new Map<number, number>(), officialRate: new Map<number, number>() });
  const ref = {
    county: new Map([["高雄市", "64000"]]),
    town: new Map([["64000|鹽埕區", "64000010"], ["64000|鳳山區", "64000120"]]),
    village: new Map([["64000010|甲里", "64000010001"], ["64000120|乙里", "64000120001"]]),
  };
  const admin = [{ kind: "county" as const, old: "高雄縣", new: "高雄市", source: "x", reviewed: false }];
  it("merges two old counties' rows, continues the later one's 選區, and keeps villages apart", async () => {
    const { renumberToRegistry } = await import("../src/adapters/registry.ts");
    const ds = {
      units: [
        mk("02", "000", "00", "000", "0000", "0000", "county", "高雄市", 5), mk("02", "000", "01", "000", "0000", "0000", "district", "高雄市第01選區", 5),
        mk("02", "000", "01", "001", "0000", "0000", "town", "鹽埕區", 5), mk("02", "000", "01", "001", "0001", "0000", "village", "甲里", 5),
        mk("03", "012", "00", "000", "0000", "0000", "county", "高雄縣", 7), mk("03", "012", "01", "000", "0000", "0000", "district", "高雄縣第01選區", 7),
        mk("03", "012", "01", "003", "0000", "0000", "town", "鳳山市", 7), mk("03", "012", "01", "003", "0009", "0000", "village", "乙村", 7),
      ],
      candidates: [],
      parties: [],
    };
    renumberToRegistry(ds, "e", ref, admin, new Map());
    expect(ds.units.filter((u) => u.level === "county").map((u) => [u.name, u.valid])).toEqual([["高雄市", 12]]);
    expect(ds.units.filter((u) => u.level === "district").map((u) => `${u.name} ${u.key.dist}`).sort()).toEqual(["高雄市第01選區 01", "高雄縣第01選區 02"]);
    expect(ds.units.filter((u) => u.level === "village").map((u) => `${u.key.town}-${u.key.vil}`).sort()).toEqual(["010-0001", "120-0001"]);
  });
  it("applies a listed correction only where the file is really inconsistent", async () => {
    const { applyCorrections } = await import("../src/adapters/corrections.ts");
    const v = mk("03", "004", "01", "001", "0009", "0000", "village", "新崙里", 6120);
    const s1 = mk("03", "004", "01", "001", "0009", "0001", "station", "", 1000), s2 = mk("03", "004", "01", "001", "0009", "0002", "station", "", 2014);
    const ds = { units: [v, s1, s2], candidates: [], parties: [] };
    const c = new Map([["e", [{ dir: "x/", action: "village-from-stations" as const, key: "03|004|001|0009", note: "n", reviewed: false }]]]);
    expect(applyCorrections(ds, "e", "a/x/", c).check!.status).toBe("warn");
    expect(v.valid).toBe(3014);
    expect(() => applyCorrections(ds, "e", "a/x/", c)).toThrow(/already agrees/);
  });
});

describe("2010-06-12 legacy files", () => {
  it("maps old party numbers to modern codes by name (99 無 → 999) and fails on an unknown party", async () => {
    const { remapLegacyParties } = await import("../src/adapters/cec-el.ts");
    const cand = (partyCode: number) => ({ key: { prv: "01", cty: "001", dist: "01", town: "001", vil: "0001", station: "0000" }, ballotNumber: 1, name: "甲", partyCode, gender: "M" as const, birthYearROC: 50, incumbent: null, electedMark: "*", isRunningMate: false });
    const ds = { units: [], candidates: [cand(2), cand(99)], parties: [{ code: 2, name: "民主進步黨" }, { code: 99, name: "無" }] };
    remapLegacyParties(ds, [{ code: 16, name: "民主進步黨" }, { code: 999, name: "無黨籍及未經政黨推薦" }]);
    expect(ds.candidates.map((c) => c.partyCode)).toEqual([16, 999]);
    expect(() => remapLegacyParties({ units: [], candidates: [], parties: [{ code: 9, name: "某黨" }] }, [])).toThrow(/某黨/);
  });
  it("checks partial units (candidate votes only) on valid ballots alone", () => {
    const mk = (vil: string, valid: number, partial: boolean) => ({ key: { prv: "10", cty: "002", dist: vil === "0000" ? "00" : "01", town: "010", vil, station: "0000" }, level: (vil === "0000" ? "town" : "village") as "town" | "village", name: "x", valid, invalid: partial ? 0 : 5, cast: partial ? 0 : valid + 5, electors: partial ? 0 : 99, populationRaw: 0, votes: new Map<number, number>(), officialRate: new Map<number, number>(), partial });
    const up = (prv: string, cty: string, level: "national" | "county", valid: number) => ({ ...mk("0000", valid, false), key: { prv, cty, dist: "00", town: "000", vil: "0000", station: "0000" }, level });
    const tree = (townValid: number) => ({ units: [up("00", "000", "national", townValid), up("10", "002", "county", townValid), mk("0000", townValid, false), mk("0001", 10, true), mk("0002", 20, true)], candidates: [], parties: [] });
    const h = (d: ReturnType<typeof tree>) => checkElDataset(d, () => null).find((c) => c.id === "hierarchy-sums")!.status;
    expect(h(tree(30))).toBe("pass");
    expect(h(tree(31))).toBe("fail");
  });
});

describe("pre-2008 files", () => {
  const mk = (prv: string, cty: string, dist: string, town: string, vil: string, level: "county" | "district" | "town" | "village" | "station", name: string, valid = 1, station = "0000") => ({ key: { prv, cty, dist, town, vil, station }, level, name, valid, invalid: 0, cast: valid, electors: valid, populationRaw: 0, votes: new Map<number, number>(), officialRate: new Map<number, number>() });
  it("keeps an old 縣 and 市 as two county-wide contests (選區 01 / 02) under one county row", async () => {
    const { renumberToRegistry } = await import("../src/adapters/registry.ts");
    const ref = { county: new Map([["高雄市", "64000"]]), town: new Map([["64000|鹽埕區", "64000010"], ["64000|鳳山區", "64000120"]]), village: new Map<string, string>() };
    const admin = [{ kind: "county" as const, old: "高雄縣", new: "高雄市", source: "x", reviewed: false }];
    const ds = {
      units: [mk("02", "000", "00", "000", "0000", "county", "高雄市", 5), mk("02", "000", "00", "001", "0000", "town", "鹽埕區", 5), mk("03", "012", "00", "000", "0000", "county", "高雄縣", 7), mk("03", "012", "00", "003", "0000", "town", "鳳山市", 7)],
      candidates: [],
      parties: [],
    };
    renumberToRegistry(ds, "e", ref, admin, new Map(), { oldCountyContests: true });
    expect(ds.units.filter((u) => u.level === "district").map((u) => `${u.name} ${u.key.dist}`).sort()).toEqual(["高雄市 02", "高雄縣 01"]);
    const county = ds.units.filter((u) => u.level === "county");
    expect(county.map((u) => [u.name, u.valid, u.votes.size])).toEqual([["高雄市", 12, 0]]);
    expect(ds.units.filter((u) => u.level === "town").map((u) => `${u.key.town} ${u.key.dist}`).sort()).toEqual(["010 02", "120 01"]);
  });
  it("gives parties no modern file names their own code, and refuses a name with two modern codes", async () => {
    const { remapLegacyParties } = await import("../src/adapters/cec-el.ts");
    const ds: { units: never[]; candidates: never[]; parties: { code: number; name: string }[]; partyRemap?: Map<number, number> } = { units: [], candidates: [], parties: [{ code: 11, name: "張亞中等150人聯盟" }, { code: 2, name: "民主進步黨" }] };
    remapLegacyParties(ds, [{ code: 16, name: "民主進步黨" }], new Map([["張亞中等150人聯盟", 9001]]));
    expect([...ds.partyRemap!]).toEqual([[11, 9001], [2, 16]]);
    expect(() => remapLegacyParties({ units: [], candidates: [], parties: [{ code: 3, name: "勞動黨" }] }, [{ code: 15, name: "勞動黨" }, { code: 33, name: "勞動黨" }])).toThrow(/15, 33/);
  });
  it("gives a repeated village name no code, and moves township votes numbered in another file's order", async () => {
    const { applyCorrections } = await import("../src/adapters/corrections.ts");
    const a = mk("01", "005", "00", "017", "0254", "village", "西坪里"), b = mk("01", "005", "00", "017", "0259", "village", "西坪里");
    const ds1 = { units: [a, b, mk("01", "005", "00", "017", "0259", "station", "", 1, "0007")], candidates: [], parties: [] };
    applyCorrections(ds1, "e", "a/x/", new Map([["e", [{ dir: "x/", action: "duplicate-no-code" as const, key: "01|005|017|0259", note: "n", reviewed: false }]]]));
    expect([(a as { noVillageCode?: boolean }).noVillageCode, (b as { noVillageCode?: boolean }).noVillageCode, b.name]).toEqual([undefined, true, "西坪里（重複列名）"]);
    // elctks numbers 三重/中和 the other way round (as the reference file does).
    const t2 = mk("01", "001", "11", "002", "0000", "town", "三重市", 247), t3 = mk("01", "001", "11", "003", "0000", "town", "中和市", 451);
    t2.votes = new Map([[1, 451]]); t3.votes = new Map([[1, 247]]);
    const ref = { units: [mk("01", "001", "02", "002", "0000", "town", "中和市"), mk("01", "001", "05", "003", "0000", "town", "三重市")], candidates: [], parties: [] };
    applyCorrections({ units: [t2, t3], candidates: [], parties: [] }, "e", "a/y/", new Map([["e", [{ dir: "y/", action: "ctks-towns-by-name" as const, key: "ref/", note: "n", reviewed: false }]]]), () => ref);
    expect([t2.votes.get(1), t3.votes.get(1)]).toEqual([247, 451]);
  });
});
