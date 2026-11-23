# 部署指南（R2 ＋ GitHub Pages）

目前設定：

| 項目 | 值 |
|---|---|
| 網站 | `https://vote.harlos.tw`（GitHub Pages，repo `harlos0517/vote`） |
| 資料 | `https://vote-data.harlos.tw`（Cloudflare R2 公開 bucket） |
| 原始檔鏡像 | 同一個 bucket 的 `raw/` 路徑（公開，附授權聲明 `raw/NOTICE.md`） |

`harlos.tw` 已由 Cloudflare 代管 DNS，所以 R2 可以直接綁定自訂網域。

已經完成的步驟可以跳過。

---

## 1. R2 bucket 與自訂網域

1. Cloudflare Dashboard → **R2 Object Storage**。第一次使用需啟用 R2，免費額度內也需要先登記付款方式。
2. **Create bucket**：
   - 名稱例如 `vote-data`，之後填入 `R2_BUCKET`。
   - Location 選 Automatic。
3. 進入 bucket → **Settings** → **Public access** → **Custom Domains** → **Connect Domain**，輸入 `vote-data.harlos.tw`，Cloudflare 會自動建立 DNS 紀錄。
   - 不需要開啟 `r2.dev` 子網域；它有速率限制，不適合正式使用。
4. 同一頁的 **CORS Policy** → **Add CORS policy**，貼上：

   ```json
   [
     {
       "AllowedOrigins": ["https://vote.harlos.tw", "http://localhost:5173", "http://localhost:4173"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

5. （建議）Cloudflare 預設不快取 `.json`／`.geojson`。到 `harlos.tw` 網域 → **Caching** → **Cache Rules** → **Create rule**：
   - 條件：`Hostname equals vote-data.harlos.tw`
   - 動作：**Eligible for cache**，Edge TTL 選 **Use cache-control header if present**。

   發布程式已在檔案上設定好 Cache-Control：release 檔案為一年且 immutable，`manifest.json` 為 60 秒。

## 2. R2 API Token（只給 GitHub Actions 用）

1. R2 Object Storage 頁面 → **Manage API tokens** → **Create API token**。
2. 設定：
   - **Permissions**：Object Read & Write
   - **Specify bucket(s)**：只選步驟 1 的 bucket
   - TTL 可不設
3. 建立後會顯示 **Access Key ID** 與 **Secret Access Key**，只顯示一次，請直接貼到下一步的 GitHub secrets，不要存在其他地方。
4. **Account ID**：R2 頁面右側的 Account details 可以找到，也就是 Dashboard 網址中 `dash.cloudflare.com/` 後面那串。

## 3. GitHub 設定（repo `harlos0517/vote` → Settings）

1. **Environments** → **New environment**，名稱 `data-release`。
   - **Required reviewers**：勾選並加入自己。之後每次發布都需要你按核准。
   - **Deployment branches and tags**：Selected branches → `main`。
   - **Environment secrets** 加入四個：

     | Name | 值 |
     |---|---|
     | `R2_ACCOUNT_ID` | 步驟 2.4 |
     | `R2_ACCESS_KEY_ID` | 步驟 2.3 |
     | `R2_SECRET_ACCESS_KEY` | 步驟 2.3 |
     | `R2_BUCKET` | bucket 名稱（例如 `vote-data`） |

2. **Secrets and variables** → **Actions** → **Variables** 分頁 → 確認有 `DATA_BASE_URL` = `https://vote-data.harlos.tw`。目前網站已經使用這個值。
   - 自訂網域在根路徑，不需要設定 `SITE_BASE_PATH`。
3. **Pages**：Source 為 **GitHub Actions**，Custom domain 為 `vote.harlos.tw`（已完成）。

### 關於 `vote.harlos.tw` 走 Cloudflare proxy

目前 `vote.harlos.tw` 是橘色雲（proxied），網站可以正常開啟。保持這樣時：

- Cloudflare 的 **SSL/TLS 模式必須是 Full**；Flexible 會造成無限重新導向。
- GitHub Pages 的「Enforce HTTPS」可能無法勾選，因為 GitHub 無法替 proxied 網域簽發憑證。這不影響使用，HTTPS 由 Cloudflare 提供。

若想改由 GitHub 簽發憑證，把該 DNS 紀錄改成灰色雲（DNS only）即可。

### 建議：把 bucket 名稱改成一般變數

bucket 名稱（例如 `vote`）不是機密。放在 secret 裡時，GitHub 會把 log 中所有出現 "vote" 的地方遮成 `***`。

