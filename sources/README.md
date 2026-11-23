# 資料來源

完整清單、校驗碼與授權狀態見 [catalog.json](catalog.json)；Phase 0 的分析見 [docs/phase0-report.md](../docs/phase0-report.md)。

原始檔不進 Git（`data/raw/` 已列入 `.gitignore`）。

## 取得原始檔（正式流程）

ETL 會下載固定版本的原始檔，以 sha256 校驗後存到 `data/raw/<source-id>/`。

```bash
pnpm etl fetch
```

若想優先從本專案的公開鏡像下載（內容與官方檔案相同，同樣經 sha256 校驗），設定：

```bash
RAW_MIRROR_URL=https://vote-data.harlos.tw pnpm etl fetch
```

鏡像清單與授權聲明：<https://vote-data.harlos.tw/raw/index.json>、<https://vote-data.harlos.tw/raw/NOTICE.md>。

- **國土測繪中心網站**（`www.land.moi.gov.tw`）從海外網路（例如 GitHub Actions）無法連線，所以 CI 改從鏡像下載。鏡像需要從臺灣網路上傳，步驟見 [docs/deployment.md](../docs/deployment.md) §3.5。
- **`votedata.zip` 的 URL 不帶版本**，中選會更新時會直接覆寫。sha256 不符時建置會刻意失敗；審核新檔後，再更新 `packages/etl/src/config/sources.ts` 與本目錄的 `catalog.json`。

## 重建 Phase 0 樣本（僅供探勘腳本使用）

`scripts/phase0/` 的腳本讀取的是已解壓縮的 `data/raw/cec/`：

```bash
pnpm etl fetch
mkdir -p data/raw/cec && cd data/raw/cec && unzip -q ../cec-votedata/votedata.zip \
  'votedata/votedata/voteData/2024總統立委/*' \
  'votedata/votedata/voteData/2022-111年地方公職人員選舉/*' \
  'votedata/votedata/2018_2021公投_2022修憲複決/*' \
  'votedata/votedata/voteData/選舉資料庫格式.odt' \
  && mv votedata/votedata/* . && rm -rf votedata && cd -
pnpm phase0:validate
```
