# Media Helper 串流完整下載

**Status**: needs evaluation
**Effort**: L
**Related**: [TODO](../TODO.md) · [Media Helper](../userscripts/media-helper/)

## 背景與決定

2026-09-09：使用者希望把找原圖的 helper 擴充為媒體工具，支援圖片與影片。第一版採用直接影片下載、多選逐檔儲存，串流先辨識與複製來源；完整串流下載若明顯較重則留待後續實作。

本次完成文件與 API 層面的可行性評估，尚未實作串流下載 PoC 或量測效能。完整串流下載會涉及播放清單、分段下載及封裝輸出，判定應獨立於 v0.1.0。

## 已知邊界

- `HTMLMediaElement.currentSrc` 是播放器目前來源，不保證是獨立且完整的影片檔。MSE 可以把多個 SourceBuffer 提供給播放器；`blob:` 也可能只是普通 Blob，不能一概認定為 HLS 或完整媒體。
- HLS 有播放清單與媒體分段。不能把 manifest 改名成 MP4，也不能假設任意 `.mp4` 請求包含完整影像與音訊。
- Resource Timing 能輔助發現 URL，但沒有完整回應內容、可靠的音畫關聯或無限保留的載入歷史。第一版不攔截播放器／fetch，也不蒐集登入憑證。
- ffmpeg.wasm 的 API 需載入 core、寫入檔案、執行及讀回輸出；官方 FAQ 說明記憶體／CPU 成本與檔案大小限制。多執行緒版本需要 SharedArrayBuffer 與相關安全條件，userscript 不能假設任意網站具備這個環境。

## 方案比較

| 方案                     | 好處                             | 代價與待確認                                                                       |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| 瀏覽器內解析、下載與封裝 | 使用者留在同一個操作介面         | 跨域分段、記憶體、codec/container 相容、音畫同步、Worker/CSP；可能增加大型 runtime |
| 與本機下載／封裝工具協作 | 較適合大型檔案與現成媒體處理工具 | 安裝依賴、使用流程與來源授權如何傳遞；不可把憑證寫入命令或紀錄                     |
| 保留辨識與複製 URL       | 維持簡單且不增加 runtime         | 無法在 helper 直接產出完整串流影片；v0.1.0 採用此方案                              |

## 下一次接續步驟

1. 建立可重現、自有素材的未加密、非直播、單一畫質 HLS fixture，先驗證清單解析、相對 URL、分段順序及封裝後能完整播放。
2. 比較瀏覽器內處理與本機工具方案，記錄輸入大小、峰值記憶體、耗時及所需使用者設定；目前沒有量測數字。
3. 驗證取消／中斷、分段 403／404、來源過期、初始化段與分離音訊；不得把部分成功輸出標記為完整影片。
4. 根據結果再決定技術方向及優先序；後續再擴充多畫質與 DASH。PoC 不涵蓋加密、DRM、直播錄製或播放器私有 API。

## 參考來源

- [HTMLMediaElement.currentSrc](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentSrc)
- [Media Source API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216.html)
- [ffmpeg.wasm usage](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)
- [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)
