# 2026-11-28 開票夜工作清單

依時間順序。所有指令在 repo 根目錄執行。背景說明見 `docs/live-feed.md`。

- feed：`cec-2026-11-28-local`
- 選舉群組（同一個 feed）：
  - `2026-11-28-local.mayor`：直轄市長及縣市長，22 個縣市、81 位候選人，有號次
  - `2026-11-28-local.township-mayor`：鄉鎮市長，198 個鄉鎮市、460 位候選人，沒有號次（依姓名對應）
  - `2026-11-28-referendum.case-22`：全國性公民投票案第22案
- 本機資料夾：`data/out/live/cec-2026-11-28-local/`
- 公開網址：`https://vote-data.harlos.tw/live/cec-2026-11-28-local/`
- 網頁：`https://vote.harlos.tw/#/?live=cec-2026-11-28-local`

**不要刪除或重建本機的 feed 資料夾**（包括 `.published.json`），也不要用這個 feed id 做任何演練。`0000.json` 已上傳；內容不同的同編號快照會被拒絕上傳。

## 一、11/27 以前

- [ ] 推送 `main`，確認 **Deploy site** 成功（即時開票畫面目前只在本機 commit）。
- [ ] GitHub repo → Settings → Secrets and variables → Actions → **Variables** 新增 `LIVE_FEED` = `cec-2026-11-28-local`，重新部署網站，確認標題列出現「即時開票」按鈕。
- [ ] 用真的瀏覽器打開網頁，確認顯示「尚未開票」、各縣市候選人與號次、0 票，沒有任何預測或比例數字。
- [ ] 審核 `packages/etl/mappings/candidates-2026-mayor.csv`：逐筆對照每列 `source` 的公告，特別是 `method` 為 `scan` 的 36 筆；確認後把 `status` 改為 `reviewed`。（2026-11-26 Claude 已以維基百科各縣市候選人表比對 81 筆一致，並改為 `reviewed`；如需人工複核，請另行確認。）
  - 有修正時重新產生並上傳群組檔（不會動到 `0000.json` 與 `latest.json`）：

    ```bash
    pnpm etl live-prelim --candidates packages/etl/mappings/candidates-2026-mayor.csv --from-group 2022-11-26-local.mayor
    ```

    ```bash
    pnpm etl live-publish --feed cec-2026-11-28-local
    ```

- [ ] 上傳新增的鄉鎮市長與第22案群組（已在本機產生；上傳後網頁標題列會出現選舉類別選單）：

  ```bash
  pnpm etl live-publish --feed cec-2026-11-28-local --dry-run
  ```

  ```bash
  pnpm etl live-publish --feed cec-2026-11-28-local
  ```

- [ ] 審核 `packages/etl/mappings/candidates-2026-township-mayor.csv`（對照中選會登記彙總表附件 7，特別是 10 位只保留漢字姓名的原住民族候選人），以及 `referendum-questions.csv` 中第22案主文（對照中選會公告）。有修正時重跑 `docs/live-feed.md` 中對應的 `live-prelim` 指令，再上傳。
  - 2026-11-26 Claude 已對照各縣（市）候選人名單公告與選舉公報：459 筆改為 `reviewed`；第22案主文已逐字核對。
  - [x] 5 位不在公告名單上的登記者（李貞秀、廖芳毅、張榮法、黃奕焮、蔡西湖）已自 CSV 刪除；伸港鄉「黄永欽」經公報確認無誤（見 `docs/live-feed.md`）。
  - [ ] 鄉鎮市長群組（本機已產生的是 465 人版本）需以目前 CSV 重跑 `live-prelim` 再上傳。
  - [ ] `status` 改變後，重跑 `live-prelim` 會改變網頁上「尚未人工審核」「主文已人工核對」等字樣；決定是否重新產生並上傳。
- [x] 三個推薦政黨（臺灣SoR無法黨、三勢團結促進聯盟、台聯黨）已依內政部政黨名冊對應中選會代碼 366、203、95（`party-names.csv`）；重跑縣市長群組的 `live-prelim` 後生效。
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
- [ ] 開一個長時間使用的終端機（建議 tmux）。R2 金鑰放在 repo 根目錄的 `.env`（`pnpm etl` 會自動讀取），或依 `docs/deployment.md` 3.5 節的 `read` 指令輸入。
- [ ] **16:00 前不要啟動輪詢**，網頁維持「尚未開票」。

