import { useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { Button, Collapse, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { effectiveMode, selectedTarget } from "../lib/mapView.ts";
import type { MapLevel, ViewState } from "../lib/viewState.ts";
import { partyLabel, type GroupContext } from "../lib/views.ts";

export const LEVEL_LABEL: Record<MapLevel, string> = { county: "縣市", district: "選區", town: "鄉鎮市區", village: "村里" };

export function Controls({
  ctx,
  view,
  level,
  levels,
  setView,
}: {
  ctx: GroupContext;
  view: ViewState;
  level: MapLevel;
  levels: MapLevel[];
  setView: (p: Partial<ViewState>) => void;
}) {
  // Start collapsed on phones so the options don't cover the map.
  const narrow = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [open, setOpen] = useState(!narrow);
  const ref = ctx.referendum !== null;
  const mode = effectiveMode(ctx, view);
  return (
    <Stack gap={6}>
      <Button variant="subtle" size="compact-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "收合選項" : "顯示選項"}
      </Button>
      <Collapse expanded={open}>
        <Stack gap={8}>
          <SegmentedControl
            size="xs"
            aria-label="地圖層級"
            value={level}
            onChange={(v) => setView({ level: v as MapLevel, unit: null })}
            data={levels.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
          />
          <SegmentedControl
            size="xs"
            aria-label="得票檢視方式"
            value={mode}
            onChange={(v) => setView({ mode: v as ViewState["mode"] })}
            data={
              ref
                ? [
                    { value: "diff", label: "同意與不同意差異" },
                    { value: "share", label: "個別得票率" },
                  ]
                : [
                    { value: "diff", label: "兩大黨差異" },
                    { value: "top", label: ctx.partyList ? "得票最多政黨" : "當選候選人" },
                    { value: "share", label: ctx.candidatesPickable ? "得票率" : "政黨得票率" },
                  ]
            }
          />
          {mode === "diff" && (
            <SegmentedControl
              size="xs"
              aria-label={ref ? "同意與不同意差異公式" : "兩大黨差異公式"}
              value={view.formula}
              onChange={(v) => setView({ formula: v as ViewState["formula"] })}
              data={[
                { value: "pct", label: "得票率相減" },
                { value: "ratio", label: ref ? "相對差距" : "兩黨相對差距" },
              ]}
            />
          )}
          {mode !== "diff" && (mode !== "top" || view.shadeTop) && (
            <Switch size="xs" label="色階從 0% 起算" checked={view.fromZero} onChange={(e) => setView({ fromZero: e.currentTarget.checked })} />
          )}
          {mode === "top" && (
            <>
              <Switch size="xs" label="依得票率調整顏色深淺" checked={view.shadeTop} onChange={(e) => setView({ shadeTop: e.currentTarget.checked })} />
              <Switch size="xs" label={ctx.partyList ? "以斜線標示未獲席次的政黨" : "以斜線標示未當選者"} checked={view.hatchUnelected} onChange={(e) => setView({ hatchUnelected: e.currentTarget.checked })} />
            </>
          )}
          {mode === "share" && (
            <>
              <Select
                size="xs"
                aria-label={ctx.candidatesPickable ? "選擇政黨或候選人" : "選擇政黨"}
                data={shareOptions(ctx)}
                value={selectedTarget(ctx, view).id}
                onChange={(v) => setView({ choice: v })}
                allowDeselect={false}
                searchable
                maxDropdownHeight={280}
              />
              <SegmentedControl
                size="xs"
                aria-label="配色"
                value={view.palette}
                onChange={(v) => setView({ palette: v as ViewState["palette"] })}
                data={[
                  { value: "party", label: ref ? "單色－黑" : "政黨色－黑" },
                  { value: "multi", label: "多色彩漸層" },
                ]}
              />
            </>
          )}
          {ref && <Switch size="xs" label="色盲友善配色（藍／橘）" checked={view.colorblind} onChange={(e) => setView({ colorblind: e.currentTarget.checked })} />}
          {(mode !== "top" || view.shadeTop) && (
            <SegmentedControl
              size="xs"
              aria-label="色階"
              value={view.scale}
              onChange={(v) => setView({ scale: v as ViewState["scale"] })}
              data={[
                { value: "continuous", label: "連續色" },
                { value: "stepped", label: "分段色" },
              ]}
            />
          )}
          <Switch size="xs" label="計入無效票" checked={view.invalid} onChange={(e) => setView({ invalid: e.currentTarget.checked })} />
          <Switch size="xs" label="計入未投票" checked={view.abstain} onChange={(e) => setView({ abstain: e.currentTarget.checked })} />
          {mode === "diff" && view.formula === "ratio" && (
            <Text size="xs" c="dimmed" maw={220}>兩黨相對差距只看兩黨票數；計入選項只影響投票環與側邊欄。</Text>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}

/** Share-view picker: parties, plus each candidate where a party ran several (原住民立委). */
function shareOptions(ctx: GroupContext) {
  if (ctx.referendum) return [{ value: "agree", label: "同意" }, { value: "disagree", label: "不同意" }];
  const parties = ctx.partiesByVote.map((p) => ({ value: p.id, label: partyLabel(ctx, p.id) }));
  if (!ctx.candidatesPickable) return parties;
  const cands = [...ctx.choice.values()]
    .sort((a, b) => (a.ballotNumber ?? 0) - (b.ballotNumber ?? 0))
    .map((c) => ({ value: c.id, label: `${c.ballotNumber}號 ${c.labelZh}（${c.partyId ? (ctx.party.get(c.partyId)?.nameZh ?? "") : ""}）` }));
  return [
    { group: "政黨（候選人合計）", items: parties },
    { group: "候選人", items: cands },
  ];
}
