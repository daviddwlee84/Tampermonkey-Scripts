# arXiv AI Assistant

在 arXiv 的 **Access Paper** 清單加入淡紫色的「AI 論文助手 · Userscript」區塊。

| 按鈕 | 功能 |
| --- | --- |
| **papers.cool** | 新分頁開啟同篇論文，自動展開網站的 Kimi FAQ |
| **Kimi 摘要** | 新分頁開啟 Kimi，帶入論文背景並自動送出繁中摘要請求 |
| **Gemini 摘要** | 新分頁開啟 Gemini，帶入同樣背景並自動送出 |

在 **papers.cool 單篇論文頁**，標題列還會加入淡紫色的 **「↗ arXiv」** 按鈕與 Userscript 標示，方便回到 arXiv 摘要頁。按鈕會開啟新分頁，保留目前網址的版本號，例如 `2609.12303v1`；直接開啟 papers.cool 也會出現。

兩個網站都有 **論文資訊卡**，顯示首次提交、最新修訂、引用查詢與文獻探索入口。版本 **0.3.0** 新增這些功能。

版本 **0.4.0** 新增 **Google Scholar → arXiv／papers.cool** 按鈕，涵蓋搜尋結果、論文詳情與「重點速覽」側欄中可辨識的 arXiv 論文。

- **生效網站**：`https://arxiv.org/abs/*`、`https://papers.cool/arxiv/*`、`https://gemini.google.com/app*`，以及 Google Scholar 的 `/scholar`、`/citations` 頁面（支援 `scholar.google.com`、`.com.tw`、`.com.hk`、`.co.uk`）
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js)（需先裝好 Tampermonkey / Violentmonkey；連結於發佈到 main 後可用）
- **原始碼**：[`arxiv-ai-assistant.user.js`](./arxiv-ai-assistant.user.js)

## 使用方式

1. 要使用聊天摘要，先登入 Kimi 或 Gemini。
2. 開啟 arXiv 論文摘要頁，例如 <https://arxiv.org/abs/2609.12303v1>。
3. 在 Access Paper 下方選擇入口；三個按鈕都會開啟新分頁。
4. papers.cool 顯示 FAQ 後，可手動點網站原有的 Kimi 續聊連結。Kimi／Gemini 的摘要完成後，可直接繼續追問。
5. 在 papers.cool 點「↗ arXiv」可回到對應版本的原始論文頁。
6. 查看資訊卡中的首次提交與最新修訂日期；目前閱讀舊版本時，會提供最新版本入口。
7. 按「查詢引用」取得被引用數與已收錄的參考文獻數；展開「上游／下游」查看相關論文清單。也可直接開啟 Google Scholar、Semantic Scholar 或 Connected Papers。
8. 在 Google Scholar 的結果旁，或展開「重點速覽」後的 PDF 連結旁，點「↗ arXiv」或「papers.cool」前往對應論文。

聊天提示包含題名、頁面摘要、arXiv 頁面、指定版本 PDF 與 papers.cool FAQ 連結，要求以繁體中文整理研究問題、方法、主要結果與限制。提示也要求 AI 說明是否讀得到全文／FAQ，並區分論文內容與推測。

腳本保留網址上的 `v1`、`v2` 等版本，不使用可能省略版本的 metadata 建立 PDF URL。例如：

```text
https://arxiv.org/abs/2609.12303v1
  → https://papers.cool/arxiv/2609.12303v1#arxiv-ai-assistant=faq
```

papers.cool 頁內使用不帶版本的論文 ID；腳本據此尋找對應的 Kimi 按鈕。只有帶上述標記才會自動展開，並且會在啟動前清除標記。直接輸入網址或開啟普通書籤不會自動展開，但仍會顯示「↗ arXiv」按鈕。分類／搜尋列表頁不加入返回按鈕。

## Google Scholar 跳轉

淡紫色按鈕附有 **Userscript** 標示，皆開啟新分頁；`papers.cool` 入口會延續自動展開 Kimi FAQ 的行為。

| 位置 | 論文辨識來源 |
| --- | --- |
| 搜尋結果（含引用／相關文章列表） | 該筆結果的標題與右側 PDF 連結 |
| 「重點速覽」側欄 | 底部原生 PDF 按鈕指向的論文 |
| Scholar 論文詳情 | 該篇論文標題的外部連結 |

- 支援 arXiv `/abs/`、`/pdf/`、`/html/`，包含舊式 ID、版本號、`.pdf` 副檔名，以及 Scholar 的 `/scholar_url?url=…` 轉址。
- 依實際論文連結辨識，保留其中的版本。搜尋框題名、摘要中提及的其他論文與 AI 回覆中的引用，都不作為這篇論文的 ID。例如搜尋 `2609.12303` 時，若某筆結果連到 `2602.01007`，按鈕就會開啟 `2602.01007`。
- 沒有 arXiv 連結，或標題／PDF 指向不同 arXiv 論文時，不顯示按鈕。尚未從期刊 DOI 或題名推測其 arXiv 版本。
- 搜尋結果延遲載入、側欄換篇與頁面恢復時會更新按鈕；操作時再次核對 ID，避免點到前一篇的連結。
- Scholar 頁面只新增導覽入口，不自動查詢引用 API。原生「被引用」、「相關文章」與「重點速覽」操作保留；重點速覽的登入資格、生成與內容由 Google 處理。
- 已核對公開頁面的側欄結構，並測試 PDF 連結切換；登入後的完整重點速覽流程尚未實測，詳見 [驗證紀錄](./VALIDATION.md)。

