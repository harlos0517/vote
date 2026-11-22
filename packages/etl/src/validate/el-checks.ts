/**
 * Numeric checks for a single-contest el* dataset. Rules are explicit per
 * contest type — callers choose which apply (e.g. multi-seat contests have no
 * single "winner" check).
 */
import type { ValidationCheck } from "@tw-election/schema";
import { type ElDataset, type ElUnit, countyCode, keyString } from "../adapters/cec-el.ts";

const FIELDS = ["valid", "invalid", "cast", "electors"] as const;

export function checkElDataset(ds: ElDataset, ballotNumbers: number[]): ValidationCheck[] {
  const out: ValidationCheck[] = [];
  const add = (id: string, bad: string[], okDetail: string) =>
    out.push(
      bad.length
        ? { id, status: "fail", detail: `${bad.length} problems, e.g. ${bad.slice(0, 5).join("; ")}` }
        : { id, status: "pass", detail: okDetail },
    );

  const neg = ds.units.filter((u) => [u.valid, u.invalid, u.cast, u.electors, ...u.votes.values()].some((x) => x < 0));
  add("non-negative", neg.map((u) => keyString(u.key)), `${ds.units.length} units`);

  add(
    "choices-complete",
    ds.units.filter((u) => ballotNumbers.some((n) => !u.votes.has(n)) || u.votes.size !== ballotNumbers.length).map((u) => keyString(u.key)),
    `every unit has votes for ballot numbers ${ballotNumbers.join(",")}`,
  );

  add(
    "sum-votes-eq-valid",
    ds.units
      .filter((u) => sum([...u.votes.values()]) !== u.valid)
      .map((u) => `${keyString(u.key)} Σ${sum([...u.votes.values()])}≠${u.valid}`),
    "Σ candidate votes = valid ballots in every unit",
  );

  add(
    "valid-plus-invalid-eq-cast",
    ds.units.filter((u) => u.valid + u.invalid !== u.cast).map((u) => keyString(u.key)),
    "valid + invalid = ballots cast in every unit",
  );

  add(
    "cast-le-electors",
    ds.units.filter((u) => u.cast > u.electors).map((u) => keyString(u.key)),
    "ballots cast ≤ electors in every unit",
  );

  // Hierarchy: children of each parent level sum to the parent on every field and every choice.
  const byLevel = (l: ElUnit["level"]) => ds.units.filter((u) => u.level === l);
  const nat = byLevel("national");
  const bad: string[] = [];
  const compare = (label: string, parent: ElUnit, kids: ElUnit[]) => {
    for (const f of FIELDS) {
      const s = sum(kids.map((k) => k[f]));
      if (s !== parent[f]) bad.push(`${label} ${f} Σ${s}≠${parent[f]}`);
    }
    for (const n of ballotNumbers) {
      const s = sum(kids.map((k) => k.votes.get(n) ?? 0));
      if (s !== parent.votes.get(n)) bad.push(`${label} #${n} Σ${s}≠${parent.votes.get(n)}`);
    }
  };
  if (nat.length !== 1) bad.push(`expected 1 national row, got ${nat.length}`);
  else compare("national←county", nat[0]!, byLevel("county"));
  for (const c of byLevel("county")) {
    const cc = countyCode(c.key);
    compare(`county ${cc}←town`, c, byLevel("town").filter((t) => countyCode(t.key) === cc));
  }
  for (const t of byLevel("town")) {
    const tk = countyCode(t.key) + t.key.town;
    compare(`town ${tk}←village`, t, byLevel("village").filter((v) => countyCode(v.key) + v.key.town === tk));
  }
  const villages = new Map(byLevel("village").map((v) => [countyCode(v.key) + v.key.town + v.key.vil, v]));
  const stationsByVillage = new Map<string, ElUnit[]>();
  for (const s of byLevel("station")) {
    const vk = countyCode(s.key) + s.key.town + s.key.vil;
    stationsByVillage.set(vk, [...(stationsByVillage.get(vk) ?? []), s]);
  }
  for (const [vk, v] of villages) compare(`village ${vk}←station`, v, stationsByVillage.get(vk) ?? []);
  add("hierarchy-sums", bad, "national = Σcounty, county = Σtown, town = Σvillage, village = Σstation (all fields, all choices)");

  // Published percentages vs our recomputation (2-decimal rounding as published).
  const rateBad: string[] = [];
  for (const u of ds.units) {
    if (u.valid === 0) continue;
    for (const [n, v] of u.votes) {
      const ours = Math.round((v / u.valid) * 10000) / 100;
      const theirs = u.officialRate.get(n)!;
      if (Math.abs(ours - theirs) > 0.011) rateBad.push(`${keyString(u.key)} #${n} ${ours}≠${theirs}`);
    }
  }
  add("official-rate-reproducible", rateBad, "recomputed vote share = published 得票率 (±0.01) for every unit");
  return out;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
