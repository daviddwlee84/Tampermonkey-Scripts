# 0.4.0 驗證紀錄

日期：2026-09-15。平台：macOS，Playwright 1.62.1，Chromium 151.0.7922.34。

## 已通過

- `node --test scripts/test-arxiv-ai-assistant.mjs`：**28/28**，包含原有 21 項與新增 7 項 Scholar 測試。
- 新增案例涵蓋：搜尋框題名與結果不同、PDF／標題的 ID 核對、版本與舊式 ID、Scholar 轉址、非 arXiv／矛盾／惡意連結、重點速覽底部 PDF、側欄換篇前的點擊防護、動態結果、複製 DOM、按鈕移除後恢復、無 observer 自我觸發、論文詳情、四個區域網域、URL-only 導覽、BFCache 恢復與窄版排列。
- `npm run verify`：14 支腳本的 metadata 與索引通過；5 個既有外部依賴警告均來自 page-reader-markdown。
- 腳本與測試的 Prettier 檢查、變更檔案的 `git diff --check` 通過。
- 唯讀取得 Scholar 公開搜尋頁，核對 `.gs_r.gs_or`、`.gs_rt`、`.gs_or_ggsm` 與原生 Quick Read 的 `#gs_md_aa-d`／`#gs_aa_fv_wrap` 結構。其公開 inline JS 從選定結果複製 `.gs_aa_fv` 至底部按鈕；腳本只讀這個連結，不解析 AI 回覆中的其他論文。

## 真實 Tampermonkey 與頁面重播

使用下方同一個官方 **Tampermonkey 5.5.0 / MV3** 套件，在新的隔離設定檔開啟 Allow User Scripts，再經 manager UI 安裝原始 **0.4.0**。未更改 production metadata、未直接注入 userscript、未使用 GM shim。檢查後刪除測試設定檔。

線上 Scholar 對隔離瀏覽器回傳「異常流量」頁，搜尋結果數為 0；manager 已註冊腳本。沒有繼續操作驗證挑戰，也沒有把這次線上檢查算作通過。

改以 Playwright route 在原始 Scholar URL **重播先前取得的公開 HTML**，保留其 inline JS 與 CSS，阻擋其他 Scholar 網路請求。重點速覽的底部連結由 fixture 模擬。以下檢查通過：

- 搜尋結果自動出現唯一一組按鈕，辨識為 `2602.01007`。
- 點擊「↗ arXiv」經真實 `GM_openInTab` 開啟 `https://arxiv.org/abs/2602.01007` 新分頁。
- 在原生 Quick Read 側欄殼內加入 PDF 連結後，自動出現版本為 `2602.01007v2` 的按鈕；換成另一篇 PDF 後正確更新為 `2602.01008`。
- 375 px 窄版的底部按鈕位於 viewport 內，未出現頁面例外。已檢視搜尋結果、側欄與窄版截圖。

本機證據位於 Git 忽略的 `.preview/scholar-manager-result.json`、`scholar-manager-results.png`、`scholar-manager-quick-read.png`、`scholar-manager-mobile.png`。這些結果證明實際 manager 的安裝、網站匹配、DOM 觀察與新分頁操作；不等於線上搜尋或登入後 AI 流程通過。

## 驗證邊界

- 登入後的完整「重點速覽」開啟／生成未實測：目前 in-app Browser 沒有可用 session。隔離測試使用核對過的側欄結構與模擬內容，不能視為 Google 帳戶流程通過。
- `.com.tw`、`.com.hk`、`.co.uk` 與 Scholar 論文詳情目前為 fixture 覆蓋，未逐一操作線上頁面。
- 本次未新增 GM grant 或 `@connect`；新增 Scholar `@match` 範圍。
- Firefox、真實 Violentmonkey、Safari Userscripts 及登入後 Kimi／Gemini 的限制沿用下方紀錄。

---

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
