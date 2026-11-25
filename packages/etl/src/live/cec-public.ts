/**
 * cec-public: read CEC's public live-count site and turn it into live snapshots.
 *
 * Structure known from the 2024 (vote2024.cec.gov.tw) and 2025 (vote.cec.gov.tw) sites, and
 * for referendums from 2018 (referendum.2018.nat.gov.tw), archived by the Internet Archive;
 * see docs/live-feed.md. Whether 2026 is the same can only
 * be checked once the site opens on election day, so every assumption below fails loudly.
 *
 *   result page   <base>/<prefix>/<c5><y2><d3><v3><b4>.html   (HTML fragment)
 *                 prefix = CEC election-type code (P1, L1…L4, and presumably C1, T1… in 2026)
 *                 c county, y electoral district, d town, v village, b polling station
 *
 * Rules this poller keeps (docs/live-feed.md): read only what the site serves openly, from one
 * process, a few requests at a time; on 403/429 stop for good and switch to manual entry
 * instead of working around the block.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_SCHEMA_VERSION,
  LiveManifestFile,
  LiveSnapshotFile,
  type BallotChoice,
  type Contest,
  type GroupMetadataFile,
  type GroupResultsFile,
  type LiveGroupMetadataRef,
  type LiveRow,
  type LiveStatus,
  type ReportingLevel,
} from "@tw-election/schema";
import { livePaths, writeAtomic } from "./files.ts";
import { nameKey } from "./prelim.ts";

// ---------------------------------------------------------------------------------------
// Parsing one result page

export interface ParsedChoice {
  ballotNumber: number;
  /** Candidate names (two for a president ticket) or the party name. */
  names: string[];
  votes: number;
  elected: boolean;
}

export interface ParsedReferendum {
  agree: number;
  disagree: number;
  valid: number | null;
  invalid: number | null;
  ballotsCast: number | null;
  electors: number | null;
}

export interface ParsedPage {
  kind: "candidates" | "referendum";
  title: string;
  reported: number;
  total: number;
  /** "MM/DD HH:mm" or "MM/DD HH:mm:ss" as printed, in Taiwan time. */
  dataTime: string | null;
  /** Candidate or party rows; empty for a referendum. */
  choices: ParsedChoice[];
  referendum: ParsedReferendum | null;
}

export class PageFormatError extends Error {
  override name = "PageFormatError";
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const int = (s: string) => {
  const t = s.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(t)) throw new PageFormatError(`not a count: "${s}"`);
  return Number(t);
};

// "已送投票所數/總投票所數: 17795/17795" (2024) or "投開票所數 已送/應送: 15,886/15,887" (2018).
const PROGRESS_RE = /(?:已送投票所數\s*\/\s*總投票所數|已送\s*\/\s*應送)\s*[:：]?\s*([\d,]+)\s*\/\s*([\d,]+)/;
// "資料時間: 01/13 22:21" (2024) or "資料更新時間：11/25 03:42:01" (2018).
const TIME_RE = /資料(?:更新)?時間\s*[:：]\s*(\d{2}\/\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/;

export function parseResultPage(html: string): ParsedPage {
  const flat = text(html);
  const progress = PROGRESS_RE.exec(flat);
  if (!progress) throw new PageFormatError("no 已送/應送 polling-station count on the page");
  const time = TIME_RE.exec(flat);
  const head = { reported: int(progress[1]!), total: int(progress[2]!), dataTime: time?.[1]?.replace(/\s+/, " ") ?? null };
  if (flat.includes("同意票數")) {
    return { kind: "referendum", title: /第\d+案[^：:]*?公民投票結果[^第]*/.exec(flat)?.[0]?.trim() ?? "", ...head, choices: [], referendum: parseReferendumNumbers(html) };
  }
  const title = text(/vote-table-header-title[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "");

  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1];
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1];
  if (!thead || tbody === undefined) throw new PageFormatError("no result table");
  const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]!));
  const col = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const iNo = col("號次");
  const iName = col("候選人姓名", "政黨");
  const iVotes = col("得票數");
  const iMark = col("註記");
  if (iNo < 0 || iName < 0 || iVotes < 0) throw new PageFormatError(`unexpected columns: ${headers.join(" | ")}`);

  const choices: ParsedChoice[] = [];
  for (const tr of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    if (cells.length !== headers.length) throw new PageFormatError(`row has ${cells.length} cells, header has ${headers.length}`);
    const divs = [...cells[iName]!.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]!)).filter(Boolean);
    choices.push({
      ballotNumber: int(text(cells[iNo]!)),
      names: divs.length > 0 ? divs : [text(cells[iName]!)],
      votes: int(text(cells[iVotes]!)),
      elected: iMark >= 0 && text(cells[iMark]!).includes("◎"),
    });
  }
  if (choices.length === 0) throw new PageFormatError("result table is empty");
  return { kind: "candidates", title, ...head, choices, referendum: null };
}

