import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import type { RawSource } from "../config/sources.ts";

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

export function rawPath(rawDir: string, s: RawSource): string {
  return join(rawDir, s.id, s.file);
}

/** Download (if missing) and verify a pinned raw file. Never overwrites a verified file. */
export async function ensureRaw(rawDir: string, s: RawSource, log = console.log): Promise<string> {
  const dest = rawPath(rawDir, s);
  if (!existsSync(dest)) {
    mkdirSync(join(rawDir, s.id), { recursive: true });
    log(`download ${s.url}`);
    const res = await fetch(s.url);
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${s.url}`);
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    await rename(tmp, dest);
  }
  const got = await sha256File(dest);
  if (got !== s.sha256) {
    throw new Error(
      `sha256 mismatch for ${dest}\n  expected ${s.sha256}\n  got      ${got}\n` +
        `Upstream may have changed. Review the new file and update config/sources.ts + sources/catalog.json.`,
    );
  }
  if (statSync(dest).size !== s.bytes) throw new Error(`size mismatch for ${dest}`);
  return dest;
}

/** Extract selected entries with the system `unzip` (available on ubuntu runners). */
export function unzip(zip: string, outDir: string, patterns: string[] = []): void {
  mkdirSync(outDir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zip, ...patterns, "-d", outDir], { stdio: "inherit" });
}

export function findFile(dir: string, re: RegExp): string {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (re.test(e.name)) return p;
    }
  }
  throw new Error(`no file matching ${re} under ${dir}`);
}
