import { Group, Slider, Text } from "@mantine/core";
import type { ReleaseIndexFile } from "@tw-election/schema";

type Timeline = ReleaseIndexFile["timelines"][number];

/** The timeline (election type) a group belongs to. */
export const timelineOf = (timelines: Timeline[], groupId: string | null) =>
  groupId ? timelines.find((t) => t.slots.some((s) => s.groupIds.includes(groupId))) : undefined;

/**
 * Year slider for the current election type. Moving it opens the same type in another slot;
 * within a slot holding several groups (e.g. referendum cases) the same position is kept.
 */
export function YearSlider({ timeline, groupId, onChange }: { timeline: Timeline; groupId: string; onChange: (groupId: string) => void }) {
  const at = timeline.slots.findIndex((s) => s.groupIds.includes(groupId));
  const within = Math.max(0, timeline.slots[at]?.groupIds.indexOf(groupId) ?? 0);
  return (
    // Side padding keeps the first/last year labels (centred on the ends) inside the header.
    <Group gap="md" wrap="nowrap" style={{ flex: "1 1 200px", minWidth: 180, maxWidth: 360, paddingInline: 16, boxSizing: "border-box" }}>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{timeline.nameZh}</Text>
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
