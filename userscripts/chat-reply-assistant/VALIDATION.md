# Chat Reply Assistant 0.2.0 驗證紀錄

日期：2026-09-25。環境：macOS、Playwright 1.62.1、Chromium 151.0.7922.34、Firefox 153.0。

最終 userscript SHA-256：`c2d0166aa47fe40d42a7ac8d69b5195765f2e6a97277584814e7cb63af9e08cb`。

## 結論

**83 項自動化案例通過**：純函式／provider 21 項、Chromium 31 項、Firefox 31 項。真實 Tampermonkey 5.5.0 與 Violentmonkey 2.49.0 另驗證了行內掛載、模型清單 GET、回覆 POST、GM storage 與草稿操作。

登入後 Instagram 的可存取性標籤已做唯讀觀察，確認訊息 action labels 含發言者 handle、全域 profile link 可識別自己、照片有 Open photo 入口。但這不等於取得完整 DOM，也不等於 v0.2 已完成登入頁的端到端 smoke。兩站的語義 fixture 都明確標為重建資料，沒有把它們稱作原始網站快照。

## 自動化驗證

```sh
npm run test:chat-reply-assistant
npm run verify
```

| 層級                             | 結果        | 重點                                                                                      |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| 語法／原有純函式                 | 通過；10/10 | 路由、字串 ID、歷史順序、重複內容、上下文上限、回覆及 Jev 解析                            |
| Provider 純函式                  | 11/11       | v1/v2 遷移、4141/3001 分流、獨立 Key、URL 前綴／query、同源與 API base 限制、模型清單解析 |
| Chromium + GM shim               | 31/31       | UI、選取、圖片、診斷、時序及回歸                                                          |
| Firefox + GM shim                | 31/31       | 同一矩陣；不是 Firefox manager 實测                                                       |
| `npm run verify`                 | 通過        | 15 支腳本 metadata／索引；5 個既有警告屬於 page-reader-markdown 的外部依賴                |
| 格式及本次變更的 diff whitespace | 通過        | 檢查排除既有 `.specstory` 自動紀錄；未修改其內容                                          |

新增／保留案例包括：

- Instagram action-label 身分、自己 profile、Messenger 群組 heading；不依賴 `data-sender-*` 的語義 fixture。payload/actions 為包裝容器或平面兄弟節點都涵蓋。
- 圖片只有時間、圖片加 caption、重複圖片入口、頭像排除、分隔時間不混入內文，而真正內容為時間的訊息仍保留。
- host 在 composer 前方的正常排版位置；舊 pane 被 clone 後不留下幽靈 host；角色修正更新回覆對象。
- 選取畫面固定快照、背景新訊息、手動排除、關閉後納入新文字、新圖片預設未選、批次選圖、上限及草稿保護。
- 只有所選圖片才發出匿名 GM blob GET；轉為 JPEG data URI，圖片內容不送 Jev，也不送私人來源 URL 給主模型。vision 未確認、超過四張、錯誤 MIME、來源超過 12 MiB、取消下載均會阻止主模型請求。
- 未儲存／未填 model 即可 GET 模型；測試模型使用固定文字，沒有聊天或 Jev。自訂 prefix、Key 分離、尚未保存的 Key 在 endpoint 改變時清空。
- TypeSafe／Vercel URL、model、Bearer Key 正確配對；Jev 失敗仍降級；主模型 401／429 暫停 auto。
- v1 settings 保留；舊的 URL-only 聊天偏好在第一次辨識帳號後搬移至帳號限定 key。
- 新訊息 debounce／cooldown、已讀／反應／歷史載入不觸發、跨聊天室舊請求丟棄、選取與 UI 重建後的狀態。

主瀏覽器證據在 `.preview/chat-reply-assistant-tests/`，包含兩站選取視窗截圖。額外 390px Instagram 語義頁的深淺色布局檢查與截圖在 `.preview/chat-reply-assistant-v02-layout/`：確認 Send 位於 viewport 內且不與助手相交。舊 fixture 的窄版截圖只是其原始非響應式頁面的幾何回歸，不用來宣稱 Instagram 手機版相容。

## 真實 manager

使用官方來源的原有 Tampermonkey 5.5.0／Violentmonkey 2.49.0 套件，另建乾淨 Chromium profile，透過 manager UI 安裝上方最終 hash 的原始腳本。**沒有 GM shim、沒有直接 source 注入、沒有改 production metadata。** 網站 URL 由 Playwright 重播匿名合成 HTML；HTTP 接收器實際監聽 loopback，沒有 CORS header。

