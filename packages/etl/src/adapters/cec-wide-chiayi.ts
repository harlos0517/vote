/**
 * Adapter for the 2022-12-18 嘉義市長 rerun, which CEC publishes outside the el* format
 * (`2022年_嘉義市長重行選舉/`): a wide table per station with names instead of codes,
 * and a candidate list without elected marks or personal details.
 *
 * Stations are mapped to codes by station number through a same-year el* dataset of
 * 嘉義市 (the 2022-11-26 議員 files), and every station's village name must agree with it.
 */
import { join } from "node:path";
import { PUA_RE, readCecCsv } from "../lib/csv.ts";
import { type ElCandidate, type ElDataset, type ElKey, type ElParty, type ElUnit, keyString, levelOf } from "./cec-el.ts";

const PRV = "10";
const CTY = "020";
export const CHIAYI_CITY = PRV + CTY;

/** Integers, allowing the spreadsheet's thousands separators ("1,007"). */
function int(s: string | undefined, what: string): number {
  if (s !== undefined && /^\d{1,3}(,\d{3})+$/.test(s)) s = s.replaceAll(",", "");
  if (s === undefined || !/^\d+$/.test(s)) throw new Error(`chiayi rerun: expected integer for ${what}, got ${JSON.stringify(s)}`);
  return Number(s);
}

/** Same name, or differing only where the el* name has a private-use character (e.g. 磚磘里). */
export function sameVillageName(wide: string, el: string): boolean {
  if (wide === el) return true;
  const a = [...wide];
  const b = [...el];
  return a.length === b.length && a.every((ch, i) => ch === b[i] || PUA_RE.test(b[i]!));
}

export function readChiayiRerun(dir: string, ref: ElDataset, parties: ElParty[], date: string): ElDataset {
  const header = (rows: string[][]) => rows.slice(1);
  const candRows = header(readCecCsv(join(dir, "cand.csv"), { quotedCommas: true }));
  const profRows = readCecCsv(join(dir, "prof.csv"), { quotedCommas: true });
  const head = profRows[0]!;
  const nCand = head.filter((h) => /^號次\d+$/.test(h)).length;
  if (nCand !== candRows.length) throw new Error(`chiayi rerun: prof has ${nCand} candidate columns, cand.csv ${candRows.length}`);

  // Reference: station number → el* station key, and names of towns/villages.
  const refUnits = ref.units.filter((u) => u.key.prv === PRV && u.key.cty === CTY);
  const stationRef = new Map(refUnits.filter((u) => u.level === "station").map((u) => [Number(u.key.station), u]));
  const nameOf = new Map(refUnits.map((u) => [`${u.key.town}|${u.key.vil}|${u.key.station}`, u]));
  const named = (k: ElKey) => nameOf.get(`${k.town}|${k.vil}|${k.station}`);

  const units = new Map<string, ElUnit>();
  const add = (k: ElKey, s: { valid: number; invalid: number; cast: number; electors: number }, votes: number[]) => {
    const id = keyString(k);
    let u = units.get(id);
    if (!u) {
      const level = levelOf(k);
      const name = level === "county" ? (refUnits.find((x) => x.level === "county")?.name ?? "嘉義市") : (named(k)?.name ?? "");
      u = { key: k, level, name, valid: 0, invalid: 0, cast: 0, electors: 0, populationRaw: 0, votes: new Map(), officialRate: new Map() };
      units.set(id, u);
    }
    u.valid += s.valid;
    u.invalid += s.invalid;
    u.cast += s.cast;
    u.electors += s.electors;
    votes.forEach((v, i) => u!.votes.set(i + 1, (u!.votes.get(i + 1) ?? 0) + v));
  };

  const seenStations = new Set<number>();
  for (const r of header(profRows)) {
    const [town, village, stationS] = r;
    const station = int(stationS, "station");
    if (seenStations.has(station)) throw new Error(`chiayi rerun: station ${station} twice`);
    seenStations.add(station);
    const st = stationRef.get(station);
    if (!st) throw new Error(`chiayi rerun: station ${station} not in the reference data`);
    const refTown = named({ ...st.key, vil: "0000", station: "0000" })?.name;
    const refVil = named({ ...st.key, station: "0000" })?.name ?? "";
    if (refTown !== town || !sameVillageName(village!, refVil)) {
      throw new Error(`chiayi rerun: station ${station} is ${town}${village} here but ${refTown}${refVil} in the reference`);
    }
    const votes = Array.from({ length: nCand }, (_, i) => int(r[3 + i], `station ${station} #${i + 1}`));
    const valid = int(r[3 + nCand], `station ${station} valid`);
    const invalid = int(r[4 + nCand], `station ${station} invalid`);
    const cast = int(r[5 + nCand], `station ${station} cast`);
    const electors = int(r[9 + nCand], `station ${station} electors`);
    const sum = votes.reduce((a, b) => a + b, 0);
    if (sum !== valid) throw new Error(`chiayi rerun: station ${station} votes sum ${sum} ≠ valid ${valid}`);
    if (valid + invalid !== cast) throw new Error(`chiayi rerun: station ${station} valid + invalid ≠ cast`);
    const s = { valid, invalid, cast, electors };
    const k = st.key;
    add(k, s, votes);
    add({ ...k, station: "0000" }, s, votes);
    add({ ...k, vil: "0000", station: "0000" }, s, votes);
    add({ ...k, dist: "00", town: "000", vil: "0000", station: "0000" }, s, votes);
  }
  const missing = [...stationRef.keys()].filter((n) => !seenStations.has(n));
  if (missing.length) throw new Error(`chiayi rerun: stations ${missing.join(", ")} missing`);

  // Candidates: party by exact name ("無" = 無黨籍及未經政黨推薦).
  const byName = new Map(parties.map((p) => [p.name, p.code]));
  const county = units.get(keyString({ prv: PRV, cty: CTY, dist: "00", town: "000", vil: "0000", station: "0000" }))!;
  const top = Math.max(...county.votes.values());
  const winners = [...county.votes].filter(([, v]) => v === top);
  if (winners.length !== 1) throw new Error("chiayi rerun: tie for first place");
  const candidates: ElCandidate[] = candRows.map((r) => {
    const n = int(r[0], "ballot number");
    const code = r[2] === "無" ? 999 : byName.get(r[2]!);
    if (code === undefined) throw new Error(`chiayi rerun: unknown party ${r[2]}`);
    return {
      key: county.key,
      ballotNumber: n,
      name: r[1]!,
      partyCode: code,
      gender: null,
      birthYearROC: null,
      incumbent: null,
      // The file has no elected marks; the single seat goes to the most votes.
      electedMark: n === winners[0]![0] ? "*" : "",
      isRunningMate: false,
    };
  });

  return {
    units: [...units.values()],
    candidates,
    parties,
    contestNotes: new Map([
      [
        CHIAYI_CITY,
        {
          date,
          warnings: [
            `嘉義市長選舉於 ${date} 舉行，與其他縣市不同日；資料取自中選會另行發布的檔案。`,
            "該檔案未標示當選人，此處以得票最多者為當選；未提供候選人性別、年齡等資料。",
          ],
        },
      ],
    ]),
  };
}
