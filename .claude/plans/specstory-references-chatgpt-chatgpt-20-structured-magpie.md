# chatgpt-export-markdown：Intelligent UI 支援 + 圖片 ZIP 匯出（v1.5.0）

## Context

GPT-6 的 Intelligent UI（DIL v2）回覆，用 v1.4.0 匯出後有兩個問題：(1) code block 整段消失；(2) `<box>`／`<row>`／`<Cite>`／`<AsyncImage>` 等 DIL JSX 原樣漏出。
另外，使用者上傳的圖片只輸出 `![image](sediment://file_…)`，這個連結點不開。

用同一篇對話的原始 JSON（`.specstory/references/chatgpt-ChatGPT介面原理解析-20261012-1256.json`）已確認以下事實：

- 有 DIL 的訊息帶 `metadata.model_dil_v2 = { code, constants, appData, fallbackMarkdown, fallbackMarkdownVersion: 1, requiredComponents, clientDefinedWidgets }`。
- **`fallbackMarkdown` 是 OpenAI 自己的 Markdown 降級版**：table、code fence、heading 都正確，只剩四種私有區 sentinel（`kindarg…`）需要解：
  - `url|title|https://…`：直接轉成 `[title](url)`
  - `cite|turnXviewY[|…]`：可多個 ref，可用 `appData.opGenui.componentResults[*]`（`componentName: "Cite"`）的 `state.items[].ref_id → url/title/source_label` 解出；`metadata.search_result_groups` 也有同樣的資料。這篇對話中 20/20 都解得出來。
  - `entity|["software","json-render","…"]`：JSON array，第二個元素是顯示文字
  - `image_group|{"query":[…],…}`：要對到 `AsyncImage` 的 componentResult（`state.images[].{url,title,content_url,thumbnail_url}`）。對應方式：`code` 裡 `jsx(AsyncImage,{"query":"…","__resolutionId":__dilConstants["N"]})`，再由 `constants[N]` 取得 componentResults 的 key。
- **code block 消失的根因**：`content_references` 多了 `type: "client_defined_widget", category: "code_block"`。這種 ref 的 `matched_text` 是整段 fence，`alt` 是 null；`applyCitations`（`shared/chatgpt-adapter.js:264`）把它換成空字串，於是整段被刪掉。
- 有 DIL 時 `content_references` 只有 widget 和 footnote，沒有 cite；cite 都寫在 DIL 的 JSX 或 sentinel 裡。
- `message_type: "next"` 的隱藏續寫訊息，原本就會被 `is_visually_hidden_from_conversation` 濾掉，不需要處理。
- 使用者圖片：part 是 `image_asset_pointer`（`sediment://file_…`），`metadata.attachments[]` 有 `id/name/mime_type`。

使用者已決定：
1. Markdown 一律改用 `fallbackMarkdown`，不額外保留 HTML／DIL 原始碼；`Download .json` 本來就完整保留 raw。
2. 新增 **ZIP bundle**（md + images/）來處理圖片。

## 變更

### 1. `shared/chatgpt-adapter.js`（P0，Markdown 與 explorer 共用）

- 新增 `dilFallback(message)`：當 `metadata.model_dil_v2.fallbackMarkdown` 是非空字串時回傳它，否則回傳 null。
- 新增 `resolveDilSentinels(text, message)`：
  - 從 componentResults（Cite items）和 `search_result_groups` 建 `refId → {url, title, source_label}` 表。
  - `cite`：輸出 ` ([source_label](url))`，多個 ref 用空白串接。格式要和現有 `content_references` alt 的輸出一致（先看 fixture 裡 alt 的實際格式）；解不出來的 ref 就丟掉。
  - `url`：輸出 `[title](url)`。
  - `entity`：輸出 `JSON.parse(arg)[1]`，解析失敗時輸出 arg 原文。
  - `image_group`：先用 query 對到 AsyncImage，對不到再依出現順序對；每張圖輸出 `[![title](content_url)](url)`。解不出來就移除。
  - 最後掃掉其餘不認得的 sentinel。沿用現有的 `CITATION_SENTINEL`。
- `applyCitations`：跳過 `type === 'client_defined_widget'` 的 ref（保留原文）。這是給「沒有 DIL 但有 code_block widget」的訊息用的；fixture 中 `fcca92be` 就是這種情況。
- 新增並 export `markdownOf(message)`：有 fallback 就用 `resolveDilSentinels(fallback)`。這時**不能**套用 `content_references`，因為那些 index 是對應 `parts[0]` 的。沒有 fallback 時維持原本的 `applyCitations(textOf(message), message)`。
- `normalize()`（`chatgpt-adapter.js:327`）和 `shared/conversation-archive.js:127` 都改呼叫 `markdownOf`，explorer 會一起修好。
- 已知且接受的狀況：fallback 會把卡片內的 `<title>` 轉成 `# 99.98`，這裡不做額外處理。

### 2. 圖片 ZIP（`Download .zip`）

- **新增 `shared/zip-store.js`**：零相依，非 ES module，與其他 shared 檔案同樣風格。
  - 只用 STORE 方式（不壓縮），自帶 CRC32 table。
  - 設 UTF-8 檔名旗標（general purpose bit 11），中文檔名才不會亂碼；寫 DOS 時間。
  - API：`ZipStore.build([{ name, data: Uint8Array|string }]) → Blob`。
