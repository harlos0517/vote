/**
 * Normalised data model (Phase 0 draft). Derived from three verified samples:
 *   - 2024 presidential  (CEC voteData/2024總統立委/總統, el*.csv)
 *   - 2022 local         (CEC voteData/2022-111年地方公職人員選舉/{C1,D1,...}, el*.csv)
 *   - 2021 referendum    (CEC 2018_2021公投_2022修憲複決/第１７~２０案, rf*.csv)
 * See docs/phase0-report.md for the field-by-field mapping and known exceptions.
 *
 * Rule: unknown is `null`, never 0. CEC writes 0 for "not provided" in some
 * columns (e.g. population below county level), so the ETL decides per column.
 */
import { z } from "zod";
import {
  ContestId,
  CountyCode,
  ElectionId,
  ReportingUnitId,
  Slug,
  TownCode,
  VillageCode,
} from "./ids.ts";

const Count = z.int().nonnegative();
const NullableCount = Count.nullable();
const IsoDate = z.iso.date();

// ---------------------------------------------------------------- provenance

export const DataSource = z.object({
  id: Slug,
  publisher: z.string(), // e.g. "中央選舉委員會"
  title: z.string(),
  url: z.url(),
  license: z.string(), // e.g. "政府資料開放授權條款-第1版"
  attribution: z.string().optional(),
});

export const SourceFile = z.object({
  sourceId: Slug,
  /** Path inside the downloaded archive, verbatim (may contain CJK / full-width digits). */
  path: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: Count,
  retrievedAt: z.iso.datetime(),
  upstreamLastModified: z.string().nullable(),
});

// ---------------------------------------------------------------- elections

export const ElectionKind = z.enum([
  "president",
  "legislative",
  "local",
  "referendum",
  "by-election",
  "national-assembly",
  "provincial",
]);

export const Election = z.object({
  id: ElectionId,
  date: IsoDate,
  nameZh: z.string(),
  kinds: z.array(ElectionKind).min(1),
  contestIds: z.array(ContestId),
  sources: z.array(SourceFile),
});

/** CEC election-type codes observed in 2022 (選舉種類代碼.xlsx) plus national ones. */
export const Office = z.enum([
  "president", // 總統副總統 (ticket)
  "legislator-district", // 區域立委
  "legislator-lowland-indigenous", // 平地原住民立委
  "legislator-highland-indigenous", // 山地原住民立委
  "legislator-party-list", // 不分區政黨票
  "mayor-or-magistrate", // C1 直轄市長 / 縣(市)長
  "township-mayor", // D1 鄉(鎮、市)長
  "indigenous-district-chief", // D2 直轄市原住民區長
  "councilor-district", // T1 議員(區域)
  "councilor-lowland-indigenous", // T2 議員(平地原住民)
  "councilor-highland-indigenous", // T3 議員(山地原住民)
  "township-rep-district", // R1 鄉鎮市民代表(區域)
  "township-rep-lowland-indigenous", // R2 鄉鎮市民代表(平原)
  "indigenous-district-rep", // R3 直轄市原住民區民代表
  "village-chief", // V1 村里長
  "referendum-national",
  "referendum-local",
  "constitutional-referendum", // 修憲複決
]);

/** Who may vote. Indigenous contests have a different electorate on the same map. */
export const Electorate = z.enum(["general", "lowland-indigenous", "highland-indigenous"]);

export const ReportingLevel = z.enum([
  "national",
  "county",
  "district", // electoral district; NOT necessarily a parent of towns (新竹市 splits 東區/北區)
  "town",
  "village", // includes village groups (vgrp)
  "station",
]);

export const ElectoralDistrict = z.object({
  id: Slug, // e.g. "councilor-63000-d01-2022"
  nameZh: z.string(),
  seats: z.int().positive(),
  countyCode: CountyCode.nullable(),
  /** Components as published by CEC for that election; town may be partial (split). */
  components: z.array(
    z.object({
      townCode: TownCode,
      villageCodes: z.array(VillageCode).nullable(), // null = whole town
    }),
  ),
  validForElections: z.array(ElectionId),
});

export const ReferendumRule = z.object({
  /** 公民投票法 §29 (2019+): agree > disagree AND agree >= quorum × electors. */
  agreeMustExceedDisagree: z.boolean(),
  agreeQuorumOfElectors: z.number().min(0).max(1).nullable(),
  /** true: 同意 must be strictly more than the quorum (修憲複決「過選舉人總額之半數」); false: at least (公投「達…四分之一以上」). */
  quorumStrict: z.boolean().default(false),
  legalBasis: z.string(),
});

