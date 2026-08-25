# shared/

給多支腳本共用的工具函式，用 `@require` 引入：

```js
// @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/dom.js
```

`@require` 進來的檔案會直接在腳本 scope 執行，所以裡面用的是**全域函式宣告**，
不是 ES module。

## 目前有什麼

[`dom.js`](./dom.js)

| 函式                    | 用途                                      |
| ----------------------- | ----------------------------------------- |
| `waitForElement()`      | 等 selector 出現，有逾時保護              |
| `onUrlChange()`         | SPA 換頁偵測                              |
| `debounce()`            | 包住 MutationObserver callback            |
| `markOnce()`            | 用 dataset 標記處理過的節點，避免重複執行  |
| `addFloatingButton()`   | 右下角浮動按鈕                            |
| `downloadText()`        | 不需 `@grant` 的檔案下載                  |

[`chat-export.js`](./chat-export.js) —— 三支對話匯出腳本共用的轉換層（不碰 DOM、不碰 GM）

| 函式                  | 用途                                             |
| --------------------- | ------------------------------------------------ |
| `renderTranscript()`  | 正規化的 doc → SpecStory 風格 Markdown（含 Agent Handoff 變體） |
| `mergeSections()`     | 連續同 role 的訊息合併成一段                     |
| `fence()` / `jsonFence()` | backtick-run 感知的 code fence               |
| `formatUtc()` / `localIso()` | 時間格式（epoch 秒 / ISO 都吃）           |
| `sourcesBlock()`      | citation 去重後的來源清單                        |
| `filenameFor()` / `downloadText()` | 檔名與下載                          |

[`export-ui.js`](./export-ui.js) —— 同三支腳本共用的浮動 UI

| 函式                  | 用途                                             |
| --------------------- | ------------------------------------------------ |
| `createExportPanel()` | 右下角可拖曳的按鈕 + 面板（動作、開關、狀態列、貼 URL 輸入框） |

`export-ui.js` **刻意不呼叫任何 GM API**：位置記憶走呼叫端注入的 `storage`。
因為 `scripts/check-meta.mjs` 只掃腳本本體來交叉比對 `@grant`，
GM 呼叫留在腳本裡，`npm run check` 才驗得到少宣告的 grant。

## ⚠️ 先考慮直接複製

`@require` 有兩個實際代價：

1. **更新不同步**：`dom.js` 改了之後，各腳本的 `@version` 不會變，
   使用者不會收到更新通知；manager 對 `@require` 的快取也不保證馬上失效。
2. **多一個網路相依**：raw.githubusercontent.com 掛了，腳本就跑不起來。

所以：**兩三個小函式，直接複製進腳本裡通常更省事。**
`shared/` 適合的是「好幾支腳本都要、而且邏輯夠複雜到不想複製」的東西。

判斷標準大致是：同一段 code 出現在三支以上的腳本，才值得搬進來。

`chat-export.js` / `export-ui.js` 就是這樣進來的：chatgpt / claude / copilot 三支 exporter
的 render 與浮動 UI 完全一樣（約 350 行），複製三份才是比較貴的那個選項。
`dom.js` 目前反而沒有腳本 `@require`，維持「範例 + 可複製」的定位。

順帶一提，`npm run preview` **會解析 `@require`**：指向本 repo 的會直接讀工作區的檔案
（所以測得到還沒 commit 的 `shared/`），其他 URL 才走網路。
`npm run check` 也會擋「指向本 repo 但檔案不存在」的 `@require`。

背景見 [`docs/07-dev-workflow.md`](../docs/07-dev-workflow.md#共用程式碼)。
