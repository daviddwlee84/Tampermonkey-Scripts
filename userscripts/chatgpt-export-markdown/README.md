# ChatGPT Export Markdown

把一整段 ChatGPT 對話匯成 Markdown，格式仿 SpecStory 的 chat history，
目的是**貼給 coding agent**（Claude Code / Codex / Cursor…）當作前情提要。

- **生效網站**：`https://chatgpt.com/*`
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`chatgpt-export-markdown.user.js`](./chatgpt-export-markdown.user.js)

## 它做了什麼

右下角一顆 **⇩ Export MD**，點開有四個動作：

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | 完整 transcript（YAML frontmatter + `_**User**_` / `_**Assistant**_`）進剪貼簿 |
| Copy Agent Handoff | 同上，但前面多一段給 agent 的指示（把已定案的決策當既有前提、不要重開已解決的問題） |
| Download .md | 同 transcript，存成 `chatgpt-<標題>-<時間>.md` |
| Download .json | 原始對話 JSON，之後要重新 render / 建索引用 |

外加兩個開關（預設關，會記住）：**含 thinking / reasoning**、**含工具呼叫與搜尋結果**。
預設輸出就是最乾淨的問答本文。

按鈕**可以直接拖到畫面上任何位置**（滑鼠、觸控都行），位置會記住；
面板會自動判斷該往上還是往下開。想放回右下角就用選單的 `Reset button position`。

同樣的動作在 manager 的選單裡也各有一個，另外多一個 `Export from share URL…`：
貼上**任何** public share URL 就能匯出，不必先切過去那一頁。

典型用法：

```bash
pbpaste > /tmp/chat-context.md
claude
# > Read @/tmp/chat-context.md first. Treat the decisions there as project context.
```

## 為什麼不是「抓 DOM 轉 Markdown」就好

網路上的 console snippet 幾乎都長這樣：

```js
document.querySelectorAll('[data-message-author-role]'); // ← 這條路是死的
```

實測一段 **44 則**訊息的對話，DOM 裡同時只存在 **4 個** `[data-message-author-role]`——
ChatGPT 的訊息列表是 virtualized 的，捲過去的訊息會被回收。
所以 DOM 那條路先天就殘缺，而且 Markdown 是從已渲染的 HTML 反推回來的，
code fence、表格、citation 都可能失真。

這支腳本改抓 ChatGPT 自己的對話 JSON——裡面是**模型原本吐出的 raw markdown**。
取得順序（第一個成功的就用）：

| # | 來源 | 適用 |
| --- | --- | --- |
| 1 | `document-start` 時攔下網站自己發的 `/backend-api/conversation/<id>` 回應 | 登入中的 `/c/<id>` |
| 2 | 掃 `window.__reactRouterContext.state.loaderData` 找對話物件 | `/share/<id>` |
| 3 | 自己打 `/backend-api/conversation/<id>`（token 取自 `/api/auth/session`） | 登入中的 `/c/<id>` |
| 4 | 同源隱藏 iframe 載入 `/share/<id>` 再讀它的 router state | 貼上的任意 share URL |

第 4 條可行是因為 chatgpt.com 的 CSP 是 `frame-ancestors 'self' …`——同源框得起來。
（直接用 `fetch` 打 `/backend-api/share/<id>` 會被 Cloudflare 擋 403，所以那不能當主力。）

**四條都失敗時它會明白報錯，不會退回去 scrape DOM。**
殘缺的 transcript 比沒有 transcript 更糟——agent 不會知道少了什麼。

## 幾個處理過的細節

- **citation**：`\uE200cite\uE202turn0search1\uE201` 這種私有區 sentinel 會用同一則訊息的
  `metadata.content_references` 換成現成的 markdown 連結，例如 `([GitHub](https://…))`。
  換的時候是**按 index 換那一段**而不是全文 `replace`——因為 `sources_footnote` 型的
  `matched_text` 是「一個半形空白」，全文替換會把整篇的空白刪光。
- **合併同 role 的連續訊息**：一輪 assistant 常被拆成「開場白 → 搜尋 → 正文」好幾則。
- **只匯出目前選中的那條 branch**，編輯／重生過的分支不會混進來。
- **未知的 content_type**（Deep Research、canvas 之類的新東西）會以 JSON code block
  原樣留著，不會靜默消失。

## 已知限制

- 靠 `__reactRouterContext` 這種 app internals，ChatGPT 改版就可能失效
  （見 [`docs/06`](../../docs/06-sandbox-and-unsafewindow.md)，那裡把這列為最脆弱的一層）。
  選它是因為更穩的那層（DOM）根本拿不到完整資料。壞掉的徵兆是按鈕跳「抓不到對話資料」。
- 只在 share 頁做過端到端驗證（`npm run preview`）。登入中的 `/c/` 走的是第 1/3 條路，
  沒有登入 session 的 harness 驗不到，得實機確認。
- Deep Research 報告目前沒有真實樣本可驗；官方本來就有 Download → Markdown，混合的
  對話建議兩邊都留一份。
- 圖片只輸出 `![image](<asset_pointer>)` 佔位，不會下載檔案。
- 從 v1.2.0 起，render 與浮動 UI 搬到 [`shared/`](../../shared/) 用 `@require` 引入
  （跟 claude / copilot 兩支共用），所以安裝時多一個 raw.githubusercontent.com 的網路相依。

## 測試

```bash
npm run preview -- chatgpt-export-markdown \
  "https://chatgpt.com/share/<id>" --menu "Copy Markdown" --wait 20000
```

`--wait` 不能省：抓資料是 async 的，harness 預設只等 300ms。
