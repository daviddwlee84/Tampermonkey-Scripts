# Copilot Export Markdown

把一整段 Microsoft Copilot 對話匯成 Markdown，格式跟
[`chatgpt-export-markdown`](../chatgpt-export-markdown/) 一致（仿 SpecStory 的 chat history），
目的是**貼給 coding agent**（Claude Code / Codex / Cursor…）當作前情提要。

- **生效網站**：`https://copilot.microsoft.com/*`（`/chats/<id>` 與 `/shares/<id>`）
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/copilot-export-markdown/copilot-export-markdown.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`copilot-export-markdown.user.js`](./copilot-export-markdown.user.js)

## 它做了什麼

右下角一顆 **⇩ Export MD**，點開有四個動作：

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | 完整 transcript（YAML frontmatter + `_**User**_` / `_**Assistant**_`）進剪貼簿 |
| Copy Agent Handoff | 同上，但前面多一段給 agent 的指示 |
| Download .md | 同 transcript，存成 `copilot-<標題>-<時間>.md` |
| Download .json | 原始對話 JSON |

外加兩個開關（預設關，會記住）：**含 thinking / reasoning**（Copilot 的 `chainOfThought`）、
**含工具呼叫與未知區塊**。按鈕可以拖到畫面上任何位置，位置會記住。

同樣的動作在 manager 的選單裡也各有一個。

## 資料是從哪來的

Copilot 自己的 API：

| 頁面 | endpoint |
| --- | --- |
| `/chats/<id>` | `GET /c/api/conversations/<id>/history?api-version=2` |
| `/shares/<id>` | `GET /c/api/shares/<id>` |

腳本用 `@run-at document-start` 同時攔 `fetch` 與 `XMLHttpRequest`，
接住網站自己發的那一次回應（順便記下 `Authorization: Bearer …` 給 fallback 用）；
攔不到才自己打一次（打之前會先 `POST /c/api/start` 暖 session，401 後會再試一次）。

**兩條路都不假設回應的 top-level key 叫什麼**：拿到 JSON 之後是**用形狀找訊息列表**——
深掃找「元素同時有 `author`／`sender` 與 `content` 的陣列」，取最長的那個。
所以 `{ results: […] }`、`{ messages: […] }`、`{ conversation: { messages: […] } }` 都吃得到。

會這樣寫是因為 `/c/api/shares/<id>` 的回應**沒辦法事先看到**：匿名開 share 頁只會拿到
「Sign in to Copilot」擋頁，直接打那個 endpoint 回 401（endpoint 存在，但要登入 session）。
形狀辨識是為了讓第一版就算沒看過真實樣本也不會整支壞掉。

### 如果它在你的 share 頁上失敗了

匯出成功時 console 會印一行：

```text
[copilot-export-markdown] using payload from /c/api/shares/xxx | top-level keys: [...]
```

**失敗的話請把 console 的 log 連同 Download .json 的內容回報**，
就能把 `/c/api/shares/<id>` 的真實形狀補成明確的對應，不必再靠猜。

## 已知限制

- **Copilot 有區域限制**：某些網路 / 地區直接連會拿到「Not available in your region」，
  那是網站層面的事，跟腳本無關。
- **share 內容要登入才看得到**：沒登入的話那一頁本身就只有 sign-in 擋頁，腳本也拿不到東西。
- `/c/api/shares/<id>` 的欄位對應是靠形狀辨識推出來的，還沒有真實樣本驗證過
  （`/chats/<id>` 那條的 `{ results: [{ author, content, createdAt }] }` 有公開資料佐證）。
- 靠的是 Copilot 的私有 API，改版就可能失效
  （見 [`docs/06`](../../docs/06-sandbox-and-unsafewindow.md)）。
- 沒見過的 part 型態預設不會進正文（避免整篇被雜訊淹掉），
  打開「含工具呼叫與未知區塊」才會以 JSON code block 原樣留著——**不會靜默消失**。
- 圖片只輸出 `![image](url)`，不會下載檔案。
- 用 `@require` 引入 [`shared/`](../../shared/)，所以安裝時多一個
  raw.githubusercontent.com 的網路相依。

## 測試

`npm run preview` 是 `document-idle` 注入的，**攔截那層在 harness 裡測不到**
（見 [`docs/13`](../../docs/13-playwright-vs-userscript.md)），
而且 Copilot 沒登入就沒有資料，所以它只能證明「腳本載得起來、UI 掛得上」：

```bash
npm run preview -- copilot-export-markdown "https://copilot.microsoft.com/"
```

轉檔那條鏈（攔截 → 找形狀 → normalize → render）是用 stub server 餵合成 payload 測的；
真正的驗證要在登入後的瀏覽器裡按下去。
