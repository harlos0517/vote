import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveManifestFile, LiveSnapshotFile, type BallotChoice, type Contest, type GroupMetadataFile } from "@tw-election/schema";
import {
  BlockedError,
  PageFormatError,
  dataTimeIso,
  pagePath,
  pageToRow,
  parseResultPage,
  pollGroupOnce,
  prefixFor,
  runCecPoller,
  type Fetcher,
  type GroupPlan,
} from "../src/live/cec-public.ts";

const FIX = join(import.meta.dirname, "fixtures/cec-live-2024");
const P1 = readFileSync(join(FIX, "P1-00000000000000000.html"), "utf8");
const L4 = readFileSync(join(FIX, "L4-63000001000000774.html"), "utf8");

describe("parseResultPage (archived 2024 pages)", () => {
  it("reads the national presidential page", () => {
    const p = parseResultPage(P1);
    expect(p.title).toBe("總統副總統選舉 候選人得票數");
    expect([p.reported, p.total]).toEqual([17795, 17795]);
    expect(p.dataTime).toBe("01/13 22:21");
    expect(p.choices).toEqual([
      { ballotNumber: 1, names: ["柯文哲", "吳欣盈"], votes: 3690466, elected: false },
      { ballotNumber: 2, names: ["賴清德", "蕭美琴"], votes: 5586019, elected: true },
      { ballotNumber: 3, names: ["侯友宜", "趙少康"], votes: 4671021, elected: false },
    ]);
  });

  it("reads a station-level party-list page (no 註記 column, rows out of order)", () => {
    const p = parseResultPage(L4);
    expect([p.reported, p.total]).toEqual([1, 1]);
    expect(p.choices).toHaveLength(16);
    const by = new Map(p.choices.map((c) => [c.ballotNumber, c]));
    expect(by.get(9)).toEqual({ ballotNumber: 9, names: ["中國國民黨"], votes: 334, elected: false });
    expect(by.get(12)).toMatchObject({ names: ["台灣民眾黨"], votes: 286 });
    expect(p.choices.reduce((s, c) => s + c.votes, 0)).toBe(1021);
  });

  it("fails loudly when the layout changes", () => {
    expect(() => parseResultPage(P1.replace("已送投票所數", "已回報"))).toThrow(PageFormatError);
    expect(() => parseResultPage(P1.replace(/(<th[^>]*>\s*)得票數/, "$1票數"))).toThrow(/unexpected columns/);
    expect(() => parseResultPage(P1.replace("3,690,466", "三百萬"))).toThrow(/not a count/);
  });

  it("turns 資料時間 into an ISO time in Taiwan time", () => {
    expect(dataTimeIso("01/13 22:21", "2024-01-13")).toBe("2024-01-13T22:21:00+08:00");
  });
});

describe("pagePath", () => {
  it("builds the c/y/d/v/b serial the 2024 site used", () => {
    expect(pagePath("P1", "nat")).toBe("P1/00000000000000000.html");
    expect(pagePath("C1", "cty:63000")).toBe("C1/63000000000000000.html");
    expect(pagePath("C1", "town:63000100")).toBe("C1/63000001000000000.html");
    expect(pagePath("T1", "dist:63000-03")).toBe("T1/63000030000000000.html");
    expect(pagePath("T1", "tp:63000100-03")).toBe("T1/63000031000000000.html");
    expect(pagePath("C1", "vil:63000100012")).toBe("C1/63000001000120000.html");
    expect(pagePath("C1", "vgrp:09007010-0A01")).toBeNull();
  });
});

// --- a small group: two county mayor contests, national total summed from them ----------

const E = "2026-11-28-test";
const contest = (code: string): Contest =>
  ({ id: `${E}.c1-${code}`, electionId: E, office: "mayor-or-magistrate", cecTypeCode: "C1", nameZh: code, electorate: "general", seats: 1, choiceKind: "candidate", districtId: null, scope: { level: "county", code }, availableLevels: ["county"], warnings: [] }) as unknown as Contest;
const choice = (code: string, n: number, label: string): BallotChoice => ({ id: `${code}.n${n}`, contestId: `${E}.c1-${code}`, kind: "candidate", ballotNumber: n, candidacyIds: [], partyId: null, labelZh: label });
const metadata = {
  election: { id: E, date: "2026-11-28", nameZh: "測試選舉", kinds: ["local"], sources: [] },
  group: { id: `${E}.mayor`, nameZh: "縣市長", office: "mayor-or-magistrate", electorate: "general", levels: ["national", "county"], warnings: [] },
  contests: [contest("63000"), contest("65000")],
  choices: [choice("63000", 1, "甲"), choice("63000", 2, "乙"), choice("65000", 1, "丙")],
} as unknown as GroupMetadataFile;
const plan: GroupPlan = {
  metadata,
  levels: ["national", "county"],
  results: {
    national: { units: [{ id: "nat", level: "national", nameZh: "全國", parentId: null, contestIds: [`${E}.c1-63000`, `${E}.c1-65000`] }] },
    county: {
      units: [
        { id: "cty:63000", level: "county", nameZh: "臺北市", parentId: "nat", contestIds: [`${E}.c1-63000`] },
        { id: "cty:65000", level: "county", nameZh: "新北市", parentId: "nat", contestIds: [`${E}.c1-65000`] },
      ],
    },
  },
};

