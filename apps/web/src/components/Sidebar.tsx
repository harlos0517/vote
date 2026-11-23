import { Badge, Button, Divider, Group, Stack, Table, Text, Title } from "@mantine/core";
import { ABSTAIN_COLOR, INVALID_COLOR, NEUTRAL } from "../lib/colors.ts";
import { fmtInt, fmtPct, turnout, type UnitView } from "../lib/results.ts";
import {
  abstained,
  denominatorLabel,
  denominatorOf,
  isMultiContest,
  partyVotes,
  seatsByParty,
  type Denominator,
  type GroupContext,
} from "../lib/views.ts";
import { Swatch } from "./Legend.tsx";
import { SourceNotes } from "./SourceNotes.tsx";

export interface SidebarProps {
  ctx: GroupContext;
  unit: UnitView;
  levelName: string;
  /** How this unit is being shown: hover preview, locked, or the default overall view. */
  status: "hover" | "locked" | "overall";
  countyName: string | null;
  currentView: string;
  den: Denominator;
  mapLevelLabel: string;
  onUnlock: () => void;
}

export function Sidebar(p: SidebarProps) {
  const { ctx, unit, den } = p;
  const meta = ctx.meta;
  const s = unit.summary;
  const d = denominatorOf(s, den);
  const abst = abstained(s);
  const notes = meta.boundary.notes.filter((n) => n.unit === unit.id);
  const multi = isMultiContest(unit);
  const contestName = !multi && !ctx.singleContest ? (ctx.contestName.get(unit.contestIds[0]!) ?? null) : null;

  return (
    <Stack gap="sm">
      <Group gap="xs" align="baseline" wrap="nowrap">
        <Title order={2} size="h3">{unit.name}</Title>
        <Badge variant="light" color="gray">{p.levelName}</Badge>
        {p.status === "locked" && <Badge variant="light" color="pink">已鎖定</Badge>}
        {p.status === "hover" && <Badge variant="outline" color="gray">預覽</Badge>}
      </Group>
      {p.status === "locked" && (
        <Button variant="subtle" size="compact-xs" onClick={p.onUnlock} style={{ alignSelf: "flex-start" }}>
          解除鎖定（或點選地圖空白處）
        </Button>
      )}

      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          {p.countyName && <KV k="所屬縣市" v={p.countyName} />}
          {ctx.singleContest && meta.contests[0]!.scope.level === "national" && <KV k="選區" v="全國（單一選區）" />}
          {contestName && <KV k="選區" v={contestName} />}
          {multi && !ctx.singleContest && <KV k="選區" v={`${unit.contestIds.length} 個選區，各選 1 席`} />}
          <KV k="投票日期" v={meta.election.date} />
        </Table.Tbody>
      </Table>

      <Text size="sm" fw={600}>目前檢視</Text>
      <Text size="sm">{p.currentView}</Text>

      {multi ? <PartyTable {...p} d={d} abst={abst} /> : <CandidateTable {...p} d={d} abst={abst} />}

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
      <SourceNotes meta={meta} levelLabel={p.mapLevelLabel} />
    </Stack>
  );
}

type TableProps = SidebarProps & { d: number | null; abst: number | null };

function CandidateTable({ ctx, unit, den, d, abst }: TableProps) {
  const cand = new Map(ctx.meta.candidacies.map((c) => [c.id, c]));
  const choices = ctx.meta.choices.filter((c) => c.contestId === unit.contestIds[0]);
  return (
    <>
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
          {choices.map((c) => {
            const cs = c.candidacyIds.map((id) => cand.get(id)).filter((x) => x !== undefined);
            const quota = cs.find((x) => x.electedNote)?.electedNote;
            const v = unit.votes[c.id] ?? 0;
            return (
              <Table.Tr key={c.id}>
                <Table.Td>{c.ballotNumber}</Table.Td>
                <Table.Td style={{ whiteSpace: "normal" }}>
                  <Group gap={6} wrap="nowrap">
                    <Swatch color={ctx.choiceColor.get(c.id) ?? NEUTRAL} />
                    <div>
                      <div>
                        {c.labelZh.split("／").map((name, k) => (
                          <span key={name} style={{ whiteSpace: "nowrap" }}>{k > 0 && "／"}{name}{k === 0 && <wbr />}</span>
                        ))}
                      </div>
                      <Text size="xs" c="dimmed">{c.partyId ? (ctx.party.get(c.partyId)?.nameZh ?? c.partyId) : ""}</Text>
                    </div>
                  </Group>
                </Table.Td>
                <Num v={fmtInt(v)} />
                <Num v={fmtPct(d === null ? null : v / d)} />
                <Table.Td ta="center">
                  {ctx.elected.get(c.id) ? "✓" : "—"}
                  {quota === "women-quota" && <Text size="xs">婦女保障</Text>}
                  {quota === "displaced-by-women-quota" && <Text size="xs">因婦女保障落選</Text>}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {den.invalid && <ExtraRow label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} lead />}
          {den.abstain && <ExtraRow label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} lead />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">「當選」指整場選舉的結果，不是該地區的得票排名。</Text>
    </>
  );
}

function PartyTable({ ctx, unit, den, d, abst }: TableProps) {
  const seats = seatsByParty(unit, ctx);
  const rows = ctx.partiesByVote
    .map((p) => ({ p, votes: partyVotes(unit, ctx, p.id), seats: seats.seats.get(p.id) ?? 0 }))
    .filter((r) => r.votes > 0 || r.seats > 0)
    .sort((a, b) => b.votes - a.votes);
  return (
    <>
      <Text size="sm" fw={600}>各政黨合計（分母：{denominatorLabel(den)}；共 {seats.total} 席）</Text>
      <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>政黨</Table.Th>
            <Table.Th ta="right">得票數</Table.Th>
            <Table.Th ta="right">得票率</Table.Th>
            <Table.Th ta="right">當選席次</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ p, votes, seats: n }) => (
            <Table.Tr key={p.id}>
              <Table.Td style={{ whiteSpace: "normal" }}>
                <Group gap={6} wrap="nowrap"><Swatch color={ctx.partyColor.get(p.id) ?? NEUTRAL} />{p.isIndependent ? `${p.nameZh}（合計）` : p.nameZh}</Group>
              </Table.Td>
              <Num v={fmtInt(votes)} />
              <Num v={fmtPct(d === null ? null : votes / d)} />
              <Num v={n ? String(n) : "—"} />
            </Table.Tr>
          ))}
          {den.invalid && <ExtraRow label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} />}
          {den.abstain && <ExtraRow label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">此層級跨多個選區：票數為各黨候選人合計，席次為各選區當選結果加總。點選或切換到選區、鄉鎮層級可查看候選人。</Text>
    </>
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

/** 無效票 / 未投票 rows; `lead` adds the empty ballot-number cell of the candidate table. */
function ExtraRow({ label, color, n, d, lead }: { label: string; color: string; n: number | null; d: number | null; lead?: boolean }) {
  return (
    <Table.Tr>
      {lead && <Table.Td />}
      <Table.Td>
        <Group gap={6} wrap="nowrap"><Swatch color={color} />{label}</Group>
      </Table.Td>
      <Num v={fmtInt(n)} />
      <Num v={fmtPct(n === null || d === null ? null : n / d)} />
      <Table.Td />
    </Table.Tr>
  );
}
