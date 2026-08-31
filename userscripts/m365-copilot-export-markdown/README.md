# M365 Copilot Chat Export Markdown

## ⚠️ 這支是實驗性的

已經在真實帳號上持續實測（見下面各次紀錄）。v0.12.0 修正「`GetConversation` 已回傳
37 筆完整原始資料，但單筆 WebSocket frame 搶先勝出，最後只匯出 1 筆」的問題。登入中的
歷史對話現在會真正優先走 API；API 不可用或 share 頁面才退回 capture／**直接讀畫面上
render 出來的內容**。DOM fallback 代表：

- 匯出的內容**可能不完整**——如果訊息列表是 virtualized 的，沒 render 出來的抓不到。
  輸出會標示「從畫面擷取，可能不完整」，但腳本沒辦法自己知道少了幾則。
  **長對話請先整串捲到最上面再匯出。**
- 靠的是 M365 Copilot 的 class 名稱（`fai-UserMessage` / `fai-CopilotMessage`），
  Microsoft 改版就可能失效；失效時會退回通用啟發式，再不行就老實報錯。
  抓歪時 `Copy Diagnostics` 會列出掃到的候選節點群組，回報那個就能重新對準。

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
| **Copy Diagnostics** | 這次頁面存活期間攔到的每個 JSON 回應的 `{url, status, shape}`（只有 key 名稱與型別，不含任何內容），外加 fallback／DOM 掃描的嘗試紀錄 |

外加兩個開關（預設關，會記住）與貼 share 連結的輸入框。

## 資料是從哪來的

> **v0.8.0 起實際能用的是第 3 條（讀畫面）**：前兩條在真實帳號上都試過了；
> v0.11.0 確認 `GetConversation` 可回完整原始訊息，v0.12.0 進一步修正單筆 WebSocket
> capture 搶先返回的 regression。登入中的歷史對話現在優先走 API；失敗才退回 capture／DOM。

**來源 1：攔截（跟 chatgpt / claude / copilot 三支同一個模式）**。`@run-at document-start`
攔 `fetch` 與 `XMLHttpRequest`，**不限定 URL host**——把攔到的每個 JSON 回應丟進形狀辨識
（找「元素同時有 author/sender/role 與 content/text 的最長陣列」），不管網站實際上打的是
哪個 endpoint 都攔得到，因為攔截是包一層 `window.fetch`，跟目標 API 在哪個網域無關。

**來源 2（只覆蓋「登入中查看自己的歷史紀錄」，share 連結用不到）**：從公開專案
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
`https://substrate.office.com/sydney/v2/.default` 的 token，配合 cookie
`msal.cache.encryption` 做 HKDF → AES-GCM 解密。這是 MSAL 自己的公開「cache encryption」
機制，不是漏洞——單純是讀使用者自己瀏覽器裡、自己帳號已登入的 token 來呼叫網站自己的
API，跟另外三支腳本讀 `Authorization` header 是同一類事情。

token 有兩個來源（依可信度）：**攔頁面自己跟 `login.microsoftonline.com` 換 token 的
回應**（裡面就有明文 `access_token` 與 `scope`，不用解密），以及上面那套 MSAL cache
解密。實測確認真正的 scope 是 `https://substrate.office.com/sydney/v2/.default`
（有 `v2/`），cache key 用 `|` 分隔。token 只留在記憶體，不會進 diagnostics 或剪貼簿。

**來源 3（v0.8.0 新增，現在是 fallback）：直接讀畫面上 render 出來的內容**。
把訊息節點的 HTML 轉回 Markdown（code fence／清單／表格／連結／粗體都有處理），
並移除 code widget 常見的 gutter／行號節點，
排除腳本自己注入的 UI。這條路排在最後，而且輸出會標示
**「從畫面擷取，可能不完整」**——virtualized 列表可能讓部分訊息沒 render 出來。
細節與已驗證的範圍見下面「第七次真實測試」。

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

## 第一次真實測試（v0.2.0，2026-08-26）

