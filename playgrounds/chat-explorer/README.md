# 對話樹瀏覽器

ChatGPT Export Markdown 的額外瀏覽／選取模式與離線入口共用同一套元件。
`npm run build:chat-explorer` 產生 `dist/conversation-explorer.html`，可連同 JSON 存檔帶到另一台電腦，
直接以瀏覽器開啟，不需 Node、伺服器或網路。開發時也可直接開啟此目錄的 `index.html`。

第一版讀取單份 ChatGPT 對話，支援本 repo 舊有 Download .json 與下列 archive v1；
不包含 ChatGPT 帳號整批匯出 ZIP、跨存檔合併、內容編輯或附件打包。

## Archive v1

副檔名為 `.chat-archive.json`，UTF-8 JSON：

```json
{
  "format": "chat-export-archive",
  "version": 1,
  "source": {
    "provider": "chatgpt",
    "conversationId": "source-conversation-id",
    "title": "Conversation title",
    "url": "https://chatgpt.com/c/source-conversation-id",
    "capturedAt": "2026-09-14T00:00:00.000Z",
    "type": "backend-api",
    "coverage": "returned-nodes"
  },
  "graph": { "roots": [], "currentNodeId": null, "nodes": {}, "blocks": {} },
  "raw": {},
  "selection": {
    "blockIds": [],
    "options": { "showTools": false, "showThinking": false, "includeResearchDetails": false }
  }
}
```

- `nodes` 以原始 mapping key 作 ID。節點為 `{ id, parentId, children, blockIds }`，
  children 順序依來源保留；找不到 parent 時設為根並保留 `missingParentId`。
  父子關係、引用、重複 ID、循環與不支援的版本會在匯入時驗證。
- `blocks` 是可勾選的整則訊息／整份報告。每個 block 包含
  `id, nodeId, messageId, kind, category, role, model, time, markdown, details`。
  `kind` 為 `message`、`research`、`research-state` 或 `error`；category 為 dialogue／tool／thinking。
- 一般 block ID 為編碼後的 `message:<nodeId>`；研究 block ID 為
  `report:<nodeId>:<reportId 或 instanceKey>`。工具 host 與其研究報告可分別選取，
  原始父子邊不因內嵌報告而改寫。
- 研究另外保留 `reportKey, instanceKey, score` 供路徑內快照選擇。
  同一路徑以最新 completed 報告為預設，保留首次出現的位置；儲存層不刪除其他快照或其他分支。
- `graph` 是本版本閱讀及匯出的契約，`raw` 是完整來源備份。開啟 archive 不會重新解析 raw，
  因此新版 ChatGPT 私有格式不會讓已保存的 graph 失去可讀性。
- `selection.blockIds` 是明確集合；path 是批次加入集合的操作，不是持續追蹤新訊息的訂閱。
  篩選只控制顯示，已勾選但隱藏的 block 仍會匯出。儲存空集合後匯入，不會重新預選 path。
- 未知訊息內容沿用原 exporter 的 JSON code block 保留方式；研究解析失敗存成帶 `error` 文字的 block，
  不丟掉其 raw。選到錯誤 block 時，部分 Markdown 匯出會停止並說明原因。

## 共用程式與交付

- `shared/chatgpt-adapter.js`：原 ChatGPT 純轉換層，仍供一般一鍵匯出使用。
- `shared/conversation-archive.js`：建立／驗證存檔、取 path、明確選取與分支 Markdown。
- `shared/conversation-explorer.js`：隔離的 Shadow DOM 介面；頁內使用 dialog，離線使用完整頁面。
- `shared/vendor/`：固定版本的 Marked、DOMPurify、授權及 checksum manifest。
- `scripts/build-chat-explorer.mjs`：核對 vendor checksum，把同一套來源嵌入單一 HTML，保留授權文字。

預覽與下載使用相同 Markdown 結果；檔頭在預覽中收合為「匯出檔資訊」。
Markdown 先解析再 sanitize，來源 HTML、外部圖片或附件不會執行或自動連網。
瀏覽器拒絕剪貼簿時改為可全選的 textarea；下載不依賴 Clipboard API。

```bash
npm run test:chat-explorer
npm run test:chatgpt-export
npm run build:chat-explorer
npm run verify
```

一般 userscript 的安裝仍需發布其對應的 `shared/` 相依檔案；單獨更新 `.user.js` 而缺少新依賴，
無法完成更新。離線 HTML 已包含這些依賴，可獨立使用。
