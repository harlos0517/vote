import { SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { effectiveMode, selectedTarget } from "../lib/mapView.ts";
import { useNarrow } from "../lib/useNarrow.ts";
import { SCALE_MAXES, type MapLevel, type ViewState } from "../lib/viewState.ts";
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
  const ref = ctx.referendum !== null;
  const mode = effectiveMode(ctx, view);
  const narrow = useNarrow();
  return (
    <Stack gap={8}>
      <SegmentedControl
        fullWidth={narrow}
        size="xs"
        aria-label="地圖層級"
        value={level}
        onChange={(v) => setView({ level: v as MapLevel, unit: null })}
        data={levels.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
      />
      <SegmentedControl
        fullWidth={narrow}
        size="xs"
        aria-label="得票檢視方式"
        value={mode}
        onChange={(v) => setView({ mode: v as ViewState["mode"] })}
        data={
          ref
            ? [
                { value: "diff", label: "同意與不同意差異" },
                { value: "share", label: "個別得票率" },
                { value: "turnout", label: "投票率" },
              ]
            : [
                { value: "diff", label: "兩大黨差異" },
                { value: "top", label: ctx.partyList ? "得票最多政黨" : ctx.live ? "領先候選人" : "當選候選人" },
                { value: "share", label: ctx.candidatesPickable ? "得票率" : "政黨得票率" },
                { value: "turnout", label: "投票率" },
                ...(ctx.localOffice ? [{ value: "competition", label: "競爭情形" }] : []),
              ]
        }
      />
      {mode === "diff" && (
        <SegmentedControl
        fullWidth={narrow}
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
      {mode === "top" && !ctx.live && (
        <Switch size="xs" label={ctx.partyList ? "以斜線標示未獲席次的政黨" : "以斜線標示未當選者"} checked={view.hatchUnelected} onChange={(e) => setView({ hatchUnelected: e.currentTarget.checked })} />
      )}
      {mode === "share" && (
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
      )}
      {mode === "competition" ? null : mode === "turnout" ? (
        <Text size="xs" c="dimmed" maw={230}>投票率檢視一律計入無效票與未投票。</Text>
      ) : (
        <Switch
          size="xs"
          label="計入無效票與未投票"
          checked={view.invalid && view.abstain}
          onChange={(e) => setView({ invalid: e.currentTarget.checked, abstain: e.currentTarget.checked })}
        />
      )}
      {mode === "diff" && view.formula === "ratio" && (
        <Text size="xs" c="dimmed" maw={230}>相對差距只看兩方票數；計入選項只影響投票環與側邊欄。</Text>
      )}
    </Stack>
  );
}

/** Colour options, shown in the legend panel (建議 3): scale kind, legend top, palette, shading, colour-blind. */
export function ColorOptions({ ctx, view, setView }: { ctx: GroupContext; view: ViewState; setView: (p: Partial<ViewState>) => void }) {
  const mode = effectiveMode(ctx, view);
  const scaled = (mode !== "top" || view.shadeTop) && mode !== "competition";
  const narrow = useNarrow();
  return (
    <Stack gap={6}>
      {mode === "top" && (
        <Switch size="xs" label="依得票率調整顏色深淺" checked={view.shadeTop} onChange={(e) => setView({ shadeTop: e.currentTarget.checked })} />
      )}
      {scaled && (
        <SegmentedControl
        fullWidth={narrow}
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
      {mode !== "diff" && scaled && (
        <Switch size="xs" label="色階從 0% 起算" checked={view.fromZero} onChange={(e) => setView({ fromZero: e.currentTarget.checked })} />
      )}
      {mode !== "top" && mode !== "competition" && (
        <Select
          size="xs"
          aria-label="圖例上限"
          label={mode === "diff" ? "圖例上限（±）" : "圖例上限"}
          data={[{ value: "auto", label: "自動" }, ...SCALE_MAXES.map((m) => ({ value: String(m), label: `${m}%` }))]}
          value={view.max === null ? "auto" : String(Math.round(view.max * 100))}
          onChange={(v) => setView({ max: !v || v === "auto" ? null : Number(v) / 100 })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      )}
      {(mode === "share" || mode === "turnout") && (
        <SegmentedControl
        fullWidth={narrow}
          size="xs"
          aria-label="配色"
          value={view.palette}
          onChange={(v) => setView({ palette: v as ViewState["palette"] })}
          data={[
            { value: "party", label: mode === "turnout" || ctx.referendum ? "單色－黑" : "政黨色－黑" },
            { value: "multi", label: "多色彩漸層" },
          ]}
        />
      )}
      {ctx.referendum && mode !== "turnout" && (
        <Switch size="xs" label="色盲友善配色（藍／橘）" checked={view.colorblind} onChange={(e) => setView({ colorblind: e.currentTarget.checked })} />
      )}
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
