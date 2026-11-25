import { useEffect, useState } from "react";
import { Alert, Badge, Group, Progress, Stack, Text } from "@mantine/core";
import type { LiveManifestFile, LiveSnapshotFile } from "@tw-election/schema";
import { STATUS_LABEL, fmtTaipei, isStale, type UnitProgress } from "../lib/live.ts";

export const PROGRESS_UNIT_LABEL = { station: "投開票所", village: "村里（模擬）" } as const;

/** Re-render every 15 s so the "not updated" warning appears without a new snapshot. */
function useNow(stepMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

/** Overall progress: the national row, else the sum of county rows. */
export function overallProgress(s: LiveSnapshotFile | null): UnitProgress | null {
  if (!s) return null;
  const nat = s.rows.find((r) => r.level === "national");
  const rows = nat ? [nat] : s.rows.filter((r) => r.level === "county");
  if (rows.length === 0) return null;
  return { reported: rows.reduce((a, r) => a + r.reported, 0), total: rows.reduce((a, r) => a + r.total, 0), stale: rows.some((r) => r.stale), asOf: null };
}

export function LiveBanner({ manifest, snapshot }: { manifest: LiveManifestFile; snapshot: LiveSnapshotFile | null }) {
  const now = useNow();
  const status = snapshot?.status ?? "not-started";
  const replay = manifest.mode === "replay";
  const p = overallProgress(snapshot);
  const pct = p && p.total > 0 ? (100 * p.reported) / p.total : 0;
  const unitLabel = PROGRESS_UNIT_LABEL[snapshot?.progressUnit ?? "station"];
  const stale = isStale(snapshot, manifest.pollIntervalSeconds, now);
  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="wrap">
        {replay && <Badge color="grape" variant="filled">模擬</Badge>}
        <Badge color={status === "counting" ? "red" : status === "final" ? "teal" : "gray"} variant={status === "counting" ? "filled" : "light"}>
          {STATUS_LABEL[status]}
        </Badge>
        <Text size="sm" fw={600}>{manifest.election.nameZh}</Text>
        {snapshot && status !== "not-started" && <Text size="xs" c="dimmed">資料時間 {fmtTaipei(snapshot.asOf)}</Text>}
      </Group>
      {status === "not-started" ? (
        <Text size="sm">{replay ? "模擬尚未開始。" : "投票於 16:00 結束後開始開票。開票前得票數皆為 0，本站不提供任何預測、勝率或民調數字。"}</Text>
      ) : (
        p && (
          <Stack gap={2}>
            <Progress value={pct} size="sm" aria-label="開票進度" />
            <Text size="xs">
              已回報 {p.reported.toLocaleString("zh-TW")} / {p.total.toLocaleString("zh-TW")} {unitLabel}（{pct.toFixed(1)}%）
            </Text>
          </Stack>
        )
      )}
      <Text size="xs" c="dimmed">{manifest.labelZh}</Text>
      <Text size="xs" c="dimmed">{manifest.source.attribution ?? `資料來源：${manifest.source.publisher}`}</Text>
      {stale && (
        <Alert color="yellow" p="xs">
          <Text size="xs">數字已超過 {Math.round((3 * manifest.pollIntervalSeconds) / 60)} 分鐘沒有更新，可能是來源暫時無法讀取。</Text>
        </Alert>
      )}
    </Stack>
  );
}

export function LiveUnitProgress({ progress, unitLabel }: { progress: UnitProgress | undefined; unitLabel: string }) {
  if (!progress) return <Text size="xs" c="dimmed">此區域尚無回報。</Text>;
  return (
    <Text size="xs" c={progress.stale ? "yellow.8" : "dimmed"}>
      已回報 {progress.reported.toLocaleString("zh-TW")} / {progress.total.toLocaleString("zh-TW")} {unitLabel}
      {progress.asOf ? `・資料時間 ${fmtTaipei(progress.asOf)}` : ""}
      {progress.stale ? "・本輪讀取失敗，顯示上一輪數字" : ""}
    </Text>
  );
}
