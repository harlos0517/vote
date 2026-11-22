import type { ResultsFile, ResultSummary } from "@tw-election/schema";

export interface UnitView {
  id: string;
  code: string; // county / town code used by the boundary features
  name: string;
  summary: ResultSummary;
  votes: number[];
  /** votes ÷ valid ballots; null when valid is unknown or zero */
  shares: (number | null)[];
  /** index of the leading choice; null on a tie or no votes */
  leader: number | null;
}

export function toUnitViews(rf: ResultsFile): Map<string, UnitView> {
  const names = new Map(rf.units.map((u) => [u.id, u.nameZh]));
  const out = new Map<string, UnitView>();
  for (const row of rf.rows) {
    const valid = row.summary.valid;
    const shares = row.votes.map((v) => (valid ? v / valid : null));
    const max = Math.max(...row.votes);
    const leaders = row.votes.flatMap((v, i) => (v === max ? [i] : []));
    const code = row.unit.includes(":") ? row.unit.slice(row.unit.indexOf(":") + 1) : row.unit;
    out.set(code, {
      id: row.unit,
      code,
      name: names.get(row.unit) ?? row.unit,
      summary: row.summary,
      votes: row.votes,
      shares,
      leader: max > 0 && leaders.length === 1 ? leaders[0]! : null,
    });
  }
  return out;
}

export const turnout = (s: ResultSummary) =>
  s.ballotsCast !== null && s.electors ? s.ballotsCast / s.electors : null;

const nf = new Intl.NumberFormat("zh-TW");
export const fmtInt = (n: number | null) => (n === null ? "無資料" : nf.format(n));
export const fmtPct = (x: number | null, digits = 2) => (x === null ? "無資料" : `${(x * 100).toFixed(digits)}%`);
