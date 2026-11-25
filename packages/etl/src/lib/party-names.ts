import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCecCsv } from "./csv.ts";

export interface PartyName {
  cecCode: number;
  formerName: string;
  reviewed: boolean;
  source: string;
}

/**
 * Load packages/etl/mappings/party-names.csv: current party names (as written in 2026
 * candidate notices) keyed to the CEC party code, for parties whose name in past CEC data
 * differs. The MOI party register number is the CEC party code.
 */
export function loadPartyNames(repoRoot: string): Map<string, PartyName> {
  const rows = parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/party-names.csv"), "utf8"), { header: true });
  const out = new Map<string, PartyName>();
  for (const [name, code, formerName, source, status] of rows) {
    if (!name || !/^\d+$/.test(code ?? "")) throw new Error(`party-names.csv: bad row ${name} ${code}`);
    if (!source) throw new Error(`party-names.csv: ${name} has no source`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`party-names.csv: bad status ${status}`);
    if (out.has(name)) throw new Error(`party-names.csv: ${name} twice`);
    out.set(name, { cecCode: Number(code), formerName: formerName ?? "", reviewed: status === "reviewed", source });
  }
  return out;
}
