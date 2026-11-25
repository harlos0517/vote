# 2026-11-28 開票夜工作清單

依時間順序。所有指令在 repo 根目錄執行。背景說明見 `docs/live-feed.md`。

- feed：`cec-2026-11-28-local`
- 選舉群組：`2026-11-28-local.mayor`（直轄市長及縣市長，22 個縣市、81 位候選人）
- 本機資料夾：`data/out/live/cec-2026-11-28-local/`
- 公開網址：`https://vote-data.harlos.tw/live/cec-2026-11-28-local/`
- 網頁：`https://vote.harlos.tw/#/?live=cec-2026-11-28-local`

**不要刪除或重建本機的 feed 資料夾**（包括 `.published.json`），也不要用這個 feed id 做任何演練。`0000.json` 已上傳；內容不同的同編號快照會被拒絕上傳。

## 一、11/27 以前

- [ ] 推送 `main`，確認 **Deploy site** 成功（即時開票畫面目前只在本機 commit）。
- [ ] GitHub repo → Settings → Secrets and variables → Actions → **Variables** 新增 `LIVE_FEED` = `cec-2026-11-28-local`，重新部署網站，確認標題列出現「即時開票」按鈕。
- [ ] 用真的瀏覽器打開網頁，確認顯示「尚未開票」、各縣市候選人與號次、0 票，沒有任何預測或比例數字。
- [ ] 審核 `packages/etl/mappings/candidates-2026-mayor.csv`：逐筆對照每列 `source` 的公告，特別是 `method` 為 `scan` 的 36 筆；確認後把 `status` 改為 `reviewed`。
  - 有修正時重新產生並上傳群組檔（不會動到 `0000.json` 與 `latest.json`）：

    ```bash
    pnpm etl live-prelim --candidates packages/etl/mappings/candidates-2026-mayor.csv --from-group 2022-11-26-local.mayor
    ```

    ```bash
    pnpm etl live-publish --feed cec-2026-11-28-local
    ```

- [ ] 決定三個沒有政黨代碼的推薦政黨（臺灣SoR無法黨、三勢團結促進聯盟、台聯黨）是否維持未分類。
- [ ] （建議）在正式網站演練一次：上傳重播 feed，邊播放邊上傳，打開 `https://vote.harlos.tw/#/?live=replay-2022-11-26-local` 看地圖是否隨開票進度上色。兩個指令分別開兩個終端機：

  ```bash
  pnpm etl live-play --feed replay-2022-11-26-local --speed 12
  ```

  ```bash
  pnpm etl live-publish --feed replay-2022-11-26-local --watch 15
  ```

  結束後在 `data/out/live/replay-2022-11-26-local/` 建立 `STOP` 檔案停止上傳。重播頁面會標示「模擬」。

## 二、投票日 16:00 以前

- [ ] 執行輪詢的電腦：接上電源、關閉睡眠、網路穩定、使用臺灣的網路連線。
- [ ] `git pull`、`pnpm install`；確認 feed 資料夾還在：

  ```bash
  ls data/out/live/cec-2026-11-28-local/
  ```

  應看到 `groups`、`manifest.json`、`.published.json`，**不應有 `STOP`**。
- [ ] 開一個長時間使用的終端機（建議 tmux），依 `docs/deployment.md` 3.5 節的 `read` 指令輸入 R2 金鑰。
- [ ] **16:00 前不要啟動輪詢**，網頁維持「尚未開票」。

## 三、16:00 之後：確認中選會網站

用瀏覽器開 `https://vote.cec.gov.tw/zh-TW/indexP.html`，開發者工具 → Network。

- [ ] 網站已開放（不是 403），首頁仍是同一套程式：會載入 `assets/def/tree-compiled.min.json`。
- [ ] 點進「直轄市長」與「縣市長」的全國或某縣市頁面，記下 Network 裡結果頁的路徑，確認：
  - 開頭是 `zh-TW/`，與 `--base https://vote.cec.gov.tw/zh-TW/` 相符；
  - 類別代碼：直轄市長是否為 `C1`、縣市長是否為 `C2`（例如臺北市 `zh-TW/C1/63000000000000000.html`、宜蘭縣 `zh-TW/C2/10002000000000000.html`）；
  - 頁面有「號次」「候選人姓名」「得票數」與「已送投票所數/總投票所數」「資料時間」。
