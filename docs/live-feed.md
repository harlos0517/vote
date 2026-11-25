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

### 2018 年公投計票網站

2018 年地方選舉網站 `vote2018.cec.gov.tw` 是另一套較舊的程式（結果表格由 JavaScript 產生），公投則另設 `referendum.2018.nat.gov.tw`。Internet Archive 保存了約 900 頁公投頁面。

- 路徑與 2024 年相同的 17 碼地區代碼：`pc/zh_TW/<案次代碼>/<縣市5碼><選區2碼><鄉鎮3碼><村里3碼><投票所4碼>.html`。案次代碼是該次公投的序號（第 7 案為 `01`，第 16 案為 `10`），不是案號。
- 頁面列出同意票數、不同意票數、有效票數、無效票數、投票數、投票權人數、投票率，以及「投開票所數 已送/應送」與「資料更新時間」（含秒）。整頁每 60 秒自動重新載入。
- 保存的全國頁面是開票中途（15,886/15,887，11/25 03:42:01），與最終結果差 1 所；鄉鎮頁面與公布值相同。
- 2025 年公投（`vote.cec.gov.tw`）首頁已改用與 2024 年相同的程式，但結果頁面沒有存檔，2026 年公投頁面的格式仍未知。

## 讀取中選會開票網站（cec-public）

```bash
pnpm etl live-cec --groups <groupId,groupId> --base https://vote.cec.gov.tw/zh-TW/
```

- 程式在 `packages/etl/src/live/cec-public.ts`，輸出到 `data/out/live/cec-<electionId>/`，格式與模擬重播相同（`mode: "cec-public"`）。
- `--groups` 要指向本機版本中已有的選舉群組，或 feed 內的開票前群組（見「2026 年候選人資料」）。開票夜步驟見 `docs/counting-night.md`。
- 路徑：`<base>/<類別代碼>/<縣市5碼><選區2碼><鄉鎮3碼><村里3碼><投票所4碼>.html`。類別代碼取 contest 的 `cecTypeCode`（C1、T1…）；2024 年全國性選舉沒有代碼，依職位對應 P1、L1–L4。
- 只抓只屬於一個 contest 的單位（縣市長的縣市、鄉鎮；議員的選區與選區內鄉鎮）。跨多個 contest 的單位（縣市長的全國、議員的縣市）由下層加總。
- 候選人以號次對應，姓名只做核對：少數不符（例如罕用字）記為警告，多數不符就中止，避免讀到錯的頁面。
- 候選人頁面沒有選舉人數、投票數等概況，`summary` 全為 null；`asOf` 取頁面的「資料時間」（或「資料更新時間」）。
- 公投頁面依標籤（同意票數、不同意票數、有效票數、無效票數、投票數、投票權人數）讀取數字，不依欄位位置；`summary` 會填入這些數字。上層加總時，只有所有下層都有值的欄位才加總。
- 公投沒有可推導的頁面代碼，要用 `--prefix <contestId>=<代碼>` 指定，例如 `--prefix 2018-11-24-referendum.case-7=01`；未指定就中止。
- 參數：`--levels`（預設為群組所有層級，不含村里與投開票所；可重複寫成 `<groupId>=<層級>` 只設定某一群組）、`--interval`（**秒**，預設 120）、`--concurrency`（同時請求數，預設 3）、`--feed`（輸出的 feed id，預設 `cec-<第一個群組的選舉>`；同一天的多場選舉可放同一個 feed）、`--once`（只跑一輪）。`--base file:///路徑/` 可改讀本機存下的頁面。
- 一個 feed 可同時有多場選舉的群組（例如地方選舉與公投）。輪詢只更新自己負責的群組，manifest 中其他群組的項目保留。
- 候選人沒有號次的群組（鄉鎮市長，依登記彙總表建立）以姓名對應：只比對漢字（原住民族名的羅馬拼音、間隔號與空白不計）。兩邊各剩一人時配對並記警告；名單有人但頁面沒有（撤回、資格不符）記為 0 票並警告；頁面有名單上沒有的姓名時，只有該頁讀取失敗（沿用上一輪數字），不中止整個輪詢。

