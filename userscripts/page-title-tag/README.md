# Page Title Tag

在分頁標題前面加上短標籤（`[GPT]`、`[Claude]`、`[Gemini]`），
開一排 AI 分頁時比 favicon 好認。

- **生效網站**：`https://chatgpt.com/*`、`https://claude.ai/*`、`https://gemini.google.com/*`
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-title-tag/page-title-tag.user.js)
- **原始碼**：[`page-title-tag.user.js`](./page-title-tag.user.js)

## 它做了什麼

```text
分頁標題原本：  新的對話 - ChatGPT
加上標籤後：    [GPT] 新的對話 - ChatGPT
```

## 為什麼不是一行就好

直覺會想這樣寫：

```js
document.title = `[GPT] ${document.title}`;
```

在 DevTools Console 手動跑一次確實可以，但當成 userscript 就會失效，因為這些網站都是 SPA：

- 切換對話**不會** reload，腳本不會重跑
- 網站自己會在切換時覆寫 `document.title`，把你的標籤蓋掉

所以實作上是監看 `<title>` 節點的變化再補上去，並用一個 `applying` 旗標
避免「自己改 title → 觸發 observer → 再改一次」的無窮迴圈。
完整說明見 [`docs/05-spa-and-timing.md`](../../docs/05-spa-and-timing.md)。

## 自訂標籤

改腳本裡的 `TAGS` 陣列，並在 metadata 補上對應的 `@match`：

```js
const TAGS = [
  ['chatgpt.com', 'GPT'],
  ['claude.ai', 'Claude'],
  ['gemini.google.com', 'Gemini'],
  ['github.com', 'GH'], // 記得同時加 // @match https://github.com/*
];
```

## 已知限制

- 標籤只影響分頁標題，不影響瀏覽器歷史紀錄裡已存下的舊標題。
- 網站若改用非 `<title>` 的方式更新標題（目前沒有），就需要再調整。
