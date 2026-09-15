# arXiv AI Assistant

在 arXiv 的 **Access Paper** 清單加入淡紫色的「AI 論文助手 · Userscript」區塊。

| 按鈕 | 功能 |
| --- | --- |
| **papers.cool** | 新分頁開啟同篇論文，自動展開網站的 Kimi FAQ |
| **Kimi 摘要** | 新分頁開啟 Kimi，帶入論文背景並自動送出繁中摘要請求 |
| **Gemini 摘要** | 新分頁開啟 Gemini，帶入同樣背景並自動送出 |

- **生效網站**：`https://arxiv.org/abs/*`、`https://papers.cool/arxiv/*`、`https://gemini.google.com/app*`
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js)（需先裝好 Tampermonkey / Violentmonkey；連結於發佈到 main 後可用）
- **原始碼**：[`arxiv-ai-assistant.user.js`](./arxiv-ai-assistant.user.js)

## 使用方式

1. 要使用聊天摘要，先登入 Kimi 或 Gemini。
2. 開啟 arXiv 論文摘要頁，例如 <https://arxiv.org/abs/2609.12303v1>。
3. 在 Access Paper 下方選擇入口；三個按鈕都會開啟新分頁。
4. papers.cool 顯示 FAQ 後，可手動點網站原有的 Kimi 續聊連結。Kimi／Gemini 的摘要完成後，可直接繼續追問。

聊天提示包含題名、頁面摘要、arXiv 頁面、指定版本 PDF 與 papers.cool FAQ 連結，要求以繁體中文整理研究問題、方法、主要結果與限制。提示也要求 AI 說明是否讀得到全文／FAQ，並區分論文內容與推測。

腳本保留網址上的 `v1`、`v2` 等版本，不使用可能省略版本的 metadata 建立 PDF URL。例如：

```text
https://arxiv.org/abs/2609.12303v1
  → https://papers.cool/arxiv/2609.12303v1#arxiv-ai-assistant=faq
```

papers.cool 頁內使用不帶版本的論文 ID；腳本據此尋找對應的 Kimi 按鈕。只有帶上述標記才會自動展開，並且會在啟動前清除標記。直接輸入網址或開啟普通書籤不會自動展開。

## Gemini 交接與失敗處理

同一支腳本在 arXiv 寫入兩分鐘有效的 GM storage，再開啟帶隨機 request ID 的 Gemini 新對話分頁。只有對應的分頁會消費這筆資料，使用獨立 namespace，可與本 repo 的 YouTube Gemini Summary 同時安裝。

- 一次只接受一筆待處理的 Gemini 請求；前一筆完成或過期後即可再次開啟。
- 只在 Gemini `/app` 新對話填入；已有文字或附件草稿時保留原內容。
- 確認完整提示與 Send 按鈕後，先刪除待處理請求，再點擊一次 Send；重新整理不會自動重送。
- 找不到輸入框、未登入、逾時或送出狀態不明時，顯示完整提示與操作說明，並嘗試複製到剪貼簿。也可按「再次複製」。
- 若提示已在輸入框或可能已送出，依提示先檢查目前對話，避免手動重複貼上。

## 權限與限制

| Grant | 用途 |
| --- | --- |
| `GM_addStyle` | 按鈕與操作提示 |
| `GM_setValue` / `GM_getValue` / `GM_deleteValue` | 短效論文背景與 Gemini 請求交接 |
| `GM_openInTab` | 開啟新的前景分頁 |
| `GM_setClipboard` | Gemini 操作失敗時保留可手動貼上的提示 |

- 可單獨安裝，不依賴其他腳本，也不需要模型 API key。
- Kimi 使用網站的 HTTPS `/_prefill_chat?prefill_prompt=…&send_immediately=true`；提示包含在 URL query 中，登入與送出由 Kimi 處理。腳本不會在 Kimi 頁面注入，也無法確認它是否成功送出。
- Gemini URL fragment 只帶 request ID，論文背景存於腳本自己的 GM storage。未消費的資料會在下次使用時清理；超過兩分鐘的請求不會自動送出。
- papers.cool 的自動展開等同點擊原生 Kimi 按鈕，可能觸發網站的生成排隊與使用計數。生成失敗時依網站提示操作，腳本不會重複點擊。
- papers.cool 可能未收錄某篇論文；其 FAQ 可能尚未生成，也可能與指定版本不同。PDF 連結保留指定版本，FAQ 使用不帶版本的 ID。
- 背景使用題名、摘要及連結；腳本不下載、上傳 PDF，也不預先抓取 FAQ 全文。AI 能讀到多少內容取決於各服務。
- arXiv 按鈕只加在 `/abs/` 摘要頁。網址處理支援新式 ID 與 `hep-th/9901001` 等舊式 ID。
- Gemini composer 與 papers.cool 按鈕屬網站 DOM，網站改版後可能需要更新 selector。Kimi 的 prefill 行為也由網站決定。

## 開發與驗證

```bash
node --test scripts/test-arxiv-ai-assistant.mjs
npm run preview -- arxiv-ai-assistant https://arxiv.org/abs/2609.12303v1
npm run verify
```

測試使用 Playwright 的隔離頁面與 GM API 模擬，涵蓋版本／特殊字元、按鈕去重、FAQ 標記、Gemini 指定分頁、草稿保護、過期及單次送出，不連線至 AI 服務。首次使用需安裝 repo dependencies 與 Playwright Chromium。

真實 manager 的跨站 storage／權限與登入行為仍需分別在 Tampermonkey、Violentmonkey 驗證；`preview` 與隔離測試不能替代實際 manager 測試。