安全機制：

- 遇到 **403／429 立即停止**，不重試、不更換標頭；改用人工輸入。
- 頁面格式不符（欄位、已送投票所數、數字格式）立即停止，不猜測。
- 其他失敗（逾時、5xx、404）沿用上一輪數字並標示 `stale: true`；一輪中過半失敗時，間隔加倍，最長 10 分鐘。
- 在輸出資料夾建立 `STOP` 檔案，跑完當輪就結束。全部群組都 `final` 時自動結束。
- 每個頁面附上 `?_=<毫秒>`，與中選會網頁本身每 60 秒重新整理時的作法相同。User-Agent 標示本專案名稱與網址。

請求量：縣市長只抓縣市層級是每輪 22 頁；加上鄉鎮是 390 頁，以 120 秒、同時 3 個請求計約每秒 3 頁。開票夜先只抓縣市層級，確認網站穩定再加鄉鎮。

測試資料：`packages/etl/test/fixtures/cec-live-2024/` 是 Internet Archive 保存的 2024 年頁面（全國總統、一個投開票所的不分區政黨票），只有開票完成後的版本；`cec-live-2018-referendum/` 是 2018 年公投頁面（全國開票中途、一個鄉鎮）。

### 投票日 16:00 後要確認

1. `vote.cec.gov.tw` 是否開放、首頁是否仍為同一套程式（`VoteApp.run`、`assets/def/tree-compiled.min.json`）。
2. 直轄市長、縣市長與議員的類別代碼（是否為 C1、C2、T1），以及頁面路徑是否符合上面的規則；代碼不同時改 CSV 的 `cec_type` 後重跑 `live-prelim`。
3. 頁面欄位是否仍有「號次」「候選人姓名」「得票數」與「已送投票所數/總投票所數」；公投頁面是否有「同意票數」「不同意票數」，以及案次代碼。
4. 先用 `--once` 跑一輪，檢查輸出再開始持續輪詢。

## 2026 年候選人資料（開票前的選舉群組）

`live-cec` 需要候選人與號次才能對應頁面。2026 年還沒有開票結果，所以另建「開票前群組」，放在即時資料夾內，不寫入 v2 版本，不影響已發布的網站。

```bash
pnpm etl live-prelim --candidates packages/etl/mappings/candidates-2026-mayor.csv --from-group 2022-11-26-local.mayor
```

- 輸出：`data/out/live/cec-2026-11-28-local/groups/2026-11-28-local.mayor/`（`metadata.json` 與 `units/<層級>.json`）。manifest 以 `{ feedPath, geographyRelease }` 指向它，地圖界線從 `geographyRelease` 版本讀取。
- 之後 `live-cec --groups 2026-11-28-local.mayor` 會優先讀這份群組。
- 統計單位與界線沿用 2022 年縣市長群組，只到鄉鎮市區（村里界有變動，不沿用）。

### 來源：`packages/etl/mappings/candidates-2026-mayor.csv`