兩個 manager 各通過：

1. 原始 Instagram／Messenger match 與 sandbox 執行；擷取 5／6 則語義訊息，保留照片占位與自己的身分。
2. 行內 host 位於原生 composer 前方；產生三個候選後仍不遮擋 Send。
3. provider 可以在 model 空白時保存；使用者點擊後才發出實際 `GET /v1/models`，清單可供選取。
4. 主模型設定、全域／聊天室 prompt、auto 偏好重載保存；重新載入沒有額外模型請求。
5. 實際 `POST /v1/chat/completions` 生成候選，兩站各一次；填入／明確接續草稿成功，傳送次數為零。

每個 manager 的接收器共收到一個 GET、兩個 POST，沒有 cookie 或 Authorization（此測試使用免 Key 的假模型接收器）。證據：

- `.preview/chat-reply-assistant-v02-manager/tampermonkey-1790268553924/report.json`
- `.preview/chat-reply-assistant-v02-manager/violentmonkey-1790268553930/report.json`

報告包含來源／harness／fixture hash、套件版本、幾何資料與截圖。隔離 profiles 與本機 server 已清理，原有 manager 套件未修改。

## 尚未驗證與限制

- 真正登入頁的完整 raw DOM 與 v0.2 安裝後 smoke 尚未完成。本次原生 DevTools 的貼上防護阻擋程式化 DOM 診斷，沒有關閉或繞過保護。現有真站證據僅為 AX 語義觀察，不能證明所有包裝層、帳號、語系與版面皆相容。
- 圖片下載／縮圖／data URI 管線已在兩瀏覽器的 GM shim 測試；真實 manager 對 Meta CDN 的圖片下載與額外 host 授權未實測。
- 沒有使用真 Key 或私人聊天呼叫 Gemini、TypeSafe、Vercel；沒有啟動真實 LiteLLM／Copilot API／Copilot SDK Proxy。通過的是協定與本機 HTTP transport，不是實際訂閱額度、模型品質或 vision 能力。
- Firefox 真實 manager、Safari／手機、系統剪貼簿、API 跨站 redirect 行為未驗證。
- 本次未 push；本機 `.user.js` 可經 manager 匯入，GitHub raw URL 的內容以遠端已發布版本為準。

---

# Chat Reply Assistant 0.1.0 驗證紀錄

日期：2026-09-24。環境：macOS、Playwright 1.62.1、Chromium 151.0.7922.34、Firefox 153.0。

最終 userscript SHA-256：`c976bb64b97e3598c17851dedc580968fa5ab2c6a11b2537917751377f2d4271`。

## 結論

純資料處理、Chromium／Firefox 合成頁面，以及兩個真實 userscript manager 的安裝、GM storage 與本機 HTTP 請求已通過。**登入後 Instagram／Messenger 的當前 DOM 與真實 Gemini／Jev 模型尚未驗證**，本版維持 experimental。

## 自動化檢查

重跑完整自動化案例：

```sh
npm run test:chat-reply-assistant
npm run verify
```

| 層級                    | 結果  | 可證明的範圍                                                                                                                |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `node --check`          | 通過  | 發佈的單檔 JavaScript 語法                                                                                                  |
| 純函式測試              | 10/10 | 直接從發佈檔載入純函式：路由／字串 ID、順序合併、重複短訊、訊息編輯、無重疊標記、上限、endpoint、三回覆解析、Jev 型別與分類 |
| Chromium + GM shim      | 15/15 | DOM、介面、請求 payload、路由與非同步時序                                                                                   |
| Firefox + GM shim       | 15/15 | 同上；不等於 Firefox 真實 extension 驗證                                                                                    |
| `npm run verify`        | 通過  | 15 支腳本 metadata 與產生索引；5 個既有外部依賴警告皆来自 page-reader-markdown                                              |
| 格式、diff 與 TODO 格式 | 通過  | 變更檔案格式與既有待辦索引規則                                                                                              |

瀏覽器案例涵蓋：