- **`shared/chat-export.js`**：把 `downloadText` 一般化，新增 `downloadBlob(filename, blob)`，`downloadText` 改成呼叫它。
- **`shared/chatgpt-adapter.js`**：新增 `imageAssets(data)`，收集所選 thread 裡每個 `image_asset_pointer`，產生 `{ pointer, fileId, name, mime }`；`name`／`mime` 從同訊息的 `metadata.attachments` 對 id 取得。
- **`chatgpt-export-markdown.user.js`**：
  - 從 `fromBackendApi` 抽出 `accessToken()` 共用。
  - 新增 `fetchAsset(fileId, convId)`：
    1. `GET /backend-api/files/download/${fileId}?conversation_id=…&inline=false`，帶 Bearer，取得 `download_url`。
    2. 對 `download_url` 做 `fetch` 取得 `Uint8Array`。
    3. 失敗時回傳 null，並在 status 顯示失敗數。
  - 新增 `doExport({ mode: 'transcript', to: 'zip' })` 與 action `Download .zip (含圖片)`：
    - 依序下載圖片，命名為 `images/NN-<sanitized name>`。
    - 在 render 好的 Markdown 中，把 `sediment://…` 字串換成相對路徑；失敗的圖片保留原 pointer。
    - 打包成 `<filenameFor(doc,'md')>` 加上 images，檔名用 `filenameFor(doc,'zip')`。
  - 加 `@require …/shared/zip-store.js`。不新增 `@grant`／`@connect`：signed URL 預期是同源的 `chatgpt.com/backend-api/estuary/…`。如果實測是跨域且被 CORS 擋，再改用 `GM_xmlhttpRequest` 加最小範圍的 `@connect`。
  - `@version` 從 1.4.0 改成 **1.5.0**。
- 範圍外：
  - `image_group` 的網路圖片是跨域的 `images.openai.com`，只保留遠端連結，不打包。
  - 生圖輸出在 tool message 中，預設不顯示；這部分**沒有樣本無法驗證**，記入 TODO。

### 3. 測試與 fixture

- 新增 `tests/fixtures/chatgpt-export/intelligent-ui.json`：從這份 JSON 縮減，保留以下內容：
  - 一則 DIL 訊息：`parts[0]` 含 JSX、`client_defined_widget` code ref、`fallbackMarkdown` 含四種 sentinel（含多 ref 的 cite），以及對應的 componentResults／constants／code 片段與 `search_result_groups`
  - 一則沒有 DIL、但有 code_block widget 的訊息
  - 一則帶 `image_asset_pointer` 與 attachments 的 user 訊息
  - 在 `tests/fixtures/chatgpt-export/README.md` 記錄來源與 SHA-256，沿用現有寫法。
- `tests/chatgpt-export-markdown.test.mjs`，在 "ChatGPT export transformations" 區塊中檢查：
  - code fence 存在
  - 輸出沒有 `<box`／`<Cite`／`<Link`／``
  - cite 解成 URL、url 轉成 link、entity 轉成文字、image_group 轉成連結
  - 非 DIL 訊息的 widget code 保留
- 另一組測試檢查：
  - `ZipStore`：解析 local header 與 central directory，驗證檔名、長度、CRC（用 `node:zlib.crc32`），並在有 `unzip` 時跑 `unzip -t`。
  - GM shim export action：mock 三個 endpoint，驗證 zip 內容與改寫後的 md 路徑，以及單張圖失敗時的處理。
- `tests/conversation-archive.test.mjs`：explorer 預覽改用 fallback。

### 4. 文件與維護

- `userscripts/chatgpt-export-markdown/README.md`：說明 Intelligent UI 的處理方式（用 fallback；raw 保存在 .json）以及 ZIP 匯出。
- `VALIDATION.md`：新增 v1.5.0 一節。
- `TODO.md`：用 `project-knowledge-harness` 的 `add-todo.sh` 新增兩項：
  - P2／L：Intelligent UI HTML 快照匯出
  - P2／S：生圖輸出圖片（需要樣本 JSON）
- 新增 `pitfalls/chatgpt-export-code-block-disappears.md`：`client_defined_widget` 的 alt 為 null，導致 code 被刪掉。

## 驗證

1. `npm run test:chatgpt-export`、`npm run test:chat-explorer`、`npm run verify`（check 會驗證新 `@require` 的檔案存在）。
2. 用 adapter 對完整的原始 JSON 跑一次 normalize + render，產生 md 並和 `.specstory/references/…-1242.md` 比對：
   - 四段 code block 都回來了
   - 沒有任何 JSX 或 PUA 字元
3. `npm run preview -- chatgpt-export-markdown <conv url> --menu "Download .zip (含圖片)" --wait 5000`：shim 沒有登入狀態，只能確認流程不會 crash。
4. **真實驗證（需要使用者登入）**：
   - 在已登入的瀏覽器安裝 1.5.0，對這篇對話執行 Download .zip
   - 確認兩張截圖都下載成功、md 的相對路徑在 Obsidian／VS Code preview 能顯示
   - 確認 `/backend-api/files/download` 的回應格式與 `download_url` 是否同源；如果跨域，照第 2 節的備案處理
