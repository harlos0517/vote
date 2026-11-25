import { describe, expect, it } from "vitest";
import { createDataClient, DataError } from "../src/index.ts";

const manifest = {
  schemaVersion: 2,
  currentRelease: "r-abc",
  releases: [{ id: "r-abc", createdAt: "2026-11-23T00:00:00Z", etlVersion: "0.0.0+x", elections: ["2024-01-13-x"], validation: "passed" }],
};

function fakeFetch(map: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    if (!(url in map)) return new Response("nope", { status: 404 });
    const body = map[url];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("data client", () => {
  it("builds URLs from the base and parses the manifest", async () => {
    const calls: string[] = [];
    const c = createDataClient("https://data.example", fakeFetch({ "https://data.example/v2/manifest.json": manifest }, calls));
    await expect(c.manifest()).resolves.toMatchObject({ currentRelease: "r-abc" });
    expect(calls).toEqual(["https://data.example/v2/manifest.json"]);
  });

  it("classifies HTTP, JSON, schema and version failures", async () => {
    const base = "https://d/";
    const c = createDataClient(base, fakeFetch({
      "https://d/v2/releases/r/index.json": "{not json",
      "https://d/v2/releases/r/parties.json": { schemaVersion: 2, parties: [{ id: "BAD ID" }] },
      "https://d/v2/manifest.json": { ...manifest, schemaVersion: 3 },
    }));
    await expect(c.group("r", "x")).rejects.toMatchObject({ kind: "http", status: 404 });
    await expect(c.index("r")).rejects.toMatchObject({ kind: "parse" });
    await expect(c.parties("r")).rejects.toMatchObject({ kind: "schema" });
    await expect(c.manifest()).rejects.toBeInstanceOf(DataError);
    await expect(c.manifest()).rejects.toMatchObject({ kind: "schema-version" });
  });
});

describe("live feed", () => {
  const snap = { liveSchemaVersion: 1, feedId: "cec-x", groupId: "2026-11-28-local.mayor", seq: 3, status: "counting", asOf: "2026-11-28T17:00:00+08:00", generatedAt: "2026-11-28T17:00:05+08:00", progressUnit: "station", rows: [] };
  it("reads under live/<feedId>/ without the HTTP cache", async () => {
    const urls: string[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      inits.push(init);
      return new Response(JSON.stringify(snap), { status: 200 });
    }) as typeof fetch;
    const c = createDataClient("https://d", f);
    await expect(c.liveSnapshot("cec-x", "groups/g/latest.json")).resolves.toMatchObject({ seq: 3 });
    expect(urls).toEqual(["https://d/live/cec-x/groups/g/latest.json"]);
    expect(inits[0]).toMatchObject({ cache: "no-cache" });
  });
  it("rejects another live schema version", async () => {
    const c = createDataClient("https://d", fakeFetch({ "https://d/live/cec-x/l.json": { ...snap, liveSchemaVersion: 2 } }));
    await expect(c.liveSnapshot("cec-x", "l.json")).rejects.toMatchObject({ kind: "schema-version" });
  });
});
