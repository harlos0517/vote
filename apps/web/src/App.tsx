import { useMemo, useRef, useState } from "react";
import { ActionIcon, Alert, Box, Button, Group, Loader, Paper, Select, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import { DataError } from "@tw-election/data-client";
import { ColorOptions, Controls, LEVEL_LABEL } from "./components/Controls.tsx";
import { ElectionMap } from "./components/ElectionMap.tsx";
import { Legend } from "./components/Legend.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { VoteRing } from "./components/VoteRing.tsx";
import { ElectionPicker } from "./components/ElectionPicker.tsx";
import { useNarrow } from "./lib/useNarrow.ts";
import { buildMapView, effectiveMode, ringSlices } from "./lib/mapView.ts";
import { geographyReleaseOf, useGeography, useGroup, useLiveGroup, useLiveManifest, useLiveSnapshot, useLiveUnits, useManifest, useReleaseIndex, useResults } from "./lib/queries.ts";
import { liveLevels, liveResults, newer, progressByUnit } from "./lib/live.ts";
import { LiveBanner, LiveUnitProgress, PROGRESS_UNIT_LABEL } from "./components/LiveBanner.tsx";
import type { GroupMetadataFile, GroupResultsFile, LiveSnapshotFile } from "@tw-election/schema";
import { codeOf, fmtPct, toUnitViews, turnout, type UnitView } from "./lib/results.ts";
import { type MapLevel, useViewState } from "./lib/viewState.ts";
import { groupContext, quorumLabel, quorumVotes } from "./lib/views.ts";
import classes from "./App.module.css";

const ALL_LEVELS: MapLevel[] = ["county", "district", "town", "village"];
/** Shown as a header button when set at build time (VITE_LIVE_FEED), e.g. on counting night. */
const LIVE_FEED: string | undefined = import.meta.env.VITE_LIVE_FEED || undefined;

type MetadataRef = { release: string; path: string } | { feedPath: string; geographyRelease: string };

/**
 * One level's results: the release's file, or (live) the unit list filled from the newest
 * snapshot. Both hooks are always called; only one is enabled.
 */
function useLevel(live: string | null, release: string | undefined, ref: MetadataRef | undefined, meta: GroupMetadataFile | undefined, snapshot: LiveSnapshotFile | null, path: string | undefined) {
  const st = useResults(live ? undefined : release, live ? undefined : path);
  const units = useLiveUnits(live, ref, live ? path : undefined);
  const data = useMemo<GroupResultsFile | undefined>(
    () => (live ? (units.data && meta ? liveResults(meta, units.data, snapshot) : undefined) : st.data),
    [live, units.data, meta, snapshot, st.data],
  );
  const q = live ? units : st;
  return { data, isError: q.isError, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
}

export function App() {
  const [view, setView] = useViewState();
  const [hovered, setHovered] = useState<string | null>(null);
  const live = view.live;
  const manifest = useManifest();
  const liveManifest = useLiveManifest(live);
  const release = live ? undefined : manifest.data?.currentRelease;
  const index = useReleaseIndex(release);

  const groups = useMemo(
    () =>
      live
        ? (liveManifest.data?.groups.map((g) => ({ value: g.groupId, label: g.nameZh })) ?? [])
        : (index.data?.elections.flatMap((e) => e.groups.map((g) => ({ value: g.id, label: `${e.nameZh.slice(0, 5)}｜${g.nameZh}` }))) ?? []),
    [live, liveManifest.data, index.data],
  );
  const groupId = view.contest && groups.some((g) => g.value === view.contest) ? view.contest : (groups[0]?.value ?? null);
  const entry = liveManifest.data?.groups.find((g) => g.groupId === groupId);
  const ref = live ? entry?.metadata : undefined;
  const staticMeta = useGroup(release, groupId);
  const liveMeta = useLiveGroup(live, groupId, ref);
  const meta = live ? liveMeta : staticMeta;
  const m = meta.data;
  // Newest snapshot only: a cached older latest.json must not roll the numbers back.
  const snapQ = useLiveSnapshot(live, entry?.latest, liveManifest.data?.pollIntervalSeconds);
  const lastSnap = useRef<LiveSnapshotFile | null>(null);
  lastSnap.current = live ? newer(lastSnap.current, snapQ.data) : null;
  const snapshot = lastSnap.current;
  const progress = useMemo(() => progressByUnit(snapshot), [snapshot]);
  const geoRelease = live ? geographyReleaseOf(ref) : release;

  const groupLevels = (m?.group.levels.filter((l): l is MapLevel => (ALL_LEVELS as string[]).includes(l)) ?? []) as MapLevel[];
  // Live: only levels the snapshot has numbers for (the poller may skip towns, and never reads
  // villages); before the first numbers, the group's levels without 村里.
  const levels = live ? liveLevels(groupLevels, snapshot) : groupLevels;
  const level: MapLevel = m && !levels.includes(view.level) ? (levels.includes("town") ? "town" : levels[0]!) : view.level;
  const results = useLevel(live, release, ref, m, snapshot, m?.results[level]);
  const national = useLevel(live, release, ref, m, snapshot, m?.results.national);
  const counties = useLevel(live, release, ref, m, snapshot, level !== "county" ? m?.results.county : undefined);
  // Township names for the 村里 sidebar ("所屬鄉鎮市區").
  const towns = useLevel(live, release, ref, m, snapshot, level === "village" ? m?.results.town : undefined);
  const geo = useGeography(geoRelease, m?.boundary.files[level]);
  // District outlines over the town and 村里 maps, for groups with electoral districts.
  const fine = level === "town" || level === "village";
  const districtGeo = useGeography(geoRelease, fine ? m?.boundary.files.district : undefined);

  const units = useMemo(() => (results.data ? toUnitViews(results.data) : null), [results.data]);
  const nationalUnit = useMemo(() => (national.data ? [...toUnitViews(national.data).values()][0] : undefined), [national.data]);
  const countyNames = useMemo(() => new Map(counties.data?.units.map((u) => [u.id, u.nameZh]) ?? []), [counties.data]);
  const townNames = useMemo(() => new Map(towns.data?.units.map((u) => [u.id, u.nameZh]) ?? []), [towns.data]);
  const ctx = useMemo(() => (m ? groupContext(m, nationalUnit?.votes, { live: !!live }) : null), [m, nationalUnit, live]);
  const model = useMemo(() => (ctx && units ? buildMapView(ctx, [...units.values()], view) : null), [ctx, units, view]);
  // Keep the map mounted (and its zoom/position) while the next group or level loads: draw the
  // last complete set until the new one is ready.
  const complete = geo.data && units && model ? { geo: geo.data, units, model } : null;
  const lastDrawn = useRef(complete);
  if (complete) lastDrawn.current = complete;
  const drawn = complete ?? lastDrawn.current;

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

  // 投票率 always counts 無效票 and 未投票.
  const turnoutMode = ctx ? effectiveMode(ctx, view) === "turnout" : false;
  const den = turnoutMode ? { invalid: true, abstain: true } : { invalid: view.invalid, abstain: view.abstain };
  const ring = shown && ctx ? ringSlices(shown.unit, ctx, den, view.colorblind) : [];
  // Referendum threshold: 同意 must reach 25% of electors; 同意 is the first slice, so mark that point.
  const ringTotal = ring.reduce((x, s) => x + s.value, 0);
  const rule = ctx?.referendum?.rule;
  const quorum = rule?.agreeQuorumOfElectors;
  const electors = shown?.unit.summary.electors;
  const marker =
    rule && quorum && electors && ringTotal
      ? { at: (quorum * electors) / ringTotal, label: `通過門檻：${quorumLabel(rule)}（${quorumVotes(quorum, electors, rule.quorumStrict ?? false).toLocaleString("zh-TW")} 票）` }
      : null;

  const scheme = useComputedColorScheme("light");
  const narrow = useNarrow();
  const firstError = (live ? [liveManifest, meta, results, national, geo, snapQ] : [manifest, index, meta, results, national, geo]).find((q) => q.isError);
  const loading = (live ? [liveManifest, meta, results, geo] : [manifest, index, meta, results, geo]).some((q) => q.isLoading);

  return (
    <div className={classes.page}>
      <header className={classes.header}>
        <Title order={1} size="h4">{live ? "即時開票" : "臺灣歷史選舉地圖"}</Title>
        {live ? (
          <Group gap="xs">
            {groups.length > 1 && groupId && (
              <Select size="xs" data={groups} value={groupId} allowDeselect={false} onChange={(g) => g && setView({ contest: g, unit: null })} aria-label="選舉類別" />
            )}
            <Button size="xs" variant="subtle" onClick={() => setView({ live: null, contest: null, unit: null })}>回到歷史選舉</Button>
          </Group>
        ) : (
          <>
            {index.data && groupId && (
              // Keeps the view (mode, party, level, locked area) so years and offices can be compared directly.
              <ElectionPicker index={index.data} groupId={groupId} onChange={(g) => setView({ contest: g })} />
            )}
            {LIVE_FEED && <Button size="xs" color="red" onClick={() => setView({ live: LIVE_FEED, contest: null, unit: null })}>即時開票</Button>}
          </>
        )}
        <ActionIcon
          component="a"
          href="https://github.com/harlos0517/vote"
          target="_blank"
          rel="noopener noreferrer"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="GitHub 原始碼"
          title="GitHub 原始碼"
          className={classes.github}
        >
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
        </ActionIcon>
      </header>

      <main className={classes.main}>
        <section className={classes.mapPane}>
          <div className={classes.mapCanvas}>
            {drawn && (
              <ElectionMap
                geo={drawn.geo}
                colors={drawn.model.colors}
                hatched={drawn.model.hatched}
                hovered={hovered}
                locked={lockedCode}
                districts={fine ? districtGeo.data : undefined}
                highlightDistricts={highlightDistricts}
                background={scheme === "dark" ? "#1f2023" : "#eef1f4"}
                borders={level !== "village"}
                ariaLabel={`${m?.group.nameZh ?? ""} ${LEVEL_LABEL[level]}得票地圖`}
                onHover={setHovered}
                onClick={(code) => setView({ unit: code ? (drawn.units.get(code)?.id ?? null) : null })}
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
            {ctx && (
              <Paper className={classes.controlsBelow} p="xs" radius="md" withBorder>
                <Controls ctx={ctx} view={view} level={level} levels={levels} setView={setView} />
              </Paper>
            )}
            {model && ctx && (
              <Paper className={classes.legend} shadow="sm" p="xs" radius="md" withBorder>
                <Stack gap="xs">
                  <Legend model={model.legend} horizontal={narrow} />
                  <ColorOptions ctx={ctx} view={view} setView={setView} />
                </Stack>
              </Paper>
            )}
            {shown && ring.length > 0 && (
              // No frame or background: the ring sits directly on the map.
              <div className={classes.ring}>
                <VoteRing segments={ring} title={shown.unit.name} subtitle={`投票率 ${fmtPct(turnout(shown.unit.summary), 1)}`} marker={marker} />
              </div>
            )}
          </div>
        </section>

        <aside className={classes.panel} aria-label="詳細資料" aria-live="polite">
          {live && liveManifest.data && (
            <Paper p="xs" mb="sm" radius="md" withBorder>
              <LiveBanner manifest={liveManifest.data} snapshot={snapshot} electionName={m?.election.nameZh} />
            </Paper>
          )}
          {live && shown && shown.status !== "overall" && (
            <LiveUnitProgress progress={progress.get(shown.unit.id)} unitLabel={PROGRESS_UNIT_LABEL[snapshot?.progressUnit ?? "station"]} />
          )}
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
