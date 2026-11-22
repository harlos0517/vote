/**
 * 2024-01-13 第16任總統副總統選舉 — the Phase 1 reference contest.
 * Maps the el* intermediate into schema objects and decides display-level rules
 * (which levels to emit, population 0 → null, ticket labels).
 */
import type {
  BallotChoice,
  Candidacy,
  Contest,
  Party,
  Person,
  ReportingUnit,
  ResultRow,
  ResultsFile,
  ValidationCheck,
} from "@tw-election/schema";
import { type ElDataset, type ElUnit, countyCode, townCode } from "../adapters/cec-el.ts";
import { PUA_RE } from "../lib/csv.ts";

export const ELECTION = {
  id: "2024-01-13-president-legislative",
  date: "2024-01-13",
  nameZh: "2024年 第16任總統副總統及第11屆立法委員選舉",
  kinds: ["president", "legislative"] as const,
};
export const CONTEST_ID = `${ELECTION.id}.president`;
/** Path of this contest's files inside votedata.zip. */
export const ARCHIVE_DIR = "votedata/votedata/voteData/2024總統立委/總統/";

export const EMITTED_LEVELS = ["national", "county", "town"] as const;
type EmittedLevel = (typeof EMITTED_LEVELS)[number];

export const partyId = (code: number) => `cec-${code}`;
export const toParty = (p: { code: number; name: string }): Party => ({
  id: partyId(p.code),
  cecCode: p.code,
  nameZh: p.name,
  isIndependent: p.code === 999,
});

export function unitId(u: ElUnit): string {
  switch (u.level) {
    case "national":
      return "nat";
    case "county":
      return `cty:${countyCode(u.key)}`;
    case "town":
      return `town:${townCode(u.key)}`;
    default:
      throw new Error(`level ${u.level} not emitted in Phase 1`);
  }
}

export interface BuiltContest {
  contest: Contest;
  choices: BallotChoice[];
  candidacies: Candidacy[];
  persons: Person[];
  parties: Party[];
  results: Record<EmittedLevel, ResultsFile>;
  checks: ValidationCheck[];
}

export function buildPresident2024(ds: ElDataset): BuiltContest {
  const checks: ValidationCheck[] = [];
  const numbers = [...new Set(ds.candidates.map((c) => c.ballotNumber))].sort((a, b) => a - b);
  const choiceId = (n: number) => `n${n}`;
  const personId = (n: number, mate: boolean) => `${ELECTION.id}.president.n${n}.${mate ? "vp" : "p"}`;

  const partyByCode = new Map(ds.parties.map((p) => [p.code, p]));
  const persons: Person[] = [];
  const candidacies: Candidacy[] = [];
  for (const c of ds.candidates) {
    const pid = personId(c.ballotNumber, c.isRunningMate);
    persons.push({ id: pid, nameZh: c.name, identity: "single-candidacy" });
    if (!partyByCode.has(c.partyCode)) throw new Error(`unknown party code ${c.partyCode}`);
    candidacies.push({
      id: `${pid}.candidacy`,
      contestId: CONTEST_ID,
      personId: pid,
      role: c.isRunningMate ? "running-mate" : "principal",
      ballotNumber: c.ballotNumber,
      partyId: partyId(c.partyCode),
      gender: c.gender,
      birthYearROC: c.birthYearROC,
      incumbent: c.incumbent,
      // Tickets: elected mark is on the principal row only.
      elected: c.isRunningMate ? null : c.electedMark === "*",
      electedNote: null,
    });
  }

  const choices: BallotChoice[] = numbers.map((n) => {
    const principal = ds.candidates.find((c) => c.ballotNumber === n && !c.isRunningMate);
    const mate = ds.candidates.find((c) => c.ballotNumber === n && c.isRunningMate);
    if (!principal || !mate) throw new Error(`ticket ${n} incomplete`);
    if (principal.partyCode !== mate.partyCode) throw new Error(`ticket ${n} has mixed parties`);
    return {
      id: choiceId(n),
      contestId: CONTEST_ID,
      kind: "ticket",
      ballotNumber: n,
      candidacyIds: [personId(n, false), personId(n, true)].map((p) => `${p}.candidacy`),
      partyId: partyId(principal.partyCode),
      labelZh: `${principal.name}／${mate.name}`,
    };
  });

  // Winner check: the single principal marked "*" must have the most national votes.
  const nat = ds.units.find((u) => u.level === "national")!;
  const top = numbers.reduce((a, b) => ((nat.votes.get(b) ?? 0) > (nat.votes.get(a) ?? 0) ? b : a));
  const marked = ds.candidates.filter((c) => !c.isRunningMate && c.electedMark === "*").map((c) => c.ballotNumber);
  checks.push(
    marked.length === 1 && marked[0] === top
      ? { id: "winner-consistent", status: "pass", detail: `ballot #${top} has most votes and is marked elected` }
      : { id: "winner-consistent", status: "fail", detail: `marked ${marked.join(",")} vs top ${top}` },
  );

  const results = {} as Record<EmittedLevel, ResultsFile>;
  for (const level of EMITTED_LEVELS) {
    const us = ds.units.filter((u) => u.level === level).sort((a, b) => unitId(a).localeCompare(unitId(b)));
    const units: ReportingUnit[] = us.map((u) => ({
      id: unitId(u),
      level,
      nameZh: u.name,
      parentId: level === "town" ? `cty:${countyCode(u.key)}` : level === "county" ? "nat" : null,
      memberVillageCodes: null,
      geo: "exact",
    }));
    const rows: ResultRow[] = us.map((u) => ({
      unit: unitId(u),
      summary: {
        electors: u.electors,
        ballotsCast: u.cast,
        valid: u.valid,
        invalid: u.invalid,
        // CEC writes 0 where population is not reported (below county level).
        population: u.populationRaw === 0 ? null : u.populationRaw,
      },
      votes: numbers.map((n) => u.votes.get(n)!),
    }));
    results[level] = {
      schemaVersion: 1,
      contestId: CONTEST_ID,
      level,
      countyCode: null,
      choiceIds: numbers.map(choiceId),
      units,
      rows,
    };
  }

  const strings = [
    ...choices.map((c) => c.labelZh),
    ...persons.map((p) => p.nameZh),
    ...Object.values(results).flatMap((r) => r.units.map((u) => u.nameZh)),
  ];
  const pua = strings.filter((s) => PUA_RE.test(s) || s === "");
  checks.push(
    pua.length
      ? { id: "no-pua-or-empty-names", status: "fail", detail: `unmapped PUA/empty: ${pua.slice(0, 5).join(", ")}` }
      : { id: "no-pua-or-empty-names", status: "pass", detail: `${strings.length} emitted names are plain Unicode` },
  );

  const usedParties = [...new Set(ds.candidates.map((c) => c.partyCode))].map((code) => toParty(partyByCode.get(code)!));

  const contest: Contest = {
    id: CONTEST_ID,
    electionId: ELECTION.id,
    office: "president",
    cecTypeCode: null,
    nameZh: "第16任總統副總統選舉",
    electorate: "general",
    seats: 1,
    choiceKind: "ticket",
    districtId: null,
    scope: { level: "national" },
    availableLevels: [...EMITTED_LEVELS],
    referendum: null,
    warnings: [
      "村里及投開票所層級資料已取得並通過驗證，但第一版僅發布全國、縣市、鄉鎮市區層級。",
      "人口數僅縣市以上層級有官方數值；以下層級標示為無資料。",
    ],
  };
  return { contest, choices, candidacies, persons, parties: usedParties, results, checks };
}
