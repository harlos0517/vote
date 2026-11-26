import { Badge, Button, Divider, Group, Select, Stack, Table, Text, Title } from "@mantine/core";
import { ABSTAIN_COLOR, INVALID_COLOR, NEUTRAL } from "../lib/colors.ts";
import { fmtInt, fmtPct, turnout, type UnitView } from "../lib/results.ts";
import {
  abstained,
  denominatorLabel,
  denominatorOf,
  isMultiContest,
  listSeats,
  partyVotes,
  quorumLabel,
  referendumStatus,
  seatsByParty,
  type Denominator,
  type GroupContext,
} from "../lib/views.ts";
import { choiceColorOf } from "../lib/mapView.ts";
import { Fold } from "./Fold.tsx";
import { Swatch } from "./Legend.tsx";
import { SourceNotes } from "./SourceNotes.tsx";

export interface SidebarProps {
  ctx: GroupContext;
  unit: UnitView;
  levelName: string;
  /** How this unit is being shown: hover preview, locked, or the default overall view. */
  status: "hover" | "locked" | "overall";
  countyName: string | null;
  /** 村里 level: the township (or township part) it belongs to. */
  townName?: string | null;
  currentView: string;
  den: Denominator;
  mapLevelLabel: string;
  /** Referendum palette (blue / orange). */
  colorblind: boolean;
  onUnlock: () => void;
  /** Heading: the area's name, or "高義里 第 0588 號投開票所" when a sub-area is picked. */
  title?: string;
  /**
   * Locked view only: pick one village of a township (or polling station of a village) to show
   * instead of the whole area; null = 全部.
   */
  picker?: { kind: "村里" | "投開票所"; units: UnitView[]; value: string | null; loading: boolean; onChange: (id: string | null) => void };
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
  const contest = !multi ? ctx.contest.get(unit.contestIds[0]!) : undefined;
  const seats = contest?.seats ?? 1;

  return (
    <Stack gap="sm">
      <Group gap="xs" justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="xs" align="baseline">
          <Title order={2} size="h3">{p.title ?? unit.name}</Title>
          <Badge variant="light" color="gray">{p.levelName}</Badge>
          {p.status === "locked" && <Badge variant="light" color="pink">已鎖定</Badge>}
          {p.status === "hover" && <Badge variant="outline" color="gray">預覽</Badge>}
        </Group>
        {p.picker && <SubPicker {...p.picker} undrawn={ctx.meta.boundary.undrawn} />}
      </Group>
      {p.status === "locked" && (
        <Button variant="subtle" size="compact-xs" onClick={p.onUnlock} style={{ alignSelf: "flex-start" }}>
          解除鎖定（或點選地圖空白處）
        </Button>
      )}

      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          {p.countyName && <KV k="所屬縣市" v={p.countyName} />}
          {p.townName && <KV k="所屬鄉鎮市區" v={p.townName} />}
          {ctx.singleContest && !ctx.referendum && meta.contests[0]!.scope.level === "national" && (
            <KV k="選區" v={`全國（單一選區${(meta.contests[0]!.seats ?? 1) > 1 ? `，選出 ${meta.contests[0]!.seats} 席` : ""}）`} />
          )}
          {contestName && <KV k={contest?.scope.level === "district" ? "選區" : "選舉"} v={seats > 1 && !ctx.singleContest ? `${contestName}（應選 ${seats} 席）` : contestName} />}
          {multi && !ctx.singleContest && <KV k="涵蓋" v={multiLabel(ctx, unit)} />}
          <KV k="投票日期" v={contest?.date ?? meta.election.date} />
        </Table.Tbody>
      </Table>

      <Text size="sm" fw={600}>目前檢視</Text>
      <Text size="sm">{p.currentView}</Text>

      {ctx.referendum ? <ReferendumTable {...p} d={d} abst={abst} /> : ctx.partyList ? <PartyListTable {...p} d={d} abst={abst} /> : multi ? <PartyTable {...p} d={d} abst={abst} /> : <CandidateTable {...p} d={d} abst={abst} />}

      <Text size="sm" fw={600}>概況</Text>
      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          <KV k={ctx.referendum ? "投票權人數" : "選舉人數"} v={fmtInt(s.electors)} />
          <KV k="投票數" v={fmtInt(s.ballotsCast)} />
          <KV k={ctx.referendum ? "投票率（投票數 ÷ 投票權人數）" : "投票率（投票數 ÷ 選舉人數）"} v={fmtPct(turnout(s))} />
          <KV k="有效票數" v={fmtInt(s.valid)} />
          <KV k="無效票數" v={fmtInt(s.invalid)} />
          <KV k={ctx.referendum ? "未投票（投票權人數 − 投票數）" : "未投票（選舉人數 − 投票數）"} v={fmtInt(abst)} />
        </Table.Tbody>
      </Table>

      {notes.length + (contest?.warnings.length ?? 0) > 0 && (
        <>
          <Text size="sm" fw={600}>註記</Text>
          {[...(contest?.warnings ?? []), ...notes.map((n) => n.note)].map((n, i) => (
            <Text key={`${i}-${n}`} size="xs" c="orange.8">⚠ {n}</Text>
          ))}
        </>
      )}

      <Divider />
      <SourceNotes meta={meta} levelLabel={p.mapLevelLabel} />
    </Stack>
  );
}

