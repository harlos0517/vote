import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
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
    // Prefer our public mirror (same bytes, checked below) when RAW_MIRROR_URL is set,
    // e.g. https://vote-data.harlos.tw — upstream URLs are overwritten in place.
    const mirror = process.env.RAW_MIRROR_URL?.replace(/\/$/, "");
    const urls = [...(mirror ? [`${mirror}/raw/${s.id}/${s.sha256}/${s.file}`] : []), s.url];
    // curl, not fetch(): www.land.moi.gov.tw sends an obs-folded multi-line header
    // that Node's undici rejects ("Unexpected whitespace after header value").
    const tmp = `${dest}.part`;
    let lastErr: unknown;
    for (const url of urls) {
      log(`download ${url}`);
      try {
        // Fail fast on unreachable hosts (some government sites drop non-Taiwan IPs,
        // which otherwise hangs ~2 min per attempt); allow slow but live transfers.
        execFileSync(
          "curl",
          ["-fsSL", "--connect-timeout", "20", "--max-time", "1200", "--retry", "2", "--retry-delay", "5", "-o", tmp, url],
          { stdio: "inherit" },
        );
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      throw new Error(
        `could not download ${s.id}/${s.file} from any of:\n  ${urls.join("\n  ")}\n` +
          `If the upstream host is unreachable from this network (e.g. CI outside Taiwan), seed the public mirror ` +
          `from a machine that can reach it: see docs/deployment.md "Seeding the raw mirror".`,
        { cause: lastErr },
      );
    }
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
