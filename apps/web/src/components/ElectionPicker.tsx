import { Group, SegmentedControl, Select } from "@mantine/core";
import type { ReleaseIndexFile } from "@tw-election/schema";
import { available, categoryOf, nearestGroup, pickerGroups } from "../lib/picker.ts";
import { YearSlider, timelineOf } from "./YearSlider.tsx";

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
  const timeline = timelineOf(index.timelines, groupId);
  const slot = timeline?.slots.find((s) => s.groupIds.includes(groupId));
  return (
    <Group gap="sm" wrap="wrap" style={{ flex: "1 1 auto", justifyContent: "flex-end" }}>
      <SegmentedControl
        size="xs"
        aria-label="選舉類別"
        value={cat.key}
        onChange={(k) => go(cats.find((c) => c.key === k)!.subs[0]!.office)}
        data={cats.map((c) => ({ value: c.key, label: c.label }))}
      />
      {subs.length > 1 && (
        <SegmentedControl
          size="xs"
          aria-label="選舉種類"
          value={current.office}
          onChange={(o) => go(o as typeof current.office)}
          data={subs.map((s) => ({ value: s.office, label: s.label }))}
        />
      )}
      {timeline && timeline.slots.length > 1 && <YearSlider timeline={timeline} groupId={groupId} onChange={onChange} />}
      {timeline && timeline.slots.length === 1 && (
        <span style={{ fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{timeline.slots[0]!.label} 年</span>
      )}
      {slot && slot.groupIds.length > 1 && (
        <Select
          size="xs"
          w={180}
          aria-label="公投案"
          value={groupId}
          onChange={(v) => v && onChange(v)}
          allowDeselect={false}
          data={slot.groupIds.map((id) => ({ value: id, label: groups.find((g) => g.id === id)?.nameZh.replace("全國性公民投票案", "") ?? id }))}
        />
      )}
    </Group>
  );
}
