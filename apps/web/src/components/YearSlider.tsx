import { Group, Slider } from "@mantine/core";
import type { ReleaseIndexFile } from "@tw-election/schema";

type Timeline = ReleaseIndexFile["timelines"][number];

/** Shared box of the third picker tier (year slider, or the 公投 case chooser), so switching keeps the layout. */
export const THIRD_TIER = { flex: "0 0 auto", width: 300, maxWidth: "100%", boxSizing: "border-box" } as const;

/** The timeline (election type) a group belongs to. */
export const timelineOf = (timelines: Timeline[], groupId: string | null) =>
  groupId ? timelines.find((t) => t.slots.some((s) => s.groupIds.includes(groupId))) : undefined;

/**
 * Year slider for the current election type. Moving it opens the same type in another slot;
 * within a slot holding several groups (e.g. referendum cases) the same position is kept.
 */
export function YearSlider({ timeline, groupId, onChange, full }: { timeline: Timeline; groupId: string; onChange: (groupId: string) => void; full?: boolean }) {
  const at = timeline.slots.findIndex((s) => s.groupIds.includes(groupId));
  const within = Math.max(0, timeline.slots[at]?.groupIds.indexOf(groupId) ?? 0);
  return (
    // Side padding keeps the first/last year labels (centred on the ends) inside the header.
    <Group gap="md" wrap="nowrap" style={{ ...THIRD_TIER, ...(full ? { width: "100%", flex: "1 1 100%" } : {}), paddingInline: 16 }}>
      <Slider
        aria-label={`${timeline.nameZh}年份`}
        style={{ flex: 1 }}
        size="sm"
        min={0}
        max={timeline.slots.length - 1}
        step={1}
        value={at}
        restrictToMarks
        marks={timeline.slots.map((s, i) => ({ value: i, label: s.label }))}
        label={null}
        onChange={(i) => {
          const slot = timeline.slots[i];
          if (slot && i !== at) onChange(slot.groupIds[Math.min(within, slot.groupIds.length - 1)]!);
        }}
        mb="md"
      />
    </Group>
  );
}
