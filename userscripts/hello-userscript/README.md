# Hello Userscript

教學用 demo。它不解決任何真實問題，存在的目的是**一次看完 userscript 的常見零件**。

- **生效網站**：`https://example.com/*`
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/hello-userscript/hello-userscript.user.js)
- **原始碼**：[`hello-userscript.user.js`](./hello-userscript.user.js)

## 它示範了什麼

| 段落                      | 概念                                   | 延伸閱讀                                                       |
| ------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| 檔案最上方的註解區塊       | metadata block：何時、何處執行          | [`docs/03-metadata-reference.md`](../../docs/03-metadata-reference.md) |
| `GM_addStyle`             | 注入 CSS                               | [`docs/04-gm-api.md`](../../docs/04-gm-api.md)                  |
| `createElement` + `append`| 注入自己的浮動面板 UI                   | [`docs/10-recipes.md`](../../docs/10-recipes.md)                |
| `GM_setValue` / `GM_getValue` | 跨 reload 的持久化儲存（造訪次數）  | [`docs/04-gm-api.md`](../../docs/04-gm-api.md)                  |
| `GM_setClipboard`         | 寫入剪貼簿，不需使用者手勢               | [`docs/04-gm-api.md`](../../docs/04-gm-api.md)                  |
| `GM_registerMenuCommand`  | 在 Tampermonkey 選單加指令              | [`docs/04-gm-api.md`](../../docs/04-gm-api.md)                  |
| `MutationObserver`        | 網站重繪 DOM 後把面板補回去              | [`docs/05-spa-and-timing.md`](../../docs/05-spa-and-timing.md)  |

## 使用方式

1. 安裝後打開 <https://example.com>
2. 右下角會出現一個深色小面板，顯示你觸發過幾次
3. 按 **Copy as Markdown** 把頁面轉成 Markdown 複製走
4. 點瀏覽器工具列的 Tampermonkey 圖示，會看到三個選單指令

想確認 GM storage 真的持久：reload 幾次看計數器往上加，再用選單的
**Reset visit counter** 歸零。

## 已知限制

- 只在 `example.com` 生效，避免在真的網站上亂放面板。想拿它練習就改 `@match`，
  記得同步改 `@version`（見 [`docs/08-distribution-and-sync.md`](../../docs/08-distribution-and-sync.md)）。
- 面板的 `MutationObserver` 監看整個 `document.body`，在超大型網站上會偏吃效能。
  正式腳本應該縮小 observe 範圍。
