/**
 * Builder for one national referendum case (rf* files) → one contest group with choices
 * 同意 ("agree") and 不同意 ("disagree"). The question text is never in the files; it comes
 * from packages/etl/mappings/referendum-questions.csv with its source and review status.
 */
import type { BallotChoice, Contest, GroupResultsFile, GroupUnit, ReferendumRule, ReportingLevel, ValidationCheck } from "@tw-election/schema";
import { type ElUnit, countyCode, keyString, townCode } from "../adapters/cec-el.ts";
import { AGREE, DISAGREE, type RfDataset } from "../adapters/cec-rf.ts";
import { PUA_RE } from "../lib/csv.ts";
import { checkElDataset } from "../validate/el-checks.ts";
import { type StationInput, stationFiles } from "./stations.ts";
import { type BuiltGroup, type ElGroupDef, groupId, levelsOf, villageUnitId } from "./el-group.ts";

/** 公民投票法第29條: 有效同意票多於不同意票，且有效同意票達投票權人總額四分之一以上。 */
export const REFERENDUM_RULE: ReferendumRule = { agreeMustExceedDisagree: true, agreeQuorumOfElectors: 0.25, quorumStrict: false, legalBasis: "公民投票法第29條" };
/** 憲法增修條文第12條: 經中華民國自由地區選舉人投票複決，有效同意票過選舉人總額之半數，即通過之。 */
export const CONSTITUTIONAL_RULE: ReferendumRule = { agreeMustExceedDisagree: false, agreeQuorumOfElectors: 0.5, quorumStrict: true, legalBasis: "中華民國憲法增修條文第12條" };

export const ruleOf = (d: ElGroupDef): ReferendumRule => (d.office === "constitutional-referendum" ? CONSTITUTIONAL_RULE : REFERENDUM_RULE);

/** The rule applied to counts: agree vs disagree, and agree vs quorum × electors. */
export function rulePasses(rule: ReferendumRule, agree: number, disagree: number, electors: number): boolean {
  const q = (rule.agreeQuorumOfElectors ?? 0) * electors;
  return (!rule.agreeMustExceedDisagree || agree > disagree) && (rule.quorumStrict ? agree > q : agree >= q);
}

export interface ReferendumQuestion {
  text: string;
  source: string;
  reviewed: boolean;
}

