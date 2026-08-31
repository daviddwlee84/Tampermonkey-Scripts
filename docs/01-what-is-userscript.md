# 01 · 什麼是 userscript

一句話：**把你原本會貼到 Chrome DevTools Console 執行的 JavaScript，包裝成會自動比對網址、
持久保存、有權限管理的瀏覽器腳本。**

它比 Console script 多了幾個關鍵能力，所以實際上更接近「超輕量 browser extension」。

## 三層定位

```text
DevTools Console
    ↓
「臨時 hack 一下」

Userscript
    ↓
「我要長期 hack 這個網站，但不值得造一個 extension」

Browser Extension
    ↓
「我要做成完整產品／深度 browser integration」
```

## 能力對照

|                    | DevTools Console | Userscript             | Browser Extension |
| ------------------ | ---------------- | ---------------------- | ----------------- |
| 執行 JS            | ✅               | ✅                     | ✅                |
| 操作 DOM           | ✅               | ✅                     | ✅                |
| 關掉頁面後還存在   | ❌               | ✅                     | ✅                |
| 每次開網站自動執行 | ❌               | ✅                     | ✅                |
| 指定哪些 URL 執行  | 手動             | ✅ `@match`            | ✅                |
| 跨頁持久化資料     | 麻煩             | ✅ `GM_setValue`       | ✅                |
| 跨域 HTTP request  | 受 CORS 限制     | ✅ `GM_xmlhttpRequest` | ✅                |
| 插入 menu / UI     | 手動             | ✅                     | ✅                |
| 安裝／分享         | 貼 code          | 一個 `.user.js`        | extension package |
| 開發成本           | 最低             | 很低                   | 較高              |

概念上就是：

```text
Console snippet
    ↓ 加上
URL matching
自動執行
persistent storage
extra browser APIs
權限管理
更新機制
    ↓
Userscript
```

## 最小可用範例

每次打開 ChatGPT 都把分頁標題前面加 `[GPT]`：

```js
// ==UserScript==
// @name         ChatGPT Title Modifier
// @namespace    local
// @version      1.0.0
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  document.title = `[GPT] ${document.title}`;
})();
```

真正的關鍵是 metadata 裡的：

```js
// @match https://chatgpt.com/*
```

意思是「只要網址符合，就自動執行」。你不再需要開 DevTools → 切 Console → 貼 code → Enter，
reload 網頁就跑。

> ⚠️ 這個版本在 ChatGPT 上其實**會失效**，因為它是 SPA，切換對話時網站會自己蓋掉標題。
> 正確做法見 [05 SPA 與執行時機](./05-spa-and-timing.md) 和
> [`page-title-tag`](../userscripts/page-title-tag/) 這支腳本。

## 常見用途

```text
網站 UI patch
├─ 隱藏元素
├─ 調整版面
├─ 加按鈕
├─ 鍵盤快捷鍵
└─ 自訂 CSS / dark mode

資料處理
├─ 抓當前頁面內容
├─ 批次複製
├─ 匯出 Markdown / JSON / CSV
└─ 偵測變化

自動化
├─ 自動點擊
├─ 自動填表
├─ 翻頁
└─ 重複操作

整合
├─ 呼叫 API
├─ 送到本機 server
├─ 送 webhook
└─ 串接其他服務
```

## userscript vs. userscript manager

`userscript` 是這個概念本身；Tampermonkey 之類的是**執行它的軟體**：

```text
        userscript
            ↑
┌───────────────────────┐
│ Tampermonkey          │
│ Violentmonkey         │
│ Greasemonkey          │
└───────────────────────┘
```

怎麼選見 [09 Manager 比較](./09-managers-comparison.md)。

## Userscript + manager vs. 自製 Chrome extension

Chrome extension 不是單純「更正式的 userscript」。兩者都能修改網頁，但技術形狀不同：

- **Tampermonkey／Violentmonkey 本身才是 extension**；`.user.js` 是交給 manager 代管與執行的腳本。
- **自製 extension 是獨立的 browser application**；它有自己的 manifest、execution contexts、權限、UI 與發佈生命週期。

