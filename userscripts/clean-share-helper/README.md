# Clean Share Helper

一鍵複製去掉追蹤參數的網址，也能貼入任意 HTTP(S) 網址批次清理。

- **安裝**：[Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/clean-share-helper/clean-share-helper.user.js)（需此版本已發佈至 GitHub；本機可先匯入旁邊的 `.user.js`）
- **原始碼**：[clean-share-helper.user.js](./clean-share-helper.user.js)
- **目標環境**：桌面 Chromium／Firefox，Tampermonkey／Violentmonkey；Safari／iOS 未驗證。

## 站內分享

能辨識貼文網址時，原生分享圖示旁會出現 **🔗** 與 **ⓘ**：

- 點 **🔗**：直接複製乾淨網址並顯示提示。
- 滑鼠停留或鍵盤聚焦：預覽實際取得的原網址、清理結果、移除的參數。
- 點 **ⓘ**：開啟面板，固定查看完整資訊或手動選取網址。

| 網站 | 適配入口 |
| --- | --- |
| Threads `.com`／`.net` | 動態牆、貼文詳情與回覆，使用該篇貼文的 permalink |
| Instagram | 動態牆、貼文詳情／彈窗、Reels |
| Facebook | 動態牆、貼文詳情、Reels |
| YouTube | 觀看頁、目前啟用的 Shorts、原生分享面板 |

