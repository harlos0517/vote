import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCecCsv } from "./csv.ts";
import type { ReferendumQuestion } from "../groups/rf-group.ts";

/** packages/etl/mappings/referendum-questions.csv keyed by "<election id>#<case>". */
export function loadReferendumQuestions(repoRoot: string): Map<string, ReferendumQuestion> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/referendum-questions.csv"), "utf8"), { header: true, quotedCommas: true });
  const out = new Map<string, ReferendumQuestion>();
  for (const [election, kase, text, source, status] of rows) {
    if (!election || !/^\d+$/.test(kase ?? "") || !text || !source) throw new Error(`referendum-questions.csv: bad row ${election} ${kase}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`referendum-questions.csv: bad status ${status}`);
    out.set(`${election}#${kase}`, { text, source, reviewed: status === "reviewed" });
  }
  return out;
}
