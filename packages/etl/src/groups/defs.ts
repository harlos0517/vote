/** Contest groups published in this release. Add an entry to add an election. */
import type { Office } from "@tw-election/schema";
import type { BoundaryDef, ElectionDef, ElGroupDef } from "./el-group.ts";

const B2024: BoundaryDef = { versionId: "nlsc-village-1120928", raw: "nlscVillage112", shapefile: /^VILLAGE_NLSC_1120928\.shp$/ };
/**
 * 2018-11-24 would use 1070205 (the last snapshot before the vote), but that file's coordinates
 * are corrupt (every polygon lies in a ~6 m box near 118.7556°E 0.0002°N; NLSC 村里界歷史圖資_106).
 * 1071130, six days after the vote, is used instead; the join checks confirm it fits 2018's units.
 */
const B2018: BoundaryDef = { versionId: "nlsc-village-1071130", raw: "nlscVillage107", shapefile: /^VILLAGE_MOI_1071130\.shp$/ };
const B2018_NOTE = "界線使用選後 6 天的 1071130 版：選前最近的 1070205 版圖檔座標損毀（國土測繪中心原檔），無法使用。";
/**
 * 2016 has no sound snapshot: NLSC's history starts with 1070205 (2018-02-05), published with
 * corrupt coordinates. Its shapes and attributes are intact and the distortion linear, so the
 * build restores it by an affine fit against 1071130 (geo/restore.ts). It predates 臺南市's 2018
 * village reorganisation, which no later snapshot does.
 */
const B2016: BoundaryDef = {
  versionId: "nlsc-village-1070205-restored",
  raw: "nlscVillage106",
  shapefile: /^VILLAGE_MOI_1070205\.shp$/,
  restoreFrom: B2018,
};
const B2016_NOTE =
  "界線使用國土測繪中心 1070205 版（2018-02-05）：此版原檔座標損毀（所有圖形落在約 6 公尺範圍內），但圖形與屬性完整、變形為線性，本站以 1071130 版中未變動的村里擬合仿射轉換還原，誤差約 1 公尺；這是本站的修正，不是國土測繪中心公布的原始座標。";
const B2020: BoundaryDef = { versionId: "nlsc-village-1081121", raw: "nlscVillage108", shapefile: /^VILLAGE_MOI_1081121\.shp$/ };
const B2020_1091030: BoundaryDef = { versionId: "nlsc-village-1091030", raw: "nlscVillage109", shapefile: /^VILLAGE_MOI_1091030\.shp$/ };
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

/** 2014 is the nearest registry-coded election: its 村里長 and 縣市長 files name every unit. */
const REGISTRY_2014 = ["votedata/votedata/voteData/2014-103年地方公職人員選舉/村里長/", "votedata/votedata/voteData/2014-103年地方公職人員選舉/縣市市長/", "votedata/votedata/voteData/2014-103年地方公職人員選舉/直轄市市長/"];

/**
 * Pre-2014 files: CEC sequence codes, translated by name (adapters/registry.ts). Before
 * 2010-12-25 the 五都 did not exist yet: 臺北縣 and the 臺中、臺南、高雄 counties are matched to
 * the later 新北市 and merged cities through mappings/admin-renames.csv.
 */
const SEQ_NOTE = (y: string) =>
  `${y} 年的中選會檔案使用中選會自編的縣市、鄉鎮、村里序號，已依名稱對應為戶政代碼（參照 2014 年地方選舉檔案）；改制的縣市（桃園縣 2014-12-25 改制；臺北縣、臺中縣、臺南縣、高雄縣 2010-12-25 改制或合併）依改制後的區、里對應。`;
const APOS_NOTE = (y: string) => `${y} 年的中選會檔案以撇號標示代碼欄位（例如 '01），讀取時移除。`;
const MERGER_NOTE = "2010 年 12 月 25 日五都改制前的選舉：地圖以改制後的縣市與區呈現，原臺北縣、臺中縣、臺南縣、高雄縣的鄉鎮市與村，分別對應到新北市、臺中市、臺南市、高雄市的區與里。";

/** 第7屆立委: 2008-01-12 (中選會 96-08-08 選舉工作進行程序表). */
export const E2008L: ElectionDef = {
  id: "2008-01-12-legislative",
  date: "2008-01-12",
  nameZh: "2008年 第7屆立法委員選舉",
  kinds: ["legislative"],
};
export const E2008P: ElectionDef = {
  id: "2008-03-22-president",
  date: "2008-03-22",
  nameZh: "2008年 第12任總統副總統選舉",
  kinds: ["president"],
};

/*
 * Phase 4, 2004–2006. Dates: zh.wikipedia.org (2004年中華民國總統選舉：2004年3月20日；
 * 2004年中華民國立法委員選舉：2004年12月11日；2005年中華民國任務型國民大會代表選舉：2005年5月14日；
 * 2005年中華民國縣市長、縣市議員暨鄉鎮市長選舉：2005年12月3日；2006年中華民國直轄市市長暨市議員選舉：2006年12月9日).
 */
export const E2004P: ElectionDef = { id: "2004-03-20-president", date: "2004-03-20", nameZh: "2004年 第11任總統副總統選舉", kinds: ["president"] };
export const E2004L: ElectionDef = { id: "2004-12-11-legislative", date: "2004-12-11", nameZh: "2004年 第6屆立法委員選舉", kinds: ["legislative"] };
export const E2005N: ElectionDef = { id: "2005-05-14-national-assembly", date: "2005-05-14", nameZh: "2005年 任務型國民大會代表選舉", kinds: ["national-assembly"] };
export const E2005: ElectionDef = { id: "2005-12-03-local", date: "2005-12-03", nameZh: "2005–2006年 地方公職人員選舉", kinds: ["local"] };
/** Old multi-seat 立委 districts (複數選區單記不可讓渡投票). */
const SNTV_NOTE = (districts: number, seats: number, range: string) =>
  `區域立委為複數選區：${districts} 個選舉區共選出 ${seats} 席（每區 ${range} 席）。全國不分區及僑居國外國民的席次不在中選會此檔案中。縣市與全國層級以政黨合計呈現。`;
