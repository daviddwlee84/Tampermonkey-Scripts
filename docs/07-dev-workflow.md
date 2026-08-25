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

## 本機檔案熱重載（Track external edits）

這是開發 userscript 最有感的一個設定。設定好之後：

```text
VS Code / Neovim 存檔
        ↓
manager 偵測到磁碟上的檔案變動
        ↓
自動 reload 符合 @match 的分頁
        ↓
新版本生效
```

不用再 commit → push → 等更新，也不用 copy/paste 到內建編輯器。

### Violentmonkey（建議，功能最完整）

**方法 A：拖放（最快，Chrome 86+ / VM 2.16+）**

1. 打開 Violentmonkey Dashboard（任何一個 VM 的 UI 頁面都行）
2. 從 Finder 把 `userscripts/<slug>/<slug>.user.js` **直接拖進那個頁面**
3. 出現安裝畫面，點 **Track external edits**
   （旁邊的 checkbox 可以勾「以後本機檔案都預設這樣做」）
4. 勾 **Reload tab** —— 偵測到變更時自動重新整理符合 `@match` 的分頁

**方法 B：從檔案網址安裝**

需要先在 `chrome://extensions` → Violentmonkey → **詳細資料** →
開啟 **允許存取檔案網址（Allow access to file URLs）**，
然後把 `.user.js` 拖到工具列或分頁區。

**方法 C：本機 HTTP server**（前兩者不行時的後備）

```bash
npx http-server /Users/david/Documents/Program/Tampermonkey-Scripts -c-1
# -c-1 = 完全停用快取，否則你會改了檔案卻抓到舊版
```

然後在瀏覽器打開
`http://localhost:8080/userscripts/<slug>/<slug>.user.js`，
一樣點 **Track external edits**。

### Tampermonkey

較新版本也支援開啟本機 `.user.js` 並追蹤磁碟變化，
在 Dashboard 的 **Utilities** 分頁。功能比 VM 的略陽春（沒有 auto-reload tab）。

### ⚠️ 不要同時裝兩份

「從 URL 安裝的那份」和「追蹤本機檔案的那份」是**兩個獨立的 entry**，
兩個都在的話會同時執行，你會分不清網頁上跑的是哪一版（症狀通常是 UI 出現兩次）。

**開發機上的建議**：只留 tracking 那份，把 URL 安裝的那份停用或刪掉。
其他機器則相反，只留 URL 安裝的那份。

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

## 不開瀏覽器也能跑一次：`npm run preview`

repo 內建一個 Playwright 煙霧測試，把腳本注入真實頁面並截圖：

```bash
npm run preview -- hello-userscript
npm run preview -- hello-userscript --menu "Copy page as Markdown"
npm run preview -- page-title-tag https://example.com/ --headed
```

輸出包含 `document.title`、註冊了哪些選單指令、GM storage 內容、剪貼簿內容、
page console log，以及 `.preview/<slug>.png` 截圖。

**它能證明什麼、不能證明什麼**，以及什麼時候該改用真的 manager，
見 [13 Playwright vs. userscript](./13-playwright-vs-userscript.md)。

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
