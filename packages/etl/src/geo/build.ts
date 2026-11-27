/**
 * Boundary pipeline (mapshaper, pure Node — no GDAL needed for SHP → GeoJSON).
 *
 * Every level is dissolved from ONE simplified village snapshot, so county, district and
 * town borders share the same arcs (no slivers between levels). Towns split between
 * electoral districts are drawn as parts: villages are never split, so each part is the
 * union of the villages CEC assigns to that district.
 *
 * Village_Sanhe (屏東縣瑪家鄉三和村) is deliberately NOT merged: its polygon overlaps
 * villages of 內埔鄉／鹽埔鄉／長治鄉 in the main layer (~5.4 km²), so merging it would
 * make towns overlap. 瑪家鄉 carries a note instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error mapshaper ships no type declarations
import mapshaper from "mapshaper";

export interface GeoJSON {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, string>; geometry: unknown }[];
}

export interface PartAssignment {
  /** Whole towns: every village of the town → this part (and district, if any). */
  towns: { town: string; part: string; district: string }[];
  /** Villages of split towns → their part and district. */
  villages: { village: string; part: string; district: string }[];
  /** Towns drawn in another county than their registry one (pre-2010: 臺中縣 66001), with its name. */
  counties?: { town: string; county: string; name: string }[];
}

export interface Boundaries {
  county: GeoJSON;
  town: GeoJSON; // features: { code: part code, district }
  district?: GeoJSON; // features: { code: "63000-07" }
}

const csv = (header: string, rows: string[][]) => [header, ...rows.map((r) => r.join(","))].join("\n") + "\n";

export async function buildBoundaries(villageShp: string, workDir: string, parts: PartAssignment, withDistricts: boolean, simplifyPct = "10%"): Promise<Boundaries> {
  mkdirSync(workDir, { recursive: true });
  const q = (p: string) => JSON.stringify(p);
  const townsCsv = join(workDir, "towns.csv");
  const villagesCsv = join(workDir, "villages.csv");
  const countiesCsv = join(workDir, "counties.csv");
  writeFileSync(countiesCsv, csv("TOWNCODE,tcounty,tcname", (parts.counties ?? []).map((c) => [c.town, c.county, c.name])));
  writeFileSync(townsCsv, csv("TOWNCODE,tpart,tdist", parts.towns.map((t) => [t.town, t.part, t.district])));
  writeFileSync(villagesCsv, csv("VILLCODE,vpart,vdist", parts.villages.map((v) => [v.village, v.part, v.district])));
  const out = { county: join(workDir, "county.geojson"), town: join(workDir, "town.geojson"), district: join(workDir, "district.geojson") };

  await mapshaper.runCommands(
    [
      `-i ${q(villageShp)} encoding=utf8 name=village`,
      `-simplify ${simplifyPct} keep-shapes`,
      `-join ${q(townsCsv)} keys=TOWNCODE,TOWNCODE string-fields=TOWNCODE,tpart,tdist`,
      `-join ${q(villagesCsv)} keys=VILLCODE,VILLCODE string-fields=VILLCODE,vpart,vdist`,
      `-join ${q(countiesCsv)} keys=TOWNCODE,TOWNCODE string-fields=TOWNCODE,tcounty,tcname`,
      // (No local variable here: a "var" in a mapshaper expression becomes a field of the record.)
      `-each "if (this.properties.tcounty) { COUNTYCODE = this.properties.tcounty; COUNTYNAME = this.properties.tcname; }"`,
      // Villages of split towns that CEC does not list (e.g. 未編定村里) keep the bare town code: no data.
      // Joined fields may be absent entirely (e.g. no split towns), so read them via this.properties.
      `-each "var p = this.properties; part = p.vpart || p.tpart || TOWNCODE; district = p.vdist || p.tdist || ''"`,
      `-dissolve2 part copy-fields=district + name=town`,
      `-rename-fields code=part target=town`,
      `-o ${q(out.town)} target=town format=geojson precision=0.00001`,
      ...(withDistricts
        ? [
            `-filter "district !== ''" target=village + name=dvill`,
            `-dissolve2 district target=dvill + name=district`,
            `-rename-fields code=district target=district`,
            `-o ${q(out.district)} target=district format=geojson precision=0.00001`,
          ]
        : []),
      `-dissolve2 COUNTYCODE copy-fields=COUNTYNAME target=village + name=county`,
      `-rename-fields code=COUNTYCODE,name=COUNTYNAME target=county`,
      `-o ${q(out.county)} target=county format=geojson precision=0.00001`,
    ].join(" "),
  );
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as GeoJSON;
  return { county: read(out.county), town: read(out.town), ...(withDistricts ? { district: read(out.district) } : {}) };
}

/**
 * 村里 layer: every village polygon, coded by the unit it belongs to. `assign` maps an NLSC
 * VILLCODE to a unit code ("63000010002" for a single village, "09007010-0A01" for a group
 * sharing stations, whose members are dissolved into one shape). Villages not assigned keep
 * their own VILLCODE and show as 無資料. Same simplification as buildBoundaries, so the
 * village borders coincide with the town borders drawn from the same snapshot.
 */
export async function buildVillages(villageShp: string, workDir: string, assign: Map<string, string>, simplifyPct = "10%"): Promise<GeoJSON> {
  mkdirSync(workDir, { recursive: true });
  const q = (p: string) => JSON.stringify(p);
  const assignCsv = join(workDir, "assign.csv");
  writeFileSync(assignCsv, csv("VILLCODE,vunit", [...assign].map(([v, u]) => [v, u])));
  const out = join(workDir, "village.geojson");
  await mapshaper.runCommands(
    [
      `-i ${q(villageShp)} encoding=utf8 name=village`,
      `-simplify ${simplifyPct} keep-shapes`,
      `-join ${q(assignCsv)} keys=VILLCODE,VILLCODE string-fields=VILLCODE,vunit`,
      // Polygons with no result keep NLSC's village name (as published, e.g. "[板]里村"), for the sidebar.
      `-each "var p = this.properties; code = p.vunit || VILLCODE; name = p.vunit ? null : (VILLNAME || null)"`,
      `-dissolve2 code copy-fields=name`,
      `-o ${q(out)} format=geojson precision=0.00001`,
    ].join(" "),
  );
  const g = JSON.parse(readFileSync(out, "utf8")) as GeoJSON;
  // mapshaper writes the field on every feature; keep it only where there is a name.
  for (const f of g.features) if (f.properties.name == null) delete (f.properties as Record<string, unknown>).name;
  return g;
}
