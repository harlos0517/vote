/**
 * Upload a live feed (data/out/live/<feedId>/) to R2 under live/<feedId>/, from the machine
 * that runs the poller (it needs a Taiwan connection for CEC, so not CI).
 *
 *  - only keys under live/<feedId>/ are written; v2/ releases are never touched;
 *  - numbered snapshots are immutable: an existing one with other content stops the upload;
 *  - order: snapshots and group files, then each latest.json, then manifest.json last, so a
 *    reader never follows a pointer to a file that is not there yet;
 *  - only files that changed since the last upload are sent (state in <feed>/.published.json).
 *
 * Credentials come from the environment, as for `mirror-raw` (docs/deployment.md).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { LIVE_PREFIX, Slug } from "@tw-election/schema";
import { client, env, headEtag } from "./r2.ts";

/** Readers poll these; keep CDN copies short-lived. */
export const LIVE_CACHE = "public, max-age=10, must-revalidate";
/** Group metadata and unit lists: rarely change, but may be regenerated (e.g. a fixed CSV). */
export const GROUP_CACHE = "public, max-age=60, must-revalidate";
export const SNAPSHOT_CACHE = "public, max-age=31536000, immutable";

const STATE = ".published.json";

export interface LiveBucket {
  /** md5 hex of the stored object, or null when there is none. */
  head(key: string): Promise<string | null>;
  put(key: string, body: Buffer, cacheControl: string): Promise<void>;
}

export function r2Bucket(): LiveBucket {
  const s3 = client();
  const bucket = env("R2_BUCKET");
  return {
    head: (key) => headEtag(s3, bucket, key),
    put: async (key, body, cacheControl) => {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json; charset=utf-8", CacheControl: cacheControl }));
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

type Kind = "snapshot" | "group" | "latest" | "manifest";
export function kindOf(rel: string): Kind | null {
  if (rel === "manifest.json") return "manifest";
  if (/^groups\/[^/]+\/latest\.json$/.test(rel)) return "latest";
  if (/^groups\/[^/]+\/snapshots\/\d+\.json$/.test(rel)) return "snapshot";
  if (/^groups\/[^/]+\/(metadata\.json|units\/[a-z]+\.json)$/.test(rel)) return "group";
  return null; // STOP, *.tmp, state file, anything else stays local
}
const ORDER: Kind[] = ["snapshot", "group", "latest", "manifest"];
const CACHE: Record<Kind, string> = { snapshot: SNAPSHOT_CACHE, group: GROUP_CACHE, latest: LIVE_CACHE, manifest: LIVE_CACHE };

export interface PublishResult {
  uploaded: string[];
  unchanged: number;
}

export async function publishLiveFeed(
  feedDir: string,
  feedId: string,
  opts: { bucket: LiveBucket | null; log?: (s: string) => void },
): Promise<PublishResult> {
  const log = opts.log ?? console.log;
  Slug.parse(feedId);
  if (!existsSync(join(feedDir, "manifest.json"))) throw new Error(`${feedDir} has no manifest.json; nothing to publish`);
  const statePath = join(feedDir, STATE);
  const state: Record<string, string> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};

  const files = walk(feedDir)
    .map((f) => ({ f, rel: relative(feedDir, f).split("\\").join("/") }))
    .map((x) => ({ ...x, kind: kindOf(x.rel) }))
    .filter((x): x is { f: string; rel: string; kind: Kind } => x.kind !== null)
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.rel.localeCompare(b.rel));

  const uploaded: string[] = [];
  let unchanged = 0;
  for (const { f, rel, kind } of files) {
    const key = `${LIVE_PREFIX}/${feedId}/${rel}`;
    const body = readFileSync(f);
    const md5 = createHash("md5").update(body).digest("hex");
    if (state[key] === md5) {
      unchanged++;
      continue;
    }
    if (!opts.bucket) {
      log(`  would upload ${key} (${CACHE[kind]})`);
      uploaded.push(key);
      continue;
    }
    if (kind === "snapshot" && state[key] === undefined) {
      // Not uploaded from here before: it may exist from another run or machine.
      const existing = await opts.bucket.head(key);
      if (existing === md5) {
        state[key] = md5;
        unchanged++;
        continue;
      }
      if (existing !== null) throw new Error(`${key} already exists with other content; snapshots are immutable (use a new feed id)`);
    } else if (kind === "snapshot") {
      throw new Error(`${key} changed after it was uploaded; snapshots are immutable`);
    }
    await opts.bucket.put(key, body, CACHE[kind]);
    state[key] = md5;
    uploaded.push(key);
    // Saved after every file, so an interrupted run resumes where it stopped.
    writeFileSync(statePath, JSON.stringify(state));
  }
  if (opts.bucket) log(`live/${feedId}: ${uploaded.length} uploaded, ${unchanged} unchanged`);
  return { uploaded, unchanged };
}
