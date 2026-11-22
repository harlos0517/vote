/**
 * Boundary pipeline (mapshaper, pure Node — no GDAL needed for SHP → GeoJSON).
 *
 * County and town polygons are dissolved from ONE village snapshot so that all
 * levels share the same version and the same simplified arcs (no slivers
 * between county and town borders). The snapshot is chosen per election; see
 * docs/phase0-report.md §10.
 *
 * Village_Sanhe (屏東縣瑪家鄉三和村) is deliberately NOT merged: its polygon
 * overlaps villages of 內埔鄉／鹽埔鄉／長治鄉 in the main layer (~5.4 km²), so
 * merging it would make towns overlap. 瑪家鄉 carries a note instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error mapshaper ships no type declarations
import mapshaper from "mapshaper";

export interface GeoOutput {
  county: GeoJSON;
  town: GeoJSON;
}
export interface GeoJSON {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, string>; geometry: unknown }[];
}

export async function buildBoundaries(villageShp: string, workDir: string, simplifyPct = "3%"): Promise<GeoOutput> {
  mkdirSync(workDir, { recursive: true });
  const town = join(workDir, "town.geojson");
  const county = join(workDir, "county.geojson");
  const q = (p: string) => JSON.stringify(p);
  await mapshaper.runCommands(
    [
      `-i ${q(villageShp)} encoding=utf8 name=village`,
      `-simplify ${simplifyPct} keep-shapes`,
      `-dissolve2 TOWNCODE copy-fields=TOWNNAME,COUNTYCODE,COUNTYNAME + name=town`,
      `-rename-fields code=TOWNCODE,name=TOWNNAME,county=COUNTYCODE,countyName=COUNTYNAME target=town`,
      `-o ${q(town)} target=town format=geojson precision=0.00001`,
      `-dissolve2 COUNTYCODE copy-fields=COUNTYNAME target=village + name=county`,
      `-rename-fields code=COUNTYCODE,name=COUNTYNAME target=county`,
      `-o ${q(county)} target=county format=geojson precision=0.00001`,
    ].join(" "),
  );
  return {
    town: JSON.parse(readFileSync(town, "utf8")) as GeoJSON,
    county: JSON.parse(readFileSync(county, "utf8")) as GeoJSON,
  };
}

export function writeGeo(path: string, g: GeoJSON) {
  writeFileSync(path, JSON.stringify(g));
}
