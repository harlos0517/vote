# 即時開票資料格式與模擬重播

即時開票的資料與歷史版本（`v2/releases/...`，發布後不可變動）分開存放在 `live/`，因為開票夜這些檔案會一直更新。網頁只讀 R2 上的檔案，不直接連中選會。

## 檔案配置

```
live/<feedId>/manifest.json                              可變動，短快取
live/<feedId>/groups/<groupId>/latest.json               可變動，短快取
live/<feedId>/groups/<groupId>/snapshots/<seq>.json      寫入後不再變動
```

格式定義在 `packages/schema/src/live.ts`（`LiveManifestFile`、`LiveSnapshotFile`）。

- **manifest**：記錄資料模式（`mode`）、頁面上要顯示的說明（`labelZh`）、資料來源（`source`）、建議的輪詢間隔（`pollIntervalSeconds`），以及每個選舉群組目前的 `seq` 與狀態。
- **snapshot**：只放票數。候選人、統計單位、政黨與界線沿用 manifest 指向的 v2 版本 `metadata.json`，地圖程式可以共用。
- 每列有 `reported`／`total`（已回報／應回報單位數），單位由 `progressUnit` 說明：中選會以投開票所（`station`）計，模擬重播只能以村里（`village`）計。
- `summary` 只加總已回報的部分，開票中途算出的投票率不是最終投票率。
- `status`：`not-started`（開票前）→ `counting` → `final`。讀取端應忽略 `seq` 比目前顯示的還舊的檔案。

### 資料模式

| `mode` | 說明 |
|---|---|
| `replay` | 以已完成選舉的公布結果模擬開票過程，用於開票前演練。頁面必須標示為模擬／歷史資料。 |
| `cec-public` | 讀取中選會公開的開票網站（`tw-etl live-cec`，見下方）。依 2024 年網站結構撰寫，2026 年網站開放後要先確認。 |
| `manual` | 人工輸入（例如依中選會直播畫面）。尚未實作。 |

### 中選會公開開票網站的結構（2024、2025 Wayback 存檔）

依 Internet Archive 保存的 `vote2024.cec.gov.tw`（2024-01-13 總統立委）與 `vote.cec.gov.tw`（2025-08-23 公投）頁面整理，2026 年是否相同要等開放後確認。

- 首頁 `zh-TW/indexP.html` 載入 `app_pc.min.js`，以 `VoteApp.run('zh-TW', 'count', …/def/tree-compiled.min.json)` 啟動；頁面狀態分 PRIOR／COUNT／FINAL。頁尾註明「開票結果以中央選舉委員會公告為準」，並標示由中華電信建置。
- `tree-compiled.min.json` 定義選舉類別與行政區樹，以及每個節點對應的結果檔路徑。
- 結果是靜態 HTML 片段：`zh-TW/<類別>/<縣市5碼><2碼><3碼><3碼><投票所4碼>.html`，例如全國總統 `zh-TW/P1/00000000000000000.html`；也有投開票所層級的片段。
- 片段內含「已送投票所數/總投票所數」、各候選人得票數與得票率、當選註記，以及「資料時間」。
- 開票中（COUNT）瀏覽器每 60 秒重新讀取目前開啟的片段（不使用快取，逾時 5 秒）。
- 開票後網站另提供 `all.zip`（2024 為 `_assets/all.zip`，2025 為 `assets/all.zip`），內含各縣市投開票所得票數一覽表（xlsx）；2024 年檔案時間為投票日 21:59。
- 2025 年資產路徑由 `_assets/` 改為 `assets/`，主機改為 `vote.cec.gov.tw`。2026-11-25 該主機回應 403，推測投票日才開放。

## 讀取中選會開票網站（cec-public）

```bash
pnpm etl live-cec --groups <groupId,groupId> --base https://vote.cec.gov.tw/zh-TW/
```

- 程式在 `packages/etl/src/live/cec-public.ts`，輸出到 `data/out/live/cec-<electionId>/`，格式與模擬重播相同（`mode: "cec-public"`）。
- `--groups` 要指向本機版本中已有的選舉群組（需要候選人、統計單位與界線）。**2026 年的群組 metadata 尚未建立**，在那之前只能用歷史選舉演練。
- 路徑：`<base>/<類別代碼>/<縣市5碼><選區2碼><鄉鎮3碼><村里3碼><投票所4碼>.html`。類別代碼取 contest 的 `cecTypeCode`（C1、T1…）；2024 年全國性選舉沒有代碼，依職位對應 P1、L1–L4。
- 只抓只屬於一個 contest 的單位（縣市長的縣市、鄉鎮；議員的選區與選區內鄉鎮）。跨多個 contest 的單位（縣市長的全國、議員的縣市）由下層加總。
- 候選人以號次對應，姓名只做核對：少數不符（例如罕用字）記為警告，多數不符就中止，避免讀到錯的頁面。
- 頁面沒有選舉人數、投票數等概況，`summary` 全為 null；`asOf` 取頁面的「資料時間」。
- 參數：`--levels`（預設為群組所有層級，不含村里與投開票所）、`--interval`（**秒**，預設 120）、`--concurrency`（同時請求數，預設 3）、`--once`（只跑一輪）。`--base file:///路徑/` 可改讀本機存下的頁面。

