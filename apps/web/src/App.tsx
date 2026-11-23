import { useMemo, useState } from "react";
import { Alert, Box, Button, Group, Loader, Paper, Select, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import { DataError } from "@tw-election/data-client";
import { Controls } from "./components/Controls.tsx";
import { ElectionMap } from "./components/ElectionMap.tsx";
import { Legend } from "./components/Legend.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { VoteRing, type RingSegment } from "./components/VoteRing.tsx";
import { ABSTAIN_COLOR, INVALID_COLOR } from "./lib/colors.ts";
import { buildMapView } from "./lib/mapView.ts";
import { useContest, useGeography, useManifest, useReleaseIndex, useResults } from "./lib/queries.ts";
import { fmtPct, toUnitViews, turnout, type UnitView } from "./lib/results.ts";
import { type MapLevel, useViewState } from "./lib/viewState.ts";
import { abstained, choiceColors } from "./lib/views.ts";
import classes from "./App.module.css";

const LEVEL_LABEL: Record<MapLevel, string> = { county: "縣市", town: "鄉鎮市區" };

export function App() {
  const [view, setView] = useViewState();
  const [hovered, setHovered] = useState<string | null>(null);
  const manifest = useManifest();
  const release = manifest.data?.currentRelease;
  const index = useReleaseIndex(release);

  const contests = useMemo(
    () => index.data?.elections.flatMap((e) => e.contests.map((c) => ({ value: c.id, label: `${e.nameZh}｜${c.nameZh}` }))) ?? [],
    [index.data],
  );
  const contestId = view.contest && contests.some((c) => c.value === view.contest) ? view.contest : (contests[0]?.value ?? null);
  const meta = useContest(release, contestId);
  const m = meta.data;

  const level: MapLevel = m && !m.contest.availableLevels.includes(view.level) ? "county" : view.level;
  const results = useResults(release, m?.results[level]);
  const national = useResults(release, m?.results.national);
  const counties = useResults(release, level === "town" ? m?.results.county : undefined);
  const geo = useGeography(release, m?.boundary.files[level]);

  const units = useMemo(() => (results.data ? toUnitViews(results.data) : null), [results.data]);
  const nationalUnit = useMemo(() => (national.data ? [...toUnitViews(national.data).values()][0] : undefined), [national.data]);
  const countyNames = useMemo(
    () => new Map(counties.data?.units.map((u) => [u.id, u.nameZh]) ?? []),
    [counties.data],
  );

  const model = useMemo(() => (m && units ? buildMapView(m, [...units.values()], view) : null), [m, units, view]);

  const lockedCode = view.unit?.includes(":") ? view.unit.slice(view.unit.indexOf(":") + 1) : null;
  const shown: { unit: UnitView; status: "hover" | "locked" | "overall"; level: "national" | MapLevel } | null =
    (hovered && units?.get(hovered) && { unit: units.get(hovered)!, status: "hover", level }) ||
    (lockedCode && units?.get(lockedCode) && { unit: units.get(lockedCode)!, status: "locked", level }) ||
    (nationalUnit ? { unit: nationalUnit, status: "overall", level: "national" } : null);

  const ring: RingSegment[] = useMemo(() => {
    if (!m || !shown) return [];
    const cols = choiceColors(m);
    const segs: RingSegment[] = m.choices.map((c, i) => ({ key: c.id, label: c.labelZh, value: shown.unit.votes[i] ?? 0, color: cols[i]! }));
    if (view.invalid) segs.push({ key: "invalid", label: "無效票", value: shown.unit.summary.invalid ?? 0, color: INVALID_COLOR });
    if (view.abstain) segs.push({ key: "abstain", label: "未投票", value: abstained(shown.unit.summary) ?? 0, color: ABSTAIN_COLOR });
    return segs;
  }, [m, shown, view.invalid, view.abstain]);

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
          <div className={classes.mapCanvas}>
            {geo.data && units && model && (
              <ElectionMap
                geo={geo.data}
                colors={model.colors}
                hatched={model.hatched}
                hovered={hovered}
                locked={lockedCode}
                background={scheme === "dark" ? "#1f2023" : "#eef1f4"}
                ariaLabel={`${m?.contest.nameZh ?? ""} ${LEVEL_LABEL[level]}得票地圖`}
                onHover={setHovered}
                onClick={(code) => setView({ unit: code ? (units.get(code)?.id ?? null) : null })}
              />
            )}
            {loading && !firstError && (
              <Group className={classes.overlayCenter} gap="xs"><Loader size="sm" /><Text size="sm">載入資料中…</Text></Group>
            )}
            {firstError && <ErrorBox error={firstError.error} onRetry={() => firstError.refetch()} />}
            {m && (
              <Paper className={classes.controls} shadow="sm" p="xs" radius="md" withBorder>
                <Controls meta={m} view={view} level={level} setView={setView} />
              </Paper>
            )}
          </div>
          <div className={classes.extras}>
            {model && (
              <Paper className={classes.legend} shadow="sm" p="xs" radius="md" withBorder>
                <Legend model={model.legend} />
              </Paper>
            )}
            {shown && ring.length > 0 && (
              <Paper className={classes.ring} shadow="sm" p={6} radius="xl" withBorder>
                <VoteRing segments={ring} title={shown.unit.name} subtitle={`投票率 ${fmtPct(turnout(shown.unit.summary), 1)}`} />
              </Paper>
            )}
          </div>
        </section>

        <aside className={classes.panel} aria-label="詳細資料" aria-live="polite">
          {m && shown && model ? (
            <Sidebar
              meta={m}
              unit={shown.unit}
              level={shown.level}
              status={shown.status}
              parentName={shown.unit.parentId ? (countyNames.get(shown.unit.parentId) ?? null) : null}
              currentView={model.describe(shown.unit)}
              den={{ invalid: view.invalid, abstain: view.abstain }}
              levelLabel={LEVEL_LABEL[level]}
              onUnlock={() => setView({ unit: null })}
            />
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
