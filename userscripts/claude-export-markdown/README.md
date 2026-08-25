# Claude Export Markdown

把一整段 Claude 對話匯成 Markdown，格式跟
[`chatgpt-export-markdown`](../chatgpt-export-markdown/) 一致（仿 SpecStory 的 chat history），
目的是**貼給 coding agent**（Claude Code / Codex / Cursor…）當作前情提要。

- **生效網站**：`https://claude.ai/*`（`/chat/<id>` 與 `/share/<id>`）
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/claude-export-markdown/claude-export-markdown.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`claude-export-markdown.user.js`](./claude-export-markdown.user.js)

## 它做了什麼

右下角一顆 **⇩ Export MD**，點開有四個動作：

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | 完整 transcript（YAML frontmatter + `_**User**_` / `_**Assistant**_`）進剪貼簿 |
| Copy Agent Handoff | 同上，但前面多一段給 agent 的指示 |
| Download .md | 同 transcript，存成 `claude-<標題>-<時間>.md` |
| Download .json | 原始對話 JSON，之後要重新 render / 建索引用 |

外加兩個開關（預設關，會記住）：**含 thinking / reasoning**、**含工具呼叫與搜尋結果**。
預設輸出就是最乾淨的問答本文。

按鈕**可以直接拖到畫面上任何位置**（滑鼠、觸控都行），位置會記住；
面板會自動判斷該往上還是往下開。想放回右下角就用選單的 `Reset button position`。

同樣的動作在 manager 的選單裡也各有一個。

## 資料是從哪來的

Claude 的 share 頁在載入時會打一次

```text
GET /api/chat_snapshots/<id>?rendering_mode=messages&render_all_tools=true
```

回來的 JSON 就是完整對話：`chat_messages[]`，每則有 `sender`、`content[]`
（`text` / `thinking` / `tool_use` / `tool_result`）、`created_at`。
**裡面是模型原本吐出的 raw markdown**，不是從 HTML 反推回來的，所以 code fence、表格、
清單都是原樣。登入中的 `/chat/<id>` 走的是
`/api/organizations/<org>/chat_conversations/<id>`，格式一樣。

腳本用 `@run-at document-start` 攔 `fetch`，接住頁面自己那一次回應。

## 為什麼只有「攔截」這一條路

`chatgpt-export-markdown` 有四層 fallback，這支只有兩層，是實測後砍掉的：

| 試過的做法 | 結果 |
| --- | --- |
| 頁面載完後自己再打一次同一個 API | **Cloudflare 403**（"Just a moment"） |
| 從別的 claude.ai 分頁打那個 API | **403** |
| 同源 iframe 載入 share 頁再讀它 | 被導去 `/api/challenge_redirect`，**403** |
| 從 `window` 上找頁面留下的副本 | 找不到：TanStack Router 的 match 沒有 loaderData、`__PUBLIC_VIEWER_PRELOAD__.responses` 在 hydration 後被清空、React Query 的 cache 關在 module closure 裡 |

也就是說 **Claude 只放行「頁面自己在載入時發的那一次請求」**。
所以按鈕失敗時的正解就是**重新整理那一頁再按一次**（腳本的錯誤訊息也是這樣寫的）。

自己打 API 那層還是留著——不同網路環境的 Cloudflare 判定不一樣，登入中的
`/chat/<id>` 也可能過——但不要指望它。

**攔不到時它會明白報錯，不會退回去 scrape DOM。**
殘缺的 transcript 比沒有 transcript 更糟——agent 不會知道少了什麼。

## 貼 share URL 是「開新分頁」而不是就地匯出

因為上面那張表，貼上別的 share URL 沒辦法在目前這頁讀到內容。
所以面板的輸入框（與選單的 `Export from share URL…`）做的是：

1. 把「等一下要匯出哪個 share」寫進 GM storage（兩分鐘後過期）
2. `GM_openInTab` 開那一頁
3. 新分頁的腳本自己攔到資料後**自動複製到剪貼簿**，並把結果顯示在面板上

## 已知限制

- 靠的是 Claude 的私有 API 與頁面行為，改版就可能失效
  （見 [`docs/06`](../../docs/06-sandbox-and-unsafewindow.md)）。
- **沒攔到就要重新整理**：如果腳本是在頁面載完之後才被注入（剛裝好、剛更新），
  第一次按會失敗。
- 只匯出目前這條 branch，編輯／重生過的其他分支不會混進來。
- citation 的欄位名只在沒有搜尋結果的對話上驗證過；帶 web search 的對話會把
  `citations[]` 整理成段末的 **Sources** 清單，欄位對不上時不會爆掉，只會少那份清單。
- 附件 / 圖片只列檔名，不會下載檔案。
- 用 `@require` 引入 [`shared/`](../../shared/)，所以安裝時多一個
  raw.githubusercontent.com 的網路相依。

## 測試

`npm run preview` 是 `document-idle` 注入的，**攔截那層在 harness 裡測不到**
（見 [`docs/13`](../../docs/13-playwright-vs-userscript.md)），
所以它只能證明「腳本載得起來、選單有註冊、UI 掛得上」：

```bash
npm run preview -- claude-export-markdown "https://claude.ai/login"
```

真正的驗證要在裝好 manager 的瀏覽器裡開一個 share 或對話頁按下去。
