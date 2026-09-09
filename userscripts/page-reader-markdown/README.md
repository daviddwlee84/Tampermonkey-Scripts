# Page Reader & Markdown

直接從目前瀏覽器分頁擷取乾淨正文，提供專注閱讀、Markdown 複製／下載，以及包含圖片與文件附件的 ZIP。

若只需要預覽／儲存頁面圖片與直接影片，可使用 [Media Helper](../media-helper/)，支援選擇圖片版本與多選逐檔下載。

- **安裝**：[Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-reader-markdown/page-reader-markdown.user.js)
- **生效網站**：所有 HTTP／HTTPS 頂層 HTML 頁面。
- **目標環境**：桌面 Arc／Chromium、Zen／Firefox；Tampermonkey 或 Violentmonkey。
- **原始碼**：[page-reader-markdown.user.js](./page-reader-markdown.user.js)

## 使用方式

1. 開啟並載入文章。微信文章直接使用你已開啟的分頁，不需要把 URL 交給遠端服務。
2. 點側邊書本按鈕進入 Reader；再次點擊、按 Esc 或點「返回原頁」退出。
3. 滑鼠移入按鈕，或以 Tab 聚焦，展開複製／下載選項。按鈕可拖曳，位置會記住。
4. 自動擷取範圍不理想時，先在原頁圈選內容，再把面板的「擷取範圍」改為「目前圈選」。後續閱讀、複製及下載都使用此範圍。

| 操作 | 輸出 |
| --- | --- |
| 複製 Markdown | YAML metadata、正文 Markdown、圖片及文件網址 |
| 複製僅正文 | 標題、段落、列表、表格、程式碼及文字超連結；移除 metadata 與圖片引用 |
| 下載 Markdown | 與完整複製相同，儲存為 `.md` |
| 完整本機匯出 · ZIP | `article.md`、`attachments/`、`export-report.json` |
| 更多與閱讀設定 | 複製 URL／Markdown link、隱藏本站按鈕、調整字級與主題 |

Reader 預設字級 20px、行高 1.8、正文最大寬度 760px。字級與亮暗主題會記住，主題預設跟隨系統；表格與程式碼可橫向捲動。

所有主要操作也有 userscript manager 選單入口。隱藏按鈕後可用「顯示本站按鈕」恢復；「重設按鈕位置」恢復預設位置。沒有可擷取正文時會提示圈選，不會直接把整頁導覽當成文章複製。

## 原文快照與 Immersive Translate

```text
目前分頁 DOM → 清理後的原文快照 ─┬→ Markdown／ZIP
                               └→ Reader 副本 → Immersive Translate
```

建議先開啟 Reader，再以 Immersive Translate 原有按鈕／快捷鍵啟動雙語翻譯。翻譯只改變 Reader 副本，複製與下載始終使用原文快照。調整 Reader 字級及主題也不會重新建立正文，不會清掉已產生的譯文。

若原頁已翻譯，腳本會排除已辨識的 Immersive Translate 譯文容器，並在副本中恢復被隱藏的原文。此相容處理依賴擴充套件的 DOM 標記；若原文擷取不完整，請先恢復原文，再開 Reader。

