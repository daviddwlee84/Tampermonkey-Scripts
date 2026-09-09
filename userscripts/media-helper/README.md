# Media Helper

預覽網頁圖片與影片、選擇頁面提供的較大圖片版本，支援單檔與多選逐檔下載。

- **安裝**：[Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/media-helper/media-helper.user.js)
- **原始碼**：[media-helper.user.js](./media-helper.user.js)
- **生效網站**：HTTP／HTTPS 頂層 HTML 頁面。
- **目標環境**：桌面 Chromium／Firefox，Tampermonkey／Violentmonkey。

正文閱讀、Markdown 與文章附件匯出請使用 [Page Reader & Markdown](../page-reader-markdown/)；Media Helper 以目前分頁的圖片與影片為單位。

## 使用方式

1. 滑鼠移到圖片或影片上，使用浮動工具列的「開啟來源、複製網址、下載」。小於 80 × 60 CSS pixels 的媒體不顯示浮動工具列，仍可從面板操作。
2. 點「查看其他版本」，或頁面右下方的 **▧ Media** 按鈕，開啟媒體面板。圖片有多個來源時可選擇版本；來源網址可展開查看。
3. 在面板勾選媒體，再點「下載已選」。每個檔案分別下載，最多兩個同時執行；可取消個別／全部下載或重試失敗項目。切換檢視範圍或類型會清除選取，避免下載隱藏項目。
4. 圖片難以選取時，切換「已載入資源」找候選。這是瀏覽器 Resource Timing 提供的網址紀錄，不等於 DevTools 的完整 Network 紀錄或回應內容。
5. 切換輪播、捲動載入更多媒體後，清單會更新；也可點「重新掃描」。不會自動翻閱輪播、捲動整頁或抓取整個帳號。

按鈕旁的 **⠿** 可拖曳位置。位置與隱藏偏好按網站 origin 保存；userscript manager 選單提供開啟面板、顯示／隱藏工具、重設位置及取消下載。隱藏本站工具會同時停用浮動工具列，仍可從 manager 開啟面板。

面板的影片預設只顯示封面；按「預覽影片」才載入媒體，使用播放器控制按鈕播放。關閉面板會停止 helper 的預覽，不修改原頁播放器。焦點在 helper 內時可用 Escape 關閉面板；在原頁輸入或播放時不攔截 Escape。

## 圖片與畫質

- 收集 `img.currentSrc`、`src`、`srcset`、`picture` 的目前有效 source，以及 `data-original`、`data-src`、`data-lazy-src`。
- 有 responsive 候選時，預設選同一組中的最大 width／density；其餘候選仍保留供切換。沒有 responsive 候選時，優先使用 `data-original`，再使用目前圖片及 lazy-load 來源。
- 不混合 `picture` 中不同構圖的 source，不自行刪改 CDN query、簽章或裁切參數。不能因為 URL 看起來像縮圖就假設另一個網址存在。
- 尺寸資訊是原頁目前顯示版本的已知尺寸；`1280w` 等是網站宣告的候選描述，不表示 helper 已下載並驗證最大圖。`data-original` 也是網站提供的提示，並非原檔證明。
- 開啟面板／手動掃描會檢查 computed CSS `background-image: url(...)`；滑鼠移入背景元素也能辨識。v1 尚不解析 `image-set()` 或 pseudo-element 背景。
- 完整 URL 去重並保留 query。相同圖片使用不同簽章 URL 時不合併，避免破壞來源；同一 URL 正在等待或下載時不會重複排入。

**「頁面最大候選」不等於作者上傳原檔。** 網站沒有提供的版本不在此腳本的取得範圍內。較大版本失敗時，可自行切回目前顯示版本；不會靜默改下載較小圖。

## 影片與資源分類

