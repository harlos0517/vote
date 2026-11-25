/**
 * Replay feed: re-plays a finished election's published results as a simulated live count,
 * so the live pipeline (poller → R2 → UI) can be rehearsed before a real counting night.
 *
 * The finest published level (village) is the reporting unit: each village "reports" once,
 * all at once, at a simulated time. Times are made up (deterministic from a seed). Only
 * the final snapshot is real; it equals the published totals, which `buildReplay` checks.
 * Nothing here predicts anything. A replay must be shown as 模擬／歷史資料.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DATA_PREFIX,
  GroupMetadataFile,
  GroupResultsFile,
  LIVE_PREFIX,
  LIVE_SCHEMA_VERSION,
  LiveManifestFile,
  LiveSnapshotFile,
  Manifest,
  type LiveRow,
  type ReportingLevel,
  type ResultSummary,
} from "@tw-election/schema";

type Summary = Omit<ResultSummary, "population">;
const SUMMARY_KEYS = ["electors", "ballotsCast", "valid", "invalid"] as const;

interface Leaf {
  id: string;
  /** Emitted units this leaf counts toward (itself excluded). */
  ancestors: string[];
  summary: Summary;
  votes: Record<string, number>;
  /** Minutes after counting starts. */
  at: number;
}

export interface ReplayGroupInput {
  metadata: GroupMetadataFile;
  results: Partial<Record<ReportingLevel, GroupResultsFile>>;
}

export interface ReplayOptions {
  feedId: string;
  /** Counting start, e.g. "2022-11-26T16:00:00+08:00". */
  start: string;
  intervalMinutes: number;
  seed: number;
  /** Level whose units report one by one. */
  leafLevel?: ReportingLevel;
  /** Defaults to every published level coarser than the leaf level. */
  emitLevels?: ReportingLevel[];
}

export interface ReplayGroup {
  groupId: string;
  nameZh: string;
  snapshots: LiveSnapshotFile[];
}

// FNV-1a then mulberry32: a stable pseudo-random number in [0, 1) per (seed, key).
function rand(seed: number, key: string): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function addInto(target: Summary, s: Summary) {
  for (const k of SUMMARY_KEYS) {
    if (s[k] === null) continue;
    target[k] = (target[k] ?? 0) + s[k];
  }
}

function emptySummary(): Summary {
  return { electors: null, ballotsCast: null, valid: null, invalid: null };
}

function shiftIso(start: string, minutes: number): string {
  // Keep the input's offset (+08:00) instead of converting to UTC, so files read naturally.
  const m = /([+-]\d{2}):?(\d{2})$/.exec(start);
  if (!m) throw new Error(`start must carry a UTC offset: ${start}`);
  const offsetMin = (m[1]!.startsWith("-") ? -1 : 1) * (Math.abs(Number(m[1])) * 60 + Number(m[2]));
  const local = new Date(Date.parse(start) + minutes * 60_000 + offsetMin * 60_000);
  return local.toISOString().slice(0, 19) + `${m[1]}:${m[2]}`;
}

const LEVEL_ORDER: ReportingLevel[] = ["national", "county", "district", "town", "village", "station"];