- [ ] 代碼不同時：改 CSV 的 `cec_type`，重跑上面的 `live-prelim` 與 `live-publish`。
- [ ] 路徑或欄位與上面差很多時：**不要啟動輪詢**，改走「五、出狀況時」。

## 四、開始輪詢

- [ ] 先只跑一輪、只抓縣市層級，**不上傳**：

  ```bash
  pnpm etl live-cec --groups 2026-11-28-local.mayor --base https://vote.cec.gov.tw/zh-TW/ --levels national,county --once
  ```

  確認輸出為 `22 pages ok, 0 failed`，沒有 `warn` 姓名不符；資料時間合理。
- [ ] 正式開始（縣市層級，每 120 秒，每輪上傳）：

  ```bash
  pnpm etl live-cec --groups 2026-11-28-local.mayor --base https://vote.cec.gov.tw/zh-TW/ --levels national,county --publish
  ```

- [ ] 打開網頁確認：狀態「開票中」、回報進度與資料時間更新、資料來源標示「中央選舉委員會」。
- [ ] （選擇性）穩定約 30 分鐘後加入鄉鎮層級：建立 `STOP` 讓輪詢結束，刪除 `STOP`，加上 `town` 重新啟動（會接續原本的 seq）。每輪由 22 頁增為 390 頁。

  ```bash
  touch data/out/live/cec-2026-11-28-local/STOP
  ```

  ```bash
  rm data/out/live/cec-2026-11-28-local/STOP
  ```

  ```bash
  pnpm etl live-cec --groups 2026-11-28-local.mayor --base https://vote.cec.gov.tw/zh-TW/ --levels national,county,town --publish
  ```

## 五、開票中監看

- [ ] 每隔一段時間看終端機：`pages ok` 與 `failed` 數字、`warn` 訊息、`after-cycle step failed`（上傳失敗，下一輪會重試）。
- [ ] 公開資料是否有更新（`seq` 會增加）：

  ```bash
  curl -s https://vote-data.harlos.tw/live/cec-2026-11-28-local/manifest.json | grep -E '"(seq|status)"'
  ```

- [ ] 網頁若出現「數字已超過…沒有更新」提醒，檢查輪詢與上傳是否還在執行。

## 六、出狀況時

| 狀況 | 處理 |
|---|---|
| 輪詢因 **403／429** 停止 | 不要重試、不要換標頭或 IP。網頁停在最後一輪數字並顯示未更新提醒。人工輸入工具尚未完成。 |
| 輪詢因頁面格式不符（`PageFormatError`）停止 | 中選會網站改版。不要猜測格式；保留最後數字，記下新格式之後再處理。 |
| `most names differ` | 頁面代碼或候選人名單對錯。停止輪詢，確認第三節的代碼。 |
| 大量 `failed`（逾時、5xx） | 程式會自動拉長間隔（最長 10 分鐘），沿用上一輪數字並標示。持續發生時暫停輪詢。 |
| 上傳一直失敗 | 確認終端機的金鑰仍在（`echo $R2_BUCKET`）。輪詢不受影響，恢復後下一輪會補上。 |
| 需要停止 | 建立 `STOP` 檔案，跑完當輪結束。**重新啟動前要先刪除 `STOP`**，否則會立刻結束。 |
| 停止後要補傳 | `pnpm etl live-publish --feed cec-2026-11-28-local` |

## 七、開票結束後

- [ ] 所有縣市都 `final` 時輪詢會自動結束；確認最後一輪已上傳（`manifest.json` 的 `status` 為 `final`）。
- [ ] 網頁維持「開票完成」，仍註明非最終結果、以中選會公告為準；**不標示當選**（當選人以 12/4 中選會公告為準）。
- [ ] 關閉終端機，清除金鑰。
- [ ] 之後：中選會公布選舉資料庫的正式結果後，以一般 ETL 建立 2026 年版本，再移除 `LIVE_FEED` 變數。

## 這次不涵蓋

- 議員、鄉鎮市長、村里長等其他選舉（沒有候選人資料）。
- 全國性公民投票案第 22 案（沒有建立公投群組；頁面格式未知）。
- 人工輸入（`manual` 模式未完成）。
