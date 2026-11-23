import { Badge, Button, Divider, Group, Stack, Table, Text, Title } from "@mantine/core";
import type { ContestMetadataFile } from "@tw-election/schema";
import { fmtInt, fmtPct, turnout, type UnitView } from "../lib/results.ts";
import { abstained, choiceColors, denominatorLabel, denominatorOf, type Denominator } from "../lib/views.ts";
import { Swatch } from "./Legend.tsx";
import { SourceNotes } from "./SourceNotes.tsx";

const LEVEL_ZH: Record<string, string> = { national: "全國", county: "縣市", town: "鄉鎮市區" };

export interface SidebarProps {
  meta: ContestMetadataFile;
  unit: UnitView;
  level: "national" | "county" | "town";
  /** How this unit is being shown: hover preview, locked, or the default overall view. */
  status: "hover" | "locked" | "overall";
  parentName: string | null;
  currentView: string;
  den: Denominator;
  levelLabel: string;
  onUnlock: () => void;
}

export function Sidebar({ meta, unit, level, status, parentName, currentView, den, levelLabel, onUnlock }: SidebarProps) {
  const party = new Map(meta.parties.map((p) => [p.id, p]));
  const cand = new Map(meta.candidacies.map((c) => [c.id, c]));
  const colors = choiceColors(meta);
  const s = unit.summary;
  const d = denominatorOf(s, den);
  const abst = abstained(s);
  const notes = meta.boundary.notes.filter((n) => n.unit === unit.id);
  const scope = meta.contest.scope.level === "national" ? "全國（單一選區）" : null;

  return (
    <Stack gap="sm">
      <Group gap="xs" align="baseline" wrap="nowrap">
        <Title order={2} size="h3">{unit.name}</Title>
        <Badge variant="light" color="gray">{LEVEL_ZH[level]}</Badge>
        {status === "locked" && <Badge variant="light" color="pink">已鎖定</Badge>}
        {status === "hover" && <Badge variant="outline" color="gray">預覽</Badge>}
      </Group>
      {status === "locked" && (
        <Button variant="subtle" size="compact-xs" onClick={onUnlock} style={{ alignSelf: "flex-start" }}>
          解除鎖定（或點選地圖空白處）
        </Button>
      )}

      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          {parentName && <KV k="所屬縣市" v={parentName} />}
          {scope && <KV k="選區" v={scope} />}
          <KV k="投票日期" v={meta.election.date} />
        </Table.Tbody>
      </Table>

      <Text size="sm" fw={600}>目前檢視</Text>
      <Text size="sm">{currentView}</Text>

      <Text size="sm" fw={600}>得票（分母：{denominatorLabel(den)}）</Text>
      <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>號次</Table.Th>
            <Table.Th>候選人／政黨</Table.Th>
            <Table.Th ta="right">得票數</Table.Th>
            <Table.Th ta="right">得票率</Table.Th>
            <Table.Th ta="center">當選</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {meta.choices.map((c, i) => {
            const cs = c.candidacyIds.map((id) => cand.get(id)).filter((x) => x !== undefined);
            const elected = cs.some((x) => x.elected);
            const quota = cs.find((x) => x.electedNote)?.electedNote;
            return (
              <Table.Tr key={c.id}>
                <Table.Td>{c.ballotNumber}</Table.Td>
                <Table.Td style={{ whiteSpace: "normal" }}>
                  <Group gap={6} wrap="nowrap">
                    <Swatch color={colors[i]!} />
                    <div>
                      <div>
                        {c.labelZh.split("／").map((name, k) => (
                          <span key={name} style={{ whiteSpace: "nowrap" }}>{k > 0 && "／"}{name}{k === 0 && <wbr />}</span>
                        ))}
                      </div>
                      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{c.partyId ? (party.get(c.partyId)?.nameZh ?? c.partyId) : ""}</Text>
                    </div>
                  </Group>
                </Table.Td>
                <Num v={fmtInt(unit.votes[i] ?? null)} />
                <Num v={fmtPct(d === null ? null : (unit.votes[i] ?? 0) / d)} />
                <Table.Td ta="center">
                  {elected ? "✓" : "—"}
                  {quota === "women-quota" && <Text size="xs">婦女保障</Text>}
                  {quota === "displaced-by-women-quota" && <Text size="xs">因婦女保障落選</Text>}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {den.invalid && <ExtraRow label="無效票" color="#a6a6a6" n={s.invalid} d={d} />}
          {den.abstain && <ExtraRow label="未投票" color="#dedede" n={abst} d={d} />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">「當選」指整場選舉的結果，不是該地區的得票排名。</Text>

      <Text size="sm" fw={600}>概況</Text>
      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          <KV k="選舉人數" v={fmtInt(s.electors)} />
          <KV k="投票數" v={fmtInt(s.ballotsCast)} />
          <KV k="投票率（投票數 ÷ 選舉人數）" v={fmtPct(turnout(s))} />
          <KV k="有效票數" v={fmtInt(s.valid)} />
          <KV k="無效票數" v={fmtInt(s.invalid)} />
          <KV k="未投票（選舉人數 − 投票數）" v={fmtInt(abst)} />
        </Table.Tbody>
      </Table>

      {notes.length > 0 && (
        <>
          <Text size="sm" fw={600}>註記</Text>
          {notes.map((n) => (
            <Text key={n.note} size="xs" c="orange.8">⚠ {n.note}</Text>
          ))}
        </>
      )}

      <Divider />
      <SourceNotes meta={meta} levelLabel={levelLabel} />
    </Stack>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (
  <Table.Tr>
    <Table.Td c="dimmed">{k}</Table.Td>
    <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</Table.Td>
  </Table.Tr>
);

const Num = ({ v }: { v: string }) => (
  <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{v}</Table.Td>
);

function ExtraRow({ label, color, n, d }: { label: string; color: string; n: number | null; d: number | null }) {
  return (
    <Table.Tr>
      <Table.Td />
      <Table.Td>
        <Group gap={6} wrap="nowrap"><Swatch color={color} />{label}</Group>
      </Table.Td>
      <Num v={fmtInt(n)} />
      <Num v={fmtPct(n === null || d === null ? null : n / d)} />
      <Table.Td />
    </Table.Tr>
  );
}
