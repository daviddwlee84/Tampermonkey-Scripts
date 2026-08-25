# ChatGPT → Markdown exporter userscript

## Context

需求：把一整段 ChatGPT 網頁對話變成**能直接餵給 coding agent 的 Markdown**，格式仿
`.specstory/history/*.md`（SpecStory 轉 local Codex/Claude chat history 的那套：
`_**User (ts)**_` / `---` / `_**Assistant (model)**_`）。現況的痛點是內建複製鈕一次只
複製一則 response，share link 又是給人看的 URL、bot 爬不到。

### 已實測的關鍵事實（決定了整個架構）

在 `https://chatgpt.com/share/6a8d5801-10d8-83ec-b5e7-9d8dc54d48c6` 上用 headless
Chromium 驗證過：

1. **DOM scrape 一定不完整。** 該對話有 44 個 node，但 DOM 裡只有 4 個
   `[data-message-author-role]` —— 訊息列表是 virtualized 的。所以「clone DOM →
   innerText」那條路（也就是 ChatGPT 自己建議的 console snippet）先天就是殘缺的。
2. **完整對話 JSON 就掛在頁面的 router state 上**：
   `window.__reactRouterContext.state.loaderData['routes/share.$shareId.($action)'].serverResponse.data`
   含 `title` / `create_time` / `default_model_slug` / `mapping` / `linear_conversation`。
3. **裡面是模型原本吐出的 raw markdown**，不是 HTML 還原的結果 —— code fence、表格、
   引用全都在。這正是「保留完整 markdown format」唯一可靠的來源。
4. **`/backend-api/share/<id>` 直接打會被 Cloudflare 擋 403**（curl 與 headless 都是），
   所以不能倚賴它當主要來源。
5. **同源 iframe 可行**：share 頁的 CSP 是 `frame-ancestors 'self' …`，實測在
   chatgpt.com 頁面裡塞一個 `<iframe src="/share/<id>">`，載入後讀
   `iframe.contentWindow.__reactRouterContext` 拿得到完整 44 則。→ 這就是「貼任意
   public share URL」功能的實作方式。
6. **citation 是私有區 unicode sentinel**：`citeturn418705search0`，
   而同一則訊息的 `metadata.content_references[]` 有 `matched_text` 與 `alt`
   （`alt` 就是現成的 `([GitHub](https://…))`）。→ 可以無損轉成 markdown 連結。

### 使用者已確認的取捨

- 範圍：**目前這一頁（`/c/` 與 `/share/`）＋ 貼任意 share URL**
- 內容：問答本文 + citation→markdown 連結為預設；**thinking / tool calling 做成 optional
  開關，預設關**（「先有最簡潔的輸入輸出」）
- 輸出：SpecStory 風格 transcript ＋ raw JSON ＋ **Agent Handoff 變體**
- UI：manager 選單指令 ＋ 右下角浮動按鈕

---

## 要做的事

用 scaffolder 建立新腳本（不要手動建目錄）：

```bash
npm run new -- chatgpt-export-markdown "ChatGPT Export Markdown" "https://chatgpt.com/*" \
  "把整段 ChatGPT 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用"
```

產出兩個檔案，兩個都要重寫：
`userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js`、
`userscripts/chatgpt-export-markdown/README.md`。

### 1. Metadata block

```
// @version      1.0.0
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
```

- `document-start` 是必要的：live chat 的來源之一是攔截網站自己發出的 conversation
  request（見 `docs/06-sandbox-and-unsafewindow.md` 的 fetch 攔截 recipe），晚一步就抓不到。
  代價是 `document.body` 可能還不存在 → 掛 UI 前要等 `DOMContentLoaded`。
- 有任何 `@grant` 就會進 sandbox，所以讀 `__reactRouterContext` 一律走 `unsafeWindow`，
  並 fallback 到 `window`（`const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window`）。
- 上述 GM API 全在 `scripts/check-meta.mjs` 的 `PORTABLE_GM` 清單內，`unsafeWindow`
  兩個 manager 都支援 → 不會觸發 portability warning。
- **不要**加 `@connect`：全部同源 `fetch`，不需要 `GM_xmlhttpRequest`。
- `@icon` 用 `node -e "import('./scripts/lib/icon.mjs').then(m=>console.log(m.iconFor('chatgpt-export-markdown')))"`
  產生的 data URI（scaffolder 會自動填好，不要換成 favicon 服務）。
- 下載用 blob + `a.click()`（照抄 `shared/dom.js:86` 的 `downloadText`），不需要 `GM_download`。

### 2. 取得對話資料：四層 fallback

一個 `resolveConversation({ shareId, convId })`，依序嘗試，第一個成功就用：

