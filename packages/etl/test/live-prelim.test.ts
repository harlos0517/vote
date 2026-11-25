import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroupMetadataFile, GroupResultsFile, Party } from "@tw-election/schema";
import { LiveManifestFile, LiveSnapshotFile } from "@tw-election/schema";
import { readFileSync } from "node:fs";
import { loadPartyNames } from "../src/lib/party-names.ts";
import { announcePrelimGroup, buildPrelimGroup, loadFeedGroup, readCandidateCsv, writePrelimGroup } from "../src/live/prelim.ts";

const HEAD = "election,cec_type,county,county_name,ballot_number,name,party,source,method,status";
const row = (county: string, n: number, name: string, party: string, type = "C1", status = "unreviewed") =>
  `2026-11-28-local,${type},${county},X,${n},${name},${party},https://web.cec.gov.tw/x/article/1,text,${status}`;
function csv(lines: string[]) {
  const p = join(mkdtempSync(join(tmpdir(), "cand-")), "c.csv");
  writeFileSync(p, [HEAD, ...lines].join("\n") + "\n");
  return p;
}

describe("readCandidateCsv", () => {
  it("reads the committed 2026 mayor list: 22 counties, numbers 1..n", () => {
    const rows = readCandidateCsv(join(import.meta.dirname, "../mappings/candidates-2026-mayor.csv"));
    expect(new Set(rows.map((r) => r.area)).size).toBe(22);
    expect(rows).toHaveLength(81);
    expect(rows.find((r) => r.area === "63000" && r.ballotNumber === 5)?.name).toBe("蔣萬安");
  });
  it("rejects gaps, repeats and mixed type codes", () => {
    expect(() => readCandidateCsv(csv([row("63000", 1, "甲", "無"), row("63000", 3, "乙", "無")]))).toThrow(/expected 1..2/);
    expect(() => readCandidateCsv(csv([row("63000", 1, "甲", "無"), row("63000", 1, "乙", "無")]))).toThrow(/expected 1..2/);
    expect(() => readCandidateCsv(csv([row("63000", 1, "甲", "無"), row("63000", 2, "乙", "無", "C2")]))).toThrow(/mixes cec_type/);
    expect(() => readCandidateCsv(csv([row("63000", 1, "甲", "無").replace("https://", "http://")]))).toThrow(/https/);
  });
});

const E22 = "2022-11-26-local";
const baseContest = (code: string) => ({ id: `${E22}.c1-${code}`, electionId: E22, office: "mayor-or-magistrate", cecTypeCode: "C1", nameZh: `${code}長`, electorate: "general", seats: 1, choiceKind: "candidate", districtId: null, scope: { level: "county", code }, availableLevels: ["national", "county", "town", "village"], date: null, partyList: null, referendum: null, warnings: [] });
const units = (level: GroupResultsFile["level"], us: [string, string | null, string[]][]): GroupResultsFile => ({ schemaVersion: 2, groupId: `${E22}.mayor`, level, units: us.map(([id, parentId, contestIds]) => ({ id, level, nameZh: id, parentId, contestIds })), rows: [] });
const base = {
  release: "r-base",
  metadata: {
    schemaVersion: 2, release: "r-base",
    election: { id: E22, date: "2022-11-26", nameZh: "2022年 地方公職人員選舉", kinds: ["local"], sources: [] },
    group: { id: `${E22}.mayor`, nameZh: "直轄市長及縣市長選舉", office: "mayor-or-magistrate", electorate: "general", levels: ["national", "county", "town", "village"], warnings: ["old"] },
    contests: [baseContest("63000"), baseContest("10002")],
    choices: [{ id: "63000.n1", contestId: `${E22}.c1-63000`, kind: "candidate", ballotNumber: 1, candidacyIds: [], partyId: null, labelZh: "舊" }],
    candidacies: [], persons: [], parties: [],
    sources: [{ id: "nlsc", publisher: "內政部國土測繪中心", title: "村里界", url: "https://data.gov.tw/dataset/130549", license: "政府資料開放授權條款-第1版" }],
    boundary: { versionId: "nlsc-village-1111118", sourceId: "nlsc", files: { county: "geo/county.geojson", town: "geo/town.geojson", village: "geo/village.geojson" }, notes: [{ unit: "town:63000010", note: "t" }, { unit: "vil:63000010001", note: "v" }] },
    results: {}, validation: [],
  } as unknown as GroupMetadataFile,
  results: {
    national: units("national", [["nat", null, [`${E22}.c1-63000`, `${E22}.c1-10002`]]]),
    county: units("county", [["cty:63000", "nat", [`${E22}.c1-63000`]], ["cty:10002", "nat", [`${E22}.c1-10002`]]]),
    town: units("town", [["town:63000010", "cty:63000", [`${E22}.c1-63000`]]]),
  },
};
const parties = [
  { id: "cec-1", cecCode: 1, nameZh: "中國國民黨", isIndependent: false },
  { id: "cec-16", cecCode: 16, nameZh: "民主進步黨", isIndependent: false },
  { id: "cec-999", cecCode: 999, nameZh: "無黨籍及未經政黨推薦", isIndependent: true },
] as Party[];
const election = { id: "2026-11-28-local", date: "2026-11-28", nameZh: "2026年 地方公職人員選舉" };

