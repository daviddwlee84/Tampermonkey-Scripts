# 06 · Sandbox 與 unsafeWindow

這是從 Console 轉過來最容易踩的坑：**同一段 code，在 Console 跑得好好的，
搬進 userscript 就 `undefined`。**

## 為什麼

DevTools Console 直接操作頁面的 JavaScript context。
userscript 則可能跑在一個**隔離的 sandbox** 裡：

```text
Page JS
┌──────────────────────┐
│ window               │
│ React                │
│ app globals          │
│ jQuery / $           │
└──────────┬───────────┘
           │  DOM（共享）
───────────┼──────────────
           │
┌──────────┴───────────┐
│ userscript           │
│ sandbox window       │
│ GM_* APIs            │
└──────────────────────┘
```

**DOM 是共享的**，所以這些一定沒問題：

```js
document.querySelector('.foo');
element.remove();
document.body.appendChild(button);
new MutationObserver(fn).observe(document.body, { childList: true });
```

**JS 全域不一定共享**，所以這些可能失敗：

```js
window.__NEXT_DATA__;     // 可能是 undefined
window.$;                 // 頁面的 jQuery 看不到
window.myAppState;
```

## 什麼時候會被 sandbox

| `@grant`           | 執行環境                                        |
| ------------------ | ----------------------------------------------- |
| `@grant none`      | 直接跑在**頁面 context**，`window` 就是頁面的 window |
| 有任何 `@grant`    | 跑在 **sandbox**，`window` 是包裝過的            |

所以一個常見的偵錯發現是：「我加了 `@grant GM_setValue` 之後，
原本能讀的 `window.something` 就壞了。」——就是這個原因。

## unsafeWindow

要從 sandbox 碰到真正的頁面 window：

```js
// @grant unsafeWindow

const state = unsafeWindow.__APP_STATE__;
unsafeWindow.myHelper = () => console.log('called from page');
```

名字裡的 "unsafe" 是提醒：你正在和網站可控的物件互動。
網站可以覆寫任何東西，所以不要盲信從那邊拿到的值。

Violentmonkey / Tampermonkey 都支援 `unsafeWindow`，但 sandbox 的實作細節略有差異。

## 實務建議：多數情況根本不用碰

如果你要做的只是：

- 抓 DOM
- 加按鈕
- 複製 Markdown
- `MutationObserver`

那完全不需要碰頁面 context。**從 DOM 讀資料通常比從 app internals 讀更穩定**——
網站改一次 build，內部變數名就換了；DOM 結構相對穩。

真的需要頁面內部狀態時，優先順序：

1. 從 DOM 讀（最穩）
2. 從網站的 `<script type="application/json">` 或 `__NEXT_DATA__` 之類的資料島讀
3. 攔截網站發出的 API 請求（見下）
4. 才是碰 `unsafeWindow` 的 app internals（最脆弱）

## 攔截網站的網路請求

想拿網站自己 API 的資料，這招比翻 DOM 好用：

```js
// @run-at document-start
// @grant unsafeWindow

const origFetch = unsafeWindow.fetch;
unsafeWindow.fetch = async function (...args) {
  const response = await origFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0].url;

  if (url.includes('/api/conversation')) {
    response.clone().json().then((data) => {
      console.log('[my-script] captured', data);
    });
  }
  return response;   // 一定要把原本的 response 還回去
};
```

兩個關鍵：

- **必須 `@run-at document-start`**，否則網站早就抓完資料了
- **必須用 `response.clone()`**，body 只能讀一次，讀掉了網站就壞了

## `@sandbox` 明確指定

Tampermonkey 支援直接指定：

```js
// @sandbox raw          不要 sandbox，直接在頁面 context
// @sandbox JavaScript   標準 sandbox
// @sandbox DOM          只保證 DOM 可用
```

需要精準控制時再用，一般不必。

## 下一步

[07 · 開發工作流](./07-dev-workflow.md)
