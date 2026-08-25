# 13 · Playwright vs. userscript

兩個都是「用程式操作網頁」，但解決的是**不同問題**。選錯會很痛苦。

## 一句話分界

```text
使用者在瀏覽器裡看著網頁，想要多一個功能
        → userscript

沒有人在看，程式自己跑一輪網頁
        → Playwright
```

再具體一點：

| 問題                                       | 用            |
| ------------------------------------------ | ------------- |
| 「這個網站少一個匯出按鈕」                   | userscript    |
| 「我想在已登入的頁面上加熱鍵」               | userscript    |
| 「隱藏廣告、改版面」                        | userscript    |
| 「每天早上抓 100 頁存進資料庫」              | Playwright    |
| 「CI 裡驗證這個網站沒壞」                   | Playwright    |
| 「跑完就關掉，不需要 UI」                    | Playwright    |
| 「截圖 / PDF / 效能追蹤」                    | Playwright    |

## 對照

|                    | **Userscript**                     | **Playwright**                          |
| ------------------ | ---------------------------------- | --------------------------------------- |
| 誰觸發             | 使用者開網頁                        | 你的程式 / 排程 / CI                     |
| 跑在哪             | 使用者真實的瀏覽器 profile          | 自動化控制的瀏覽器實例                   |
| 登入狀態           | ✅ 直接沿用（已登入的 session）      | ⚠️ 要自己處理 cookie / storage state     |
| 有 UI              | ✅ 可以注入按鈕、面板、熱鍵          | ❌ 通常無頭，沒有人會看                   |
| 被反機器人偵測     | 低（就是真人在用）                  | 較高                                     |
| 需要安裝什麼       | 一個 extension                      | Node/Python + 瀏覽器 binary              |
| 能跨頁保存資料     | `GM_setValue`                       | 你自己的檔案 / DB                        |
| 能跨域打 API       | `GM_xmlhttpRequest`                 | 原生就可以（不受頁面同源限制）            |
| 適合長時間批次作業 | ❌（綁在使用者的分頁上）             | ✅                                       |
| 適合寫測試         | ❌                                  | ✅                                       |

## 決策樹

```text
你要做的事需要「人在場」嗎？
│
├─ 需要（我一邊用網站，一邊要這個功能）
│     │
│     └──────────────────────────────► userscript
│
└─ 不需要（跑就對了）
      │
      ├─ 需要已登入的 session，而且很難自動化登入？
      │     │
      │     ├─ 是 ──► userscript 抓資料 + 送到本機服務
      │     │          （見 docs/10 的「送到本機 coding agent」）
      │     │
      │     └─ 否 ──► Playwright
      │
      └─ 要排程 / 大量 / 寫進 CI ──► Playwright
```

## 混合用法：其實常常是兩個一起

最實用的模式是**用 userscript 當抓取端，Playwright 或本機服務當處理端**：

```text
你已登入的 ChatGPT 分頁
        │  userscript 抽出對話（沿用登入狀態，不會被擋）
        ▼
   localhost:8765
        │  本機服務
        ▼
   檔案 / DB / coding agent
```

反過來也有：Playwright 開一個瀏覽器，然後 `page.addInitScript()`
把你的 userscript 注進去——這正是下面 `npm run preview` 在做的事。

## 本 repo 的 `npm run preview`

```bash
npm run preview -- <slug> [url] [--headed] [--menu "<caption>"] [--click "<selector>"] [--wait <ms>]
```

它用 Playwright 開一個真的 Chromium，導到 `@match` 對應的網址，
注入 GM API 的 shim 和你的腳本，然後回報結果並截圖到 `.preview/<slug>.png`。

```bash
$ npm run preview -- hello-userscript --menu "Copy page as Markdown"
→ https://example.com/
ran menu       : Copy page as Markdown

document.title : Example Domain
menu commands  : Copy page as Markdown, Reset visit counter, Show panel
GM storage     : {"visitCount":1}
clipboard      :
  | # Example Domain
  |
  | <https://example.com/>
  ...
screenshot     : .preview/hello-userscript.png
```