| # | 來源 | 適用 | 狀態 |
|---|------|------|------|
| 1 | fetch/XHR 攔截器攔到的 `/backend-api/conversation/<id>` payload（`Map<convId, data>`） | 登入中的 `/c/` | 需實機驗證 |
| 2 | 掃 `pageWin.__reactRouterContext.state.loaderData` 每個 value，找含 `serverResponse.data.linear_conversation` 或 `.mapping` 的那個 | `/share/`（**已實測**），`/c/` 可能也有 | 已驗證 |
| 3 | 同源 `fetch('/backend-api/conversation/<id>')`，Bearer token 取自 `fetch('/api/auth/session').accessToken` | 登入中的 `/c/` | 需實機驗證 |
| 4 | 隱藏 iframe 載入 `/share/<id>`，輪詢 `iframe.contentWindow.__reactRouterContext`，取到就 `iframe.remove()` | 貼上的任意 share URL | 已驗證 |

**不要寫 DOM scrape fallback。** 理由寫在上面（44 則只渲染 4 則），寧可失敗時給一句
可行動的錯誤訊息（「請重新整理頁面後再試一次」）也不要靜靜吐出殘缺的 transcript。
route key（`routes/share.$shareId.($action)`）會隨 ChatGPT 改版變動，所以第 2 層要
**掃描 loaderData 的所有 value 找形狀**，不要 hard-code key。

第 2 層拿到的是 `serverResponse.data`；第 1/3 層拿到的是 `/backend-api/conversation`
的回應（只有 `mapping` + `current_node`，**沒有** `linear_conversation`）。因此下一步的
thread 展開要同時支援兩種形狀。

### 3. 轉檔 pipeline

`buildThread(data)`：
- 有 `linear_conversation` 就用它；否則從 `current_node` 沿 `mapping[id].parent` 往上走
  再 reverse。這樣拿到的是**目前選中的那條 branch**，編輯/重生過的分支自動被排除。

`visibleMessages(thread, opts)` 過濾（順序照這個寫，這是 ChatGPT UI 自己的判準）：
- 丟掉 `metadata.is_visually_hidden_from_conversation === true`
- 丟掉 `author.role === 'system'`
- 丟掉 `content_type` 為 `model_editable_context` / `user_editable_context`（memory 更新）
- `opts.includeThinking === false`（預設）時丟掉 `thoughts` / `reasoning_recap`
- `opts.includeTools === false`（預設）時丟掉 `author.role === 'tool'` 以及
  `recipient !== 'all'` 的 assistant 訊息（`web.run` 那些 `code` 訊息）
- 丟掉 parts 為空字串的

`textOf(message)` —— 一張 `content_type` → 抽字的小表：
`text` / `multimodal_text`（part 是物件時輸出 `![image](<asset_pointer>)` 佔位）、
`code`（包成 fenced block，language 取 `content.language`）、
`thoughts`（`content.thoughts[]` 的 `summary` + `content`）、
`reasoning_recap`、`execution_output`。
**未知 content_type 一律 `JSON.stringify` 後包進 fence**，不要靜默丟掉 —— Deep Research
與 canvas 之類的新型態才不會整段消失。

`applyCitations(text, message)`：
- 把 `metadata.content_references[]` 依 `start_idx` 由大到小排序，逐一
  `text.split(ref.matched_text).join(ref.alt || '')`（實測 type 有
  `grouped_webpages` / `url` / `hidden` / `sources_footnote`，`alt` 已是現成的 markdown 連結）
- 收尾再用 `/[\s\S]*?/g` 掃掉沒被 `matched_text` 命中的殘留 sentinel
  （實測會有 `url…` 這種漏網的）

`mergeAdjacent()`：**連續同 role 的訊息要合併成一段**。實測一輪 assistant 會被拆成
「開場白 → 搜尋 → 正文」好幾則，不合併的話 transcript 會出現一堆只有一行的 Assistant 區塊。

### 4. 三種輸出

**A. Transcript（預設）** —— frontmatter 放最前面（才是合法 YAML frontmatter），
接著仿 SpecStory 的 body：

```markdown
---
source: chatgpt
title: 分享聊天Context
url: https://chatgpt.com/share/6a8d5801-…
conversation_id: 6a8d446e-…
model: gpt-5-6-thinking
exported_at: 2026-08-25T16:40:00+08:00
messages: 7
---

# 分享聊天Context

<!-- Generated by chatgpt-export-markdown v1.0.0 -->

_**User (2026-08-25 07:45:34Z)**_

…原始 markdown 原封不動…

---

_**Assistant (gpt-5-6-thinking)**_

…

---
```

時間戳用 `message.create_time`（epoch 秒）轉 UTC `YYYY-MM-DD HH:mm:ssZ`，對齊
`.specstory/history/` 現有檔案的寫法；`exported_at` 用本地時區 ISO。

**B. Agent Handoff** —— 在 A 前面加一段固定的英文指示，然後接完整 transcript：

```markdown
# Prior ChatGPT Context

The following is a prior discussion between the user and ChatGPT.

## Instructions for the coding agent
- Treat established decisions as existing project decisions.
- Do not reopen settled design questions unless implementation reveals a conflict.
- Preserve the user's stated constraints.
- Consult the original conversation below when necessary.

---

## Conversation
（A 的 body）
```