| 類型 | 第一版行為 |
| --- | --- |
| 頁面提供的 HTTP(S) 直接影片，如 MP4／WebM | 開啟、複製、預覽與下載 |
| HLS／DASH 播放清單 | 顯示串流狀態，可複製／開啟來源，不合併下載 |
| 已辨識的 `.m4s`／`.ts` 等分段，或帶 byte range 的 URL | 顯示分段資源，不加入批次下載 |
| 資源紀錄中的影片 URL、格式未明的影片來源 | 僅作候選；單憑 `.mp4` 不足以證明是完整影片 |
| `blob:`、`srcObject` 或尚未提供 URL 的播放器 | 顯示暫存／播放器來源狀態，不提供完整影片下載 |
| `video.poster` | 作為封面圖片，可單獨儲存 |

不是所有 `blob:` 都是串流；v1 統一保留為尚未支援的暫存來源。圖片的 `blob:`／`data:` 也不使用 `GM_download` 下載，可在可用時開啟或複製來源。

只讀取頁面元素和資源載入紀錄，不攔截 `fetch`／XHR、不讀取私有 API、也不收集 cookie 或 token。資源紀錄最多保留 1,000 筆，且會排除 helper 新產生的縮圖／預覽請求；瀏覽器的 buffer 或載入時機可能讓某些資源沒有紀錄。SPA 路由的通用偵測存在短暫時間邊界，資源清單可能包含邊界附近的少量舊頁請求。跨 origin iframe、closed Shadow DOM、canvas 畫面與影音分段重組不在 v1 支援範圍。

串流完整下載的評估見 [後續研究](../../backlog/media-helper-stream-download.md)。

## 下載、權限與偏好

只有按下下載才呼叫 `GM_download`，不把所有媒體先載入 JavaScript 記憶體或打包 ZIP。下載依 manager 的能力及瀏覽器設定執行；manager 自身仍可能緩衝檔案。

- 檔名由網站、頁面標題、流水號與已知副檔名組成，清除不適用於檔名的字元。無法由 URL 或 source MIME 得知格式時，不猜副檔名；manager 可能拒絕沒有允許副檔名的下載，此時使用開啟來源。
- 完成狀態以 manager 的完成回呼為準，不代表 helper 另行讀取了磁碟檔案。下載失敗顯示 manager 回報；過期連結可重新掃描，或開啟來源檢查。
- 60 秒沒有進度回呼會停止下載，釋放佇列位置；大型影片可重試或使用來源頁下載。未提供總大小時顯示已傳輸量及不定進度。
- SPA 換頁會重建媒體清單，但保留已排入的下載來源快照。整頁重新載入後，面板內的佇列與媒體紀錄不保留；已交給 manager 的下載依 manager 行為處理。
- 媒體 URL 與下載歷史只保存在目前分頁記憶體；GM storage 只保存 `mediaHelperConfig` 中按 origin 區分的位置／隱藏偏好。

授權包括 `GM_download`、`GM_openInTab`、`GM_setClipboard`、`GM_registerMenuCommand`、`GM_getValue` 與 `GM_setValue`。因通用網頁的媒體可能來自任意 CDN，宣告 `@connect *`；manager 仍可能要求授權網域、啟用下載功能或允許副檔名。詳見 [Tampermonkey 下載 API](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_download) 與 [Violentmonkey API](https://violentmonkey.github.io/api/gm/#gm_download)。

沒有 `@require`、外部 runtime dependency、後端服務或媒體上傳。

## 驗證

```bash
npm ci
npx playwright install chromium firefox
npm run test:media-helper
npm run verify

# 只跑其中一個引擎
MH_BROWSERS=chromium npm run test:media-helper
```

測試使用固定頁面、本機路由及 GM shim，涵蓋來源／畫質選擇、遮罩、背景圖片、輪播、SPA、影片／串流分類、預覽不自動播放、下載進度／取消／失敗重試與偏好。截圖放在 `.preview/media-helper-tests/`。`sample.webm` 是以瀏覽器 canvas／MediaRecorder 產生的四秒幾何動畫，無外部媒體或音訊。

這些測試不證明真實 manager 的 sandbox、網域授權或實際存檔成功。實站驗收另記於 [VALIDATION.md](./VALIDATION.md)，未執行項目保留為未驗證，尤其是 Instagram 登入頁與跨 CDN 下載。
