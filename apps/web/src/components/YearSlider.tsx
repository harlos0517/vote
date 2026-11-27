import { Group, Slider } from "@mantine/core";
import type { ReleaseIndexFile } from "@tw-election/schema";

type Timeline = ReleaseIndexFile["timelines"][number];

/** Shared box of the third picker tier (year slider, or the 公投 case chooser), so switching keeps the layout. */
export const THIRD_TIER = { flex: "0 0 auto", width: 300, maxWidth: "100%", boxSizing: "border-box" } as const;

/** The timeline (election type) a group belongs to. */
export const timelineOf = (timelines: Timeline[], groupId: string | null) =>
  groupId ? timelines.find((t) => t.slots.some((s) => s.groupIds.includes(groupId))) : undefined;

/** Most year labels that fit the slider's ~270 px track without touching (a 4-digit year is ~30 px). */
const MAX_LABELS = 6;

/**
 * Which slot marks carry a year label: every k-th from the first, the last, and the selected one,
 * dropping any label that would sit right next to a kept one. Unlabelled marks stay clickable.
 */
export function labelledSlots(n: number, at: number): Set<number> {
  if (n <= MAX_LABELS) return new Set(Array.from({ length: n }, (_, i) => i));
  const step = Math.ceil((n - 1) / (MAX_LABELS - 1));
  const keep = [n - 1, ...(at >= 0 ? [at] : [])];
  const out = new Set(keep);
  for (let i = 0; i < n; i += step) if (keep.every((k) => k === i || Math.abs(k - i) >= 2)) out.add(i);
  return out;
}

/**
 * Year slider for the current election type. Moving it opens the same type in another slot;
 * within a slot holding several groups (e.g. referendum cases) the same position is kept.
 */
export function YearSlider({ timeline, groupId, onChange, full }: { timeline: Timeline; groupId: string; onChange: (groupId: string) => void; full?: boolean }) {
  const at = timeline.slots.findIndex((s) => s.groupIds.includes(groupId));
  const within = Math.max(0, timeline.slots[at]?.groupIds.indexOf(groupId) ?? 0);
  const shown = labelledSlots(timeline.slots.length, at);
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
        marks={timeline.slots.map((s, i) => (shown.has(i) ? { value: i, label: s.label } : { value: i }))}
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