export function buildReplay(input: ReplayGroupInput, opts: ReplayOptions): ReplayGroup {
  const { metadata, results } = input;
  const leafLevel = opts.leafLevel ?? "village";
  const leafFile = results[leafLevel];
  if (!leafFile) throw new Error(`${metadata.group.id}: no ${leafLevel} results to replay`);
  const coarser = (l: ReportingLevel) => LEVEL_ORDER.indexOf(l) < LEVEL_ORDER.indexOf(leafLevel);
  const emitLevels = (opts.emitLevels ?? metadata.group.levels.filter(coarser)).filter(coarser);
  if (emitLevels.length === 0) throw new Error(`${metadata.group.id}: nothing coarser than ${leafLevel} to emit`);

  // Parent links across every published level.
  const parent = new Map<string, string | null>();
  for (const f of Object.values(results)) for (const u of f!.units) parent.set(u.id, u.parentId);
  const emitted = new Map<string, { level: ReportingLevel; voteKeys: string[]; summary: Summary }>();
  for (const level of emitLevels) {
    const f = results[level];
    if (!f) throw new Error(`${metadata.group.id}: no ${level} results`);
    for (const r of f.rows) {
      const { population: _p, ...summary } = r.summary;
      emitted.set(r.unit, { level, voteKeys: Object.keys(r.votes), summary });
    }
  }
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    for (let p = parent.get(id) ?? null; p !== null; p = parent.get(p) ?? null) if (emitted.has(p)) out.push(p);
    return out;
  };
  const countyOf = (id: string) => [id, ...ancestorsOf(id)].find((a) => a.startsWith("cty:")) ?? "";

  const leaves: Leaf[] = leafFile.rows.map((r) => {
    const { population: _p, ...summary } = r.summary;
    return { id: r.unit, ancestors: ancestorsOf(r.unit), summary, votes: { ...r.votes }, at: 0 };
  });

  // Where the finer level does not add up to a coarser unit (e.g. votes CEC only reports at
  // township level), the difference reports as one extra chunk so the final totals are exact.
  for (const level of [...emitLevels].reverse()) {
    for (const [unit, e] of emitted) {
      if (e.level !== level) continue;
      const sumVotes: Record<string, number> = {};
      const sum = emptySummary();
      for (const l of leaves) {
        if (!l.ancestors.includes(unit)) continue;
        addInto(sum, l.summary);
        for (const [k, v] of Object.entries(l.votes)) sumVotes[k] = (sumVotes[k] ?? 0) + v;
      }
      const target = results[level]!.rows.find((r) => r.unit === unit)!;
      const dVotes: Record<string, number> = {};
      let differs = false;
      for (const [k, v] of Object.entries(target.votes)) {
        const d = v - (sumVotes[k] ?? 0);
        if (d < 0) throw new Error(`${unit}: ${leafLevel} votes exceed published total for ${k}`);
        if (d > 0) differs = true;
        dVotes[k] = d;
      }
      const dSummary = emptySummary();
      for (const k of SUMMARY_KEYS) {
        if (target.summary[k] === null) continue;
        const d = target.summary[k] - (sum[k] ?? 0);
        if (d < 0) throw new Error(`${unit}: ${leafLevel} ${k} exceeds published total`);
        if (d > 0) differs = true;
        dSummary[k] = d;
      }
      if (differs) leaves.push({ id: `${unit}#remainder`, ancestors: [unit, ...ancestorsOf(unit)], summary: dSummary, votes: dVotes, at: 0 });
    }
  }

  // Simulated report times: bigger units tend to finish later, each county runs a bit early
  // or late, and the rest is noise. Everything reports within about four hours.
  const bySize = [...leaves].sort((a, b) => (a.summary.ballotsCast ?? 0) - (b.summary.ballotsCast ?? 0));
  const sizeRank = new Map(bySize.map((l, i) => [l.id, bySize.length > 1 ? i / (bySize.length - 1) : 0]));
  for (const l of leaves) {
    const county = countyOf(l.id);
    const jitter = -10 + 30 * rand(opts.seed, `county:${county}`);
    l.at = Math.max(1, 15 + 165 * (0.55 * rand(opts.seed, l.id) + 0.45 * sizeRank.get(l.id)!) + jitter);
  }
  leaves.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

  const totals = new Map<string, number>();
  for (const l of leaves) for (const a of l.ancestors) totals.set(a, (totals.get(a) ?? 0) + 1);

  const lastAt = leaves[leaves.length - 1]?.at ?? 0;
  const steps = Math.ceil(lastAt / opts.intervalMinutes);
  const snapshots: LiveSnapshotFile[] = [];
  const acc = new Map<string, { reported: number; summary: Summary; votes: Record<string, number> }>();
  for (const [unit, e] of emitted) acc.set(unit, { reported: 0, summary: emptySummary(), votes: Object.fromEntries(e.voteKeys.map((k) => [k, 0])) });

  let next = 0;
  for (let step = 0; step <= steps + 1; step++) {
    // step 0 is before counting; the last step is the same numbers marked final.
    const minute = step === 0 ? 0 : Math.min(step, steps) * opts.intervalMinutes;
    while (step > 0 && next < leaves.length && leaves[next]!.at <= minute) {
      const l = leaves[next++]!;
      for (const a of l.ancestors) {
        const s = acc.get(a)!;
        s.reported++;
        addInto(s.summary, l.summary);
        for (const [k, v] of Object.entries(l.votes)) s.votes[k] = (s.votes[k] ?? 0) + v;
      }
    }
    const status = step === 0 ? "not-started" : step === steps + 1 ? "final" : "counting";
    const asOf = shiftIso(opts.start, status === "not-started" ? -1 : minute);
    const rows: LiveRow[] = [...emitted].map(([unit, e]) => {
      const s = acc.get(unit)!;
      return { unit, level: e.level, reported: s.reported, total: totals.get(unit) ?? 1, summary: { ...s.summary, population: null }, votes: { ...s.votes } };
    });
    snapshots.push({ liveSchemaVersion: LIVE_SCHEMA_VERSION, feedId: opts.feedId, groupId: metadata.group.id, seq: step, status, asOf, generatedAt: asOf, progressUnit: leafLevel === "station" ? "station" : "village", rows });
  }

  // The last snapshot must equal what CEC published, field by field.
  const final = snapshots[snapshots.length - 1]!;
  for (const r of final.rows) {
    const e = emitted.get(r.unit)!;
    if (r.reported !== r.total) throw new Error(`${r.unit}: ${r.reported}/${r.total} reported at the end`);
    for (const k of SUMMARY_KEYS) if (e.summary[k] !== null && r.summary[k] !== e.summary[k]) throw new Error(`${r.unit}: final ${k} ${r.summary[k]} ≠ published ${e.summary[k]}`);
    const target = results[e.level]!.rows.find((x) => x.unit === r.unit)!;
    for (const [k, v] of Object.entries(target.votes)) if (r.votes[k] !== v) throw new Error(`${r.unit}: final ${k} ${r.votes[k]} ≠ published ${v}`);
  }
  for (const s of snapshots) LiveSnapshotFile.parse(s);
  return { groupId: metadata.group.id, nameZh: metadata.group.nameZh, snapshots };
}