安全機制：

- 遇到 **403／429 立即停止**，不重試、不更換標頭；改用人工輸入。
- 頁面格式不符（欄位、已送投票所數、數字格式）立即停止，不猜測。
- 其他失敗（逾時、5xx、404）沿用上一輪數字並標示 `stale: true`；一輪中過半失敗時，間隔加倍，最長 10 分鐘。
- 在輸出資料夾建立 `STOP` 檔案，跑完當輪就結束。全部群組都 `final` 時自動結束。
- 每個頁面附上 `?_=<毫秒>`，與中選會網頁本身每 60 秒重新整理時的作法相同。User-Agent 標示本專案名稱與網址。

請求量：縣市長只抓縣市層級是每輪 22 頁；加上鄉鎮是 390 頁，以 120 秒、同時 3 個請求計約每秒 3 頁。開票夜先只抓縣市層級，確認網站穩定再加鄉鎮。

測試資料：`packages/etl/test/fixtures/cec-live-2024/` 是 Internet Archive 保存的 2024 年頁面（全國總統、一個投開票所的不分區政黨票），只有開票完成後的版本。

### 投票日 16:00 後要確認

1. `vote.cec.gov.tw` 是否開放、首頁是否仍為同一套程式（`VoteApp.run`、`assets/def/tree-compiled.min.json`）。
2. 縣市長與議員的類別代碼（是否為 C1、T1），以及頁面路徑是否符合上面的規則。
3. 頁面欄位是否仍有「號次」「候選人姓名」「得票數」與「已送投票所數/總投票所數」。
4. 先用 `--once` 跑一輪，檢查輸出再開始持續輪詢。

## 模擬重播

```bash
pnpm etl live-replay --groups 2022-11-26-local.mayor,2022-11-26-local.councilor-district
```

```bash
pnpm etl live-play --feed replay-2022-11-26-local --speed 60
```

- `live-replay` 讀取本機目前版本（或 `--release`）的結果，寫出全部快照到 `data/out/live/replay-<electionId>/`，`latest.json` 停在開票前（seq 0）。
- `live-play` 依快照的 `asOf` 時間逐步更新 `latest.json` 與 manifest，模擬開票夜輪詢程式的寫入。`--speed 60` 代表模擬的 3 分鐘以 3 秒播放。
- 參數：`--start`（預設投票日 16:00 +08:00）、`--interval`（快照間隔分鐘，預設 3）、`--seed`（預設 1）、`--poll`（建議輪詢秒數，預設 60）。
- 同一個 feed 只能放同一場選舉的群組；2022 修憲複決在資料中是另一場選舉，要另外產生（`--groups 2022-11-26-constitutional-referendum.case-1`）。

### 模擬方式與限制

- 以村里為回報單位，每個村里在一個模擬時間點一次回報全部票數。時間由 seed 決定：規模較大的村里傾向較晚回報，各縣市整體略早或略晚，其餘為隨機。全部約在 16:00 後 3 小時 20 分內完成。
- **開票進度與時間都是虛構的**，不代表 2022 年實際的開票順序，也不是任何預測。只有最終快照是真實數字。
- 最終快照逐欄核對等於已公布的鄉鎮、縣市、全國數字，不符就中止。村里加總不等於上層數字時，差額會作為一筆額外回報（2022 年市長、議員、修憲複決三組皆無差額）。
- 2022 年嘉義市長選舉實際於 2022-12-18 舉行，但重播時與其他縣市一起在 11-26 開票。
- 檔案大小：2022 市長＋議員約 23 MB（68 份快照 × 2 組），修憲複決約 5 MB。只輸出到鄉鎮層級，不含村里。

## 開票夜注意事項

- 16:00 投票結束前，頁面不得出現預測、勝率或類似民調的數字。開票前只顯示 `not-started` 狀態。
- 頁面要標示資料來源「中央選舉委員會」與資料更新時間，並註明開票中的數字非最終結果。
- 模擬或歷史資料要清楚標示，使用 manifest 的 `labelZh`。
- 自動抓取只讀中選會公開提供的資料，由單一伺服器每 1–3 分鐘讀取一次；遇到 403／429 就停止並改為人工輸入，不嘗試繞過封鎖。

## 尚未完成

- 網頁的即時開票畫面（讀取 manifest／latest.json）。
- 將 `live/` 上傳到 R2 的流程（目前只寫到本機 `data/out/live/`）。
- 人工輸入工具（`manual` 模式）。
- 2026 年選舉的候選人 metadata（`live-cec` 需要）。
- 公投頁面的解析（同意／不同意欄位格式未知，沒有存檔）。
