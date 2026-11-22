# 資料來源

完整清單、校驗碼與授權狀態見 [catalog.json](catalog.json)；Phase 0 的分析見 [docs/phase0-report.md](../docs/phase0-report.md)。

原始檔不進 Git（`data/raw/` 已列入 `.gitignore`）。重建 Phase 0 樣本：

```bash
mkdir -p data/raw/cec data/raw/nlsc
curl -L -o data/raw/cec/votedata.zip "https://data.cec.gov.tw/%E9%81%B8%E8%88%89%E8%B3%87%E6%96%99%E5%BA%AB/votedata.zip"
sha256sum data/raw/cec/votedata.zip   # 對照 catalog.json
cd data/raw/cec && unzip -q votedata.zip \
  'votedata/votedata/voteData/2024總統立委/*' \
  'votedata/votedata/voteData/2022-111年地方公職人員選舉/*' \
  'votedata/votedata/2018_2021公投_2022修憲複決/*' \
  'votedata/votedata/voteData/選舉資料庫格式.odt' \
  && mv votedata/votedata/* . && rm -rf votedata
```

NLSC 圖資 URL 含中文檔名，需先 percent-encode 檔名部分再下載（見 catalog.json 的 `url`）。

```bash
pnpm install
pnpm phase0:validate
```

注意：`votedata.zip` 為中選會持續更新的單一檔案（非版本化 URL），每次下載都必須重新計算 sha256 並記錄。