## 三、2026 年網站結構（11/28 13:00 已確認）

網站在投票日中午就已開放（狀態 `prior`，尚未開票），與 2024 年相比有以下不同。紀錄與檢查方式見 `docs/live-feed.md`「2026 年網站（投票日確認）」。

- 入口 `https://vote.cec.gov.tw/` 轉到 `home/zh-TW/`，地方選舉與公投分成兩個網站：
  - 地方選舉：`https://vote.cec.gov.tw/2026-local/zh-TW/`（區域樹 `assets/def/tree-compiled.2026-local.min.json`）
  - 公投：`https://vote.cec.gov.tw/2026-ref/zh-TW/`（區域樹 `assets/def/tree-compiled.2026-ref.min.json`）
  - 舊的 `zh-TW/indexP.html` 回應 403。
- 頁面代碼：直轄市長與縣市長**同為 `TC`**（不是 C1／C2）、鄉鎮市長 `TD`（不是 D1）、公投第22案 `F1`。路徑規則不變（`<代碼>/<縣市5碼><選區2碼><鄉鎮3碼><村里3碼><投票所4碼>.html`）。
- **不要改 CSV 的 `cec_type`**：contest id 含有這個代碼（例如 `2026-11-28-local.c1-63000`），改了會和已上傳、不可覆寫的 `0000.json` 對不上。代碼一律在輪詢時用 `--prefix <群組>=<代碼>` 指定。
- 候選人簡歷頁（`CC`、`CD`）已開放：81 位縣市長的號次、姓名、政黨，以及 460 位鄉鎮市長的漢字姓名，都與 CSV 一致。金門縣金湖鎮號次 2（資格不符）保留一列空白，程式會略過。
- 公投全國頁（`F1/00000000000000000.html`）已開放，目前全為 0、投票權人總數 20,003,835；開票前副標題是空的，沒有「已送投票所數」，所以**開票前執行會因 `PageFormatError` 停止**。

16:00 後仍要確認（開票結果頁開票前是 404，無法事先檢查）：

- [ ] 瀏覽器開 `https://vote.cec.gov.tw/2026-local/zh-TW/indexP.html`，開發者工具 → Network，點進臺北市長，確認結果頁是 `2026-local/zh-TW/TC/63000000000000000.html`，頁面有「號次」「姓名（或候選人姓名）」「得票數」「已送投票所數/總投票所數」「資料時間」。
- [ ] 鄉鎮市長：例如宜蘭市 `TD/10002000100000000.html`。
- [ ] 公投：`2026-ref/zh-TW/F1/00000000000000000.html` 的副標題出現「已送投票所數/總投票所數」（或類似的已送／應送數字）。
- [ ] 路徑或欄位與上面差很多時：**不要啟動輪詢**，改走「六、出狀況時」。

## 四、開始輪詢

三個群組由**同一個**輪詢程式處理（不要同時開兩個輪詢程式）。啟動時第一行會列出每個群組實際讀取的網址，例如 `2026-11-28-local.mayor: levels national,county; pages https://vote.cec.gov.tw/2026-local/zh-TW/TC/…`，先看一眼是否正確。

- [ ] 先只跑一輪，**不上傳**：

  ```bash
  pnpm etl live-cec --feed cec-2026-11-28-local --groups 2026-11-28-local.mayor,2026-11-28-local.township-mayor,2026-11-28-referendum.case-22 --levels national,county --levels 2026-11-28-local.township-mayor=national,county,town --base https://vote.cec.gov.tw/2026-local/zh-TW/ --base 2026-11-28-referendum.case-22=https://vote.cec.gov.tw/2026-ref/zh-TW/ --prefix 2026-11-28-local.mayor=TC --prefix 2026-11-28-local.township-mayor=TD --prefix 2026-11-28-referendum.case-22=F1 --once
  ```

  確認：縣市長 `22 pages ok`、鄉鎮市長 `198 pages ok`、公投 `23 pages ok`，`failed` 為 0。`warn … not on the page (0 votes)` 是撤回或資格不符者，屬正常；九如鄉「藍聰信」頁面用相容字 U+2F97F，會出現 `by elimination` 警告，屬正常；其他 `not in the roster` 或 `by elimination` 要看是哪個名字。