describe("buildPrelimGroup", () => {
  const rows = readCandidateCsv(csv([row("63000", 1, "甲", "中國國民黨"), row("63000", 2, "乙", "無"), row("10002", 1, "丙", "新政黨", "C2", "reviewed")]));
  const g = buildPrelimGroup({ rows, election, base, parties, levels: ["national", "county", "town"], local: "mayor" });

  it("makes 2026 contests with the CSV's type code and moves units to them", () => {
    expect(g.metadata.group.id).toBe("2026-11-28-local.mayor");
    expect(g.metadata.contests.map((c) => [c.id, c.cecTypeCode, c.availableLevels.length])).toEqual([["2026-11-28-local.c1-63000", "C1", 3], ["2026-11-28-local.c1-10002", "C2", 3]]);
    expect(g.units.national!.units[0]!.contestIds).toEqual(["2026-11-28-local.c1-63000", "2026-11-28-local.c1-10002"]);
    expect(g.units.town!.rows).toEqual([]);
  });

  it("maps parties by name, 無 to the independent code, and flags unknown ones", () => {
    expect(g.metadata.choices.map((c) => [c.id, c.labelZh, c.partyId])).toEqual([["63000.n1", "甲", "cec-1"], ["63000.n2", "乙", "cec-999"], ["10002.n1", "丙", null]]);
    expect(g.unknownParties).toEqual(["新政黨"]);
    expect(g.metadata.parties.map((p) => p.id)).toEqual(["cec-1", "cec-999"]);
    expect(g.metadata.group.warnings.join()).toMatch(/2 筆尚未人工審核.*新政黨/s);
  });

  it("maps a renamed party by its CEC code and shows the current name", () => {
    const withTsu = [...parties, { id: "cec-95", cecCode: 95, nameZh: "台灣團結聯盟", isIndependent: false } as Party];
    const r = readCandidateCsv(csv([row("63000", 1, "甲", "台聯黨"), row("10002", 1, "乙", "無")]));
    const h = buildPrelimGroup({ rows: r, election, base, parties: withTsu, partyNames: new Map([["台聯黨", { cecCode: 95 }]]), levels: ["county"], local: "mayor" });
    expect(h.metadata.choices[0]!.partyId).toBe("cec-95");
    expect(h.unknownParties).toEqual([]);
    expect(h.metadata.parties.find((x) => x.id === "cec-95")?.nameZh).toBe("台聯黨");
  });

  it("reads the committed party-names.csv", () => {
    const names = loadPartyNames(join(import.meta.dirname, "../../.."));
    expect([...names].map(([n, v]) => [n, v.cecCode])).toEqual([["臺灣SoR無法黨", 366], ["三勢團結促進聯盟", 203], ["台聯黨", 95]]);
  });

  it("keeps only county/town boundaries and notes", () => {
    expect(Object.keys(g.metadata.boundary.files)).toEqual(["county", "town"]);
    expect(g.metadata.boundary.notes.map((n) => n.unit)).toEqual(["town:63000010"]);
    expect(g.metadataRef).toEqual({ feedPath: "groups/2026-11-28-local.mayor/metadata.json", geographyRelease: "r-base" });
  });

  it("refuses a list that misses a county of the base group", () => {
    const one = readCandidateCsv(csv([row("63000", 1, "甲", "無")]));
    expect(() => buildPrelimGroup({ rows: one, election, base, parties, levels: ["county"], local: "mayor" })).toThrow(/no candidates for 10002長/);
  });

  it("round-trips through the feed folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "feed-"));
    writePrelimGroup(dir, g);
    const back = loadFeedGroup(dir, g.metadata.group.id)!;
    expect(back.metadata).toEqual(g.metadata);
    expect(back.results.county!.units).toHaveLength(2);
    expect(back.metadataRef).toEqual(g.metadataRef);
    expect(loadFeedGroup(dir, "2026-11-28-local.nope")).toBeNull();
  });

  it("announces the group before counting without touching a running feed", () => {
    const dir = mkdtempSync(join(tmpdir(), "feed-"));
    announcePrelimGroup(dir, "cec-2026-11-28-local", g, new Date("2026-11-28T00:00:00Z"));
    const m = LiveManifestFile.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(m.groups).toEqual([expect.objectContaining({ groupId: g.metadata.group.id, seq: 0, status: "not-started", metadata: g.metadataRef })]);
    expect(m.mode).toBe("cec-public");
    // A poller has moved on: announcing again keeps its snapshot and seq.
    const latest = join(dir, `groups/${g.metadata.group.id}/latest.json`);
    const moved = { ...LiveSnapshotFile.parse(JSON.parse(readFileSync(latest, "utf8"))), seq: 7, status: "counting" };
    writeFileSync(latest, JSON.stringify(moved));
    announcePrelimGroup(dir, "cec-2026-11-28-local", g);
    const m2 = LiveManifestFile.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(m2.groups).toHaveLength(1);
    expect(m2.groups[0]).toMatchObject({ seq: 7, status: "counting" });
  });
});

