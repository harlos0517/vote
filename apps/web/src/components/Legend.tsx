import { Group, Stack, Text } from "@mantine/core";
import type { ScaleQuantize } from "d3-scale";
import { NO_DATA } from "../lib/colors.ts";

const Swatch = ({ color }: { color: string }) => (
  <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 2, background: color, flex: "none" }} />
);

export function ShareLegend({ scale, title }: { scale: ScaleQuantize<string>; title: string }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600}>{title}</Text>
      {[...scale.range()].reverse().map((c) => {
        const [a, b] = scale.invertExtent(c);
        return (
          <Group key={c} gap={6} wrap="nowrap">
            <Swatch color={c} />
            <Text size="xs">{pct(a)}–{pct(b)}</Text>
          </Group>
        );
      })}
      <Group gap={6} wrap="nowrap">
        <Swatch color={NO_DATA} />
        <Text size="xs">無資料</Text>
      </Group>
    </Stack>
  );
}

export function LeaderLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600}>得票最多者（顏色依號次，不代表政黨）</Text>
      {items.map((it) => (
        <Group key={it.label} gap={6} wrap="nowrap">
          <Swatch color={it.color} />
          <Text size="xs">{it.label}</Text>
        </Group>
      ))}
      <Group gap={6} wrap="nowrap">
        <Swatch color={NO_DATA} />
        <Text size="xs">無資料／同票</Text>
      </Group>
    </Stack>
  );
}
