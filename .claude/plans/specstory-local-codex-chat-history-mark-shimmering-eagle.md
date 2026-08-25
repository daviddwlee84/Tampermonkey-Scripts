# Claude / Copilot 對話匯出 Markdown（＋把共用碼搬進 shared/）

## Context

`chatgpt-export-markdown` 已經上線（v1.1.0，可拖曳的浮動按鈕、SpecStory 風格 transcript、
Agent Handoff、raw JSON）。使用者現在要**同一套東西給 claude.ai 與 copilot.microsoft.com**：

- <https://claude.ai/share/fc04b1a4-0476-4782-b1eb-5aabfcbe1868>
- <https://copilot.microsoft.com/shares/Yc41Xon3iEp3yY86rFCw6>

目的一樣：把整段對話變成能直接貼給 coding agent 的 Markdown。

有了第三支 exporter，`shared/README.md` 自己訂的門檻（「同一段 code 出現在三支以上的腳本，
才值得搬進來」）剛好成立 → 這次順便把 render / 浮動 UI 搬進 `shared/`，三支都改用 `@require`。

### 實測到的事實（決定了兩支新腳本的架構）

用 headed Chrome（Playwright）對兩個 share 連結實測：

**claude.ai**

1. share 頁只打一次 API：`GET /api/chat_snapshots/<id>?rendering_mode=messages&render_all_tools=true`
   → 乾淨的 JSON：`chat_messages[]`，每則有 `sender: human|assistant`、`content[]`
   （block `type`：`text`（帶 `citations[]`）/ `thinking` / `tool_use` / `tool_result`）、
   `parent_message_uuid`、`index`、`created_at`，外層有 `snapshot_name`、`conversation_uuid`。
   比 ChatGPT 的 `mapping` 乾淨很多。
2. **同一個 endpoint 再打第二次一律 Cloudflare 403（"Just a moment"）** —— 從同頁 `fetch`、
   從別的 claude.ai 分頁 `fetch`、從同源 iframe 載入 share 頁，全部被擋。
   只有「頁面自己在文件載入時發的那一次」會過。
3. 頁面上**沒有留下**可讀的副本：`__TSR_ROUTER__`（TanStack Router）的 match 沒有 loaderData，
   `__PUBLIC_VIEWER_PRELOAD__.responses[url]` 在 hydration 後就被清成 undefined，
   React Query 的 cache 關在 module closure 裡。深掃 window 找 `chat_messages` 形狀：0 命中。
4. ⇒ **ChatGPT 那支的 tier 2/3/4（router state / 自己重打 API / 隱藏 iframe）在 Claude 全部不能用。**
   Claude 只剩一條路：`@run-at document-start` 攔截 `fetch`，接住頁面自己那一次成功的回應。
5. CSP 是 `frame-ancestors 'self'`（iframe 框得起來），但框進去的 share 頁會被導去
   `/api/challenge_redirect` → 所以「貼任意 share URL 就地讀取」在 Claude 做不到。

**copilot.microsoft.com**

6. 這台機器一度完全連不上（直連 `Connection reset`、proxy `SSL_ERROR_SYSCALL`）；換節點後
   proxy 可通、直連仍不通。**做這件事時要先確認 copilot.microsoft.com 連得上**。
7. 匿名開 `/shares/<id>` 會拿到「Sign in to Copilot」擋頁（`/c/api/start?features=anonymous-block-page`），
   看不到對話內容 → share 內容需要登入 session。
8. 從頁面 context 打各種 endpoint 的結果：
   `/c/api/shares/<id>` → **401**（存在，需要 auth）、
   `/c/api/conversations/<id>/history?api-version=2` → 403、
   `/c/api/conversations/<id>?api-version=2` → 460。
   ⇒ share 的門幾乎確定是 `/c/api/shares/<shareId>`，使用者登入後就有；
   **但它的回應 JSON 長怎樣我看不到**（401 沒有 body）。
9. 已知的 live chat 那條（來自公開的 Greasyfork exporter，只取用 API 事實、不抄它的程式碼）：
   頁面 `/chats/<chatId>` ＋ `GET /c/api/conversations/<chatId>/history?api-version=2`
   → `{ results: [{ author: { type: 'ai' | 'human' }, content: [ {type:'text'|'image'|'citation'|'chainOfThought'} ], createdAt }] }`，
   authorization 是 `Bearer <token>`（從網站自己的請求上攔）。

### 使用者已確認的取捨

