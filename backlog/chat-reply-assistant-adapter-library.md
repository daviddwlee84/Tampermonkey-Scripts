# Chat Reply Assistant：共用 adapter library

**Status**: deferred
**Effort**: L
**Related**: [TODO.md](../TODO.md) · [CLAUDE.md](../CLAUDE.md) · [AI 網站研究](./chat-reply-assistant-ai-platforms.md)

## Context

2026-09-25，v0.3 先在單一可安裝 userscript 內建立 Meta／Gemini adapter registry。使用者同意等更多網站與實際重用需求出現後，再抽出外部 library；目前不引入 bundler、TypeScript 或大型第三方 adapter framework。

## Existing contract

Adapter 處理 `route`、`locateSurface`、`inspect`、`readDraft`、`insert`、`send` 與能力宣告；AI 站另提供生成狀態。外層 controller 負責設定與 key、資料選取、LLM／Jev、聊天室生命週期、倒數與是否允許送出。

共用程式不得自己掛全域 observer、讀 key、發網路請求或自動送訊息。失敗應回報未知／不支援，不能偷偷改用 Enter 或另一個網路接口。

## Options considered

| 方案                                             | 優點                                       | 代價                                          |
| ------------------------------------------------ | ------------------------------------------ | --------------------------------------------- |
| 維持同檔 registry                                | raw URL 直接安裝，依賴與發布一致           | 更多網站後主檔會變大                          |
| `shared/chat-site-adapters.js` 加單一 `@require` | 符合 repo 現有零建置慣例，可供多支腳本使用 | 要管理 API 版本、consumer 更新與 manager 快取 |
| 模組化原始碼再 bundle                            | 細粒度檔案與測試較方便                     | 違反目前零建置約定；需另行決策與維護發布產物  |

## Release and testing concerns

- 現行 `check-meta`／`preview` 用 repo 的 `main` raw URL 加字面檔案路徑解析本地 `@require`；不能直接加 `?v=…`，否則它會被當成檔名。commit URL 會被視為外部依賴，需先調整工具與測試。
- 共享 helper 更新不等於每個 manager 已更新快取；需明確 API version、consumer 版本更新與不相容時的可見錯誤。
- 不把 Gemini exporter 的 RPC 攔截、`unsafeWindow` 或整支自啟動腳本引入 reply assistant；抽取範圍限無副作用的 DOM／輸入操作。
- 保留每站 fixture 與真 manager 證據，並測至少兩個 consumer 同時存在，避免共用狀態或 UI 汙染。

## Decision

2026-09-25 deferred。v0.3 維持同檔 registry；當更多網站 adapter 成熟、維護成本增加後，再評估抽離；第二個 consumer 的實際重用需求也是評估依據。

接續第一步：盤點可真正共用的讀取／輸入能力與 consumer，列出不相容修改情境；先決定版本與發布流程，再搬檔案，避免只為目錄分層增加 runtime dependency。