- 22 個縣市、81 位候選人。號次取自各直轄市、縣（市）選舉委員會網站的「候選人名單公告」（115-11-12／11-17）；臺北市取自其「候選人姓名號次抽籤結果」（115-10-27，`(115年直轄市長選舉)候選人登記冊(有號次)`）。每列記錄來源網址。
- `method`：`text` 由 PDF 文字擷取；`scan` 為掃描檔，依圖片人工轉錄（新北、高雄、苗栗、彰化、雲林、臺東、花蓮、新竹市、嘉義市、連江，共 36 筆）。
- 推薦政黨取自中選會「115年地方公職人員選舉候選人登記名冊」（https://web.cec.gov.tw/central/article/64709，直轄市長 1-1、縣市長 3-1 彙總表）。
- 已以程式核對：每縣市候選人姓名集合、政黨與上述登記名冊一致，號次為 1..n 連續。**全部列仍標示 `unreviewed`，需人工逐筆對照公告確認**後再改為 `reviewed`。
- 政黨對應以名稱完全相同為準，「無」對應 `cec-999`。本站政黨表沒有的名稱：臺灣SoR無法黨、三勢團結促進聯盟、台聯黨（是否即台灣團結聯盟未確認），這些候選人 `partyId` 為 null，地圖以未分類顯示。
- 頁面代碼：中選會選舉資料庫以 C1 表示直轄市長、C2 表示縣市長（2024 年開票網站代碼與資料庫一致），CSV 的 `cec_type` 依此填寫；votedata.zip 則兩者都標 C1。開票網站實際代碼要在投票日確認。
- 議員、村里長、代表等未建立：議員有 5 個縣市的選舉區數與 2022 年不同（新竹縣、新竹市、基隆市、彰化縣、雲林縣），無法沿用 2022 年界線；村里長與代表的頁面數過多。

### 鄉鎮市長：`packages/etl/mappings/candidates-2026-township-mayor.csv`

```bash
pnpm etl live-prelim --candidates packages/etl/mappings/candidates-2026-township-mayor.csv --from-group 2022-11-26-local.township-mayor --feed cec-2026-11-28-local
```

- 198 個鄉鎮市、465 位候選人，取自中選會「115年鄉鎮市長選舉候選人登記彙總表」（https://web.cec.gov.tw/central/article/64709，附件 7，製表 115-09-07），選舉區名稱對應 2022 年的鄉鎮代碼。
- 登記彙總表**沒有號次**，開票時依中選會頁面的姓名對應（見上方「讀取中選會開票網站」）。登記後資格不符或撤回的人仍在名單上，開票時記為 0 票。
- 10 位原住民族候選人的姓名在 PDF 中含羅馬拼音並被換行切斷，CSV 只保留漢字部分（例如「車牧勒薩以‧拉勒格安」）；所有姓名已移除空白。
- 頁面類別代碼依 2022 年資料為 `D1`，投票日要確認。
- 全部列標示 `unreviewed`。

### 全國性公民投票案第22案

```bash
pnpm etl live-prelim --referendum 22 --election 2026-11-28-referendum --from-group 2022-11-26-constitutional-referendum.case-1 --feed cec-2026-11-28-local
```

- 主文取自 `packages/etl/mappings/referendum-questions.csv`：中央選舉委員會公告中選務字第1153150284號（115-08-28，https://web.cec.gov.tw/central/article/64314），標示尚未人工核對。
- 通過門檻依公民投票法第29條（同意多於不同意，且同意達投票權人總額四分之一以上）。
- 統計單位與界線沿用 2022 年修憲複決（全國、縣市、鄉鎮市區）。
- 開票網站的公投頁面代碼無法事先得知，開票時以 `--prefix 2026-11-28-referendum.case-22=<代碼>` 指定。
- 即時模式下，門檻顯示為「目前已達／目前未達」並註明只含已回報的投開票所，不顯示投票結果。

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

## 網頁的即時開票畫面

網址加上 `live=<feedId>` 即進入即時開票模式，例如 `#/?live=cec-2026-11-28-local`；建置時設定 `VITE_LIVE_FEED=<feedId>` 會在標題列顯示「即時開票」按鈕。資料從同一個資料網址的 `live/<feedId>/` 讀取（本機開發時為 `data/out/live/`）。

