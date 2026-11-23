/**
 * Contracts for the static files published under v2/ on R2 (v1/ is left untouched so
 * the previous site keeps working during a deploy).
 *
 *   v2/manifest.json                                         (mutable, short cache)
 *   v2/releases/<release>/index.json                         elections → contest groups
 *   v2/releases/<release>/parties.json
 *   v2/releases/<release>/groups/<groupId>/metadata.json
 *   v2/releases/<release>/groups/<groupId>/results/<level>.json
 *   v2/releases/<release>/geography/<boundaryVersion>/<layout>/<level>.geojson
 *
 * A *contest group* is what the UI offers as one map: all contests of one office in one
 * election, e.g. 2024 總統 (1 contest) or 2024 區域立委 (73 single-seat contests).
 * Everything under releases/<release>/ is immutable once published.
 */
import { z } from "zod";
import { ContestId, ElectionId, ReportingUnitId, Slug } from "./ids.ts";
import {
  BallotChoice,
  Candidacy,
  Contest,
  DataSource,
  Election,
  Electorate,
  Office,
  Party,
  Person,
  ReportingLevel,
  ResultSummary,
} from "./model.ts";

export const SCHEMA_VERSION = 2 as const;
export const DATA_PREFIX = `v${SCHEMA_VERSION}` as const;

export const ValidationCheck = z.object({
  id: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});

export const BoundaryRef = z.object({
  versionId: Slug, // e.g. "nlsc-village-1120928"
  sourceId: Slug,
  /** Levels drawn from this boundary version, with release-relative paths. */
  files: z.partialRecord(ReportingLevel, z.string()),
  /** Units whose geometry and results do not line up exactly. */
  notes: z.array(z.object({ unit: z.string(), note: z.string() })),
});

/** Same id shape as a contest: `${electionId}.${local}`. */
export const GroupId = ContestId;

export const ContestGroup = z.object({
  id: GroupId,
  nameZh: z.string(),
  office: Office,
  electorate: Electorate,
  /** Map levels offered, coarse → fine. */
  levels: z.array(ReportingLevel).min(1),
  warnings: z.array(z.string()),
});

export const GroupMetadataFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: Slug,
  election: Election.omit({ contestIds: true }),
  group: ContestGroup,
  contests: z.array(Contest).min(1),
  /** All choices of all contests; ids are unique within the group, each names its contestId. */
  choices: z.array(BallotChoice).min(1),
  candidacies: z.array(Candidacy),
  persons: z.array(Person),
  parties: z.array(Party),
  sources: z.array(DataSource),
  boundary: BoundaryRef,
  /** Release-relative paths per level. */
  results: z.partialRecord(ReportingLevel, z.string()),
  validation: z.array(ValidationCheck),
});

export const GroupUnit = z.object({
  id: ReportingUnitId,
  level: ReportingLevel,
  nameZh: z.string(),
  parentId: ReportingUnitId.nullable(),
  /** Contests with votes in this unit: one for district/town units, several for a county. */
  contestIds: z.array(ContestId).min(1),
});

export const GroupResultRow = z.object({
  unit: ReportingUnitId,
  summary: ResultSummary,
  /** choiceId → votes, for every choice of every contest in the unit. */
  votes: z.record(Slug, z.int().nonnegative()),
});

export const GroupResultsFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  groupId: GroupId,
  level: ReportingLevel,
  units: z.array(GroupUnit),
  rows: z.array(GroupResultRow),
});

export const ReleaseIndexFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: Slug,
  elections: z.array(
    z.object({
      id: ElectionId,
      date: z.iso.date(),
      nameZh: z.string(),
      groups: z.array(z.object({ id: GroupId, nameZh: z.string(), office: Office, levels: z.array(ReportingLevel) })),
    }),
  ),
  /**
   * Year slider per election type (office): slots oldest → newest. Elections within 12 months
   * share a slot; the assignment is a reviewed record (packages/etl/mappings/election-groups.csv).
   */
  timelines: z
    .array(
      z.object({
        office: Office,
        nameZh: z.string(),
        slots: z.array(z.object({ label: z.string(), date: z.iso.date(), groupIds: z.array(GroupId).min(1) })).min(1),
      }),
    )
    .default([]),
});

export const PartiesFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  parties: z.array(Party),
});

export type ValidationCheck = z.infer<typeof ValidationCheck>;
export type BoundaryRef = z.infer<typeof BoundaryRef>;
export type ContestGroup = z.infer<typeof ContestGroup>;
export type GroupMetadataFile = z.infer<typeof GroupMetadataFile>;
export type GroupUnit = z.infer<typeof GroupUnit>;
export type GroupResultRow = z.infer<typeof GroupResultRow>;
export type GroupResultsFile = z.infer<typeof GroupResultsFile>;
export type ReleaseIndexFile = z.infer<typeof ReleaseIndexFile>;
export type PartiesFile = z.infer<typeof PartiesFile>;
