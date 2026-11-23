import { Group, Stack, Text } from "@mantine/core";
import { NO_DATA } from "../lib/colors.ts";
import type { LegendModel } from "../lib/mapView.ts";

const HATCH = "repeating-linear-gradient(135deg, rgba(255,255,255,.9) 0 1.5px, rgba(20,20,20,.75) 1.5px 3px, transparent 3px 8px)";

export const Swatch = ({ color, hatched }: { color: string; hatched?: boolean }) => (
  <span
    aria-hidden
    style={{
      display: "inline-block",
      width: 14,
      height: 14,
      borderRadius: 2,
      flex: "none",
      background: hatched ? `${HATCH}, ${color}` : color,
    }}
  />
);

export function Legend({ model }: { model: LegendModel }) {
  const { spec } = model;
  return (
    <Stack gap={4} maw={240}>
      <Text size="xs" fw={600}>{model.title}</Text>
      {spec?.type === "stepped" &&
        spec.items.map((it) => (
          <Group key={it.label} gap={6} wrap="nowrap">
            <Swatch color={it.color} />
            <Text size="xs">{it.label}</Text>
          </Group>
        ))}
      {spec?.type === "continuous" && (
        <Group gap={8} wrap="nowrap" align="stretch">
          <div style={{ width: 14, height: 120, borderRadius: 2, background: spec.gradient }} aria-hidden />
          <div style={{ position: "relative", height: 120, minWidth: 64 }}>
            {spec.ticks.map((t) => (
              <Text key={t.label} size="xs" style={{ position: "absolute", bottom: `calc(${t.at * 100}% - 8px)`, whiteSpace: "nowrap" }}>
                {t.label}
              </Text>
            ))}
          </div>
        </Group>
      )}
      {spec?.zero && (
        <Group gap={6} wrap="nowrap">
          <Swatch color={spec.zero.color} />
          <Text size="xs">{spec.zero.label}</Text>
        </Group>
      )}
      {model.groups?.map((g) => (
        <Stack key={g.title} gap={2}>
          <Text size="xs" c="dimmed">{g.title}</Text>
          {g.items.map((it) => (
            <Group key={it.label} gap={6} wrap="nowrap">
              <Swatch color={it.color} hatched={it.hatched} />
              <Text size="xs">{it.label}</Text>
            </Group>
          ))}
        </Stack>
      ))}
      <Group gap={6} wrap="nowrap">
        <Swatch color={NO_DATA} />
        <Text size="xs">無資料</Text>
      </Group>
      {model.note && <Text size="xs" c="dimmed">{model.note}</Text>}
    </Stack>
  );
}
