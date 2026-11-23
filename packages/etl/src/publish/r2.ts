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
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { Manifest, type ValidationCheck } from "@tw-election/schema";
import { DATA_SOURCES, RAW_SOURCES } from "../config/sources.ts";
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

/**
 * Mirror the pinned raw inputs PUBLICLY under raw/ in the data bucket, so anyone can
 * rebuild a release even after an upstream file is replaced.
 *
 * Both sources are released under 政府資料開放授權條款-第1版 (OGDL-Taiwan 1.0), which
 * permits redistribution provided the providing agency and the license are credited.
 * Each mirrored file is listed in raw/index.json with its publisher, original URL,
 * license and checksum, and raw/NOTICE.md carries the attribution in prose.
 */
export async function mirrorRaw(rawDir: string, opts: { dryRun: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  const s3 = opts.dryRun ? null : client();
  const bucket = opts.dryRun ? "(dry-run)" : env("R2_BUCKET");
  const sourceMeta = new Map<string, (typeof DATA_SOURCES)[keyof typeof DATA_SOURCES]>(Object.values(DATA_SOURCES).map((d) => [d.id, d]));
  const entries = [];
  for (const s of Object.values(RAW_SOURCES)) {
    const meta = sourceMeta.get(s.id);
    if (!meta) throw new Error(`no license/attribution metadata for raw source ${s.id}; refusing to mirror`);
    const p = rawPath(rawDir, s);
    if ((await sha256File(p)) !== s.sha256) throw new Error(`sha256 mismatch for ${p}`);
    const key = `raw/${s.id}/${s.sha256}/${s.file}`;
    entries.push({
      path: key,
      bytes: s.bytes,
      sha256: s.sha256,
      originalUrl: s.url,
      retrievedAt: s.retrievedAt,
      publisher: meta.publisher,
      title: meta.title,
      datasetUrl: meta.url,
      license: meta.license,
      licenseUrl: "https://data.gov.tw/license",
      attribution: meta.attribution,
    });
    if (!s3) { log(`  would mirror ${p} → ${bucket}/${key}`); continue; }
    if ((await headEtag(s3, bucket, key)) !== null) { log(`  = ${key}`); continue; }
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: readFileSync(p),
      ContentType: s.file.endsWith(".zip") ? "application/zip" : "application/octet-stream",
      ContentDisposition: `attachment; filename="${s.id}-${s.file}"`,
      CacheControl: IMMUTABLE,
      Metadata: { sha256: s.sha256, source: s.url },
    }));
    log(`  + ${key}`);
  }
  const index = JSON.stringify({ description: "Unmodified copies of the official inputs used to build the data releases.", files: entries }, null, 2);
  const notice = rawNotice(entries);
  if (!s3) { log("  would write raw/index.json and raw/NOTICE.md"); return; }
  for (const [Key, Body, ContentType] of [["raw/index.json", index, "application/json; charset=utf-8"], ["raw/NOTICE.md", notice, "text/markdown; charset=utf-8"]] as const) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType, CacheControl: MANIFEST_CACHE }));
    log(`  + ${Key}`);
  }
}

export function rawNotice(entries: { path: string; publisher: string; title: string; datasetUrl: string; license: string; originalUrl: string; sha256: string }[]): string {
  return [
    "# 原始資料鏡像 / Raw data mirror",
    "",
    "本目錄保存建置本網站資料所用的官方原始檔，內容未經修改。",
    "These are unmodified copies of the official source files used to build this site's data.",
    "",
    "各檔案依「政府資料開放授權條款－第1版」（https://data.gov.tw/license）提供；",
    "利用時請標示資料提供機關及上述授權條款。本鏡像與資料提供機關無隸屬或背書關係。",
    "",
    ...entries.flatMap((e) => [
      `## ${e.publisher}〈${e.title}〉`,
      "",
      `- 檔案：\`${e.path}\``,
      `- 資料集：${e.datasetUrl}`,
      `- 原始下載網址：${e.originalUrl}`,
      `- 授權：${e.license}`,
      `- SHA-256：\`${e.sha256}\``,
      "",
    ]),
  ].join("\n");
}
