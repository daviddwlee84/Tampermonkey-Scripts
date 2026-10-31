# Grok exporter 合成 fixtures

觀察日期：2026-10-31。

公開結構參考：
<https://grok.com/share/bGVnYWN5_0031bed2-7d10-4f94-b312-51ba763328a8>

此處只保留觀察到的 API／DOM 結構；所有訊息、ID、時間、標題與來源均為精簡合成資料，沒有保存公開範例的完整對話，也沒有私人對話或憑證。

- `share.json`：同源 `/rest/app-chat/share_links/<id>` 的 `{ conversation, responses }` 結構。包含原始 Markdown、反向時間戳（必須維持 API 陣列順序）、已引用／未引用來源，以及 control、tool、thinking、未知角色的排除案例。
- `conversation.html`：已觀察的 message selector、`.response-content-markdown` 與 `response-*` ancestor，搭配合成的表格、code、列表、數學、圖片與互動控制項。`/c/fixture` 使用同一結構來驗證 loaded-DOM contract，**不是**登入後 `/c/` DOM 的實測證據。
- `placeholders.html`：原始 `.invisible.whitespace-pre-wrap` 單獨存在，以及原始／已渲染內容同時存在的過渡狀態。

`tests/grok-export-markdown.test.mjs` 只允許明列的同源文件、合成圖片與分享 API route，其餘網路請求一律拒絕。每個案例以單一 init bundle 依序注入 GM shim、實際 `shared/chat-export.js`、`shared/export-ui.js` 與交付的 userscript；透過 manager menu callback 或真實面板按鈕檢查剪貼簿與瀏覽器下載 bytes。

這些 Chromium／Firefox fixture 測試不驗證真實 manager 的 metadata、sandbox、grant、安裝／更新，也不代表已完成登入後頁面或即時網站 smoke。
