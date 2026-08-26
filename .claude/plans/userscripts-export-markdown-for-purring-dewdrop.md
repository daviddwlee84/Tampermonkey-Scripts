# gemini-export-markdown

## Context

這個 repo 已經有四支 `*-export-markdown` 腳本（ChatGPT / Claude / Copilot / M365 Copilot），
目的都一樣：把整段對話轉成 Markdown，貼給 coding agent 當前情提要。
現在要補上 Gemini（<https://gemini.google.com/>）。

使用者指出 share page 與聊天進行中的界面長得不一樣，需要特別處理 —— 這點成立，
但**主要差異其實不在 DOM，而在資料從哪個 RPC 來**。以下是實測（Playwright + curl 打
`https://share.gemini.google/S91ylHxDs2Ug`）確認過的事實：

| 事實 | 意義 |
|---|---|
| `share.gemini.google/<code>` 會 302 到 `gemini.google.com/share/<id>` | `@match` 只要 `https://gemini.google.com/*`，短網址網域不用列 |
| 初始 HTML 完全沒有對話內容（只有 Angular 殼 `<chat-app-orchestrator>`） | 沒有 `__NEXT_DATA__` 之類的東西可撈，一定要走 RPC 或 DOM |
| 資料來自 `POST /_/BardChatUi/data/batchexecute`，body 是 `)]}'` + 長度前綴 + `[["wrb.fr","<rpcid>","<JSON string>"]]` | 攔截點就是這個 URL |
| **payload 裡的 assistant 內容是原始 Markdown**，不是 HTML | API 路徑完全不需要 HTML→Markdown 轉換，品質遠勝掃 DOM |
| share 用 `rpcids=ujx1Bf`，body 是 `f.req=[[["ujx1Bf","[null,\"<shareId>\",[4]]",null,"generic"]]]`，**匿名 curl 直接重放成功**（無 cookie、無 `at` token） | share 頁可以自己發請求，不必靠攔截 |
| 匿名 share 頁的 `WIZ_global_data` 沒有 `SNlM0e`（`at` token），但有 `cfb2h`（`bl`）與 `FdrFJe`（`f.sid`） | 自發請求的參數湊得出來 |
| `npm run preview` 是在 `domcontentloaded` **之後**才注入腳本 | `@run-at document-start` 的攔截層在 preview 裡永遠不會生效，只有 self-fetch 與 DOM 路徑測得到 |

實測解出來的 payload 結構（`inner = JSON.parse(row[2])`）：

```text
inner[0][1]              → turns 陣列
  turn[0]                → ["c_<conversationId>", "r_<responseId>"]
  turn[2][0][0]          → 使用者這輪的文字
  turn[3][0]             → 候選草稿陣列，每個是 ["rc_<id>", ["<markdown>"], …]
  turn[3][4] / turn[3][5]→ 工具呼叫（youtube_tool …）
  turn[3][0][0][12]      → structured content（畫面渲染用的鏡像，匯出不需要）
  turn[3][0][0][30]      → 附件／引用來源（YouTube 影片 metadata 等）
inner[0][2]              → [true, "<title>", …, [2,"<modelId>","Flash"], true]
inner[0][3]              → "<shareId>"
inner[0][4]              → [<epoch seconds>, <nanos>]
```

決定：**API 優先，全部失敗才退回掃 DOM 並在輸出裡標明「可能不完整」**（比照
`m365-copilot-export-markdown`）；toggles 用 `includeThinking` / `includeTools`，
另加第三個 `includeDrafts` 匯出同一輪的其他候選草稿。

## 檔案

新增：

- `userscripts/gemini-export-markdown/gemini-export-markdown.user.js`
- `userscripts/gemini-export-markdown/README.md`

修改：

- `README.md`（只透過 `npm run index` 重產腳本清單表格）

`shared/chat-export.js` 與 `shared/export-ui.js` 直接 `@require` 沿用，**不要改動**
（改了會影響已上線的四支腳本，而且 manager 會 cache `@require`）。

## 建立方式

```bash
npm run new -- gemini-export-markdown "Gemini Export Markdown" "https://gemini.google.com/*" \
  "把整段 Gemini 對話匯成 Markdown（含 share 頁），貼給 coding agent 用"
```

再把 body 換掉。scaffolder 會填好 `@updateURL` / `@downloadURL` 與
`scripts/lib/icon.mjs` 產生的 data: URI icon。

