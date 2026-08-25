# 11 · 疑難排解

## 快速對照

| 症狀                                   | 最可能的原因                        | 去看               |
| -------------------------------------- | ----------------------------------- | ------------------ |
| 腳本完全沒執行                          | Chrome 沒開 Developer mode          | [↓](#腳本完全沒執行) |
| 腳本完全沒執行                          | `@match` 沒中                       | [↓](#match-沒中)   |
| `querySelector` 回傳 `null`             | 腳本比內容早跑                      | [↓](#selector-抓不到) |
| 切換頁面後功能不見                      | SPA 換頁不會重跑腳本                | [05](./05-spa-and-timing.md) |
| `GM_xxx is not defined`                 | 忘了 `@grant`                       | [↓](#gm_xxx-is-not-defined) |
| `window.something` 是 `undefined`       | sandbox 隔離                        | [06](./06-sandbox-and-unsafewindow.md) |
| 改了 push 上去但其他機器沒更新          | 忘了加 `@version`                   | [↓](#推上去了但沒更新) |
| `fetch` 被 CORS 擋                      | 該用 `GM_xmlhttpRequest`            | [↓](#跨域請求失敗) |
| `GM_xmlhttpRequest` 失敗                | 目標網域沒列在 `@connect`           | [↓](#跨域請求失敗) |
| 頁面變超慢                              | `MutationObserver` 範圍太大         | [05](./05-spa-and-timing.md#效能注意) |
| 瀏覽器直接跳走／顯示原始碼              | 網址結尾不是 `.user.js`             | [↓](#安裝連結點了沒反應) |

## 腳本完全沒執行

### 1. 先看 manager 圖示

工具列的 Tampermonkey 圖示上會顯示目前頁面**啟用中的腳本數**。
是 0 或沒有數字，代表根本沒 match 到，不是你的邏輯有問題。

### 2. Chrome Developer mode

Manifest V3 之後，Chrome / Edge / Brave 需要在 `chrome://extensions`
開啟 **Developer mode** 才會執行 userscript。這是目前最常見的第一名原因。

### 3. 腳本被停用

manager Dashboard 裡看那支腳本的 Enabled 開關。

## `@match` 沒中

常見錯誤：

```js
// @match https://example.com          ❌ 缺 path，至少要一個 /
// @match https://example.com/*        ✅

// @match https://*.example.com/*      ⚠️ 這個「不」包含 example.com 本身（部分實作）
// @match *://*.example.com/*          ✅ 較保險

// @match https://exam*.com/*          ❌ host 的 * 只能放最前面
```

不確定就先用寬鬆的測，確認能執行後再收緊：

```js
// @match *://*/*
```

（測完記得改回來，別讓腳本在所有網站上跑。）

## selector 抓不到

腳本跑的當下元素還沒生出來。三個修法：

1. 改用 `waitForElement()`（[05](./05-spa-and-timing.md#修法-1等元素出現)）
2. 明寫 `@run-at document-idle`（別靠預設，TM 與 VM 的預設值不同）
3. 用 `MutationObserver` 等它出現

驗證方法：在 DevTools Console 手動跑同一句 `querySelector`。
Console 有結果但腳本沒有 → 是時機問題；Console 也是 `null` → 是 selector 寫錯。

## `GM_xxx is not defined`

metadata 裡少了對應的 `@grant`：

```js
// @grant GM_setValue
```

沒宣告的 GM API 就是不存在，不會有任何警告。

本 repo 跑 `npm run check` 就會抓到這種問題。

## 推上去了但沒更新

99% 是**忘了把 `@version` 往上加**。manager 只比對版本號，
code 改了但版本沒動，它就認為沒有新版。

其次的可能：

- 更新檢查還沒到（Tampermonkey 預設一天一次）→ Dashboard 手動
  **Check for userscript updates**
- `@updateURL` 寫錯 → `npm run check` 會驗
- raw.githubusercontent.com 的 CDN 快取 → 通常幾分鐘內就好

## 跨域請求失敗

```text
Access to fetch at 'https://api.example.com' from origin 'https://site.com'
has been blocked by CORS policy
```

一般 `fetch()` 受同源政策限制。改用：

```js
// @grant   GM_xmlhttpRequest
// @connect api.example.com
```

`@connect` 沒列到目標網域的話，Tampermonkey 會跳出確認視窗或直接拒絕。

## 安裝連結點了沒反應

manager 是靠**網址以 `.user.js` 結尾**來攔截安裝的。所以：

- ✅ `https://raw.githubusercontent.com/.../foo.user.js`
- ❌ `https://github.com/.../blob/main/foo.user.js`（這是 HTML 頁面）

GitHub 頁面上要點 **Raw** 才會拿到正確的網址。

## 腳本互相打架

兩支腳本改到同一個元素時，用 `@run-at` 排順序，或用 `dataset` 做標記：

```js
if (el.dataset.handledBy) return;
el.dataset.handledBy = 'my-script';
```

## CSP 擋住注入的資源

某些網站的 Content-Security-Policy 會擋掉外部 script / style / 圖片。
症狀是 Console 出現 `Refused to load ...`。

解法：

- 用 `GM_addStyle` 而不是 `<link href="...">`
- 圖片改用 data URI 或 SVG inline
- 需要第三方 library 就用 `@require`（由 manager 載入，不受頁面 CSP 限制）

## 都不是的話

在腳本最上面加一行：

```js
console.log('[my-script] loaded', GM_info.script.version, location.href);
```

看得到這行 → 腳本有跑，問題在邏輯或時機。
看不到 → 問題在安裝 / `@match` / manager 設定。

## 下一步

[12 · 安全性](./12-security.md)