1. 在 Environment `data-release` → **Environment variables** 新增 `R2_BUCKET`（值同 bucket 名稱）。
2. 刪除同名的 secret。

workflow 會優先使用變數；沒有變數時才讀 secret。

## 3.5 Seeding the raw mirror（第一次發布前，在本機執行一次）

`www.land.moi.gov.tw`（國土測繪中心圖資）從 GitHub Actions 的海外 runner 無法連線，推測是只開放臺灣 IP。因此 CI 改從公開鏡像 `vote-data.harlos.tw/raw/…` 下載原始檔，而鏡像需要先從**能連上官方網站的電腦**（例如你的電腦）上傳一次。

在 repo 根目錄執行：

```bash
pnpm etl fetch
```

這會下載並以 sha256 校驗原始檔；本機已有的檔案會直接校驗，不會重新下載。

```bash
read -rp "R2_ACCOUNT_ID: " R2_ACCOUNT_ID && read -rp "R2_ACCESS_KEY_ID: " R2_ACCESS_KEY_ID && read -rsp "R2_SECRET_ACCESS_KEY: " R2_SECRET_ACCESS_KEY && echo && read -rp "R2_BUCKET: " R2_BUCKET && export R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
```

這樣輸入金鑰，不會留在 shell 歷史中，也不會寫進任何檔案。

```bash
pnpm etl mirror-raw --dry-run
```

```bash
pnpm etl mirror-raw
```

完成後可以確認：

```bash
curl -sI https://vote-data.harlos.tw/raw/NOTICE.md
```

預期看到 `200`。上傳完畢後關閉這個終端機視窗，環境變數就會一起清除。

之後只有在 `packages/etl/src/config/sources.ts` 固定了新的原始檔版本時，才需要再執行一次。

## 4. 第一次執行 workflow

1. **CI** 與 **Deploy site** 會在 push 到 `main` 時自動執行，到 **Actions** 分頁確認是否成功。
   - 如果出現 `Unable to resolve action ...@v5` 之類的錯誤，代表 action 版本不存在，請把錯誤訊息告訴我。
2. 先完成 3.5 的鏡像上傳，然後 **Publish data release (R2)** → **Run workflow**，第一次用：
   - `dry_run`：✅（只建置與驗證，列出將上傳的檔案）
   - `mirror_raw`：不需要勾選（已在本機上傳）

   log 中的 `download https://vote-data.harlos.tw/raw/...` 應該直接成功，不會再連到官方網站。

   完成後在該次執行頁面下載 **etl-report**，確認沒有 `fail`。
3. 確認無誤後再執行一次，這次 `dry_run` 取消勾選。到 **Review deployments** 按核准後才會上傳。
4. 上傳完成後打開 `https://vote.harlos.tw`；資料載入後地圖就會出現。

## 5. 發布後檢查 CDN

可以請我來檢查（我能直接存取公開網址），或自己執行：

```bash
curl -sI https://vote-data.harlos.tw/v1/manifest.json
```

預期看到 `200`，以及 `cache-control: public, max-age=60, must-revalidate`。

```bash
curl -sI -H 'Origin: https://vote.harlos.tw' https://vote-data.harlos.tw/v1/manifest.json | grep -i access-control-allow-origin
```

預期看到 `access-control-allow-origin: https://vote.harlos.tw`。

```bash
curl -sI -H 'Accept-Encoding: br, gzip' "https://vote-data.harlos.tw/v1/releases/$(curl -s https://vote-data.harlos.tw/v1/manifest.json | sed -E 's/.*"currentRelease": "([^"]+)".*/\1/' | head -1)/geography/nlsc-village-1120928/town.geojson" | grep -iE 'content-encoding|cf-cache-status'
```

預期有 `content-encoding: br` 或 `gzip`；若沒有，告訴我，我會改用 `application/json` 上傳。

```bash
curl -sI https://vote-data.harlos.tw/raw/NOTICE.md
```

預期看到 `200`（原始檔鏡像的授權聲明）。

## 6. 驗收

在 `https://vote.harlos.tw` 確認：

- 地圖載入
- 可以切換候選人與層級
- 點選地區後顯示詳細票數
- 分享網址後可以還原畫面

---

## 之後的日常操作

- **改網站**：push 到 `main` 即自動部署。
- **改資料或新增選舉**：合併程式後，手動執行 Publish workflow（先 dry run，再正式發布）。新的 release id 會自動產生，舊 release 不會被覆寫。
- **中選會更新 `votedata.zip`**：建置會因 sha256 不符而失敗，這是刻意的設計。審核新檔後，更新 `packages/etl/src/config/sources.ts` 與 `sources/catalog.json` 中的校驗碼。