使用者在自己登入中的 `m365.cloud.microsoft/chat/conversation/<id>` 頁面上跑了一次：

- **UI／攔截機制本身沒問題**：面板正常掛載、`Copy Diagnostics` 正確攔到 42 筆 JSON 回應。
- **`Copy Markdown` 匯出出來的是垃圾**：只有一則
  `Assistant: Execute action succeeded`——這其實是
  `substrate.office.com/m365Copilot/EventListener/Client?EventId=ExecuteAction`
  這個 telemetry 回應被形狀辨識誤判成「一則訊息」，不是真正的對話內容。
- 42 筆 diagnostics 裡**沒有任何一筆長得像「取得對話訊息」的回應**——都是 telemetry
  （`/events`、OneCollector）、設定（ECS Fluid config、search userconfig）、
  Graph 特殊資料夾、Fluid Framework loader manifest 之類。這代表 M365 Copilot Chat
  的即時對話內容很可能**不是走一般 fetch/XHR JSON**，而是走檔頭註解提過的 WebSocket
  BizChat 協定（`wss://substrate.svc.cloud.microsoft/m365Copilot/Chathub/...`），
  或是 Fluid Framework 的即時協作同步（診斷裡出現的
  `res.cdn.office.net/fluid/prod/generic-loader/...manifest...json` 與
  `ecs.office.com/config/v1/Fluid/...` 是這個假設的佐證）——這兩者都是攔 `fetch`/`XHR`
  完全看不到的傳輸層。
- 也確認了一個網址格式的認知落差：真實頁面走的是 `/chat/conversation/<uuid>`，
  之前的 `currentIds()` 只認得 `/chat/share/<...>`，導致 `conversationId` 一直是
  `null`、`GetConversation` fallback 根本沒機會被嘗試。

**這次已經修的兩個 bug**：

1. `currentIds()` 補上 `/chat/conversation/<id>` 的解析。
2. `findMessageList()` 收緊：要求候選訊息額外有 `messageId`/`id`/`createdAt` 之類的
   識別欄位、跳過 `telemetry`/`instrumentation` 這幾個 key 底下的內容、
   `EventListener`/`OneCollector`/`/events` 這類 URL 直接排除在形狀辨識之外——
   同時也修了 `Copy Diagnostics` 遇到超大扁平字典回應（上千個 key）時輸出爆量的問題。

**還沒解的**：如果真正的對話走 WebSocket 或 Fluid 同步，光靠攔 `fetch`/`XHR`
本質上看不到內容，這支腳本的核心策略對「即時查看自己的對話」這個情境可能就是不可行——
需要再跑一次 `Copy Diagnostics` 確認上面兩個修正有沒有讓誤判消失，並且麻煩檢查瀏覽器
Network 分頁裡同一個 session 有沒有 `wss://` 開頭的連線，才能確認是不是真的要另外攔
WebSocket。

## 第二次真實測試（v0.3.0，2026-08-26）

同一個 session 再跑一次，這次攔到 35 筆：

- **誤判修好了**：這次沒有再匯出「Execute action succeeded」那種垃圾，腳本老實回報
  「抓不到對話資料」——代表上一輪的兩個修正有效。
- **35 筆裡還是沒有任何一筆長得像對話內容**，但多了一個線索：出現了好幾筆 URL 是空字串、
  `keys (2): [store, __queryState]` 的回應。追查後發現這其實是**攔截層自己的 bug**：
  頁面用 `fetch(new URL(...))` 呼叫時，程式碼只認得 `input.url`（`Request` 物件才有這個
  屬性），`URL` 物件其實是 `.href`，所以這幾筆的 `url` 一直被記成空字串——已修好。
  `store` / `__queryState` 這個組合很像前端框架（React Query / RTK Query 之類）的
  client-side store 序列化，**很可能是目前為止最有希望藏著對話資料的候選**，
  但目前的 `keys` 只看得到最外層兩個 key，看不出裡面長怎樣。
