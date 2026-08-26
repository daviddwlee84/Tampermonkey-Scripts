# 修正 Copilot @match ＋ M365 Copilot Chat 實驗性腳本

## Context

上一輪加了 `@match https://copilot.cloud.microsoft/*` 到 `copilot-export-markdown`，
以為那是消費版 Copilot 換了網域。使用者實測後確認：**`copilot.cloud.microsoft` 是他們公司帳號
用的「for organization」網域**，跟這支腳本鎖定的消費版 `copilot.microsoft.com` 是不同產品、
不同 API——那個 `@match` 是誤加，要改回來。

同時使用者測到另一件事：**`m365.cloud.microsoft`（個人版 M365 Copilot）有公開分享連結**，
例如：

```text
https://m365.cloud.microsoft/chat/share/eyJzaGFyZUlkIjoiZTU2N2EzZTItYzhiMC00MTI2LWI4ZjAtZjVhZjUwNGYyNjM4IiwiY29udmVyc2F0aW9uSWQiOiIxMjRlMjhiMS02ZWE0LTQzZmUtYjMzNy01ZDNlYjAyN2YzNTQifQ%3D%3D
```

（base64 解出來是 `{"shareId":"...","conversationId":"..."}`——純前端路由參數，不是資料本身）。

使用者說「for organization」與「個人版」的 UI 蠻像，**可以先假設兩者結構一致**，
除非真的需要各自呼叫底層 API 才分開實作。

### 查證到的事實

1. **這個 share 連結需要登入才看得到內容**：用 headless/headed Chrome 開它，
   會被導去 `login.microsoftonline.com`（`Sign in to your account`），跟 ChatGPT / Claude
   的 share 頁「匿名就能看」完全不同——沒辦法在沒有帳號的情況下探到真正的 API 回應。