export const Contest = z.object({
  id: ContestId,
  electionId: ElectionId,
  office: Office,
  cecTypeCode: z.string().nullable(), // "C1", "T1", ... ; null when CEC has none (2024 national)
  nameZh: z.string(),
  electorate: Electorate,
  seats: z.int().positive().nullable(), // null for referendums
  choiceKind: z.enum(["candidate", "ticket", "party", "referendum"]),
  districtId: Slug.nullable(),
  /** Area the contest covers, for map framing. */
  scope: z.discriminatedUnion("level", [
    z.object({ level: z.literal("national") }),
    z.object({ level: z.literal("county"), code: CountyCode }),
    z.object({ level: z.literal("town"), code: TownCode }),
    z.object({ level: z.literal("village"), code: VillageCode }),
    z.object({ level: z.literal("district"), districtId: Slug }),
  ]),
  availableLevels: z.array(ReportingLevel).min(1),
  /** Set when the contest was held on another day than its election (2022 嘉義市長: 2022-12-18). */
  date: z.iso.date().nullable().default(null),
  /** 不分區政黨票: CEC's published allocation (elretks.csv), verbatim. */
  partyList: z
    .object({
      /** Parties at or above this national vote share (percent) share the seats. */
      thresholdPct: z.number(),
      thresholdBasis: z.string(),
      allocation: z.array(
        z.object({
          partyId: Slug,
          voteSharePct: z.number(), // 得票率 (% of valid votes)
          qualifiedSharePct: z.number().nullable(), // share among parties over the threshold; null below it
          nominated: z.int().nonnegative(), // 登記人數
          seats: z.int().nonnegative(),
        }),
      ),
    })
    .nullable()
    .default(null),
  referendum: z
    .object({
      caseNumber: z.int().positive(),
      questionZh: z.string().nullable(), // must come from 公投公報; null until sourced
      /** Where questionZh was taken from, and whether a person has checked it against the 公報. */
      questionSource: z.string().nullable().default(null),
      questionReviewed: z.boolean().default(false),
      rule: ReferendumRule,
      outcome: z.enum(["passed", "failed"]).nullable(),
    })
    .nullable(),
  warnings: z.array(z.string()),
});

// ---------------------------------------------------------------- people & parties

export const Party = z.object({
  id: Slug, // "cec-16"; CEC party code is stable across elections in samples, verify later
  cecCode: z.int(),
  nameZh: z.string(),
  /** 999 = 無黨籍及未經政黨推薦 — not a party; map it but render differently. */
  isIndependent: z.boolean(),
  /**
   * Display colour from packages/etl/mappings/party-colors.csv; null = none recorded (UI uses
   * neutral grey). Defaults keep releases published before colours existed readable.
   */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().default(null),
  /** True only when that colour row has been human-reviewed. */
  colorReviewed: z.boolean().default(false),
});

export const Person = z.object({
  id: Slug,
  nameZh: z.string(),
  /** How identity across elections was established; names alone are not enough. */
  identity: z.enum(["single-candidacy", "reviewed", "auto-matched-unreviewed"]),
});

export const Candidacy = z.object({
  id: Slug,
  contestId: ContestId,
  personId: Slug,
  role: z.enum(["principal", "running-mate", "list-member"]), // running-mate = 副總統 (elcand 副手=Y); list-member = 不分區名單
  /** Rank on the party list (list-member only). */
  listRank: z.int().positive().nullable().default(null),
  ballotNumber: z.int().positive(),
  partyId: Slug, // affiliation AT REGISTRATION for this contest only
  gender: z.enum(["M", "F"]).nullable(),
  birthYearROC: z.int().nullable(),
  incumbent: z.boolean().nullable(),
  elected: z.boolean().nullable(),
  electedNote: z.enum(["women-quota", "displaced-by-women-quota"]).nullable(),
});

export const BallotChoice = z.object({
  id: Slug, // "n1", "n2"... for candidates (ballot number), "agree"/"disagree", "p-16" for party list
  contestId: ContestId,
  kind: z.enum(["candidate", "ticket", "party", "agree", "disagree"]),
  ballotNumber: z.int().positive().nullable(),
  candidacyIds: z.array(Slug),
  partyId: Slug.nullable(),
  labelZh: z.string(),
});

