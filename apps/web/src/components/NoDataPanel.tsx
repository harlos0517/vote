import { Badge, Group, Stack, Table, Text, Title } from "@mantine/core";
import type { GroupMetadataFile } from "@tw-election/schema";
import { codeOf } from "../lib/results.ts";

/**
 * Sidebar for a hovered area that is drawn but has no result in this election, instead of
 * falling back to the national figures: a village set up after the election, a non-village
 * area (river, 未編定), a township without this office, or a group whose votes cannot be split.
 */
export function NoDataPanel({
  code,
  name,
  levelName,
  meta,
  countyName,
  townName,
}: {
  code: string;
  /** NLSC's name for the area, when the boundary file has one ("[板]" marks a character it cannot encode). */
  name: string | null;
  levelName: string;
  meta: GroupMetadataFile;
  countyName: string | null;
  townName: string | null;
}) {
  const nonVillage = /[A-Z]\d+$/.test(code);
  // Notes on the township this area lies in (e.g. villages that have no boundary at all).
  const town = code.slice(0, 8);
  const townNotes = /^\d{11}$/.test(code)
    ? meta.boundary.notes.filter((n) => /^(town|tp):/.test(n.unit) && codeOf(n.unit).slice(0, 8) === town).map((n) => n.note)
    : [];
  return (
    <Stack gap="sm">
      <Group gap="xs" align="baseline">
        <Title order={2} size="h3">{name ? name.replace(/\[(.)\]/gu, "$1") : "無資料"}</Title>
        {name && <Badge variant="light" color="gray">無資料</Badge>}
        <Badge variant="light" color="gray">{levelName}</Badge>
        <Badge variant="outline" color="gray">預覽</Badge>
      </Group>
      <Table withRowBorders={false} verticalSpacing={1} fz="xs">
        <Table.Tbody>
          {countyName && <KV k="所屬縣市" v={countyName} />}
          {townName && <KV k="所屬鄉鎮市區" v={townName} />}
          <KV k="圖資代碼" v={code} />
          {name && /\[.\]/u.test(name) && <KV k="圖資原寫法" v={name} />}
        </Table.Tbody>
      </Table>
      <Text size="sm">
        {nonVillage
          ? "這塊圖面不屬於任何村里（例如河川、未編定地區），沒有選舉結果。"
          : "這塊圖面在本次選舉沒有對應的結果。"}
      </Text>
      {!nonVillage && (
        <Text size="xs" c="dimmed">
          可能原因：此項選舉不在這裡舉行、村里在選舉之後才設立（圖資比選舉新），或投開票所跨村里、票數無法拆分到村里。
        </Text>
      )}
      {townNotes.length > 0 && (
        <>
          <Text size="sm" fw={600}>所屬鄉鎮市區的註記</Text>
          {townNotes.map((n, i) => (
            <Text key={`${i}-${n}`} size="xs" c="orange.8">⚠ {n}</Text>
          ))}
        </>
      )}
    </Stack>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (
  <Table.Tr>
    <Table.Td c="dimmed">{k}</Table.Td>
    <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>{v}</Table.Td>
  </Table.Tr>
);
