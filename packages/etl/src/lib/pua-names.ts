import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCheck } from "@tw-election/schema";
import type { ElDataset } from "../adapters/cec-el.ts";
import { PUA_RE, parseCecCsv } from "./csv.ts";

/**
 * packages/etl/mappings/pua-names.csv: names containing CEC private-use characters, written
 * with `<U+XXXX>` escapes, and their reviewed replacement. Only whole names are replaced.
 */
export interface PuaName {
  corrected: string;
  source: string;
  reviewed: boolean;
}

const unescape = (s: string) => s.replace(/<U\+([0-9A-F]{4,6})>/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
export const escapePua = (s: string) =>
  [...s].map((ch) => (PUA_RE.test(ch) ? `<U+${ch.codePointAt(0)!.toString(16).toUpperCase()}>` : ch)).join("");

export function loadPuaNames(repoRoot: string): Map<string, PuaName> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/pua-names.csv"), "utf8"), { header: true, quotedCommas: true });
  const out = new Map<string, PuaName>();
  for (const [original, corrected, , source, status] of rows) {
    if (!original || !corrected || PUA_RE.test(corrected)) throw new Error(`pua-names.csv: bad row for ${original}`);
    if (!source) throw new Error(`pua-names.csv: ${original} has no source`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`pua-names.csv: bad status ${status}`);
    out.set(unescape(original), { corrected, source, reviewed: status === "reviewed" });
  }
  return out;
}

/** Replace mapped candidate names in place; unmapped ones are left for the PUA check to fail on. */
export function applyPuaNames(ds: ElDataset, map: Map<string, PuaName>): ValidationCheck {
  const used: { from: string; to: PuaName }[] = [];
  for (const c of ds.candidates) {
    const m = map.get(c.name);
    if (!m) continue;
    used.push({ from: c.name, to: m });
    c.name = m.corrected;
  }
  const unreviewed = used.filter((u) => !u.to.reviewed);
  if (unreviewed.length) {
    return { id: "pua-names", status: "warn", detail: `${unreviewed.length} PUA names replaced by unreviewed readings: ${unreviewed.map((u) => `${escapePua(u.from)} → ${u.to.corrected}`).join(", ")}` };
  }
  return { id: "pua-names", status: "pass", detail: used.length ? `${used.length} PUA names replaced by reviewed readings` : "no PUA names in candidates" };
}
