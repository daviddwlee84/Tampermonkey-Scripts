# Media Helper 驗證記錄

## 自動化

使用 `npm run test:media-helper` 跑 Chromium／Firefox 的固定 fixtures。GM shim 驗證 API 呼叫、佇列與回呼，不提供 manager 的真實跨域能力。

2026-09-09 本機結果：Chromium／Firefox 各 15 個案例，共 **30／30 通過**；同步腳本的 14 個 Python 測試通過。修改檔案的 Prettier 檢查、`npm run verify` 與 TODO 格式驗證通過。metadata 的五項警告均來自既有 Page Reader 外部依賴，Media Helper 未新增警告。已檢視亮色及深色窄視窗截圖。

- 圖片：srcset width／density、picture 構圖、lazy-load、CSS 背景、簽章 URL、版本選擇。
- 互動：遮罩選取、原頁點擊／按鍵、輪播、SPA、頂層單次注入、隱藏／位置保存。
- 影片：直接影片、HLS／DASH、byte range／分段、blob、無來源播放器、封面、按需預覽。
- 下載：URL 去重、兩個並行、部分失敗、取消、重試、過期回呼隔離、同步例外／逾時。
- 視覺：亮色面板、深色窄視窗截圖。

## 真實 manager 與網站

2026-09-09：本次嘗試連線現有瀏覽器控制介面時逾時，未取得可用的真實 manager 工作階段。

以下尚待實機驗證，不能以 Playwright shim 代替：

| 環境／案例                    | 狀態   | 驗收內容                                                 |
| ----------------------------- | ------ | -------------------------------------------------------- |
| Chromium／Arc ＋ Tampermonkey | 未驗證 | 安裝、grant、選單、網域及副檔名授權、實際存檔與取消      |
| Firefox／Zen ＋ Violentmonkey | 未驗證 | sandbox、選單、下載回呼、實際存檔與取消                  |
| 已登入 Instagram 貼文／輪播   | 未驗證 | 浮動工具、遮罩、輪播換圖、目前可取得最大版本、CDN 有效性 |
| 一般圖片頁與直接影片頁        | 未驗證 | 比較選取網址、下載檔案格式／尺寸、影片能否完整播放       |

手動驗收時記錄日期、瀏覽器／manager 版本、頁面類型、實際結果。不要把帶 token／簽章的私有來源 URL 貼進此文件。遇到失敗先比較「開啟來源」是否可用，再確認 manager 權限及 URL 是否過期。
