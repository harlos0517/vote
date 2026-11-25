/** Paths and writes for live feeds on disk: data/out/live/<feedId>/... (mirrors live/ on R2). */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LIVE_PREFIX } from "@tw-election/schema";

export const livePaths = {
  feed: (outDir: string, feedId: string) => join(outDir, LIVE_PREFIX, feedId),
  manifest: () => "manifest.json",
  latest: (groupId: string) => `groups/${groupId}/latest.json`,
  snapshot: (groupId: string, seq: number) => `groups/${groupId}/snapshots/${String(seq).padStart(4, "0")}.json`,
  /** Create this file to stop a running poller after its current cycle. */
  stop: () => "STOP",
};

/** Write via a temp file and rename, so a reader never sees half a file. */
export function writeAtomic(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
}
