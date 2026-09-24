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
