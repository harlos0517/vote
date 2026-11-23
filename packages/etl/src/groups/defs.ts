/** Contest groups published in this release. Add an entry to add an election. */
import type { BoundaryDef, ElectionDef, ElGroupDef } from "./el-group.ts";

const B2024: BoundaryDef = { versionId: "nlsc-village-1120928", raw: "nlscVillage112", shapefile: /^VILLAGE_NLSC_1120928\.shp$/ };
const B2020: BoundaryDef = { versionId: "nlsc-village-1081121", raw: "nlscVillage108", shapefile: /^VILLAGE_MOI_1081121\.shp$/ };
const B2021: BoundaryDef = { versionId: "nlsc-village-1101214", raw: "nlscVillage110", shapefile: /^VILLAGE_MOI_1101214\.shp$/ };
const B2022: BoundaryDef = { versionId: "nlsc-village-1111118", raw: "nlscVillage111", shapefile: /^VILLAGE_MOI_1111118\.shp$/ };

export const E2024: ElectionDef = {
  id: "2024-01-13-president-legislative",
  date: "2024-01-13",
  nameZh: "2024年 第16任總統副總統及第11屆立法委員選舉",
  kinds: ["president", "legislative"],
};

export const E2020: ElectionDef = {
  id: "2020-01-11-president-legislative",
  date: "2020-01-11",
  nameZh: "2020年 第15任總統副總統及第10屆立法委員選舉",
  kinds: ["president", "legislative"],
};

export const E2022: ElectionDef = {
  id: "2022-11-26-local",
  date: "2022-11-26",
  nameZh: "2022年 地方公職人員選舉",
  kinds: ["local"],
};

export const E2021R: ElectionDef = {
  id: "2021-12-18-referendum",
  date: "2021-12-18",
  nameZh: "2021年 全國性公民投票",
  kinds: ["referendum"],
};

const R2021 = "votedata/votedata/2018_2021公投_2022修憲複決/";
const FULLWIDTH = (n: number) => String(n).replace(/\d/g, (c) => String.fromCharCode(0xff10 + Number(c)));

/** One group per case: the four cases were voted on together but each is its own question. */
const referendum2021 = (n: number): ElGroupDef => ({
  election: E2021R,
  local: `case-${n}`,
  nameZh: `全國性公民投票案第${n}案`,
  office: "referendum-national",
  electorate: "general",
  format: "rf",
  referendumCase: n,
  archiveDirs: [`${R2021}第${FULLWIDTH(n)}案全國性公投/`],
  boundary: B2021,
  contests: "single",
  choiceKind: "referendum",
  layout: "admin",
  warnings: [
    "村里及投開票所層級資料已取得並通過驗證，但目前僅發布至鄉鎮市區層級。",
    "通過門檻（公民投票法第29條）：有效同意票多於不同意票，且有效同意票達投票權人總額四分之一以上。門檻以全國計算，地方數值僅供參考。",
    "公投結果檔不含主文；主文另依公投公報登錄並註明出處。",
  ],
});

const L2022 = "votedata/votedata/voteData/2022-111年地方公職人員選舉/";

const COMMON_WARNINGS = [
  "村里及投開票所層級資料已取得並通過驗證，但目前僅發布至鄉鎮市區層級。",
  "人口數僅縣市以上層級有官方數值；以下層級標示為無資料。",
];

/** One 總統＋立委 election: the five offices CEC publishes in one `<year>總統立委/` folder. */
interface PresLegDef {
  election: ElectionDef;
  dir: string;
  boundary: BoundaryDef;
  /** 總統 term (任) and 立委 term (屆). */
  presidentTerm: number;
  legislatorTerm: number;
  /** Townships split between two 立委 districts (counted from the data, see the ETL report). */
  splitTowns: number;
}

const P2024: PresLegDef = { election: E2024, dir: "votedata/votedata/voteData/2024總統立委/", boundary: B2024, presidentTerm: 16, legislatorTerm: 11, splitTowns: 12 };
const P2020: PresLegDef = { election: E2020, dir: "votedata/votedata/voteData/2020總統立委/", boundary: B2020, presidentTerm: 15, legislatorTerm: 10, splitTowns: 12 };

