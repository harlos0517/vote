import type { GroupResultsFile, ResultSummary } from "@tw-election/schema";

export interface UnitView {
  id: string;
  code: string; // boundary feature code: county "63000", district "63000-07", town "63000010" / part "63000010-07"
  name: string;
  parentId: string | null;
  contestIds: string[];
  summary: ResultSummary;
  /** choiceId → votes, for every choice of every contest in the unit */
  votes: Record<string, number>;
}

export const codeOf = (unitId: string) => (unitId.includes(":") ? unitId.slice(unitId.indexOf(":") + 1) : unitId);

export function toUnitViews(rf: GroupResultsFile): Map<string, UnitView> {
  const units = new Map(rf.units.map((u) => [u.id, u]));
  const out = new Map<string, UnitView>();
  for (const row of rf.rows) {
    const u = units.get(row.unit);
    const code = codeOf(row.unit);
    out.set(code, {
      id: row.unit,
      code,
      name: u?.nameZh ?? row.unit,
      parentId: u?.parentId ?? null,
      contestIds: u?.contestIds ?? [],
      summary: row.summary,
      votes: row.votes,
    });
  }
  return out;
}

export const turnout = (s: ResultSummary) =>
  s.ballotsCast !== null && s.electors ? s.ballotsCast / s.electors : null;

const nf = new Intl.NumberFormat("zh-TW");
export const fmtInt = (n: number | null) => (n === null ? "無資料" : nf.format(n));
export const fmtPct = (x: number | null, digits = 2) => (x === null ? "無資料" : `${(x * 100).toFixed(digits)}%`);