### ✅ 它能證明的事

- 腳本語法正確、載入時不會丟例外
- selector 抓得到東西，DOM 邏輯跑得動
- 注入的 UI 真的畫出來了（看截圖）
- 匯出 / 轉換邏輯的輸出長什麼樣
- `GM_setValue` / `GM_setClipboard` / `GM_registerMenuCommand` 有被正確呼叫

`--menu` 觸發的指令如果是 async（例如要等網站自己的資料載完才有東西可以匯出），
預設 300ms 的等待會來不及，剪貼簿那一欄會是空的。加 `--wait`：

```bash
npm run preview -- chatgpt-export-markdown "https://chatgpt.com/share/<id>" \
  --menu "Copy Markdown" --wait 20000
```

它會在剪貼簿一有內容就往下走，`--wait` 只是上限。

### 頁面的 CSP 會被繞過

harness 用 Playwright 的 `bypassCSP`，因為**真的 manager 也不受頁面 CSP 管**。
不繞的話，nonce-based CSP（claude.ai）或 Trusted Types（copilot.microsoft.com）
會直接讓注入失敗，測不到任何東西。

### `@require` 會被解析

一個 manager 會把每個 `@require` 的內容放在**腳本的 scope 裡**先跑一遍，
harness 也照做——否則靠 `shared/` 的腳本一進來就會 `xxx is not defined`。

指向本 repo 的 `@require`（`raw.githubusercontent.com/.../main/...`）**會改讀工作區的檔案**，
所以改了 `shared/` 不用先 commit 就能測；其他網域的 URL 才真的下載，抓不到會直接失敗。
每個 require 從哪來會印在輸出上：

```text
@require       : local shared/chat-export.js
@require       : local shared/export-ui.js
```

### ❌ 它不能證明的事

這是一個 **shim，不是 userscript manager**。以下只有真的裝進 manager 才算數：

| 不涵蓋                       | 為什麼                                        |
| ---------------------------- | --------------------------------------------- |
| `@match` / `@exclude` 對不對 | harness 是直接注入，沒有做 URL 比對            |
| `@run-at` 時機               | harness 固定在 `domcontentloaded` 之後注入     |
| sandbox / `unsafeWindow`     | shim 直接跑在 page context（見 [06](./06-sandbox-and-unsafewindow.md)）|
| `GM_xmlhttpRequest` 跨域     | 沒有 extension 就沒有繞過 CORS 的能力          |
| `@grant` 宣告是否正確        | shim 一律提供，manager 則會是 `undefined`      |
| 選單指令的真實 UI            | 只是呼叫函式，沒有真的選單                     |
| 自動更新 / `@version`        | 完全不涉及                                     |

所以流程是：

```text
npm run preview     快速迭代，抓語法錯誤與 DOM 邏輯錯誤
        ↓ 通過
裝進 Violentmonkey  驗 @match、@grant、sandbox、時機
        ↓ 通過
commit + push
```

### 它抓到過真的 bug

`hello-userscript` 的 `Copy as Markdown` 原本會把**自己注入的面板文字**
也一起匯出，因為 `querySelectorAll('p')` 選到了面板裡的 `<p>`。
截圖看不出來，是 harness 印出剪貼簿內容才發現的。修法是加一行
`.filter((p) => !p.closest('#' + PANEL_ID))`。

「注入的 UI 汙染了自己的抓取結果」是寫 exporter 類腳本非常容易犯的錯，
值得每次都用 `--menu` 把輸出印出來看一眼。

## 什麼時候該從 userscript 換成 Playwright

出現這些訊號時：

- 你發現自己「為了讓腳本跑，得先手動開 20 個分頁」
- 需要排程（每天、每小時）
- 一次要處理的資料量大到瀏覽器分頁會卡
- 想把它放進 CI

反過來，如果你在 Playwright 裡花大把時間對抗登入、2FA、機器人偵測，
那訊號是：**這件事應該讓 userscript 在你已登入的瀏覽器裡做**。

## 回到索引

[docs/README.md](./README.md)