YouTube 原生分享面板的按鈕會讀取面板中當下的連結，因此保留使用者選好的時間點與播放清單。觀看頁旁的按鈕則清理目前頁面網址，不自行加上播放器時間。時間點分享是 [YouTube 官方支援的功能](https://support.google.com/youtube/answer/57741?hl=en)。

網址來自目前 DOM 的貼文連結或明確的目前影片路由，不攔截原生剪貼簿、不呼叫網站私有 API。網頁提供的 permalink 可能本來就沒有追蹤碼，因此明細可能顯示「無」。引用貼文與回覆分開辨識；無法確定對應關係時不顯示按鈕。第一版辨識英文、繁簡中文的常見分享標籤，其他語言與網站改版仍可能需要適配。

## 任意網址清理

一般網站不增加浮動按鈕。從 Tampermonkey／Violentmonkey 的腳本選單選擇：

- **Clean Share：清理任意網址**：貼上一個或多個網址，一行一個，再按「清理網址」。
- **Clean Share：清理目前頁面網址**：直接顯示目前網址的清理結果。

每列可以單獨複製；「複製全部成功結果」依輸入順序複製有效結果，保留重複輸入並略過錯誤列。可用「目前頁面」重新讀取現在的分頁網址。Escape 或「關閉」關閉面板，不改變瀏覽器網址列，也不自動跳轉。

## 清理規則

- 通用規則：`utm_*`（包含拼錯的 `utm_souce`）、`fbclid`、`gclid`、`dclid`、`msclkid`、`gbraid`、`wbraid`、`mc_cid`、`mc_eid`、`_ga`、`_gl`。
- Threads：`xmt`、`igsh`、`igshid`。
- Instagram：`igsh`、`igshid`。
- Facebook：`mibextid`、`__cft__`、`__tn__`。
- YouTube／`youtu.be`：`si`、`feature`。

網站專屬規則只套用在該站網域。未知參數、重複參數、保留欄位的原始編碼、空值與 fragment 均保留；不把 `?` 後面的內容全部刪掉。例如：

```text
https://www.youtube.com/watch?v=VIDEO&si=TRACK&t=90&list=PLAYLIST
→ https://www.youtube.com/watch?v=VIDEO&t=90&list=PLAYLIST

https://mp.weixin.qq.com/s?__biz=BIZ&mid=123&idx=1&sn=SIGN&utm_souce=wechat
→ https://mp.weixin.qq.com/s?__biz=BIZ&mid=123&idx=1&sn=SIGN
```

遇到 `sig`、`signature`、`X-Amz-Signature`、`X-Goog-Signature`、`oauth_signature` 或 `hmac` 時，保留該段網址原樣並提示。這是有限的簽章辨識，不能涵蓋所有網站自訂簽章。微信的文章識別與存取參數，以及一般網站的未知 `token`／`key`，都不任意刪除。

規則內嵌於腳本，隨版本更新；沒有遠端規則服務、後端、額外 hosting 或網址映射資料庫。乾淨連結沿用原網站既有預覽，是否出現卡片仍取決於接收端與內容可見性；不提供影片下載或第三方預覽轉換。

## 短連結與權限

能從 `l.facebook.com/l.php`、`lm.facebook.com/l.php`、`l.instagram.com/` 或 YouTube `/redirect` 的參數直接取出目的地時，會在本機解析，最多八層；超過八層則保留整個原網址。

其餘連結只有按下結果列的 **「展開短連結」** 才會發出請求。先用 HEAD；目的地不支援 HEAD（405／501）才改用 GET。不執行回應中的腳本，也不解析 HTML／JavaScript 轉址。需要登入的目的地可能無法展開。

Tampermonkey 使用 `GM_xmlhttpRequest` 的匿名請求取得 HTTP 轉址後的 `finalUrl`。Violentmonkey 使用瀏覽器 `fetch` 的 `credentials: omit`，讓整條轉址鏈都不攜帶 cookie；實測 VM 2.49 MV3 的匿名 GM 請求只在第一跳移除 cookie，因此不使用該方式展開。瀏覽器請求受 CORS 限制，目的地未允許跨站讀取時保留原結果，不退回 GM 請求。

Violentmonkey 的瀏覽器展開不會回傳目的地 fragment；結果會保留輸入網址原有的 fragment，並在面板提示。目的地自行指定的 fragment 無法由這種方式還原；若定位片段重要，可保留原短連結或開啟目的地後清理目前頁面。一般本機清理完整保留原 fragment。

展開最多等待十秒；GM 回應載入超過 1 MiB、逾時、網域權限遭拒或錯誤時保留原結果。瀏覽器請求取得回應標頭後就取消 body 下載。關閉面板、重新清理或 SPA 換頁會取消未完成請求。展開成功只更新結果，不自動寫入剪貼簿。

權限為 `GM_registerMenuCommand`、`GM_setClipboard`、`GM_xmlhttpRequest`；`@connect *` 用於使用者主動展開的任意網址與跨網域轉址，manager 仍可能另行要求網域授權。參見 [Tampermonkey 文件](https://www.tampermonkey.net/documentation.php) 與 [Violentmonkey API](https://violentmonkey.github.io/api/gm/)。

不讀取原有剪貼簿，不保存網址歷史，不傳給網址清理服務。輸入、結果與展開狀態只保留於目前分頁記憶體。

## 驗證

```bash
npm ci
npx playwright install chromium firefox
npm run test:clean-share-helper
npm run verify

# 僅跑一種瀏覽器的互動測試
CSH_BROWSERS=chromium npm run test:clean-share-helper

# 真實 Violentmonkey：指定官方解包擴充套件，使用全新的測試 profile
CSH_VM_DIR="/path/to/unpacked/violentmonkey" npm run test:clean-share-manager
```

核心測試直接讀取交付腳本的純函式區塊；互動測試使用自行建模的四站 fixtures 與 GM shim。截圖位於 `.preview/clean-share-helper-tests/`。實站與真實 manager 的結果、版本及未驗證項目另見 [VALIDATION.md](./VALIDATION.md)，不以 fixture 通過代替實站相容性。

真實 manager 測試預設開啟有視窗的隔離 Chromium，只在該測試 profile 安裝腳本並啟用 user scripts，不匯入原瀏覽器設定或 cookie。會從真實選單開面板，檢查轉址兩端都未收到測試 cookie，並在寫入已知結果後讀回剪貼簿；會覆寫當下剪貼簿。結束後刪除測試 profile。`CSH_HEADLESS=1` 可改無視窗執行，但其剪貼簿結果不等同作業系統剪貼簿驗證。
