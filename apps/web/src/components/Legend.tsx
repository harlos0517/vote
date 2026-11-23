import { Group, Stack, Text } from "@mantine/core";
import { NO_CANDIDATE, NO_DATA } from "../lib/colors.ts";
import type { LegendModel } from "../lib/mapView.ts";

const HATCH = "repeating-linear-gradient(135deg, rgba(255,255,255,.9) 0 1.5px, rgba(20,20,20,.75) 1.5px 3px, transparent 3px 8px)";
/** Same faint "/" stripe the map draws on areas without a value. */
const EMPTY = "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 1px, transparent 1px 4px)";

export const Swatch = ({ color, hatched }: { color: string; hatched?: boolean }) => (
  <span
    aria-hidden
    style={{
      display: "inline-block",
      width: 14,
      height: 14,
      borderRadius: 2,
      flex: "none",
      background: hatched ? `${HATCH}, ${color}` : color === NO_DATA || color === NO_CANDIDATE ? `${EMPTY}, ${color}` : color,
    }}
  />
);

export function Legend({ model, horizontal }: { model: LegendModel; horizontal?: boolean }) {
  return horizontal ? <HorizontalLegend model={model} /> : <VerticalLegend model={model} />;
}

const Item = ({ color, label, hatched }: { color: string; label: string; hatched?: boolean }) => (
  <Group gap={6} wrap="nowrap">
    <Swatch color={color} hatched={hatched} />
    <Text size="xs">{label}</Text>
  </Group>
);

/** Phones (建議 2): scale as a horizontal bar or a row of bins, other swatches flowing in rows. */
function HorizontalLegend({ model }: { model: LegendModel }) {
  const { spec } = model;
  const extras = [
    ...(spec?.zero ? [{ color: spec.zero.color, label: spec.zero.label }] : []),
    ...(model.groups?.flatMap((g) => g.items) ?? []),
    { color: NO_DATA, label: "無資料" },
  ];
  return (
    <Stack gap={6}>
      <Text size="xs" fw={600}>{model.title}</Text>
      {spec?.type === "continuous" && (
        <div>
          <div style={{ height: 10, borderRadius: 2, background: spec.gradient.replace("to top", "to right") }} aria-hidden />
          <div style={{ position: "relative", height: 16 }}>
            {spec.ticks.map((t) => (
              <Text
                key={t.label}
                size="xs"
                style={{
                  position: "absolute",
                  left: `${t.at * 100}%`,
                  transform: t.at === 0 ? "none" : t.at === 1 ? "translateX(-100%)" : "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </Text>
            ))}
          </div>
        </div>
      )}
      {spec?.type === "stepped" && (
        <Group gap="6px 12px">
          {[...spec.items].reverse().map((it) => <Item key={it.label} {...it} />)}
        </Group>
      )}
      <Group gap="6px 12px">
        {extras.map((it) => <Item key={it.label} {...it} />)}
      </Group>
      {model.note && <Text size="xs" c="dimmed">{model.note}</Text>}
    </Stack>
  );
}

function VerticalLegend({ model }: { model: LegendModel }) {
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
