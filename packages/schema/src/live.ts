/**
 * Contracts for live-count (即時開票) feeds, published under live/ on R2 — separate from the
 * immutable v2/ releases, because these files change during counting night.
 *
 *   live/<feedId>/manifest.json                              (mutable, short cache)
 *   live/<feedId>/groups/<groupId>/latest.json               (mutable, short cache)
 *   live/<feedId>/groups/<groupId>/snapshots/<seq>.json      (immutable once written)
 *
 * A snapshot carries only numbers. Choices, units, parties and boundaries come from the
 * static group metadata the manifest points at (a v2 release), so the map code is shared.
 *
 * Every feed states its mode. A "replay" feed re-plays an old, finished election as if it were
 * being counted; it is a simulation of historical data and the UI must say so.
 */
import { z } from "zod";
import { ElectionId, ReportingUnitId, Slug } from "./ids.ts";
import { DataSource, ReportingLevel, ResultSummary } from "./model.ts";
import { GroupId } from "./files.ts";

export const LIVE_SCHEMA_VERSION = 1 as const;
export const LIVE_PREFIX = "live" as const;

export const LiveMode = z.enum([
  "replay", // simulated from a finished election's published results
  "cec-public", // read from CEC's public live-count page
  "manual", // typed in by hand (e.g. from the CEC live stream)
]);

export const LiveStatus = z.enum(["not-started", "counting", "final"]);

/** What `reported`/`total` count. CEC reports polling stations; a replay can only use villages. */
export const ProgressUnit = z.enum(["station", "village"]);

export const LiveRow = z.object({
  unit: ReportingUnitId,
  level: ReportingLevel,
  reported: z.int().nonnegative(),
  total: z.int().positive(),
  /** Sums over the reported part only, so turnout mid-count is NOT the final turnout. */
  summary: ResultSummary,
  /** choiceId → votes so far, for every choice of every contest in the unit. */
  votes: z.record(Slug, z.int().nonnegative()),
  /** Upstream data time of this row, when the source states one per page (CEC 資料時間). */
  asOf: z.iso.datetime({ offset: true }).optional(),
  /** True when this cycle's fetch failed and the row repeats the last good numbers. */
  stale: z.boolean().optional(),
});

export const LiveSnapshotFile = z.object({
  liveSchemaVersion: z.literal(LIVE_SCHEMA_VERSION),
  feedId: Slug,
  groupId: GroupId,
  /** Increases by one per snapshot; readers ignore a snapshot older than the one they show. */
  seq: z.int().nonnegative(),
  status: LiveStatus,
  /** When these numbers were true upstream (for a replay: the simulated clock). */
  asOf: z.iso.datetime({ offset: true }),
  /** When this file was written. */
  generatedAt: z.iso.datetime({ offset: true }),
  progressUnit: ProgressUnit,
  rows: z.array(LiveRow),
});

export const LiveGroupMetadataRef = z.union([
  z.object({ release: Slug, path: z.string() }),
  z.object({ feedPath: z.string(), geographyRelease: Slug }),
]);

export const LiveManifestFile = z.object({
  liveSchemaVersion: z.literal(LIVE_SCHEMA_VERSION),
  feedId: Slug,
  mode: LiveMode,
  /** Shown on the page next to the numbers, e.g. "模擬開票：以 2022 年歷史資料重播". */
  labelZh: z.string(),
  election: z.object({ id: ElectionId, nameZh: z.string(), date: z.iso.date() }),
  source: DataSource.extend({ url: z.url().nullable() }),
  /** How often readers should poll latest.json. */
  pollIntervalSeconds: z.int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
  groups: z.array(
    z.object({
      groupId: GroupId,
      nameZh: z.string(),
      /**
       * Where choices, units and boundaries come from. Either a published group
       * (v2/releases/<release>/<path>), or, for an election with no results yet, metadata the
       * feed carries itself (feed-relative `feedPath`) whose boundary paths resolve against
       * `geographyRelease`.
       */
      metadata: LiveGroupMetadataRef,
      /** Feed-relative path of the latest snapshot. */
      latest: z.string(),
      seq: z.int().nonnegative(),
      status: LiveStatus,
    }),
  ),
});

export type LiveMode = z.infer<typeof LiveMode>;
export type LiveStatus = z.infer<typeof LiveStatus>;
export type ProgressUnit = z.infer<typeof ProgressUnit>;
export type LiveRow = z.infer<typeof LiveRow>;
export type LiveSnapshotFile = z.infer<typeof LiveSnapshotFile>;
export type LiveManifestFile = z.infer<typeof LiveManifestFile>;
export type LiveGroupMetadataRef = z.infer<typeof LiveGroupMetadataRef>;
