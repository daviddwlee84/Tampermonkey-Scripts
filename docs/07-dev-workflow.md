# 07 · 開發工作流

## 核心原則：repo 才是 source of truth

**不要把 manager 內建編輯器裡那份當 master。**它沒有 diff、沒有歷史、沒有分支、
換台機器就沒了，coding agent 也改不到。

```text
~/Documents/Program/Tampermonkey-Scripts   ← master
        │ git push
        ▼
   github.com/daviddwlee84/Tampermonkey-Scripts
        │ raw.githubusercontent.com
        ▼
   Tampermonkey（各機器）                  ← runtime
```

manager 退回它真正適合的位置：**執行環境 + 更新的消費端**。

## 日常循環

```bash
# 1. 建立新腳本
npm run new -- chatgpt-export "ChatGPT Export" "https://chatgpt.com/*"

# 2. 編輯
$EDITOR userscripts/chatgpt-export/chatgpt-export.user.js

# 3. 在瀏覽器驗證（見下面「本機檔案熱重載」）

# 4. 改完把 @version 往上加，然後檢查
npm run check     # metadata / @grant / URL 正確性
npm run index     # 更新 README 的腳本索引表

# 5. commit
git add -A && git commit -m "feat(chatgpt-export): add markdown export"
git push
```

`npm run verify` = `check` + `index:check`，CI 跑的就是這個。

## 本機檔案熱重載（最舒服的做法）

較新版的 Tampermonkey 支援**開啟本機 `.user.js` 檔案並追蹤磁碟上的變化**。
設定好之後：

```text
VS Code / Neovim 存檔
        ↓
Tampermonkey 偵測到檔案變動
        ↓
reload 網頁 → 新版本生效
```

不用再 copy → paste → save → reload。

Violentmonkey 沒有這個功能，但有等價的做法：跑一個本機 static server
指到 repo，然後用一支 loader 腳本 `@require` 本機檔案。

### 沒有熱重載時的最低成本做法

在 manager 裡建一支「載入器」，內容只有：

```js
// ==UserScript==
// @name         DEV loader
// @match        https://chatgpt.com/*
// @require      file:///Users/david/Documents/Program/Tampermonkey-Scripts/userscripts/chatgpt-export/chatgpt-export.user.js
// @grant        none
// ==/UserScript==
```

需要在 extension 設定裡開啟「允許存取檔案網址」（Chrome 的
`chrome://extensions` → 該 extension → Allow access to file URLs）。

## Console PoC → userscript

最有效率的順序：

```text
DevTools Console 驗證 selector 與邏輯
        ↓
搬進 userscript
        ↓
加 button / 熱鍵 / 剪貼簿
        ↓
處理 SPA 換頁與時機
```

先在 Console 把「抓得到東西嗎」確認完，可以省掉大量
「到底是 selector 錯還是執行時機錯」的來回。

## Debug 技巧

**統一 log 前綴**，才能在 Console filter：

```js
const LOG = '[chatgpt-export]';
const log = (...a) => console.log(LOG, ...a);
```

**加一個 debug 選單指令**，把常用 selector 的命中數印出來：

```js
GM_registerMenuCommand('Debug selectors', () => {
  for (const sel of ['article', 'main', '[data-message-author-role]']) {
    log(sel, document.querySelectorAll(sel).length);
  }
});
```

網站改版時，這個指令一秒就能看出是哪個 selector 掛了。

**確認腳本有沒有被載入**：manager 圖示上會顯示目前頁面啟用中的腳本數量。
是 0 就是 `@match` 沒中，不是你的邏輯有問題。

## 什麼時候該升級成 bundler / TypeScript

單檔 `.user.js` 適用到大約幾百行。出現以下訊號時再考慮升級：

- 一支腳本超過 ~500 行
- 多支腳本要共用同一批工具函式
- 想要型別、想寫測試
- 需要用 npm 套件（`@require` 撐不住了）

升級後的形狀：

```text
TypeScript source (src/)
        ↓
   vite / rollup + userscript metadata plugin
        ↓
   dist/foo.user.js
        ↓
   GitHub
        ↓
   Tampermonkey
```

```text
userscripts-monorepo/
├── package.json
├── packages/
│   ├── chatgpt-export/
│   │   ├── src/index.ts
│   │   └── meta.ts
│   └── github-tools/
│       └── src/index.ts
└── dist/
    ├── chatgpt-export.user.js
    └── github-tools.user.js
```

Violentmonkey 官方有提供 TypeScript + Rollup 的 generator 可以直接抄。

**但別提早做這件事。**本 repo 目前刻意維持「一支腳本一個檔案、零建置」：
raw URL 直接就是可安裝的腳本，不需要 CI build 才能更新，心智負擔最低。
升級之後 `@updateURL` 要改指向 `dist/`，而且 `dist/` 必須 commit 進 repo
（或用 CI 產生後 commit），否則 raw URL 會抓不到東西。

## 共用程式碼

還沒到需要 bundler 的階段，但有兩三支腳本要共用工具函式時，
把它放進 [`shared/`](../shared/) 並用 `@require` 引入：

```js
// @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/dom.js
```

代價是：`shared/dom.js` 改了之後，manager 的快取不一定會馬上更新，
而且各腳本的 `@version` 不會因此改變（使用者不會收到更新通知）。
所以小型工具函式**直接複製到各腳本裡通常更省事**。

## 下一步

[08 · 發佈與同步](./08-distribution-and-sync.md)