## 論文資訊與引用探索

| 資訊／入口 | 行為 |
| --- | --- |
| 首次提交 | 讀取 arXiv 的 v1 提交日期並計算距今天數／年數；不是期刊出版日期 |
| 最新修訂 | 讀取 arXiv Submission history 中最高版本的時間，與目前網址版本分開顯示 |
| 查詢引用 | 優先用 arXiv ID 查 Semantic Scholar；失敗時搜尋 OpenAlex，核對其 arXiv 來源連結後才採用 |
| 上游 | 本篇論文引用的研究（references），展開才查詢，最多顯示 20 篇 |
| 下游 | 引用本篇的研究（citations / cited by），展開才查詢，最多顯示 20 篇 |
| Google Scholar | 以完整題名搜尋；在 Scholar 查看 Cited by、Related articles 與其他版本 |
| Semantic Scholar | 使用 arXiv 原站採用的 ID 跳轉入口，開啟對應文獻紀錄 |
| Connected Papers | 以 arXiv ID 開啟相似論文圖譜；連線表示相似性，不代表直接引用 |

- 在 arXiv 直接讀取頁面日期；在 papers.cool 會匿名讀取一次對應 arXiv 摘要頁。只使用核對過 ID 的結果，不把 papers.cool 的日期或 arXiv 編號月份當成完整版本紀錄。
- 日期與引用結果跨 arXiv／papers.cool 共用 **24 小時快取**，最多保留 60 筆日期／引用項目。「更新引用資料」可手動重新查詢。只儲存成功核對的資料，快取失敗不影響使用。
- 引用 API **按需查詢**，開頁不自動查引用；不需設定 API key。匿名服務仍可能限流或限制存取，此時保留外部入口。Semantic Scholar 回傳 429 後會暫停向它查詢至少一分鐘，期間使用 OpenAlex 備援。
- 顯示資料庫名稱與查詢時間（UTC）。數量依資料庫的收錄與版本合併方式而異，**不是 Google Scholar 引用數**；也不是特定 `v1`／`v2` 的獨立統計。
- OpenAlex 題名搜尋只用來找候選，必須有唯一符合 arXiv ID 的來源紀錄；同名、無法核對或多筆符合時都不猜測。搜尋前 10 筆沒有符合結果，不代表資料庫一定未收錄。
- 「未提供」、查詢失敗與真正的 `0` 分開顯示。新論文可能尚未收錄，參考文獻也可能未完整辨識；清單與統計更新可能不同步。
- OpenAlex 的上游清單優先依引用數排序，下游依出版日期排序；Semantic Scholar 保留 API 預設順序。顯示的前 20 篇不是完整引用圖譜，可前往資料來源繼續探索。

介接依據：[arXiv 範例頁的引用入口與版本紀錄](https://arxiv.org/abs/1706.03762v1)、[Google Scholar 搜尋說明](https://scholar.google.com/intl/en/scholar/help.html)、[Semantic Scholar API schema](https://api.semanticscholar.org/graph/v1/swagger.json)、[OpenAlex 引用欄位](https://help.openalex.org/data/works/citations/)。

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
| `GM_setValue` / `GM_getValue` / `GM_deleteValue` | 短效論文背景、Gemini 交接、論文資訊快取與查詢限流紀錄 |
| `GM_openInTab` | 開啟新的前景分頁 |
| `GM_setClipboard` | Gemini 操作失敗時保留可手動貼上的提示 |
| `GM_xmlhttpRequest` | 匿名讀取 arXiv 提交紀錄、Semantic Scholar／OpenAlex 的引用資料 |

跨站權限限於 `arxiv.org`、`api.semanticscholar.org`、`api.openalex.org`。查詢會把 arXiv ID 傳給 Semantic Scholar，備援搜尋會把論文題名傳給 OpenAlex。更新至 0.3.0 時，manager 可能提示確認新增的跨站權限。

0.4.0 新增上述 Google Scholar 網站的執行範圍，未新增 GM grant 或跨站資料來源；manager 可能提示網站權限變更。

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
US_BROWSER=firefox node --test scripts/test-arxiv-ai-assistant.mjs
npm run preview -- arxiv-ai-assistant https://arxiv.org/abs/2609.12303v1
npm run verify
```

測試使用 Playwright 的隔離頁面與 GM API 模擬，涵蓋版本／特殊字元、按鈕去重、FAQ 標記、Gemini 指定分頁、草稿保護、過期及單次送出，以及日期、快取、引用方向、OpenAlex ID 核對、限流／逾時與過期頁面回應。Scholar 測試另涵蓋連結核對、側欄換篇、動態插入、快取 DOM 還原、區域網域、頁面恢復與窄版排列。不連線至 AI 或文獻 API。首次使用需安裝 repo dependencies 與對應的 Playwright Chromium／Firefox。

0.4.0 已通過 Chromium 的 28 項隔離測試。真實 manager 的檢查範圍與環境限制見 [驗證紀錄](./VALIDATION.md)。Violentmonkey、Firefox 及登入後的 Kimi／Gemini 送出尚未實測；`preview` 與隔離測試不能替代實際 manager 測試。
