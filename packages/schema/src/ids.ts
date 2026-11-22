/**
 * ID conventions (Phase 0 draft).
 *
 * Administrative codes follow the MOI 戶役政 coding that CEC adopted from 2016
 * and that NLSC boundary files also use, so they join without name matching:
 *   county  = prv(2) + cty(3)            e.g. "63000" (臺北市), "10002" (宜蘭縣)
 *   town    = county + town(3)           e.g. "63000010" (松山區)   == NLSC TOWNCODE
 *   village = town + village(3)          e.g. "63000010002" (莊敬里) == NLSC VILLCODE
 * CEC writes the village part as 4 chars ("0002"); the leading "0" is dropped.
 *
 * These codes identify an area *as of a given boundary version*; a code can be
 * reused or retired after redistricting, so cross-election joins must go
 * through GeoMapping rather than assuming code equality means the same polygon.
 */
import { z } from "zod";

export const CountyCode = z.string().regex(/^\d{5}$/);
export const TownCode = z.string().regex(/^\d{8}$/);
export const VillageCode = z.string().regex(/^\d{11}$/);

/** Lowercase slug, used for election / contest / party / person ids. */
export const Slug = z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/);

/** e.g. "2024-01-13-president-legislative", "2022-11-26-local", "2021-12-18-referendum" */
export const ElectionId = z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);

/**
 * `${electionId}.${local}` — local part is derived from the CEC election-type
 * code plus the area scope, e.g.
 *   2024-01-13-president-legislative.president
 *   2022-11-26-local.c1-63000           (臺北市長)
 *   2022-11-26-local.t1-63000-d01       (臺北市議員第01選區)
 *   2022-11-26-local.v1-63000010002     (莊敬里長)
 *   2021-12-18-referendum.ref17
 */
export const ContestId = z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.[a-z0-9-]+$/);

/**
 * Reporting-unit ids are *contest-scoped* strings with a level prefix:
 *   nat                      national total of a nationwide contest
 *   cty:63000                county
 *   dist:63000-01            electoral district (district codes are per county)
 *   town:63000010            township / district (鄉鎮市區)
 *   vil:63000010002          village that maps 1:1 to an MOI village code
 *   vgrp:09007010-0A01       CEC-defined group of villages sharing stations
 *   st:63000-0597            polling station; number is unique within a county
 *                            in all three samples, but NOT stable across elections
 *   st:09007-0003@09007010002  station slice (V1 village-chief contests split one
 *                            shared station by village)
 */
export const ReportingUnitId = z
  .string()
  .regex(
    /^(nat|cty:\d{5}|dist:\d{5}-\d{2}|town:\d{8}|vil:\d{11}|vgrp:\d{8}-[0-9A-Z]{4}|st:\d{5}-\d{4}(@\d{11})?)$/,
  );