const REFERENDUM_LABELS: Record<string, keyof ParsedReferendum> = {
  同意票數: "agree",
  不同意票數: "disagree",
  有效票數: "valid",
  無效票數: "invalid",
  投票數: "ballotsCast",
  投票權人數: "electors",
};

/**
 * Referendum numbers by label, not by position: a run of header cells followed by as many
 * value cells, keeping the labels we know. That fits the 2018 tables (a header row, then a
 * value row) and should survive a re-layout that keeps the labels. Labels are matched whole,
 * so 「有效同意票數對投票權人數百分比」 is not mistaken for 投票權人數.
 */
function parseReferendumNumbers(html: string): ParsedReferendum {
  const cells = [...html.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)(?=<\/t[hd]>|<t[hd]\b|<\/tr>)/g)].map((m) => text(m[1]!).replace(/\s/g, ""));
  const isValue = (c: string) => /^[\d,]+(?:\.\d+)?%?$/.test(c);
  const found: Partial<ParsedReferendum> = {};
  for (let i = 0; i < cells.length; ) {
    let j = i;
    while (j < cells.length && cells[j] !== "" && !isValue(cells[j]!)) j++;
    let n = 0;
    while (j + n < cells.length && isValue(cells[j + n]!)) n++;
    // Pair the value run with the header cells right before it, so a stray text cell earlier
    // in the run (a question, a caption) cannot shift the columns.
    const headers = cells.slice(Math.max(i, j - n), j);
    const values = cells.slice(j, j + headers.length);
    if (n > 0 && headers.length === n && headers.some((h) => h in REFERENDUM_LABELS)) {
      headers.forEach((h, k) => {
        const key = REFERENDUM_LABELS[h];
        if (!key) return;
        const v = int(values[k]!);
        if (found[key] !== undefined && found[key] !== v) throw new PageFormatError(`${h} appears twice with different numbers`);
        found[key] = v;
      });
      i = j + n;
    } else {
      i = Math.max(j + n, i + 1);
    }
  }
  if (found.agree === undefined || found.disagree === undefined) throw new PageFormatError("no 同意票數／不同意票數 on the referendum page");
  return { agree: found.agree, disagree: found.disagree, valid: found.valid ?? null, invalid: found.invalid ?? null, ballotsCast: found.ballotsCast ?? null, electors: found.electors ?? null };
}

/** "01/13 22:21" + election date → "2024-01-13T22:21:00+08:00". */
export function dataTimeIso(dataTime: string, electionDate: string): string {
  const m = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dataTime);
  if (!m) throw new PageFormatError(`bad 資料時間 "${dataTime}"`);
  return `${electionDate.slice(0, 4)}-${m[1]}-${m[2]}T${m[3]}:${m[4]}:${m[5] ?? "00"}+08:00`;
}

// ---------------------------------------------------------------------------------------
// Which page holds which unit

/** Page path for a unit, e.g. ("P1", "nat") → "P1/00000000000000000.html". Null for units CEC has no page for. */
export function pagePath(prefix: string, unitId: string): string | null {
  let c = "00000", y = "00", d = "000", v = "000";
  let m: RegExpExecArray | null;
  if (unitId === "nat") {
    // national page: all zeros
  } else if ((m = /^cty:(\d{5})$/.exec(unitId))) {
    c = m[1]!;
  } else if ((m = /^dist:(\d{5})-(\d{2})$/.exec(unitId))) {
    [c, y] = [m[1]!, m[2]!];
  } else if ((m = /^town:(\d{5})(\d{3})$/.exec(unitId))) {
    [c, d] = [m[1]!, m[2]!];
  } else if ((m = /^tp:(\d{5})(\d{3})-(\d{2})$/.exec(unitId))) {
    [c, d, y] = [m[1]!, m[2]!, m[3]!];
  } else if ((m = /^vil:(\d{5})(\d{3})(\d{3})$/.exec(unitId))) {
    [c, d, v] = [m[1]!, m[2]!, m[3]!];
  } else {
    return null; // village groups and stations: not fetched live
  }
  return `${prefix}/${c}${y}${d}${v}0000.html`;
}