- 共用碼**搬進 `shared/` 用 `@require`**（連帶要讓 `npm run preview` 看得懂 `@require`）
- Claude 的「貼任意 share URL」→ **GM_openInTab 開新分頁自動匯出**（就地讀取被 CF 擋死）
- Copilot 因為第 8 點的未知，採「**攔到什麼算什麼 + 找形狀**」的寫法，不預先把 endpoint 與
  欄位名綁死；第一版裝上去後由使用者回報 console log 再收斂

---

## 要做的事

### 0. 先把手上的東西收乾淨

工作區還有沒 commit 的 `chatgpt-export-markdown` v1.1.0（可拖曳按鈕）。
先補 README 的拖曳說明再 commit，不要跟這次的重構混在同一個 commit：

> 按鈕**可以直接拖到畫面上任何位置**（滑鼠、觸控都行），位置會記住；面板會自動判斷該往上還是往下開。
> 想放回右下角就用選單的 `Reset button position`。

### 1. `shared/` 兩個新模組

`@require` 進來的檔案在腳本 scope 直接執行（不是 ES module），所以一律用全域函式宣告，
寫法照 `shared/dom.js`。

**`shared/chat-export.js`** —— 純轉換，不碰 DOM、不碰 GM：

| 函式 | 用途 |
| --- | --- |
| `fence(body, lang)` | backtick-run 感知的 code fence（照搬 chatgpt 版，那個 bug 已經踩過） |
| `formatUtc(msOrIso)` / `localIso()` / `pad()` | 時間格式，對齊 `.specstory/history/` 的 `YYYY-MM-DD HH:mm:ssZ` |
| `renderTranscript(doc, opts)` | 吃**正規化後的 doc**，吐 SpecStory 風格 markdown（frontmatter → `# title` → `_**Role (model, ts)**_` 用 `---` 串） |
| `HANDOFF_HEADER` / `renderHandoff(doc, opts)` | Agent Handoff 變體（前綴文字改成吃 `doc.source` 的名字） |
| `mergeSections(sections)` | 連續同 role 合併 |
| `filenameFor(doc, ext)` | `<source>-<title slug>-<YYYYMMDD-HHmm>.<ext>` |
| `downloadText(name, text, mime)` | 不需 `@grant` 的 blob 下載 |

**正規化的 doc 形狀**（每支腳本的 adapter 負責產出，這是整個重構的介面）：

```js
{
  source: 'claude',            // frontmatter 的 source，也用在檔名與 handoff 標題
  title: '量化投资 vs 定投指数的选择',
  url: 'https://claude.ai/share/…',
  ids: { conversation_id: '…', share_id: '…' },   // 有什麼寫什麼
  model: '',                   // 沒有就空字串
  createdAt: '2026-08-23T12:34:14Z',
  sections: [{ role: 'User' | 'Assistant' | 'Tool (name)', model, time, body }],
}
```

**`shared/export-ui.js`** —— 浮動按鈕 + 面板 + 拖曳，從 chatgpt 版整段搬過來：
`createExportPanel({ ns, buttonLabel, actions, toggles, shareInput, storage })`。

- **GM API 不在這個模組裡呼叫**，storage 用注入的 `{ get, set }`。
  理由：`scripts/check-meta.mjs` 只掃腳本本體來交叉比對 `@grant`，
  GM 呼叫留在各腳本裡，`npm run check` 才驗得到。
- 回傳 `{ mount, openPanel, setStatus, resetPosition }`，讓各腳本接選單指令。
- 拖曳邏輯（pointer events、4px 門檻、`justDragged` 吃掉拖曳後那個 click、
  `placePanel` 自動翻上下左右、resize 重新夾回畫面）原封不動照搬，不要重寫。

同步更新 `shared/README.md` 的表格與那段「先考慮直接複製」的判準說明
（現在剛好是「三支以上」的例子，寫清楚為什麼這次搬了）。

### 2. `scripts/preview.mjs`：支援 `@require`

現在 harness 只 `addScriptTag` 腳本本身，`@require` 的內容不會被載入 → 一改成 `@require`，
這三支腳本就完全沒辦法用 preview 測。所以：

- 讀 metadata 的 `require` 陣列，依序注入到主腳本**之前**
- URL 若是本 repo 的 raw base（`rawUrlFor` 用的那個前綴），**改讀本機檔案**，
  這樣測到的是工作區沒 commit 的版本；其他 URL 就照原樣 `fetch`（失敗要明確報錯，不要靜默）
- console 印出每個 require 是從 local 還是 remote 來的

`scripts/check-meta.mjs` 加一條檢查：指向本 repo 的 `@require` 必須對得到存在的本機檔案
（打錯路徑會讓腳本裝上去直接壞掉，這是 check 抓得到的事）。