- 為了在不洩漏對話內容的前提下往裡面多看幾層，`Copy Diagnostics` 從「只列 top-level
  key」升級成 **`shape`**：巢狀 key 名稱／型別（`string`/`number`/`array(N)`/`object`）
  的樹狀結構，最多五層、陣列只展開第一個元素當樣本——完全不含任何字串值本身。

**這次修的**：

1. `fetch` 攔截修正 `URL` 物件的 `url` 判斷（之前漏掉，導致這幾筆網址是空字串）。
2. `Copy Diagnostics` 從「top-level keys」升級成五層深的 `shape` 摘要。

**下一步**：麻煩在同一個對話上**再跑一次 `Copy Diagnostics`**——這次 `store` /
`__queryState`（以及所有空 URL 的回應）應該會有正確的網址、而且能看到裡面的巢狀結構，
這樣才知道對話訊息到底是不是真的藏在 `store` 底下、藏在哪一層、欄位叫什麼名字。
如果 `shape` 顯示 `store` 底下確實有一個訊息陣列，下一步就是把 `findMessageList()`
對準那個真實形狀調整；如果還是沒有，才需要認真考慮 WebSocket／Fluid 那條路。

## 第三次真實測試（v0.4.0，2026-08-26）

同一個 session 再跑一次，這次攔到 34 筆，`URL` 物件的修正生效了（`store`/`__queryState`
那幾筆這次有正確的網址）：

- **`store`/`__queryState` 是死路**：`url` 修好之後看到真正的網址是
  `https://m365.cloud.microsoft/chat?...`，`shape` 也攤開了——裡面是
  `conversationPageHistoryList.chats`，也就是**左側對話清單**（`conversationId`、
  `chatName`、`createTimeUtc`… 這種每個對話一筆的 metadata），不是這個對話裡的訊息。
- **意外撿到真正的訊息 schema**：`EventListener/Client?EventId=ExecuteAction`（那個
  之前誤判成假對話、後來被過濾掉的 telemetry 回應）這次用 `shape` 攤開後，裡面剛好有
  `data.messages: array(1)[{ status, executeActionResult, text, author, createdAt,
  timestamp, messageId, messageType, offense, responseCode }]`——這證實了檔頭註解裡
  從 `ganyuke/copilot-exporter` 反推的欄位命名（`messageId` / `author` / `text` /
  `createdAt`）猜對了，只是這個特定 endpoint 不是我們要的那個。
- **34 筆裡依然沒有任何一筆是「這個對話的訊息列表」**——三輪下來都一樣，加上
  `Chathub`（SignalR hub 常見命名）與 `bizchat` app version 的線索，現在傾向認為
  對話內容真的是走 WebSocket、不是 fetch/XHR 能看到的 JSON API。

**這次加的**：不再只等使用者手動去 DevTools 的 Network → WS 分頁看，腳本直接
**patch `WebSocket`**，把攔到的每個 frame 一樣拆開（SignalR 的 JSON Hub Protocol
用 `\x1e` 分隔同一個 frame 裡的多筆訊息）丟進同一套形狀辨識／`Copy Diagnostics`，
跟 `fetch`/`XHR` 那兩條路共用邏輯，不用另外實作。

**下一步**：再跑一次 `Copy Diagnostics`——如果對話內容真的走 WebSocket，這次應該會
出現 `[ws] wss://...` 開頭的條目，`shape` 就能直接看到訊息長怎樣；如果還是沒有，
代表要嘛連 WebSocket 都不是（也許是 Fluid Framework 的二進位同步協定，這個沒辦法用
JSON.parse 攔，只能看到 `binaryFrame: true, bytes: N`），要嘛這個對話本身就是純
SSR/hydration 埋在初始 HTML 裡、載入後不再額外請求——那種情況攔截這條路本質上就
攔不到，必須另外想辦法（例如讀頁面自己的 in-memory store/DOM）。

## 第四次真實測試（v0.5.0，2026-08-26）