- manifest 與 `latest.json` 依 manifest 的 `pollIntervalSeconds` 重新讀取（最短 15 秒），切回分頁時也會更新；不使用瀏覽器快取。收到 `seq` 較舊的快照（例如 CDN 暫時回傳舊檔）時保留目前畫面。
- 快照轉成與歷史資料相同的結果格式，地圖、圓環圖與側欄沿用。尚未回報的地區得票為 0，地圖顯示為無資料。候選人頁面沒有有效票數，以各候選人得票加總代替（有效票即為各候選人得票合計）；其他概況欄位顯示無資料。
- 即時模式一律不標示當選：即使重播的歷史資料記有當選人也不顯示；「當選候選人」改為「領先候選人」，不畫斜線、不分當選／未當選；跨多場選舉的地區（例如縣市長的全國）以得票最多的政黨著色，側欄不顯示席次。
- 側欄上方顯示狀態（尚未開票／開票中／開票完成；重播另標「模擬」）、整體回報進度、資料時間、manifest 的說明文字與資料來源；點選地區時顯示該地區的回報數與資料時間，該輪讀取失敗時註明沿用上一輪數字。
- 開票中超過 3 個輪詢間隔沒有新快照時顯示提醒。
- 開票前（`not-started`）只顯示候選人與 0 票，並說明本站不提供預測、勝率或民調數字。

`live-prelim` 也會寫出 `not-started` 的 `latest.json`（seq 0）與 manifest，開票前即可開啟頁面；已有 `latest.json` 時（輪詢已在執行）不會覆蓋。

## 上傳到 R2（`live/`）

即時資料從執行輪詢的電腦上傳（需要能連到中選會網站，所以不在 CI 執行）。金鑰輸入方式與 `mirror-raw` 相同，見 `docs/deployment.md` 3.5 節；也可放在 repo 根目錄的 `.env`，`pnpm etl` 會自動讀取。

```bash
pnpm etl live-publish --feed cec-2026-11-28-local --dry-run
```

```bash
pnpm etl live-publish --feed cec-2026-11-28-local
```

開票夜由輪詢程式每輪寫完後直接上傳：

```bash
pnpm etl live-cec --groups 2026-11-28-local.mayor --base https://vote.cec.gov.tw/zh-TW/ --publish
```

- 只寫入 `live/<feedId>/` 底下，不會動到 `v2/` 版本。
- 上傳順序：快照與群組檔 → 各群組 `latest.json` → `manifest.json` 最後，讀取端不會指向還不存在的檔案。
- 快取：`manifest.json`、`latest.json` 為 10 秒（`must-revalidate`）；群組 metadata 與統計單位為 60 秒；編號快照為一年 `immutable`。現有的 Cloudflare Cache Rule（依 Cache-Control）已涵蓋。
- 只上傳有變動的檔案，紀錄在資料夾內的 `.published.json`；中途失敗再執行會從斷點繼續。
- 快照不可覆寫：R2 上已有同編號但內容不同的快照時中止（要重新產生就換一個 feed id）。
- `--publish` 時上傳失敗只記錄，不中止輪詢，下一輪重試；啟動時沒有金鑰則直接中止。
- `live-publish --watch <秒>` 會持續上傳（例如重播演練時搭配 `live-play`），建立 `STOP` 檔案後結束。
- 網站的「即時開票」按鈕：在 GitHub repo 的 Actions variables 設定 `LIVE_FEED`（例如 `cec-2026-11-28-local`）後重新部署網站；未設定則不顯示按鈕，但仍可用 `#/?live=<feedId>` 開啟。

## 開票夜注意事項

- 16:00 投票結束前，頁面不得出現預測、勝率或類似民調的數字。開票前只顯示 `not-started` 狀態。
- 頁面要標示資料來源「中央選舉委員會」與資料更新時間，並註明開票中的數字非最終結果。
- 模擬或歷史資料要清楚標示，使用 manifest 的 `labelZh`。
- 自動抓取只讀中選會公開提供的資料，由單一伺服器每 1–3 分鐘讀取一次；遇到 403／429 就停止並改為人工輸入，不嘗試繞過封鎖。

## 尚未完成

- 人工輸入工具（`manual` 模式）。
- 2026 年議員等其他選舉的候選人資料（縣市長已建立，見上方）。
- 2026 年公投頁面的實際格式（解析依 2018 年格式，以標籤讀取；2025、2026 年的頁面沒有存檔）。
