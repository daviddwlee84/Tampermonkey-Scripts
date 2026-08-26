# M365 Copilot Chat Export Markdown

## ⚠️ 這支是實驗性的

**完全沒有在真實 M365 Copilot 帳號上跑過**，隨時可能整支不能用。開發者手上沒有
M365 Copilot 授權，沒辦法自己實測；下面的「怎麼幫忙驗證」是打通這支腳本唯一的路。

把一整段 Microsoft 365 Copilot Chat 對話匯成 Markdown，格式跟
[`chatgpt-export-markdown`](../chatgpt-export-markdown/) 一致（仿 SpecStory 的 chat history），
目的是**貼給 coding agent**（Claude Code / Codex / Cursor…）當作前情提要。

- **生效網站**：`https://m365.cloud.microsoft/*` 與 `https://copilot.cloud.microsoft/*`
  （先假設兩者共用同一套前端行為；**尚未驗證是否真的共用同一套後端 API**，如果回報顯示
  不一樣會拆成兩支腳本）
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`m365-copilot-export-markdown.user.js`](./m365-copilot-export-markdown.user.js)

## 跟 `copilot-export-markdown` 的關係

Microsoft 有兩個完全不同的 Copilot 產品：

| 網域 | 產品 | 腳本 |
| --- | --- | --- |
| `copilot.microsoft.com` | 消費版 Copilot | [`copilot-export-markdown`](../copilot-export-markdown/) |
| `m365.cloud.microsoft` / `copilot.cloud.microsoft` | Microsoft 365 Copilot Chat（個人版／for organization） | 這支 |

之前誤把 `copilot.cloud.microsoft` 加進消費版腳本的 `@match`，使用者實測後確認那其實是
「for organization」網域、API 完全不同，已經改回來、另外拆成這支。

## 它做了什麼

右下角一顆 **⇩ Export MD (實驗性)**，點開有五個動作：

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | 完整 transcript（YAML frontmatter + `_**User**_` / `_**Assistant**_`）進剪貼簿 |
| Copy Agent Handoff | 同上，但前面多一段給 agent 的指示 |
| Download .md | 同 transcript，存成 `m365-copilot-<標題>-<時間>.md` |
| Download .json | 攔到的原始 JSON |
| **Copy Diagnostics** | 這次頁面存活期間攔到的每個 JSON 回應的 `{url, status, top-level keys}`（不含內容） |

外加兩個開關（預設關，會記住）與貼 share 連結的輸入框。

## 資料是從哪來的

**主要來源：攔截（跟 chatgpt / claude / copilot 三支同一個模式）**。`@run-at document-start`
攔 `fetch` 與 `XMLHttpRequest`，**不限定 URL host**——把攔到的每個 JSON 回應丟進形狀辨識
（找「元素同時有 author/sender/role 與 content/text 的最長陣列」），不管網站實際上打的是
哪個 endpoint 都攔得到，因為攔截是包一層 `window.fetch`，跟目標 API 在哪個網域無關。

**次要 fallback（只覆蓋「登入中查看自己的歷史紀錄」，share 連結用不到）**：從公開專案
[ganyuke/copilot-exporter](https://github.com/ganyuke/copilot-exporter)（MIT license）的
build 產物反推出來的真實 API：

```text
GET https://substrate.office.com/m365Copilot/GetConversation?request={"conversationId":…}
→ { chatName, createTimeUtc, updateTimeUtc, conversationId,
    messages: [{ messageId, author: 'user'|'assistant', createdAt|timestamp, text,
                 adaptiveCards?, references? }] }
```

citation 是 `adaptiveCards[0].body[0].text` 裡的『【key】』全形括號 marker，對照
`references[key]`（`targetLink` 是 URL，`displayData.content` 是含 `label` / `Title` 的
JSON 字串）。

驗證要讀 MSAL（`@azure/msal-browser`）存在 `localStorage` 的**加密** token cache：
`msal.3.account.keys` 找帳號、`msal.3.token.keys.<clientId>`（clientId 固定
`c0ab8ce9-e9a0-42e7-b064-33d422df41f1`）找 scope 含
`https://substrate.office.com/sydney/.default` 的 token，配合 cookie
`msal.cache.encryption` 做 HKDF → AES-GCM 解密。這是 MSAL 自己的公開「cache encryption」
機制，不是漏洞——單純是讀使用者自己瀏覽器裡、自己帳號已登入的 token 來呼叫網站自己的
API，跟另外三支腳本讀 `Authorization` header 是同一類事情。

## share 連結需要登入才看得到

M365 Copilot Chat 的分享連結長這樣：

```text
https://m365.cloud.microsoft/chat/share/eyJzaGFyZUlkIjoi…（base64url）
```

base64 解出來是 `{"shareId":"…","conversationId":"…"}`——純前端路由參數，不是資料本身。
**跟 ChatGPT / Claude 的「匿名可看」不同，這個連結需要登入才看得到內容**（匿名開會被導去
`login.microsoftonline.com`），所以沒辦法在沒有帳號的情況下探到真正的 API 回應。
貼上別的 share 連結時，腳本跟 `claude-export-markdown` 一樣**開新分頁自動匯出**，
不會嘗試就地重打 API——目前沒有證據那樣行得通。

## 怎麼幫忙驗證（這是打通這支腳本唯一的路）

1. 開一個 M365 Copilot Chat 的對話（自己的歷史紀錄，或上面那種 share 連結），
   按 **Copy Diagnostics**，把結果貼給開發者。這一步最關鍵：能直接告訴我實際打了什麼
   API、回應長怎樣，不用手動翻 DevTools。
2. 如果 Diagnostics 顯示有攔到東西，再試 **Copy Markdown**，把結果（或錯誤訊息）回報。
3. Tampermonkey / Violentmonkey 各跑一次。

## 已知限制

- 完全沒有實測過；`GetConversation` + MSAL 解密那套只是有真實佐證的**猜測**，不保證能跑。
- share 連結沒有任何已知的直接呼叫方式，完全依賴攔截；攔不到就會老實報錯，不會假裝有資料。
- `copilot.cloud.microsoft` 與 `m365.cloud.microsoft` 是否真的共用同一套後端 API 未知。
- 靠的是私有 API 與 MSAL 內部快取格式（`msal.3.*`），Microsoft 改版就可能整支失效
  （見 [`docs/06`](../../docs/06-sandbox-and-unsafewindow.md)）。
- 不碰 M365 Copilot 的 WebSocket 即時對話協定，只處理歷史紀錄／分享的 REST 資料。
- 用 `@require` 引入 [`shared/`](../../shared/)，所以安裝時多一個
  raw.githubusercontent.com 的網路相依。

## 測試

`npm run preview` 對這個網域幾乎測不了：`m365.cloud.microsoft/*` 匿名開會被連續導向
`login.microsoftonline.com`（SSO 重導鏈），harness 的注入時序跟導頁會衝突。
已驗證過的是：

- `npm run check` / `npm run verify`（metadata、`@grant`、`@require` 都過）
- 語法檢查（`node --check`）
- 用 stub server 餵合成的 `GetConversation` 回應，驗證「攔截（不限 host）→ 形狀辨識 →
  normalize → render」整條鏈，以及 `Copy Diagnostics` 在有資料／沒資料時都輸出合理內容

真正的驗證要在登入後的瀏覽器裡按下去——見上面「怎麼幫忙驗證」。