// ---------------------------------------------------------------------------------------
// Files on disk: data/out/live/<feedId>/...

export const livePaths = {
  feed: (outDir: string, feedId: string) => join(outDir, LIVE_PREFIX, feedId),
  manifest: () => "manifest.json",
  latest: (groupId: string) => `groups/${groupId}/latest.json`,
  snapshot: (groupId: string, seq: number) => `groups/${groupId}/snapshots/${String(seq).padStart(4, "0")}.json`,
};

function writeAtomic(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
}

export function loadReleaseGroup(outDir: string, release: string, groupId: string): ReplayGroupInput & { metadataPath: string } {
  const base = join(outDir, DATA_PREFIX, "releases", release);
  const metadataPath = `groups/${groupId}/metadata.json`;
  if (!existsSync(join(base, metadataPath))) throw new Error(`no group ${groupId} in release ${release}`);
  const metadata = GroupMetadataFile.parse(JSON.parse(readFileSync(join(base, metadataPath), "utf8")));
  const results: ReplayGroupInput["results"] = {};
  for (const [level, path] of Object.entries(metadata.results)) {
    results[level as ReportingLevel] = GroupResultsFile.parse(JSON.parse(readFileSync(join(base, path), "utf8")));
  }
  return { metadata, results, metadataPath };
}

export function currentRelease(outDir: string): string {
  return Manifest.parse(JSON.parse(readFileSync(join(outDir, DATA_PREFIX, "manifest.json"), "utf8"))).currentRelease;
}

