# Phase 1 — 人工確認清單

狀態更新：2026-11-23。

## 已完成

| # | 項目 | 結果 |
|---|---|---|
| A1 | 官方公告總數 | 已對照中選會 2024-01-19 中選務字第 1133150026 號公告，數字一致。對照表標記為 `reviewed`，release 驗證狀態為 `passed`。 |
| A2 | 瑪家鄉三和村呈現方式 | 接受：不繪出，在瑪家鄉加註說明。 |
| A3 | 抽樣比對官方數字 | 一致。 |
| B | 畫面目視檢查 | 已確認。 |
| C2 | 公開原始檔鏡像 | 公開放在資料 bucket 的 `raw/`，附 `raw/index.json` 與 `raw/NOTICE.md`，依政府資料開放授權條款第 1 版標示提供機關與授權。 |
| C3 | LICENSE 著作權人 | `Harlos`。 |
| D1 | GitHub repo、Pages、自訂網域 | `harlos0517/vote` → `vote.harlos.tw`。網站原本以 `/vote/` 為 base 建置，在自訂網域下會變成空白頁；已修正為根路徑。 |

## 待辦

| # | 項目 | 說明 |
|---|---|---|
| D2–D6 | R2、GitHub secrets、第一次發布、CDN 檢查、驗收 | 依 [deployment.md](deployment.md) 操作。 |
| C1 | 政黨色 | 決定改用政黨色，日後處理。需要一份附來源（例如各政黨官方識別規範）、經審核的色票表 `packages/etl/mappings/party-colors.csv`；未列入的政黨退回中性色。 |

## 已知限制（Phase 2 以後處理）

- 前端 JS 約 474 KB（gzip），大部分是 MapLibre，可以再做程式碼分割。
- 東沙與南沙在預設視野之外。
- 2024 年有 2 個村里名稱含私用區字元，Phase 2 需要先建立 PUA 對照表。
- `votedata.zip` 以 sha256 固定版本。中選會更新檔案時，建置會刻意失敗，需人工審核後重新固定。