- [ ] 公投頁面還沒有已送投票所數（`subtitle empty: counting not started?`）時，先不含第22案啟動：

  ```bash
  pnpm etl live-cec --feed cec-2026-11-28-local --groups 2026-11-28-local.mayor,2026-11-28-local.township-mayor --levels national,county --levels 2026-11-28-local.township-mayor=national,county,town --base https://vote.cec.gov.tw/2026-local/zh-TW/ --prefix 2026-11-28-local.mayor=TC --prefix 2026-11-28-local.township-mayor=TD --interval 180 --publish
  ```

  之後依本節最後一項的方式停止，再用下面的完整指令重啟加入。
- [ ] 正式開始（每 180 秒、每輪上傳；三群組每輪約 243 頁）：

  ```bash
  pnpm etl live-cec --feed cec-2026-11-28-local --groups 2026-11-28-local.mayor,2026-11-28-local.township-mayor,2026-11-28-referendum.case-22 --levels national,county --levels 2026-11-28-local.township-mayor=national,county,town --base https://vote.cec.gov.tw/2026-local/zh-TW/ --base 2026-11-28-referendum.case-22=https://vote.cec.gov.tw/2026-ref/zh-TW/ --prefix 2026-11-28-local.mayor=TC --prefix 2026-11-28-local.township-mayor=TD --prefix 2026-11-28-referendum.case-22=F1 --interval 180 --publish
  ```

- [ ] 打開網頁確認：狀態「開票中」、回報進度與資料時間更新、資料來源標示「中央選舉委員會」。
- [ ] 要改群組或層級時（例如加入第22案、縣市長加上鄉鎮層級）：建立 `STOP` 讓輪詢結束，刪除 `STOP`，用新參數重新啟動（各群組接續原本的 seq；沒有輪詢的群組在 manifest 中保留）。縣市長加上鄉鎮層級會多 368 頁，建議不要。

  ```bash
  touch data/out/live/cec-2026-11-28-local/STOP
  ```

  ```bash
  rm data/out/live/cec-2026-11-28-local/STOP
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
| `most names differ` | 頁面代碼或候選人名單對錯。停止輪詢，確認第三節的代碼與 `--prefix`。 |
| `not in the roster`（鄉鎮市長） | 只有該鄉鎮讀取失敗，其他照常。對照登記彙總表，修正 CSV 姓名後重跑 `live-prelim`，再依上一項重啟輪詢。 |
| 大量 `failed`（逾時、5xx） | 程式會自動拉長間隔（最長 10 分鐘），沿用上一輪數字並標示。持續發生時暫停輪詢。 |
| 上傳一直失敗 | 確認 `.env` 還在，或終端機的金鑰仍在（`echo $R2_BUCKET`）。輪詢不受影響，恢復後下一輪會補上。 |
| 需要停止 | 建立 `STOP` 檔案，跑完當輪結束。**重新啟動前要先刪除 `STOP`**，否則會立刻結束。 |
| 停止後要補傳 | `pnpm etl live-publish --feed cec-2026-11-28-local` |

## 七、開票結束後

- [ ] 所有縣市都 `final` 時輪詢會自動結束；確認最後一輪已上傳（`manifest.json` 的 `status` 為 `final`）。
- [ ] 網頁維持「開票完成」，仍註明非最終結果、以中選會公告為準；**不標示當選**（當選人以 12/4 中選會公告為準）。
- [ ] 關閉終端機。若金鑰放在 `.env`，選後可考慮刪除該檔或到 Cloudflare 撤銷這組 token。
- [ ] 之後：中選會公布選舉資料庫的正式結果後，以一般 ETL 建立 2026 年版本，再移除 `LIVE_FEED` 變數。

## 這次不涵蓋

- 議員（5 個縣市選舉區已變動）、村里長、鄉鎮市民代表、原住民區長與區民代表。
- 公投頁面依 2018 年網站撰寫，2026 年開票前頁面已核對標籤（見第三節），已送投票所數的位置要開票後才知道；不符時輪詢會因頁面格式不符停止，屆時拿掉第22案重啟。
- 人工輸入（`manual` 模式未完成）。
