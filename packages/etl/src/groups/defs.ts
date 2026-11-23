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
];