const OLD_NOTES = (y: string) => [B2016_NOTE, SEQ_NOTE(y), MERGER_NOTE, APOS_NOTE(y), "此年代的中選會檔案使用舊的政黨編號（例如民主進步黨為 2），已依政黨名稱換成現行代碼（無黨籍為 999）。"];

export const E2012: ElectionDef = {
  id: "2012-01-14-president-legislative",
  date: "2012-01-14",
  nameZh: "2012年 第13任總統副總統及第8屆立法委員選舉",
  kinds: ["president", "legislative"],
};

export const E2016: ElectionDef = {
  id: "2016-01-16-president-legislative",
  date: "2016-01-16",
  nameZh: "2016年 第14任總統副總統及第9屆立法委員選舉",
  kinds: ["president", "legislative"],
};

export const E2018: ElectionDef = {
  id: "2018-11-24-local",
  date: "2018-11-24",
  nameZh: "2018年 地方公職人員選舉",
  kinds: ["local"],
};
const L2018 = "votedata/votedata/voteData/2018-107年地方公職人員選舉/";

export const E2014: ElectionDef = {
  id: "2014-11-29-local",
  date: "2014-11-29",
  nameZh: "2014年 地方公職人員選舉",
  kinds: ["local"],
};
const L2014 = "votedata/votedata/voteData/2014-103年地方公職人員選舉/";
const APOSTROPHE_NOTE = "2014 年的中選會檔案以撇號標示代碼欄位（例如 '63），讀取時移除。";

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

export const E2018R: ElectionDef = {
  id: "2018-11-24-referendum",
  date: "2018-11-24",
  nameZh: "2018年 全國性公民投票",
  kinds: ["referendum"],
};

/** One group per case: cases voted on together are still separate questions. */
const nationalReferendum = (election: ElectionDef, boundary: BoundaryDef, rfTownCodesFrom?: string[], villages = false) => (n: number): ElGroupDef => ({
  election,
  villages,
  mixSnapshots: villages,
  ...(rfTownCodesFrom ? { rfTownCodesFrom } : {}),
  local: `case-${n}`,
  nameZh: `全國性公民投票案第${n}案`,
  office: "referendum-national",
  electorate: "general",
  format: "rf",
  referendumCase: n,
  archiveDirs: [`${R2021}第${FULLWIDTH(n)}案全國性公投/`],
  boundary,
  contests: "single",
  choiceKind: "referendum",
  layout: "admin",
  warnings: [
    "投開票所層級資料已通過驗證；地圖只到村里層級，各投開票所的得票可在鎖定村里後於側邊欄查看。",
    "通過門檻（公民投票法第29條）：有效同意票多於不同意票，且有效同意票達投票權人總額四分之一以上。門檻以全國計算，地方數值僅供參考。",
    "公投結果檔不含主文；主文另依公投公報登錄並註明出處。",
    ...(rfTownCodesFrom ? ["此屆公投結果檔的鄉鎮市區代碼為中選會自編序號，已依名稱逐一對應為戶政代碼（同日地方選舉資料），並全數核對。", B2018_NOTE] : []),
  ],
});

export const E2022C: ElectionDef = {
  id: "2022-11-26-constitutional-referendum",
  date: "2022-11-26",
  nameZh: "2022年 憲法修正案公民複決",
  kinds: ["referendum"],
};

/**
 * 憲法修正案公民複決第1案 (18 歲公民權), held with the 2022 local elections. Same rf* files as
 * a national referendum, but its own rule (憲法增修條文第12條, rf-group.ts CONSTITUTIONAL_RULE).
 */
const CONSTITUTIONAL_2022: ElGroupDef = {
  election: E2022C,
  villages: true,
  mixSnapshots: true,
  local: "case-1",
  nameZh: "憲法修正案公民複決第1案",
  office: "constitutional-referendum",
  electorate: "general",
  format: "rf",
  referendumCase: 1,
  archiveDirs: [`${R2021}第１案修憲複決/`],
  boundary: B2022,
  contests: "single",
  choiceKind: "referendum",
  layout: "admin",
  warnings: [
    "投開票所層級資料已通過驗證；地圖只到村里層級，各投開票所的得票可在鎖定村里後於側邊欄查看。",
    "通過門檻（中華民國憲法增修條文第12條）：有效同意票過選舉人總額之半數。門檻以全國計算，地方數值僅供參考。",
    "與 2022 年地方公職人員選舉同日投票；投票權人數與同日地方選舉的選舉人數不同，兩者不可直接相比。",
    "結果檔不含主文；主文另依中選會公告登錄並註明出處。",
  ],
};

const L2022 = "votedata/votedata/voteData/2022-111年地方公職人員選舉/";

