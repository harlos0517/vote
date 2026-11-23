import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "./csv.ts";

export interface PartyColor {
  color: string;
  reviewed: boolean;
  source: string;
}

/** Load packages/etl/mappings/party-colors.csv keyed by CEC party code. */
export function loadPartyColors(repoRoot: string): Map<number, PartyColor> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/party-colors.csv"), "utf8"), { header: true });
  const out = new Map<number, PartyColor>();
  for (const [code, , color, source, status] of rows) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color ?? "")) throw new Error(`party-colors.csv: bad colour ${color} for party ${code}`);
    if (!source) throw new Error(`party-colors.csv: party ${code} has no source`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`party-colors.csv: bad status ${status}`);
    out.set(Number(code), { color: color!, reviewed: status === "reviewed", source });
  }
  return out;
}

/** Warn (not fail) while colours shown for this contest are not yet human-reviewed. */
export function checkPartyColors(usedCodes: number[], colors: Map<number, PartyColor>): ValidationCheck {
  const unreviewed = usedCodes.filter((c) => colors.get(c) && !colors.get(c)!.reviewed);
  const missing = usedCodes.filter((c) => c !== 999 && !colors.has(c));
  const parts = [
    unreviewed.length ? `${unreviewed.length} party colours not yet human-reviewed (codes ${unreviewed.join(", ")})` : "",
    missing.length ? `${missing.length} parties have no colour and will show the shared 其他政黨 colour (codes ${missing.join(", ")})` : "",
  ].filter(Boolean);
  return parts.length
    ? { id: "party-colors", status: "warn", detail: parts.join("; ") }
    : { id: "party-colors", status: "pass", detail: "all party colours used here are reviewed" };
}