再跑一次 `Copy Diagnostics`（沒有另外按 `Copy Markdown`），這次攔到 35 筆——
**完全沒有出現任何 `[ws] wss://...` 條目**。

這件事本身是個很有用的負面訊號。追查後發現一個之前沒注意到的盲點：**`Copy
Diagnostics` 只回報「被動攔到的網路回應」，不會觸發 `Copy Markdown` 才會用到的
MSAL / `GetConversation` fallback**——三輪下來 diagnostics 裡都沒出現
`GetConversation`，不代表那條路失敗了，而是**根本沒被嘗試過**，因為使用者一直只按
`Copy Diagnostics`。而 fallback 失敗時原本只有 `console.log`，`Copy Diagnostics`
也看不到，等於這條路徑完全是黑箱。

沒有 `[ws]` 條目本身有兩種可能：(a) 這個 conversation 頁面只是**查看歷史**，
Chathub／SignalR 這類即時連線可能只在「主動傳訊息、等串流回覆」時才建立，單純看歷史
不會開；或 (b) 連線是在 iframe／Worker 裡建立的，我們在最外層 `unsafeWindow` 上
patch 的 `WebSocket` 建構子看不到。目前無法只憑這次資料分辨是哪一種。

**這次修的**：

1. `Copy Diagnostics` 現在會**自己 best-effort 跑一次 MSAL fallback**（不拋錯、
   不影響剪貼簿內容），這樣單按一次就能同時看到「攔截到的東西」跟「fallback 到底有
   沒有被嘗試、失敗在哪一步」，不用再另外按 `Copy Markdown` 或開 DevTools console。
2. MSAL 帳號／token 取得失敗、`GetConversation` 呼叫本身丟例外，這兩種情況現在都會
   多記一筆 `[fallback] ...` 進 diagnostics（只有錯誤訊息，不含 token 內容）。

**下一步**：再跑一次 `Copy Diagnostics`。這次應該會出現一筆 `[fallback] ...` 的條目
（不管成功或失敗），才能真的知道 MSAL 這條路走到哪一步卡住——如果卡在「MSAL
帳號/token 取得失敗」，八成是 cache key 格式或 scope 猜錯；如果走到
`GetConversation` 卻拿到非 2xx，至少能看到真正的錯誤 shape。

## 第五次真實測試（v0.6.0，2026-08-26）

上一輪的修正生效了——diagnostics 裡第一次出現 `[fallback]` 條目，而且指出了**確切的
卡點**：

```text
[fallback] MSAL 帳號/token 取得失敗
  token cache 裡沒有 scope 含 https://substrate.office.com/sydney/.default 的 token
```

這是好消息：MSAL 帳號找到了、`msal.3.token.keys.<clientId>` 也讀到了、解密那段也走到了
——整條路只卡在**寫死的 scope 字串對不上 cache 裡任何一把 token**。也就是說
`sydney/.default` 這個 scope 是猜錯的（那是消費版 Bing/Sydney 的命名，M365 這邊顯然
不是用這個）。

同時注意到一件之前忽略的事：diagnostics 裡一直有這筆——

```text
200  https://login.microsoftonline.com/.../oauth2/v2.0/token?...client_id=c0ab8ce9-...
  shape: { token_type: string, scope: string, ..., access_token: string, refresh_token: string, ... }
```

**頁面自己就在換 token，而且那個回應裡就有明文 `access_token` 跟它的 `scope`**——
與其去猜 MSAL 的 cache key 格式、猜 scope 命名、再做 HKDF/AES-GCM 解密，直接接住這個
回應穩得多，而且我們本來就已經攔到它了。

**這次改的**：

1. **新增 token 來源：攔截 `oauth2/v2.0/token` 的回應**，直接拿明文 `access_token`。
   token 只存在記憶體裡給 `GetConversation` 用，**不會進 diagnostics 或剪貼簿**
   （那邊只記 key 名稱與型別，不記值）。