## Metadata

比照 `copilot-export-markdown`：

```js
// @match        https://gemini.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @require      …/shared/chat-export.js
// @require      …/shared/export-ui.js
```

`document-start` 是必要的：`fetch` / `XHR` 要在 Angular 發出第一個 batchexecute 之前就換掉。
`unsafeWindow` 是因為有任何 `@grant` 就會被 sandbox，patch `window.fetch` 打不到頁面。
`GM_openInTab` / `GM_deleteValue` 供 share URL 換頁 handoff（同 claude / copilot）。
`@grant` 全在 `check-meta.mjs` 的 `PORTABLE_GM` 裡，不會有 warning。

`page-title-tag` 已經 match `https://gemini.google.com/*`，兩支共存沒問題。

## 程式結構

沿用四支腳本共通的骨架與註解分節，常數：

```js
const VERSION = '0.1.0';
const NS = 'gemini-export-md';
const EXPORTER = `gemini-export-markdown v${VERSION}`;
const BATCH_RE = /\/_\/BardChatUi\/data\/batchexecute/;
const SHARE_RPC = 'ujx1Bf';
```

### 1. batchexecute 解析（本腳本最核心的新東西）

```js
/** batchexecute 回應是 `)]}'` + 「長度行 + JSON」重複。長度是位元組數不是字元數，
 *  中文會對不上，所以不要照長度切 —— 直接掃平衡括號比較穩。 */
function parseBatchExecute(body) { … }   // → 每個 ["wrb.fr", rpcid, payloadString] 的 JSON.parse 結果
```

實作要點（都是實測踩到的）：

- 先 `body.replace(/^\)\]\}'\s*/, '')`。
- 用 quote/escape-aware 的括號平衡掃描找出每個 top-level `[…]`，逐個 `JSON.parse`，
  失敗就跳過（長度行本身會 parse 失敗，正常）。
- 取 `row[0] === 'wrb.fr' && typeof row[2] === 'string'` 的 `JSON.parse(row[2])`。

### 2. Turn 抽取：認 id 前綴，不要寫死索引

比照 `copilot-export-markdown` 的 `findMessageList()` 精神 —— 深掃 + shape 判斷，
但錨點換成 Gemini 那組語意穩定的 id 前綴（`c_` / `r_` / `rc_`），因為純索引路徑
（`[0][1][0][3][0][0][1][0]`）一改版就死：

```js
const isTurn = (v) =>
  Array.isArray(v) && Array.isArray(v[0]) &&
  /^c_/.test(v[0][0] || '') && /^r_/.test(v[0][1] || '');

const isDraft = (v) =>
  Array.isArray(v) && /^rc_/.test(v[0] || '') &&
  Array.isArray(v[1]) && typeof v[1][0] === 'string';
```

- `collectTurns(payload)`：深掃（限深度，帶 `seen` Set 防環）收集所有 `isTurn` 節點，
  以 `turn[0][1]`（`r_…`）去重。
- 每個 turn：
  - user：`turn[2][0][0]`，取不到就在 `turn[2]` 裡找第一個非空字串。
  - assistant：在 `turn[3]` 裡深掃 `isDraft`，第一個是畫面顯示的那版；
    `includeDrafts` 打開時其餘的接在後面，加 `**Draft 2**` 之類的小標。
  - thinking（`includeThinking`）：payload 若有 thinking 字串就帶上；
    **這份 share 樣本沒有 thinking，所以要寫成「找不到就靜靜略過」而不是丟錯**。
  - tools / sources（`includeTools`）：`turn[3][4]` / `turn[3][5]` 的工具名稱，
    以及 `turn[3][0][0][30]` 底下的附件 metadata，整理成 `{title, url}` 丟給
    `shared/chat-export.js` 的 `sourcesBlock()`。
  - **不要**碰 `turn[3][0][0][12]`（structured content）—— 那是渲染鏡像，會重複內文。
- 未知型態不要靜默丟掉：照 chatgpt 的慣例，退回 `jsonFence(...)` 保留原始資料。

### 3. 來源優先序（`resolveConversation`）