export function buildRfGroup(d: ElGroupDef, ds: RfDataset, question: ReferendumQuestion | undefined): BuiltGroup {
  const gid = groupId(d);
  const caseNumber = d.referendumCase!;
  const checks: ValidationCheck[] = checkElDataset(ds, () => [AGREE, DISAGREE]);

  const nat = ds.units.find((u) => u.level === "national")!;
  const agree = nat.votes.get(AGREE)!;
  const disagree = nat.votes.get(DISAGREE)!;
  const rule = ruleOf(d);
  const passed = rulePasses(rule, agree, disagree, nat.electors);
  const pub = ds.nationalPublished;
  const bad = [
    pub.agree !== agree || pub.disagree !== disagree || pub.electors !== nat.electors ? "rftckt national counts differ from rfprof" : "",
    (ds.nationalResult === "Y") !== passed ? `rftckt says ${ds.nationalResult}, rule gives ${passed ? "Y" : "N"}` : "",
  ].filter(Boolean);
  checks.push(
    bad.length
      ? { id: "referendum-outcome", status: "fail", detail: bad.join("; ") }
      : {
          id: "referendum-outcome",
          status: "pass",
          detail: `${passed ? "passed" : "failed"}: 同意 ${agree} vs 不同意 ${disagree}; 同意 is ${((agree / nat.electors) * 100).toFixed(2)}% of ${nat.electors} electors (quorum ${(rule.agreeQuorumOfElectors ?? 0) * 100}%${rule.quorumStrict ? ", strictly more" : ""}; ${rule.legalBasis}); matches rftckt (${ds.nationalResult})`,
        },
  );
  checks.push(
    !question
      ? { id: "referendum-question", status: "warn", detail: `no 主文 recorded for case ${caseNumber}` }
      : question.reviewed
        ? { id: "referendum-question", status: "pass", detail: "主文 reviewed against its source" }
        : { id: "referendum-question", status: "warn", detail: `主文 for case ${caseNumber} not yet reviewed (source: ${question.source})` },
  );

  const contestId = `${d.election.id}.case-${caseNumber}`;
  const choices: BallotChoice[] = [
    { id: "agree", contestId, kind: "agree", ballotNumber: null, candidacyIds: [], partyId: null, labelZh: "同意" },
    { id: "disagree", contestId, kind: "disagree", ballotNumber: null, candidacyIds: [], partyId: null, labelZh: "不同意" },
  ];

  const unitOf = (u: ElUnit): GroupUnit | null => {
    switch (u.level) {
      case "national":
        return { id: "nat", level: "national", nameZh: "全國", parentId: null, contestIds: [contestId] };
      case "county":
        return { id: `cty:${countyCode(u.key)}`, level: "county", nameZh: u.name, parentId: "nat", contestIds: [contestId] };
      case "town":
        return { id: `town:${townCode(u.key)}`, level: "town", nameZh: u.name, parentId: `cty:${countyCode(u.key)}`, contestIds: [contestId] };
      case "village":
        if (!d.villages) return null;
        return { id: villageUnitId(u.key, u.name), level: "village", nameZh: u.name, parentId: `town:${townCode(u.key)}`, contestIds: [contestId] };
      default:
        return null;
    }
  };
  const levels = levelsOf(d);
  const results: Partial<Record<ReportingLevel, GroupResultsFile>> = {};
  for (const level of levels) {
    const rows = ds.units
      .filter((u) => u.level === level)
      .flatMap((u) => {
        const unit = unitOf(u);
        return unit ? [{ u, unit }] : [];
      })
      .sort((a, b) => a.unit.id.localeCompare(b.unit.id));
    results[level] = {
      schemaVersion: 2,
      groupId: gid,
      level,
      units: rows.map((r) => r.unit),
      rows: rows.map(({ u, unit }) => ({
        unit: unit.id,
        summary: { electors: u.electors, ballotsCast: u.cast, valid: u.valid, invalid: u.invalid, population: u.populationRaw === 0 ? null : u.populationRaw },
        votes: { agree: u.votes.get(AGREE)!, disagree: u.votes.get(DISAGREE)! },
      })),
    };
  }

  // Polling stations, each under the village unit it reports in.
  let stations: Record<string, GroupResultsFile> | undefined;
  if (d.villages && results.village) {
    const emitted = new Set(results.village.units.map((u) => u.id));
    const villageRow = new Map(ds.units.filter((u) => u.level === "village").map((u) => [keyString(u.key), u]));
    const rows: StationInput[] = [];
    for (const u of ds.units) {
      if (u.level !== "station") continue;
      const v = villageRow.get(keyString({ ...u.key, station: "0000" }));
      const unit = v ? unitOf(v) : null;
      if (!unit || !emitted.has(unit.id)) continue;
      rows.push({ u, parentId: unit.id, contestIds: [contestId], votes: { agree: u.votes.get(AGREE)!, disagree: u.votes.get(DISAGREE)! } });
    }
    stations = stationFiles(gid, rows);
    checks.push({ id: "stations", status: "pass", detail: `${rows.length} station rows in ${Object.keys(stations).length} counties (sums checked against their villages above)` });
  }

  const names = Object.values(results).flatMap((r) => r!.units.map((u) => u.nameZh));
  const pua = names.filter((s) => PUA_RE.test(s) || s === "");
  checks.push(
    pua.length
      ? { id: "no-pua-or-empty-names", status: "fail", detail: `unmapped PUA/empty: ${pua.slice(0, 5).join(", ")}` }
      : { id: "no-pua-or-empty-names", status: "pass", detail: `${names.length} emitted names are plain Unicode` },
  );

  const contest: Contest = {
    id: contestId,
    electionId: d.election.id,
    office: d.office,
    cecTypeCode: null,
    nameZh: d.nameZh,
    electorate: d.electorate,
    seats: null,
    choiceKind: "referendum",
    districtId: null,
    scope: { level: "national" },
    availableLevels: levels,
    date: null,
    partyList: null,
    referendum: {
      caseNumber,
      questionZh: question?.text ?? null,
      questionSource: question?.source ?? null,
      questionReviewed: question?.reviewed ?? false,
      rule,
      outcome: passed ? "passed" : "failed",
    },
    warnings: [],
  };

  return {
    group: { id: gid, nameZh: d.nameZh, office: d.office, electorate: d.electorate, levels, warnings: [...d.warnings] }, // own copy: the pipeline appends to it
    contests: [contest],
    choices,
    candidacies: [],
    persons: [],
    parties: [],
    results,
    ...(stations ? { stations } : {}),
    townParts: results.town!.units.map((u) => ({ code: u.id.slice(5), town: u.id.slice(5), district: null })),
    checks,
  };
}