2. **MSAL cache 的 scope 比對從「寫死一個」改成分層**：先找原本那個 scope、
   再找任何含 `substrate.office.com` 的、最後退到「隨便拿一把」。
3. **把 cache 裡實際有哪些 scope 記進 diagnostics**（scope 是權限字串、不是 token
   本身，不會外洩 secret）——下一輪就知道該對準什麼。
4. **一把 token 被打回票（401/403）就換下一把再試**，而不是第一把不對就整條路斷掉；
   每一把試的結果（來源 + HTTP status + 回應 shape）都會記進 diagnostics。

**下一步**：再跑一次 `Copy Diagnostics`。這次會看到 `GetConversation` 真正被呼叫的
結果（帶 HTTP status 與回應 shape），以及 `[fallback] MSAL token cache 裡實際有的
scope` 那一筆。如果 `GetConversation` 回 2xx 而且 shape 裡有 `messages` 陣列，
那就成了，剩下只要把 `normalize()` 對準；如果回 401/403，就從那筆 scope 清單挑對的
scope 再調。

## 第六次真實測試（v0.7.0，2026-08-26）

這輪一次解開三件事：

- **token 拿到了，兩條路都通**。diagnostics 顯示 `GetConversation` 真的被呼叫了，
  代表「攔截到的 token」與「MSAL cache 解出來的 token」**兩個來源都成功產出 token**
  ——連 HKDF → AES-GCM 解密那段也是通的。整套 MSAL 機制的猜測到這裡算驗證完成。
- **真正的 scope 是 `https://substrate.office.com/sydney/v2/.default`**（多一段 `v2/`）。
  上一版寫死的 `sydney/.default` 少了這段，所以永遠對不上。這次回報的 scope 清單裡
  還看到帳號實際持有的其他 scope（`m365.cloud.microsoft/v2/.default`、
  `substrate.office.com/.default`、`graph.microsoft.com/.default`…），
  攔到的那把 token 本身就帶 `sydney/v2/.default` 與 `sydney/v2/sydney.readwrite`。
- **MSAL cache key 用 `|` 分隔，不是 `-`**：實際格式是
  `msal.3|{homeAccountId}|{environment}|accesstoken|{clientId}|{realm}|{target}|`。
  上一版的 key 解析假設是 `-`，所以 scope 欄位其實沒被切出來（回報裡看到的是整條
  完整 key）——已改成用 `|` 切。

**但 `GetConversation` 回了空 body**：

```text
[fallback] GetConversation 呼叫失敗（攔截到的 token（scope: .../sydney/v2/.default ...））
  shape: Failed to execute 'json' on 'Response': Unexpected end of JSON input
```

這裡有個**診斷程式自己的 bug**：原本是 `await res.json()` 之後才把 HTTP status 記進
diagnostics，所以 body 一空、`res.json()` 一丟例外，**status 就永遠沒被記下來**——
根本不知道是 401、403 還是 204。

**這次改的**：

1. 修正 scope 常數為 `sydney/v2/.default`，MSAL cache key 解析改用 `|` 分隔。
2. **先 `res.text()` 再自己 `JSON.parse`**，這樣空 body / 非 JSON 的情況都還是能把
   `HTTP status`、`statusText`、`content-type`、body 長度記進 diagnostics。
3. **加上 `GM_xmlhttpRequest` 當第二條 transport**：跨網域打 `substrate.office.com`
   又帶自訂 header（`x-anchormailbox`、`x-scenario`）一定會觸發 CORS preflight，
   「網站自己打得通」不代表我們的 `fetch` 打得通。GM_xhr 不受 CORS 限制。
   每一把 token 現在會分別用 `fetch` 與 `GM_xhr` 各試一次。
   （因此多了 `@grant GM_xmlhttpRequest` 與 `@connect substrate.office.com`。）

**下一步**：再跑一次 `Copy Diagnostics`。這次空 body 的情況會連 HTTP status 一起報出來，
而且如果先前是 CORS 擋住的，`GM_xhr` 那條應該會直接成功。