/** Shared by many groups: never mutate (groups copy their warnings before the pipeline appends). */
const COMMON_WARNINGS: readonly string[] = [
  "投開票所層級資料已通過驗證；地圖只到村里層級，各投開票所的得票可在鎖定村里後於側邊欄查看。",
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
  /** Publish the 村里 level (Phase 2a: years whose villages match their snapshot). */
  villages?: boolean;
  /** Mix snapshots per township where villages were reorganised (geo/mix.ts). */
  mix?: boolean;
  /** Extra warnings for every group of this election. */
  notes?: string[];
  /** Folder names inside `dir` when they differ from 2012–2024's (2008: 區域, 山原, 平原). */
  subdirs?: Partial<Record<"president" | "district" | "山地" | "平地" | "partyList", string>>;
  /** Only these offices (2008: 總統 and 立委 were separate elections). */
  only?: Office[];
  /** Seats of each indigenous 立委 race (default 3; older terms elected more). */
  indigenousSeats?: number;
  /** Replaces the 73-single-seat-districts note (older terms: multi-seat districts). */
  districtNote?: string;
  /** Files in CEC sequence codes: registry-coded directories to translate them by name. */
  registryFrom?: string[];
  /** 原住民立委 files that agree only from township level up (see ElGroupDef.townsAndAbove). */
  indigenousTownsOnly?: boolean;
  /** The 原住民立委 files stop at township level (2004): no 村里 level, with this note. */
  indigenousNoVillages?: string;
}

const P2024: PresLegDef = { election: E2024, dir: "votedata/votedata/voteData/2024總統立委/", boundary: B2024, presidentTerm: 16, legislatorTerm: 11, splitTowns: 12, villages: true };
const P2016: PresLegDef = {
  election: E2016,
  dir: "votedata/votedata/voteData/2016總統立委/",
  boundary: B2016,
  presidentTerm: 14,
  legislatorTerm: 9,
  splitTowns: 12,
  villages: true,
  mix: true,
  indigenousTownsOnly: true,
  notes: [B2016_NOTE, "2016 年的中選會檔案名稱帶有選舉種類代碼（例如 elbase_P1.csv）；同目錄的 old/ 為以中選會自編序號編碼的同一份資料，未使用。"],
};
const P2012: PresLegDef = {
  election: E2012,
  dir: "votedata/votedata/voteData/20120114-總統及立委/",
  boundary: B2016,
  presidentTerm: 13,
  legislatorTerm: 8,
  splitTowns: 12, // counted from the 區域立委 elprof
  villages: true,
  mix: true,
  // 2014 is the nearest registry-coded election: its 村里長 and 縣市長 files name every unit.
  registryFrom: ["votedata/votedata/voteData/2014-103年地方公職人員選舉/村里長/", "votedata/votedata/voteData/2014-103年地方公職人員選舉/縣市市長/", "votedata/votedata/voteData/2014-103年地方公職人員選舉/直轄市市長/"],
  notes: [
    B2016_NOTE,
    "2012 年的中選會檔案使用中選會自編的縣市、鄉鎮、村里序號（例如臺北市為 01），已依名稱對應為戶政代碼（參照 2014 年地方選舉檔案）；桃園縣於 2014-12-25 改制為桃園市，其鄉鎮市與村依改制後的區、里對應。",
    "2012 年的中選會檔案以撇號標示代碼欄位（例如 '01），讀取時移除。",
  ],
};
const P2008L: PresLegDef = {
  election: E2008L,
  dir: "votedata/votedata/voteData/2008立委/",
  subdirs: { district: "區域", 山地: "山原", 平地: "平原" },
  only: ["legislator-district", "legislator-highland-indigenous", "legislator-lowland-indigenous", "legislator-party-list"],
  boundary: B2016,
  presidentTerm: 12,
  legislatorTerm: 7,
  splitTowns: 12,
  villages: true,
  mix: true,
  registryFrom: REGISTRY_2014,
  notes: [B2016_NOTE, SEQ_NOTE("2008"), MERGER_NOTE, APOS_NOTE("2008")],
};
const P2008P: PresLegDef = {
  ...P2008L,
  election: E2008P,
  dir: "votedata/votedata/voteData/",
  subdirs: { president: "20080322-總統" },
  only: ["president"],
};
const P2004P: PresLegDef = {
  election: E2004P,
  dir: "votedata/votedata/voteData/",
  subdirs: { president: "2004   11任總統" },
  only: ["president"],
  boundary: B2016,
  presidentTerm: 11,
  legislatorTerm: 6,
  splitTowns: 0,
  villages: true,
  mix: true,
  registryFrom: REGISTRY_2014,
  notes: [B2016_NOTE, SEQ_NOTE("2004"), MERGER_NOTE],
};
const P2004L: PresLegDef = {
  ...P2004P,
  election: E2004L,
  dir: "votedata/votedata/voteData/2004第6屆立法委員/",
  subdirs: { district: "區域", 山地: "山原", 平地: "平原" },
  only: ["legislator-district", "legislator-highland-indigenous", "legislator-lowland-indigenous"],
  indigenousSeats: 4,
  indigenousNoVillages: "此屆原住民立委的中選會檔案只到鄉鎮市區層級，沒有村里層級。",
  districtNote: SNTV_NOTE(29, 168, "1 至 13"),
  notes: OLD_NOTES("2004"),
};
const P2020: PresLegDef = { election: E2020, dir: "votedata/votedata/voteData/2020總統立委/", boundary: B2020, presidentTerm: 15, legislatorTerm: 10, splitTowns: 12, villages: true, mix: true };

