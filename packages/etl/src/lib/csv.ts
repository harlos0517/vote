import { readFileSync } from "node:fs";

/**
 * CEC CSVs: UTF-8 (BOM optional), comma-separated, fields optionally wrapped
 * in double quotes, and — per the CEC format spec — no commas inside fields.
 * We still reject a quoted field containing a comma instead of mis-splitting.
 */
export function parseCecCsv(text: string, opts: { header?: boolean } = {}): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.map((line, i) => splitLine(line, i + 1));
  return opts.header ? rows.slice(1) : rows;
}

function splitLine(line: string, lineNo: number): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else if (ch === ",") throw new Error(`line ${lineNo}: comma inside quoted field (CEC spec forbids it)`);
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") { quoted = true; cur = ""; }
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (quoted) throw new Error(`line ${lineNo}: unterminated quote`);
  out.push(cur.trim());
  return out;
}

export function readCecCsv(path: string, opts: { header?: boolean } = {}): string[][] {
  return parseCecCsv(readFileSync(path, "utf8"), opts);
}

/** Private-use code points (BMP and planes 15–16): CEC's encoding of rare characters. */
export const PUA_RE = /[-\u{F0000}-\u{10FFFD}]/u;