/**
 * CEC page prefix for a contest. 2024 national contests carry no type code in votedata.
 * Referendums have none either, and their page code is not predictable (2018 used the case's
 * position, "01" for 第7案), so they need an explicit override.
 */
export function prefixFor(contest: Contest, overrides: Record<string, string> = {}): string {
  const o = overrides[contest.id];
  if (o) return o;
  if (contest.cecTypeCode) return contest.cecTypeCode;
  if (contest.choiceKind === "referendum") throw new Error(`${contest.id}: referendum page code unknown; pass --prefix ${contest.id}=<code>`);
  const byOffice: Partial<Record<Contest["office"], string>> = {
    president: "P1",
    "legislator-district": "L1",
    "legislator-lowland-indigenous": "L2",
    "legislator-highland-indigenous": "L3",
    "legislator-party-list": "L4",
  };
  const p = byOffice[contest.office];
  if (!p) throw new Error(`${contest.id}: no CEC page prefix known for office ${contest.office}`);
  return p;
}

// ---------------------------------------------------------------------------------------
// Page → LiveRow

const norm = (s: string) => s.replace(/[\s／/]/g, "");

export interface RowResult {
  row: LiveRow;
  warnings: string[];
}

/** Match a parsed page to a contest's choices by ballot number; names are only cross-checked. */
export function pageToRow(page: ParsedPage, unit: string, level: ReportingLevel, contest: Contest, choices: BallotChoice[], electionDate: string): RowResult {
  const mine = choices.filter((c) => c.contestId === contest.id);
  if (contest.choiceKind === "referendum" || page.kind === "referendum") return referendumRow(page, unit, level, contest, mine, electionDate);
  if (mine.length > 0 && mine.every((c) => c.ballotNumber === null)) return rowByName(page, unit, level, contest, mine, electionDate);
  const byNo = new Map(mine.map((c) => [c.ballotNumber, c]));
  const warnings: string[] = [];
  const votes: Record<string, number> = Object.fromEntries(mine.map((c) => [c.id, 0]));
  let nameMismatches = 0;
  for (const p of page.choices) {
    const c = byNo.get(p.ballotNumber);
    if (!c) throw new PageFormatError(`${unit}: page has 號次 ${p.ballotNumber}, which ${contest.id} does not`);
    if (norm(p.names.join("")) !== norm(c.labelZh)) {
      nameMismatches++;
      warnings.push(`${unit} 號次 ${p.ballotNumber}: page says "${p.names.join("／")}", metadata says "${c.labelZh}"`);
    }
    votes[c.id] = p.votes;
  }
  if (page.choices.length !== mine.length) warnings.push(`${unit}: page lists ${page.choices.length} choices, ${contest.id} has ${mine.length}`);
  // A name can differ for a rare character (CEC private-use glyphs); most of them cannot.
  if (nameMismatches > mine.length / 2) throw new PageFormatError(`${unit}: most names differ from ${contest.id}; wrong page or wrong candidate list`);
  const row: LiveRow = {
    unit,
    level,
    reported: page.reported,
    total: page.total,
    summary: { electors: null, ballotsCast: null, valid: null, invalid: null, population: null },
    votes,
  };
  if (page.dataTime) row.asOf = dataTimeIso(page.dataTime, electionDate);
  return { row, warnings };
}

/**
 * A page whose candidates cannot be tied to the contest's (roster) candidates by name. Only this
 * page fails, as a fetch failure would: the rest of the group keeps updating, and the log says
 * which names to check.
 */
export class NameMatchError extends Error {
  override name = "NameMatchError";
}

/**
 * Contests known only from the registration roster (no ballot numbers): match page rows by the
 * Han characters of the name (nameKey). If exactly one row on each side is left over, they are
 * paired with a warning (a rare character written differently); anything else fails this page.
 * Roster candidates missing from the page (withdrawn, disqualified) keep 0 votes.
 */