| # | 來源 | 說明 |
|---|---|---|
| 1 | 網路攔截 | `document-start` patch `fetch` + `XMLHttpRequest`，命中 `BATCH_RE` 就把 response 文字丟給 `parseBatchExecute` 存起來。**一定要 `response.clone()`**，body 只能讀一次。patch 上掛 `__geminiExportPatched` 保證 idempotent。 |
| 2 | self-fetch（share 頁）| `/share/<id>` 時自己 POST `rpcids=ujx1Bf`，`f.req=[[["ujx1Bf","[null,\"<shareId>\",[4]]",null,"generic"]]]`，headers 只需 `content-type: application/x-www-form-urlencoded;charset=UTF-8` 與 `x-same-domain: 1`。`bl` 讀 `WIZ_global_data.cfb2h`、`f.sid` 讀 `FdrFJe`（讀不到就從攔到的 request URL 抄，再不行就省略）。**這是 preview 唯一測得到的 API 路徑。** |
| 3 | 等攔截 | 比照 copilot 的 `waitForCapture(ids, { timeout: 8000, interval: 200 })`，處理 RPC 比使用者按按鈕晚回來的情況。 |
| 4 | 掃 DOM（標明可能不完整）| 見下節。 |

`app` 頁沒有可靠的自發請求路徑（載入歷史的 rpcid 只能從攔截學到，猜不得），
所以 app 頁的保底就是第 4 條。

### 4. DOM 退路：share 與 app 兩套版面

實測 selector（share 頁已驗；app 頁用同一組內層節點，只有外層容器不同）：

```js
const LAYOUTS = [
  { name: 'share', turn: 'share-turn-viewer' },                     // /share/<id>
  { name: 'app',   turn: '.conversation-container, user-query' },   // /app/<id>
];
const USER_SEL = 'user-query-content .query-content';
const MODEL_SEL = 'message-content .markdown, message-content .markdown-main-panel';
```

- 先試 `share-turn-viewer`（每個節點內含一組 user + response），沒有再退 app 版面。
- **`.cdk-visually-hidden` 一定要剔掉**：`.query-content` 裡有一個
  `<h5 class="cdk-visually-hidden">You said …</h5>` 把使用者文字整段重複了一次，
  不剔會出現兩份。
- HTML→Markdown 直接搬 `m365-copilot-export-markdown.user.js` 的
  `nodeToMarkdown(node, depth)` / `htmlToMarkdown(el)`（約 130 行，repo 裡唯一的轉換器；
  `shared/` 刻意不放 DOM 相關東西，照 `shared/README.md` 的「三支以上才抽共用」規則，
  這是第二支，複製而不是抽共用）。噪音 selector 換成 Gemini 的：

  ```js
  const DOM_NOISE_SELECTOR = [
    '.cdk-visually-hidden',        // "You said" 螢幕閱讀器標籤，會讓提問重複兩次
    'mat-icon', 'gem-icon', 'gem-icon-button',
    'button', '[role="button"]', '[aria-hidden="true"]',
    '.code-block-decoration',      // code block 的語言列 + 複製/下載鈕
    'script', 'style', 'svg',
  ].join(', ');
  ```

- `nodeToMarkdown` 要多認兩個 Gemini custom element：`response-element` 與 `link-block`
  是純包裝（裡面就是 `<a>`），落到 `default:` 遞迴 children 即可，不用特判；
  但 `code-block` 要在剝掉 `.code-block-decoration` 之後，語言標記從那顆 header 的
  文字取（Gemini 不用 `language-xxx` class）。
- **排掉自己注入的 UI**：`const ownRoot = document.getElementById(`${NS}-root`)`，
  兩條 DOM 路徑都要 `.filter((el) => !(ownRoot && ownRoot.contains(el)))`。
  這是 CLAUDE.md 點名截圖看不出來的 bug 類型。
- 走到這條時 `sourceLabel` 要寫成 `'Gemini（從畫面擷取，可能不完整）'`，
  `resolveConversation` 回 `source: 'dom-scrape (可能不完整)'`，讓面板狀態列也看得到。

### 5. normalize → shared 層

輸出 `shared/chat-export.js` 的 doc 契約，其餘（frontmatter、Agent Handoff 標頭、
連續同 role 合併、檔名）都由 `renderTranscript()` / `filenameFor()` 處理：

