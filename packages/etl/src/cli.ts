#!/usr/bin/env -S npx tsx
/**
 * tw-etl fetch   download + verify pinned raw sources into data/raw
 * tw-etl build   fetch, extract, validate, build boundaries, write data/out/v1/...
 *
 * Paths default to <repo>/data/{raw,work,out}; override with --raw/--work/--out.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { build, fetchAll } from "./pipeline.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { raw: { type: "string" }, work: { type: "string" }, out: { type: "string" } },
});
const repoRoot = resolve(import.meta.dirname, "../../..");
const opts = {
  repoRoot,
  rawDir: resolve(values.raw ?? `${repoRoot}/data/raw`),
  workDir: resolve(values.work ?? `${repoRoot}/data/work`),
  outDir: resolve(values.out ?? `${repoRoot}/data/out`),
};

const cmd = positionals[0];
if (cmd === "fetch") {
  await fetchAll(opts);
  console.log("raw sources verified");
} else if (cmd === "build") {
  const r = await build(opts);
  if (!r.ok) {
    console.error("validation failed — nothing published; see data/out/reports/failed.md");
    process.exit(1);
  }
} else {
  console.error("usage: tw-etl <fetch|build> [--raw dir] [--work dir] [--out dir]");
  process.exit(2);
}
