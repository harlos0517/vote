/**
 * Contracts for the static files published under v1/ on R2.
 *
 *   v1/manifest.json                                        (mutable, short cache)
 *   v1/releases/<release>/index.json                        elections + contests catalogue
 *   v1/releases/<release>/parties.json
 *   v1/releases/<release>/contests/<contestId>/metadata.json
 *   v1/releases/<release>/contests/<contestId>/results/<level>.json
 *   v1/releases/<release>/geography/<boundaryVersion>/<level>.geojson
 *
 * Everything under releases/<release>/ is immutable once published.
 */
import { z } from "zod";
import { ContestId, ElectionId, Slug } from "./ids.ts";
import {
  BallotChoice,
  Candidacy,
  Contest,
  DataSource,
  Election,
  Party,
  Person,
  ReportingLevel,
} from "./model.ts";

export const SCHEMA_VERSION = 1 as const;

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

export const ContestMetadataFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: Slug,
  election: Election.omit({ contestIds: true }),
  contest: Contest,
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

export const ReleaseIndexFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: Slug,
  elections: z.array(
    z.object({
      id: ElectionId,
      date: z.iso.date(),
      nameZh: z.string(),
      contests: z.array(
        z.object({
          id: ContestId,
          nameZh: z.string(),
          office: Contest.shape.office,
          availableLevels: z.array(ReportingLevel),
        }),
      ),
    }),
  ),
});

export const PartiesFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  parties: z.array(Party),
});

export type ValidationCheck = z.infer<typeof ValidationCheck>;
export type BoundaryRef = z.infer<typeof BoundaryRef>;
export type ContestMetadataFile = z.infer<typeof ContestMetadataFile>;
export type ReleaseIndexFile = z.infer<typeof ReleaseIndexFile>;
export type PartiesFile = z.infer<typeof PartiesFile>;