## 第七次真實測試 → 改走「讀畫面」（v0.8.0，2026-08-26）

上一版把 HTTP status 記下來之後，答案很乾淨：

```text
[fallback] GetConversation 回空 body（… / fetch）    HTTP 403 | content-type: (none)
[fallback] GetConversation 回空 body（… / GM_xhr）   HTTP 403 | content-type: (none)
```

四種組合（2 把 token × 2 種 transport）**全部 403、body 全空**。GM_xhr 不受 CORS 限制
卻一樣 403，代表**不是瀏覽器擋的，是伺服器拒絕**。token 本身沒問題（scope 對、
`sydney/v2/.default` 與 `sydney.readwrite` 都在），所以 403 是這個 endpoint 對
「不是官方前端發出的請求」的防護——再猜 header 也只是繼續碰運氣。

同時 scope 解析修好了，回報變得很清楚（帳號實際持有 7 個 scope）。

### 為什麼改成爬畫面

到這裡累積的事實是：**API 這條路走不通，但畫面上的內容一直都在**。
其他三支腳本刻意避開 DOM 是有原因的（見
[`chatgpt-export-markdown`](../chatgpt-export-markdown/) 的 README：ChatGPT 的訊息
列表是 virtualized 的，44 則訊息 DOM 裡只有 4 個節點；而且 Markdown 從 render 過的
HTML 反推回來會失真）。但那是**在 API 走得通的前提下**的取捨——這裡 API 走不通，
「可能不完整的 transcript」勝過「完全沒有 transcript」，只要**老實標示**就好。

所以 v0.8.0 加了 `fromDom()`，放在所有來源的**最後**：

- 掃 DOM 找 `data-testid` / class / id 含 `message` / `chat-turn` / `bubble` 的節點
- **會排除腳本自己注入的 UI**（`#m365-copilot-export-md-root`），否則自己的按鈕文字
  會被當成對話內容
- 同一則訊息被多層節點命中時只留最外層；但如果最外層只剩一個容器（class 含
  `message` 的整串對話外框），會再往下拆一層，避免整篇變成一則訊息
- 角色從節點與祖先的 `data-testid` / `aria-label` / class 判斷
  （`user`/`human` vs `assistant`/`copilot`/`bot`），認不出來就用一問一答交錯推，
  並把「幾則認不出來」記進 diagnostics
- HTML → Markdown 自己轉：code fence（含語言）、清單、表格、連結、行內 code、
  粗體斜體、引用都有處理

輸出的來源標籤會寫 **「從畫面擷取，可能不完整」**，狀態列也會顯示
`來源：dom-scrape (可能不完整)`——不會假裝跟 API 來源一樣可靠。

### 這條路測過什麼

用 Playwright 開一個合成的聊天頁（訊息節點用不同的 `data-testid` 分使用者／助理，
內容含 code fence、清單、表格、連結、粗體，並故意混入腳本自己的注入 UI）驗證：

- 三則訊息都抓到、角色正確、順序正確
- Markdown 轉換正確（```python fence、`-` 清單、表格、`[文字](網址)` 都對）
- 腳本自己的 UI 沒有被當成訊息
- 外層容器 class 也含 `message` 時，不會把整篇折成一則

**還沒驗證的是真實頁面**——M365 Copilot 實際用什麼 `data-testid`／class 我還沒看過，
所以啟發式有可能對不上。如果 `Copy Markdown` 抓不到或抓歪了，`Copy Diagnostics` 裡
會有一筆 `[fallback] DOM 掃描找到的候選群組`，列出掃到哪些節點群組與數量——
把那個回報就能對準真實結構調。

## 第八次真實測試：讀畫面成功（v0.9.0，2026-08-26）

**`Copy Markdown` 第一次真的匯出了對話內容**（來源顯示 `dom-scrape (可能不完整)`）。
API 那邊依舊全滅，而且這次多了一個資訊：拿 Graph 的 token 去打會回 **401**、
拿 sydney 的 token 回 **403**——代表 403 不是「token 不對」而是
「token 對、但這個 endpoint 不接受非官方前端」，API 這條路可以確定放棄了。

不過第一版的輸出有三個問題，diagnostics 剛好把真實 class 名稱吐出來了：

```text
[fallback] DOM 掃描找到的候選群組
  div[MessageListContainer] ×1 | div[m365-chat-llm-web-ui-chat-message] ×1
  | div[fai-UserMessage] ×1 | h5[fai-UserMessage__accessibleHeading] ×1
  | div[fai-UserMessage__message] ×1 | div[fai-CopilotMessage] ×1
  | h6[fai-CopilotMessage__accessibleHeading] ×1 | div[fai-CopilotMessage__content] ×1
  | div[fai-CopilotMessage__actions] ×1 | …
