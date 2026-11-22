import { Anchor, List, Stack, Text } from "@mantine/core";
import type { ContestMetadataFile } from "@tw-election/schema";

export function SourceNotes({ meta, levelLabel }: { meta: ContestMetadataFile; levelLabel: string }) {
  const warn = meta.validation.filter((c) => c.status === "warn");
  const passed = meta.validation.filter((c) => c.status === "pass").length;
  return (
    <Stack gap={6}>
      <Text size="xs">
        <b>選舉</b>：{meta.election.nameZh}（{meta.election.date}）・{meta.contest.nameZh}
      </Text>
      <Text size="xs"><b>地圖統計層級</b>：{levelLabel}</Text>
      <Text size="xs">
        <b>資料來源</b>：
        {meta.sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && "；"}
            <Anchor href={s.url} target="_blank" rel="noreferrer" size="xs">{s.publisher}〈{s.title}〉</Anchor>（{s.license}）
          </span>
        ))}
      </Text>
      <Text size="xs"><b>界線版次</b>：{meta.boundary.versionId}（村里界歷史圖資，依選舉前最近版次合併為縣市及鄉鎮市區）</Text>
      <Text size="xs">
        <b>資料驗證</b>：{passed} 項通過{warn.length > 0 && `，${warn.length} 項待人工確認`}（資料版本 {meta.release}）
      </Text>
      {(warn.length > 0 || meta.contest.warnings.length > 0) && (
        <List size="xs" spacing={2}>
          {warn.map((w) => <List.Item key={w.id}>{w.detail}</List.Item>)}
          {meta.contest.warnings.map((w) => <List.Item key={w}>{w}</List.Item>)}
        </List>
      )}
    </Stack>
  );
}
