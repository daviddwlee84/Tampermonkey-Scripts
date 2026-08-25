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

|                     | DevTools Console | Userscript          | Browser Extension |
| ------------------- | ---------------- | ------------------- | ----------------- |
| 執行 JS             | ✅               | ✅                  | ✅                |
| 操作 DOM            | ✅               | ✅                  | ✅                |
| 關掉頁面後還存在    | ❌               | ✅                  | ✅                |
| 每次開網站自動執行  | ❌               | ✅                  | ✅                |
| 指定哪些 URL 執行   | 手動             | ✅ `@match`         | ✅                |
| 跨頁持久化資料      | 麻煩             | ✅ `GM_setValue`    | ✅                |
| 跨域 HTTP request   | 受 CORS 限制     | ✅ `GM_xmlhttpRequest` | ✅             |
| 插入 menu / UI      | 手動             | ✅                  | ✅                |
| 安裝／分享          | 貼 code          | 一個 `.user.js`     | extension package |
| 開發成本            | 最低             | 很低                | 較高              |

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

## 下一步

[02 · 第一支腳本](./02-getting-started.md)