function presidentLegislative(p: PresLegDef): ElGroupDef[] {
  const base = { election: p.election, boundary: p.boundary };
  const indigenous = (kind: "山地" | "平地"): ElGroupDef => ({
    ...base,
    local: kind === "山地" ? "legislator-highland-indigenous" : "legislator-lowland-indigenous",
    nameZh: `第${p.legislatorTerm}屆${kind}原住民立法委員選舉`,
    office: kind === "山地" ? "legislator-highland-indigenous" : "legislator-lowland-indigenous",
    electorate: kind === "山地" ? "highland-indigenous" : "lowland-indigenous",
    archiveDirs: [`${p.dir}${kind}立委/`],
    contests: "single",
    choiceKind: "candidate",
    seats: 3,
    layout: "admin",
    warnings: [
      ...COMMON_WARNINGS,
      `全國為單一選區，選出 3 席；僅${kind}原住民選舉人可投票，選舉人數與一般選舉不同。`,
      "許多鄉鎮市區的原住民選舉人很少，少數票數即可造成極端的得票率。",
    ],
  });
  return [
    {
      ...base,
      local: "president",
      nameZh: `第${p.presidentTerm}任總統副總統選舉`,
      office: "president",
      electorate: "general",
      archiveDirs: [`${p.dir}總統/`],
      contests: "single",
      choiceKind: "ticket",
      layout: "admin",
      warnings: COMMON_WARNINGS,
    },
    {
      ...base,
      local: "legislator-district",
      nameZh: `第${p.legislatorTerm}屆區域立法委員選舉`,
      office: "legislator-district",
      electorate: "general",
      archiveDirs: [`${p.dir}區域立委/`],
      contests: "district",
      contestPrefix: "ly",
      choiceKind: "candidate",
      layout: `ly${p.election.date.slice(0, 4)}`,
      warnings: [
        ...COMMON_WARNINGS,
        "73 個選舉區各選出 1 席。縣市與全國層級跨多個選區，因此以政黨合計呈現，不比較個別候選人。",
        `${p.splitTowns} 個鄉鎮市區分屬兩個選區，在鄉鎮層級依選區拆成兩塊，界線由村里合併而成。`,
      ],
    },
    indigenous("山地"),
    indigenous("平地"),
    {
      ...base,
      local: "legislator-party-list",
      nameZh: `第${p.legislatorTerm}屆全國不分區及僑居國外國民立法委員選舉（政黨票）`,
      office: "legislator-party-list",
      electorate: "general",
      archiveDirs: [`${p.dir}不分區政黨/`],
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
}

export const GROUPS: ElGroupDef[] = [
  ...presidentLegislative(P2024),
  ...presidentLegislative(P2020),
  {
    election: E2022,
    local: "mayor",
    nameZh: "直轄市長及縣市長選舉",
    office: "mayor-or-magistrate",
    electorate: "general",
    cecTypeCode: "C1",
    archiveDirs: [`${L2022}C1/prv/`, `${L2022}C1/city/`],
    extra: { adapter: "chiayi-2022-rerun", archiveDir: "votedata/votedata/2022年_嘉義市長重行選舉/", refArchiveDir: `${L2022}T1/city/`, date: "2022-12-18" },
    boundary: B2022,
    contests: "county",
    contestPrefix: "c1",
    contestNameSuffix: "長",
    choiceKind: "candidate",
    layout: "admin",
    warnings: [
      ...COMMON_WARNINGS,
      "22 個縣市各選出 1 位首長。全國層級跨多個縣市，以各政黨當選席次與得票合計呈現。",
      "嘉義市長選舉於 2022-12-18 舉行，與其他縣市不同日，並以不同格式另行發布。",
    ],
  },
  {
    election: E2022,
    local: "councilor-district",
    nameZh: "直轄市議員及縣市議員選舉（區域）",
    office: "councilor-district",
    electorate: "general",
    cecTypeCode: "T1",
    archiveDirs: [`${L2022}T1/prv/`, `${L2022}T1/city/`],
    boundary: B2022,
    contests: "district",
    contestPrefix: "t1",
    choiceKind: "candidate",
    layout: "t1-2022",
    warnings: [
      ...COMMON_WARNINGS,
      "160 個選舉區共選出 841 席，每區 1 至 13 席。縣市與全國層級跨多個選區，以政黨合計呈現；選區層級顯示當選席次最多的政黨。",
      "新竹市東區、北區分屬不同選區，在鄉鎮層級依選區拆成數塊，界線由村里合併而成。",
      "原住民議員（平地、山地）不在此地圖，將另以獨立檢視呈現。",
    ],
  },
  {
    election: E2022,
    local: "councilor-lowland-indigenous",
    nameZh: "直轄市議員及縣市議員選舉（平地原住民）",
    office: "councilor-lowland-indigenous",
    electorate: "lowland-indigenous",
    cecTypeCode: "T2",
    archiveDirs: [`${L2022}T2/prv/`, `${L2022}T2/city/`],
    boundary: B2022,
    contests: "district",
    contestPrefix: "t2",
    choiceKind: "candidate",
    layout: "t2-2022",
    warnings: [
      ...COMMON_WARNINGS,
      "僅平地原住民選舉人可投票，選舉人數與一般選舉不同；許多地區的選舉人很少，少數票數即可造成極端的得票率。",
      "只有設平地原住民議員選區的縣市才有資料，其他地區顯示為無資料。",
    ],
  },
  {
    election: E2022,
    local: "councilor-highland-indigenous",
    nameZh: "直轄市議員及縣市議員選舉（山地原住民）",
    office: "councilor-highland-indigenous",
    electorate: "highland-indigenous",
    cecTypeCode: "T3",
    archiveDirs: [`${L2022}T3/prv/`, `${L2022}T3/city/`],
    boundary: B2022,
    contests: "district",
    contestPrefix: "t3",
    choiceKind: "candidate",
    layout: "t3-2022",
    warnings: [
      ...COMMON_WARNINGS,
      "僅山地原住民選舉人可投票，選舉人數與一般選舉不同；許多地區的選舉人很少，少數票數即可造成極端的得票率。",
      "只有設山地原住民議員選區的縣市才有資料，其他地區顯示為無資料。",
    ],
  },
  ...[17, 18, 19, 20].map(referendum2021),
];
