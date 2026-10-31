# Grok Export Markdown

將 Grok 對話匯出為 Markdown、Agent Handoff 或 JSON，沿用 ChatGPT exporter 的浮動面板與 transcript 格式。

- **生效網站**：`https://grok.com/*`，功能僅在 `/share/<id>` 與 `/c/<id>` 啟用；涵蓋首頁是為了支援 SPA 導航。
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/grok-export-markdown/grok-export-markdown.user.js)（Tampermonkey / Violentmonkey）
- **原始碼**：[`grok-export-markdown.user.js`](./grok-export-markdown.user.js)
- **測試紀錄**：[`VALIDATION.md`](./VALIDATION.md)

## 使用方式

1. 開啟 Grok 分享頁或一般對話頁，等待內容載入。
2. 點右下角 **⇩ Export MD**，選擇動作；manager 選單也有相同操作。
3. 面板可用滑鼠／觸控拖曳，位置會記住。`Reset button position` 可還原位置。

| 動作 | 輸出 |
| --- | --- |
| Copy Markdown | YAML frontmatter + `_**User**_`／`_**Assistant**_` 對話，複製到剪貼簿 |
| Copy Agent Handoff | 同上，加上給 coding agent 的前情提要指示 |
| Download .md | 相同 Markdown，下載為 `grok-<標題>-<時間>.md` |
| Download .json | 分享 API 成功時為原始 JSON；DOM 備援時為明確標記的 `.dom-snapshot.json` |

所有資料只在目前分頁擷取與本機複製／下載，不傳送到其他服務，不建立分享連結。僅記住按鈕位置，不在 GM storage 保存對話。

## 資料從哪裡來

### 公開分享頁

按下匯出時，以同源 GET `/rest/app-chat/share_links/<完整 share ID>` 取得網站的公開快照；不需 token、攔截 fetch 或 `unsafeWindow`。保留原始 Markdown 與回傳順序，將 `human`／`assistant` 對應為 User／Assistant。

請求失敗（HTTP 錯誤、非 JSON、逾時等）時，只備援擷取**目前同一分享頁**的已載入 DOM，並明示降級。不會拿其他對話的快取替代。

原始 JSON 下載不依賴 Markdown 正規化，因此即使網站改了訊息格式，仍能保存可辨識的原始回應供後續處理。JSON 會含有正文匯出省略的 thinking／tool 等欄位，分享檔案前請自行檢查。

### 一般 `/c/<id>` 對話

首版只擷取已載入 DOM，不猜測登入後的私人 API，也不自動捲動補齊歷史。尚未完成真實登入 session 的 live smoke，請以匯出內容與原頁比對。

DOM 會先複製再清理，排除角色標籤、thinking 區、sources 按鈕、表格工具按鈕及腳本自己的面板。保留可辨識的標題、列表、code fence、表格、連結、正文圖片與 LaTeX annotation；renderer 的原始 Markdown placeholder 不會被當成空白或重複轉換。

DOM JSON 是 `grok-loaded-dom-v1` snapshot，含 capture time、URL、角色、response ID 與清理後的 HTML／Markdown 片段，**不是 API 原始 JSON**。HTML 片段是資料，不應直接當作可信 HTML 插入其他網站。

## 匯出範圍與限制

Markdown、Agent Handoff 與 `.md` 都含可見說明及 frontmatter：

| `export_scope` | `completeness` | 意義 |
| --- | --- | --- |
| `published-share-snapshot` | `unknown`，有未完成／省略內容時 `partial` | 僅網站回傳的公開快照，不保證完整私人歷史或所有分支 |
| `loaded-dom` | `partial` | 僅目前載入的訊息，未載入／收合／虛擬化內容可能缺漏 |

- 只匯出問答正文，不提供 thinking／tool 開關。已標記引用的可辨識 URL 才補為 Sources，不把全部搜尋候選結果當成引用。
- 私有 citation／widget 新格式可能原樣保留，未知訊息格式或附件參照會顯示限制；可下載原始 JSON 保存。
- 圖片與附件僅保留可辨識的網路參照，不下載附件或做 ZIP。DOM 的獨立附件區未支援；正文內的圖片可保留 URL。登入限定／有期限的 URL 不保證離線可用。
- 目前沒有對話樹、分支選取、archive、離線 viewer、任意 share URL 輸入或 X 內建 Grok 支援。
- 切換對話會取消尚未完成的匯出。若新 URL 仍顯示舊訊息而無法確認來源，會拒絕匯出並提示重新載入，不誤貼舊對話。
- 對話仍在生成時，DOM 可能只是當下的一部分；建議等回覆完成後匯出。API 的 `partial` 回覆會額外標示。
- 依賴 Grok 的非公開資料格式／DOM，網站改版可能失效；TM／VM 真實驗證與 fixture 證據分開記錄，不宣稱 Safari Userscripts 相容。
- `@require` 只載入 repo 共用 renderer 與面板；沒有新增第三方 runtime dependency 或跨域權限。

## 開發驗證

```bash
npm run test:grok-export
GROK_BROWSERS=chromium npm run test:grok-export
npm run verify
npm run preview -- grok-export-markdown "https://grok.com/share/bGVnYWN5_0031bed2-7d10-4f94-b312-51ba763328a8" --menu "Copy Markdown" --wait 20000
```

Preview 是 GM shim，不驗 manager 的 sandbox／grant／matching。匯出測試必須查看文字及下載 bytes，不能只看截圖。
