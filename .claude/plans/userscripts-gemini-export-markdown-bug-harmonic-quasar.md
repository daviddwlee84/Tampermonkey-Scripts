# Gemini Export Markdown：多輪對話順序錯亂／只剩最後一輪

## Context 背景

使用者回報 `gemini-export-markdown` 在多輪對話「只抓到最後一輪」。比對附件與實測後的發現：

- **app 頁歷史 payload（附件 JSON）是「最新在前」**：`[turns, null, null, []]`，
  turns 依序是 Docker（11:39:25Z）→ links（11:39:07Z）→ YouTube 總結（11:38:38Z）。
  每輪的 `turn[1]` 是 parent 指標 `["c_…", "r_<上一輪>", "rc_…"]`，第一輪是 `null`。
- **share 頁 `ujx1Bf`（匿名實打 `share/48a9ed88aed7`）是「時間順序」**，三輪齊全。
- 腳本 `normalize()` 照 payload 原順序輸出，所以 app 頁匯出的 `.md` 是**倒序**：
  最上面是最後一輪，看起來像只抓到最後一輪（附件 `.md` 三輪其實都在，只是反過來）。
- 另一個會真正「只剩最後一輪」的路徑：`pickCaptured()` 只挑**最新一筆**符合 conversation
  的 capture。在 app 頁送出新訊息或捲動載入時，網站會再發 batchexecute，可能只帶最新一輪
  （或只帶一頁）；那筆比較新，就把完整歷史蓋掉。

目標：不管來源是哪種 payload、攔到幾筆，輸出都是**完整且依時間先後排序**的對話。

## Changes 修改內容

唯一要改的程式：`userscripts/gemini-export-markdown/gemini-export-markdown.user.js`

1. **合併同一段對話的所有 capture**（取代 `pickCaptured` 只取最新一筆）
   - 新增 `mergeCaptured(ids)`：從 `captured` 挑出屬於目標的筆（share 用 url／`convo.shareId`，
     app 用 `turn[0][0] === c_<id>`），把所有 turns 以 response id `turn[0][1]` 去重合併；
     同一個 id 出現多次時保留**較新 capture** 的那份（內容可能被重新生成更新）。
   - meta／shareId／created 取第一個有值的；`data` 保留最完整那筆（turns 最多者），
     讓 `Download .json` 行為不變。
   - 沒有任何目標筆時才退回「最新一筆」（維持現有 fallback 語意）。
   - `resolveConversation()` 與 `waitForCapture()` 改用它，回傳形狀維持 `{ url, rpcid, convo, data }`。

2. **依時間先後排序 turns**（新增 `orderTurns(turns)`，在 `normalize()` 去重後呼叫）
   - 主依據：parent 鏈。`turn[1]?.[1]` 是上一輪的 `r_` id；從沒有 parent（或 parent 不在集合內）
     的那輪出發，一路往下串。這比時間戳可靠（regenerate／分支時時間戳可能交錯）。
   - 鏈斷掉或有多個 root（例如只攔到部分頁面）時，剩下的用 `turnTime()`（`turn[4]` 秒＋奈秒）
     穩定排序補上；連時間戳都沒有就保留原相對順序。
   - share payload 本來就是正序，排序後不變——等於同一套邏輯吃兩種形狀，不需要判斷來源。

3. **metadata 跟著修正**：`normalize()` 的 `conversationId` / `model` / `createdAt`
   改看排序後的第一輪（目前用 `turns[0]`，在 app 頁拿到的是最後一輪的時間）。

4. `@version` 與 `VERSION` 常數 `0.2.0` → `0.2.1`；README「已知限制／payload 形狀」那節補一句：
   app 頁 payload 是最新在前、腳本依 parent 鏈重排，且會合併多筆 capture。

## Tests 回歸測試

新增 `tests/gemini-export-markdown.test.mjs`（照 `tests/grok-export-markdown.test.mjs` 的模式：
Playwright + GM shim，`page.addInitScript` 在 document-start 注入 shared lib 與腳本），並在
`package.json` 加 `test:gemini-export`。Fixture 用**合成**的最小 payload（不放使用者真實內容），
放在 `tests/fixtures/gemini-export/`：

- `app-history.txt`：batchexecute 回應，三輪、最新在前、帶 parent 指標。
- `app-latest.txt`：只帶最後一輪的第二筆回應。

驗證案例：
1. 只攔到 `app-history` → Markdown 依 User1/Assistant1 → User3/Assistant3 順序，frontmatter
   `messages: 6`、`created_at` 是第一輪時間。
2. 先 `app-history` 再 `app-latest` → 仍是完整三輪且順序正確（重現「只剩最後一輪」）。
3. share 形狀（正序）→ 順序不變。

## Verification 驗證

- `npm run check`、`npm run verify`
- `npm run test:gemini-export`（Chromium + Firefox）
- `npm run preview -- gemini-export-markdown https://gemini.google.com/share/48a9ed88aed7 --menu "Copy Markdown" --wait 4000`
  確認 share 路徑輸出三輪且為正序（YouTube 總結 → links → Docker）。
- app 頁（需登入，preview 攔截層不生效）：請使用者裝上 0.2.1 後在原對話
  `/app/eeef8fc40249e0b1` 匯出，確認順序正確；再送一則新訊息後重匯，確認沒有只剩最後一輪。
