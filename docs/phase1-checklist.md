# Phase 1 — 待人工確認／驗證清單

自動化已完成的部分：

- ETL 的 11 項檢核全部通過，只有「官方公告比對」為 warn，因為對照表尚未人工審核。
- 單元測試 15 項通過，型別檢查通過。
- 從乾淨 clone 重新下載並建置，產生相同的 release id `r-f6d69f002ab0`。
- preview 伺服器的 HTTP 測試通過。

以下項目**無法由程式自動確認**，需要人工處理。

## A. 資料正確性（發布前）

1. **官方公告總數**：`packages/etl/mappings/official-announcements.csv` 的三組得票數與副手姓名，是由 AI 依記憶輸入的。ETL 已確認這些數字與 CEC 原始檔一致，但仍需對照中選會公告原文：
   - 填入公告日期與文號。
   - 將 `status` 改為 `reviewed`。
   - 完成後，release 驗證狀態才會從 `passed-with-warnings` 變為 `passed`。
2. **瑪家鄉三和村**：爭議圖層與內埔鄉、鹽埔鄉、長治鄉的村里重疊約 5.4 km²，所以目前不繪出，只在瑪家鄉加註說明。需要確認這個呈現方式是否可接受。
3. **抽樣比對**：從網站抽幾個縣市與鄉鎮，與中選會選舉資料庫網頁上的數字比對（Phase 1 驗收條件：「顯示結果與官方資料一致」）。

## B. 畫面（瀏覽器無法自動操作，未目視確認）

在本機開啟 `pnpm --filter @tw-election/web dev` 或 `preview`，逐項確認：

1. 地圖著色正確；縣市與鄉鎮市區可以切換。
2. hover 時顯示 tooltip；點選區域後，右側面板顯示該區詳細資料，「回到全國」可正常使用。
3. 「候選人得票率」與「得票最多者」兩種模式、候選人切換、圖例都正確。
4. 網址 hash 可以分享，重新整理後狀態保留。
5. 行動裝置版面（寬度 ≤ 48em）上下堆疊，沒有水平捲動。
6. 深色模式。
7. 錯誤畫面：把 `VITE_DATA_BASE_URL` 指到錯誤網址時，會顯示錯誤訊息與「重新嘗試」按鈕。

## C. 政策決定

1. **配色**：目前不使用政黨色。「得票最多者」模式的顏色依號次指定，並刻意避開藍、綠色系。是否改用政黨色？若要改，需要一份有出處、經審核的色票表。
2. **公開原始檔鏡像**：授權已確認為政府資料開放授權條款第 1 版（data.gov.tw 13119）。是否開放公開鏡像？目前的實作只鏡像到私有 bucket。
3. **LICENSE 著作權人**：目前依 git 設定填為 `Harlos`。

## D. 基礎設施（需要帳號權限，無法代為操作）

1. 建立 GitHub repository 並推送；Pages 的來源設為 GitHub Actions。
2. R2 設定（步驟見 README）：
   - 建立公開與私有 bucket，綁定自訂網域。
   - 設定 CORS。
   - 建立只能存取這兩個 bucket 的 API token。
3. GitHub 設定：
   - Environment `data-release`：加入 required reviewers 與 R2 secrets。
   - Repository variable `DATA_BASE_URL`。
4. 第一次執行 workflow 時確認：
   - `actions/checkout@v5`、`setup-node@v5`、`upload-pages-artifact@v4`、`deploy-pages@v4`、`pnpm/action-setup@v4` 等版本都可用。
   - `pnpm install --frozen-lockfile` 在 CI 上成功。
5. 發布後確認 CDN 回應：
   - `.geojson`（`application/geo+json`）是否有 gzip／brotli 壓縮；若沒有，改用 `application/json`。
   - Cache-Control 標頭是否正確。
   - CORS 是否正確。
6. 驗收：公開網址可以載入、切換候選人、點選地區。

## E. 已知限制（Phase 2 以後處理）

- 前端 JS 約 474 KB（gzip），大部分是 MapLibre，可以再做程式碼分割。
- 東沙與南沙在預設視野之外。
- 2024 年有 2 個村里名稱含私用區字元。目前只發布到鄉鎮層級，不受影響；Phase 2 需要先建立 PUA 對照表。
- `votedata.zip` 以 sha256 固定版本。中選會更新檔案時，建置會刻意失敗，需人工審核新版後重新固定。