function rowByName(page: ParsedPage, unit: string, level: ReportingLevel, contest: Contest, mine: BallotChoice[], electionDate: string): RowResult {
  const warnings: string[] = [];
  const byKey = new Map(mine.map((c) => [nameKey(c.labelZh), c]));
  const votes: Record<string, number> = Object.fromEntries(mine.map((c) => [c.id, 0]));
  const used = new Set<string>();
  const leftover: ParsedChoice[] = [];
  for (const p of page.choices) {
    const c = byKey.get(nameKey(p.names.join("")));
    if (c && !used.has(c.id)) {
      used.add(c.id);
      votes[c.id] = p.votes;
    } else leftover.push(p);
  }
  const unused = mine.filter((c) => !used.has(c.id));
  if (leftover.length === 1 && unused.length === 1) {
    warnings.push(`${unit}: paired page "${leftover[0]!.names.join("／")}" (號次 ${leftover[0]!.ballotNumber}) with roster "${unused[0]!.labelZh}" by elimination`);
    votes[unused[0]!.id] = leftover[0]!.votes;
  } else if (leftover.length > 0) {
    throw new NameMatchError(`${unit}: page names not in the roster for ${contest.id}: ${leftover.map((p) => p.names.join("／")).join("、")}`);
  } else if (unused.length > 0) {
    warnings.push(`${unit}: not on the page (0 votes): ${unused.map((c) => c.labelZh).join("、")}`);
  }
  const row: LiveRow = { unit, level, reported: page.reported, total: page.total, summary: { electors: null, ballotsCast: null, valid: null, invalid: null, population: null }, votes };
  if (page.dataTime) row.asOf = dataTimeIso(page.dataTime, electionDate);
  return { row, warnings };
}

function referendumRow(page: ParsedPage, unit: string, level: ReportingLevel, contest: Contest, mine: BallotChoice[], electionDate: string): RowResult {
  if (page.kind !== "referendum" || !page.referendum) throw new PageFormatError(`${unit}: ${contest.id} is a referendum but the page is not`);
  if (contest.choiceKind !== "referendum") throw new PageFormatError(`${unit}: referendum page for non-referendum ${contest.id}`);
  const agree = mine.find((c) => c.kind === "agree");
  const disagree = mine.find((c) => c.kind === "disagree");
  if (!agree || !disagree) throw new Error(`${contest.id}: no agree/disagree choices`);
  const r = page.referendum;
  const warnings: string[] = [];
  if (r.valid !== null && r.valid !== r.agree + r.disagree) warnings.push(`${unit}: 有效票數 ${r.valid} ≠ 同意 + 不同意 ${r.agree + r.disagree}`);
  const row: LiveRow = {
    unit,
    level,
    reported: page.reported,
    total: page.total,
    summary: { electors: r.electors, ballotsCast: r.ballotsCast, valid: r.valid, invalid: r.invalid, population: null },
    votes: { [agree.id]: r.agree, [disagree.id]: r.disagree },
  };
  if (page.dataTime) row.asOf = dataTimeIso(page.dataTime, electionDate);
  return { row, warnings };
}

// ---------------------------------------------------------------------------------------
// One polling cycle for a group

export interface GroupPlan {
  metadata: GroupMetadataFile;
  /** Static results files (for units and parent links); only `units` is used. */
  results: Partial<Record<ReportingLevel, Pick<GroupResultsFile, "units">>>;
  /** Levels to emit. Units with one contest are fetched; the rest are summed from children. */
  levels: ReportingLevel[];
  /** contestId → page prefix, for contests whose code cannot be derived (referendums). */
  prefixes?: Record<string, string>;
}

export type Fetcher = (path: string) => Promise<{ status: number; body: string }>;

export class BlockedError extends Error {
  override name = "BlockedError";
}

export interface CycleResult {
  snapshot: LiveSnapshotFile;
  fetched: number;
  failed: number;
  warnings: string[];
}

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