// --- 鄉鎮市長 (roster, no ballot numbers) and the referendum ---------------------------------

import { buildPrelimReferendum, nameKey } from "../src/live/prelim.ts";

describe("township roster", () => {
  it("reads the committed 2026 鄉鎮市長 roster: 198 towns, 460 candidates, no ballot numbers", () => {
    const rows = readCandidateCsv(join(import.meta.dirname, "../mappings/candidates-2026-township-mayor.csv"));
    expect(new Set(rows.map((r) => r.area)).size).toBe(198);
    expect(rows).toHaveLength(460);
    expect(rows.every((r) => r.ballotNumber === null && r.cecType === "D1" && /^\d{8}$/.test(r.area))).toBe(true);
  });
  it("refuses two candidates whose names match the same way", () => {
    const head = "election,cec_type,town,county_name,town_name,name,party,source,method,status";
    const line = (name: string) => `2026-11-28-local,D1,10002010,宜蘭縣,宜蘭市,${name},無,https://web.cec.gov.tw/central/article/64709,text,unreviewed`;
    const p = join(mkdtempSync(join(tmpdir(), "t-")), "t.csv");
    writeFileSync(p, [head, line("王小明"), line("王小明Wang")].join("\n"));
    expect(() => readCandidateCsv(p)).toThrow(/same name/);
  });
  it("keys names by Han characters only", () => {
    expect(nameKey("車牧勒薩以‧拉勒格安 Cemelesai Ljaljegan")).toBe(nameKey("車牧勒薩以．拉勒格安"));
    expect(nameKey("伊藍．明基努安")).toBe("伊藍明基努安");
  });
});

describe("buildPrelimReferendum", () => {
  const refBase = {
    ...base,
    metadata: {
      ...base.metadata,
      group: { ...base.metadata.group, id: "2022-11-26-constitutional-referendum.case-1", office: "constitutional-referendum" },
      contests: [{ ...baseContest("x"), id: "2022-11-26-constitutional-referendum.case-1", choiceKind: "referendum", scope: { level: "national" }, referendum: { caseNumber: 1 } }],
    } as unknown as GroupMetadataFile,
    results: {
      national: units("national", [["nat", null, ["2022-11-26-constitutional-referendum.case-1"]]]),
      county: units("county", [["cty:63000", "nat", ["2022-11-26-constitutional-referendum.case-1"]]]),
    },
  };
  const rule = { agreeMustExceedDisagree: true, agreeQuorumOfElectors: 0.25, quorumStrict: false, legalBasis: "公民投票法第29條" };
  const g = buildPrelimReferendum({
    election: { id: "2026-11-28-referendum", date: "2026-11-28", nameZh: "2026年 全國性公民投票" },
    caseNumber: 22,
    question: { text: "問題？", source: "中央選舉委員會公告 https://web.cec.gov.tw/central/article/64314", reviewed: false },
    rule,
    base: refBase,
    levels: ["national", "county"],
  });
  it("makes one 第22案 contest with 同意／不同意, the question and the 公投法 rule, no outcome", () => {
    expect(g.metadata.group.id).toBe("2026-11-28-referendum.case-22");
    const c = g.metadata.contests[0]!;
    expect(c).toMatchObject({ id: "2026-11-28-referendum.case-22", office: "referendum-national", nameZh: "全國性公民投票案第22案", referendum: { caseNumber: 22, questionZh: "問題？", questionReviewed: false, rule, outcome: null } });
    expect(g.metadata.choices.map((x) => x.id)).toEqual(["agree", "disagree"]);
    expect(g.units.county!.units[0]!.contestIds).toEqual(["2026-11-28-referendum.case-22"]);
    expect(g.metadata.sources[0]!.url).toBe("https://web.cec.gov.tw/central/article/64314");
  });
  it("refuses a base that is not a single referendum", () => {
    expect(() => buildPrelimReferendum({ election: { id: "2026-11-28-referendum", date: "2026-11-28", nameZh: "x" }, caseNumber: 22, question: { text: "q", source: "s", reviewed: false }, rule, base, levels: ["county"] })).toThrow(/not a single referendum/);
  });
});
