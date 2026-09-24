# Chat Reply Assistant OpenCode bridge

**Status**: P?
**Effort**: L
**Related**: [TODO.md](../TODO.md) · [Chat Reply Assistant](../userscripts/chat-reply-assistant/README.md) · [provider 研究](../userscripts/chat-reply-assistant/RESEARCH.md)

## Context

2026-09-24，使用者希望透過本機 LiteLLM、copilot-proxy 或 OpenCode，探索使用既有 subscription 的回覆服務。v0.1 的主模型 adapter 只接收完整 OpenAI-compatible Chat Completions endpoint；LiteLLM 和指定 copilot-proxy 有這類介面，OpenCode 原生 server 則沒有。

## Investigation

已查閱 [OpenCode Server](https://opencode.ai/docs/server/) 的官方文件，未啟動 server 或進行模型請求：

- `opencode serve` 的預設 host 為 `127.0.0.1`、port 為 `4096`。
- `OPENCODE_SERVER_PASSWORD` 啟用 HTTP Basic；username 預設 `opencode`，可另設環境變數。
- 建立 session 使用 `POST /session`，送入訊息使用 `POST /session/:id/message`；非同步另有 `prompt_async`。訊息是 `parts`，回傳也含 parts，不是 `choices[0].message.content`。
- `/doc` 提供 OpenAPI 規格，可用來核對安裝版本的實際接口。
- OpenCode 是 agent runtime，有工具、檔案、session 與 provider 設定。純聊天回覆應避免暴露不必要的執行能力，不能把私人聊天放進現有 coding session。

## Options considered

| Option                                                  | Pros                                                                       | Cons                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A. 另建本機 bridge，對 userscript 提供 Chat Completions | userscript 的 provider adapter 保持簡單；認證與 session 管理由本機服務負責 | 需要安裝、啟動、更新另一個程式                                                |
| B. userscript 直接實作 OpenCode session/message adapter | 少一個本機程序                                                             | userscript 需處理 Basic、session、parts、取消、權限與版本差異，超出 v0.1 範圍 |
| C. 直接用同一 upstream 的既有 Chat Completions proxy    | 若已存在，設定最少                                                         | upstream 能否使用 subscription 取決於實際服務，不能假設所有 provider 可通用   |

## Current blocker / open questions

- 目標 OpenCode 版本、provider 與登入方式尚未選定；沒有 subscription 可用性的端到端證據。
- 需要確認純文字、無工具呼叫的 agent 設定方式，以及 upstream 如何處理 system prompt。
- 新建 ephemeral session 與每聊天持續 session 的隱私、成本、跨聊天隔離取捨；預設應避免混入 coding 專案上下文。
- 確認 timeout、取消、provider 錯誤與訊息重試不會造成重複回覆或持續執行。
- 驗證 bridge 只監聽 loopback、由自己的認證控制，不開放整個 OpenCode 管理 API。

本項不是要求 userscript 取得或匯出 CLI token。subscription 使用能力應由 runtime 自己的正式 provider／登入流程承擔。

## Decision (if any)

2026-09-24 needs evaluation — 先保留 A 為評估方向；v0.1 不提供 OpenCode preset，也不把 `http://localhost:4096` 誤寫成 Chat Completions endpoint。

第一步：在隔離工作目錄啟動明確版本的 OpenCode，讀取 `/doc`，用 synthetic message 驗證「無工具純文字回覆」及 session 清理；先不使用真實私人聊天。確認可以得到穩定的三個文字候選後，再定義 bridge 的 `POST /chat/completions` 介面與取消行為。

至少測試：兩個不同聊天交錯請求不串線、失敗與取消後不留下持續工作、upstream 無額度／登入失效、含 prompt injection 的聊天內容不能引發工具執行、回傳無文字或多個 parts 的解析。

## References

- [OpenCode Server](https://opencode.ai/docs/server/)：啟動、Basic 認證、session/message API 與 OpenAPI。
- [LiteLLM quick start](https://docs.litellm.ai/docs/proxy/quick_start)：v0.1 已有的 OpenAI-compatible 路徑。
- [rezrov/copilot-proxy](https://github.com/rezrov/copilot-proxy)：另一個可獨立配置的本機服務，不等同 OpenCode bridge。