Reader 正文是一般 DOM 的 `<article id="page-reader-markdown-content">`，控制面板放在 open Shadow DOM，避免被網站 CSS 或翻譯混入。自動辨識不理想時，可參考 Immersive Translate 的[進階自訂規則](https://immersivetranslate.com/en/docs/advanced/)，在 Developer Settings → Edit User Rules **加入**以下規則，保留原有的其他規則：

```json
[
  {
    "selectorMatches": "#page-reader-markdown-reader",
    "selectors": ["#page-reader-markdown-content"],
    "excludeSelectors.add": [
      "#page-reader-markdown-dock",
      "#page-reader-markdown-reader .prm-toolbar",
      "#page-reader-markdown-reader .prm-meta",
      "#page-reader-markdown-content pre",
      "#page-reader-markdown-content code"
    ]
  }
]
```

`selectorMatches` 將規則限定於 Reader 容器存在時。使用者仍從 Immersive Translate 啟動翻譯；本腳本不控制擴充套件設定，也不呼叫翻譯 API。實機上需確認擴充套件在 Reader 開啟／關閉後重新辨識規則，必要時關閉再啟動翻譯。

## Markdown 與附件

metadata 包含 `title`、`url`、`site`、`author`、`published_at`、`captured_at`、`lang`、`scope`、`extraction`。未知欄位省略；發表時間沿用來源字串，擷取時間使用 ISO UTC。來源 URL 保留 query，避免破壞微信文章識別碼或帶簽章的連結。

正文經 Readability／微信 adapter／語意化容器擷取，再以 DOMPurify 清理、Turndown＋GFM 轉換。相對連結會轉為絕對網址，支援 `data-src` 等 lazy-load 圖片。一般表格使用 GFM，合併儲存格表格保留清理後的 HTML。圈選輸出會標記 `scope: selection`。

ZIP 解壓後的結構：

```text
文章標題-擷取時間/
  article.md
  attachments/
    001-photo.png
    002-文件.pdf
  export-report.json
```

- 下載正文中的圖片，以及明確連結的 PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、ODT/ODS/ODP、RTF、TXT、Markdown、CSV、EPUB。也檢查帶 `download` 屬性的連結，依回應格式決定是否收錄。
- 以完整 URL（保留 query、移除 fragment）去重。同名檔案使用序號區分；Markdown 改用相對路徑，PDF 的 `#page=…` 仍保留。
- 影片、音訊、一般網頁超連結保留網址，不遞迴抓取連結頁面。正文中無法辨識為檔案的下載連結也保留網址。
- 最多 3 個附件並行下載；每個請求逾時 30 秒；單檔上限 50 MiB，附件總計 200 MiB。面板或 manager 選單可取消匯出。
- 失敗、超限、未獲授權的附件保留原網址，其餘內容照常打包。報告的 `complete`、`saved`、`failed` 和逐檔原因可用來確認離線完整度；登入／錯誤 HTML 不當成文件保存。
- 已在畫面顯示的跨站圖片，仍可能無法重新取得檔案；快取與圖片顯示成功不代表附件請求一定成功。失效的 `blob:` URL 也會列為失敗。

## 權限與依賴

正文擷取與 Markdown 轉換在本機執行，不重新請求文章 URL。Reader 的圖片依原網址顯示；只有啟動 ZIP 時才主動下載快照中的附件。`GM_setClipboard` 寫入剪貼簿；`GM_getValue`／`GM_setValue` 儲存位置、外觀與本站隱藏偏好；`GM_registerMenuCommand` 提供選單入口。

ZIP 使用 `GM_xmlhttpRequest`。因為通用文章的圖片與文件可能位於任意 CDN，宣告 `@connect *`；manager 仍可能要求允許特定附件網域，拒絕後會列入失敗清單。

固定版本的 `@require`：Readability 0.6.0、DOMPurify 3.4.15、Turndown 7.2.4、turndown-plugin-gfm 1.0.2、JSZip 3.10.1。由 jsDelivr 載入，manager 通常會快取；首次安裝或更新時需要能連到 CDN。repo metadata 檢查會提示這五項外部依賴警告，屬於已知配置。

## 驗證與限制

```bash
npm ci
npx playwright install chromium firefox
npm run test:page-reader
npm run verify

# 只跑其中一個瀏覽器引擎
PRM_BROWSERS=chromium npm run test:page-reader

# 使用既有 preview harness；請給出實際文章 URL
npm run preview -- page-reader-markdown 'https://example.com/article' \
  --menu '複製 Markdown' --wait 3000
```

測試使用固定 HTML fixtures 與 GM shim，涵蓋正文／圈選、微信 metadata、Reader 原文隔離、翻譯容器清理、SPA、UI、ZIP 去重與相對路徑，以及逾時、超限、取消與部分失敗。依賴快取、Markdown、ZIP 及截圖放在 `.preview/page-reader-tests/`；首次執行需要網路取得固定版本依賴。

Playwright 能驗證 Chromium／Firefox 的 DOM 與下載邏輯，**不能證明真實 manager 的 sandbox、權限、選單或 Immersive Translate 相容性**。發布前的實機檢查：

1. Arc＋Tampermonkey、Zen＋Violentmonkey：一般文章與微信文章的 Reader、剪貼簿及 ZIP。
2. 在已登入分頁驗證跨站圖片與文件的權限、部分失敗提示及本機連結。
3. Reader 開啟後啟動 Immersive Translate，確認逐段雙語、原文匯出與返回原頁。

第一版只處理目前頂層頁面 DOM 中已有的內容。不自動捲動載入全文、翻頁或展開折疊區；不讀取跨來源 iframe、closed Shadow DOM、canvas／PDF 檢視器內的文字。一般文章及技術文件的自動判讀可能失準，可改用圈選。iPad、獨立翻譯 API、雙語匯出與媒體檔案備份不在第一版範圍。
