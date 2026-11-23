import { useMemo, useState } from "react";
import { Alert, Box, Button, Group, Loader, Paper, Select, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import { DataError } from "@tw-election/data-client";
import { Controls, LEVEL_LABEL } from "./components/Controls.tsx";
import { ElectionMap } from "./components/ElectionMap.tsx";
import { Legend } from "./components/Legend.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { VoteRing } from "./components/VoteRing.tsx";
import { YearSlider, timelineOf } from "./components/YearSlider.tsx";
import { buildMapView, ringSlices } from "./lib/mapView.ts";
import { useGeography, useGroup, useManifest, useReleaseIndex, useResults } from "./lib/queries.ts";
import { codeOf, fmtPct, toUnitViews, turnout, type UnitView } from "./lib/results.ts";
import { type MapLevel, useViewState } from "./lib/viewState.ts";
import { groupContext } from "./lib/views.ts";
import classes from "./App.module.css";

const ALL_LEVELS: MapLevel[] = ["county", "district", "town", "village"];

export function App() {
  const [view, setView] = useViewState();
  const [hovered, setHovered] = useState<string | null>(null);
  const manifest = useManifest();
  const release = manifest.data?.currentRelease;
  const index = useReleaseIndex(release);

  const groups = useMemo(
    () => index.data?.elections.flatMap((e) => e.groups.map((g) => ({ value: g.id, label: `${e.nameZh.slice(0, 5)}｜${g.nameZh}` }))) ?? [],
    [index.data],
  );
  const groupId = view.contest && groups.some((g) => g.value === view.contest) ? view.contest : (groups[0]?.value ?? null);
  const meta = useGroup(release, groupId);
  const timeline = timelineOf(index.data?.timelines ?? [], groupId);
  const m = meta.data;

  const levels = (m?.group.levels.filter((l): l is MapLevel => (ALL_LEVELS as string[]).includes(l)) ?? []) as MapLevel[];
  const level: MapLevel = m && !levels.includes(view.level) ? (levels.includes("town") ? "town" : levels[0]!) : view.level;
  const results = useResults(release, m?.results[level]);
  const national = useResults(release, m?.results.national);
  const counties = useResults(release, level !== "county" ? m?.results.county : undefined);
  // Township names for the 村里 sidebar ("所屬鄉鎮市區").
  const towns = useResults(release, level === "village" ? m?.results.town : undefined);
  const geo = useGeography(release, m?.boundary.files[level]);
  // District outlines over the town and 村里 maps, for groups with electoral districts.
  const fine = level === "town" || level === "village";
  const districtGeo = useGeography(release, fine ? m?.boundary.files.district : undefined);

  const units = useMemo(() => (results.data ? toUnitViews(results.data) : null), [results.data]);
  const nationalUnit = useMemo(() => (national.data ? [...toUnitViews(national.data).values()][0] : undefined), [national.data]);
  const countyNames = useMemo(() => new Map(counties.data?.units.map((u) => [u.id, u.nameZh]) ?? []), [counties.data]);
  const townNames = useMemo(() => new Map(towns.data?.units.map((u) => [u.id, u.nameZh]) ?? []), [towns.data]);
  const ctx = useMemo(() => (m ? groupContext(m, nationalUnit?.votes) : null), [m, nationalUnit]);
  const model = useMemo(() => (ctx && units ? buildMapView(ctx, [...units.values()], view) : null), [ctx, units, view]);

  const lockedCode = view.unit ? codeOf(view.unit) : null;
  const shown: { unit: UnitView; status: "hover" | "locked" | "overall"; levelName: string } | null =
    (hovered && units?.get(hovered) && { unit: units.get(hovered)!, status: "hover", levelName: LEVEL_LABEL[level] }) ||
    (lockedCode && units?.get(lockedCode) && { unit: units.get(lockedCode)!, status: "locked", levelName: LEVEL_LABEL[level] }) ||
    (nationalUnit ? { unit: nationalUnit, status: "overall", levelName: "全國" } : null);

  /** County of a unit: walk parent ids (town part → district → county). */
  const countyOf = (u: UnitView): string | null => {
    if (u.id.startsWith("cty:") || u.id === "nat") return null;
    const code = codeOf(u.id).slice(0, 5);
    return countyNames.get(`cty:${code}`) ?? null;
  };
  /** Districts to outline: the shown unit's own district at town and 村里 level. */
  const highlightDistricts = useMemo(() => {
    if (!shown || shown.status === "overall" || !fine || shown.unit.contestIds.length !== 1) return [];
    const d = ctx?.contest.get(shown.unit.contestIds[0]!)?.districtId;
    return d ? [d] : [];
  }, [shown, fine, ctx]);

  const den = { invalid: view.invalid, abstain: view.abstain };
  const ring = shown && ctx ? ringSlices(shown.unit, ctx, den, view.colorblind) : [];
  // Referendum threshold: 同意 must reach 25% of electors; 同意 is the first slice, so mark that point.
  const ringTotal = ring.reduce((x, s) => x + s.value, 0);
  const quorum = ctx?.referendum?.rule.agreeQuorumOfElectors;
  const electors = shown?.unit.summary.electors;
  const marker =
    quorum && electors && ringTotal
      ? { at: (quorum * electors) / ringTotal, label: `通過門檻：同意票達投票權人數 ${quorum * 100}%（${Math.ceil(quorum * electors).toLocaleString("zh-TW")} 票）` }
      : null;

  const scheme = useComputedColorScheme("light");
  const firstError = [manifest, index, meta, results, national, geo].find((q) => q.isError);
  const loading = [manifest, index, meta, results, geo].some((q) => q.isLoading);

  return (
    <div className={classes.page}>
      <header className={classes.header}>
        <Title order={1} size="h4">臺灣歷史選舉地圖</Title>
        <Select
          aria-label="選擇選舉"
          data={groups}
          value={groupId}
          onChange={(v) => setView({ contest: v, choice: null, unit: null })}
          allowDeselect={false}
          size="xs"
          w={{ base: "100%", sm: 360 }}
          disabled={!groups.length}
        />
        {timeline && groupId && timeline.slots.length > 1 && (
          // Keeps the view (mode, party, level, locked area) so years can be compared directly.
          <YearSlider timeline={timeline} groupId={groupId} onChange={(g) => setView({ contest: g })} />
        )}
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
                districts={fine ? districtGeo.data : undefined}
                highlightDistricts={highlightDistricts}
                background={scheme === "dark" ? "#1f2023" : "#eef1f4"}
                borders={level !== "village"}
                ariaLabel={`${m?.group.nameZh ?? ""} ${LEVEL_LABEL[level]}得票地圖`}
                onHover={setHovered}
                onClick={(code) => setView({ unit: code ? (units.get(code)?.id ?? null) : null })}
              />
            )}
            {loading && !firstError && (
              <Group className={classes.overlayCenter} gap="xs"><Loader size="sm" /><Text size="sm">載入資料中…</Text></Group>
            )}
            {firstError && <ErrorBox error={firstError.error} onRetry={() => firstError.refetch()} />}
            {ctx && (
              <Paper className={classes.controls} shadow="sm" p="xs" radius="md" withBorder>
                <Controls ctx={ctx} view={view} level={level} levels={levels} setView={setView} />
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
                <VoteRing segments={ring} title={shown.unit.name} subtitle={`投票率 ${fmtPct(turnout(shown.unit.summary), 1)}`} marker={marker} />
              </Paper>
            )}
          </div>
        </section>

        <aside className={classes.panel} aria-label="詳細資料" aria-live="polite">
          {ctx && shown && model ? (
            <Sidebar
              ctx={ctx}
              unit={shown.unit}
              levelName={shown.levelName}
              status={shown.status}
              countyName={countyOf(shown.unit)}
              townName={shown.unit.parentId ? (townNames.get(shown.unit.parentId) ?? null) : null}
              currentView={model.describe(shown.unit)}
              den={den}
              colorblind={view.colorblind}
              mapLevelLabel={LEVEL_LABEL[level]}
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
