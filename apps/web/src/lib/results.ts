import type { ResultsFile, ResultSummary } from "@tw-election/schema";

export interface UnitView {
  id: string;
  code: string; // county / town code used by the boundary features
  name: string;
  parentId: string | null;
  summary: ResultSummary;
  votes: number[];
}

export function toUnitViews(rf: ResultsFile): Map<string, UnitView> {
  const units = new Map(rf.units.map((u) => [u.id, u]));
  const out = new Map<string, UnitView>();
  for (const row of rf.rows) {
    const code = row.unit.includes(":") ? row.unit.slice(row.unit.indexOf(":") + 1) : row.unit;
    out.set(code, {
      id: row.unit,
      code,
      name: units.get(row.unit)?.nameZh ?? row.unit,
      parentId: units.get(row.unit)?.parentId ?? null,
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