**C. Raw JSON** —— `JSON.stringify(data, null, 2)`，給未來重新 render / 建索引用。

檔名：`chatgpt-<title 消毒過的 slug>-<YYYYMMDD-HHmm>.md` / `.json`。

### 5. UI（idempotent + SPA 安全）

- `mount()` 只掛一次（用 `document.getElementById` 檢查，照
  `shared/dom.js:66` `addFloatingButton` 的做法**複製進腳本**，不要用 `@require` ——
  `shared/README.md` 建議少量函式直接複製，也少一個安裝時的網路相依）。
- 右下角按鈕點開一個小 panel：Copy Markdown / Copy Agent Handoff / Download .md /
  Download .json ／兩個 checkbox（思考過程、工具呼叫，用 `GM_setValue` 記住）／
  一個貼 share URL 的輸入框 + Go。
- 同樣的動作全部另外註冊一份 `GM_registerMenuCommand`（**不要用 `accessKey`**，TM 限定）：
  `Copy Markdown` / `Copy Agent Handoff` / `Download .md` / `Download .json` /
  `Export from share URL…`（用 `prompt()`）/ 兩個 toggle。
- panel 的 DOM 用高 z-index + 自己的 id prefix，避免被 ChatGPT 的樣式吃掉；
  因為抓資料完全不碰 DOM，**注入的 UI 不可能污染抓取結果**（這正是 CLAUDE.md 警告的那個坑）。
- URL 變化時只更新 panel 上顯示的標題，不重建按鈕。

### 6. README.md

照 `userscripts/page-title-tag/README.md` 的結構：一句話說明、生效網站、安裝連結、
原始碼連結、「它做了什麼」、「為什麼不是一行就好」（放 virtualized DOM 44→4 那個實測數字
與 `__reactRouterContext` 的位置）、使用方式（三顆按鈕 + 貼 share URL）、
已知限制（見下）。

### 已知限制（要寫進 README，不要假裝沒有）

- 靠 `__reactRouterContext` 這種 app internals，ChatGPT 改版就可能失效 ——
  `docs/06` 明講這是最脆弱的一層；選它是因為 DOM 那層根本不完整。
- 登入中 `/c/` 的第 1/3 層來源沒辦法在 headless 驗證，要實機確認。
- Deep Research / canvas 尚未拿到真實樣本驗證；未知 content_type 會以 JSON fence 呈現，
  不會消失但也不會漂亮。
- 只匯出目前選中的 branch，不含被編輯掉的其他分支。

---

## 驗證

```bash
npm run check          # metadata、@grant 交叉比對、portability
npm run index          # 新腳本 → 重新產生 README 表格（不要手改表格）
npm run verify         # = check + index:check，等同 CI

# share 頁的完整端到端（已確認 headless 拿得到 loaderData）
npm run preview -- chatgpt-export-markdown \
  "https://chatgpt.com/share/6a8d5801-10d8-83ec-b5e7-9d8dc54d48c6" \
  --menu "Copy Markdown"
```

`--menu` 會把 `GM_setClipboard` 的內容整段印出來（CLAUDE.md 特別要求 exporter 類腳本
一定要這樣看輸出，截圖看不出殘缺）。驗收標準：印出來的 transcript 有 **2 則 User + 4 則
Assistant**（合併後）、code fence 完整、``/`` 一個都不剩、citation 變成
`([GitHub](https://github.com/VMSTE/chatgpt-exporter…))` 這種連結。

再跑一次 `--menu "Copy Agent Handoff"` 確認前綴區塊正確。

`scripts/preview.mjs` 的 GM shim 只提供
`GM_setValue/getValue/deleteValue/listValues/setClipboard/registerMenuCommand/unregisterMenuCommand/addStyle/info`
並設 `window.unsafeWindow = window` —— 剛好夠這支腳本用；但它是 `document-idle` 注入，
所以 **fetch 攔截那層在 preview 裡不會被測到**，這是預期內的（`docs/13` 已寫明 harness 邊界）。

### 必須由使用者實機驗證的部分

harness 沒有登入 session，以下只能請使用者在真的 manager 裡確認：

1. 登入中的 `/c/<id>` 頁面按 Copy Markdown 有沒有東西（哪一層來源命中，console 會印）
2. 切換到另一個對話（SPA 導航）後再按一次，是不是匯出新的那個
3. 「貼 share URL」流程
4. Tampermonkey 與 Violentmonkey 各跑一次（sandbox 行為不同，`unsafeWindow` 是風險點）

## 不做的事

- 不寫 DOM scrape fallback（理由如上）。
- 不動 `docs/`：這次不新增教學檔，也不改兩張目錄表。
- 不碰 `@match` 以外的網域（不加 `chat.openai.com`）、不加 `@connect`。