export async function pollGroupOnce(
  plan: GroupPlan,
  fetchPage: Fetcher,
  prev: LiveSnapshotFile | null,
  opts: { feedId: string; concurrency: number; now?: () => Date },
): Promise<CycleResult> {
  const { metadata } = plan;
  const contests = new Map(metadata.contests.map((c) => [c.id, c]));
  const units = plan.levels.flatMap((level) => {
    const f = plan.results[level];
    if (!f) throw new Error(`${metadata.group.id}: no ${level} units`);
    return f.units.map((u) => ({ ...u, level }));
  });
  const parent = new Map<string, string | null>();
  for (const f of Object.values(plan.results)) for (const u of f!.units) parent.set(u.id, u.parentId);

  const prefixOf = (contestId: string) => prefixFor(contests.get(contestId)!, plan.prefixes);
  const toFetch = units.filter((u) => u.contestIds.length === 1 && pagePath(prefixOf(u.contestIds[0]!), u.id) !== null);
  const fetchedIds = new Set(toFetch.map((u) => u.id));
  const prevRows = new Map(prev?.rows.map((r) => [r.unit, r]) ?? []);
  const rows = new Map<string, LiveRow>();
  const warnings: string[] = [];
  let failed = 0;
  let blocked: BlockedError | null = null;

  await pool(toFetch, opts.concurrency, async (u) => {
    if (blocked) return;
    const contest = contests.get(u.contestIds[0]!)!;
    const path = pagePath(prefixOf(contest.id), u.id)!;
    try {
      const res = await fetchPage(path);
      if (res.status === 403 || res.status === 429) {
        blocked = new BlockedError(`${path}: HTTP ${res.status}`);
        return;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const r = pageToRow(parseResultPage(res.body), u.id, u.level, contest, metadata.choices, metadata.election.date);
      rows.set(u.id, r.row);
      warnings.push(...r.warnings);
    } catch (e) {
      if (e instanceof PageFormatError) throw e; // the site changed: stop, do not guess
      failed++;
      const old = prevRows.get(u.id);
      if (old) rows.set(u.id, { ...old, stale: true });
      warnings.push(`${path}: ${(e as Error).message}`);
    }
  });
  if (blocked) throw blocked;

  // Units spanning several contests (a county in the councilor group, the national total of
  // the mayor group) are summed from fetched children, finest first.
  const levelRank: ReportingLevel[] = ["station", "village", "town", "district", "county", "national"];
  const summed = units.filter((u) => !fetchedIds.has(u.id)).sort((a, b) => levelRank.indexOf(a.level) - levelRank.indexOf(b.level));
  for (const u of summed) {
    const kids = [...rows.values()].filter((r) => parent.get(r.unit) === u.id);
    if (kids.length === 0) continue;
    const votes: Record<string, number> = {};
    for (const k of kids) for (const [id, v] of Object.entries(k.votes)) votes[id] = (votes[id] ?? 0) + v;
    // A summary field is summed only when every child has it.
    const sumField = (f: "electors" | "ballotsCast" | "valid" | "invalid") => (kids.every((k) => k.summary[f] !== null) ? kids.reduce((s, k) => s + k.summary[f]!, 0) : null);
    rows.set(u.id, {
      unit: u.id,
      level: u.level,
      reported: kids.reduce((s, k) => s + k.reported, 0),
      total: kids.reduce((s, k) => s + k.total, 0),
      summary: { electors: sumField("electors"), ballotsCast: sumField("ballotsCast"), valid: sumField("valid"), invalid: sumField("invalid"), population: null },
      votes,
      ...(kids.some((k) => k.stale) ? { stale: true } : {}),
    });
  }

  const out = units.map((u) => rows.get(u.id)).filter((r): r is LiveRow => r !== undefined);
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const times = out.map((r) => r.asOf).filter((t): t is string => !!t).sort((a, b) => Date.parse(a) - Date.parse(b));
  const fetchedRows = out.filter((r) => fetchedIds.has(r.unit));
  const status: LiveStatus =
    fetchedRows.length === toFetch.length && fetchedRows.every((r) => r.reported === r.total && !r.stale)
      ? "final"
      : fetchedRows.some((r) => r.reported > 0)
        ? "counting"
        : "not-started";
  const snapshot = LiveSnapshotFile.parse({
    liveSchemaVersion: LIVE_SCHEMA_VERSION,
    feedId: opts.feedId,
    groupId: metadata.group.id,
    seq: (prev?.seq ?? -1) + 1,
    status,
    asOf: times[times.length - 1] ?? now,
    generatedAt: now,
    progressUnit: "station",
    rows: out,
  });
  return { snapshot, fetched: toFetch.length - failed, failed, warnings };
}

// ---------------------------------------------------------------------------------------
// The poller

export function httpFetcher(baseUrl: string, timeoutMs = 10_000): Fetcher {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (base.startsWith("file://")) {
    // Saved pages on disk, for rehearsing with recorded or hand-made pages.
    const dir = fileURLToPath(base);
    return async (path) => (existsSync(join(dir, path)) ? { status: 200, body: readFileSync(join(dir, path), "utf8") } : { status: 404, body: "" });
  }
  return async (path) => {
    // The CEC page itself adds "_=<ms>" (jQuery cache:false) on its own 60-second refresh;
    // we do the same, once per page per cycle.
    const res = await fetch(`${base}${path}?_=${Date.now()}`, {
      headers: { "User-Agent": "tw-election-map live-count poller (https://vote.harlos.tw)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  };
}

export interface PollOptions {
  feedDir: string;
  feedId: string;
  plans: (GroupPlan & { metadataRef: LiveGroupMetadataRef })[];
  fetchPage: Fetcher;
  /** The site's address, recorded in the manifest. */
  sourceUrl: string;
  intervalSeconds: number;
  concurrency: number;
  once?: boolean;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Runs after each cycle's files are written (e.g. upload to R2). Its errors are logged, not fatal. */
  afterCycle?: () => Promise<void>;
}

/**
 * Polls until every group is final, the STOP file appears, or CEC blocks us. Each cycle
 * writes a numbered snapshot, latest.json and the manifest. Failures back off up to 10 minutes.
 */
export async function runCecPoller(o: PollOptions): Promise<"final" | "stopped" | "once"> {
  const log = o.log ?? console.log;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const first = o.plans[0]!.metadata;
  const manifestPath = join(o.feedDir, livePaths.manifest());
  const readLatest = (groupId: string) => {
    const p = join(o.feedDir, livePaths.latest(groupId));
    return existsSync(p) ? LiveSnapshotFile.parse(JSON.parse(readFileSync(p, "utf8"))) : null;
  };
  let backoff = 1;
  for (;;) {
    if (existsSync(join(o.feedDir, livePaths.stop()))) {
      log("STOP file found; stopping");
      return "stopped";
    }
    const groups: LiveManifestFile["groups"] = [];
    let failed = 0;
    let total = 0;
    for (const plan of o.plans) {
      const prev = readLatest(plan.metadata.group.id);
      const r = await pollGroupOnce(plan, o.fetchPage, prev, { feedId: o.feedId, concurrency: o.concurrency });
      writeAtomic(join(o.feedDir, livePaths.snapshot(plan.metadata.group.id, r.snapshot.seq)), JSON.stringify(r.snapshot));
      writeAtomic(join(o.feedDir, livePaths.latest(plan.metadata.group.id)), JSON.stringify(r.snapshot));
      failed += r.failed;
      total += r.fetched + r.failed;
      for (const w of r.warnings) log(`  warn ${w}`);
      log(`${plan.metadata.group.id}: seq ${r.snapshot.seq} ${r.snapshot.status}, ${r.fetched} pages ok, ${r.failed} failed, data time ${r.snapshot.asOf}`);
      groups.push({
        groupId: plan.metadata.group.id,
        nameZh: plan.metadata.group.nameZh,
        metadata: plan.metadataRef,
        latest: livePaths.latest(plan.metadata.group.id),
        seq: r.snapshot.seq,
        status: r.snapshot.status,
      });
    }
    // Groups this run does not poll (e.g. one left out until its page code is known) keep
    // their entries; so does the feed's election when it already has one.
    const old = existsSync(manifestPath) ? LiveManifestFile.parse(JSON.parse(readFileSync(manifestPath, "utf8"))) : null;
    const polled = new Set(groups.map((g) => g.groupId));
    const manifest = LiveManifestFile.parse({
      liveSchemaVersion: LIVE_SCHEMA_VERSION,
      feedId: o.feedId,
      mode: "cec-public",
      labelZh: "開票中數字取自中央選舉委員會開票網站，非最終結果，以中央選舉委員會公告為準",
      election: old?.election ?? { id: first.election.id, nameZh: first.election.nameZh, date: first.election.date },
      // The site states no licence; record that rather than guess one.
      source: { id: "cec-live", publisher: "中央選舉委員會", title: "計票資訊查詢網站", url: o.sourceUrl, license: "未標示", attribution: "資料來源：中央選舉委員會" },
      pollIntervalSeconds: o.intervalSeconds,
      updatedAt: new Date().toISOString(),
      groups: [...(old?.groups.filter((g) => !polled.has(g.groupId)) ?? []), ...groups],
    });
    writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    if (o.afterCycle) {
      try {
        await o.afterCycle();
      } catch (e) {
        log(`  after-cycle step failed (will retry next cycle): ${(e as Error).message}`);
      }
    }
    if (o.once) return "once";
    if (groups.every((g) => g.status === "final")) {
      log("all groups final; stopping");
      return "final";
    }
    backoff = total > 0 && failed / total > 0.5 ? Math.min(backoff * 2, Math.ceil(600 / o.intervalSeconds)) : 1;
    if (backoff > 1) log(`most pages failed; next cycle in ${o.intervalSeconds * backoff}s`);
    await sleep(o.intervalSeconds * backoff * 1000);
  }
}
