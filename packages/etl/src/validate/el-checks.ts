/**
 * Numeric checks for an el* dataset holding one or more contests (e.g. 73 district races).
 *
 * Hierarchy (parent of each row): station → village → town → district (if the file has
 * district rows) else county → national. Every parent must equal the sum of its children
 * on every summary field, and on every candidate where the parent row carries candidate
 * votes (CEC publishes none above district level for multi-contest files).
 */
import type { ValidationCheck } from "@tw-election/schema";
import { type ElDataset, type ElKey, type ElUnit, countyCode, keyString } from "../adapters/cec-el.ts";

const FIELDS = ["valid", "invalid", "cast", "electors"] as const;

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const k6 = (prv: string, cty: string, dist: string, town: string, vil: string, station: string): ElKey => ({ prv, cty, dist, town, vil, station });

export function parentKey(u: ElUnit, has: (k: ElKey) => boolean): ElKey | null {
  const k = u.key;
  switch (u.level) {
    case "station":
      return k6(k.prv, k.cty, k.dist, k.town, k.vil, "0000");
    case "village":
      return k6(k.prv, k.cty, k.dist, k.town, "0000", "0000");
    case "town": {
      const d = k6(k.prv, k.cty, k.dist, "000", "0000", "0000");
      return has(d) ? d : k6(k.prv, k.cty, "00", "000", "0000", "0000");
    }
    case "district":
      return k6(k.prv, k.cty, "00", "000", "0000", "0000");
    case "county":
      return k6("00", "000", "00", "000", "0000", "0000");
    default:
      return null;
  }
}

/**
 * @param ballotsOf ballot numbers of the contest a row belongs to, or null for rows that span
 *                  several contests (county / national in multi-contest files).
 */
export function checkElDataset(ds: ElDataset, ballotsOf: (k: ElKey) => number[] | null): ValidationCheck[] {
  const out: ValidationCheck[] = [];
  const add = (id: string, bad: string[], okDetail: string) =>
    out.push(
      bad.length
        ? { id, status: "fail", detail: `${bad.length} problems, e.g. ${bad.slice(0, 5).join("; ")}` }
        : { id, status: "pass", detail: okDetail },
    );
  const withVotes = ds.units.filter((u) => u.votes.size > 0);

  add(
    "non-negative",
    ds.units.filter((u) => [u.valid, u.invalid, u.cast, u.electors, ...u.votes.values()].some((x) => x < 0)).map((u) => keyString(u.key)),
    `${ds.units.length} units`,
  );

  add(
    "choices-complete",
    withVotes
      .filter((u) => {
        const b = ballotsOf(u.key);
        return b === null || b.some((n) => !u.votes.has(n)) || u.votes.size !== b.length;
      })
      .map((u) => keyString(u.key)),
    `${withVotes.length} units with candidate rows have exactly their contest's ballot numbers`,
  );

  add(
    "sum-votes-eq-valid",
    withVotes.filter((u) => sum([...u.votes.values()]) !== u.valid).map((u) => `${keyString(u.key)} Σ${sum([...u.votes.values()])}≠${u.valid}`),
    "Σ candidate votes = valid ballots in every unit with candidate rows",
  );

  add("valid-plus-invalid-eq-cast", ds.units.filter((u) => u.valid + u.invalid !== u.cast).map((u) => keyString(u.key)), "valid + invalid = ballots cast in every unit");
  add("cast-le-electors", ds.units.filter((u) => u.cast > u.electors).map((u) => keyString(u.key)), "ballots cast ≤ electors in every unit");

  // Hierarchy
  const byKey = new Map(ds.units.map((u) => [keyString(u.key), u]));
  const has = (k: ElKey) => byKey.has(keyString(k));
  const children = new Map<string, ElUnit[]>();
  const orphans: string[] = [];
  for (const u of ds.units) {
    const p = parentKey(u, has);
    if (!p) continue;
    const pk = keyString(p);
    if (!byKey.has(pk)) orphans.push(`${keyString(u.key)} → missing ${pk}`);
    children.set(pk, [...(children.get(pk) ?? []), u]);
  }
  const bad: string[] = [...orphans];
  let compared = 0;
  for (const [pk, kids] of children) {
    const parent = byKey.get(pk);
    if (!parent) continue;
    compared++;
    for (const f of FIELDS) {
      const s = sum(kids.map((k) => k[f]));
      if (s !== parent[f]) bad.push(`${pk} ${f} Σ${s}≠${parent[f]}`);
    }
    if (parent.votes.size > 0) {
      for (const [n, v] of parent.votes) {
        const s = sum(kids.map((k) => k.votes.get(n) ?? 0));
        if (s !== v) bad.push(`${pk} #${n} Σ${s}≠${v}`);
      }
    }
  }
  const nat = ds.units.filter((u) => u.level === "national");
  if (nat.length !== 1) bad.push(`expected 1 national row, got ${nat.length}`);
  add("hierarchy-sums", bad, `${compared} parent rows = Σ children (all summary fields; candidates where published)`);

  // Published percentages vs our recomputation (2-decimal rounding as published).
  const rateBad: string[] = [];
  for (const u of withVotes) {
    if (u.valid === 0) continue;
    for (const [n, v] of u.votes) {
      const ours = Math.round((v / u.valid) * 10000) / 100;
      const theirs = u.officialRate.get(n)!;
      if (Math.abs(ours - theirs) > 0.011) rateBad.push(`${keyString(u.key)} #${n} ${ours}≠${theirs}`);
    }
  }
  add("official-rate-reproducible", rateBad, "recomputed vote share = published 得票率 (±0.01) for every unit with candidate rows");
  return out;
}