// ---------------------------------------------------------------- reporting units & results

export const ReportingUnit = z.object({
  id: ReportingUnitId,
  level: ReportingLevel,
  nameZh: z.string(),
  parentId: ReportingUnitId.nullable(),
  /** For vgrp: MOI village codes it covers, resolved by name; null if unresolved. */
  memberVillageCodes: z.array(VillageCode).nullable(),
  /** How this unit joins to the boundary version used for display. */
  geo: z.enum(["exact", "aggregated", "unmatched"]),
});

export const ResultSummary = z.object({
  electors: NullableCount, // 選舉人數 / 投票權人數
  ballotsCast: NullableCount, // 投票數
  valid: NullableCount,
  invalid: NullableCount,
  population: NullableCount, // only where CEC actually reports it
});

/** One row per reporting unit; votes aligned with ResultsFile.choiceIds. */
export const ResultRow = z.object({
  unit: ReportingUnitId,
  summary: ResultSummary,
  votes: z.array(Count),
});

/** Shape of contests/<id>/results/<level>[/<county>].json on R2. */
export const ResultsFile = z.object({
  schemaVersion: z.literal(1),
  contestId: ContestId,
  level: ReportingLevel,
  countyCode: CountyCode.nullable(),
  choiceIds: z.array(Slug).min(1),
  units: z.array(ReportingUnit),
  rows: z.array(ResultRow),
});

// ---------------------------------------------------------------- geography

export const BoundaryVersion = z.object({
  id: Slug, // "nlsc-village-1150817"
  level: z.enum(["county", "town", "village"]),
  effectiveDate: IsoDate.nullable(), // version date in the file name (ROC yyymmdd)
  source: SourceFile,
});

export const GeoMapping = z.object({
  electionId: ElectionId,
  boundaryVersionId: Slug,
  unitId: ReportingUnitId,
  comparability: z.enum(["exact", "aggregated", "estimated", "unavailable"]),
  featureCodes: z.array(z.string()),
  note: z.string().nullable(),
});

// ---------------------------------------------------------------- hand-reviewed mappings

/**
 * One row of a Git-tracked mapping table (PUA chars, village-group members,
 * referendum question text, per-town boundary-version choice, ...).
 * The original value is kept verbatim; nothing is applied silently.
 */
export const ReviewedMapping = z.object({
  table: z.enum(["pua-char", "village-group", "referendum-text", "boundary-version", "person-identity", "other"]),
  scope: z.string(), // e.g. electionId, or "*" when it applies to all
  original: z.string(),
  corrected: z.string(),
  source: z.string().min(1), // citation: file path, bulletin page, URL
  status: z.enum(["unreviewed", "reviewed", "rejected"]),
  note: z.string().nullable(),
});

// ---------------------------------------------------------------- release manifest

export const Manifest = z.object({
  schemaVersion: z.literal(2), // = files.ts SCHEMA_VERSION; lives under v2/
  currentRelease: Slug,
  releases: z.array(
    z.object({
      id: Slug,
      createdAt: z.iso.datetime(),
      etlVersion: z.string(),
      elections: z.array(ElectionId),
      validation: z.enum(["passed", "passed-with-warnings"]),
    }),
  ),
});

export type Office = z.infer<typeof Office>;
export type Electorate = z.infer<typeof Electorate>;
export type DataSource = z.infer<typeof DataSource>;
export type SourceFile = z.infer<typeof SourceFile>;
export type ReportingLevel = z.infer<typeof ReportingLevel>;
export type ReviewedMapping = z.infer<typeof ReviewedMapping>;
export type Election = z.infer<typeof Election>;
export type Contest = z.infer<typeof Contest>;
export type ReferendumRule = z.infer<typeof ReferendumRule>;
export type Party = z.infer<typeof Party>;
export type Person = z.infer<typeof Person>;
export type Candidacy = z.infer<typeof Candidacy>;
export type BallotChoice = z.infer<typeof BallotChoice>;
export type ReportingUnit = z.infer<typeof ReportingUnit>;
export type ResultSummary = z.infer<typeof ResultSummary>;
export type ResultRow = z.infer<typeof ResultRow>;
export type ResultsFile = z.infer<typeof ResultsFile>;
export type Manifest = z.infer<typeof Manifest>;
