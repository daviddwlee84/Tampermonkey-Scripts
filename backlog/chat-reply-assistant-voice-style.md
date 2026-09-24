# Chat Reply Assistant 個人口吻模擬

**Status**: deferred
**Effort**: L
**Related**: [TODO.md](../TODO.md) · [Chat Reply Assistant](../userscripts/chat-reply-assistant/README.md) · [研究來源](../userscripts/chat-reply-assistant/RESEARCH.md)

## Context

2026-09-24，使用者希望聊天回覆符合自己的習慣，例如不用標點；並明確把「完整模擬自己的口吻」留為 future work。v0.1 先提供全域 system prompt 與依穩定 thread ID／URL 儲存的個別聊天覆寫，不自動建立個人口吻模型或長期聊天資料庫。

## Investigation

目前已有可插入風格規則的主 LLM prompt。聊天捕捉只覆蓋已載入文字，分頁 RAM 有 500 則／聊天、5 個聊天上限，不能假設其中的訊息代表使用者長期風格。

- 自己對朋友、同事與群組的口吻可能不同；對單一對象有效的風格不應默默套用所有聊天。
- 先選出「使用者自己寫的」範例，避免把對方訊息、引用、模型建議或未傳送草稿當成口吻訓練資料。
- 全域與 per-thread prompt 是目前可用的控制面，未來 style profile 需要決定與這兩者的優先關係。
- Jev 能評估有界的文字特徵，但不生成文字，且官方不提供每位客戶的 fine-tuning／LoRA；回覆模仿仍應由 generative LLM 完成。[TypeSafe Models](https://docs.typesafe.ai/models)

## Options considered

| Option                                              | Pros                                          | Cons                                                         |
| --------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| A. 使用者手選少量自己的訊息，作為 few-shot examples | 可檢查、可撤回、不需要另存完整聊天            | 範例挑選費工；每次請求增加內容與 token                       |
| B. 從手選範例抽出可編輯 style profile               | 更精簡；可以把標點、長度、emoji、用語逐項修正 | 抽象化可能抹去情境差異；需要與原始範例比較                   |
| C. 長期累積自己訊息並檢索相似情境                   | 能涵蓋更多場景                                | 超出目前資料生命週期；增加保存、刪除、錯誤歸屬與個資處理負擔 |
| D. fine-tuning                                      | 可能減少長 prompt 的需要                      | 特定 provider 才能用，資料量與維護成本高，沒有本專案品質證據 |

## Current blocker / open questions

- 口吻像本人與回覆有幫助是兩個指標，如何讓使用者快速評選而不誘導選擇？
- 需要多少且哪些情境的範例，才能優於目前手寫 prompt？
- style profile 是否區分全域、對象或情境；可否查看、編輯、刪除及匯出？
- 怎麼驗證「不加句尾標點」等明確規則，以及不該照搬的舊承諾、人名、事實？

這些是尚未排程的產品與品質研究，沒有阻擋 v0.1 的三個回覆流程。

## Decision (if any)

2026-09-24 deferred — v0.1 保留手寫 prompt。接續時先以 A＋B 小規模原型比較「只有手寫 prompt」與「加入使用者手選範例／可編輯 profile」，不直接開始 C 或 D。

第一步：請使用者自行選定少量可供測試、去識別的本人訊息，涵蓋至少朋友聊天與一個不同情境；建立離線測試樣本與盲選方式，確認是否帶來可辨識的改善，再決定持久化介面。

## References

- [Chat Reply Assistant README](../userscripts/chat-reply-assistant/README.md)：目前 prompt 與資料生命週期。
- [TypeSafe Models](https://docs.typesafe.ai/models)：Jev 的 request-based customization 與語言限制。
- [Jev generation 限制](https://docs.typesafe.ai/model-jaggedness/jev-1.13#generation)：自然語言生成需要其他模型。
