# Grok Markdown exporter

## Context

使用者希望新增類似 `userscripts/chatgpt-export-markdown/` 的 Grok 腳本，並已選擇「核心匯出」：浮動面板與 manager 選單，提供複製 Markdown、複製 Agent Handoff、下載 `.md`、下載 `.json`。

驗收分享頁：
`https://grok.com/share/bGVnYWN5_0031bed2-7d10-4f94-b312-51ba763328a8`

首版支援公開分享頁與一般對話頁的已載入內容；不做對話樹、選取範圍、附件 ZIP、archive、離線 viewer、thinking/tools 開關或任意分享 URL 輸入。相容目標為 Tampermonkey + Violentmonkey，不發布或建立分享連結。

## 已確認的依據

2026-10-31 已用未登入的 Chromium 實際讀取範例頁：

- 網站透過同源 GET `/rest/app-chat/share_links/<share-id>` 取得 `{ conversation, responses }`。`message` 是原始 Markdown，另有角色、ID、時間、`partial` 與來源欄位。
- 此範例有一則 human、一則 assistant，含列表、表格與連結。這是「已公開的分享快照」，不代表完整私人歷史或全部分支。
- DOM 訊息為 `[data-testid="user-message"]`／`[data-testid="assistant-message"]`，正文在 `.response-content-markdown`，外層 ID 為 `response-<responseId>`。
- renderer 初期以 `.invisible.whitespace-pre-wrap` 保存原始 Markdown，之後才替換成 HTML；需要避免內容被忽略或重複轉換。
- 表格的 Copy/Download controls 位於正文容器內。角色標題、`.thinking-container`、sources 按鈕亦不可混入匯出。
- `webSearchResults` 是搜尋候選來源，不等於引用；此例的 `citedWebSearchResults` 為空。
- 登入後 `/c/<id>` 的 DOM／API 尚未實測，首版不推測私人 endpoint。

## 實作步驟

### 1. 建立腳本與 metadata

必須使用 scaffolder：

```bash
npm run new -- grok-export-markdown "Grok Export Markdown" "https://grok.com/*" "將 Grok 對話匯出為 Markdown、Agent Handoff 或 JSON"
```

- 初版 `@version 0.1.0`，保留產生的 data URI icon、update/download URL；明寫 `document-idle`、`@noframes` 與頂層 frame guard。
- `@match https://grok.com/*` 用於從首頁透過 SPA 進入對話；實際面板與匯出只在 `/share/<id>`、`/c/<id>` 啟用。不涵蓋子網域或 `x.com`。
- 僅宣告 `GM_registerMenuCommand`、`GM_setClipboard`、`GM_getValue`、`GM_setValue`。不需要 `unsafeWindow`、token、fetch 攔截、`GM_xmlhttpRequest` 或 `@connect`。
- 僅 `@require` 既有 `shared/chat-export.js`、`shared/export-ui.js`，沿用 repo URL 慣例，兩個 shared 檔案保持不變。

### 2. 分離擷取、正規化、交付

Grok 專屬邏輯放在新 `.user.js` 的 IIFE 內，無 bundler 或新 runtime dependency。

**分享頁**
- 匯出時才以原生 `fetch` 同源 GET 讀取快照；保留包含底線的完整 ID，驗證完整 path segment，不套用 ChatGPT 的 ID regex。
- 設定 AbortController 與有限 timeout，檢查 HTTP／JSON／錯誤或登入回應。
- 請求失敗時，才嘗試同一個當前分享頁的 DOM 備援；在 status 與匯出中明示降級。
- JSON 下載在 Markdown 正規化前分流，保存原始 payload，不因 Markdown 解析失敗而失去資料。

**一般 `/c/<id>` 對話**
- 僅擷取目前載入的 DOM。不自動捲動補歷史、不跨對話快取、不讀憑證、不背景抓取。
- JSON 下載為有 `source`、`url`、capture time、scope 與乾淨訊息片段的 **DOM snapshot envelope**，不稱作網站原始 JSON，且不依賴 HTML-to-Markdown 成功。

**API 正規化**
- 對應既有 renderer 的 doc：`source: 'grok'`、`sourceLabel: 'Grok'`、title、url、ids、model、createdAt、sections。
- 維持回傳順序，`human` → `User`、`assistant` → `Assistant`；保留原始 Markdown。不推導未取得的歷史／分支。
- 排除 `isControl`、thinking/tool steps；非支援內容須警告而非默默消失，原始 JSON 仍完整保留。
- 只從可辨識的 cited source 欄位補來源連結，不能將全部搜尋候選標為引用。附件只保留可辨識的遠端參照，不下載檔案。
- `partial: true`、衝突重複 ID、無可渲染訊息等情況須明確處理與標示。

### 3. DOM snapshot 與格式保真

- 按文件順序擷取確定的訊息 selector，不退回整頁 `innerText`。
- 先保留來源 URL、response ID、原始 placeholder／內容 clone，再清理 clone，不改原頁。
- 排除自己的 namespace、`data-no-copy` 角色標籤、思考區、script/style 與互動 controls；尤其測表格內按鈕。
- 原始 placeholder 尚為唯一內容時直接保留 Markdown；與已渲染 HTML 共存時只選一份。
- 參考 `userscripts/gemini-export-markdown/gemini-export-markdown.user.js` 的 `htmlToMarkdown()` 結構，但不照搬站點 selector 或固定三個 backtick。
- 語意轉換保留標題、巢狀列表、引用、表格、連結、圖片、code language／空白、可取得的數學原始碼；連結基於 snapshot URL 解析。
- 重用 `shared/chat-export.js` 的 `fence()`、`sourcesBlock()`、`renderTranscript()`、`filenameFor()`、`downloadText()`，避免重寫共用格式與下載。

