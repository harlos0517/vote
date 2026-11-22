# 臺灣歷史選舉地圖

開源的臺灣歷史選舉互動地圖。資料來自中央選舉委員會與內政部國土測繪中心的官方開放資料，經離線 ETL 驗證後，以版本化靜態檔發布到 Cloudflare R2。網站本身是 GitHub Pages 上的靜態頁面。

**目前狀態：Phase 1（MVP）**。只收錄 2024 第16任總統副總統選舉，提供縣市與鄉鎮市區兩個層級。規格見 [開發指引](taiwan-election-map-development-guide.md)，資料可行性分析見 [Phase 0 報告](docs/phase0-report.md)。

## 快速開始

需要 Node.js 24 或以上、pnpm 11，以及系統的 `unzip`。

```bash
pnpm install
pnpm etl build        # 下載並驗證官方原始檔（約 130 MB，sha256 固定），產出 data/out/
pnpm --filter @tw-election/web dev
```

開發伺服器會在 `/data/` 路徑直接提供 `data/out/` 的內容，本機開發不需要 R2。

其他指令：

| 指令 | 用途 |
|---|---|
| `pnpm -r typecheck` | 型別檢查 |
| `pnpm -r test` | 單元測試（ETL、data-client、web） |
| `pnpm etl fetch` | 只下載並校驗原始檔 |
| `pnpm etl publish --dry-run` | 列出將上傳到 R2 的檔案 |
| `pnpm phase0:validate` | Phase 0 樣本驗證（需要先依 [sources/README.md](sources/README.md) 解壓樣本） |

## 專案結構

```text
apps/web/              React + Vite + Mantine + MapLibre + D3 + TanStack Query
packages/schema/       Zod 資料契約（模型與發布檔案格式）
packages/data-client/  載入 manifest、Contest、結果與圖資，並以 Zod 驗證
packages/etl/          下載 → 校驗 → 解析（Adapter）→ 檢核 → 合併界線 → 發布
  mappings/            人工審核的對照表（原始值、修正值、來源、審核狀態）
sources/               資料來源清單與校驗碼
docs/                  Phase 0 報告
.github/workflows/     CI、GitHub Pages 部署、資料發布（手動觸發）
```

地理處理併入 `packages/etl/src/geo`，使用 mapshaper（純 Node）處理，不需要 GDAL。

## 資料與授權

| 資料 | 來源 | 授權 |
|---|---|---|
| 選舉結果 | 中央選舉委員會〈選舉資料庫〉（[data.gov.tw 13119](https://data.gov.tw/dataset/13119)） | 政府資料開放授權條款第 1 版 |
| 行政界線 | 內政部國土測繪中心〈村里界歷史圖資〉（[data.gov.tw 130549](https://data.gov.tw/dataset/130549)），版次 1120928 | 政府資料開放授權條款第 1 版 |

- **程式碼**：MIT（見 [LICENSE](LICENSE)）。
- **資料**：資料與衍生資料維持原授權，使用時須標示出處。
- **縣市與鄉鎮界線**：由選舉前最近一版的村里界合併而成，與票數使用同一時期的區劃。

### 呈現規則

- 得票率 ＝ 得票數 ÷ 有效票數。投票率 ＝ 投票數 ÷ 選舉人數。
- 未知值一律顯示「無資料」，不以 0 代替。
- 著色不使用政黨色。得票率模式下，所有候選人共用同一條色盲友善的連續色階；「得票最多者」模式的顏色依號次指定，不代表政黨。
- 屏東縣瑪家鄉三和村位於官方另存的爭議圖層，與鄰近鄉鎮重疊，所以地圖上沒有繪出。它的票數依中選會資料計入瑪家鄉，網站在該區加註說明。

## 資料發布（R2）

### R2 上的檔案結構

```text
v1/manifest.json                                    可變；Cache-Control: max-age=60
v1/releases/<release-id>/index.json                 以下皆不可變；max-age=31536000, immutable
v1/releases/<release-id>/parties.json
v1/releases/<release-id>/contests/<contest-id>/metadata.json
v1/releases/<release-id>/contests/<contest-id>/results/{national,county,town}.json
v1/releases/<release-id>/geography/<boundary-version>/{county,town}.geojson
```

- `release-id` 是內容雜湊（例如 `r-f6d69f002ab0`）：同樣的輸入與程式碼，一定產生同樣的 ID 和檔案。
- 修正資料時會產生新的 release，舊檔不會被覆寫。發布程式偵測到同一路徑內容不同時，會直接中止。
- `manifest.json` 最後才上傳，讀者不會看到檔案不完整的 release。

### 一次性設定（人工）

1. 建立公開 bucket（例如 `tw-election-data`），綁定自訂網域並開啟公開讀取。
2. 建立私有 bucket（例如 `tw-election-raw`），存放原始檔鏡像；**不開放公開存取**。
3. 建立 R2 API Token：限定上述兩個 bucket，權限為 Object Read & Write。
4. 公開 bucket 的 CORS 設定：

   ```json
   [
     {
       "AllowedOrigins": ["https://<github-user>.github.io", "http://localhost:5173", "http://localhost:4173"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

5. GitHub 設定：
   - Environment `data-release`：設定 required reviewers，並加入 secrets `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_RAW_BUCKET`。
   - Repository variable `DATA_BASE_URL`：公開 bucket 的自訂網域，例如 `https://data.example.org/`。
   - Pages 的來源設為 **GitHub Actions**。

金鑰只放在 GitHub Secrets，不得提交到 Repository。

### 發布流程

1. 在 Actions 中執行 **Publish data release (R2)**，先保持 `dry_run: true`，檢查產出的 `etl-report` 是否有失敗項目。
2. 確認無誤後，以 `dry_run: false` 重新執行，並經 `data-release` 環境核准。
3. 推送到 `main` 時，網站會自動部署到 GitHub Pages：
   - `VITE_BASE` 設為 `/<repo>/`。
   - 網站狀態放在 URL hash（例如 `#/?lv=town&ch=n2`），所以深層連結不需要 SPA fallback。

## 驗證

每次建置會執行以下檢核，任何一項失敗就不輸出、也不發布：

- 每個統計單位：得票合計 ＝ 有效票，有效票 ＋ 無效票 ＝ 投票數，投票數 ≤ 選舉人數。
- 各層級加總一致：全國、縣市、鄉鎮、村里、投開票所，涵蓋所有欄位與所有候選人。
- 重新計算的得票率與官方公布的得票率一致。
- 當選註記與最高得票者一致。
- 全國總數與 `mappings/official-announcements.csv` 中登錄的官方公告一致。該檔尚待人工審核時，標記為 warning。
- 所有輸出名稱都不含私用區字元。
- 統計單位與界線多邊形一一對應。

結果記錄在 `data/out/reports/<release-id>.md`。
