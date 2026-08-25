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

## 怎麼測試

### 在瀏覽器裡

打開 **<https://example.com>**（就是這個網址，`@match` 只設了它）。

會看到：

1. **右下角出現一個深色浮動面板**，寫著
   「你在這個網站觸發本腳本第 N 次（存在 GM storage，reload 不會歸零）」
2. **reload 幾次** → N 會往上加。這證明 `GM_setValue` 真的跨 reload 持久，
   和 `localStorage` 不同
3. 按 **Copy as Markdown** → 頁面被轉成 Markdown 進剪貼簿，
   按鈕短暫變成 "Copied!"。貼到任何地方看看：

   ```markdown
   # Example Domain

   <https://example.com/>

   This domain is for use in documentation examples without needing permission. Avoid use in operations.
   Learn more
   ```

4. 按 **Hide** → 面板消失
5. 點工具列的 Violentmonkey / Tampermonkey 圖示 → 看到三個選單指令：
   **Copy page as Markdown**、**Reset visit counter**、**Show panel**
6. 點 **Reset visit counter** → 計數器歸零並 reload
7. 點 **Show panel** → 剛剛 Hide 掉的面板回來

### 不開瀏覽器

```bash
npm run preview -- hello-userscript
npm run preview -- hello-userscript --menu "Copy page as Markdown"
```

會把腳本注入真實頁面、印出 GM storage 與剪貼簿內容，並截圖到
`.preview/hello-userscript.png`。這個 harness 能證明什麼、不能證明什麼，
見 [`docs/13`](../../docs/13-playwright-vs-userscript.md)。

## 已知限制

- 只在 `example.com` 生效，避免在真的網站上亂放面板。想拿它練習就改 `@match`，
  記得同步改 `@version`（見 [`docs/08-distribution-and-sync.md`](../../docs/08-distribution-and-sync.md)）。
- 面板的 `MutationObserver` 監看整個 `document.body`，在超大型網站上會偏吃效能。
  正式腳本應該縮小 observe 範圍。
- `pageAsMarkdown()` 必須把自己注入的面板排除掉
  （`.filter((p) => !p.closest('#' + PANEL_ID))`），否則匯出的內容會含自己的 UI 文字。
  這是 exporter 類腳本非常容易犯的錯，而且截圖看不出來——1.0.1 版就有這個 bug。
