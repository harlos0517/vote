/**
 * Reviewed corrections for internal inconsistencies in old CEC files (mappings/data-corrections.csv),
 * applied right after reading, in the file's own codes. Every listed correction must apply (the
 * inconsistency must really be there), or the build fails; everything else stays strict.
 *
 * - village-from-stations <prv|cty|town|vil>: the village's summary row disagrees with its own
 *   stations, which agree with the candidate votes; take the stations' sums.
 * - drop-villages <prv|cty|town>: the township's village rows do not add up to the township row,
 *   which another source confirms, or their candidate votes disagree with their own 有效票 (2004
 *   宜蘭縣: stations permuted between elprof and elctks); publish the township without village figures.
 * - known-mismatch <prv|cty|town>: the township row and its children disagree and neither can be
 *   shown wrong; keep both as published, warn instead of failing, and note it on the township.
 * - cast-from-valid-invalid <prv|cty|town>: the township row's 投票數 is not valid + invalid
 *   (2010 新竹市: another column's number); set it to valid + invalid.
 * - winner-as-published <prv|cty|town|vil> (or <prv|cty|dist|town|vil> for a 選區): CEC's elected
 *   marks for this contest are not the top vote-getters (or there is no winner); keep them, warn,
 *   and note it.
 * - town-parts-from-villages <prv|cty>: townships split between 選區 have wrong township rows
 *   (2005 新竹市: elprof one whole-town row, elctks parts that disagree with the 選區); rebuild
 *   each (選區, township) part from its villages, which agree with the 選區 rows.
 * - duplicate-no-code <prv|cty|town|vil>: the file names a second village row in the township like
 *   an earlier one (2005 縣市長: 卓蘭鎮 西坪里 0254 and 0259, where a file of the same year has the
 *   group 西坪里、坪林里); it may be a joint station or another village, so it gets no registry
 *   code (counted in the township, not drawn) and is named "<name>（重複列名）".
 * - towns-from-villages <prv|cty>: the county's township rows in elprof disagree with their own
 *   villages, which agree with elctks (2006 高雄市長); set each township's summary to the sum of
 *   its villages (population unknown).
 * - town-votes-from-villages *: some townships' elctks rows stop before the last candidates
 *   (2005 區域議員: 宜蘭市 has #1–8 of 12), or end with one row holding the sum of the rest
 *   (安樂區: "#17" = Σ #12–17); take those from the sum of the township's villages. The other
 *   listed candidates must equal their village sums, or the build fails.
 * - stations-votes-only <prv|cty>: the county's polling-station rows in elprof disagree with their
 *   own candidate votes, which add up to the villages (2006 高雄市長); keep the votes and drop the
 *   stations' summaries (valid = Σ votes, the rest unknown).
 * - district-votes-from-towns <prv|cty|dist> (or <prv|cty> for a county row): the row's candidate
 *   votes do not add up (or a candidate has fewer votes than in some of its townships), while the
 *   townships agree with the row's 有效票; set the row's votes to the townships' sums.
 * - winners-from-ctks *: elcand's elected marks disagree with the votes (2005 原住民議員), while
 *   elctks marks the top vote-getters on each contest's own row; take the marks from elctks.
 * - ctks-towns-by-name <reference dir>: elctks numbers the townships as the reference directory's
 *   elbase does (2005 平原/山原 議員: the 區域 file's 選區 order), elbase and elprof in the usual
 *   order; move each township's candidate votes to the township of the same name. Only for files
 *   whose elctks stops at township level; every moved township's votes must then sum to its
 *   elprof 有效票, or the build fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCheck } from "@tw-election/schema";
import { parseCecCsv } from "../lib/csv.ts";
import { type ElDataset, type ElUnit, keyString } from "./cec-el.ts";

export interface DataCorrection {
  dir: string;
  action: "village-from-stations" | "drop-villages" | "known-mismatch" | "cast-from-valid-invalid" | "winner-as-published" | "duplicate-no-code" | "ctks-towns-by-name" | "towns-from-villages" | "town-votes-from-villages" | "stations-votes-only" | "town-parts-from-villages" | "winners-from-ctks" | "district-votes-from-towns";
  key: string;
  note: string;
  reviewed: boolean;
}

export function loadDataCorrections(repoRoot: string): Map<string, DataCorrection[]> {
  const out = new Map<string, DataCorrection[]>();
  for (const [election, dir, action, key, note, status] of parseCecCsv(readFileSync(join(repoRoot, "packages/etl/mappings/data-corrections.csv"), "utf8"), { header: true, quotedCommas: true })) {
    if (!election || !dir || !key || !note) throw new Error(`data-corrections.csv: bad row ${key}`);
    if (!["village-from-stations", "drop-villages", "known-mismatch", "cast-from-valid-invalid", "winner-as-published", "duplicate-no-code", "ctks-towns-by-name", "towns-from-villages", "town-votes-from-villages", "stations-votes-only", "town-parts-from-villages", "winners-from-ctks", "district-votes-from-towns"].includes(action ?? "")) throw new Error(`data-corrections.csv: bad action ${action}`);
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
  /** Reads another directory of the archive (for ctks-towns-by-name). */
  readOther: (dir: string) => ElDataset = () => { throw new Error("no reader"); },
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
    } else if (c.action === "duplicate-no-code") {
      const [prv, cty, town, vil] = want as [string, string, string, string];
      const b = ds.units.find((u) => u.level === "village" && keyParts(u).join("|") === c.key);
      if (!b) throw new Error(`data-corrections ${election} ${c.key}: no such village`);
      const first = ds.units.find((u) => u.level === "village" && u !== b && u.key.prv === prv && u.key.cty === cty && u.key.town === town && u.key.vil < vil && u.name === b.name);
      if (!first) throw new Error(`data-corrections ${election} ${c.key}: ${b.name} is not a repeated name — remove the row`);
      const name = b.name;
      for (const u of ds.units.filter((x) => (x.level === "village" || x.level === "station") && keyParts(x).join("|") === c.key)) { u.noVillageCode = true; u.name = `${name}（重複列名）`; }
      villageNotes.push({ key: c.key, note: c.note });
      done.push(`${name} ${vil} (repeats ${first.key.vil}) without a village code`);
    } else if (c.action === "town-parts-from-villages") {
      const [prv, cty] = want as [string, string];
      const inCounty = (u: ElUnit) => u.key.prv === prv && u.key.cty === cty;
      const vs = ds.units.filter((u) => u.level === "village" && inCounty(u));
      if (!vs.length || vs.some((v) => v.partial)) throw new Error(`data-corrections ${election} ${c.key}: needs full village rows`);
      const old = ds.units.filter((u) => u.level === "town" && inCounty(u));
      const nameOf = new Map(old.map((u) => [u.key.town, u.name]));
      const parts = new Map<string, ElUnit[]>();
      for (const v of vs) parts.set(`${v.key.dist}|${v.key.town}`, [...(parts.get(`${v.key.dist}|${v.key.town}`) ?? []), v]);
      const built: ElUnit[] = [...parts].map(([k, us]) => {
        const [dist, town] = k.split("|") as [string, string];
        const votes = new Map<number, number>();
        for (const v of us) for (const [n, x] of v.votes) votes.set(n, (votes.get(n) ?? 0) + x);
        const valid = us.reduce((a, v) => a + v.valid, 0);
        return {
          key: { prv, cty, dist, town, vil: "0000", station: "0000" }, level: "town", name: nameOf.get(town) ?? "",
          valid, invalid: us.reduce((a, v) => a + v.invalid, 0), cast: us.reduce((a, v) => a + v.cast, 0), electors: us.reduce((a, v) => a + v.electors, 0),
          populationRaw: 0, votes, officialRate: new Map([...votes].map(([n, x]) => [n, valid ? Math.round((x / valid) * 10000) / 100 : 0])),
        };
      });
      ds.units = [...ds.units.filter((u) => !old.includes(u)), ...built];
      done.push(`${c.key}: ${old.length} township rows replaced by ${built.length} (選區, township) parts from their villages`);
    } else if (c.action === "stations-votes-only") {
      const [prv, cty] = want as [string, string];
      const st = ds.units.filter((u) => u.level === "station" && u.key.prv === prv && u.key.cty === cty);
      const bad = st.filter((u) => [...u.votes.values()].reduce((a, b) => a + b, 0) !== u.valid);
      if (!bad.length) throw new Error(`data-corrections ${election} ${c.key}: the stations agree with their votes — remove the row`);
      for (const u of st) {
        u.partial = true;
        u.valid = [...u.votes.values()].reduce((a, b) => a + b, 0);
        u.invalid = 0; u.cast = 0; u.electors = 0; u.populationRaw = 0;
        u.officialRate = new Map([...u.votes].map(([n, v]) => [n, u.valid ? Math.round((v / u.valid) * 10000) / 100 : 0]));
      }
      done.push(`${st.length} stations of ${c.key} with votes only (${bad.length} summaries disagreed)`);
    } else if (c.action === "town-votes-from-villages") {
      const ballots = new Map<string, number[]>(); // contest key (county|dist) → ballot numbers
      for (const x of ds.candidates) {
        const k = `${x.key.prv}${x.key.cty}|${x.key.dist}`;
        ballots.set(k, [...(ballots.get(k) ?? []), x.ballotNumber]);
      }
      const filled: string[] = [];
      for (const t of ds.units.filter((u) => u.level === "town")) {
        const want = ballots.get(`${t.key.prv}${t.key.cty}|${t.key.dist}`) ?? ballots.get(`${t.key.prv}${t.key.cty}|00`) ?? [];
        const missing = want.filter((n) => !t.votes.has(n));
        if (!missing.length || !t.votes.size) continue;
        const vs = ds.units.filter((u) => u.level === "village" && u.key.prv === t.key.prv && u.key.cty === t.key.cty && u.key.dist === t.key.dist && u.key.town === t.key.town);
        const sum = (n: number) => vs.reduce((a, v) => a + (v.votes.get(n) ?? 0), 0);
        if (!vs.length) throw new Error(`data-corrections ${election} ${c.key}: ${t.name} lacks candidates and has no villages`);
        // Either the listed rows are right and the rest is cut off (宜蘭市), or the last listed row
        // holds the sum of itself and the cut-off ones (安樂區: "#17" = Σ #12–17).
        const off = [...t.votes].filter(([n, v]) => sum(n) !== v);
        const last = Math.max(...t.votes.keys());
        const tail = off.length === 1 && off[0]![0] === last && off[0]![1] === sum(last) + missing.reduce((a, n) => a + sum(n), 0);
        if (off.length && !tail) throw new Error(`data-corrections ${election} ${c.key}: ${t.name} #${off[0]![0]} ${off[0]![1]} ≠ its villages ${sum(off[0]![0])}`);
        for (const n of [...missing, ...(tail ? [last] : [])]) { t.votes.set(n, sum(n)); t.officialRate.set(n, t.valid ? Math.round((sum(n) / t.valid) * 10000) / 100 : 0); }
        filled.push(`${t.name} #${missing.join(",")}`);
      }
      if (!filled.length) throw new Error(`data-corrections ${election} ${c.key}: no township lacks candidate rows — remove the row`);
      done.push(`missing elctks rows filled from villages: ${filled.join("; ")}`);
    } else if (c.action === "towns-from-villages") {
      const [prv, cty] = want as [string, string];
      const towns = ds.units.filter((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty);
      let fixed = 0;
      for (const t of towns) {
        const vs = ds.units.filter((u) => u.level === "village" && u.key.prv === prv && u.key.cty === cty && u.key.dist === t.key.dist && u.key.town === t.key.town);
        if (!vs.length || vs.some((v) => v.partial)) throw new Error(`data-corrections ${election} ${c.key}: ${t.name} has no full village rows`);
        if (FIELDS.every((f) => vs.reduce((a, v) => a + v[f], 0) === t[f])) continue;
        for (const f of FIELDS) t[f] = vs.reduce((a, v) => a + v[f], 0);
        t.populationRaw = 0;
        fixed++;
      }
      if (!fixed) throw new Error(`data-corrections ${election} ${c.key}: the townships already agree with their villages — remove the row`);
      done.push(`${fixed} of ${towns.length} townships of ${c.key} from their villages`);
    } else if (c.action === "district-votes-from-towns") {
      // <prv|cty|dist>: a 選區 row; <prv|cty>: the county row (nationwide contests).
      const [prv, cty, dist] = want as [string, string, string | undefined];
      const d = ds.units.find((u) => u.level === (dist ? "district" : "county") && u.key.prv === prv && u.key.cty === cty && (!dist || u.key.dist === dist));
      if (!d) throw new Error(`data-corrections ${election} ${c.key}: no such 選區 or county`);
      const ts = ds.units.filter((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && (!dist || u.key.dist === dist));
      const sums = new Map<number, number>();
      for (const t of ts) for (const [n, v] of t.votes) sums.set(n, (sums.get(n) ?? 0) + v);
      const diff = [...sums].filter(([n, v]) => d.votes.get(n) !== v);
      if (!diff.length) throw new Error(`data-corrections ${election} ${c.key}: the row already adds up — remove the row`);
      if ([...sums.values()].reduce((a, b) => a + b, 0) !== d.valid) throw new Error(`data-corrections ${election} ${c.key}: the townships' votes do not sum to the row's 有效票`);
      for (const [n, v] of sums) { d.votes.set(n, v); d.officialRate.set(n, d.valid ? Math.round((v / d.valid) * 10000) / 100 : 0); }
      done.push(`${d.name} votes of #${diff.map(([n]) => n).join(",")} from its townships`);
    } else if (c.action === "winners-from-ctks") {
      let changed = 0;
      for (const x of ds.candidates) {
        const row = ds.units.find((u) => u.key.prv === x.key.prv && u.key.cty === x.key.cty && u.key.dist === x.key.dist && u.key.town === x.key.town && u.key.vil === x.key.vil && u.key.station === "0000");
        if (!row?.votes.has(x.ballotNumber)) continue; // no elctks rows at all for this contest (2005 屏東縣山地第16選區)
        const mark = row.ctksMarks?.get(x.ballotNumber) ?? "";
        if (mark !== x.electedMark) { x.electedMark = mark; changed++; }
      }
      if (!changed) throw new Error(`data-corrections ${election} ${c.key}: elcand already agrees with elctks — remove the row`);
      done.push(`elected marks of ${changed} candidates taken from elctks`);
    } else if (c.action === "ctks-towns-by-name") {
      const ref = readOther(c.key);
      const refName = new Map(ref.units.filter((u) => u.level === "town").map((u) => [`${u.key.prv}${u.key.cty}|${u.key.town}`, u.name]));
      const towns = ds.units.filter((u) => u.level === "town");
      if (ds.units.some((u) => (u.level === "village" || u.level === "station") && u.votes.size)) throw new Error(`data-corrections ${election} ${c.key}: elctks has village rows — not supported`);
      // A township is in one 選區 of these files; match by county and name.
      const byName = new Map<string, ElUnit[]>();
      for (const u of towns) byName.set(`${u.key.prv}${u.key.cty}|${u.name}`, [...(byName.get(`${u.key.prv}${u.key.cty}|${u.name}`) ?? []), u]);
      if ([...byName.values()].some((us) => us.length > 1)) throw new Error(`data-corrections ${election} ${c.key}: a township is in two 選區`);
      const sumOk = (t: ElUnit, votes: Map<number, number>) => !votes.size || [...votes.values()].reduce((a, b) => a + b, 0) === t.valid;
      // Per county: keep elctks as it is when its townships already add up, else renumber through the reference.
      let changed = 0;
      const counties = [...new Set(towns.map((u) => u.key.prv + u.key.cty))];
      for (const cc of counties) {
        const mine = towns.filter((u) => u.key.prv + u.key.cty === cc);
        if (mine.every((t) => sumOk(t, t.votes))) continue;
        const moved = mine.map((u) => {
          const name = refName.get(`${cc}|${u.key.town}`);
          const to = name ? byName.get(`${cc}|${name}`)?.[0] : undefined;
          if (!to) throw new Error(`data-corrections ${election} ${c.key}: no township for elctks ${keyParts(u).join("|")} (${name ?? "not in the reference"})`);
          return { from: u, to, votes: u.votes, rate: u.officialRate };
        });
        const after = new Map<ElUnit, Map<number, number>>(mine.map((t) => [t, new Map()]));
        for (const m of moved) for (const [n, v] of m.votes) after.get(m.to)!.set(n, v);
        const off = mine.filter((t) => !sumOk(t, after.get(t)!));
        if (off.length) throw new Error(`data-corrections ${election} ${c.key}: county ${cc} adds up neither as it is nor renumbered (e.g. ${off[0]!.name})`);
        const rates = new Map<ElUnit, Map<number, number>>(mine.map((t) => [t, new Map()]));
        for (const m of moved) for (const [n, v] of m.rate) rates.get(m.to)!.set(n, v);
        for (const t of mine) { t.votes = after.get(t)!; t.officialRate = rates.get(t)!; }
        changed += moved.filter((m) => m.to !== m.from).length;
      }
      if (!changed) throw new Error(`data-corrections ${election} ${c.key}: elctks already uses the usual numbering — remove the row`);
      done.push(`elctks townships renumbered by name through ${c.key} (${changed} of ${towns.length} townships moved)`);
    } else if (c.action === "cast-from-valid-invalid") {
      const [prv, cty, town] = want as [string, string, string];
      const t = ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town && u.key.dist === "00");
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      if (t.valid + t.invalid === t.cast) throw new Error(`data-corrections ${election} ${c.key}: 投票數 already equals valid + invalid — remove the row`);
      done.push(`${t.name} (${c.key}) 投票數 ${t.cast} → ${t.valid + t.invalid}`);
      t.cast = t.valid + t.invalid;
    } else if (c.action === "winner-as-published") {
      const cs = ds.candidates.filter((x) => (want.length === 5 ? [x.key.prv, x.key.cty, x.key.dist, x.key.town, x.key.vil] : [x.key.prv, x.key.cty, x.key.town, x.key.vil]).join("|") === c.key);
      if (!cs.length) throw new Error(`data-corrections ${election} ${c.key}: no candidates there`);
      for (const x of cs) x.winnerAsPublished = true;
      if (want.length === 4) villageNotes.push({ key: c.key, note: c.note });
      done.push(`winners of ${c.key} kept as CEC marks them`);
    } else if (c.action === "known-mismatch") {
      const [prv, cty, town] = want as [string, string, string | undefined];
      // <prv|cty>: the county row itself.
      const t = town === undefined
        ? ds.units.find((u) => u.level === "county" && u.key.prv === prv && u.key.cty === cty)
        : ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town && u.key.dist === "00");
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      ds.knownMismatch = [...(ds.knownMismatch ?? []), t];
      if (town !== undefined) droppedTowns.push({ key: `${prv}|${cty}|${town}`, note: c.note, kind: "mismatch" });
      done.push(`${t.name} (${c.key}) kept as published despite its sums`);
    } else if (c.action === "drop-villages") {
      const [prv, cty, town] = want as [string, string, string];
      const t = ds.units.find((u) => u.level === "town" && u.key.prv === prv && u.key.cty === cty && u.key.town === town);
      if (!t) throw new Error(`data-corrections ${election} ${c.key}: no such township`);
      const below = ds.units.filter((u) => (u.level === "village" || u.level === "station") && u.key.prv === prv && u.key.cty === cty && u.key.town === town);
      const vs = below.filter((u) => u.level === "village");
      const votesOff = below.some((u) => u.votes.size && [...u.votes.values()].reduce((a, b) => a + b, 0) !== u.valid);
      if (!votesOff && FIELDS.every((f) => vs.reduce((a, v) => a + v[f], 0) === t[f])) throw new Error(`data-corrections ${election} ${c.key}: the villages already add up to the township and their votes to their 有效票 — remove the row`);
      ds.units = ds.units.filter((u) => !below.includes(u));
      droppedTowns.push({ key: `${prv}|${cty}|${town}`, note: c.note, kind: "drop" });
      done.push(`${t.name} (${c.key}) without its ${vs.length} villages`);
    } else {
      throw new Error(`data-corrections ${election} ${c.key}: unhandled action ${c.action}`);
    }
  }
  const unreviewed = mine.filter((c) => !c.reviewed).length;
  return {
    check: { id: "data-corrections", status: unreviewed ? "warn" : "pass", detail: `${done.length} corrections of CEC's file applied: ${done.join("; ")}${unreviewed ? ` (${unreviewed} not yet reviewed)` : ""}` },
    droppedTowns,
    villageNotes,
  };
}