```js
{
  source: 'gemini',
  sourceLabel: 'Gemini',
  title: inner[0][2][1] || 'Gemini conversation',
  url: location.href,
  ids: { conversation_id: 'c_…', share_id: inner[0][3] || '' },
  model: inner[0][2][7]?.[2] || '',      // 例："Flash"
  createdAt: inner[0][4]?.[0],           // epoch 秒，toDate() 直接吃
  sections: [{ role: 'User' | 'Assistant', model, time, body }],
}
```

### 6. UI 與動作

`ACTIONS` / `createExportPanel` / `registerMenu` 照抄 copilot，只改三處：

- `buttonLabel: '⇩ Export MD'`（不變）
- `toggles` 多第三個：`{ label: '含其他候選草稿', get/set → includeDrafts }`，
  `SETTINGS_KEYS = ['includeThinking', 'includeTools', 'includeDrafts']`
- `shareInput.onSubmit = exportFromShareUrl`：`shareIdFromUrl()` 要同時吃
  `gemini.google.com/share/<id>` 與 `share.gemini.google/<code>`；後者無法在本地解析成
  真 id，走 `GM_openInTab` + `PENDING_KEY` 換頁 handoff（同 claude / copilot），
  新分頁載完由 `consumePending()` 自動複製。

`GM_registerMenuCommand` 不要加 `accessKey`（TM 限定）。

### 7. SPA / 啟動

照抄四支共通的 bootstrap：`installNetworkCapture()` → `registerMenu()` →
DOM ready 後 `start()`（`ui.mount()` + `consumePending()` + 用 `MutationObserver`
偵測 `location.href` 變化後重新 `ui.mount()`）。Gemini 換對話不 reload，
但抓資料不依賴 DOM 狀態，所以只要保證 UI 還在即可。

## README

比照 `userscripts/chatgpt-export-markdown/README.md` 的七節結構，Gemini 版要額外寫清楚：

- share 頁（`/share/<id>`）與 app 頁（`/app/<id>`）的資料來源差異，以及為什麼
  share 頁可以自發請求、app 頁不行
- payload 給的是原始 Markdown，所以 API 路徑的輸出比掃 DOM 準
- 掃 DOM 這條會在 frontmatter 的 `title` 與面板狀態列標明「可能不完整」
- `## 測試` 節放下面那行 preview 指令，並註明 preview 測不到攔截層

## 驗證

```bash
npm run check                 # metadata / grant 交叉比對
npm run index                 # 重產根 README 的腳本清單表格
npm run verify                # = check + index:check，等同 CI

# preview：share 頁走 self-fetch 路徑，--menu 把輸出印出來（CLAUDE.md 要求）
npm run preview -- gemini-export-markdown \
  "https://gemini.google.com/share/95f50d8e5390" --menu "Copy Markdown" --wait 20000
```

preview 通過的判準（不是看截圖，是看印出來的剪貼簿內容）：

1. frontmatter 有 `source: gemini`、`title: Theo 影片：AI Agent Skills 實測總結`、
   `model: Flash`、`share_id: 95f50d8e5390`、`messages: 2`
2. 使用者那輪是 `總結 https://youtu.be/0oXOOlqVu5M?is=DlFiMAP-nzOiYESR`，**只出現一次**
   （出現兩次＝走到 DOM 路徑而且沒剔掉 `.cdk-visually-hidden`）
3. assistant 那輪含 `### 核心精華與重點整理`、`* **\`unslop\`（去 AI 油膩感…`、
   `[[03:17](https://www.youtube.com/watch?v=0oXOOlqVu5M&t=197)]`
   —— 這些是 payload 的原始 Markdown，掃 DOM 生出來的長不一樣，可用來確認走的是哪條路
4. 輸出裡沒有 `⇩ Export MD`、`Copy Agent Handoff`、`繼續對話`、`Sign in` 等
   注入 UI 或站方 chrome 的字串

`--wait 20000` 不能省：self-fetch 是 async 的，harness 預設只等 300 ms 就收工。

無法在 preview 驗、需要使用者裝進真 manager 手動確認的：

- `@run-at document-start` 的攔截層（preview 在 `domcontentloaded` 後才注入）
- 登入狀態下的 `/app/<id>` 版面（Playwright 無法登入）
- `GM_setClipboard` / `GM_openInTab` 的真實行為
- 有 code block、表格、Canvas / Deep Research 的對話（手邊樣本沒有）

最後：**`@version` 要記得往上加**，否則改動不會送到任何機器。
