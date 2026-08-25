# Userscript 教學

從「這不就是把 DevTools Console 的 code 存起來嗎」開始，一路到能穩定跑在 SPA 上、
用 GitHub 自動更新、跨機器同步的 userscript。

## 建議閱讀順序

| #  | 文件                                                             | 你會得到                                                     |
| -- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 01 | [什麼是 userscript](./01-what-is-userscript.md)                   | 和 Console / Extension 的定位差異，什麼時候該用哪個            |
| 02 | [第一支腳本](./02-getting-started.md)                             | 裝好 manager、寫出並跑起第一支腳本                            |
| 03 | [Metadata 完整參考](./03-metadata-reference.md)                   | `@match`、`@run-at`、`@require`… 每個 key 的實際效果          |
| 04 | [GM API](./04-gm-api.md)                                          | 儲存、剪貼簿、跨域請求、選單指令                              |
| 05 | [SPA 與執行時機](./05-spa-and-timing.md)                          | 為什麼你的腳本「有時候有效」，以及怎麼修                      |
| 06 | [Sandbox 與 unsafeWindow](./06-sandbox-and-unsafewindow.md)       | 為什麼 Console 能做的事在腳本裡失敗                           |
| 07 | [開發工作流](./07-dev-workflow.md)                                | 從 Console PoC 到 repo，含 TypeScript / bundler 的升級路徑    |
| 08 | [發佈與同步](./08-distribution-and-sync.md)                       | GitHub 當 source of truth + 自動更新 + 跨機器 bootstrap       |
| 09 | [Manager 比較](./09-managers-comparison.md)                       | Tampermonkey / Violentmonkey / Greasemonkey 怎麼選            |
| 10 | [常用食譜](./10-recipes.md)                                       | 可直接抄的 pattern：注入 UI、匯出 Markdown、熱鍵、串本機服務  |
| 11 | [疑難排解](./11-troubleshooting.md)                               | 症狀 → 原因 → 修法對照表                                      |
| 12 | [安全性](./12-security.md)                                        | 別把 secret 放腳本裡，以及安裝別人的腳本前該看什麼            |

## 只想快速上手

讀 [01](./01-what-is-userscript.md) → [02](./02-getting-started.md)，
然後直接抄 [`userscripts/_template/template.user.js`](../userscripts/_template/template.user.js)。

## 卡住了

先看 [11 疑難排解](./11-troubleshooting.md)。九成的「腳本沒反應」都是
執行時機（[05](./05-spa-and-timing.md)）或 `@grant`（[04](./04-gm-api.md)）的問題。
