# Gemini Export Markdown

把整段 Gemini 對話（包含分享出去的 share 頁）匯成 Markdown。
目的是**貼給 coding agent**（Claude Code / Codex / Cursor…）當作前情提要，
所以輸出是 SpecStory 風格的 `_**User**_` / `---` / `_**Assistant**_`，
跟 `chatgpt-export-markdown`、`claude-export-markdown`、`copilot-export-markdown` 一致。

- **生效網站**：`https://gemini.google.com/*`
  （`share.gemini.google/<code>` 短網址會自動 302 到 `gemini.google.com/share/<id>`，所以也涵蓋到）
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/gemini-export-markdown/gemini-export-markdown.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`gemini-export-markdown.user.js`](./gemini-export-markdown.user.js)

## 它做了什麼

右下角會出現一顆可拖曳的 `⇩ Export MD`，點開有四個動作：

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | 整段對話的 Markdown，直接進剪貼簿 |
| Copy Agent Handoff | 同上，但前面多一段「這是先前的對話脈絡，請當成既有決策」的交接指示 |
| Download .md | 存成 `gemini-<標題>-<時間>.md` |
| Download .json | 存成原始 payload，形狀怪怪的時候用來回報 |

三個開關（會記在 GM storage 裡）：

- **含 thinking / reasoning**：把「顯示思考過程」的內容一起帶進來
- **含工具呼叫與來源**：附上 `youtube_tool` 之類的工具名稱，以及一份 `**Sources**` 清單
  （內文裡已經有的連結會濾掉，不重複列）
- **含其他候選草稿**：同一輪如果有多份候選回答，把畫面上沒顯示的那幾份也一起輸出

按鈕位置可以拖，會記住；要放回右下角用選單的 `Reset button position`。
面板下方那格可以貼**任意** Gemini share URL，會開新分頁、那邊載完自動複製回剪貼簿。

同樣的動作在 manager 的選單裡也各有一個。

拿到剪貼簿內容之後：

```bash
pbpaste > /tmp/chat-context.md
claude
# > Read @/tmp/chat-context.md first. Treat the decisions there as project context.
```

## 資料是從哪來的

Gemini 的初始 HTML 完全沒有對話內容，只有一個 Angular 殼，
所有東西都靠 `POST /_/BardChatUi/data/batchexecute` 回來的 RPC 塞進畫面。
好消息是 —— **那份 payload 裡 assistant 的內容就是原始 Markdown**，不是 render 過的 HTML，
所以走 API 完全不用做 HTML→Markdown 轉換，標題階層、巢狀清單、行內 `code`、
連結、`[03:17]` 時間戳全部原汁原味。

因此優先序是：

| # | 來源 | 適用 |
| --- | --- | --- |
| 1 | 攔截頁面自己的 `batchexecute` | share 頁與 app 頁都適用，`@run-at document-start` 換掉 `fetch` / `XHR` |
| 2 | 自己補打 `rpcids=ujx1Bf` | 只有 share 頁。這支 RPC **匿名就打得通**（不用 cookie、不用 `at` token） |
| 3 | 等攔截（最多 8 秒） | RPC 比你按按鈕晚回來的時候 |
| 4 | 掃畫面上的 DOM | 最後一條路，**會標明「可能不完整」** |

app 頁（`/app/<id>`）載入歷史用的是哪一支 rpcid 只能從攔截學到、猜不得，
所以 app 頁沒攔到就只剩第 4 條。

解析 payload 時錨在 `c_` / `r_` / `rc_` 這組語意穩定的 id 前綴上做形狀比對，
不寫死 `[0][1][0][3][0][0][1][0]` 這種索引路徑 —— 那種寫法 Google 一改版就死。

### share 頁跟聊天中的界面差在哪

差別主要在**資料從哪支 RPC 來**，不在畫面：

|  | share 頁 `/share/<id>` | app 頁 `/app/<id>` |
| --- | --- | --- |
| payload 容器 | `[null, <turns>, <meta>, "<shareId>", [<epoch 秒>, <奈秒>]]` | `[<turns>, null, null, []]` |
| 標題 | payload 的 meta 裡有 | **payload 裡完全沒有**，只能從畫面拿 |
| 型號 | meta 的 `[2, "<id>", "Flash"]` | 每輪 response 裡的 `"3 Flash"` |
| 建立時間 | 容器帶整段對話的 | 沒有，退回第一輪的時間戳 |
| 每一輪的容器（DOM） | `<share-turn-viewer>` | `.conversation-container` |
| 補打 RPC | 可以（`ujx1Bf`，匿名可用） | 不行 |
| 登入 | 不需要 | 需要 |

turns 在容器裡的位置兩邊不一樣（share 在 `[1]`、app 在 `[0]`），所以程式不寫死索引，
而是掃前幾格找「元素是 turn 的陣列」，meta / shareId / 時間固定跟在它後面三格 ——
app 那三格是 `null / null / []`，型別檢查會擋掉，不會生出假資料。