2. 查到一個公開專案 [ganyuke/copilot-exporter](https://github.com/ganyuke/copilot-exporter)
   （MIT license），瞄準「登入中檢視自己的對話歷史」這個情境（不是 share 連結），從它的
   build 產物反推出一套**真的在用的 API**：
   - `GET https://substrate.office.com/m365Copilot/GetChats?request=<json>&variants=<...>`
     → `{ chats: [{ conversationId, chatName, createTimeUtc, updateTimeUtc, ... }] }`
   - `GET https://substrate.office.com/m365Copilot/GetConversation?request={"conversationId":...}`
     → `{ chatName, createTimeUtc, updateTimeUtc, conversationId, messages: [{ messageId,
       author: 'user'|'assistant', createdAt|timestamp, text, adaptiveCards?, references? }] }`
   - citation 是 `adaptiveCards[0].body[0].text` 裡的 `【key】` marker，對照
     `references[key].targetLink`（URL）與 `references[key].displayData.content`
     （JSON 字串，含 `label` 序號、`Title`）
   - 驗證方式很重：token 存在 MSAL（`@azure/msal-browser`）的**加密 localStorage cache**，
     要讀 `msal.3.account.keys`、`msal.3.token.keys.<clientId>`（clientId 固定
     `c0ab8ce9-e9a0-42e7-b064-33d422df41f1`），配合 cookie `msal.cache.encryption`
     做 HKDF → AES-GCM 解密才能拿到明文 token。這是 MSAL 自己的公開機制（不是漏洞），
     純粹是讀使用者自己瀏覽器裡、自己帳號已登入的 token 來呼叫網站自己的 API。
   - 這條路是「歷史紀錄」情境驗證過的做法，**不確定 share 連結走不走同一組 API**——
     分享頁面很可能是另一個 endpoint（例如某種 `GetSharedConversation`），目前沒有證據。
3. Microsoft 365 Copilot 還有一條完全不同的 **WebSocket** 即時對話協定
   （`wss://substrate.svc.cloud.microsoft/m365Copilot/Chathub/...`），跟這裡要讀的
   「歷史紀錄／分享」REST 資料是兩回事，不用碰。

### 這次的設計決策：以「攔截」為主，不要賭 API 形狀

因為 share 連結需要登入、而且不確定它的 API 跟 `GetConversation` 是不是同一套，
**最穩的做法是照抄 `chatgpt-export-markdown` / `claude-export-markdown` /
`copilot-export-markdown` 一致的架構**：`document-start` 攔截頁面自己發出的
`fetch` / `XMLHttpRequest`，用「形狀辨識」找訊息列表（不假設 host 或 top-level key），
不管網站實際上打的是 `substrate.office.com` 還是別的 endpoint 都攔得到——因為攔截是在
`window.fetch` 這一層做的，跟目標 API 在哪個網域無關（不受同源限制，因為是頁面自己發的
跨網域請求，我們只是包一層再呼叫原本的）。

`GetConversation` ＋ MSAL 解密那套只當作**次要 fallback**（給「登入中自己的對話」這個
情境用，不含 share），因為那條路已經有真實佐證、值得寫；但 share 連結目前**沒有已知的
直接呼叫方式**，所以 share 情境完全依賴攔截，攔不到就老實報錯。

### 「Copy Diagnostics」：拿掉對 MSAL 細節的猜測，直接讓攔截層說話

不去用一個只回報 MSAL cache 狀態的診斷指令（上一版的想法），改成**把攔截到的每一個 JSON
回應的 `{url, status, top-level keys}`（不含任何內容）都記下來**，一鍵複製。
這樣不管使用者是開 share 連結還是自己的對話紀錄，只要按一次 `Copy Diagnostics`，
我就能直接看到「真正打了哪個 API、回應長什麼形狀」，不必用力去猜。

---

## 要做的事

### 1. 修正 `copilot-export-markdown` 的 `@match`

- 拿掉 `// @match https://copilot.cloud.microsoft/*`（該檔第 9 行）
- `@version` 1.1.0 → 1.2.0
- `README.md` 的「生效網站」改回只列 `copilot.microsoft.com`，補一句撤回原因：
  「`copilot.cloud.microsoft` 是 M365 for organization 用的網域，跟這支鎖定的消費版是
  不同產品、不同 API，之前誤加已移除；M365 Copilot Chat 另外用
  `m365-copilot-export-markdown` 處理（實驗性）」

### 2. 新腳本 `userscripts/m365-copilot-export-markdown/`

```bash
npm run new -- m365-copilot-export-markdown "M365 Copilot Chat Export Markdown" \
  "https://m365.cloud.microsoft/*" \
  "【實驗性】把 Microsoft 365 Copilot Chat 對話匯成 Markdown，貼給 coding agent 用——尚未經真實帳號驗證"
```

`@match` 同時列 `https://m365.cloud.microsoft/*` 與 `https://copilot.cloud.microsoft/*`
（使用者說先假設兩者結構一致；攔截層本來就不綁 host，這樣寫沒有額外風險）。

metadata：`@run-at document-start`、`@grant unsafeWindow / GM_registerMenuCommand /
GM_setClipboard / GM_setValue / GM_getValue / GM_deleteValue / GM_openInTab`（share 連結
需要登入，跟 Claude 版一樣用「開新分頁自動匯出」，不假設能就地重打 API）、
兩個 `@require` 指到 `shared/`。

檔頭註解要老實寫清楚：兩個網域、share 連結需要登入才看得到、目前完全沒有在真實帳號上
跑過、`GetConversation` 那套 fallback 的出處與只覆蓋「登入中歷史紀錄」而非 share。

**主要來源：攔截（跟其他三支同一個模式）**

- `installFetchCapture()` / `installXhrCapture()`：**不限定 URL host**，攔到的每個 JSON
  回應都丟進 `findMessageList()`（沿用 `copilot-export-markdown.user.js` 裡的深掃邏輯：
  找「元素同時有 author/sender/role 與 content/text 的最長陣列」）
- 同時把**每一個**攔到的 JSON（不只是命中形狀的）記進一份輕量的 log
  （`{url, status, keys: Object.keys(json)}`，不含內容），供 `Copy Diagnostics` 用

**次要 fallback：登入中歷史紀錄（有真實佐證，share 用不到）**

- `getMsalAccount()` / `getEncryptionCookie()` / `decryptToken()` / `getAccessToken()`：
  照查到的演算法實作（HKDF → AES-GCM，clientId 寫死
  `c0ab8ce9-e9a0-42e7-b064-33d422df41f1`，cache key 前綴 `msal.3.*`）
- `fetchConversationHistory(token, oid, tenantId, conversationId)` 打
  `substrate.office.com/m365Copilot/GetConversation`
- 這條路任何一步失敗都要拋出講人話的錯誤，而且**只在攔截完全沒抓到東西、又是登入中的
  對話（不是 share 連結）時才嘗試**，避免對 share 連結做出錯誤假設

**normalize（adapter）**：

- 訊息 → sections：角色欄位可能是 `author.type` / `author`（字串）/ `sender` / `role`，
  照 `copilot-export-markdown.user.js` 的 `roleOf()` 那套寬鬆判斷
- 內文優先用 `adaptiveCards?.[0]?.body?.[0]?.text`，`【key】` citation marker 對照
  `references[key]` 換成 `[n]` ＋ 段落末來源清單（用 `shared/chat-export.js` 的
  `sourcesBlock()`，欄位對到 `{url: targetLink, title: Title}`）；沒有 adaptive card
  就退回 `text` 欄位
- 完全辨認不出的訊息形狀：留 JSON fence，不要靜默丟掉（跟另外三支一致的原則）

**貼 share URL**：跟 Claude 版一樣的「開新分頁自動匯出」模式（`GM_setValue` 交棒 +
`GM_openInTab` + 新分頁自己攔截）——不要嘗試在原地重打 API，目前沒有證據那樣行得通。

**Copy Diagnostics**：選單指令＋面板按鈕，把「這次頁面存活期間攔到的每個 JSON 回應」
（`url` / `status` / top-level keys，不含內容）整理成一段文字複製到剪貼簿；
沒攔到任何東西時也要說清楚（而不是空字串）。

### 3. README

比照其他三支的結構，開頭用明顯的「⚠️ 實驗性」區塊，講清楚：

- 兩個網域（`m365.cloud.microsoft` 個人版、`copilot.cloud.microsoft` for organization）
  目前假設共用同一套前端行為，尚未驗證是否真的共用同一套後端 API
- share 連結需要登入才看得到內容，跟 ChatGPT / Claude 的「匿名可看」不同
- 主要靠攔截；`GetConversation` + MSAL 解密只是「登入中歷史紀錄」的 fallback，
  且完全沒有實測過
- 使用方式：不管是打開 share 連結還是自己的對話，先按 `Copy Diagnostics` 貼給開發者，
  再視情況試 `Copy Markdown`

### 4. 索引

跑 `npm run index` 重新產生根 README 的腳本清單表格（不要手改）。

---

## 驗證

```bash
npm run check
npm run verify
npx prettier --check .

npm run preview -- m365-copilot-export-markdown "https://m365.cloud.microsoft/chat/"

# 回歸測，確認沒動到既有兩支
npm run preview -- copilot-export-markdown "https://copilot.microsoft.com/"
npm run preview -- chatgpt-export-markdown \
  "https://chatgpt.com/share/6a8d5801-10d8-83ec-b5e7-9d8dc54d48c6" \
  --menu "Copy Markdown" --wait 20000
```

`npm run preview` 只能證明「腳本載得起來、選單有註冊」——沒有登入態不可能測到真實資料。

### 必須由使用者驗證（這是打通這支腳本唯一的路）

1. 開那條 share 連結（登入後），按 `Copy Diagnostics`，把結果貼回來——
   **這一步最關鍵**：能直接告訴我 share 連結實際打了什麼 API、回應長怎樣
2. 有機會的話也在自己的對話歷史（`https://m365.cloud.microsoft/chat/` 或
   `https://copilot.cloud.microsoft/...`）按一次 `Copy Diagnostics` 與 `Copy Markdown`
3. Tampermonkey / Violentmonkey 各跑一次

拿到 Diagnostics 的回報後，下一步是把 `findMessageList` / `normalize()` 對準真實形狀微調，
必要時把 `copilot.cloud.microsoft` 與 `m365.cloud.microsoft` 拆成兩支腳本
（如果回報顯示兩者 API 真的不一樣）。

## 不做的事

- 不碰 WebSocket 即時對話協定（`Chathub`），只處理歷史紀錄／分享的 REST 資料
- 不在沒有真實回報前，把 share 連結的 fallback 寫成好像已知可行的樣子——
  目前只有攔截這條路有把握
- 不在沒有真實帳號驗證前，把這支腳本包裝成「可以用」；README 與 `@description`
  都要老實掛「實驗性」
- 不 push（由使用者決定）
