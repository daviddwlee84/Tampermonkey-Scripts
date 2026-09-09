# v0.1.0 驗證紀錄

日期：2026-09-09。對象為本 repo 交付的單檔 userscript；使用隔離的測試瀏覽器 profile，未修改日常瀏覽器的擴充設定或安裝內容。

## 自動化

`npm run test:vimium-c-companion`：**47 / 47 通過**。

| 類型               | 數量 | 覆蓋                                                                                                                                |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 純參考模型         | 25   | 官方 181 command IDs／77 預設 Normal 鍵位、各模式、原生 JSON 格式、Base64／續行、映射／取消、條件／轉譯／流程、版本、大小與結構邊界 |
| Chromium + GM shim | 11   | 介面、搜尋／IME、鍵盤通行、收藏、匯入、備份、跨分頁同步、隱藏／恢復、拖曳／SPA、視窗尺寸與主題                                      |
| Firefox + GM shim  | 11   | 同上，並驗證選文流程不誤用 Insert 專用或帶特殊參數的映射                                                                            |

重新整理與跨分頁測試透過 shim 的 localStorage 模擬 GM 契約；正式腳本使用 manager 的 GM storage。此測試不能驗證原生擴充或 manager sandbox，與下列實測分開記錄。

淺色、深色、窄視窗與完整查詢截圖已目視檢查，位於 `.preview/vimium-c-companion-tests/`；CI 會上傳此資料夾的截圖。`npm run verify` 通過；既有 page-reader 的 5 項外部 `@require` 提醒仍存在，Companion 沒有新增 metadata 警告。

## 真實 manager 與 Vimium C

瀏覽器為 Chromium **151.0.7922.34**，Vimium C **2.12.2**。使用官方擴充安裝包、新的隔離 profile、本機 HTTP 練習頁，經 manager 安裝 UI 載入腳本；沒有注入 GM shim。

| 功能                                                            | Violentmonkey 2.48.0 | Tampermonkey 5.5.0 |
| --------------------------------------------------------------- | -------------------- | ------------------ |
| manager 實際注入與 sandbox 執行                                 | 通過                 | 通過               |
| 在 Companion 搜尋框輸入 `scripts`，網站 `s` shortcut 不搶走輸入 | 通過                 | 通過               |
| 原生 `f` 顯示面板控制項的提示，輸入標籤打開 Companion 設定      | 通過                 | 通過               |
| 主題存入 GM storage 並跨 reload 保留                            | 通過                 | 通過               |
| 原生 `j` 導覽維持運作                                           | 通過                 | 通過               |
| 匯入個人鍵位預覽並跨 reload 保留；原生仍使用自己的 `j`          | 通過                 | 未另測             |
| 原生 `?` help 維持由 Vimium C 顯示                              | 通過                 | 未另測             |
| 最新面板的 Visual 流程呈現 `yv → w → y`                         | 通過                 | 未另測             |

原生選文行為也實測確認：`yv` 選文字提示後選中 `Alpha`，`w` 擴展為 `Alpha bravo `；`/silver → Enter → v → w` 選中 `silver river `。測試停在選取完成，未使用原生 `y` 或實際 GM 剪貼簿寫入，以保留測試機的剪貼簿內容；Companion 的 F7 範例複製已在 shim 驗證字串。

實測報告與截圖位於 `.preview/companion-build/`，不屬於發佈腳本。測試瀏覽器與本機 HTTP server 在測試結束時關閉。

## 已知差異與未測環境

- 真實 Vimium C 可能先消耗 `Esc`，只讓輸入框失焦，Companion 查詢視窗仍保留。可直接點 ×，或按 `f` 選擇關閉鈕。沒有原生 C 的 shim 測試中，Companion 自己會處理範圍內的 `Esc`。
- Firefox 的真實 manager＋Vimium C 組合未在此次實測，不能以 Firefox shim 測試代稱。
- 未覆蓋所有網站的先行 capture listener、特殊 Insert 映射、閉合 shadow root 或受保護瀏覽器頁面。
- catalog 固定於參考版本；條件與自訂流程是靜態預覽，沒有原生模式同步或執行成功回饋。
