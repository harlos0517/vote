/**
 * Pinned raw inputs. A fetch whose sha256 differs from `sha256` fails: the CEC
 * overwrites votedata.zip in place, so a new hash means a new upstream version
 * that must be reviewed and re-pinned deliberately (see sources/catalog.json).
 */
export interface RawSource {
  id: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  retrievedAt: string; // first retrieval of this pinned version (ISO datetime)
}

export const RAW_SOURCES = {
  cecVotedata: {
    id: "cec-votedata",
    file: "votedata.zip",
    url: "https://data.cec.gov.tw/%E9%81%B8%E8%88%89%E8%B3%87%E6%96%99%E5%BA%AB/votedata.zip",
    sha256: "84740535b1f4a9a8fec8ebfe8f7577889837b7639cd7f5e40ef8826c6ab2f69a",
    bytes: 110316470,
    retrievedAt: "2026-11-23T00:00:00Z",
  },
  nlscVillage110: {
    id: "nlsc-village-history",
    file: "v110.bin",
    url: "https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=SNTL3W&gdid=529",
    sha256: "016014f1e5cad4ef019ab3fc644dade5d092c4cd833598f990b0f880eb5edf04",
    bytes: 22507419,
    retrievedAt: "2026-11-23T00:00:00Z",
  },
  nlscVillage111: {
    id: "nlsc-village-history",
    file: "v111.bin",
    url: "https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=TWMT3E&gdid=530",
    sha256: "eb681318cf3905f2814929ee21f03ae97d08ec831239593dc3b73541e2a5dad5",
    bytes: 23043468,
    retrievedAt: "2026-11-23T00:00:00Z",
  },
  nlscVillage112: {
    id: "nlsc-village-history",
    file: "v112.bin",
    url: "https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=Z2371J&gdid=531",
    sha256: "b4e265fe6e7ae868915c1a1f0a231296104a29c688fdbb8c9c4af9c33d37bbb0",
    bytes: 22164184,
    retrievedAt: "2026-11-23T00:00:00Z",
  },
} as const satisfies Record<string, RawSource>;

export const DATA_SOURCES = {
  cec: {
    id: "cec-votedata",
    publisher: "中央選舉委員會",
    title: "選舉資料庫（votedata.zip）",
    url: "https://data.gov.tw/dataset/13119",
    license: "政府資料開放授權條款-第1版",
    attribution: "資料來源：中央選舉委員會選舉資料庫",
  },
  nlscVillageHistory: {
    id: "nlsc-village-history",
    publisher: "內政部國土測繪中心",
    title: "村里界歷史圖資(TWD97經緯度)",
    url: "https://data.gov.tw/dataset/130549",
    license: "政府資料開放授權條款-第1版",
    attribution: "圖資來源：內政部國土測繪中心",
  },
} as const;
