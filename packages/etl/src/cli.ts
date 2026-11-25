#!/usr/bin/env -S npx tsx
/**
 * tw-etl fetch   download + verify pinned raw sources into data/raw
 * tw-etl build   fetch, extract, validate, build boundaries, write data/out/v1/...
 * tw-etl publish [--dry-run]     upload the current local release + manifest to R2
 * tw-etl mirror-raw [--dry-run]  copy pinned raw inputs to the private raw bucket
 * tw-etl live-replay --groups <id,id> [--release r] [--start iso] [--interval min] [--seed n] [--poll s]
 *                    write a simulated live-count feed from published results to data/out/live/
 * tw-etl live-play --feed <feedId> [--speed n]
 * tw-etl live-cec --groups <id,id> --base <url> [--release r] [--levels county,town] [--interval s] [--concurrency n] [--once]
 *                    poll CEC's public count site into data/out/live/cec-<electionId>/ (touch STOP there to end)
 *                    step that feed's latest.json through its snapshots in sped-up real time
 *
 * Paths default to <repo>/data/{raw,work,out}; override with --raw/--work/--out.
 */
import { resolve } from "node:path";
import type { ReportingLevel } from "@tw-election/schema";
import { parseArgs } from "node:util";
import { build, fetchAll } from "./pipeline.ts";
import { mirrorRaw, publishRelease } from "./publish/r2.ts";
import { httpFetcher, runCecPoller } from "./live/cec-public.ts";
import { buildReplay, currentRelease, livePaths, loadReleaseGroup, playReplayFeed, replayManifest, writeReplayFeed } from "./live/replay.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    raw: { type: "string" },
    work: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean" },
    groups: { type: "string" },
    release: { type: "string" },
    start: { type: "string" },
    interval: { type: "string" },
    seed: { type: "string" },
    poll: { type: "string" },
    feed: { type: "string" },
    speed: { type: "string" },
    base: { type: "string" },
    levels: { type: "string" },
    concurrency: { type: "string" },
    once: { type: "boolean" },
  },
});
const repoRoot = resolve(import.meta.dirname, "../../..");
const opts = {
  repoRoot,
  rawDir: resolve(values.raw ?? `${repoRoot}/data/raw`),
  workDir: resolve(values.work ?? `${repoRoot}/data/work`),
  outDir: resolve(values.out ?? `${repoRoot}/data/out`),
};

const cmd = positionals[0];
if (cmd === "fetch") {
  await fetchAll(opts);
  console.log("raw sources verified");
} else if (cmd === "build") {
  const r = await build(opts);
  if (!r.ok) {
    console.error("validation failed — nothing published; see data/out/reports/failed.md");
    process.exit(1);
  }
} else if (cmd === "publish") {
  await publishRelease(opts.outDir, { dryRun: !!values["dry-run"] });
} else if (cmd === "mirror-raw") {
  await mirrorRaw(opts.rawDir, { dryRun: !!values["dry-run"] });
} else if (cmd === "live-replay") {
  const groupIds = (values.groups ?? "").split(",").filter(Boolean);
  if (groupIds.length === 0) throw new Error("--groups is required, e.g. --groups 2022-11-26-local.mayor");
  const release = values.release ?? currentRelease(opts.outDir);
  const inputs = groupIds.map((g) => loadReleaseGroup(opts.outDir, release, g));
  const election = inputs[0]!.metadata.election;
  const feedId = `replay-${election.id}`;
  const interval = Number(values.interval ?? 3);
  const replayOpts = { feedId, start: values.start ?? `${election.date}T16:00:00+08:00`, intervalMinutes: interval, seed: Number(values.seed ?? 1) };
  const groups = inputs.map((i) => buildReplay(i, replayOpts));
  const feedDir = livePaths.feed(opts.outDir, feedId);
  writeReplayFeed(feedDir, replayManifest(feedId, release, inputs, groups, Number(values.poll ?? 60)), groups);
  for (const g of groups) console.log(`${g.groupId}: ${g.snapshots.length} snapshots`);
  console.log(`wrote ${feedDir}`);
} else if (cmd === "live-play") {
  if (!values.feed) throw new Error("--feed is required, e.g. --feed replay-2022-11-26-local");
  await playReplayFeed(livePaths.feed(opts.outDir, values.feed), Number(values.speed ?? 60));
} else if (cmd === "live-cec") {
  const groupIds = (values.groups ?? "").split(",").filter(Boolean);
  if (groupIds.length === 0 || !values.base) throw new Error("--groups and --base are required, e.g. --base https://vote.cec.gov.tw/zh-TW/");
  const release = values.release ?? currentRelease(opts.outDir);
  const plans = groupIds.map((g) => {
    const loaded = loadReleaseGroup(opts.outDir, release, g);
    const levels = values.levels ? (values.levels.split(",") as ReportingLevel[]) : loaded.metadata.group.levels.filter((l) => l !== "village" && l !== "station");
    return { ...loaded, levels };
  });
  const electionIds = new Set(plans.map((p) => p.metadata.election.id));
  if (electionIds.size !== 1) throw new Error("all groups must come from one election");
  const feedId = `cec-${[...electionIds][0]}`;
  const r = await runCecPoller({
    feedDir: livePaths.feed(opts.outDir, feedId),
    feedId,
    release,
    plans,
    fetchPage: httpFetcher(values.base),
    sourceUrl: values.base,
    intervalSeconds: Number(values.interval ?? 120),
    concurrency: Number(values.concurrency ?? 3),
    once: !!values.once,
  });
  console.log(`poller ended: ${r}`);
} else {
  console.error("usage: tw-etl <fetch|build|publish|mirror-raw|live-replay|live-play|live-cec> [--raw dir] [--work dir] [--out dir] [--dry-run]");
  process.exit(2);
}