```text
Userscript 路線
.user.js → userscript manager（extension）→ browser

自製 extension 路線
manifest + content scripts → browser
                    └─ 需要時再加 service worker／UI
```

|                | Userscript + manager                                              | 自製 Chrome extension                                                                          |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 最小專案       | 一個 `.user.js` + metadata                                        | `manifest.json` + content script；視需求再加 service worker、popup、options、side panel、icons |
| 執行位置       | manager sandbox 裡操作 matched page 的 DOM                        | content script、extension page、service worker 分開，彼此通常要 message passing                |
| Browser API    | 兩邊 manager 都有的 portable `GM_*` subset                        | 較完整的 `chrome.*`，例如 toolbar、context menu、side panel、bookmarks、native messaging       |
| 持久設定       | `GM_setValue`，由 manager 依 script identity 保存                 | `chrome.storage.local`／`sync`；暫存資料另有 `storage.session`                                 |
| 跨站協作       | 同一支 script 的 GM storage 可跨它的多個 `@match` 共用            | 多支 content script 可共用 `chrome.storage`；需要集中協調時再加 service worker/message passing |
| Portability    | 同一檔可同時支援 Tampermonkey、Violentmonkey 與多種 browser       | Chrome MV3 為主要目標；移植其他 browser 仍要檢查 API 與 packaging                              |
| 安裝／發佈     | Raw `.user.js`、腳本市集、`@updateURL`                            | Unpacked package、Chrome Web Store、enterprise distribution                                    |
| Trust boundary | Manager 有廣泛權限；每一支安裝的 script 也要獨立審查              | Extension package、publisher 與 manifest permissions                                           |
| 適合情境       | 少量 matched pages 的 DOM enhancement、個人／小團隊工具、快速迭代 | 完整 browser UI、背景事件、複雜跨 context 架構、產品化與 Store distribution                    |

### 兩邊都能有持久化 config

「Extension 可以保存設定，userscript 不行」是誤解。`GM_setValue` 的資料綁在**腳本**而非網域；同一支腳本在 YouTube 與 Gemini 都看得到，而且 reload、關分頁、重開 browser 後仍在。網站自己的 JavaScript 也讀不到這份 storage。完整 API 見 [04 GM API](./04-gm-api.md#持久化儲存)。

Extension 則要明確選 storage：

- `chrome.storage.local`：保留在這個 browser profile。
- `chrome.storage.sync`：啟用 Chrome Sync 時可同步到其他登入裝置，但有 quota。
- `chrome.storage.session`：只適合 browser session 內的短效資料。
- **Service worker 的 global variable 不算 storage**；worker 隨時可能被暫停，記憶體狀態會消失。

兩條路線預設都不是「全世界共用設定」：userscript 的 GM storage 是否跨裝置，要看 manager 是否支援並啟用對應 sync；extension 則要選 `storage.sync`，並依賴 browser account/sync 設定。

### 什麼時候升級成 extension

像「YouTube 按一下 → 用短效 GM storage 交給 Gemini」這種 workflow，userscript 已經有足夠能力。改做 extension 必然會增加 manifest、host/storage permissions、content scripts 與 packaging；只有需要 background events 或集中協調時，才必須再加 service worker 與 message passing。

當需求核心變成以下能力，再升級比較值得：

- Toolbar badge、context menu、side panel 或 omnibox
- Page 不開著也要接 browser-level background events
- Bookmarks、history、downloads、native messaging 等 extension APIs
- 多個 content scripts 與完整 options UI
- 需要 Chrome Web Store review、enterprise policy 或一般使用者的一鍵安裝體驗

相關細節不用全塞在這一篇：metadata 與權限見 [03](./03-metadata-reference.md)，sandbox 見 [06](./06-sandbox-and-unsafewindow.md)，開發與升級成本見 [07](./07-dev-workflow.md)，發佈見 [08](./08-distribution-and-sync.md)，manager 選擇見 [09](./09-managers-comparison.md)，安全與第三方 script 審查見 [12](./12-security.md)。

## 下一步

[02 · 第一支腳本](./02-getting-started.md)
