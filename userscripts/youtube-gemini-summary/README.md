# YouTube Gemini Summary

在 YouTube 影片卡片與觀看頁一鍵開啟 Gemini，送出繁中摘要提示。

- **生效網站**：`https://www.youtube.com/*`、`https://gemini.google.com/app*`
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`youtube-gemini-summary.user.js`](./youtube-gemini-summary.user.js)

## 它做了什麼

原本的手動流程：

```text
複製 YouTube URL
  → 開 Gemini 新對話
  → 輸入「總結 <URL>」
  → Send
```

安裝後，在 YouTube 影片卡片或已開啟的影片按 **✨ Gemini** 即可完成同一件事：

1. 從 card 或目前頁面取得 video ID。
2. 一般影片正規化成 `https://www.youtube.com/watch?v=<id>`，Shorts 則保留 `https://www.youtube.com/shorts/<id>`；兩者都去掉 playlist、timestamp 與 tracking parameters。
3. 用短效 GM storage 保存 URL，再以 URL fragment 裡的 random request ID 指定剛開出的 `https://gemini.google.com/app` 分頁；prompt 本身不放進 URL。
4. Gemini 載入後填入 `總結 <canonical URL>`，確認文字正確才按一次 Send。
5. 送出後會重新尋找目前的 composer 或已送出的 user prompt，避免 Gemini 替換 composer DOM 時誤判失敗；真正無法確認時才把 prompt 複製到 clipboard 並顯示人工操作 panel。

它會掃描首頁、搜尋、頻道、訂閱、related videos、playlist panel 等常見 card，也認得 Shorts card；playlist/course collection card 不會誤用第一支 lesson。一般 watch／live page 的按鈕會優先放進 action row；Shorts 或找不到 action row 的 layout 則顯示右下角浮動按鈕。

## 使用方式

1. 先登入 [Gemini](https://gemini.google.com/app)，並確認 [Keep Activity 已開啟](https://support.google.com/gemini/answer/16622858)。
2. 在 YouTube：
   - 瀏覽頁：把滑鼠移到影片 card，按右下角的 **✨ Gemini**。
   - 已開啟影片：按 action row 或右下角的 **✨ Gemini**。
3. 腳本會開一個新的 Gemini 分頁並自動送出摘要請求。
4. 若右下角出現「無法自動完成」，prompt 已盡量複製到 clipboard；依 panel 指示貼上或手動按 Send。

一次只開一支影片的摘要。前一個 Gemini 分頁仍在載入時，腳本會暫時拒絕覆蓋 pending request。

## 權限與資料

| Grant | 用途 |
| --- | --- |
| `GM_addStyle` | 顯示 YouTube 按鈕與狀態／fallback panel |
| `GM_setValue` / `GM_getValue` / `GM_deleteValue` | 在同一支腳本的 YouTube、Gemini matches 之間交接一筆兩分鐘內有效的 URL |
| `GM_openInTab` | 開啟新的 Gemini `/app` 分頁 |
| `GM_setClipboard` | 自動化失敗時保留可手動貼上的 prompt |

這支腳本：

- 不需要 Gemini API key，也不呼叫 Gemini API。
- 沒有 `@connect`，不對第三方 server 發 request。
- 不抓 transcript、title、channel 或 Gemini 對話內容；GM storage 只交接 canonical YouTube URL 與短效 request metadata，也不保留 `si` 等分享 tracking parameters。
- 新分頁 URL fragment 只含 random request ID，不含 video URL 或 prompt；瀏覽器的 HTTP request 不會攜帶 fragment。
- 使用你已登入的 Gemini Web session；送出 prompt 後的資料處理由 Google Gemini 負責。

## 已知限制

- Gemini Web composer 不是公開 API，DOM selector 改版後可能需要更新。
- Gemini 沒有公開、受支援的 prompt-prefill deep link；本腳本必須等待並操作 composer。
- YouTube card 與 action row 也是 private DOM；新 renderer 可能暫時沒有按鈕或改用浮動 fallback。
- 需要先登入 Gemini 並開啟 Keep Activity，YouTube Connected App 的實際可用性仍由帳號類型、地區與 Google 設定決定。Pending request 兩分鐘後過期，避免舊 request 在日後意外送出。
- 一次只支援一筆 request，不做 queue、既有 Gemini tab reuse 或跨分頁 acknowledgement；random ID 只負責避免其他 `/app` tab 搶走這一筆。
- 只注入 top-level desktop `www.youtube.com` UI；URL parser 雖認得 mobile／Music YouTube URL，腳本不會在那些站點或 iframe 加入按鈕。
- Gemini `/app` 若恢復了未送出的文字或附件草稿，腳本不會覆寫／夾帶送出，而會保留草稿並退回人工操作。
- 自動 click 後會以目前可見的空 composer 或相同 user prompt 確認送出；若仍無法確認，只會提示人工檢查，不以 route change 當成功，也不按第二次 Send。

## 手動驗證

這個 workflow 需要 userscript manager 的跨 domain storage 與新分頁能力，`npm run preview` 只能驗 UI/selector，不能代替真實 manager。發佈前應分別在 Tampermonkey、Violentmonkey 測試：

- 首頁、搜尋、頻道、related videos、playlist panel、Shorts、watch 與 live page。
- YouTube SPA 換片、infinite scroll、card recycle 後沒有 duplicate 或 stale button。
- 只開一個新的 Gemini `/app`，prompt URL 正確且只送出一次。
- Composer 或 Send selector 失效時會顯示可複製的 fallback。
- 已有 Gemini conversation route 不會被誤填、誤送。

## 參考實作

- [ipekbayrak/yt-gemini-summary](https://github.com/ipekbayrak/yt-gemini-summary) — YouTube renderer coverage、watch action placement、SPA events
- [wizdes/yt-gemini-summary](https://github.com/wizdes/yt-gemini-summary) — strict video ID canonicalization、短效 handoff、Gemini fallback UX