type TableProps = SidebarProps & { d: number | null; abst: number | null };

/** Select box for a locked area's villages or polling stations; "全部" shows the whole area. */
function SubPicker({ kind, units, value, loading, onChange, undrawn }: NonNullable<SidebarProps["picker"]> & { undrawn: string[] }) {
  const ALL = "__all__";
  const skip = new Set(undrawn);
  return (
    <Select
      size="xs"
      w={200}
      aria-label={`選擇${kind}`}
      disabled={loading || units.length === 0}
      placeholder={loading ? "載入中…" : `無${kind}資料`}
      data={units.length ? [{ value: ALL, label: `全部${kind}` }, ...units.map((u) => ({ value: u.id, label: `${u.name}${skip.has(u.id) ? "（地圖未繪出）" : ""}` }))] : []}
      value={units.length ? (value ?? ALL) : null}
      onChange={(v) => onChange(!v || v === ALL ? null : v)}
      allowDeselect={false}
      searchable
      maxDropdownHeight={280}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function CandidateTable({ ctx, unit, den, d, abst }: TableProps) {
  const choices = ctx.choicesByContest.get(unit.contestIds[0]!) ?? [];
  const ids = new Set(choices.flatMap((c) => c.candidacyIds));
  const cand = new Map(ctx.meta.candidacies.filter((c) => ids.has(c.id)).map((c) => [c.id, c]));
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
            {!ctx.live && <Table.Th ta="center">當選</Table.Th>}
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
                    <div style={{ overflowWrap: "anywhere" }}>
                      <div>
                        {c.labelZh.split("／").map((name, k) => (
                          <span key={name} style={{ whiteSpace: name.length > 12 ? "normal" : "nowrap" }}>{k > 0 && "／"}{name}{k === 0 && <wbr />}</span>
                        ))}
                      </div>
                      <Text size="xs" c="dimmed">{c.partyId ? (ctx.party.get(c.partyId)?.nameZh ?? c.partyId) : ""}</Text>
                    </div>
                  </Group>
                </Table.Td>
                <Num v={fmtInt(v)} />
                <Num v={fmtPct(d === null ? null : v / d)} />
                {!ctx.live && <Table.Td ta="center">
                  {ctx.byLot.has(c.id) ? "抽籤" : ctx.elected.get(c.id) ? "✓" : "—"}
                  {ctx.byLot.has(c.id) && <Text size="xs">同票，抽籤決定</Text>}
                  {quota === "women-quota" && <Text size="xs">婦女保障</Text>}
                  {quota === "displaced-by-women-quota" && <Text size="xs">因婦女保障落選</Text>}
                </Table.Td>}
              </Table.Tr>
            );
          })}
          {den.invalid && <ExtraRow label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} lead />}
          {den.abstain && <ExtraRow label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} lead />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">{ctx.live ? "開票中的數字不是最終結果；當選以中央選舉委員會公告為準。" : "「當選」指整場選舉的結果，不是該地區的得票排名。"}</Text>
      {choices.some((c) => ctx.byLot.has(c.id)) && (
        <Text size="xs" c="dimmed">「抽籤」：兩人同票爭最後一席，依法抽籤決定；中選會資料未記載抽籤結果，因此不標示當選。</Text>
      )}
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
      <Text size="sm" fw={600}>各政黨合計（分母：{denominatorLabel(den)}{ctx.live ? "" : `；共 ${seats.total} 席`}）</Text>
      <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>政黨</Table.Th>
            <Table.Th ta="right">得票數</Table.Th>
            <Table.Th ta="right">得票率</Table.Th>
            {!ctx.live && <Table.Th ta="right">當選席次</Table.Th>}
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
              {!ctx.live && <Num v={n ? String(n) : "—"} />}
            </Table.Tr>
          ))}
          {den.invalid && <ExtraRow label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} />}
          {den.abstain && <ExtraRow label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">{ctx.live ? "此層級涵蓋多場選舉：票數為各黨候選人目前得票合計。點選或切換到較細的層級可查看候選人。" : "此層級涵蓋多場選舉：票數為各黨候選人合計，席次為各場當選結果加總。點選或切換到較細的層級可查看候選人。"}</Text>
    </>
  );
}