CLAUDE.md 的「測試腳本」段與 `docs/13-playwright-vs-userscript.md` 補一句
「`@require` 會被解析，本 repo 的走本機檔案」。

### 3. `userscripts/claude-export-markdown/`

```bash
npm run new -- claude-export-markdown "Claude Export Markdown" "https://claude.ai/*" \
  "把整段 Claude 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用"
```

metadata：`@run-at document-start`（**非有不可**，晚一步就攔不到那唯一一次成功的請求）、
`@grant unsafeWindow / GM_registerMenuCommand / GM_setClipboard / GM_setValue / GM_getValue /
GM_deleteValue / GM_openInTab`（全在 `PORTABLE_GM` 內）、兩個 `@require` 指到 `shared/`。

**取得資料（只有兩層，而且要讓失敗講人話）：**

1. `installNetworkCapture()`：patch `pageWin.fetch`，`response.clone().json()`，
   URL 命中 `/\/api\/(chat_snapshots|organizations\/[^/]+\/chat_conversations)\//` 就存進
   `Map<id, data>`。**一定要把原本的 response 還回去。**
2. fallback：自己打同一個 URL（登入中的 `/chat/<uuid>` 這條大概率會過；share 那條實測會被
   CF 403）。403 時的錯誤訊息必須是可行動的：
   「Claude 只放行頁面自己的第一次請求 —— 請**重新整理這一頁**再按一次。」
   **不要寫 DOM fallback**（理由同 chatgpt 版：寧可明白失敗，也不要吐殘缺的 transcript）。

**normalize（adapter）：**

- 取 thread：預設照 `index` 排序；`chat_messages` 有分支（同一個 `parent_message_uuid`
  出現多次）時，從最後一則沿 `parent_message_uuid` 往上走再 reverse，只留目前這條。
- `sender: human → User`、`assistant → Assistant`。
- block `type`：
  - `text` → 原文（**這就是模型吐出來的 raw markdown**），`citations[]` 非空時在段末補
    一份去重的 `- [title](url)` 來源清單（Claude 的 citation 是 index 區間，不是 ChatGPT 那種
    PUA sentinel，所以不需要 `applyCitations` 那套；實際欄位名要在拿到帶搜尋的樣本後確認，
    先寫成「有 `url` 就用，`title` 缺就拿 url 當標題」）
  - `thinking` → 受 `includeThinking` 控制（欄位優先序 `thinking` → `text` → `summaries[].summary`）
  - `tool_use` / `tool_result` → 受 `includeTools` 控制；`name` 當標題，`input` /
    `content` / `structured_content` 包 JSON fence
  - 未知 type → JSON fence，**不要靜默丟掉**
- `attachments[]` / `files[]` 有東西時列出檔名。
- frontmatter：`source: claude`、`title: snapshot_name`、`url`、`conversation_uuid`、
  `snapshot_uuid`、`created_at`、`exported_at`、`messages`、兩個 include 開關、`exporter`。

**貼 share URL → 開新分頁自動匯出：**

- 面板輸入框 / 選單 `Export from share URL…` 收到 URL → 取 `/share/<id>` →
  `GM_setValue('pendingExport', { shareId, mode, expires: Date.now() + 120_000 })` →
  `GM_openInTab(url, { active: true })`
- 腳本啟動時：若目前就在 `/share/<id>` 且 pending 的 `shareId` 對得上、也還沒過期 →
  先 `GM_deleteValue`（**一次性，先消耗再執行**，免得失敗時每次開頁都重跑），
  等攔截到資料後自動 copy 並在面板顯示結果。

### 4. `userscripts/copilot-export-markdown/`

```bash
npm run new -- copilot-export-markdown "Copilot Export Markdown" "https://copilot.microsoft.com/*" \
  "把整段 Microsoft Copilot 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用"
```

metadata 同 Claude 版（`document-start` + 同一組 grant + 兩個 `@require`）。

**取得資料 —— 因為 `/c/api/shares/<id>` 的回應形狀還沒看過，這裡刻意寫成「不綁死」：**

1. `installNetworkCapture()`：同時 patch `fetch` **與 `XMLHttpRequest`**（Copilot 兩種都可能用），
   URL 命中 `/\/c\/api\/(shares|conversations)\//` 就把 JSON 存起來，
   順便把請求上的 `Authorization: Bearer …` 記下來給第 2 層用。
2. fallback 直接打：在 `/shares/<id>` 打 `/c/api/shares/<id>`；在 `/chats/<id>` 打
   `/c/api/conversations/<id>/history?api-version=2`；打之前先 `POST /c/api/start`
   暖 session（公開 exporter 的做法，401 時值得再試一次）。帶 `credentials: 'include'`
   ＋（有攔到的話）`Authorization`。
