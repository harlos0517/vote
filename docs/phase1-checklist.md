# Phase 1 — 人工確認清單

狀態更新：2026-11-23。**Phase 1 驗收完成**：<https://vote.harlos.tw> 已上線，資料版本 `r-9299d522ddd8`，驗證結果為 `passed`。

## 已完成

| # | 項目 | 結果 |
|---|---|---|
| A1 | 官方公告總數 | 已對照中選會 2024-01-19 中選務字第 1133150026 號公告，數字一致。對照表標記為 `reviewed`。 |
| A2 | 瑪家鄉三和村呈現方式 | 接受：不繪出，在瑪家鄉加註說明。 |
| A3 | 抽樣比對官方數字 | 一致。 |
| B | 畫面目視檢查 | 已確認。 |
| C2 | 公開原始檔鏡像 | 已上線：`https://vote-data.harlos.tw/raw/`，附 `index.json` 與 `NOTICE.md`。 |
| C3 | LICENSE 著作權人 | `Harlos`。 |
| D1 | GitHub repo、Pages、自訂網域 | `harlos0517/vote` → `vote.harlos.tw`，網站在根路徑。 |
| D2–D3 | R2、自訂網域、CORS、API token、GitHub Environment | 已設定。 |
| D4 | 第一次發布 | 成功。國土測繪中心網站在海外無法連線，所以 CI 改從公開鏡像下載；鏡像從本機上傳。 |
| D5 | CDN 檢查 | 全部通過：<br>• `manifest.json` 快取 60 秒<br>• release 檔案快取一年、immutable，`cf-cache-status: HIT`<br>• `.json` 與 `.geojson` 都有 brotli 壓縮<br>• CORS 只允許 `vote.harlos.tw` |
| D6 | 驗收 | 地圖載入、切換候選人與層級、點選地區皆正常。 |

上線後修正的問題：

- 網站 base path 原本是 `/vote/`，造成空白頁，已改為根路徑。
- MapLibre worker 無法載入，已修正。
- 圖例在得票率範圍很大時，分級標籤會不準確，已修正（需 push 才會部署）。

## 待辦

| # | 項目 | 說明 |
|---|---|---|
| C1 | 政黨色 | 決定改用，日後處理。需要一份附來源、經審核的色票表 `packages/etl/mappings/party-colors.csv`；未列入的政黨使用中性色。 |

## 已知限制（Phase 2 以後處理）

- 前端 JS 約 474 KB（gzip），大部分是 MapLibre，可以再做程式碼分割。
- 東沙與南沙在預設視野之外。
- 2024 年有 2 個村里名稱含私用區字元，Phase 2 需要先建立 PUA 對照表。
- `votedata.zip` 以 sha256 固定版本。中選會更新檔案時，建置會刻意失敗；審核新檔並重新固定後，要從本機重新執行 `mirror-raw`。
- `docs/CNAME` 是透過 GitHub 網頁建立的。網站用 Actions 部署，自訂網域是在 Pages 設定中指定，所以這個檔案目前用不到，但留著也沒有影響。
