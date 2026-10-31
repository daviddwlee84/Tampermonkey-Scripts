# Grok Export Markdown — 驗證紀錄

日期：2026-10-31；首版：`0.1.0`。本文件區分 GM shim、真實網站與真實 manager，沒有以其中一層代替其他層。

驗證的正式腳本 SHA-256：`2cf0e5bc632ca22ce49106b568d2d46ee546bf726654dbac9f409a0720b9d40e`。

## 靜態與 repo 檢查

- `node --check userscripts/grok-export-markdown/grok-export-markdown.user.js` 通過。
- `npm run index` 已產生 AI 對話匯出分類的新項目。
- `npm run verify` 通過：18 支 userscript、0 errors。5 個 warnings 均為既有 page-reader-markdown 的外部 `@require`，不是本腳本新增。

## Chromium／Firefox fixture（GM shim）

測試：`npm run test:grok-export`，可用 `GROK_BROWSERS=chromium` 或 `firefox` 選擇引擎。引擎版本：Chromium `151.0.7922.34`、Firefox `153.0`。

- 使用真正交付的腳本、`shared/chat-export.js` 與 `shared/export-ui.js`。
- 在同一個 init registration 中依序安排 shim → dependencies → script，配合本腳本 `document-idle` 在 DOM ready 後執行。
- HTTP fixture 限制為明列的路徑，其餘網路請求視為錯誤。
- 透過 manager-menu callback contract 與真正的面板點擊操作，讀取剪貼簿 shim 與下載 bytes，不只檢查 UI。
- 最終完整 suite **36/36 通過**：Chromium／Firefox 各 18 項，0 failures、0 skips，約 47 秒。
- 另涵蓋 A→B→C 連續換頁時舊 bubble 不得誤匯出，以及列表／引用內每一行 code 與 fence 的縮排保留。

覆蓋範圍：四個匯出動作、完整底線 share ID、scope／可見限制、原始 JSON 救援、partial／未知角色／control／重複 ID、引用與搜尋候選分離、API HTTP／JSON／timeout 降級、DOM 格式保真與原頁不變、placeholder 三種狀態、延遲 mount、空內容 timeout、SPA／舊 DOM 混合與取消跨頁交付。

測試曾抓到省略值的 `data-no-copy` 清理漏網，已修正並納入回歸。最初 init timing 錯誤是 fixture 在 `documentElement` 建立前執行 idle script，已修正 harness 的注入時機，未藉此推論 manager 執行失敗。

## 真實公開分享頁（GM shim）

測試 URL：
`https://grok.com/share/bGVnYWN5_0031bed2-7d10-4f94-b312-51ba763328a8`

環境：Playwright Chromium `151.0.7922.34`，未登入、獨立 browser context。

- `npm run preview -- grok-export-markdown <URL> --menu "Copy Markdown" --wait 20000` 通過。
- 同方式 `Copy Agent Handoff` 通過；實際查看文字輸出，不僅看截圖。
- 額外 live runner 等到頁面表格渲染完成，再實際點擊四個面板動作。
- `.md` 下載通過，包含表格、User／Assistant、標題、URL、scope。
- `.json` 下載通過，兩則 responses 的原始 message 均完整出現在 API Markdown 匯出中。
- 網站載入完成後才模擬分享 API HTTP 503，驗證真實 DOM 備援：表格／連結保留，`loaded-dom`／`partial` 與降級原因有標記，沒有 Copy table、thinking、sources 或自有 UI 文字。
- 已目視檢查桌面 1280×900 與窄螢幕 390×844 的面板截圖。

本機證據（不納入 Git）：`.preview/grok-export-live/`，含 `smoke.mjs`、`report.json`、`api-copy.md`、`handoff.md`、`dom-fallback.md`、`downloads/` 與面板截圖。一般 preview 會在 clipboard 就緒時收工，因此 `.preview/grok-export-markdown.png` 可能早於網站正文完成，不能單獨證明完整頁面 layout。

## 真實 manager

使用既有官方 extension artifacts、全新隔離 headless Chromium `151.0.7922.34` profile（Playwright `1.62.1`），透過 manager UI 安裝；沒有 GM shim、直接注入腳本或寫入 extension 私有資料庫。所有 profile 與 server 已於測試後清理。測試副本只額外加入 `http://127.0.0.1/*` match，並把兩個 `@require` 指向本機 HTTP server 的相同檔案；腳本主體、grants、run-at 與原本 Grok match 保持不變。

- **Tampermonkey 5.5.0**：已驗證 UI 安裝、浮動面板、分享 API 同源 cookie 請求、Markdown table／code／citation／角色順序及無 UI 汙染、原始 JSON 深度相等、位置 reload 後保存、五個 manager 選單與經選單下載 `.md`。Reset button position 也已透過真正 manager menu 操作，reload 後確認保存位置清除。
- **Violentmonkey 2.49.0**：UI 安裝、enabled dashboard、dependencies 載入已確認，但隔離 fixture 初次導航及 reload 後均未出現面板，popup 沒有 script entry；沒有 API request 或腳本 runtime error。確認 Allow User Scripts 與無 port 的 loopback match 後，標準 extension Reload 又遇到 `ERR_BLOCKED_BY_CLIENT`。停止額外 workaround，**runtime／選單／匯出驗證未完成**，不能由 fixture pass 推論 VM pass。
- 系統剪貼簿未讀取／測試；本節不證明正式 `https://grok.com/*` 上的 real-manager live smoke 或線上 dependency cache／自動更新。

Artifact identity：

- VM：官方 GitHub release `Violentmonkey-mv3-v2.49.0.zip`，SHA-256 `3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee`；66/66 packaged files 與 unpacked artifact 相同。
- TM：既有紀錄來自官方 Chrome update service CRX（原始完整下載 URL 未保留），SHA-256 `bcaec082c439e11c4df683f43d07e9ac3d4439251d72b91c5b452f977dac15d5`；除了 unpacked copy 缺少 `_metadata/verified_contents.json`，其餘 packaged files 相同。兩個 manager 的 manifest 都與原件一致，未修改。

本機證據：`.preview/grok-export-manager/` 的 runner、`tm-report.json`、`vm-report.json`、`tm-panel.md`、`tm-raw.json` 與截圖。

## 尚未驗證／不在本版範圍

- 真實登入後 `/c/<id>`：僅 fixture 驗證，不使用日常 browser profile 或憑證；DOM selector 與實際 SPA 行為仍需 authenticated live smoke。
- 完整私人對話歷史、所有分支、thinking／tool 輸出、獨立附件區、附件離線下載：不在首版範圍。
- 原生系統剪貼簿、Safari Userscripts、Firefox 上的真實 TM／VM：未以 GM shim 結果推論通過。
- 更新 URL 的線上發布／自動更新：尚未驗證；本機安裝與匯出測試不代表發布後更新流程通過。
