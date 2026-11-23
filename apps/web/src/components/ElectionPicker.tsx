import { Group, SegmentedControl, Select } from "@mantine/core";
import type { ReleaseIndexFile } from "@tw-election/schema";
import { available, categoryOf, nearestGroup, pickerGroups } from "../lib/picker.ts";
import { useNarrow } from "../lib/useNarrow.ts";
import { THIRD_TIER, YearSlider, timelineOf } from "./YearSlider.tsx";

const caseNo = (g: { nameZh: string }) => Number(/第(\d+)案/.exec(g.nameZh)?.[1] ?? 0);

/** 大分類 → 中分類 → year slider (and the case, for 公投). Keeps the year when switching office. */
export function ElectionPicker({ index, groupId, onChange }: { index: ReleaseIndexFile; groupId: string; onChange: (groupId: string) => void }) {
  const groups = pickerGroups(index);
  const current = groups.find((g) => g.id === groupId);
  if (!current) return null;
  const cats = available(groups);
  const cat = categoryOf(current.office)!;
  const subs = cats.find((c) => c.key === cat.key)?.subs ?? [];
  const go = (office: (typeof groups)[number]["office"]) => {
    const g = nearestGroup(groups, office, current.date);
    if (g && g.id !== groupId) onChange(g.id);
  };
  const narrow = useNarrow();
  const timeline = timelineOf(index.timelines, groupId);
  // 公投: one chooser over every case of every year instead of a year slider.
  const cases = cat.key === "referendum" ? groups.filter((g) => g.office === current.office).sort((a, b) => b.date.localeCompare(a.date) || caseNo(a) - caseNo(b)) : [];
  return (
    <Group gap="sm" wrap="wrap" style={{ flex: narrow ? "1 1 100%" : "0 1 auto", justifyContent: "flex-start" }}>
      <SegmentedControl
        size="xs"
        fullWidth={narrow}
        w={narrow ? "100%" : undefined}
        aria-label="選舉類別"
        value={cat.key}
        onChange={(k) => go(cats.find((c) => c.key === k)!.subs[0]!.office)}
        data={cats.map((c) => ({ value: c.key, label: c.label }))}
      />
      {subs.length > 1 && (
        <SegmentedControl
          size="xs"
          fullWidth={narrow}
          w={narrow ? "100%" : undefined}
          aria-label="選舉種類"
          value={current.office}
          onChange={(o) => go(o as typeof current.office)}
          data={subs.map((s) => ({ value: s.office, label: s.label }))}
        />
      )}
      {cat.key === "referendum" ? (
        <Select
          size="xs"
          style={narrow ? { width: "100%" } : THIRD_TIER}
          aria-label="公投案"
          value={groupId}
          onChange={(v) => v && onChange(v)}
          allowDeselect={false}
          searchable
          maxDropdownHeight={320}
          data={cases.map((g) => ({ value: g.id, label: `${g.date.slice(0, 4)}｜${g.nameZh.replace("全國性公民投票案", "")}` }))}
        />
      ) : timeline && timeline.slots.length > 1 ? (
        <YearSlider timeline={timeline} groupId={groupId} onChange={onChange} full={narrow} />
      ) : (
        timeline && <span style={{ ...THIRD_TIER, fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{timeline.slots[0]!.label} 年</span>
      )}
    </Group>
  );
}