```

1. **整串對話被折成一則訊息**（標成 Assistant，裡面同時有「You said:」與
   「Copilot said:」）。原因是通用啟發式的「往下拆一層」只拆了一層，但真實結構是
   容器裡還有容器（`MessageListContainer` → `m365-chat-llm-web-ui-chat-message` →
   訊息），拆一層之後還是只有一個節點就停了。**改成一路往下拆到同一層有多個候選為止。**
2. **`##### You said:` / `###### Copilot said:` 跑進正文**——那是給螢幕閱讀器用的
   `__accessibleHeading`，角色我們自己判斷得出來，不需要它。連同訊息底下那排
   複製／讚／倒讚按鈕（`__actions`）一起在轉 Markdown 前先拆掉。
3. **一堆孤兒 `**`**：畫面上的 icon / spacer 是空的 `<b>` `<i>`，轉出來變成 `****`。
   改成內容為空時整個丟掉。

**同時針對真實版面加了精準選擇器**（不再只靠猜）：
`.fai-UserMessage` / `.fai-CopilotMessage` 是訊息外框，
`.fai-UserMessage__message` / `.fai-CopilotMessage__content` 是內文，
角色直接從 class 判斷。通用啟發式保留在後面當退路，萬一 Microsoft 改 class 名稱還能撐。

用 Playwright 照上面回報的真實結構重建頁面驗證：**兩條路（精準選擇器、通用啟發式）
都正確輸出 2 則訊息、角色正確、沒有 a11y 標題、沒有按鈕、沒有孤兒 `**`。**

## 第九次真實測試：輸出正確（v0.10.0，2026-08-26）

**匯出結果完全正確**——2 則訊息、角色正確、清單與段落都對，沒有 a11y 標題、
沒有按鈕殘留、沒有孤兒 `**`。diagnostics 也確認走的是
`用 M365 Copilot 已知的 class 抓到 2 則訊息`。

這輪只剩一個體驗問題：**每次匯出都會先白等一兩秒**。原本的順序是
「攔截 → 等攔截（最多 8 秒）→ API → 讀畫面」，但實測已經確定攔截從來沒攔到訊息、
API 一律 403，所以每次匯出都在跑兩條註定失敗的路。

**改成**：認得出版面時直接讀畫面，插到「等攔截」與 API 前面。順序變成

1. 已經攔到的 JSON（最理想，原始資料最完整）
2. **認得出版面 → 直接讀畫面**（instant）
3. 等攔截（版面不認得時才值得等）
4. API（實測一律 403，留著以防 Microsoft 改回來）
5. 通用啟發式讀畫面

匯出因此變成瞬間完成。來源標籤也分開了：走已知版面是
`dom-scrape (可能不完整)`，走啟發式是 `dom-scrape (啟發式，可能不完整)`，
一眼看得出是哪條路。

## 第十次真實測試：API 成功與 diagnostics 安全修正（v0.11.0，2026-08-26）

實際 diagnostics 顯示 `GetConversation` 已回 **200**，而且包含 **15 筆原始訊息**；同一頁
DOM 只抓到 6 則。這代表先前「API 一律 403」的結論已過時，完整匯出應優先使用 API，
DOM 改回 fallback。原始 `text` 也比 HTML 反推 Markdown 更能保留 ASCII diagram/code block。

