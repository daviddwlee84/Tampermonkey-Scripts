# claude-export-markdown：支援 Claude Code on the web（`/code/session_…`）

## Context

使用者在 `https://claude.ai/code/session_01KMYy…` 按匯出，三次都報
「抓不到對話資料…請重新整理」，重新整理也沒用。

根因不是 Cloudflare，而是**頁面類型根本沒支援**：

- `currentIds()`（`claude-export-markdown.user.js:204`）只認 `/chat/<uuid>` 與 `/share/<id>`，
  在 `/code/session_…` 兩者都是 `null`。
- `CAPTURE_URL`（`:78`）只攔 `chat_snapshots` / `chat_conversations`；Claude Code web 走的是
  `/v1/...sessions...` 系列 API（console 裡看得到 `/v1/code/sessions/watch`），什麼都沒攔到。
- `pickCaptured` 在兩個 id 都是 null 時只接受 `captured.size === 1` → null；
  `fromApi` 沒有任何 path 可打（所以 console 連 `api fallback failed` 都沒有）→ 丟出誤導性的錯誤。

目標：在 Claude Code web session 頁也能 Copy / Download Markdown、Agent Handoff、JSON；
不支援的頁面要給正確的錯誤訊息而不是叫人 reload。

## 做法

所有改動在 `userscripts/claude-export-markdown/claude-export-markdown.user.js`（+ README）。

### 0. 先確認 API 形狀（實作第一步，不猜）

Claude Code web 的 endpoint／分頁欄位／event 結構沒有文件。先加一段 **debug capture log**：
攔到任何 `/v1/` 開頭、`content-type` 為 JSON 的回應時，log `URL + status + 頂層 keys + 第一筆 item 的 keys`
（SSE / `text/event-stream` 一律不 clone，避免卡住串流）。請使用者裝上後在 session 頁 reload，
貼回 console 輸出；據此把下列步驟中的 URL pattern 與欄位名定死。
預期（依 `session_` id 格式推測，待驗證）：`GET /v1/sessions/<id>`（metadata/title）與
`GET /v1/sessions/<id>/events?...`（分頁，`data[]` + `has_more` / `last_id`），
event 為 Claude Code SDK message（`type: user|assistant|system|result`，`message.content[]`
是標準 Messages API block：`text` / `thinking` / `tool_use` / `tool_result`）。

### 1. 路由辨識

`currentIds()` 多回傳 `codeSessionId`：`location.pathname.match(/^\/code\/(session_[0-9A-Za-z]+)/)`。

### 2. 攔截（沿用 `installNetworkCapture` 的 fetch patch）

- 新增 `CODE_SESSION_URL` regex（依步驟 0 結果），命中且非串流時 clone → json →
  `rememberCodeSession(sessionId, url, payload)`：
  - metadata 回應存到 `codeSessions.get(id).meta`
  - events 頁依 event uuid 去重合併到 `codeSessions.get(id).events`（SPA 下會多次分頁／增量載入）
- 同時記下頁面該次請求用的 `init.headers`（例如 `anthropic-version`、`x-organization-uuid`
  之類），給步驟 3 重放用。
- 若步驟 0 顯示頁面用 XHR，參考 `gemini-export-markdown.user.js:268` 的 XHR patch 加上。

### 3. 主動補抓

`fromApi` 增加 code session 分支：用步驟 2 記下的 headers 重打 events endpoint，
沿分頁游標走到底（攔截可能只拿到最近一頁，長 session 一定要補齊）；metadata 一併取。
失敗時 log 每個 path 的 status。

### 4. 正規化 → 共用 `renderTranscript`

新增 `normalizeCodeSession({ meta, events }, ctx, opts)`，輸出 `shared/chat-export.js` 定義的 doc：

- `source: 'claude-code'`、`sourceLabel: 'Claude Code'`、title 取 meta 的 title、`ids.session_id`
- 依時間／順序走 events：`user` 文字 → User section；`assistant` 的 `message.content[]` 直接餵現有
  `blockToText`（thinking / tool_use 開關沿用）；只含 `tool_result` 的 user event 視為工具輸出，
  `includeTools` 關閉時略過、開啟時併入 Assistant 側
- `system` / `result` 事件略過（不吐 JSON 雜訊）
- `mergeSections` 會自動合併連續同 role 段落

`resolveConversation` / `doExport` 依 `codeSessionId` 分派到這條路；JSON 模式輸出 `{ meta, events }`。

### 5. 錯誤訊息

- 不在 `/chat`、`/share`、`/code/session_` 的頁面：「這個頁面不是對話頁」
- code session 抓不到：明說「沒攔到 session events」並附 console 提示，不再說 Cloudflare 只放行第一次

### 6. 收尾（CLAUDE.md 必做）

- `@version` 與 `VERSION` 常數 → `1.1.0`
- `@description` 補上 Claude Code → 跑 `npm run index`
- README：新增 Claude Code web 一節（endpoint、分頁、已知限制）
- `npm run verify`

## 驗證

1. `npm run verify` 通過。
2. `npm run preview -- claude-export-markdown` 用一個本機 fixture（`page.route` 回放步驟 0 取得的
   events JSON 樣本，去識別化）跑 `--menu "Copy Markdown"`，檢查剪貼簿輸出的段落、tool 開關、分頁合併。
3. 使用者在真實 Tampermonkey 中：`/code/session_…` reload 後按 Copy Markdown / Download .json；
   順便回歸 `/chat/<uuid>` 與 `/share/<id>` 仍正常。
