import { describe, expect, it } from "vitest";
import { createDataClient, DataError } from "../src/index.ts";

const manifest = {
  schemaVersion: 1,
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
    const c = createDataClient("https://data.example", fakeFetch({ "https://data.example/v1/manifest.json": manifest }, calls));
    await expect(c.manifest()).resolves.toMatchObject({ currentRelease: "r-abc" });
    expect(calls).toEqual(["https://data.example/v1/manifest.json"]);
  });

  it("classifies HTTP, JSON, schema and version failures", async () => {
    const base = "https://d/";
    const c = createDataClient(base, fakeFetch({
      "https://d/v1/releases/r/index.json": "{not json",
      "https://d/v1/releases/r/parties.json": { schemaVersion: 1, parties: [{ id: "BAD ID" }] },
      "https://d/v1/manifest.json": { ...manifest, schemaVersion: 2 },
    }));
    await expect(c.contest("r", "x")).rejects.toMatchObject({ kind: "http", status: 404 });
    await expect(c.index("r")).rejects.toMatchObject({ kind: "parse" });
    await expect(c.parties("r")).rejects.toMatchObject({ kind: "schema" });
    await expect(c.manifest()).rejects.toBeInstanceOf(DataError);
    await expect(c.manifest()).rejects.toMatchObject({ kind: "schema-version" });
  });
});