- Instagram 與 Messenger 的單人／群組上下文、側欄排除、向上載入、虛擬列表移除後的記憶、重複內容與未知發言者。
- 真正的巢狀訊息捲動容器、區塊換行、名字為 `You` 但具有其他 sender ID 的群組成員。
- 全域／聊天室 prompt、Key 與 auto 偏好重載；聊天原文與候選不寫入 GM storage。
- 手改上下文、清除與重新讀取、腳本面板被移除後重建、既有草稿的明確接續，以及從未觸發傳送。
- auto 初始基準不重播、舊訊息／自己的訊息／反應不觸發、3 秒合併與 30 秒 cooldown、未知的快取發言者阻止 auto、401／429 暫停而不循環重試。
- URL 已更新但舊 pane 暫留或被複製、切換聊天室後回傳的舊請求、不同聊天室的偏好隔離。
- 自訂完整 endpoint 路徑；改變目的 origin 時不沿用先前 Key。
- TypeSafe Jev 的官方答案結構、同一群組快照傳給 LLM、Jev 失敗降級、主模型無效 JSON 顯示錯誤。

測試只使用合成聊天與假的模型回覆，所有意外外部請求皆被攔截。桌面與 375 px 窄版截圖已檢視，面板可捲動且無水平溢出。證據保存在 Git 忽略的 `.preview/chat-reply-assistant-tests/`。

## 真實 manager 與 loopback

兩者均使用官方來源套件、全新隔離 Chromium profile，經 extension UI 開啟 Allow User Scripts，再從 manager 的匯入／安裝 UI 安裝**上述最終 hash 的原始腳本**。

沒有 GM shim、沒有直接注入 userscript、沒有放寬或改寫 production metadata。瀏覽器請求的 Instagram／Messenger URL 使用本 repo 的合成 HTML fixture 重播；模型接收器是真正的本機 HTTP server，沒有 CORS header。

| Manager       | 版本         | 官方套件 SHA-256                                                   |
| ------------- | ------------ | ------------------------------------------------------------------ |
| Tampermonkey  | 5.5.0 / MV3  | `bcaec082c439e11c4df683f43d07e9ac3d4439251d72b91c5b452f977dac15d5` |
| Violentmonkey | 2.49.0 / MV3 | `3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee` |

通過項目：

1. 真實 manager 安裝、原始 Instagram／Messenger URL 匹配與 sandbox 執行。
2. endpoint、model、全域／聊天室 prompt、auto 設定透過 GM storage 保存並在 reload 後恢復。
3. 保存 auto 後 reload，觀察 4.2 秒，基準訊息沒有引起任何模型請求。
4. 從 HTTPS 合成聊天頁經真正 `GM_xmlhttpRequest` POST 至 HTTP loopback；接收器沒有收到 cookie 或 Authorization，每個 smoke 只有一次模型請求。
5. 三個候選、填入空草稿、接續既有草稿均成功，傳送計數為零。
6. Instagram 與 Messenger 相同數字 thread ID 不共用聊天室覆寫；全域模型設定可跨站使用。

最終報告：`.preview/chat-reply-assistant-manager/summary.json`，連到 `tampermonkey-1790262550757/report.json` 與 `violentmonkey-1790262550755/report.json`。各資料夾保留發佈檔、harness、套件來源、hash 與截圖。測試後已關閉 loopback server 並刪除各自的隔離 profile。

## 未驗證與發布邊界

- 沒有操作已登入的真實 Instagram／Messenger 私訊或群組。DOM selectors 與 sender 判斷仍需使用者帳號上的實際 smoke；合成頁面與其他專案 README 不代表真站通過。
- 沒有呼叫 Gemini／TypeSafe 的真實 API，也沒有安裝或啟動 LiteLLM／Copilot Proxy／OpenCode。已驗證的是 Chat Completions payload 與通用本機 HTTP transport，並非各上游的模型品質、額度或訂閱認證。
- 真實 manager 的完整 auto 時序矩陣、Facebook Messages URL、遠端自訂 host 授權、跨站重新導向，以及原生系統剪貼簿尚未測試。程式檢查回覆的 final URL，這不代表各 manager 都能事先阻止重新導向。
- Firefox 的實際 Tampermonkey／Violentmonkey、Safari Userscripts、手機與 native messaging apps 未驗證。
- 2026-09-24 檢查新的 GitHub raw 安裝 URL 回傳 404，因本次工作區尚未發布。可先從 manager 匯入本機 `.user.js`；未執行 push。腳本 metadata 已使用 repo 慣例的最終更新 URL。
