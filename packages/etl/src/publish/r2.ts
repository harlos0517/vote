/**
 * Publish a locally built, validated release to Cloudflare R2 (S3-compatible API).
 *
 * Guarantees:
 *  - refuses to publish a release whose validation report contains a failure;
 *  - release files are immutable: an existing object with different content aborts
 *    the publish (a correction must be a new release id, which content hashing gives);
 *  - manifest.json is written last, so readers never see a release that is missing files.
 *
 * Credentials come only from the environment (GitHub Actions secrets):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (public data bucket)
 *   R2_RAW_BUCKET                                                     (private raw mirror)
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { Manifest, type ValidationCheck } from "@tw-election/schema";
import { RAW_SOURCES } from "../config/sources.ts";
import { rawPath, sha256File } from "../lib/raw.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";
const MANIFEST_CACHE = "public, max-age=60, must-revalidate";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
}

const contentType = (p: string) =>
  p.endsWith(".json") ? "application/json; charset=utf-8" : p.endsWith(".geojson") ? "application/geo+json; charset=utf-8" : "application/octet-stream";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

async function headEtag(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return (r.ETag ?? "").replaceAll('"', "");
  } catch (e) {
    if (e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NotFound")) return null;
    throw e;
  }
}

export async function publishRelease(outDir: string, opts: { dryRun: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  const local = Manifest.parse(JSON.parse(readFileSync(join(outDir, "v1/manifest.json"), "utf8")));
  const releaseId = local.currentRelease;
  const entry = local.releases.find((r) => r.id === releaseId)!;
  const reportPath = join(outDir, "reports", `${releaseId}.json`);
  if (!existsSync(reportPath)) throw new Error(`no validation report for ${releaseId}`);
  const checks = JSON.parse(readFileSync(reportPath, "utf8")) as ValidationCheck[];
  if (checks.some((c) => c.status === "fail")) throw new Error(`release ${releaseId} has failed checks; refusing to publish`);

  const root = join(outDir, "v1/releases", releaseId);
  const files = walk(root).sort();
  log(`release ${releaseId}: ${files.length} files`);
  if (opts.dryRun) {
    for (const f of files) log(`  would upload v1/releases/${releaseId}/${relative(root, f)}`);
    log("  would update v1/manifest.json");
    return;
  }

  const s3 = client();
  const bucket = env("R2_BUCKET");
  for (const f of files) {
    const key = `v1/releases/${releaseId}/${relative(root, f).split("\\").join("/")}`;
    const body = readFileSync(f);
    const md5 = createHash("md5").update(body).digest("hex");
    const existing = await headEtag(s3, bucket, key);
    if (existing === md5) { log(`  = ${key}`); continue; }
    if (existing !== null) throw new Error(`${key} already exists with different content (etag ${existing} ≠ ${md5}); releases are immutable`);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType(f), CacheControl: IMMUTABLE }));
    log(`  + ${key}`);
  }

  // Merge into the remote manifest (other releases are kept for rollback / old links).
  let remote: Manifest | null = null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "v1/manifest.json" }));
    remote = Manifest.parse(JSON.parse(await r.Body!.transformToString()));
  } catch (e) {
    if (!(e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NoSuchKey"))) throw e;
  }
  const releases = [...(remote?.releases ?? []).filter((r) => r.id !== releaseId), entry];
  const manifest = Manifest.parse({ schemaVersion: 1, currentRelease: releaseId, releases });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "v1/manifest.json",
      Body: JSON.stringify(manifest, null, 2),
      ContentType: "application/json; charset=utf-8",
      CacheControl: MANIFEST_CACHE,
    }),
  );
  log(`manifest now points to ${releaseId} (${releases.length} releases listed)`);
}

/** Mirror pinned raw inputs to a PRIVATE bucket so old upstream versions stay rebuildable. */
export async function mirrorRaw(rawDir: string, opts: { dryRun: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  const s3 = opts.dryRun ? null : client();
  const bucket = opts.dryRun ? "(dry-run)" : env("R2_RAW_BUCKET");
  for (const s of Object.values(RAW_SOURCES)) {
    const p = rawPath(rawDir, s);
    if ((await sha256File(p)) !== s.sha256) throw new Error(`sha256 mismatch for ${p}`);
    const key = `raw/${s.id}/${s.sha256}/${s.file}`;
    if (!s3) { log(`  would mirror ${p} → ${bucket}/${key}`); continue; }
    if ((await headEtag(s3, bucket, key)) !== null) { log(`  = ${key}`); continue; }
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(p), ContentType: "application/octet-stream", Metadata: { sha256: s.sha256, source: s.url } }));
    log(`  + ${key}`);
  }
}
