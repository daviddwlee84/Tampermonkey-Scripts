# 12 · 安全性

userscript 的權限很大：它在你已登入的網站上、用你的身分執行任意 JavaScript。
所以有幾件事要有意識。

## 寫自己的腳本時

### 絕對不要在腳本裡放 secret

```js
const OPENAI_KEY = 'sk-...';        // ❌
const GITHUB_TOKEN = 'ghp_...';     // ❌
```

理由：

- 腳本跑在瀏覽器裡，任何人開 DevTools 都看得到
- repo public 的話直接全世界可見；private 也只是慢一點被發現
- `GM_setValue` 存起來稍微好一點（不在原始碼裡），但仍然是本機明文

真的需要認證時：讓腳本呼叫**你自己的本機 / 私有服務**，
由那個服務持有 token。

```text
userscript  ──►  localhost:8765  ──►  外部 API
（沒有 secret）   （持有 token）
```

### `@connect` 開最小範圍

```js
// @connect api.example.com   ✅ 明確
// @connect *                 ⚠️ 等於允許腳本把資料送到任何地方
```

### `@match` 也開最小範圍

```js
// @match https://chatgpt.com/*   ✅
// @match *://*/*                 ⚠️ 在每個網站上都執行
```

`*://*/*` 只在真的需要全站生效（例如全域快捷鍵）時才用，而且要有自覺：
這支腳本會在你的網銀頁面上執行。

### `@require` 要鎖版本

```js
// @require https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js   ✅
// @require https://cdn.jsdelivr.net/npm/dayjs@latest/dayjs.min.js    ❌
```

`@require` 進來的 code 和你的腳本同權限。用 `@latest` 等於允許對方
在任何時候改變你腳本的行為。可以的話加上 subresource integrity：

```js
// @require https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js#sha256=...
```

### 小心 `innerHTML`

```js
panel.innerHTML = `<p>${userContent}</p>`;   // ⚠️ 頁面內容可能含 HTML
panel.textContent = userContent;             // ✅
```

從頁面抓來的文字要當成不可信輸入。要組結構就用 `createElement` + `textContent`。

### 送出資料前先想一下

「把對話送到本機 daemon」很方便，但那份對話可能含公司資料。
確認：daemon 只綁 `127.0.0.1`、有驗證來源、寫出去的檔案權限正確。

## 安裝別人的腳本時

`.user.js` 安裝畫面會列出它要求的權限。至少確認：

| 看什麼         | 警訊                                        |
| -------------- | ------------------------------------------- |
| `@match`       | 一支「YouTube 工具」為什麼要 `*://*/*`？      |
| `@connect`     | 為什麼要連一個你沒聽過的網域？                |
| `@grant`       | 為什麼一個換色腳本需要 `GM_xmlhttpRequest`？  |
| `@require`     | 從哪個 CDN 拉 code？有沒有鎖版本？            |
| 程式碼本身      | 有沒有大段混淆過的字串？                      |

來源也重要：Greasy Fork / OpenUserJS 有審核與回報機制；
隨手在論壇看到的一段 code 就自己判斷。

**已安裝的腳本會自動更新。**也就是說今天無害的腳本，作者明天可以推一個新版本
做任何事。長期留著的第三方腳本值得偶爾複查，或關掉它的自動更新。

## 定期整理

manager Dashboard 裡把不用的腳本刪掉。每一支都是一份長期有效的授權。

## 回到索引

[docs/README.md](./README.md)
