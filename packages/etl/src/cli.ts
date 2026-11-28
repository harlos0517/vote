#!/usr/bin/env -S npx tsx
/**
 * tw-etl fetch   download + verify pinned raw sources into data/raw
 * tw-etl build   fetch, extract, validate, build boundaries, write data/out/v1/...
 *   [--only <prefix,…>]  check only the groups whose id starts with a prefix (e.g. 2005,1994-12-03-local); no release
 * tw-etl publish [--dry-run]     upload the current local release + manifest to R2
 * tw-etl mirror-raw [--dry-run]  copy pinned raw inputs to the private raw bucket
 * tw-etl live-replay --groups <id,id> [--release r] [--start iso] [--interval min] [--seed n] [--poll s]
 *                    write a simulated live-count feed from published results to data/out/live/
 * tw-etl live-play --feed <feedId> [--speed n]
 * tw-etl live-cec --groups <id,id> --base <url> [--base <groupId>=<url> ...] [--release r] [--levels county,town] [--interval s] [--concurrency n]
 *                    [--prefix <contestId or groupId>=<code> ...] [--feed id] [--once] [--publish]
 *                    --levels may repeat as <groupId>=<levels> to set one group's levels
 * tw-etl live-publish --feed <feedId> [--watch seconds] [--dry-run]
 *                    upload data/out/live/<feedId>/ to R2 under live/<feedId>/ (changed files only)
 * tw-etl live-prelim --candidates <csv> --from-group <groupId> [--feed id] [--release r] [--levels national,county,town]
 * tw-etl live-prelim --referendum <case> --election <yyyy-mm-dd>-referendum --from-group <referendum groupId> [--feed id]
 *                    put a pre-election group (candidates, no results) into data/out/live/cec-<electionId>/
 *                    poll CEC's public count site into data/out/live/cec-<electionId>/ (touch STOP there to end)
 *                    step that feed's latest.json through its snapshots in sped-up real time
 *
 * Paths default to <repo>/data/{raw,work,out}; override with --raw/--work/--out.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { publishLiveFeed, r2Bucket } from "./publish/live.ts";
import { DATA_PREFIX, PartiesFile, type ReportingLevel } from "@tw-election/schema";
import { parseArgs } from "node:util";
import { build, fetchAll } from "./pipeline.ts";
import { mirrorRaw, publishRelease } from "./publish/r2.ts";
import { httpFetcher, resolvePrefixes, runCecPoller } from "./live/cec-public.ts";
import { announcePrelimGroup, buildPrelimGroup, buildPrelimReferendum, loadFeedGroup, readCandidateCsv, writePrelimGroup } from "./live/prelim.ts";
import { loadReferendumQuestions } from "./lib/referendum-questions.ts";
import { loadPartyNames } from "./lib/party-names.ts";
import { REFERENDUM_RULE } from "./groups/rf-group.ts";
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
    base: { type: "string", multiple: true },
    levels: { type: "string", multiple: true },
    referendum: { type: "string" },
    election: { type: "string" },
    concurrency: { type: "string" },
    once: { type: "boolean" },
    prefix: { type: "string", multiple: true },
    only: { type: "string" },
    candidates: { type: "string" },
    "from-group": { type: "string" },
    publish: { type: "boolean" },
    watch: { type: "string" },
  },
});
const repoRoot = resolve(import.meta.dirname, "../../..");
// R2 credentials may live in <repo>/.env (git-ignored). Variables already set in the shell win.
if (existsSync(`${repoRoot}/.env`)) process.loadEnvFile(`${repoRoot}/.env`);
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
  const only = values.only?.split(",").map((x) => x.trim()).filter(Boolean);
  const r = await build({ ...opts, ...(only?.length ? { only } : {}) });
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
  // --base <url> (every group) and/or --base <groupId>=<url> (one group).
  const baseArgs = values.base ?? [];
  const ownBase = (g: string) => baseArgs.find((b) => b.startsWith(`${g}=`))?.slice(g.length + 1);
  const defaultBases = baseArgs.filter((b) => /^(https?|file):\/\//.test(b));
  for (const b of baseArgs) if (!defaultBases.includes(b) && !groupIds.some((g) => b.startsWith(`${g}=`))) throw new Error(`--base ${b}: not a URL, and not <groupId>=<url> for a group in --groups`);
  if (defaultBases.length > 1) throw new Error(`--base: more than one default URL (${defaultBases.join(", ")})`);
  const defaultBase = defaultBases[0] ?? (groupIds.length > 0 ? ownBase(groupIds[0]!) : undefined);
  if (groupIds.length === 0 || !defaultBase || groupIds.some((g) => !ownBase(g) && !defaultBases[0])) {
    throw new Error("--groups and --base are required, e.g. --base https://vote.cec.gov.tw/2026-local/zh-TW/ (or --base <groupId>=<url> for each group)");
  }
  // --prefix <contestId>=<code> or <groupId>=<code> (every contest of the group).
  const prefixEntries = Object.fromEntries((values.prefix ?? []).map((p) => {
    const [id, code] = p.split("=");
    if (!id || !code) throw new Error(`--prefix expects <contestId or groupId>=<code>, got "${p}"`);
    return [id, code];
  }));
  const release = values.release ?? currentRelease(opts.outDir);
  const electionOf = (g: string) => g.split(".")[0]!;
  // One feed can carry groups of several elections held the same day (--feed).
  const feedId = values.feed ?? `cec-${electionOf(groupIds[0]!)}`;
  const feedDir = livePaths.feed(opts.outDir, feedId);
  // --levels national,county (every group) and/or --levels <groupId>=town (one group).
  const levelArgs = values.levels ?? [];
  const levelsFor = (g: string) => {
    const own = levelArgs.find((l) => l.startsWith(`${g}=`));
    const all = levelArgs.find((l) => !l.includes("="));
    const v = own ? own.slice(g.length + 1) : all;
    return v ? (v.split(",") as ReportingLevel[]) : null;
  };
  for (const l of levelArgs) if (l.includes("=") && !groupIds.includes(l.split("=")[0]!)) throw new Error(`--levels ${l}: ${l.split("=")[0]} is not in --groups`);
  const plans = groupIds.map((g) => {
    // A pre-election group the feed carries (live-prelim) wins over a published one.
    const fromFeed = loadFeedGroup(feedDir, g);
    const loaded = fromFeed ?? (() => {
      const r = loadReleaseGroup(opts.outDir, release, g);
      return { ...r, metadataRef: { release, path: r.metadataPath } };
    })();
    const levels = levelsFor(g) ?? loaded.metadata.group.levels.filter((l) => l !== "village" && l !== "station");
    const prefixes = resolvePrefixes(g, loaded.metadata.contests.map((c) => c.id), prefixEntries);
    const base = ownBase(g);
    return { ...loaded, levels, prefixes, ...(base ? { fetchPage: httpFetcher(base), base } : { base: defaultBase }) };
  });
  // A typo in --prefix would otherwise silently fall back to the contest's own code.
  const known = new Set(plans.flatMap((p) => [p.metadata.group.id, ...p.metadata.contests.map((c) => c.id)]));
  for (const id of Object.keys(prefixEntries)) if (!known.has(id)) throw new Error(`--prefix ${id}=…: no such group or contest in --groups`);
  for (const p of plans) {
    const codes = [...new Set(p.metadata.contests.map((c) => p.prefixes[c.id] ?? c.cecTypeCode ?? "?"))];
    console.log(`${p.metadata.group.id}: levels ${p.levels.join(",")}; pages ${p.base}${codes.join("|")}/…`);
  }
  // Fail before polling if --publish lacks credentials.
  const bucket = values.publish ? r2Bucket() : null;
  const r = await runCecPoller({
    feedDir,
    feedId,
    plans,
    fetchPage: httpFetcher(defaultBase),
    sourceUrl: defaultBase,
    intervalSeconds: Number(values.interval ?? 120),
    concurrency: Number(values.concurrency ?? 3),
    once: !!values.once,
    ...(values.publish ? { afterCycle: async () => void (await publishLiveFeed(feedDir, feedId, { bucket })) } : {}),
  });
  console.log(`poller ended: ${r}`);
} else if (cmd === "live-prelim") {
  if (!values["from-group"] || (!values.candidates && !values.referendum)) {
    throw new Error("--from-group <groupId> and either --candidates <csv> or --referendum <case> are required");
  }
  const release = values.release ?? currentRelease(opts.outDir);
  const base = { ...loadReleaseGroup(opts.outDir, release, values["from-group"]), release };
  const levelsArg = values.levels?.[0];
  const levels = (levelsArg?.split(",") as ReportingLevel[] | undefined) ?? ["national", "county", "town"];
  let g;
  if (values.referendum) {
    // 2026-11-28 referendum case 22: question from mappings/referendum-questions.csv.
    const kase = Number(values.referendum);
    const electionId = values.election ?? "";
    if (!/^\d{4}-\d{2}-\d{2}-referendum$/.test(electionId)) throw new Error("--election <yyyy-mm-dd>-referendum is required with --referendum");
    const q = loadReferendumQuestions(repoRoot).get(`${electionId}#${kase}`);
    if (!q) throw new Error(`no question for ${electionId} case ${kase} in mappings/referendum-questions.csv`);
    const date = electionId.slice(0, 10);
    g = buildPrelimReferendum({ election: { id: electionId, date, nameZh: `${date.slice(0, 4)}年 全國性公民投票` }, caseNumber: kase, question: q, rule: REFERENDUM_RULE, base, levels });
  } else {
    const rows = readCandidateCsv(resolve(values.candidates!));
    const parties = PartiesFile.parse(JSON.parse(readFileSync(`${opts.outDir}/${DATA_PREFIX}/releases/${release}/parties.json`, "utf8"))).parties;
    const electionId = rows[0]!.election;
    const date = electionId.slice(0, 10);
    g = buildPrelimGroup({
      rows,
      election: { id: electionId, date, nameZh: `${date.slice(0, 4)}年 地方公職人員選舉` },
      base,
      parties,
      partyNames: loadPartyNames(repoRoot),
      levels,
      local: base.metadata.group.id.split(".")[1]!,
    });
  }
  const feedId = values.feed ?? `cec-${g.metadata.election.id}`;
  const feedDir = livePaths.feed(opts.outDir, feedId);
  writePrelimGroup(feedDir, g);
  announcePrelimGroup(feedDir, feedId, g);
  console.log(`${g.metadata.group.id}: ${g.metadata.contests.length} contests, ${g.metadata.choices.length} choices -> ${feedDir}`);
  if (g.unknownParties.length) console.log(`parties without a CEC code: ${g.unknownParties.join("、")}`);
} else if (cmd === "live-publish") {
  if (!values.feed) throw new Error("--feed is required, e.g. --feed cec-2026-11-28-local");
  const feedDir = livePaths.feed(opts.outDir, values.feed);
  const bucket = values["dry-run"] ? null : r2Bucket();
  const every = values.watch ? Number(values.watch) : 0;
  if (values.watch && !(every >= 5)) throw new Error("--watch takes seconds, at least 5");
  for (;;) {
    try {
      await publishLiveFeed(feedDir, values.feed, { bucket });
    } catch (e) {
      if (!every) throw e;
      console.error(`upload failed (will retry): ${(e as Error).message}`);
    }
    if (!every) break;
    if (existsSync(`${feedDir}/STOP`)) break;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
} else {
  console.error("usage: tw-etl <fetch|build|publish|mirror-raw|live-replay|live-play|live-cec|live-prelim|live-publish> [--raw dir] [--work dir] [--out dir] [--dry-run]");
  process.exit(2);
}
