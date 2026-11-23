/** Contest groups published in this release. Add an entry to add an election. */
import type { ElectionDef, ElGroupDef } from "./el-group.ts";

export const E2024: ElectionDef = {
  id: "2024-01-13-president-legislative",
  date: "2024-01-13",
  nameZh: "2024年 第16任總統副總統及第11屆立法委員選舉",
  kinds: ["president", "legislative"],
};

const COMMON_WARNINGS = [
  "村里及投開票所層級資料已取得並通過驗證，但目前僅發布至鄉鎮市區層級。",
  "人口數僅縣市以上層級有官方數值；以下層級標示為無資料。",
];

export const GROUPS: ElGroupDef[] = [
  {
    election: E2024,
    local: "president",
    nameZh: "第16任總統副總統選舉",
    office: "president",
    electorate: "general",
    archiveDir: "votedata/votedata/voteData/2024總統立委/總統/",
    contests: "single",
    choiceKind: "ticket",
    layout: "admin",
    warnings: COMMON_WARNINGS,
  },
  {
    election: E2024,
    local: "legislator-district",
    nameZh: "第11屆區域立法委員選舉",
    office: "legislator-district",
    electorate: "general",
    archiveDir: "votedata/votedata/voteData/2024總統立委/區域立委/",
    contests: "district",
    choiceKind: "candidate",
    layout: "ly2024",
    warnings: [
      ...COMMON_WARNINGS,
      "73 個選舉區各選出 1 席。縣市與全國層級跨多個選區，因此以政黨合計呈現，不比較個別候選人。",
      "12 個鄉鎮市區分屬兩個選區，在鄉鎮層級依選區拆成兩塊，界線由村里合併而成。",
    ],
  },
  {
    election: E2024,
    local: "legislator-highland-indigenous",
    nameZh: "第11屆山地原住民立法委員選舉",
    office: "legislator-highland-indigenous",
    electorate: "highland-indigenous",
    archiveDir: "votedata/votedata/voteData/2024總統立委/山地立委/",
    contests: "single",
    choiceKind: "candidate",
    seats: 3,
    layout: "admin",
    warnings: [
      ...COMMON_WARNINGS,
      "全國為單一選區，選出 3 席；僅山地原住民選舉人可投票，選舉人數與一般選舉不同。",
      "許多鄉鎮市區的原住民選舉人很少，少數票數即可造成極端的得票率。",
    ],
  },
  {
    election: E2024,
    local: "legislator-lowland-indigenous",
    nameZh: "第11屆平地原住民立法委員選舉",
    office: "legislator-lowland-indigenous",
    electorate: "lowland-indigenous",
    archiveDir: "votedata/votedata/voteData/2024總統立委/平地立委/",
    contests: "single",
    choiceKind: "candidate",
    seats: 3,
    layout: "admin",
    warnings: [
      ...COMMON_WARNINGS,
      "全國為單一選區，選出 3 席；僅平地原住民選舉人可投票，選舉人數與一般選舉不同。",
      "許多鄉鎮市區的原住民選舉人很少，少數票數即可造成極端的得票率。",
    ],
  },
  {
    election: E2024,
    local: "legislator-party-list",
    nameZh: "第11屆全國不分區及僑居國外國民立法委員選舉（政黨票）",
    office: "legislator-party-list",
    electorate: "general",
    archiveDir: "votedata/votedata/voteData/2024總統立委/不分區政黨/",
    contests: "single",
    choiceKind: "party",
    seats: 34,
    layout: "admin",
    warnings: [
      ...COMMON_WARNINGS,
      "選票上為政黨；席次依全國得票率分配給得票率達 5% 的政黨，地方層級只呈現得票，不分配席次。",
    ],
  },
];
