import { useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { DataError } from "@tw-election/data-client";
import { ElectionMap } from "./components/ElectionMap.tsx";
import { LeaderLegend, ShareLegend } from "./components/Legend.tsx";
import { SourceNotes } from "./components/SourceNotes.tsx";
import { UnitDetail } from "./components/UnitDetail.tsx";
import { leaderColor, NO_DATA, shareScale } from "./lib/colors.ts";
import { useContest, useGeography, useManifest, useReleaseIndex, useResults } from "./lib/queries.ts";
import { fmtInt, fmtPct, toUnitViews } from "./lib/results.ts";
import { type MapLevel, useViewState } from "./lib/viewState.ts";
import classes from "./App.module.css";

const LEVEL_LABEL: Record<MapLevel, string> = { county: "縣市", town: "鄉鎮市區" };

export function App() {
  const [view, setView] = useViewState();
  const manifest = useManifest();
  const release = manifest.data?.currentRelease;
  const index = useReleaseIndex(release);

  const contests = useMemo(
    () => index.data?.elections.flatMap((e) => e.contests.map((c) => ({ value: c.id, label: `${e.nameZh}｜${c.nameZh}`, levels: c.availableLevels }))) ?? [],
    [index.data],
  );
  const contestId = view.contest && contests.some((c) => c.value === view.contest) ? view.contest : (contests[0]?.value ?? null);
  const meta = useContest(release, contestId);
  const m = meta.data;

  const level: MapLevel = m && !m.contest.availableLevels.includes(view.level) ? "county" : view.level;
  const results = useResults(release, m?.results[level]);
  const national = useResults(release, m?.results.national);
  const geo = useGeography(release, m?.boundary.files[level]);

  const units = useMemo(() => (results.data ? toUnitViews(results.data) : null), [results.data]);
  const nationalUnit = useMemo(() => (national.data ? [...toUnitViews(national.data).values()][0] : undefined), [national.data]);

  const choiceIndex = Math.max(0, m?.choices.findIndex((c) => c.id === view.choice) ?? 0);
  const choice = m?.choices[choiceIndex];

  const { colors, scale } = useMemo(() => {
    const colors = new Map<string, string>();
    if (!units) return { colors, scale: null };
    if (view.mode === "leader") {
      for (const u of units.values()) colors.set(u.code, u.leader === null ? NO_DATA : leaderColor(u.leader));
      return { colors, scale: null };
    }
    const vals = [...units.values()].map((u) => u.shares[choiceIndex]).filter((x): x is number => x !== null && x !== undefined);
    const scale = shareScale(vals);
    for (const u of units.values()) {
      const s = u.shares[choiceIndex];
      colors.set(u.code, s === null || s === undefined ? NO_DATA : scale(s));
    }
    return { colors, scale };
  }, [units, view.mode, choiceIndex]);

  const selectedCode = view.unit?.includes(":") ? view.unit.slice(view.unit.indexOf(":") + 1) : null;
  const selectedUnit = (selectedCode && units?.get(selectedCode)) || nationalUnit;
  const scheme = useComputedColorScheme("light");

  const firstError = [manifest, index, meta, results, national, geo].find((q) => q.isError);
  const loading = [manifest, index, meta, results, geo].some((q) => q.isLoading);

  return (
    <div className={classes.page}>
      <header className={classes.header}>
        <Title order={1} size="h4">臺灣歷史選舉地圖</Title>
        <Select
          aria-label="選擇選舉"
          data={contests}
          value={contestId}
          onChange={(v) => setView({ contest: v, choice: null, unit: null })}
          allowDeselect={false}
          size="xs"
          w={{ base: "100%", sm: 420 }}
          disabled={!contests.length}
        />
      </header>

      <main className={classes.main}>
        <section className={classes.mapPane}>
          {geo.data && units && (
            <ElectionMap
              geo={geo.data}
              colors={colors}
              selected={selectedCode}
              background={scheme === "dark" ? "#1f2023" : "#eef1f4"}
              ariaLabel={`${m?.contest.nameZh ?? ""} ${LEVEL_LABEL[level]}得票地圖`}
              onSelect={(code) => setView({ unit: code ? (units.get(code)?.id ?? null) : null })}
              tooltip={(code, name) => {
                const u = units.get(code);
                if (!u) return [name, "無資料"];
                if (view.mode === "leader") {
                  const c = u.leader === null ? null : m?.choices[u.leader];
                  return [u.name, c ? `最多：${c.labelZh} ${fmtPct(u.shares[u.leader!] ?? null)}` : "同票或無資料"];
                }
                return [u.name, `${choice?.labelZh ?? ""}：${fmtPct(u.shares[choiceIndex] ?? null)}`, `${fmtInt(u.votes[choiceIndex] ?? null)} 票／有效票 ${fmtInt(u.summary.valid)}`];
              }}
            />
          )}
          {loading && !firstError && (
            <Group className={classes.overlayCenter} gap="xs"><Loader size="sm" /><Text size="sm">載入資料中…</Text></Group>
          )}
          {firstError && <ErrorBox error={firstError.error} onRetry={() => firstError.refetch()} />}

          {m && (
            <Paper className={classes.controls} shadow="sm" p="xs" radius="md" withBorder>
              <Stack gap={6}>
                <SegmentedControl
                  size="xs"
                  aria-label="地圖層級"
                  value={level}
                  onChange={(v) => setView({ level: v as MapLevel, unit: null })}
                  data={(["county", "town"] as const).filter((l) => m.contest.availableLevels.includes(l)).map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
                />
                <SegmentedControl
                  size="xs"
                  aria-label="著色方式"
                  value={view.mode}
                  onChange={(v) => setView({ mode: v as "share" | "leader" })}
                  data={[{ value: "share", label: "候選人得票率" }, { value: "leader", label: "得票最多者" }]}
                />
                {view.mode === "share" && (
                  <Select
                    size="xs"
                    aria-label="選擇候選人"
                    data={m.choices.map((c) => ({ value: c.id, label: `${c.ballotNumber} ${c.labelZh}` }))}
                    value={choice?.id ?? null}
                    onChange={(v) => setView({ choice: v })}
                    allowDeselect={false}
                  />
                )}
              </Stack>
            </Paper>
          )}
          {m && units && (
            <Paper className={classes.legend} shadow="sm" p="xs" radius="md" withBorder>
              {view.mode === "share" && scale ? (
                <ShareLegend scale={scale} title={`${choice?.labelZh} 得票率（÷ 有效票）`} />
              ) : (
                <LeaderLegend items={m.choices.map((c, i) => ({ label: `${c.ballotNumber} ${c.labelZh}`, color: leaderColor(i) }))} />
              )}
            </Paper>
          )}
        </section>

        <aside className={classes.panel} aria-label="詳細資料">
          {m && selectedUnit ? (
            <Stack gap="md">
              <UnitDetail
                meta={m}
                unit={selectedUnit}
                level={selectedUnit === nationalUnit ? "national" : level}
                colorOf={(i) => (view.mode === "leader" ? leaderColor(i) : i === choiceIndex ? "#3b528b" : "#9aa0a6")}
                highlightIndex={view.mode === "share" ? choiceIndex : null}
              />
              {selectedUnit !== nationalUnit && (
                <Button variant="subtle" size="xs" onClick={() => setView({ unit: null })}>回到全國</Button>
              )}
              <Text size="xs" c="dimmed">點選地圖上的區域可查看該區詳細票數。</Text>
              <Divider />
              <SourceNotes meta={m} levelLabel={LEVEL_LABEL[level]} />
            </Stack>
          ) : (
            !firstError && <Loader size="sm" />
          )}
        </aside>
      </main>
    </div>
  );
}

function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof DataError ? error.message : "發生未預期的錯誤";
  const url = error instanceof DataError ? error.url : null;
  return (
    <Box className={classes.overlayCenter}>
      <Alert color="red" title="無法載入資料" maw={420}>
        <Stack gap="xs">
          <Text size="sm">{msg}</Text>
          {url && <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>{url}</Text>}
          <Button size="xs" variant="light" color="red" onClick={onRetry}>重新嘗試</Button>
        </Stack>
      </Alert>
    </Box>
  );
}
