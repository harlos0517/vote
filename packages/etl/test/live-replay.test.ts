import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveManifestFile, LiveSnapshotFile, type GroupMetadataFile, type GroupResultsFile } from "@tw-election/schema";
import { buildReplay, livePaths, playReplayFeed, replayManifest, writeReplayFeed, type ReplayGroupInput } from "../src/live/replay.ts";

const C = "2022-11-26-test.c1-63000";
const sum = (electors: number, valid: number, invalid: number, population: number | null = null) => ({ electors, ballotsCast: valid + invalid, valid, invalid, population });

function file(level: GroupResultsFile["level"], units: [string, string | null][], rows: GroupResultsFile["rows"]): GroupResultsFile {
  return { schemaVersion: 2, groupId: "2022-11-26-test.mayor", level, units: units.map(([id, parentId]) => ({ id, level, nameZh: id, parentId, contestIds: [C] })), rows };
}

// Town 010 has two villages that add up. Town 020 has one village plus 5 votes CEC only
// reports at township level, which must come through as a remainder.
const results: ReplayGroupInput["results"] = {
  county: file("county", [["cty:63000", null]], [{ unit: "cty:63000", summary: sum(100, 75, 5, 900), votes: { n1: 45, n2: 30 } }]),
  town: file("town", [["town:63000010", "cty:63000"], ["town:63000020", "cty:63000"]], [
    { unit: "town:63000010", summary: sum(60, 50, 3), votes: { n1: 30, n2: 20 } },
    { unit: "town:63000020", summary: sum(40, 25, 2), votes: { n1: 15, n2: 10 } },
  ]),
  village: file("village", [["vil:63000010001", "town:63000010"], ["vil:63000010002", "town:63000010"], ["vil:63000020001", "town:63000020"]], [
    { unit: "vil:63000010001", summary: sum(30, 20, 1), votes: { n1: 12, n2: 8 } },
    { unit: "vil:63000010002", summary: sum(30, 30, 2), votes: { n1: 18, n2: 12 } },
    { unit: "vil:63000020001", summary: sum(40, 20, 2), votes: { n1: 12, n2: 8 } },
  ]),
};

const metadata = {
  election: { id: "2022-11-26-test", date: "2022-11-26", nameZh: "測試選舉", kinds: ["local"], sources: [] },
  group: { id: "2022-11-26-test.mayor", nameZh: "測試市長", office: "mayor-or-magistrate", electorate: "general", levels: ["county", "town", "village"], warnings: [] },
  sources: [{ id: "cec-votedata", publisher: "中央選舉委員會", title: "選舉資料庫", url: "https://data.gov.tw/dataset/13119", license: "政府資料開放授權條款-第1版" }],
  results: {},
} as unknown as GroupMetadataFile;

const opts = { feedId: "replay-2022-11-26-test", start: "2022-11-26T16:00:00+08:00", intervalMinutes: 3, seed: 1 };

describe("buildReplay", () => {
  const g = buildReplay({ metadata, results }, opts);
  const row = (seq: number, unit: string) => g.snapshots[seq]!.rows.find((r) => r.unit === unit)!;

  it("starts empty, ends final, and stamps times in +08:00", () => {
    const first = g.snapshots[0]!;
    const last = g.snapshots[g.snapshots.length - 1]!;
    expect(first.status).toBe("not-started");
    expect(first.asOf).toBe("2022-11-26T15:59:00+08:00");
    expect(row(0, "cty:63000").votes).toEqual({ n1: 0, n2: 0 });
    expect(last.status).toBe("final");
    expect(g.snapshots.slice(1, -1).every((s) => s.status === "counting")).toBe(true);
    expect(g.snapshots.map((s) => s.seq)).toEqual(g.snapshots.map((_, i) => i));
  });

  it("ends exactly at the published totals, remainder included", () => {
    const n = g.snapshots.length - 1;
    expect(row(n, "cty:63000")).toMatchObject({ reported: 4, total: 4, votes: { n1: 45, n2: 30 }, summary: { electors: 100, valid: 75, invalid: 5, ballotsCast: 80, population: null } });
    expect(row(n, "town:63000020")).toMatchObject({ reported: 2, total: 2, votes: { n1: 15, n2: 10 } });
    expect(row(n, "town:63000010")).toMatchObject({ reported: 2, total: 2 });
  });

  it("only ever adds votes", () => {
    for (let i = 1; i < g.snapshots.length; i++) {
      for (const r of g.snapshots[i]!.rows) {
        const prev = row(i - 1, r.unit);
        expect(r.reported).toBeGreaterThanOrEqual(prev.reported);
        for (const [k, v] of Object.entries(r.votes)) expect(v).toBeGreaterThanOrEqual(prev.votes[k]!);
      }
    }
  });

  it("is deterministic for a seed", () => {
    expect(buildReplay({ metadata, results }, opts).snapshots).toEqual(g.snapshots);
  });

  it("refuses data whose villages exceed the township total", () => {
    const bad = structuredClone(results);
    bad.town!.rows[0]!.votes.n1 = 1;
    expect(() => buildReplay({ metadata, results: bad }, opts)).toThrow(/exceed published total/);
  });
});

describe("replay feed on disk", () => {
  it("writes snapshots, then play advances latest.json to final", async () => {
    const g = buildReplay({ metadata, results }, opts);
    const dir = mkdtempSync(join(tmpdir(), "live-"));
    const manifest = replayManifest(opts.feedId, "r-test", [{ metadata, results, metadataPath: "groups/x/metadata.json" }], [g], 60);
    expect(manifest.mode).toBe("replay");
    expect(manifest.labelZh).toMatch(/模擬開票.*非即時結果/);
    writeReplayFeed(dir, manifest, [g]);
    expect(readdirSync(join(dir, "groups", g.groupId, "snapshots"))).toHaveLength(g.snapshots.length);

    const waits: number[] = [];
    await playReplayFeed(dir, 60, () => {}, async (ms) => void waits.push(ms));
    const latest = LiveSnapshotFile.parse(JSON.parse(readFileSync(join(dir, livePaths.latest(g.groupId)), "utf8")));
    const m = LiveManifestFile.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(latest.status).toBe("final");
    expect(m.groups[0]).toMatchObject({ status: "final", seq: g.snapshots.length - 1 });
    // 15:59 → 16:03 is four simulated minutes; at speed 60 that is four seconds.
    expect(waits[0]).toBe(4000);
    expect(waits.slice(1, -1).every((w) => w === 3000)).toBe(true);
  });
});
