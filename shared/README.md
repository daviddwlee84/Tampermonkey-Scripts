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

## ⚠️ 先考慮直接複製

`@require` 有兩個實際代價：

1. **更新不同步**：`dom.js` 改了之後，各腳本的 `@version` 不會變，
   使用者不會收到更新通知；manager 對 `@require` 的快取也不保證馬上失效。
2. **多一個網路相依**：raw.githubusercontent.com 掛了，腳本就跑不起來。

所以：**兩三個小函式，直接複製進腳本裡通常更省事。**
`shared/` 適合的是「好幾支腳本都要、而且邏輯夠複雜到不想複製」的東西。

判斷標準大致是：同一段 code 出現在三支以上的腳本，才值得搬進來。

背景見 [`docs/07-dev-workflow.md`](../docs/07-dev-workflow.md#共用程式碼)。
