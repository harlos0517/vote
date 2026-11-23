/**
 * Release writer. Release ids are content hashes, so the same inputs and ETL
 * code always produce the same release id and byte-identical files.
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_PREFIX, Manifest } from "@tw-election/schema";

export const RELEASE_TOKEN = "r-pending-release-id"; // valid Slug, replaced on write

export interface PendingFile {
  path: string; // release-relative
  body: string; // may contain RELEASE_TOKEN
}

export function releaseIdFor(files: PendingFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path).update("\0").update(f.body).update("\0");
  }
  return `r-${h.digest("hex").slice(0, 12)}`;
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Write <prefix>/releases/<id>/... and (re)write <prefix>/manifest.json with this release as current. */
export function writeRelease(
  outDir: string,
  files: PendingFile[],
  meta: { etlVersion: string; elections: string[]; validation: "passed" | "passed-with-warnings"; now: string },
): { releaseId: string; root: string } {
  const releaseId = releaseIdFor(files);
  const root = join(outDir, DATA_PREFIX, "releases", releaseId);
  if (existsSync(root)) rmSync(root, { recursive: true });
  for (const f of files) {
    const p = join(root, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.body.replaceAll(RELEASE_TOKEN, releaseId));
  }
  const manifestPath = join(outDir, DATA_PREFIX, "manifest.json");
  const prev = existsSync(manifestPath) ? Manifest.parse(JSON.parse(readFileSync(manifestPath, "utf8"))) : null;
  const others = (prev?.releases ?? []).filter((r) => r.id !== releaseId);
  const manifest = Manifest.parse({
    schemaVersion: 2,
    currentRelease: releaseId,
    releases: [...others, { id: releaseId, createdAt: meta.now, etlVersion: meta.etlVersion, elections: meta.elections, validation: meta.validation }],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { releaseId, root };
}
