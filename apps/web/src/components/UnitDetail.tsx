import { Badge, Group, Stack, Table, Text, Title } from "@mantine/core";
import type { ContestMetadataFile } from "@tw-election/schema";
import { type UnitView, fmtInt, fmtPct, turnout } from "../lib/results.ts";
import { VoteBars } from "./VoteBars.tsx";

const LEVEL_ZH: Record<string, string> = { national: "全國", county: "縣市", town: "鄉鎮市區" };

export function UnitDetail({
  meta,
  unit,
  level,
  colorOf,
  highlightIndex,
}: {
  meta: ContestMetadataFile;
  unit: UnitView;
  level: "national" | "county" | "town";
  colorOf: (i: number) => string;
  highlightIndex: number | null;
}) {
  const party = new Map(meta.parties.map((p) => [p.id, p.nameZh]));
  const electedIds = new Set(meta.candidacies.filter((c) => c.elected).map((c) => c.id));
  const s = unit.summary;
  const notes = meta.boundary.notes.filter((n) => n.unit === unit.id);
  return (
    <Stack gap="sm">
      <Group gap="xs" align="baseline">
        <Title order={2} size="h3">{unit.name}</Title>
        <Badge variant="light" color="gray">{LEVEL_ZH[level]}</Badge>
      </Group>
      <VoteBars
        data={meta.choices.map((c, i) => ({
          key: c.id,
          label: `${c.ballotNumber ?? ""} ${c.labelZh}${level === "national" && c.candidacyIds.some((id) => electedIds.has(id)) ? "（當選）" : ""}`,
          sublabel: c.partyId ? (party.get(c.partyId) ?? c.partyId) : "",
          votes: unit.votes[i] ?? 0,
          share: unit.shares[i] ?? null,
          color: colorOf(i),
          highlight: i === highlightIndex,
        }))}
      />
      <Text size="xs" c="dimmed">得票率 ＝ 得票數 ÷ 有效票數</Text>
      <Table withRowBorders={false} verticalSpacing={2} fz="sm">
        <Table.Tbody>
          <Row k="選舉人數" v={fmtInt(s.electors)} />
          <Row k="投票數" v={fmtInt(s.ballotsCast)} />
          <Row k="投票率（投票數 ÷ 選舉人數）" v={fmtPct(turnout(s))} />
          <Row k="有效票數" v={fmtInt(s.valid)} />
          <Row k="無效票數" v={fmtInt(s.invalid)} />
        </Table.Tbody>
      </Table>
      {notes.map((n) => (
        <Text key={n.note} size="xs" c="orange.8">⚠ {n.note}</Text>
      ))}
    </Stack>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <Table.Tr>
    <Table.Td c="dimmed">{k}</Table.Td>
    <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</Table.Td>
  </Table.Tr>
);