export function replayManifest(
  feedId: string,
  release: string,
  inputs: (ReplayGroupInput & { metadataPath: string })[],
  groups: ReplayGroup[],
  pollIntervalSeconds: number,
): LiveManifestFile {
  const first = inputs[0]!.metadata;
  for (const i of inputs) if (i.metadata.election.id !== first.election.id) throw new Error("all replayed groups must come from one election");
  const cec = first.sources.find((s) => s.publisher === "中央選舉委員會");
  if (!cec) throw new Error(`${first.group.id}: no CEC source to credit`);
  return LiveManifestFile.parse({
    liveSchemaVersion: LIVE_SCHEMA_VERSION,
    feedId,
    mode: "replay",
    labelZh: `模擬開票：以${first.election.nameZh}（${first.election.date}）歷史資料重播，開票進度為模擬，非即時結果`,
    election: { id: first.election.id, nameZh: first.election.nameZh, date: first.election.date },
    source: cec,
    pollIntervalSeconds,
    updatedAt: groups[0]!.snapshots[0]!.asOf,
    groups: groups.map((g, i) => ({
      groupId: g.groupId,
      nameZh: g.nameZh,
      metadata: { release, path: inputs[i]!.metadataPath },
      latest: livePaths.latest(g.groupId),
      seq: 0,
      status: "not-started",
    })),
  });
}

/** Writes every snapshot, and latest.json at seq 0 (before counting). */
export function writeReplayFeed(feedDir: string, manifest: LiveManifestFile, groups: ReplayGroup[]) {
  for (const g of groups) {
    for (const s of g.snapshots) writeAtomic(join(feedDir, livePaths.snapshot(g.groupId, s.seq)), JSON.stringify(s));
    writeAtomic(join(feedDir, livePaths.latest(g.groupId)), JSON.stringify(g.snapshots[0]));
  }
  writeAtomic(join(feedDir, livePaths.manifest()), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Advances latest.json through the snapshots in (sped-up) real time, the way a poller would
 * update it on counting night. Waits follow the snapshots' own `asOf` clock, so `speed` 60
 * plays three simulated minutes in three seconds.
 * Each latest.json is restamped with the real write time, so a reader sees it as fresh.
 */
export async function playReplayFeed(
  feedDir: string,
  speed: number,
  log: (msg: string) => void = console.log,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const manifest = LiveManifestFile.parse(JSON.parse(readFileSync(join(feedDir, livePaths.manifest()), "utf8")));
  const read = (groupId: string, seq: number) => {
    const p = join(feedDir, livePaths.snapshot(groupId, seq));
    return existsSync(p) ? LiveSnapshotFile.parse(JSON.parse(readFileSync(p, "utf8"))) : null;
  };
  for (let seq = 0; ; seq++) {
    let any = false;
    let asOf = 0;
    const now = new Date().toISOString();
    for (const g of manifest.groups) {
      const s = read(g.groupId, seq);
      if (!s) continue;
      any = true;
      asOf = Math.max(asOf, Date.parse(s.asOf));
      writeAtomic(join(feedDir, g.latest), JSON.stringify({ ...s, generatedAt: now }));
      g.seq = s.seq;
      g.status = s.status;
    }
    if (!any) break;
    manifest.updatedAt = now;
    writeAtomic(join(feedDir, livePaths.manifest()), JSON.stringify(manifest, null, 2) + "\n");
    log(`seq ${seq}: ${manifest.groups.map((g) => `${g.groupId}=${g.status}`).join(", ")}`);
    if (manifest.groups.every((g) => g.status === "final")) break;
    const upcoming = manifest.groups.map((g) => read(g.groupId, seq + 1)).filter((x) => x !== null);
    const nextAsOf = Math.min(...upcoming.map((x) => Date.parse(x.asOf)));
    if (upcoming.length > 0) await sleep(Math.max(0, nextAsOf - asOf) / speed);
  }
}
