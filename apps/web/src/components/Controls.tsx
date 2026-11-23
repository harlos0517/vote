import { useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { Button, Collapse, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import type { ContestMetadataFile } from "@tw-election/schema";
import type { MapLevel, ViewState } from "../lib/viewState.ts";

const LEVEL_LABEL: Record<MapLevel, string> = { county: "縣市", town: "鄉鎮市區" };

export function Controls({
  meta,
  view,
  level,
  setView,
}: {
  meta: ContestMetadataFile;
  view: ViewState;
  level: MapLevel;
  setView: (p: Partial<ViewState>) => void;
}) {
  // Start collapsed on phones so the options don't cover the map.
  const narrow = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [open, setOpen] = useState(!narrow);
  const choiceId = view.choice && meta.choices.some((c) => c.id === view.choice) ? view.choice : meta.choices[0]!.id;
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
            data={(["county", "town"] as const).filter((l) => meta.contest.availableLevels.includes(l)).map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
          />
          <SegmentedControl
            size="xs"
            aria-label="得票檢視方式"
            value={view.mode}
            onChange={(v) => setView({ mode: v as ViewState["mode"] })}
            data={[
              { value: "diff", label: "兩大黨差異" },
              { value: "top", label: "當選候選人" },
              { value: "share", label: "候選人得票率" },
            ]}
          />
          {view.mode === "diff" && (
            <SegmentedControl
              size="xs"
              aria-label="兩大黨差異公式"
              value={view.formula}
              onChange={(v) => setView({ formula: v as ViewState["formula"] })}
              data={[
                { value: "pct", label: "得票率相減" },
                { value: "ratio", label: "兩黨相對差距" },
              ]}
            />
          )}
          {view.mode === "top" && (
            <Switch size="xs" label="依得票率調整顏色深淺" checked={view.shadeTop} onChange={(e) => setView({ shadeTop: e.currentTarget.checked })} />
          )}
          {view.mode === "share" && (
            <>
              <Select
                size="xs"
                aria-label="選擇候選人"
                data={meta.choices.map((c) => ({ value: c.id, label: `${c.ballotNumber} ${c.labelZh}` }))}
                value={choiceId}
                onChange={(v) => setView({ choice: v })}
                allowDeselect={false}
              />
              <SegmentedControl
                size="xs"
                aria-label="配色"
                value={view.palette}
                onChange={(v) => setView({ palette: v as ViewState["palette"] })}
                data={[
                  { value: "party", label: "政黨色－黑" },
                  { value: "multi", label: "多色彩漸層" },
                ]}
              />
            </>
          )}
          {(view.mode !== "top" || view.shadeTop) && (
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
          {view.mode === "diff" && view.formula === "ratio" && (
            <Text size="xs" c="dimmed" maw={220}>兩黨相對差距只看兩黨票數；計入選項只影響投票環與側邊欄。</Text>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}
