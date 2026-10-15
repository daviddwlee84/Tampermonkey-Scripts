# Chat Reply Assistant：Grok／Character.ai adapters

**Status**: deferred
**Effort**: L
**Related**: [TODO.md](../TODO.md) · [研究紀錄](../userscripts/chat-reply-assistant/RESEARCH.md)

## Context

2026-09-25，AI 聊天網站先以 Gemini 實作：repo 已有 Gemini DOM exporter 與 YouTube→Gemini composer 操作可參考。Grok 與 Character.ai 保留後續研究，不因其他專案列為支援就宣稱本 userscript 已相容。

## Current evidence

- [OpenCLI Grok adapter](https://github.com/jackwener/OpenCLI/blob/main/clis/grok/utils.js) 提供 `/c/<id>`、ProseMirror composer、訊息識別與新 user turn 驗證的參考；其部分操作依賴頁面 Tiptap instance，不可直接假設 userscript sandbox 可用。
- 該專案等待回答的穩定文字輪詢只是 heuristic；不能把一段串流停頓當成完成，更不能直接據此送出下一則。
- 查閱到的部分 Character.ai addon 仍使用舊 beta 網站。官方已宣告 [old/beta 退役](https://support.character.ai/hc/en-us/articles/28987281244827-The-old-beta-has-been-fully-retired-Please-use-character-ai-or-the-mobile-app)，舊 selector 與私人 API 不作新 adapter 的依據。
- 尚無本 repo 對這兩站的登入 DOM、manager 操作或送出確認證據；目前保留 Gemini 的文字優先流程。

## Required adapter evidence

每站分別確認 route／新對話身分、目前對話訊息與角色、composer、附件草稿、原生 Send，以及 `idle / streaming / unknown` 的生成狀態。`send` 必須只 click 一次，並同時觀察新增本人訊息與草稿清空；結果不明不可補按 Enter 或重試。

需要合成 fixtures 與實頁兩層證據，至少包含多語系、串流長停頓、重新產生候選、改名／換對話、composer 被替換、分支、取消、背景分頁與未知送出。

## Decision

2026-09-25 deferred。預期先研究 Grok，再評估 Character.ai；新增網站時僅擴充必要的 `@match`，不連带導入遠端 adapter framework、網路攔截或網站登入 token。

接續第一步：在使用者可提供的登入頁面做只讀 DOM 探查，記錄匿名化結構、版本日期與可存取性訊號；先完成 capture／insert，再驗證生成完成與單次送出，最後才測有限輪數自動往返。