/** 不分區政黨票: parties on the ballot, with the national seat allocation; names at 全國 only. */
function PartyListTable({ ctx, unit, den, d, abst }: TableProps) {
  const pl = ctx.partyList!;
  const alloc = new Map(pl.allocation.map((a) => [a.partyId, a]));
  const national = unit.id === "nat";
  const choices = ctx.meta.choices.filter((c) => c.contestId === unit.contestIds[0]).sort((a, b) => (unit.votes[b.id] ?? 0) - (unit.votes[a.id] ?? 0));
  const cand = new Map(ctx.meta.candidacies.map((c) => [c.id, c]));
  const person = new Map(ctx.meta.persons.map((x) => [x.id, x]));
  const total = pl.allocation.reduce((a, b) => a + b.seats, 0);
  return (
    <>
      <Text size="sm" fw={600}>政黨得票（分母：{denominatorLabel(den)}）</Text>
      <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>號次</Table.Th>
            <Table.Th>政黨</Table.Th>
            <Table.Th ta="right">得票數</Table.Th>
            <Table.Th ta="right">得票率</Table.Th>
            <Table.Th ta="right">全國席次</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {choices.map((c) => {
            const v = unit.votes[c.id] ?? 0;
            const n = c.partyId ? listSeats(ctx, c.partyId) : 0;
            return (
              <Table.Tr key={c.id}>
                <Table.Td>{c.ballotNumber}</Table.Td>
                <Table.Td style={{ whiteSpace: "normal" }}>
                  <Group gap={6} wrap="nowrap"><Swatch color={ctx.choiceColor.get(c.id) ?? NEUTRAL} />{c.labelZh}</Group>
                </Table.Td>
                <Num v={fmtInt(v)} />
                <Num v={fmtPct(d === null ? null : v / d)} />
                <Num v={n ? String(n) : "—"} />
              </Table.Tr>
            );
          })}
          {den.invalid && <ExtraRow label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} lead />}
          {den.abstain && <ExtraRow label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} lead />}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        共 {total} 席，依全國得票率分配給得票率達 {pl.thresholdPct}% 的政黨（{pl.thresholdBasis}）。「全國席次」為全國結果，不是該地區的席次。
      </Text>
      {national && (
        <>
          <Text size="sm" fw={600}>席次分配（中選會公告數值）</Text>
          <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>政黨</Table.Th>
                <Table.Th ta="right">得票率</Table.Th>
                <Table.Th ta="right">門檻以上政黨間占比</Table.Th>
                <Table.Th ta="right">席次</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...pl.allocation].filter((a) => a.seats > 0 || a.qualifiedSharePct !== null).sort((a, b) => b.voteSharePct - a.voteSharePct).map((a) => (
                <Table.Tr key={a.partyId}>
                  <Table.Td><Group gap={6} wrap="nowrap"><Swatch color={ctx.partyColor.get(a.partyId) ?? NEUTRAL} />{ctx.party.get(a.partyId)?.nameZh ?? a.partyId}</Group></Table.Td>
                  <Num v={`${a.voteSharePct.toFixed(2)}%`} />
                  <Num v={a.qualifiedSharePct === null ? "—" : `${a.qualifiedSharePct.toFixed(2)}%`} />
                  <Num v={String(a.seats)} />
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="sm" fw={600}>當選名單（依名單順位）</Text>
          {choices.filter((c) => c.partyId && (alloc.get(c.partyId)?.seats ?? 0) > 0).map((c) => {
            const elected = c.candidacyIds.map((id) => cand.get(id)).filter((x) => x !== undefined && x.elected);
            return (
              <Stack key={c.id} gap={2}>
                <Group gap={6} wrap="nowrap"><Swatch color={ctx.choiceColor.get(c.id) ?? NEUTRAL} /><Text size="xs" fw={600}>{c.labelZh}（{elected.length} 席）</Text></Group>
                <Text size="xs" style={{ lineHeight: 1.7 }}>
                  {elected.map((x, k) => (
                    <span key={x!.id} style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                      {x!.listRank}. {person.get(x!.personId)?.nameZh}{x!.electedNote === "women-quota" ? "（婦女保障）" : ""}{k < elected.length - 1 && "、"}
                    </span>
                  ))}
                </Text>
                {c.candidacyIds.map((id) => cand.get(id)).some((x) => x?.electedNote === "displaced-by-women-quota") && (
                  <Text size="xs" c="dimmed">
                    因婦女保障未當選：
                    {c.candidacyIds.map((id) => cand.get(id)).filter((x) => x?.electedNote === "displaced-by-women-quota").map((x) => `${x!.listRank}. ${person.get(x!.personId)?.nameZh}`).join("、")}
                  </Text>
                )}
              </Stack>
            );
          })}
        </>
      )}
    </>
  );
}

