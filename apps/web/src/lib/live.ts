/**
 * Live counts (docs/live-feed.md): turn a snapshot into the GroupResultsFile shape the map,
 * ring and sidebar already use, so the historical views work unchanged while counting.
 */
import type { GroupMetadataFile, GroupResultsFile, LiveSnapshotFile, LiveStatus } from "@tw-election/schema";

export interface UnitProgress {
  reported: number;
  total: number;
  stale: boolean;
  asOf: string | null;
}

/**
 * One row per unit of the level. Units the snapshot has no row for (nothing reported yet, or
 * before counting) get zero votes, so the map draws them as 無資料 rather than dropping them.
 * 有效票 is filled from the vote sum when the source does not give it (candidate pages don't):
 * it is exactly the sum of the candidates' votes. Other summary fields stay unknown.
 */
export function liveResults(meta: GroupMetadataFile, units: GroupResultsFile, snapshot: LiveSnapshotFile | null): GroupResultsFile {
  const byUnit = new Map(snapshot?.rows.map((r) => [r.unit, r]) ?? []);
  const choicesOf = new Map<string, string[]>();
  for (const c of meta.choices) choicesOf.set(c.contestId, [...(choicesOf.get(c.contestId) ?? []), c.id]);
  return {
    ...units,
    rows: units.units.map((u) => {
      const r = byUnit.get(u.id);
      const zero = Object.fromEntries(u.contestIds.flatMap((c) => choicesOf.get(c) ?? []).map((id) => [id, 0]));
      const votes = { ...zero, ...(r?.votes ?? {}) };
      const sum = Object.values(votes).reduce((a, b) => a + b, 0);
      const s = r?.summary;
      return {
        unit: u.id,
        summary: {
          electors: s?.electors ?? null,
          ballotsCast: s?.ballotsCast ?? null,
          valid: s?.valid ?? sum,
          invalid: s?.invalid ?? null,
          population: null,
        },
        votes,
      };
    }),
  };
}

export function progressByUnit(snapshot: LiveSnapshotFile | null): Map<string, UnitProgress> {
  return new Map(snapshot?.rows.map((r) => [r.unit, { reported: r.reported, total: r.total, stale: !!r.stale, asOf: r.asOf ?? null }]) ?? []);
}

/** Keep the newest snapshot: a CDN can briefly serve an older latest.json after a newer one. */
export function newer(prev: LiveSnapshotFile | null, next: LiveSnapshotFile | undefined): LiveSnapshotFile | null {
  if (!next) return prev;
  if (!prev || prev.groupId !== next.groupId || prev.feedId !== next.feedId) return next;
  return next.seq >= prev.seq ? next : prev;
}

/**
 * Whether the page should warn that numbers may be old: nothing new for three poll intervals
 * while counting. Uses the file's write time, not the upstream data time.
 */
export function isStale(snapshot: LiveSnapshotFile | null, pollSeconds: number, now: number): boolean {
  if (!snapshot || snapshot.status !== "counting") return false;
  return now - Date.parse(snapshot.generatedAt) > 3 * pollSeconds * 1000;
}

export const STATUS_LABEL: Record<LiveStatus, string> = {
  "not-started": "尚未開票",
  counting: "開票中",
  final: "開票完成",
};

/** "2026-11-28T17:05:00+08:00" → "11/28 17:05" in Taiwan time, whatever the reader's time zone. */
export function fmtTaipei(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Map levels to offer while counting: those with rows in the snapshot, else all but 村里. */
export function liveLevels<L extends string>(groupLevels: L[], snapshot: LiveSnapshotFile | null): L[] {
  const withRows = new Set<string>(snapshot?.rows.map((r) => r.level) ?? []);
  const shown = groupLevels.filter((l) => withRows.has(l));
  return shown.length > 0 ? shown : groupLevels.filter((l) => l !== "village");
}