掃 DOM 那條路裡層的節點兩邊是同一組（`user-query-content .query-content` 與
`message-content .markdown-main-panel`），所以只有外層容器要分兩套。

## 幾個處理過的細節

- **`)]}' `+ 長度前綴**：batchexecute 的回應是「長度行 + JSON」重複，而那個長度是
  **位元組數不是字元數**，中文一多就對不上。所以這裡不照長度切，直接掃平衡括號，
  順便把沒帶 `rt=c` 的另一種框法也一起吃下來。
- **`.cdk-visually-hidden` 一定要剔掉**：`.query-content` 裡有一顆給螢幕閱讀器的
  `<h5>You said …</h5>`，把提問整段重複了一次，不剔掉輸出就會出現兩份一樣的問題。
- **Sources 去重**：payload 除了正文之外還躺著一份渲染用的 structured content 鏡像，
  不濾的話每個行內連結都會在 `**Sources**` 再列一次。已經在內文出現過的連結會被濾掉。
- **每一輪都有時間戳**：`turn[4]` 是 `[epoch 秒, 奈秒]`，share 與 app 兩種 payload 都有，
  所以每則訊息的抬頭都帶得出時間，不是只有整段對話一個 `created_at`。
- **型號認字樣不認索引**：app 頁把型號寫在 response 的某一格（實測是 `"3 Flash"`），
  位置會變，所以用字樣比對，順便擋掉同一層那些 `"JP"` / `"zh"` / 16 進位 id。
- **`document.title` 的前綴要剝掉**：本 repo 的 `page-title-tag` 會把標題改成
  `[Gemini] <標題>`。第一版直接用 `/gemini/i` 一刀切，結果把加了前綴的真標題也丟掉了，
  現在改成先剝前後綴再判斷剩下的還有沒有資訊量。
- **連續同 role 會合併**（`shared/chat-export.js` 的 `mergeSections`），
  不會變成一堆一行的區塊。
- **沒見過的形狀不靜默丟掉**：抓不到草稿時，打開「含工具呼叫與來源」會把原始 JSON
  留在輸出裡，方便回報。

## 已知限制

- 這支腳本吃的是 Google 前端的內部協定（rpcid、payload 陣列位置），
  **Google 改版就可能壞掉**。壞掉時 `Download .json` 的內容 + console 那行
  `using payload from … | rpcid: …` 就是修的線索。相關背景見
  [`docs/06-sandbox-and-unsafewindow.md`](../../docs/06-sandbox-and-unsafewindow.md)。
- **app 頁的標題只能從畫面拿**。那支載歷史的 RPC 完全沒有標題欄位（實測過整份 payload），
  所以退回側欄選中那條（`.selected [data-test-id="conversation-title"]`）與
  `document.title`。側欄那組 selector **沒有在登入狀態下驗過**，
  抓不到就退回 `Gemini conversation`。
- **thinking 這條沒有真樣本驗過**。手邊的兩份對話都沒有「顯示思考過程」，
  所以那段是照形狀猜的，而且**找不到就靜靜略過**，不會丟錯也不會硬塞東西進正文。
- **有 code block / 表格 / Canvas / Deep Research 的對話沒驗過**。
  API 那條路是原始 Markdown，理論上不受影響；掃 DOM 那條路的 code block 語言
  是從 `.code-block-decoration` 那顆 header 搬過來的，未經實測。
- 掃 DOM 那條路遇到很長的對話可能不完整（Gemini 會 virtualize），
  所以走到那條時 `sourceLabel` 會寫成「Gemini（從畫面擷取，可能不完整）」，
  面板狀態列也會顯示 `dom-scrape (可能不完整)`。
- 圖片只會留下 `![image](<url>)`，沒有把圖抓下來。
- 用了 `@require` 引入 `shared/`，等於多一個 raw.githubusercontent.com 的相依。

## 測試

```bash
npm run preview -- gemini-export-markdown \
  "https://gemini.google.com/share/95f50d8e5390" --menu "Copy Markdown" --wait 20000
```

`--wait` 不能省：補打 RPC 是 async 的，harness 預設只等 300 ms 就收工，
會在寫進剪貼簿之前結束。

preview 驗得到的是**第 2 條（補打 RPC）與第 4 條（掃 DOM）**。
第 1 條攔截層驗不到 —— preview 是在 `domcontentloaded` 之後才注入腳本，
`@run-at document-start` 在那裡永遠不會生效（邊界寫在
[`docs/13-playwright-vs-userscript.md`](../../docs/13-playwright-vs-userscript.md)）。
攔截層、登入狀態下的 app 頁、`GM_setClipboard` / `GM_openInTab` 的真實行為，
都要裝進真的 manager 才算數。
