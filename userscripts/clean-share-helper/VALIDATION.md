# Clean Share Helper 驗證記錄

2026-10-26，版本 **0.1.0**。測試環境：macOS arm64、Playwright 1.62.1、Chromium 151.0.7922.34、Firefox 153.0。

## 自動化

`npm run test:clean-share-helper`：**49／49** 通過，包含直接讀取交付腳本的 11 個核心案例，以及 Chromium／Firefox 各 19 個互動案例。

- 核心：通用及各站參數、微信必要欄位、簽章保留、未知／重複參數及編碼、fragment、無效輸入、本機轉址與八層限制、重複清理結果不變、內容路由辨識。
- 四站 fixtures：每篇內容自己的 permalink、巢狀引用、缺少／歧義連結不注入、原生點擊不受影響、捲動新增內容、DOM 重用與移動、移除 helper 後恢復、重複執行不重複注入。
- 互動：hover／focus、Escape、關閉後恢復焦點、明細固定面板、批次錯誤與順序、目前頁面、剪貼簿錯誤、文字安全輸出、深色窄版。
- YouTube：觀看頁、URL-only 換頁、目前啟用的 Shorts、新版 `yt-unified-share-panel-renderer`、面板網址更新後保留時間與播放清單。
- 請求：按需展開、HEAD／GET fallback、錯誤／逾時／取消、過期回呼不覆寫結果、大小限制。另以真實 loopback HTTP 轉址與 CORS 回應驗證瀏覽器請求：各跳都不帶 cookie，CORS 拒絕時不退回 GM 請求。

`python3 -m unittest discover -s tests -p 'test_sync_userscripts.py'`：**22／22** 通過。`npm run verify`、修改程式的 Prettier 檢查與 `git diff --check` 通過。metadata 無新增警告；五項既有警告均為 Page Reader 的外部 `@require`。

已檢視亮色面板、窄版深色面板、Threads hover 明細，以及實站與 manager 截圖。一般互動 fixtures 使用 GM shim，不能證明真實 manager 的 grant／sandbox。

## 真實 Violentmonkey

使用本機既有官方商店套件 **Violentmonkey 2.49.0 MV3** 的擴充套件程式目錄，載入全新、**有視窗**的 Chromium 測試 profile；沒有複製使用者的 profile、cookie、擴充套件設定或腳本資料。測試結束已刪除隔離 profile。

透過擴充套件詳細頁、Install from URL、安裝確認頁與真實 popup 選單操作；沒有 GM shim、直接注入腳本或改寫擴充套件資料庫。

| 驗收                                          | 結果                                              |
| --------------------------------------------- | ------------------------------------------------- |
| 原版腳本安裝、HTTP 頂層頁面匹配與執行         | 通過                                              |
| 真實選單開啟清理面板                          | 通過                                              |
| 寫入已知結果後讀回剪貼簿                      | 通過；等待 manager 非同步寫入完成，未讀取先前內容 |
| 使用者按需展開、本機 HTTP 302 轉址後清理      | 通過                                              |
| 初始與目的地兩個請求皆不帶既有測試 cookie     | 通過；兩次展開共四個 HEAD 請求的 Cookie 均為空    |
| 輸入 fragment 保留、無 manager 內部請求識別碼 | 通過                                              |

可用 `CSH_VM_DIR="<官方解包目錄>" npm run test:clean-share-manager` 重現。正式腳本 SHA-256：`18175a71583e03c8423cc105741a866f4447089e20d9b7308a999fad9a2e8a97`；manager manifest SHA-256：`c8b6b2549b12c01ad15a833ad34c55e233e64369c293ce272689006e6587d5de`。

VM 2.49 MV3 的匿名 GM 請求在此環境只移除第一跳 cookie，轉址後仍會帶 cookie，因此正式腳本在 Violentmonkey 改用 `fetch` 的 `credentials: omit`。這個路徑受 CORS 與頁面網路政策限制，失敗時保留原結果。Fetch 不提供轉址後的 fragment；保留輸入 fragment 並顯示提示，無法還原目的地自行指定的 fragment。

## 公開實站

使用沒有登入資料的獨立 Chromium，載入目前頁面 DOM，再注入腳本與明確標示的 GM shim。此層驗證網站辨識與 UI，不等同真實 manager 在實站上的 sandbox 驗證。

| 網站／頁面                                                                   | 結果與範圍                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Threads 公開個人頁](https://www.threads.com/@mosseri)                       | 顯示四組可確定連結的分享按鈕；第一篇複製對應 `/@mosseri/post/De2ynmxDcS-`；hover 顯示明細。涵蓋目前 SVG `title`／`<title>` 的 Share 標記 |
| [Instagram 公開 Reel](https://www.instagram.com/instagram/reel/De2bNIWSZdB/) | 關閉登入提示後，顯示一組按鈕並複製正確的含帳號名稱 Reel 路徑                                                                             |
| [YouTube 觀看頁](https://www.youtube.com/watch?v=jNQXAC9IVRw)                | 觀看頁按鈕及新版原生分享面板按鈕均可複製正確影片連結；時間／播放清單另由 fixtures 驗證                                                   |
| Facebook 公開頁                                                              | 回傳登入提示，沒有可用的貼文分享入口；登入後實站尚未驗證                                                                                 |

Threads 登入後動態牆／回覆、Instagram 登入後動態牆／貼文彈窗、Facebook 登入後貼文／Reels、YouTube 實站 Shorts，以及真實 Tampermonkey／Firefox manager／Safari／iOS，均保留為**未驗證**。Fixtures 通過不代表這些組合已實測。

本機證據位於 `.preview/clean-share-helper-tests/`：`manager-report.json`、`manager-violentmonkey.png`、`live-threads.png`、`live-instagram.png`、`live-youtube.png` 與兩引擎的面板／tooltip 截圖。此目錄不納入 Git。
