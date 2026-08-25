# 03 · Metadata 完整參考

metadata block 一定要放在檔案最前面，格式固定：

```js
// ==UserScript==
// @key    value
// ==/UserScript==
```

manager 是**用字串比對**找這兩行的，所以：

- 不能用 `/* */` 包起來
- 前面不能有其他 code（`'use strict'` 也不行）
- 同一個 key 可以出現多次（`@match`、`@grant`、`@require`…）

## 身分

| Key            | 說明                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `@name`        | 顯示名稱。可加 `@name:zh-TW` 提供在地化名稱                           |
| `@namespace`   | 命名空間。`@namespace` + `@name` 才是腳本的唯一識別；建議填 repo URL   |
| `@version`     | 版本號。**自動更新完全靠它**，建議用 `X.Y.Z`                          |
| `@description` | 一句話說明，同樣支援 `@description:zh-TW`                             |
| `@author`      | 作者                                                                  |
| `@license`     | 授權                                                                  |
| `@icon`        | 腳本清單裡的圖示。常用 `https://www.google.com/s2/favicons?sz=64&domain=example.com` |
| `@homepageURL` | 專案首頁                                                              |
| `@supportURL`  | 回報問題的地方                                                        |

> ⚠️ 改了 `@name` 或 `@namespace` 等於變成「另一支腳本」，manager 會當成新的裝，
> 舊的那支還會留著。要改的話記得手動刪掉舊的。

## 在哪裡執行

### `@match`（建議用這個）

Chrome extension 的 match pattern 格式：

```text
<scheme>://<host><path>
```

```js
// @match https://chatgpt.com/*          只有這個網域
// @match *://*.github.com/*             所有子網域，http/https 都算
// @match https://example.com/user/*     限定路徑
// @match *://*/*                        所有網站（謹慎使用）
```

規則重點：

- host 的萬用字元只能放在**最前面**：`*.github.com` 可以，`git*.com` 不行
- path 一定要有，至少一個 `/`
- `*://*.github.com/*` **包含** `github.com` 本身

### `@include` / `@exclude`

`@include` 較寬鬆，支援 `*` 萬用字元甚至正規表示式：

```js
// @include /^https:\/\/(www\.)?example\.com\/(a|b)\//
```

彈性大但容易誤中，**預設用 `@match`**，需要正規表示式時才用 `@include`。

`@exclude` 用來扣掉：

```js
// @match   *://*.github.com/*
// @exclude *://gist.github.com/*
```

`@exclude` 的優先度高於 `@match` 和 `@include`。

### `@noframes`

```js
// @noframes
```

預設情況下，頁面裡**每一個** iframe 只要網址符合 `@match` 就會各跑一次腳本。
有廣告或嵌入內容的網站，腳本可能被執行十幾次。除非你真的需要在 iframe 裡動作，
不然一律加這行。

## 什麼時候執行

```js
// @run-at document-start   HTML 剛開始解析，DOM 幾乎是空的
// @run-at document-body    <body> 出現時
// @run-at document-end     DOMContentLoaded 時
// @run-at document-idle    頁面大致載入完（預設值）
// @run-at context-menu     只有從右鍵選單點才執行
```

選法：

| 需求                                    | 用           |
| --------------------------------------- | ------------ |
| 攔截／覆寫網站的全域物件、擋掉某些請求   | `document-start` |
| 一般 DOM 操作、加按鈕                    | `document-idle` |
| 想早一點插入 CSS 避免閃爍                | `document-start` + `GM_addStyle` |

細節見 [05 SPA 與執行時機](./05-spa-and-timing.md)。

## 權限

```js
// @grant none                    不用任何 GM API（腳本會直接跑在頁面 context）
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_setClipboard
// @grant GM_xmlhttpRequest
// @grant GM_addStyle
// @grant GM_registerMenuCommand
// @grant unsafeWindow            存取頁面真正的 window
```

三個重點：

1. **沒宣告的 GM API 就是 `undefined`**，會直接 `ReferenceError`。
2. `@grant none` 和有 grant 的**執行環境不一樣**（sandbox），見
   [06 Sandbox 與 unsafeWindow](./06-sandbox-and-unsafewindow.md)。
3. 完全不寫 `@grant`，Tampermonkey 會自己猜要給哪些 —— 但別依賴這個，明寫比較穩。

本 repo 的 `npm run check` 會掃程式碼裡實際用到的 `GM_*`，和 `@grant` 對不起來就報錯。

## 跨域白名單

```js
// @connect chatgpt.com
// @connect localhost
// @connect *                 允許所有網域（Tampermonkey 會跳提示）
```

`GM_xmlhttpRequest` 要連的網域必須在 `@connect` 列出來。

## 外部資源

```js
// @require https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js
// @resource customCSS https://example.com/style.css
```

- `@require` 會在腳本執行前先載入並執行那個 JS（會被 manager 快取）
- `@resource` 搭配 `GM_getResourceText` / `GM_getResourceURL` 取用

⚠️ `@require` 等於把第三方 code 拉進你的腳本權限範圍，**務必鎖版本號**，
不要用 `@latest`。

## 更新與發佈

```js
// @updateURL   https://raw.githubusercontent.com/you/repo/main/foo.user.js
// @downloadURL https://raw.githubusercontent.com/you/repo/main/foo.user.js
```

- `@updateURL`：manager 定期抓這個網址，只讀 metadata 比對 `@version`
- `@downloadURL`：真的要更新時，從這裡抓完整腳本

兩個通常填一樣。沒有 `@version` 的話，這兩個 key 形同虛設。

Violentmonkey 只看 `@downloadURL`（它的文件沒有 `@updateURL`），Tampermonkey 兩個都用。
**兩個都寫**就能同時滿足。
完整說明見 [08 發佈與同步](./08-distribution-and-sync.md)。

## 其他常用

| Key             | 說明                                                        | 支援          |
| --------------- | ----------------------------------------------------------- | ------------- |
| `@top-level-await` | 允許最外層 `await`                                        | 兩者皆可      |
| `@noframes`     | 見上                                                         | 兩者皆可      |
| `@unwrap`       | 不要把腳本包在函式裡（很少用）                               | 兩者皆可      |
| `@antifeature`  | 誠實標示腳本含廣告／追蹤／付費功能（Greasy Fork 需要）        | TM／市集      |
| `@sandbox`      | 指定執行環境：`raw` / `JavaScript` / `DOM`                   | **TM 限定**   |
| `@inject-into`  | 指定注入 context：`page` / `content` / `auto`（預設 `auto`） | **VM 限定**   |
| `@exclude-match`| 用 match pattern 語法排除                                    | **VM 限定**   |

`@sandbox` 和 `@inject-into` 是兩邊各自解決「腳本要跑在哪個 JS context」的答案，
見 [06 Sandbox 與 unsafeWindow](./06-sandbox-and-unsafewindow.md)。

## 本 repo 的慣例

每支腳本都必須有：`@name`、`@namespace`、`@version`、`@description`、`@author`、
`@grant`、至少一個 `@match`、以及指向正確 raw 路徑的 `@updateURL` / `@downloadURL`。
`npm run check` 會強制這些規則。

## 下一步

[04 · GM API](./04-gm-api.md)
