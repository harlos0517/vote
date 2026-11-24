/**
 * Election picker model (建議 11): 大分類 (office family) → 中分類 (立委／議員: 區域, 不分區,
 * 山地原住民, 平地原住民) → 小分類 (year slider; 公投 also picks the case). Pure, from the release index.
 */
import type { Office, ReleaseIndexFile } from "@tw-election/schema";

export interface Category {
  key: string;
  label: string;
  subs: { office: Office; label: string }[];
}

export const CATEGORIES: Category[] = [
  { key: "president", label: "總統副總統", subs: [{ office: "president", label: "總統副總統" }] },
  {
    key: "legislator",
    label: "立法委員",
    subs: [
      { office: "legislator-district", label: "區域" },
      { office: "legislator-party-list", label: "不分區" },
      { office: "legislator-highland-indigenous", label: "山地原住民" },
      { office: "legislator-lowland-indigenous", label: "平地原住民" },
    ],
  },
  { key: "mayor", label: "(直轄)縣市長", subs: [{ office: "mayor-or-magistrate", label: "縣市長" }] },
  {
    key: "councilor",
    label: "(直轄)縣市議員",
    subs: [
      { office: "councilor-district", label: "區域" },
      { office: "councilor-highland-indigenous", label: "山地原住民" },
      { office: "councilor-lowland-indigenous", label: "平地原住民" },
    ],
  },
  {
    key: "referendum",
    label: "公投",
    subs: [
      { office: "referendum-national", label: "全國性公投" },
      { office: "constitutional-referendum", label: "修憲複決" },
    ],
  },
];

export interface PickerGroup {
  id: string;
  office: Office;
  date: string;
  nameZh: string;
}

export const pickerGroups = (index: ReleaseIndexFile): PickerGroup[] =>
  index.elections.flatMap((e) => e.groups.map((g) => ({ id: g.id, office: g.office, date: e.date, nameZh: g.nameZh })));

export const categoryOf = (office: Office) => CATEGORIES.find((c) => c.subs.some((s) => s.office === office));

/** Categories and subs that have at least one group in this release. */
export function available(groups: PickerGroup[]): Category[] {
  const offices = new Set(groups.map((g) => g.office));
  return CATEGORIES.map((c) => ({ ...c, subs: c.subs.filter((s) => offices.has(s.office)) })).filter((c) => c.subs.length > 0);
}

/**
 * The group to open for an office, staying near the year being viewed: the group whose date is
 * closest to `near` (ties → newer; within a date, the first, e.g. the lowest referendum case).
 */
export function nearestGroup(groups: PickerGroup[], office: Office, near: string | null): PickerGroup | undefined {
  const mine = groups.filter((g) => g.office === office);
  if (!near) return [...mine].sort((a, b) => b.date.localeCompare(a.date))[0];
  const d = (g: PickerGroup) => Math.abs(Date.parse(g.date) - Date.parse(near));
  return [...mine].sort((a, b) => d(a) - d(b) || b.date.localeCompare(a.date))[0];
}