/** "73 個選區，各選 1 席" / "22 個縣市" / "12 個選區，共 65 席". */
function multiLabel(ctx: GroupContext, unit: UnitView): string {
  const cs = unit.contestIds.map((id) => ctx.contest.get(id));
  const seats = cs.reduce((a, c) => a + (c?.seats ?? 1), 0);
  const scope = cs[0]?.scope.level;
  const rep = /rep/.test(ctx.meta.group?.office ?? "");
  const kind = scope === "county" ? "縣市" : scope === "village" ? "村里" : scope === "town" ? (rep ? "選舉區" : "鄉鎮市區") : "選區";
  return seats === cs.length ? `${cs.length} 個${kind}，各選 1 席` : `${cs.length} 個${kind}，共 ${seats} 席`;
}

/** National referendum: 主文, 同意／不同意, and the 公民投票法第29條 test (binding only nationally). */
function ReferendumTable({ ctx, unit, den, d, abst, colorblind }: TableProps) {
  const r = ctx.referendum!;
  const st = referendumStatus(unit, r.rule);
  const national = unit.id === "nat";
  // While counting, electors and votes cover reported stations only: say "so far", never a verdict.
  const mark = (ok: boolean) => (ctx.live ? (ok ? "目前已達" : "目前未達") : ok ? "✓ 達成" : "✗ 未達成");
  return (
    <>
      <Text size="sm" fw={600}>主文</Text>
      <Text size="sm">{r.questionZh ?? "（尚未登錄）"}</Text>
      {r.questionSource && (
        <Fold label={`主文出處${r.questionReviewed ? "" : "（尚未人工核對）"}`}>
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {r.questionSource}
          </Text>
        </Fold>
      )}
      <Text size="sm" fw={600}>得票（分母：{denominatorLabel(den, true)}）</Text>
      <Table verticalSpacing={3} fz="xs" striped style={{ whiteSpace: "nowrap" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>選項</Table.Th>
            <Table.Th ta="right">票數</Table.Th>
            <Table.Th ta="right">比率</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(["agree", "disagree"] as const).map((id) => (
            <Table.Tr key={id}>
              <Table.Td><Group gap={6} wrap="nowrap"><Swatch color={choiceColorOf(ctx, id, colorblind)} />{id === "agree" ? "同意" : "不同意"}</Group></Table.Td>
              <Num v={fmtInt(unit.votes[id] ?? 0)} />
              <Num v={fmtPct(d === null ? null : (unit.votes[id] ?? 0) / d)} />
            </Table.Tr>
          ))}
          {den.invalid && <RefExtra label="無效票" color={INVALID_COLOR} n={unit.summary.invalid} d={d} />}
          {den.abstain && <RefExtra label="未投票" color={ABSTAIN_COLOR} n={abst} d={d} />}
        </Table.Tbody>
      </Table>
      <Text size="sm" fw={600}>通過門檻（{r.rule.legalBasis}）{national ? "" : "：此地區若單獨計算"}</Text>
      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          {r.rule.agreeMustExceedDisagree && <KV k="同意票多於不同意票" v={mark(st.agreeMore)} />}
          <KV k={`${quorumLabel(r.rule)}（${fmtInt(st.needed)} 票）`} v={`${fmtPct(st.agreeOfElectors)}　${mark(st.quorumMet)}`} />
          {national && !ctx.live && <KV k="投票結果" v={r.outcome === "passed" ? "通過" : r.outcome === "failed" ? "不通過" : "—"} />}
        </Table.Tbody>
      </Table>
      {ctx.live && <Text size="xs" c="dimmed">開票中：投票權人數與票數只含已回報的投開票所，門檻是否達到要等開票完成，並以中央選舉委員會公告為準。</Text>}
      {!national && <Text size="xs" c="dimmed">是否通過以全國計算；地方數值僅供參考。</Text>}
    </>
  );
}

function RefExtra({ label, color, n, d }: { label: string; color: string; n: number | null; d: number | null }) {
  return (
    <Table.Tr>
      <Table.Td><Group gap={6} wrap="nowrap"><Swatch color={color} />{label}</Group></Table.Td>
      <Num v={fmtInt(n)} />
      <Num v={fmtPct(n === null || d === null ? null : n / d)} />
    </Table.Tr>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (
  <Table.Tr>
    <Table.Td c="dimmed">{k}</Table.Td>
    <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{v}</Table.Td>
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