同一份 diagnostics 還發現 WebSocket URL 的 query string 含 `access_token`，舊版會原樣複製，
屬於敏感資訊外洩。v0.11.0 起所有 diagnostics URL 都會先遮蔽 token 類 query 值；舊版產生的
diagnostics 不應公開分享。DOM fallback 也會移除常見的 line-number/gutter 節點。

## 第十一次真實測試：修正完整 API 被單筆 WebSocket 蓋掉（v0.12.0，2026-08-30）

實際 diagnostics 顯示同一個 conversation 的 `GetConversation` 已回 **200**，頂層
`messages` 有 **37 筆**；但是 Agent Handoff 最後只有 1 筆 User 訊息。原因不是 API、token
或 Markdown renderer，而是來源調度的順序：

1. Chathub 的 WebSocket URL 帶有正確 `ConversationId`，其中一個增量 frame 被辨識成 1 筆訊息。
2. `resolveConversation()` 在呼叫 `GetConversation` 前就把這筆 capture 返回。
3. `Copy Diagnostics` 雖然另外成功拿到 37 筆，但成功結果沒有保存成匯出候選。

v0.12.0 將 conversation 頁面的順序改成 **`GetConversation` → API cache → 最佳 capture → DOM**。
成功的 API response 會保存在記憶體，但**只當 API 重打失敗時的 fallback**——對話還在繼續時
直接吃 cache 會漏掉最新幾則（`Copy Diagnostics` 先跑過就會踩到）。頂層 `messages` 直接
採用並驗證 `conversationId`；capture
fallback 則只比較目前 conversation 的候選，依「可匯出正文數、原始訊息數、最後才看新舊」
選擇，不再讓最新單筆增量 frame 自動勝出。diagnostics 另加入 raw／role／non-empty body／section
純計數，不包含對話內容或 token。

## 已知限制

- `GetConversation` 已在真實歷史對話成功回傳 15 與 37 筆訊息，但這是 Microsoft 私有 API，
  其他帳號、租戶或 share 頁面仍可能失敗；失敗時會退回 DOM。
- share 連結沒有任何已知的直接呼叫方式，完全依賴攔截；攔不到就會老實報錯，不會假裝有資料。
- `copilot.cloud.microsoft` 與 `m365.cloud.microsoft` 是否真的共用同一套後端 API 未知。
- 靠的是私有 API 與 MSAL 內部快取格式（`msal.3.*`），Microsoft 改版就可能整支失效
  （見 [`docs/06`](../../docs/06-sandbox-and-unsafewindow.md)）。
- **WebSocket 攔截只解得開文字／JSON frame，而且只看得到最外層 window 的連線**：
  如果對話走的是二進位協定（Fluid Framework 那種），現在只能記大小、看不到內容；
  如果連線是在 iframe／Worker 裡建立的，現在的 patch 完全看不到——見上面
  「第四次真實測試」。
- diagnostics 只應分享 v0.11.0 之後產生的版本；更舊版本可能在 WebSocket URL 中帶出 token。
- **爬畫面這條路可能不完整**：如果 M365 Copilot 的訊息列表是 virtualized 的
  （只 render 可視範圍），捲不到的訊息就抓不到。輸出會標「可能不完整」，
  但**腳本無法自己知道少了幾則**——長對話建議先整串捲到底再匯出。
- 爬畫面的 Markdown 是從 render 過的 HTML 反推的，複雜排版（巢狀表格、
  自訂元件、citation 標記）可能失真。
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
- 用 Playwright 開合成聊天頁驗證 `fromDom()`：多角色、code fence／清單／表格／連結的
  Markdown 轉換、排除自己注入的 UI、外層容器不會把整篇折成一則
  （見上面「第七次真實測試」）

真正的驗證要在登入後的瀏覽器裡按下去——見上面「怎麼幫忙驗證」。
