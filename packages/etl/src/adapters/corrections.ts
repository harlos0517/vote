/**
 * Reviewed corrections for internal inconsistencies in old CEC files (mappings/data-corrections.csv),
 * applied right after reading, in the file's own codes. Every listed correction must apply (the
 * inconsistency must really be there), or the build fails; everything else stays strict.
 *
 * - village-from-stations <prv|cty|town|vil>: the village's summary row disagrees with its own
 *   stations, which agree with the candidate votes; take the stations' sums.
 * - drop-villages <prv|cty|town>: the township's village rows do not add up to the township row,
 *   which another source confirms; publish the township without village figures.
 * - known-mismatch <prv|cty|town>: the township row and its children disagree and neither can be
 *   shown wrong; keep both as published, warn instead of failing, and note it on the township.
 * - cast-from-valid-invalid <prv|cty|town>: the township row's 投票數 is not valid + invalid
 *   (2010 新竹市: another column's number); set it to valid + invalid.
 * - winner-as-published <prv|cty|town|vil>: CEC's elected marks for this village's contest are not
 *   the top vote-getters (or there is no winner); keep them, warn, and note it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";
import { type ElDataset, type ElUnit, keyString } from "./cec-el.ts";

export interface DataCorrection {
  dir: string;
  action: "village-from-stations" | "drop-villages" | "known-mismatch" | "cast-from-valid-invalid" | "winner-as-published";
  key: string;
  note: string;
  reviewed: boolean;
}

export function loadDataCorrections(repoRoot: string): Map<string, DataCorrection[]> {
  const out = new Map<string, DataCorrection[]>();
  for (const [election, dir, action, key, note, status] of parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/data-corrections.csv"), "utf8"), { header: true, quotedCommas: true })) {
    if (!election || !dir || !key || !note) throw new Error(`data-corrections.csv: bad row ${key}`);
    if (!["village-from-stations", "drop-villages", "known-mismatch", "cast-from-valid-invalid", "winner-as-published"].includes(action ?? "")) throw new Error(`data-corrections.csv: bad action ${action}`);
    if (status !== "reviewed" && status !== "unreviewed") throw new Error(`data-corrections.csv: bad status ${status}`);
    out.set(election, [...(out.get(election) ?? []), { dir, action: action as DataCorrection["action"], key, note, reviewed: status === "reviewed" }]);
  }
  return out;
}

const FIELDS = ["valid", "invalid", "cast", "electors"] as const;
const keyParts = (u: ElUnit) => [u.key.prv, u.key.cty, u.key.town, u.key.vil];

/** Apply the corrections listed for this election and directory; returns a check and the dropped townships' notes. */
export function applyCorrections(
  ds: ElDataset,
  election: string,
  dir: string,
  all: Map<string, DataCorrection[]>,
): { check: ValidationCheck | null; droppedTowns: { key: string; note: string; kind: "drop" | "mismatch" }[]; villageNotes: { key: string; note: string }[] } {
  const mine = (all.get(election) ?? []).filter((c) => dir.endsWith(c.dir));
  if (!mine.length) return { check: null, droppedTowns: [], villageNotes: [] };
  const done: string[] = [];
  const droppedTowns: { key: string; note: string; kind: "drop" | "mismatch" }[] = [];
  const villageNotes: { key: string; note: string }[] = [];
  for (const c of mine) {
    const want = c.key.split("|");
    if (c.action === "village-from-stations") {
      const v = ds.units.find((u) => u.level === "village" && keyParts(u).join("|") === c.key);
      if (!v) throw new Error(`data-corrections ${election} ${c.key}: no such village`);
      const st = ds.units.filter((u) => u.level === "station" && keyString({ ...u.key, station: "0000" }) === keyString(v.key));
      const sum = (f: (typeof FIELDS)[number]) => st.reduce((a, s) => a + s[f], 0);
      if (!st.length || FIELDS.every((f) => sum(f) === v[f])) throw new Error(`data-corrections ${election} ${c.key}: the village already agrees with its stations — remove the row`);
      for (const f of FIELDS) v[f] = sum(f);
      for (const n of [...v.votes.keys()]) v.votes.set(n, st.reduce((a, s) => a + (s.votes.get(n) ?? 0), 0));
      for (const [n, x] of v.votes) v.officialRate.set(n, v.valid ? Math.round((x / v.valid) * 10000) / 100 : 0);
      done.push(`${v.name} (${c.key}) from its ${st.length} stations`);
    } else if (c.action === "cast-from-valid-invalid") {
      const [prv, cty, town] = want as [string, string, string];
      const t = ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town && u.key.dist === "00");
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      if (t.valid + t.invalid === t.cast) throw new Error(`data-corrections ${election} ${c.key}: 投票數 already equals valid + invalid — remove the row`);
      done.push(`${t.name} (${c.key}) 投票數 ${t.cast} → ${t.valid + t.invalid}`);
      t.cast = t.valid + t.invalid;
    } else if (c.action === "winner-as-published") {
      const cs = ds.candidates.filter((x) => [x.key.prv, x.key.cty, x.key.town, x.key.vil].join("|") === c.key);
      if (!cs.length) throw new Error(`data-corrections ${election} ${c.key}: no candidates there`);
      for (const x of cs) x.winnerAsPublished = true;
      villageNotes.push({ key: c.key, note: c.note });
      done.push(`winners of ${c.key} kept as CEC marks them`);
    } else if (c.action === "known-mismatch") {
      const [prv, cty, town] = want as [string, string, string];
      const t = ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town && u.key.dist === "00");
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      ds.knownMismatch = [...(ds.knownMismatch ?? []), t];
      droppedTowns.push({ key: `${prv}|${cty}|${town}`, note: c.note, kind: "mismatch" });
      done.push(`${t.name} (${c.key}) kept as published despite its sums`);
    } else {
      const [prv, cty, town] = want as [string, string, string];
      const t = ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town);
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      const below = ds.units.filter((u) => (u.level === "village" || u.level === "station") && u.key.prv === prv && u.key.cty === cty && u.key.town === town);
      const vs = below.filter((u) => u.level === "village");
      if (FIELDS.every((f) => vs.reduce((a, v) => a + v[f], 0) === t[f])) throw new Error(`data-corrections ${election} ${c.key}: the villages already add up to the township — remove the row`);
      ds.units = ds.units.filter((u) => !below.includes(u));
      droppedTowns.push({ key: `${prv}|${cty}|${town}`, note: c.note, kind: "drop" });
      done.push(`${t.name} (${c.key}) without its ${vs.length} villages`);
    }
  }
  const unreviewed = mine.filter((c) => !c.reviewed).length;
  return {
    check: { id: "data-corrections", status: unreviewed ? "warn" : "pass", detail: `${done.length} corrections of CEC's file applied: ${done.join("; ")}${unreviewed ? ` (${unreviewed} not yet reviewed)` : ""}` },
    droppedTowns,
    villageNotes,
  };
}
