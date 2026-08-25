# 05 · SPA 與執行時機

**九成的「腳本沒反應／有時候有效」都出在這一章。**

## 問題

現代網站（ChatGPT、Claude、GitHub、Gmail…）幾乎都是 SPA：

```text
第一次 page load
    ↓
React / Vue app 啟動
    ↓
URL 改變（history.pushState）
    ↓
DOM 換掉
    ↓
但整個頁面沒有 reload
```

userscript 只在**真正的 page load** 時執行一次。所以：

- 你的按鈕在第一頁有，切到第二頁就不見了
- `document.querySelector('.chat')` 在腳本跑的當下還是 `null`
- 你設定的 `document.title` 被網站的 router 蓋掉

## 三個症狀，三個修法

| 症狀                       | 原因                       | 修法                          |
| -------------------------- | -------------------------- | ----------------------------- |
| selector 抓不到（`null`）   | 腳本比內容早跑             | `waitForElement()`            |
| 切頁後功能消失             | SPA 換頁不會重跑腳本       | `onUrlChange()`               |
| 改了又被網站改回去          | 網站自己重繪／覆寫         | `MutationObserver` 盯住那個節點 |

## 修法 1：等元素出現

```js
function waitForElement(selector, { timeout = 10_000, root = document.documentElement } = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(root, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

const composer = await waitForElement('form textarea');
```

比 `setTimeout(fn, 3000)` 好在：元素一出現就繼續，而且有逾時保護不會無限等。

## 修法 2：偵測 SPA 換頁

`history.pushState()` **不會**觸發任何原生事件。`popstate` 只在上一頁／下一頁時觸發。
所以三種做法：

### (a) 觀察 DOM 順便比對 URL（最簡單、最通用）

```js
function onUrlChange(callback) {
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      callback(location.href);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
```

### (b) 攔截 history API（最準，但要碰頁面 context）

```js
const origPushState = history.pushState;
history.pushState = function (...args) {
  const result = origPushState.apply(this, args);
  window.dispatchEvent(new Event('locationchange'));
  return result;
};
window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
window.addEventListener('locationchange', run);
```

注意 sandbox 問題，見 [06](./06-sandbox-and-unsafewindow.md)。

### (c) `navigation` API（新版 Chrome）

```js
if (window.navigation) {
  navigation.addEventListener('navigate', () => setTimeout(run, 0));
}
```

最乾淨，但只有 Chromium 系有。

## 修法 3：讓 handler 可以重複執行

上面兩招都會讓你的函式被呼叫很多次，所以它**必須 idempotent**：

```js
function run() {
  const target = document.querySelector('main');
  if (!target) return;
  if (target.dataset.myScript) return;   // 做過就跳過
  target.dataset.myScript = '1';

  target.appendChild(makeButton());
}
```

用 `dataset` 標記做過的節點，是最省事的去重方式。

## `@run-at` 怎麼選

```js
// @run-at document-start   HTML 剛開始解析，DOM 幾乎是空的
// @run-at document-body    <body> 出現
// @run-at document-end     DOMContentLoaded
// @run-at document-idle    大致載入完（預設）
```

| 你要做的事                        | 用                     |
| --------------------------------- | ---------------------- |
| 攔截網站的全域物件、覆寫 `fetch`   | `document-start`       |
| 注入 CSS 避免元素閃一下            | `document-start`       |
| 一般加按鈕、抓資料                 | `document-idle`（預設）|

**`document-start` + `MutationObserver`** 是應付難搞網站的組合技：
腳本比網站的 JS 還早跑，然後靜靜等它把東西畫出來。

## 避免自己觸發自己

改 DOM 會觸發你自己的 observer，很容易寫出無窮迴圈：

```js
let applying = false;

function applyTag() {
  if (applying) return;
  applying = true;
  document.title = `[GPT] ${document.title}`;
  applying = false;
}
```

或是在改之前先 `observer.disconnect()`，改完再 `observe()` 回去。

實例見 [`page-title-tag`](../userscripts/page-title-tag/page-title-tag.user.js)。

## 效能注意

```js
observer.observe(document.body, { childList: true, subtree: true });
```

這會在**每一次** DOM 變動時呼叫你的 callback —— 在 ChatGPT 這種串流輸出的頁面上
一秒可能上百次。所以：

1. **縮小範圍**：能 observe 某個容器就別 observe `document.body`
2. **callback 要快**：只做 `querySelector` 加早退，重活丟到 debounce 後面
3. **用完 disconnect()**：一次性的等待記得收掉

```js
function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

new MutationObserver(debounce(run, 200)).observe(container, { childList: true, subtree: true });
```

## 下一步

[06 · Sandbox 與 unsafeWindow](./06-sandbox-and-unsafewindow.md)
