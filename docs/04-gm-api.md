# 04 · GM API

GM API 是 userscript **比一般網頁 JS 多出來的能力**。用哪個就要在 metadata 加對應的
`// @grant`，否則該函式是 `undefined`。

## 持久化儲存

```js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_listValues
```

```js
GM_setValue('lastExport', Date.now());
const last = GM_getValue('lastExport', 0);   // 第二個參數是預設值
GM_deleteValue('lastExport');
GM_listValues();                             // ['lastExport', ...]
```

特性：

- 值會做 JSON 序列化，可以直接存物件、陣列、boolean
- 綁在「腳本」上，不是網域 —— 同一支腳本在不同網站看到的是同一份資料
- reload、關分頁、重開瀏覽器都還在
- 和 `localStorage` 不同：網站清 `localStorage` 動不到它，網站也讀不到它

適合存：設定、上次執行時間、UI 狀態、已處理過的 ID 清單。

### 監看變化

```js
// @grant GM_addValueChangeListener
GM_addValueChangeListener('theme', (key, oldValue, newValue, remote) => {
  if (remote) applyTheme(newValue);  // remote = 另一個分頁改的
});
```

多分頁之間同步設定很好用。

## 剪貼簿

```js
// @grant GM_setClipboard
GM_setClipboard(markdown, 'text');
GM_setClipboard('<b>hi</b>', 'html');
```

比 `navigator.clipboard.writeText()` 好用的地方：**不需要使用者手勢**，
在 `setTimeout` 或 observer callback 裡也能寫入。

典型用途——把整段對話轉成 Markdown 丟給 coding agent：

```text
ChatGPT
──────────────────────
conversation...

                  [Copy MD]
```

## 跨域請求

```js
// @grant   GM_xmlhttpRequest
// @connect api.example.com
```

```js
GM_xmlhttpRequest({
  method: 'GET',
  url: 'https://api.example.com/data',
  headers: { Accept: 'application/json' },
  onload(res) {
    const data = JSON.parse(res.responseText);
    console.log(data);
  },
  onerror(err) {
    console.error(err);
  },
});
```

這是 GM API 最有價值的一個：**繞過 CORS**。一般網頁的 `fetch()` 打別的網域會被擋，
`GM_xmlhttpRequest` 由 extension 發出，不受同源政策限制。

⚠️ 目標網域一定要列在 `@connect`。

Promise 版本包裝：

```js
function gmFetch(options) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({ ...options, onload: resolve, onerror: reject, ontimeout: reject });
  });
}

const res = await gmFetch({ method: 'GET', url: 'https://api.example.com/data' });
```

## 選單指令

```js
// @grant GM_registerMenuCommand
GM_registerMenuCommand('Export conversation', exportConversation);
GM_registerMenuCommand('Copy as Markdown', copyMarkdown, { accessKey: 'c' });
```

不用動網站 UI 就能提供功能：

```text
Tampermonkey
 ├─ Export conversation
 ├─ Copy as Markdown
 └─ Debug selectors
```

想移除的話留住回傳值：

```js
const id = GM_registerMenuCommand('Stop', stop);
GM_unregisterMenuCommand(id);   // 需要 // @grant GM_unregisterMenuCommand
```

## 注入 CSS

```js
// @grant GM_addStyle
GM_addStyle(`
  .ad-banner { display: none !important; }
  #my-panel { position: fixed; z-index: 2147483647; }
`);
```

搭配 `@run-at document-start` 可以避免元素先閃一下才被隱藏。

沒有 `GM_addStyle` 的環境（例如 `@grant none`）可以自己來：

```js
const style = document.createElement('style');
style.textContent = '...';
document.head.appendChild(style);
```

## 通知與分頁

```js
// @grant GM_notification
GM_notification({ title: 'Done', text: '匯出完成', timeout: 3000 });

// @grant GM_openInTab
GM_openInTab('https://example.com', { active: false, insert: true });

// @grant GM_download
GM_download({ url: blobUrl, name: 'conversation.md' });
```

## 腳本自身資訊

`GM_info` 不需要 `@grant`：

```js
console.log(GM_info.script.version);   // '1.0.0'
console.log(GM_info.scriptHandler);    // 'Tampermonkey' / 'Violentmonkey'
```

寫「版本更新後跳一次提示」很好用。

## `GM_*` vs `GM.*`

較新的規範提供 Promise 版本：

```js
// @grant GM.setValue
const value = await GM.getValue('key', 0);
```

- `GM_setValue`（底線）：同步，相容性最好
- `GM.setValue`（點）：回傳 Promise

本 repo 統一用底線版，理由是相容性最廣、也不用處理 async 傳染。

## 相容性提醒

Tampermonkey 和 Violentmonkey 的 GM API 大致相同，但不是 100%。
會跨 manager 分享的腳本，用之前先確認一下。

## 下一步

[05 · SPA 與執行時機](./05-spa-and-timing.md)