3. **形狀辨識**（關鍵）：不假設 top-level key 是 `results`，而是深掃 JSON 找
   「元素同時有 `author`（或 `sender`）與陣列 `content` 的陣列」，取最長的那個當訊息列表。
   這樣 `/c/api/shares/<id>` 不管包成 `{results}`、`{messages}` 還是 `{conversation:{…}}` 都吃得到。
4. 匯出成功時 `console.log` 印出**命中的 URL 與 top-level keys**，
   README 也寫明「如果失敗，請把 console 這行與 Copy raw JSON 的內容回報」——
   這是把第 8 點那個未知收斂掉的手段。

**normalize：** `author.type: 'human' → User`、`'ai' → Assistant`；依 `createdAt` 排序；
part `type`：`text` → 原文、`image` → `![image](url)`（有 `prompt` 就補一行斜體 caption）、
`citation` → 收集成段末來源清單、`chainOfThought` → 受 `includeThinking` 控制、
其他 → JSON fence（受 `includeTools` 控制，避免預設輸出被雜訊淹掉）。

### 5. `chatgpt-export-markdown` 改用 shared/

刪掉本體裡的 render / UI / 拖曳段落，改成兩個 `@require` ＋ 一個把 ChatGPT JSON 轉成
正規化 doc 的 adapter（`buildThread` / `visibleMessages` / `textOf` / `applyCitations`
留在腳本裡，那些是 ChatGPT 專屬的）。`@version` → 1.2.0。

**不要動它現有的四層 fallback**，那是實測過的；這次只搬共用碼。

### 6. 兩份 README ＋ 索引

各自照 `userscripts/chatgpt-export-markdown/README.md` 的結構寫，並且**誠實寫下已知限制**：

- Claude：只吃頁面自己那一次請求，**沒攔到就要重新整理**；同源 iframe 與跨頁 fetch 被 CF 擋
  （所以貼 URL 是開新分頁）；靠 app 的私有 API，改版就可能壞。
- Copilot：share 內容需要登入；`/c/api/shares/<id>` 的欄位是靠形狀辨識吃進來的，
  遇到沒見過的形狀請回報 console log ＋ raw JSON。
- 兩支都只匯出目前這條 branch；`@require` 讓腳本多一個 raw.githubusercontent.com 的網路相依。

最後跑 `npm run index` 重新產生根 README 的腳本清單表格（**不要手改表格內容**）。

---

## 驗證

```bash
npm run check      # metadata、@grant 交叉比對、新增的 @require 本機解析檢查
npm run verify     # = check + index:check，等同 CI
npx prettier --check .

# harness 冒煙測（確認 @require 有被載入、腳本能跑、選單有註冊、沒有 pageerror）
npm run preview -- claude-export-markdown "https://claude.ai/login"
npm run preview -- copilot-export-markdown "https://copilot.microsoft.com/"
npm run preview -- chatgpt-export-markdown \
  "https://chatgpt.com/share/6a8d5801-10d8-83ec-b5e7-9d8dc54d48c6" \
  --menu "Copy Markdown" --wait 20000     # 重構後的回歸測，輸出要跟 v1.1.0 一致
```

harness 是 `document-idle` 注入，**攔截那層在 preview 裡測不到**（`docs/13` 已寫明）——
所以 Claude / Copilot 的 preview 只能證明「腳本載得起來、UI 掛得上」。

### 必須由使用者實機驗證（harness 沒有登入 session）

1. claude.ai `/share/<id>`：Copy Markdown 有沒有東西、來源顯示 `network-capture`
2. claude.ai 登入中的 `/chat/<uuid>`：同上，切換對話（SPA 導航）後再按一次是不是新的那個
3. claude.ai 貼 share URL → 是否開新分頁並自動複製
4. copilot.microsoft.com 登入後 `/shares/<id>` 與 `/chats/<id>` 各一次；
   **把 console 那行「命中的 URL 與 top-level keys」回報**，必要時附 Copy raw JSON 的結果
5. Tampermonkey 與 Violentmonkey 各跑一次（sandbox 行為不同，`unsafeWindow` 與 `@require` 都是風險點）
6. 改到的三支腳本都記得 `@version` 有加（TM 只認版本號）

## 不做的事

- 不寫 DOM scrape fallback（Claude / Copilot 都一樣：寧可明白失敗）
- 不合併成一支多站腳本（維持一支腳本一個 slug、`@match` 最小範圍）
- 不新增 `docs/NN-*.md`；只在 CLAUDE.md 與 `docs/13` 補 `@require` 那一句
- 不 push（要不要推到 GitHub 由使用者決定）