### 4. 面板、SPA 與輸出標示

- 用 `createExportPanel()` 建立獨立 namespace 的可拖曳面板，保留位置記憶與 Reset button position。
- 四個操作為 `Copy Markdown`、`Copy Agent Handoff`、`Download .md`、`Download .json`；panel 與 manager menu 共用 action dispatcher。
- 使用 idempotent mount、有界 MutationObserver 排程，以及 `popstate`／`hashchange`／低頻 URL 比對。unsupported route 隱藏面板且 action 明確拒絕。
- 每次操作綁定 route generation／operation token；換頁取消 pending fetch／DOM wait，交付剪貼簿或檔案前再次檢查。過期操作不能覆蓋新 status。
- URL 已換但舊 bubble 尚在時不可匯出舊對話；追蹤舊節點／response ID，等待可確認的新內容，無法確認時提示重新載入而非猜測。
- DOM readiness wait 有 timeout 且 streaming 不會造成無限等待；完成／失敗／取消都清除相關 observer／timer。

新增 Grok-local `renderGrokTranscript()` 包裝既有 renderer：驗證其 frontmatter 邊界後插入固定、安全的 scope 欄位及可見說明，不修改 shared helper、不偽造 User／Assistant section：

| 來源 | `export_scope` | `completeness` | 可見說明 |
| --- | --- | --- | --- |
| Share API | `published-share-snapshot` | `unknown`；明確 partial 時為 `partial` | 僅包含公開快照，不保證完整私人歷史 |
| DOM | `loaded-dom` | `partial` | 僅含已載入訊息，未載入／收合／虛擬化內容可能缺漏 |

Markdown、Handoff、`.md` 一律帶此說明；原始 JSON 不改寫，限制由下載 status 與文件說明。

### 5. 測試與 repo 整合

**新增**
- `userscripts/grok-export-markdown/grok-export-markdown.user.js`
- 同目錄 `README.md`、`VALIDATION.md`（繁體中文，安裝連結與實測範圍）
- `tests/grok-export-markdown.test.mjs`
- `tests/fixtures/grok-export/` 的精簡 JSON／HTML fixture 與來源 README；保留觀察日期與樣本 URL，不提交完整範例對話全文。

**修改**
- `scripts/catalog.json`：在 `ai-export` 恰加入一次。
- `package.json`：新增 `test:grok-export`。
- 根 `README.md`：只透過 `npm run index` 更新腳本表格。
- `.agents/skills/userscript-development/references/content-extraction.md`：簡短補充 renderer 原始 Markdown placeholder／HTML 過渡時避免漏抓及重複轉換的通用原則。不修改 discovery symlink 或外部 skill 分發副本。

沿用 `tests/chatgpt-export-markdown.test.mjs` 的 Node／VM 與 Chromium、Firefox fixture 慣例；讀取真正交付的腳本及 dependencies，單一 init script 依序注入 shim → dependencies → script。網路僅允許 fixture 明列的 route。

重點案例：四個動作及下載 bytes／MIME；底線 ID；來源與順序；表格/code/link/math；原始 JSON 在 Markdown 失敗時仍可下載；API 失敗／timeout／DOM 降級；placeholder 過渡去重；自有 UI 與表格控制項 sentinel 不出現在輸出；原頁不變；partial／空內容／未知內容；SPA 首頁進入、URL-only 換頁、舊 bubble 暫留、fetch 中換頁；不重複面板、不跨頁交付。

## 驗證與完成標準

1. `node --check userscripts/grok-export-markdown/grok-export-markdown.user.js`
2. `npm run test:grok-export`：Node + Chromium／Firefox fixtures，檢查 Markdown 與 JSON 下載內容及截圖。
3. `npm run index`，接著 `npm run verify`（含 metadata 與 index freshness）。不修改傳輸／打包工具或擴大 CI 範圍。
4. 真實公開頁 smoke：
   ```bash
   npm run preview -- grok-export-markdown "https://grok.com/share/bGVnYWN5_0031bed2-7d10-4f94-b312-51ba763328a8" --menu "Copy Markdown" --wait 20000
   ```
   再跑 `Copy Agent Handoff`；逐項查看剪貼簿輸出與 `.preview/grok-export-markdown.png`。確認角色／表格／連結／scope 正確，沒有思考 UI、sources 按鈕或工具面板文字。以 Playwright download listener 另外檢查 `.md`／`.json`。
5. 以隔離 profile 分別嘗試真實 TM／VM 安裝驗證：matching、同源 fetch、grants、manager 選單、下載、位置保存與 sandbox；不以 shim 代替。缺少 artifact／環境受阻時，記錄具體未驗項目。
6. `/c/<id>` 以 fixture 驗證；若沒有使用者可供驗證的登入 session，明確記錄尚未完成 authenticated live smoke，不擅用日常 profile 或宣稱完整支援歷史。

本次不 commit／push；使用者核准計畫後才開始實作。
