# 0.3.0 驗證紀錄

日期：2026-09-15。平台：macOS，Playwright 1.62.1，Chromium 151.0.7922.34。

## 已通過

- `node --test scripts/test-arxiv-ai-assistant.mjs`：21/21。以 GM shim 隔離測試原有 FAQ／摘要流程，以及版本日期、引用方向、快取、零值／缺值、同名論文 ID 核對、限流／逾時、重複點擊與頁面變更。
- `npm run verify`：14 支腳本的 metadata 與產生的索引通過。5 個既有警告來自 page-reader-markdown 的外部依賴。
- 腳本、測試與 catalog 的 Prettier 檢查，以及本次變更檔案的 `git diff --check` 通過。
- 唯讀真實頁面 smoke：arXiv `1706.03762v1` 的 v1 首次提交、v7 最新修訂、OpenAlex 引用數與上游清單；papers.cool `2609.12303v1` 的提交紀錄與外部入口。無頁面例外，資訊卡無水平溢出。這一層使用 GM shim 與 Node GET bridge。

## 真實 Tampermonkey

使用 Chrome Web Store 更新服務取得的官方 Tampermonkey **5.5.0 / Manifest V3**，解包後載入全新的 Playwright 測試設定檔；未修改 extension manifest 或 source。

CRX SHA-256：`bcaec082c439e11c4df683f43d07e9ac3d4439251d72b91c5b452f977dac15d5`。

在 Chrome 擴充功能 UI 開啟 Allow User Scripts，再由 Tampermonkey 安裝 UI 安裝 loopback HTTP 提供的原始 **0.3.0** 腳本。保留 production metadata，未加入測試用 `@match`，未注入腳本或 GM shim。

安裝當次 session 已確認：

- arXiv `1706.03762v1` 自動顯示資訊卡；Semantic Scholar 限流後，由真實 `GM_xmlhttpRequest` 取得 OpenAlex 引用數及上游清單。
- 開啟 papers.cool `1706.03762v1`，顯示相同引用資料與快取標示，證實 manager storage 跨網站共用。
- 重新由 manager UI 安裝後，在 papers.cool `2609.12303v1` 成功跨站讀取未快取的 arXiv 提交紀錄。
- 以上頁面皆只有一張資訊卡，未發生頁面例外。

**重啟限制：** Playwright 再次 sideload 同一 unpacked manager 後，已安裝的腳本仍出現在 dashboard，但 `chrome.userScripts.getScripts()` 回傳空清單，頁面未注入。Allow User Scripts 仍為開啟；重新安裝 UI 顯示 manager 無法確認腳本來源，重新安裝後恢復注入。這個重啟情境未通過，不能由安裝當次的成功推論日常瀏覽器的重啟相容性；本次沒有為此修改產品腳本。

## 尚未驗證

- Firefox：Playwright Firefox 153.0 的 CDN 下載逾時，已停止下載；沒有把瀏覽器啟動失敗算作測試通過。
- 真實 Violentmonkey、Safari Userscripts。
- 已登入 Kimi／Gemini 的實際自動送出；保留隔離 fixture 的草稿保護與單次送出測試結果。
- Connected Papers 圖譜生成、Google Scholar 搜尋結果及登入／訂閱流程。已核對外部連結格式；不把新分頁入口等同第三方服務必定有資料。

本機截圖與原始 smoke 記錄放在 Git 忽略的 `.preview/`，包含 `arxiv-research.png`、`papers-cool-research.png`、`arxiv-research-smoke.json`、`tampermonkey-research-result.json`。
