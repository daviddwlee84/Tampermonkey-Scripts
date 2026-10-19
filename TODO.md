# TODO

Tampermonkey Scripts 的長期待辦索引；維護方式見 [CLAUDE.md](CLAUDE.md)。
目前實作與使用說明放在各 userscript 的 README；尚未安排的研究放在 [backlog/](backlog/)。

優先序：P1 下一批、P2 可安排、P3 日後可做、P? 先研究。
規模：S 一小時內、M 半天、L 數天、XL 架構調整。P? 項目使用 `[?/規模]`。

## P1

## P2

- [ ] **[L] ChatGPT Export Intelligent UI HTML 快照** — 選擇性匯出網頁版已渲染的卡片／雙欄等版面為自包含 HTML；v1.5.0 只用 fallbackMarkdown，完整 DIL 保存在 .json。需處理 virtualized 列表與 inline CSS。
- [ ] **[S] ChatGPT Export 生圖輸出圖片打包** — 把工具產生的圖片（tool message 的 image_asset_pointer）納入預設 transcript 與 ZIP；需要含生圖的原始 JSON 樣本驗證。
- [ ] **[M] LLM provider 共用層** — 把 chat-reply-assistant 與 etherscan-tx-explainer 各自複製的 provider 設定、endpoint 驗證、key 綁定與模型清單解析抽成 shared/llm-providers.js；需處理兩支腳本不同的 settings 版本與各自的 BEGIN PROVIDERS 測試。

## P3

- [ ] **[M] Vimium C Companion 常駐完整雙欄小抄** — 讓使用者可切換為常駐完整總表；v0.1 保留分類小抄與可展開的完整查詢。
- [ ] **[L] Vimium C Companion 任務式練習卡** — 增加逐步練習與進度保存；沒有原生執行回饋時使用手動完成確認。 → [research](backlog/vimium-c-companion-practice.md)
- [ ] **[L] Chat Reply Assistant 個人口吻模擬** — 評估使用者選定範例、可編輯 style profile 與情境差異，保留目前全域／個別聊天 prompt 作為第一版。 → [research](backlog/chat-reply-assistant-voice-style.md)

## P?

- [ ] **[?/XL] Vimium C Companion 互動橋接** — 評估合作 extension 或直接改為 Companion WebExtension，確認可執行命令與狀態回饋的邊界。 → [research](backlog/vimium-c-companion-bridge.md)
- [ ] **[?/L] Media Helper 串流完整下載** — 評估未加密 VOD HLS 分段下載與封裝，比較瀏覽器內處理與本機工具協作。 → [research](backlog/media-helper-stream-download.md)
- [ ] **[?/L] Chat Reply Assistant OpenCode bridge** — 研究將 OpenCode session/message API 轉成純文字 Chat Completions 的本機服務，驗證認證、工具限制與跨聊天隔離。 → [research](backlog/chat-reply-assistant-opencode-bridge.md)
- [ ] **[?/L] Chat Reply Assistant 自我續話與自由續聊** — 研究在沒有新對方訊息時的主動續話目標、停止條件與重複控制；目前只回覆新對方訊息及 Gemini 空白對話開場。 → [research](backlog/chat-reply-assistant-freeform.md)
- [ ] **[?/L] Chat Reply Assistant Grok／Character.ai adapters** — 取得當前登入頁的 DOM 證據，驗證串流完成、對話路由、草稿與單次送出確認，再擴充 Gemini 以外的 AI 聊天網站。 → [research](backlog/chat-reply-assistant-ai-platforms.md)
- [ ] **[?/L] Chat Reply Assistant 共用 adapter library** — 待更多網站與重用需求出現，再把單檔內 registry 抽成無副作用的共用依賴，評估版本、manager 快取與零建置發布流程。 → [research](backlog/chat-reply-assistant-adapter-library.md)

## Done