/** A page in the 2024 layout, for the fake site. */
function page(reported: number, total: number, rows: [number, string, number][], time = "11/28 17:05") {
  const tr = rows.map(([n, name, v]) => `<tr><td class="electmark"></td><td>${n}</td><td><div>${name}</div></td><td class="numeric">${v.toLocaleString("en")}</td></tr>`).join("");
  return `<div class="vote-table-header-title"><b>測試</b></div><div>已送投票所數/總投票所數: ${reported}/${total} </div>
<table><thead><tr><th>註記</th><th>號次</th><th>候選人姓名</th><th>得票數</th></tr></thead><tbody>${tr}</tbody></table>
<span>資料時間:&nbsp;${time}</span>`;
}

function site(pages: Record<string, { status: number; body?: string }>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (path: string) => {
    calls.push(path);
    const p = pages[path];
    if (!p) return { status: 404, body: "" };
    return { status: p.status, body: p.body ?? "" };
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

const TP = "C1/63000000000000000.html";
const NTP = "C1/65000000000000000.html";

describe("pageToRow", () => {
  it("maps by ballot number and warns on a differing name", () => {
    const p = parseResultPage(page(3, 10, [[1, "甲", 100], [2, "乙X", 50]]));
    const r = pageToRow(p, "cty:63000", "county", metadata.contests[0]!, metadata.choices, "2026-11-28");
    expect(r.row).toMatchObject({ reported: 3, total: 10, votes: { "63000.n1": 100, "63000.n2": 50 }, asOf: "2026-11-28T17:05:00+08:00" });
    expect(r.warnings).toEqual([expect.stringContaining("號次 2")]);
  });
  it("matches the archived 2024 page to the president tickets as published", () => {
    const pres = { ...metadata.contests[0]!, id: "2024-01-13-president-legislative.president", cecTypeCode: null, office: "president" } as Contest;
    const tickets: BallotChoice[] = [["柯文哲／吳欣盈", 1], ["賴清德／蕭美琴", 2], ["侯友宜／趙少康", 3]].map(([labelZh, n]) => ({ id: `n${n}`, contestId: pres.id, kind: "ticket", ballotNumber: n as number, candidacyIds: [], partyId: null, labelZh: labelZh as string }));
    const r = pageToRow(parseResultPage(P1), "nat", "national", pres, tickets, "2024-01-13");
    expect(r.warnings).toEqual([]);
    // Same numbers as the published 2024 national results (data/out, votedata.zip).
    expect(r.row).toMatchObject({ reported: 17795, total: 17795, votes: { n1: 3690466, n2: 5586019, n3: 4671021 }, asOf: "2024-01-13T22:21:00+08:00" });
    expect(pagePath(prefixFor(pres), "nat")).toBe("P1/00000000000000000.html");
  });
  it("refuses a page whose names mostly differ, or with an unknown ballot number", () => {
    const wrong = parseResultPage(page(1, 1, [[1, "丁", 1], [2, "戊", 1]]));
    expect(() => pageToRow(wrong, "cty:63000", "county", metadata.contests[0]!, metadata.choices, "2026-11-28")).toThrow(/most names differ/);
    const extra = parseResultPage(page(1, 1, [[3, "己", 1]]));
    expect(() => pageToRow(extra, "cty:63000", "county", metadata.contests[0]!, metadata.choices, "2026-11-28")).toThrow(/號次 3/);
  });
});

describe("pollGroupOnce", () => {
  const opts = { feedId: "cec-test", concurrency: 2, now: () => new Date("2026-11-28T09:10:00Z") };

  it("fetches one page per county and sums the national row", async () => {
    const f = site({ [TP]: { status: 200, body: page(3, 10, [[1, "甲", 100], [2, "乙", 50]]) }, [NTP]: { status: 200, body: page(0, 5, [[1, "丙", 0]]) } });
    const r = await pollGroupOnce(plan, f, null, opts);
    expect(f.calls.sort()).toEqual([TP, NTP]);
    expect(r.snapshot.seq).toBe(0);
    expect(r.snapshot.status).toBe("counting");
    const nat = r.snapshot.rows.find((x) => x.unit === "nat")!;
    expect(nat).toMatchObject({ reported: 3, total: 15, votes: { "63000.n1": 100, "63000.n2": 50, "65000.n1": 0 } });
    expect(r.snapshot.asOf).toBe("2026-11-28T17:05:00+08:00");
  });

  it("keeps the last good row, marked stale, when a page fails", async () => {
    const good = site({ [TP]: { status: 200, body: page(3, 10, [[1, "甲", 100], [2, "乙", 50]]) }, [NTP]: { status: 200, body: page(1, 5, [[1, "丙", 7]]) } });
    const prev = (await pollGroupOnce(plan, good, null, opts)).snapshot;
    const flaky = site({ [TP]: { status: 503 }, [NTP]: { status: 200, body: page(2, 5, [[1, "丙", 9]]) } });
    const r = await pollGroupOnce(plan, flaky, prev, opts);
    expect(r.failed).toBe(1);
    expect(r.snapshot.seq).toBe(1);
    expect(r.snapshot.rows.find((x) => x.unit === "cty:63000")).toMatchObject({ reported: 3, stale: true, votes: { "63000.n1": 100 } });
    expect(r.snapshot.rows.find((x) => x.unit === "nat")).toMatchObject({ reported: 5, stale: true });
  });

  it("is final only when every page is complete", async () => {
    const done = site({ [TP]: { status: 200, body: page(10, 10, [[1, "甲", 1], [2, "乙", 2]]) }, [NTP]: { status: 200, body: page(5, 5, [[1, "丙", 3]]) } });
    expect((await pollGroupOnce(plan, done, null, opts)).snapshot.status).toBe("final");
    const zero = site({ [TP]: { status: 200, body: page(0, 10, [[1, "甲", 0], [2, "乙", 0]]) }, [NTP]: { status: 200, body: page(0, 5, [[1, "丙", 0]]) } });
    expect((await pollGroupOnce(plan, zero, null, opts)).snapshot.status).toBe("not-started");
  });

  it("stops on 403 or 429 instead of retrying", async () => {
    await expect(pollGroupOnce(plan, site({ [TP]: { status: 403 }, [NTP]: { status: 200, body: page(0, 5, [[1, "丙", 0]]) } }), null, opts)).rejects.toThrow(BlockedError);
    await expect(pollGroupOnce(plan, site({ [TP]: { status: 429 }, [NTP]: { status: 429 } }), null, opts)).rejects.toThrow(BlockedError);
  });

  it("stops when a page no longer parses", async () => {
    await expect(pollGroupOnce(plan, site({ [TP]: { status: 200, body: "<html>維護中</html>" }, [NTP]: { status: 200, body: page(0, 5, [[1, "丙", 0]]) } }), null, opts)).rejects.toThrow(PageFormatError);
  });
});

describe("runCecPoller", () => {
  const plans = [{ ...plan, metadataPath: `groups/${E}.mayor/metadata.json` }];
  const counting = site({ [TP]: { status: 200, body: page(3, 10, [[1, "甲", 100], [2, "乙", 50]]) }, [NTP]: { status: 200, body: page(1, 5, [[1, "丙", 7]]) } });

  it("writes snapshot, latest and manifest each cycle and stops on the STOP file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cec-"));
    let cycles = 0;
    const result = await runCecPoller({
      feedDir: dir, feedId: "cec-test", release: "r-test", plans, fetchPage: counting, sourceUrl: "https://vote.cec.gov.tw/zh-TW/",
      intervalSeconds: 120, concurrency: 2, log: () => {},
      sleep: async () => { if (++cycles === 2) writeFileSync(join(dir, "STOP"), ""); },
    });
    expect(result).toBe("stopped");
    expect(existsSync(join(dir, `groups/${E}.mayor/snapshots/0001.json`))).toBe(true);
    const latest = LiveSnapshotFile.parse(JSON.parse(readFileSync(join(dir, `groups/${E}.mayor/latest.json`), "utf8")));
    expect(latest.seq).toBe(1);
    const m = LiveManifestFile.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(m).toMatchObject({ mode: "cec-public", source: { publisher: "中央選舉委員會", url: "https://vote.cec.gov.tw/zh-TW/" }, groups: [{ seq: 1, status: "counting" }] });
  });

  it("backs off when most pages fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cec-"));
    const waits: number[] = [];
    await runCecPoller({
      feedDir: dir, feedId: "cec-test", release: "r-test", plans, fetchPage: site({}), sourceUrl: "https://example.test/",
      intervalSeconds: 120, concurrency: 2, log: () => {},
      sleep: async (ms) => { waits.push(ms); if (waits.length === 3) writeFileSync(join(dir, "STOP"), ""); },
    });
    expect(waits).toEqual([240_000, 480_000, 600_000]);
  });
});
