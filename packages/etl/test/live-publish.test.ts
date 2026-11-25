import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GROUP_CACHE, LIVE_CACHE, SNAPSHOT_CACHE, kindOf, publishLiveFeed, type LiveBucket } from "../src/publish/live.ts";

const G = "groups/2026-11-28-local.mayor";
function feed(): string {
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  const files: Record<string, string> = {
    "manifest.json": '{"m":1}',
    [`${G}/latest.json`]: '{"seq":1}',
    [`${G}/snapshots/0000.json`]: '{"seq":0}',
    [`${G}/snapshots/0001.json`]: '{"seq":1}',
    [`${G}/metadata.json`]: '{"meta":1}',
    [`${G}/units/county.json`]: '{"u":1}',
    STOP: "",
    "manifest.json.tmp": "half",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

function fakeBucket(existing: Record<string, string> = {}, failOn?: string) {
  const store = new Map(Object.entries(existing).map(([k, v]) => [k, md5(v)]));
  const puts: { key: string; cache: string }[] = [];
  const b: LiveBucket = {
    head: async (key) => store.get(key) ?? null,
    put: async (key, body, cache) => {
      if (key === failOn) throw new Error("network down");
      store.set(key, createHash("md5").update(body).digest("hex"));
      puts.push({ key, cache });
    },
  };
  return { b, puts };
}
const K = (rel: string) => `live/cec-x/${rel}`;

describe("live feed upload", () => {
  it("uploads only feed files, under live/<feedId>/, with the manifest last", async () => {
    const { b, puts } = fakeBucket();
    await publishLiveFeed(feed(), "cec-x", { bucket: b, log: () => {} });
    expect(puts).toEqual([
      { key: K(`${G}/snapshots/0000.json`), cache: SNAPSHOT_CACHE },
      { key: K(`${G}/snapshots/0001.json`), cache: SNAPSHOT_CACHE },
      { key: K(`${G}/metadata.json`), cache: GROUP_CACHE },
      { key: K(`${G}/units/county.json`), cache: GROUP_CACHE },
      { key: K(`${G}/latest.json`), cache: LIVE_CACHE },
      { key: K("manifest.json"), cache: LIVE_CACHE },
    ]);
  });

  it("sends only what changed on the next run", async () => {
    const dir = feed();
    const { b, puts } = fakeBucket();
    await publishLiveFeed(dir, "cec-x", { bucket: b, log: () => {} });
    puts.length = 0;
    writeFileSync(join(dir, `${G}/snapshots/0002.json`), '{"seq":2}');
    writeFileSync(join(dir, `${G}/latest.json`), '{"seq":2}');
    writeFileSync(join(dir, "manifest.json"), '{"m":2}');
    const r = await publishLiveFeed(dir, "cec-x", { bucket: b, log: () => {} });
    expect(puts.map((p) => p.key)).toEqual([K(`${G}/snapshots/0002.json`), K(`${G}/latest.json`), K("manifest.json")]);
    expect(r.unchanged).toBe(4);
  });

  it("treats snapshots as immutable", async () => {
    // Same content already in the bucket (another machine): skipped.
    const same = fakeBucket({ [K(`${G}/snapshots/0000.json`)]: '{"seq":0}' });
    await publishLiveFeed(feed(), "cec-x", { bucket: same.b, log: () => {} });
    expect(same.puts.map((p) => p.key)).not.toContain(K(`${G}/snapshots/0000.json`));
    // Other content in the bucket: refuse, before anything else is sent.
    const other = fakeBucket({ [K(`${G}/snapshots/0000.json`)]: '{"seq":0,"x":1}' });
    await expect(publishLiveFeed(feed(), "cec-x", { bucket: other.b, log: () => {} })).rejects.toThrow(/immutable/);
    expect(other.puts).toEqual([]);
    // Changed locally after upload: refuse.
    const dir = feed();
    const ok = fakeBucket();
    await publishLiveFeed(dir, "cec-x", { bucket: ok.b, log: () => {} });
    writeFileSync(join(dir, `${G}/snapshots/0001.json`), '{"seq":1,"changed":true}');
    await expect(publishLiveFeed(dir, "cec-x", { bucket: ok.b, log: () => {} })).rejects.toThrow(/changed after it was uploaded/);
  });

  it("resumes after a failed upload without resending what made it", async () => {
    const dir = feed();
    const first = fakeBucket({}, K(`${G}/latest.json`));
    await expect(publishLiveFeed(dir, "cec-x", { bucket: first.b, log: () => {} })).rejects.toThrow(/network down/);
    expect(first.puts.map((p) => p.key)).not.toContain(K("manifest.json"));
    const second = fakeBucket();
    await publishLiveFeed(dir, "cec-x", { bucket: second.b, log: () => {} });
    expect(second.puts.map((p) => p.key)).toEqual([K(`${G}/latest.json`), K("manifest.json")]);
  });

  it("lists without a bucket (dry run) and checks the feed id", async () => {
    const r = await publishLiveFeed(feed(), "cec-x", { bucket: null, log: () => {} });
    expect(r.uploaded).toHaveLength(6);
    await expect(publishLiveFeed(feed(), "../v2", { bucket: null, log: () => {} })).rejects.toThrow();
    expect(kindOf("STOP")).toBeNull();
    expect(kindOf(".published.json")).toBeNull();
    expect(kindOf(`${G}/snapshots/0001.json.tmp`)).toBeNull();
  });
});