function presidentLegislative(p: PresLegDef): ElGroupDef[] {
  const base = { election: p.election, boundary: p.boundary, villages: p.villages ?? false, mixSnapshots: p.mix ?? false, ...(p.registryFrom ? { registryFrom: p.registryFrom } : {}) };
  const indigenous = (kind: "山地" | "平地"): ElGroupDef => ({
    ...base,
    local: kind === "山地" ? "legislator-highland-indigenous" : "legislator-lowland-indigenous",
    nameZh: `第${p.legislatorTerm}屆${kind}原住民立法委員選舉`,
    office: kind === "山地" ? "legislator-highland-indigenous" : "legislator-lowland-indigenous",
    electorate: kind === "山地" ? "highland-indigenous" : "lowland-indigenous",
    archiveDirs: [`${p.dir}${p.subdirs?.[kind] ?? `${kind}立委`}/`],
    contests: "single",
    choiceKind: "candidate",
    seats: p.indigenousSeats ?? 3,
    layout: "admin",
    ...(p.indigenousTownsOnly ? { townsAndAbove: true, villages: false, mixSnapshots: false } : {}),
    ...(p.indigenousNoVillages ? { villages: false, mixSnapshots: false } : {}),
    warnings: [
      ...(p.indigenousNoVillages ? [p.indigenousNoVillages] : []),
      ...(p.indigenousTownsOnly ? COMMON_WARNINGS.slice(1) : COMMON_WARNINGS),
      ...(p.notes ?? []),
      ...(p.indigenousTownsOnly
        ? ["此屆原住民立委的中選會得票檔，有 310 個投開票所與 137 個村里（群組）的得票另列在概況檔沒有的編號下，選舉人數與有效票卻併入其他村里；兩檔只在鄉鎮市區以上一致，因此只發布到鄉鎮市區層級，沒有村里層級。"]
        : []),
      `全國為單一選區，選出 ${p.indigenousSeats ?? 3} 席；僅${kind}原住民選舉人可投票，選舉人數與一般選舉不同。`,
      "許多鄉鎮市區的原住民選舉人很少，少數票數即可造成極端的得票率。",
    ],
  });
  const all: ElGroupDef[] = [
    {
      ...base,
      local: "president",
      nameZh: `第${p.presidentTerm}任總統副總統選舉`,
      office: "president",
      electorate: "general",
      archiveDirs: [`${p.dir}${p.subdirs?.president ?? "總統"}/`],
      contests: "single",
      choiceKind: "ticket",
      layout: "admin",
      warnings: [...COMMON_WARNINGS, ...(p.notes ?? [])],
    },
    {
      ...base,
      local: "legislator-district",
      nameZh: `第${p.legislatorTerm}屆區域立法委員選舉`,
      office: "legislator-district",
      electorate: "general",
      archiveDirs: [`${p.dir}${p.subdirs?.district ?? "區域立委"}/`],
      contests: "district",
      contestPrefix: "ly",
      choiceKind: "candidate",
      layout: `ly${p.election.date.slice(0, 4)}`,
      warnings: [
        ...COMMON_WARNINGS, ...(p.notes ?? []),
        p.districtNote ?? "73 個選舉區各選出 1 席。縣市與全國層級跨多個選區，因此以政黨合計呈現，不比較個別候選人。",
        ...(p.splitTowns ? [`${p.splitTowns} 個鄉鎮市區分屬兩個選區，在鄉鎮層級依選區拆成兩塊，界線由村里合併而成。`] : []),
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
      archiveDirs: [`${p.dir}${p.subdirs?.partyList ?? "不分區政黨"}/`],
      contests: "single",
      choiceKind: "party",
      seats: 34,
      layout: "admin",
      warnings: [
        ...COMMON_WARNINGS, ...(p.notes ?? []),
        "選票上為政黨；席次依全國得票率分配給得票率達 5% 的政黨，地方層級只呈現得票，不分配席次。",
      ],
    },
  ];
  return p.only ? all.filter((g) => p.only!.includes(g.office)) : all;
}

/** One 地方公職人員選舉: 縣市長 and the three kinds of 議員, each split by CEC into 直轄市 / 縣市 folders. */
interface LocalDef {
  election: ElectionDef;
  boundary: BoundaryDef;
  dirs: {
    mayor: string[];
    councilor: string[];
    lowland: string[];
    highland: string[];
    /** Township and village offices (D1, D2, R1, R2, R3, V1). */
    townshipMayor: string[];
    indigenousChief: string[];
    townshipRep: string[];
    lowlandRep: string[];
    indigenousRep: string[];
    villageChief: string[];
  };
  extra?: ElGroupDef["extra"];
  mayorWarnings: string[];
  councilorWarnings: string[];
  /** Notes for the indigenous-councillor and township / village groups (boundary, file quirks). */
  notes?: string[];
  /** CEC sequence codes: registry-coded directories to translate them (ElGroupDef.registryFrom). */
  registryFrom?: string[];
  /** Combined maps: directories voted on another day (ElGroupDef.dirDates). */
  dirDates?: { prefix: string; date: string }[];
  /** 2010-06-12 layout directories (ElGroupDef.legacy). */
  legacy?: { prefixes: string[]; modernPartiesFrom: string[] };
  /** Groups without a 村里 level (2010-06-12 代表: 選區 rows only). */
  noVillages?: ElGroupDef["office"][];
  /** Pre-2010: old 縣 and 市 of merged counties elected separately (ElGroupDef.oldCountyContests). */
  oldCountyContests?: boolean;
  /** Pre-2008: the 選區 field of county-, township- and village-wide files means nothing (ElGroupDef.ignoreDist). */
  ignoreDist?: boolean;
  /** Publish the 村里 level (Phase 2a: years whose villages match their snapshot). */
  villages?: boolean;
  /** Mix snapshots per township where villages were reorganised (geo/mix.ts). */
  mix?: boolean;
}

const L22: LocalDef = {
  election: E2022,
  villages: true,
  boundary: B2022,
  dirs: {
    mayor: [`${L2022}C1/prv/`, `${L2022}C1/city/`],
    councilor: [`${L2022}T1/prv/`, `${L2022}T1/city/`],
    lowland: [`${L2022}T2/prv/`, `${L2022}T2/city/`],
    highland: [`${L2022}T3/prv/`, `${L2022}T3/city/`],
    townshipMayor: [`${L2022}D1/`],
    indigenousChief: [`${L2022}D2/`],
    townshipRep: [`${L2022}R1/`],
    lowlandRep: [`${L2022}R2/`],
    indigenousRep: [`${L2022}R3/`],
    villageChief: [`${L2022}V1/`],
  },
  extra: { adapter: "chiayi-2022-rerun", archiveDir: "votedata/votedata/2022年_嘉義市長重行選舉/", refArchiveDir: `${L2022}T1/city/`, date: "2022-12-18" },
  mayorWarnings: ["嘉義市長選舉於 2022-12-18 舉行，與其他縣市不同日，並以不同格式另行發布。"],
  councilorWarnings: [
    "160 個選舉區共選出 841 席，每區 1 至 13 席。縣市與全國層級跨多個選區，以政黨合計呈現；選區層級顯示當選席次最多的政黨。",
    "新竹市東區、北區分屬不同選區，在鄉鎮層級依選區拆成數塊，界線由村里合併而成。",
  ],
};

const L14: LocalDef = {
  election: E2014,
  villages: true,
  mix: true,
  boundary: B2016,
  dirs: {
    mayor: [`${L2014}直轄市市長/`, `${L2014}縣市市長/`],
    councilor: [`${L2014}直轄市區域議員/`, `${L2014}縣市區域議員/`],
    lowland: [`${L2014}直轄市平原議員/`, `${L2014}縣市平原議員/`],
    highland: [`${L2014}直轄市山原議員/`, `${L2014}縣市山原議員/`],
    townshipMayor: [`${L2014}縣市鄉鎮市長/`],
    indigenousChief: [`${L2014}直轄市區長/`],
    townshipRep: [`${L2014}縣市鄉鎮市民代表/`],
    lowlandRep: [`${L2014}縣市鄉鎮市民平原代表/`],
    indigenousRep: [`${L2014}直轄市區民代表/`],
    villageChief: [`${L2014}村里長/`],
  },
  mayorWarnings: [APOSTROPHE_NOTE, B2016_NOTE],
  councilorWarnings: [
    "164 個選舉區共選出 841 席，每區 1 至 13 席。縣市與全國層級跨多個選區，以政黨合計呈現；選區層級顯示當選席次最多的政黨。",
    "新竹市東區、北區分屬不同選區，在鄉鎮層級依選區拆成數塊，界線由村里合併而成。",
    APOSTROPHE_NOTE,
    B2016_NOTE,
  ],
  notes: [APOSTROPHE_NOTE, B2016_NOTE],
};

/**
 * 2009-12-05 (17 counties: 縣市長, 縣市議員, 鄉鎮市長) and 2010-11-27 (五都: 市長, 議員) as one
 * map per office covering all 22 counties; each contest carries its own date.
 */
export const E2009: ElectionDef = {
  id: "2009-12-05-local",
  date: "2009-12-05",
  nameZh: "2009–2010年 地方公職人員選舉",
  kinds: ["local"],
};
const L2009 = "votedata/votedata/voteData/20091205-縣市長縣市議員及鄉鎮長/";
const L2010 = "votedata/votedata/voteData/20101127-五都市長議員及里長/";
const TWO_ROUNDS =
  "此地圖合併兩次投票：17 個縣市於 2009-12-05 選出縣市長、縣市議員、鄉鎮市長；新北市、臺北市、臺中市、臺南市、高雄市（五都）於 2010-11-27 選出市長、市議員。側邊欄顯示各場選舉的投票日。";
const L09: LocalDef = {
  election: E2009,
  villages: true,
  mix: true,
  boundary: B2016,
  registryFrom: REGISTRY_2014,
  dirDates: [{ prefix: L2010, date: "2010-11-27" }],
  dirs: {
    mayor: [`${L2009}縣市長/`, `${L2010}市長/`],
    councilor: [`${L2009}區域議員/`, `${L2010}區域議員/`],
    lowland: [`${L2009}平地議員/`, `${L2010}平地議員/`],
    highland: [`${L2009}山地議員/`, `${L2010}山地議員/`],
    townshipMayor: [`${L2009}鄉鎮市長/`],
    indigenousChief: [],
    townshipRep: [],
    lowlandRep: [],
    indigenousRep: [],
    villageChief: [],
  },
  mayorWarnings: [TWO_ROUNDS, SEQ_NOTE("2009 與 2010"), APOS_NOTE("2009 與 2010"), B2016_NOTE],
  councilorWarnings: [
    TWO_ROUNDS,
    "162 個選舉區共選出 843 席（2009 年 17 縣市 105 區 543 席；2010 年五都 57 區 300 席），每區 1 至 13 席。縣市與全國層級跨多個選區，以政黨合計呈現；選區層級顯示當選席次最多的政黨。",
    "新竹市東區、北區分屬不同選區，在鄉鎮層級依選區拆成數塊，界線由村里合併而成。",
    SEQ_NOTE("2009 與 2010"),
    APOS_NOTE("2009 與 2010"),
    B2016_NOTE,
  ],
  notes: [TWO_ROUNDS, SEQ_NOTE("2009 與 2010"), APOS_NOTE("2009 與 2010"), B2016_NOTE],
};

/**
 * 2010-06-12 (中選會新聞稿 99-06-12): 村里長 and 鄉鎮市民代表 of the 17 counties. 村里長 is shown
 * with the 五都's 里長 of 2010-11-27 as one map. The 2010-06-12 files use an older layout
 * (ElGroupDef.legacy): no village summaries, old party numbers.
 */
export const E2010V: ElectionDef = {
  id: "2010-06-12-local",
  date: "2010-06-12",
  nameZh: "2010年 村里長及鄉鎮市民代表選舉",
  kinds: ["local"],
};
const V2010_PARTIAL =
  "2010-06-12 的中選會檔案只有鄉鎮以上的投票概況；村里（村里長）與鄉鎮內各選區（代表）只有候選人得票，因此這些單位的選舉人數、投票數、無效票與投票率為無資料，有效票為候選人得票合計。";
const L10V: LocalDef = {
  election: E2010V,
  villages: true,
  mix: true,
  boundary: B2016,
  registryFrom: REGISTRY_2014,
  dirDates: [{ prefix: L2010, date: "2010-11-27" }],
  legacy: { prefixes: ["votedata/votedata/voteData/2010村里長/", "votedata/votedata/voteData/2010鄉鎮市民代表/"], modernPartiesFrom: [`${L2009}縣市長/`, `${L2009}區域議員/`, `${L2009}鄉鎮市長/`, "votedata/votedata/voteData/2008立委/不分區政黨/", ...REGISTRY_2014, "votedata/votedata/voteData/2014-103年地方公職人員選舉/縣市鄉鎮市民代表/"] },
  noVillages: ["township-rep-district"],
  dirs: {
    mayor: [],
    councilor: [],
    lowland: [],
    highland: [],
    townshipMayor: [],
    indigenousChief: [],
    townshipRep: ["votedata/votedata/voteData/2010鄉鎮市民代表/"],
    lowlandRep: [],
    indigenousRep: [],
    villageChief: ["votedata/votedata/voteData/2010村里長/", `${L2010}里長/`],
  },
  mayorWarnings: [],
  councilorWarnings: [],
  notes: [
    "17 個縣市的村里長與鄉鎮市民代表於 2010-06-12 投票；村里長地圖另合併新北市、臺北市、臺中市、臺南市、高雄市（五都）於 2010-11-27 選出的里長。側邊欄顯示各場選舉的投票日。",
    V2010_PARTIAL,
    SEQ_NOTE("2010"),
    "2010-06-12 的中選會檔案使用舊的政黨編號（例如民主進步黨為 2），已依政黨名稱換成現行代碼（無黨籍為 999）。",
    B2016_NOTE,
  ],
};

const L2005 = "votedata/votedata/voteData/";
const TWO_ROUNDS_0506 =
  "此地圖合併兩次投票：臺北市、高雄市以外的縣市於 2005-12-03 選出縣市長、縣市議員、鄉鎮市長；臺北市、高雄市於 2006-12-09 選出市長、市議員。側邊欄顯示各場選舉的投票日。";
const L05: LocalDef = {
  election: E2005,
  villages: true,
  mix: true,
  boundary: B2016,
  registryFrom: REGISTRY_2014,
  dirDates: [{ prefix: `${L2005}2006`, date: "2006-12-09" }],
  oldCountyContests: true,
  ignoreDist: true,
  noVillages: ["councilor-lowland-indigenous", "councilor-highland-indigenous"],
  dirs: {
    mayor: [`${L2005}2005縣市長/`, `${L2005}2006直轄市長/`],
    councilor: [`${L2005}2005縣市議員/區域/`, `${L2005}2006直轄市議員(區域)/`],
    lowland: [`${L2005}2005縣市議員/平原/`],
    highland: [`${L2005}2005縣市議員/山原/`],
    townshipMayor: [`${L2005}2005鄉鎮市長/`],
    indigenousChief: [],
    townshipRep: [],
    lowlandRep: [],
    indigenousRep: [],
    villageChief: [],
  },
  mayorWarnings: [TWO_ROUNDS_0506, ...OLD_NOTES("2005 與 2006")],
  councilorWarnings: [TWO_ROUNDS_0506, ...OLD_NOTES("2005 與 2006")],
  notes: [TWO_ROUNDS_0506, ...OLD_NOTES("2005 與 2006")],
};

/** 臺北市、高雄市 原住民議員 before 2010: one race per city, 平地 and 山地 voters together. */
const cityIndigenous = (election: ElectionDef, dir: string, notes: string[], villages: boolean): ElGroupDef => ({
  election,
  local: "councilor-indigenous",
  nameZh: "臺北市、高雄市原住民議員選舉",
  office: "councilor-indigenous",
  electorate: "general",
  archiveDirs: [dir],
  contests: "county",
  contestPrefix: "ti",
  contestNameSuffix: "原住民議員",
  choiceKind: "candidate",
  boundary: B2016,
  villages,
  mixSnapshots: villages,
  registryFrom: REGISTRY_2014,
  layout: "admin",
  ignoreDist: true,
  warnings: [
    ...COMMON_WARNINGS.slice(1),
    "臺北市、高雄市各為一個原住民議員選舉區，平地與山地原住民選舉人合併選舉；選舉人數與一般選舉不同。",
    ...notes,
  ],
});

/** 2005 任務型國民大會代表: a party ballot, 300 seats shared by vote share. */
const NA2005: ElGroupDef = {
  election: E2005N,
  local: "national-assembly-party-list",
  nameZh: "任務型國民大會代表選舉（政黨票）",
  office: "national-assembly-party-list",
  electorate: "general",
  archiveDirs: [`${L2005}2005任務型國代/`],
  contests: "single",
  choiceKind: "party",
  seats: 300,
  listMembersAbsent: true,
  partyListThreshold: { pct: 0, basis: "國民大會代表選舉法（2006 年廢止），依政黨得票率分配" },
  boundary: B2016,
  villages: true,
  mixSnapshots: true,
  registryFrom: REGISTRY_2014,
  layout: "admin",
  warnings: [
    ...COMMON_WARNINGS,
    "選票上為政黨（及聯盟），300 席依各政黨得票比例分配，不設得票率門檻（本站以最大餘數法重算，與中選會分配結果比對）。",
    "中選會檔案的當選名單（elrepm.csv）只有 1 人，所以本站只呈現各政黨的得票與席次，不列當選人。",
    "張亞中等150人聯盟、王廷興等20人聯盟在中選會的政黨代碼表中沒有代碼，本站自編代碼 9001、9002。",
    B2016_NOTE,
    SEQ_NOTE("2005"),
    MERGER_NOTE,
  ],
};

const L18: LocalDef = {
  election: E2018,
  villages: true,
  mix: true,
  boundary: B2018,
  dirs: {
    mayor: [`${L2018}直轄市市長/`, `${L2018}縣市市長/`],
    councilor: [`${L2018}直轄市區域議員/`, `${L2018}縣市區域議員/`],
    lowland: [`${L2018}直轄市平原議員/`, `${L2018}縣市平原議員/`],
    highland: [`${L2018}直轄市山原議員/`, `${L2018}縣市山原議員/`],
    townshipMayor: [`${L2018}縣市鄉鎮市長/`],
    indigenousChief: [`${L2018}直轄市區長/`],
    townshipRep: [`${L2018}縣市鄉鎮市民代表/`],
    lowlandRep: [`${L2018}縣市鄉鎮市民平原代表/`],
    indigenousRep: [`${L2018}直轄市區民代表/`],
    villageChief: [`${L2018}直轄市村里長/`, `${L2018}縣市村里長/`],
  },
  mayorWarnings: ["2018 年的中選會檔案以撇號標示代碼欄位（例如 '63），讀取時移除。", B2018_NOTE],
  councilorWarnings: [
    "159 個選舉區共選出 843 席，每區 1 至 13 席。縣市與全國層級跨多個選區，以政黨合計呈現；選區層級顯示當選席次最多的政黨。",
    "新竹市東區、北區分屬不同選區，在鄉鎮層級依選區拆成數塊，界線由村里合併而成。",
    "2018 年的中選會檔案以撇號標示代碼欄位（例如 '63），讀取時移除。",
    B2018_NOTE,
  ],
};

function localElections(l: LocalDef): ElGroupDef[] {
  const y = l.election.date.slice(0, 4);
  const extra = { ...(l.registryFrom ? { registryFrom: l.registryFrom } : {}), ...(l.dirDates ? { dirDates: l.dirDates } : {}), ...(l.oldCountyContests ? { oldCountyContests: true } : {}), ...(l.ignoreDist ? { ignoreDist: true } : {}) };
  const base = { election: l.election, boundary: l.boundary, villages: l.villages ?? false, mixSnapshots: l.mix ?? false, contests: "district" as const, choiceKind: "candidate" as const, ...extra };
  const indigenous = (kind: "平地" | "山地"): ElGroupDef => {
    const code = kind === "平地" ? "T2" : "T3";
    return {
      ...base,
      local: kind === "平地" ? "councilor-lowland-indigenous" : "councilor-highland-indigenous",
      nameZh: `直轄市議員及縣市議員選舉（${kind}原住民）`,
      office: kind === "平地" ? "councilor-lowland-indigenous" : "councilor-highland-indigenous",
      electorate: kind === "平地" ? "lowland-indigenous" : "highland-indigenous",
      cecTypeCode: code,
      archiveDirs: kind === "平地" ? l.dirs.lowland : l.dirs.highland,
      contestPrefix: code.toLowerCase(),
      layout: `${code.toLowerCase()}-${y}`,
      warnings: [
        ...COMMON_WARNINGS,
        `僅${kind}原住民選舉人可投票，選舉人數與一般選舉不同；許多地區的選舉人很少，少數票數即可造成極端的得票率。`,
        `只有設${kind}原住民議員選區的縣市才有資料，其他地區顯示為無資料。`,
        ...(l.boundary === B2018 ? [B2018_NOTE] : []),
        ...(l.noVillages?.includes(kind === "平地" ? "councilor-lowland-indigenous" : "councilor-highland-indigenous") ? ["此次的中選會檔案只到鄉鎮市區層級，沒有村里層級。"] : []),
        ...(l.notes ?? []),
      ],
    };
  };
  const all: ElGroupDef[] = [
    {
      ...base,
      local: "mayor",
      nameZh: "直轄市長及縣市長選舉",
      office: "mayor-or-magistrate",
      electorate: "general",
      cecTypeCode: "C1",
      archiveDirs: l.dirs.mayor,
      ...(l.extra ? { extra: l.extra } : {}),
      contests: "county",
      contestPrefix: "c1",
      contestNameSuffix: "長",
      layout: "admin",
      warnings: [...COMMON_WARNINGS, "22 個縣市各選出 1 位首長。全國層級跨多個縣市，以各政黨當選席次與得票合計呈現。", ...l.mayorWarnings],
    },
    {
      ...base,
      local: "councilor-district",
      nameZh: "直轄市議員及縣市議員選舉（區域）",
      office: "councilor-district",
      electorate: "general",
      cecTypeCode: "T1",
      archiveDirs: l.dirs.councilor,
      contestPrefix: "t1",
      layout: `t1-${y}`,
      warnings: [...COMMON_WARNINGS, ...l.councilorWarnings, "原住民議員（平地、山地）不在此地圖，另以獨立檢視呈現。"],
    },
    indigenous("平地"),
    indigenous("山地"),
    ...townshipAndVillage(l),
  ];
  return all.map((g) => (l.noVillages?.includes(g.office) ? { ...g, villages: false, mixSnapshots: false } : g));
}

/** 鄉鎮市長, 山地原住民區長, the three kinds of 代表 and 村里長: races inside townships and villages. */
function townshipAndVillage(l: LocalDef): ElGroupDef[] {
  const base = {
    election: l.election,
    boundary: l.boundary,
    villages: l.villages ?? false,
    mixSnapshots: l.mix ?? false,
    ...(l.registryFrom ? { registryFrom: l.registryFrom } : {}),
    ...(l.dirDates ? { dirDates: l.dirDates } : {}),
    ...(l.legacy ? { legacy: l.legacy } : {}),
    ...(l.ignoreDist ? { ignoreDist: true } : {}),
    choiceKind: "candidate" as const,
    electorate: "general" as const,
    layout: "admin",
  };
  const common = [...COMMON_WARNINGS, ...(l.boundary === B2018 ? ["2018 年的中選會檔案以撇號標示代碼欄位（例如 '63），讀取時移除。", B2018_NOTE] : []), ...(l.notes ?? [])];
  const reps = "每個鄉鎮市區分為一至數個選舉區，各選出一至多席。地圖不畫選舉區界線：鄉鎮層級顯示當選席次最多的政黨，村里層級顯示該村里所屬選舉區的結果。";
  const all: ElGroupDef[] = [
    {
      ...base,
      local: "township-mayor",
      nameZh: "鄉（鎮、市）長選舉",
      office: "township-mayor",
      cecTypeCode: "D1",
      archiveDirs: l.dirs.townshipMayor,
      contests: "town",
      contestPrefix: "d1",
      contestNameSuffix: "長",
      warnings: [...common, "鄉、鎮、縣轄市各選出 1 位首長；直轄市與市的「區」，區長為官派，沒有選舉（直轄市山地原住民區另有區長選舉），地圖上以無資料顯示。縣市與全國層級以政黨合計呈現。"],
    },
    {
      ...base,
      local: "indigenous-district-chief",
      nameZh: "直轄市山地原住民區長選舉",
      office: "indigenous-district-chief",
      cecTypeCode: "D2",
      archiveDirs: l.dirs.indigenousChief,
      contests: "town",
      contestPrefix: "d2",
      contestNameSuffix: "長",
      warnings: [...common, "只有直轄市的山地原住民區選舉區長，其他地區以無資料顯示。"],
    },
    {
      ...base,
      local: "township-rep-district",
      nameZh: "鄉（鎮、市）民代表選舉（區域）",
      office: "township-rep-district",
      cecTypeCode: "R1",
      archiveDirs: l.dirs.townshipRep,
      contests: "town-district",
      contestPrefix: "r1",
      warnings: [...common, reps, "直轄市與市的「區」沒有民意代表會（直轄市山地原住民區另有區民代表），地圖上以無資料顯示。"],
    },
    {
      ...base,
      local: "township-rep-lowland-indigenous",
      nameZh: "鄉（鎮、市）民代表選舉（平地原住民）",
      office: "township-rep-lowland-indigenous",
      electorate: "lowland-indigenous",
      cecTypeCode: "R2",
      archiveDirs: l.dirs.lowlandRep,
      contests: "town-district",
      contestPrefix: "r2",
      warnings: [...common, reps, "僅平地原住民選舉人可投票，選舉人數與一般選舉不同；只有設平地原住民代表選區的鄉鎮市才有資料。"],
    },
    {
      ...base,
      local: "indigenous-district-rep",
      nameZh: "直轄市山地原住民區民代表選舉",
      office: "indigenous-district-rep",
      cecTypeCode: "R3",
      archiveDirs: l.dirs.indigenousRep,
      contests: "town-district",
      contestPrefix: "r3",
      warnings: [...common, reps, "只有直轄市的山地原住民區設區民代表會，其他地區以無資料顯示。"],
    },
    {
      ...base,
      local: "village-chief",
      nameZh: "村（里）長選舉",
      office: "village-chief",
      cecTypeCode: "V1",
      archiveDirs: l.dirs.villageChief,
      contests: "village",
      contestPrefix: "v1",
      contestNameSuffix: "長",
      warnings: [...common, "每個村里各自選出 1 位村里長；鄉鎮以上層級跨多個村里，以政黨合計呈現。"],
    },
  ];
  return all
    .filter((g) => g.archiveDirs.length > 0) // not every election had every office
    .map((g) => (l.noVillages?.includes(g.office) ? { ...g, villages: false, mixSnapshots: false } : g));
}

/** Every village snapshot a mixed-snapshot group may borrow townships from. */
export const ALL_SNAPSHOTS: BoundaryDef[] = [B2018, B2020, B2020_1091030, B2021, B2022, B2024];

export const GROUPS: ElGroupDef[] = [
  ...presidentLegislative(P2024),
  ...presidentLegislative(P2020),
  ...presidentLegislative(P2016),
  ...presidentLegislative(P2012),
  ...presidentLegislative(P2008P),
  ...presidentLegislative(P2008L),
  NA2005,
  ...localElections(L05),
  cityIndigenous(E2005, `${L2005}2006直轄市議員(原住民)/`, [...OLD_NOTES("2006"), "此檔案只到鄉鎮市區層級。"], false),
  ...presidentLegislative(P2004L),
  // ...presidentLegislative(P2004P), — 2004 總統: the CEC files disagree with each other (see docs); not yet built
  ...localElections(L22),
  ...localElections(L18),
  ...localElections(L14),
  ...localElections(L09),
  ...townshipAndVillage(L10V), // 2010-06-12: only 村里長 (with the 五都's 里長) and 代表
  CONSTITUTIONAL_2022,
  ...[17, 18, 19, 20].map(nationalReferendum(E2021R, B2021, undefined, true)),
  ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(nationalReferendum(E2018R, B2018, L18.dirs.mayor, true)),
];
