# 14 · iOS Userscripts 評估與本倉庫相容性

**Userscripts 適合在 iPhone／iPad Safari 執行純 DOM、CSS 腳本，但目前不能直接取代本倉庫的 Tampermonkey／Violentmonkey 執行環境。** 8 支正式腳本中，1 支沒有發現靜態阻礙，7 支有確定的啟動阻礙；這不是「1 支已通過 iOS 實測」。

評估日期：**2026-09-08**。倉庫基準：`b260221`，包含 8 支正式腳本、`_template` 與 `shared/`。本次做官方文件／release 原始碼核對及本地靜態檢查，**沒有在 iPhone／iPad 的 Safari + Userscripts 上實測，也沒有修改腳本功能**。

## 產品與版本基準

| 項目 | 評估 |
| --- | --- |
| 產品 | Justin Wasack 的 **Userscripts**，Safari 擴充功能；執行 JavaScript 與 CSS |
| 費用／授權 | 美國 App Store 免費；專案採 GPL-3.0 開源 |
| 本次正式版 | iOS **1.8.6**（App Store：2026-01-11）；GitHub 對應 **v4.8.6 / v1.8.6** release（2026-01-10），`v4.8.6` 是本次程式碼查核用 tag |
| 系統需求 | App Store 列 iOS／iPadOS 15.0+，release README 寫 iOS 15.1+；兩者有差異，使用時採較保守的 15.1+，並以裝置 App Store 顯示為準 |
| 維護狀況 | 正式版有記憶體使用改善；另有 5.0 beta 開發線，不能把 beta／master 功能當成 App Store 已提供 |
| 隱私 | 開發者聲明不收集資料；App Store 說明此聲明未經 Apple 驗證。腳本本身的行為仍需另外判斷 |

來源：[App Store](https://apps.apple.com/us/app/userscripts/id1463298887)、[正式 release](https://github.com/quoid/userscripts/releases/tag/v4.8.6)、[release README](https://github.com/quoid/userscripts/blob/v4.8.6/README.md)、[版本列表](https://github.com/quoid/userscripts/releases)。

使用者提供的 [專案網站](https://quoid.github.io/userscripts/) 是需要 JavaScript 的 Safari 網頁介面；本次文字擷取只有啟用 JavaScript／Safari 相容性提示，因此 API 結論以固定 tag 的 README 與程式碼為依據。GitHub 的 master README 也提醒 API 文件可能對應開發版。

## 值不值得用

**值得作為本倉庫的 Safari 次要支援目標，目前不適合宣稱全倉庫即裝即用。**

- **優點**：免費、原始碼可查；腳本以檔案管理，適合外部編輯器與 iCloud Drive；原生支援 CSS、`@match`、執行時機、遠端相依及更新 metadata。
- **成本**：GM API 集合與呼叫語義和本倉庫不同，尤其是同步 storage、選單與頁面全域存取。iOS 安裝、檔案同步與桌面 manager Dashboard 的操作也不同。
- **本倉庫的選擇**：先以 Page Title Tag 驗證安裝流程；若要正式支援，再從 Hello Userscript 的 API 適配開始。五支對話 exporter 涉及執行環境差異，工時不能估成只換 API 名稱。

上述產品能力見 [正式版 metadata／API 文件](https://github.com/quoid/userscripts/blob/v4.8.6/README.md#metadata)；優先順序是根據下方倉庫檢查的工程判斷。

## iPhone／iPad 安裝與同步

本 repo 現在提供 `just sync-ipad`，可把工作區腳本經 USB 平鋪同步到 iPad；也有
`just sync-folder` 支援 iCloud。命令與首次目錄設定見 [15 · 同步到 iPad](./15-sync-to-ipad.md)。

1. 安裝 App，開啟 Userscripts，確認 Scripts Directory。可使用本機資料夾；要和 Mac 同步可選 iCloud Drive 專用資料夾。
2. 到設定中的 **Safari → Extensions → Userscripts** 啟用，允許要執行腳本的網站；較新 iOS 的 Safari 設定可能位於「設定 → App」下。若從 GitHub raw 安裝，也要讓擴充功能能讀取該安裝頁。
3. 在 **Safari** 開本倉庫 README 的 Install 連結（URL 路徑以 `.user.js` 結尾），再開 Userscripts 的擴充功能彈窗，使用安裝提示。另一個方式是把 `.user.js` 存入已選資料夾。
4. 開一次擴充功能彈窗並等它載入完成，再重新整理目標網站。外部編輯或新增檔案後也做這一步；iCloud 檔案尚未同步時，先在「檔案」App 確認檔案已可讀取。
5. 先測 Page Title Tag。Safari 擴充功能的作用範圍是 Safari 網頁，不能因此期待 ChatGPT、YouTube 等原生 App 裡也會出現腳本 UI。

操作依據：[官方使用說明](https://github.com/quoid/userscripts/blob/v4.8.6/README.md#usage)、[Scripts Directory／外部編輯注意事項](https://github.com/quoid/userscripts/blob/v4.8.6/README.md#scripts-directory)。iOS 沒有 macOS 那套內建編輯器，修改檔案需搭配外部工具，見[專案目前的安裝說明](https://github.com/quoid/userscripts#usage)。

**不要直接把本 repo 的 `userscripts/` 當成可遞迴載入的資料夾。** 正式版只讀取所選目錄的直接子檔案，而本倉庫是 `userscripts/<slug>/<slug>.user.js`；應透過 URL 安裝，或把要用的腳本放在所選目錄最外層。這點由 [`getAllFiles` 的目錄讀取](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/Ext-Safari/Functions.swift#L703)確認。

另外，**iCloud 同步腳本檔案不等於同步 GM 設定**：此版 `GM.getValue`／`GM.setValue` 使用擴充功能的 `browser.storage.local`，並以檔名區分腳本資料；改名也可能使舊資料無法沿用。見 [storage 實作](https://github.com/quoid/userscripts/blob/v4.8.6/src/ext/content-scripts/api.js#L1)。

## API 與 metadata：哪些真的相容

以下以正式版 [grant 白名單](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/Ext-Safari/Functions.swift#L1232)、[API 匯出清單](https://github.com/quoid/userscripts/blob/v4.8.6/src/ext/content-scripts/api.js#L486)及[注入邏輯](https://github.com/quoid/userscripts/blob/v4.8.6/src/ext/content-scripts/entry-userscripts.js#L172)交叉核對。未支援的 grant 會被過濾，**宣告它不會產生相應函式**。

| 本倉庫依賴 | Userscripts 1.8.6 | 對現有腳本的影響 |
| --- | --- | --- |
| `@match`、`@run-at`、`@noframes`、`@grant none` | 支援 | 純 DOM 腳本沒有這一層的阻礙；仍需符合網站 URL |
| `GM_getValue`／`GM_setValue`／`GM_deleteValue` | 不支援這些底線名稱；提供非同步 `GM.getValue`／`GM.setValue`／`GM.deleteValue` | 不能只換名稱：呼叫端目前期待立即讀值或先寫完再開分頁 |
| `GM_addStyle` | 不支援；提供非同步 `GM.addStyle` | Hello 與 YouTube 腳本第一個樣式呼叫就會中斷 |
| `GM_setClipboard` | 不支援；提供非同步 `GM.setClipboard` | 複製流程要等待結果，並依結果顯示狀態；文件使用 MIME 型別如 `text/plain` |
| `GM_openInTab(url, { active: true })` | 不支援；`GM.openInTab(url, openInBackground)` 第二參數是 boolean | 直接保留 options 物件會被當成 truthy，實作產生 `active: false`；介面不能照搬 |
| `GM_registerMenuCommand` | 不支援；也沒有可直接替換的 `GM.registerMenuCommand` | 必須讓頁內 UI 能獨立啟動；現有 exporter 的選單註冊在 UI mount 之前 |
| `unsafeWindow` | 不在支援的 grant／注入 API 中 | 現有 fallback 到 `window`，不能保證取得網站自己的 JS 全域環境 |
| `GM_xmlhttpRequest` | **有支援底線版**，另有 `GM.xmlHttpRequest` | 不能籠統說「所有 GM 底線 API 都不支援」；M365 仍被其他 API 擋住 |
| `@connect` | 未列入正式版支援 metadata | 不能把 TM 的 `@connect` 宣告當成 Userscripts 等價的逐網域授權保證 |
| 遠端 `@require` | 支援 URL，下載後本機快取 | 五支 exporter 的 shared 檔可被載入，但更新有下節的快取問題 |
| `@version`／`@updateURL`／`@downloadURL` | 支援 | 本倉庫使用完整 `.user.js` 作 updateURL，本版能解析其 metadata；仍需實測更新流程 |
| `@icon` | 不作為 UI 圖示使用 | 本倉庫 data URL 圖示不會因此帶來功能錯誤，也不代表會顯示 |

`GM.openInTab` 的參數語義見 [api.js](https://github.com/quoid/userscripts/blob/v4.8.6/src/ext/content-scripts/api.js#L70)，更新 URL 處理見 [更新檢查實作](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/Ext-Safari/Functions.swift#L1800)。

### 換成 GM.* 仍不足以解決 exporter

目前五支 exporter 都先同步讀設定，再建立共用 UI、安裝資料取得邏輯與註冊選單。非同步化需要一起處理初始化、寫入完成時機、失敗回報，以及 [`shared/export-ui.js`](../shared/export-ui.js) 的同步 `storage.get()` 介面。把 Promise 當 boolean 比較會得到錯誤設定，把 Promise 當位置物件也不會還原位置。

Userscripts 在使用受支援 GM grant 時，會把預設 `auto` 注入改成 **content**；強制指定 `page` 則會移除 GM grant。因此，適配 API 後，exporter 依賴的網站全域資料及頁面請求觀察仍需另作設計與驗證，不能用 `unsafeWindow ?? window` 或單加 `@inject-into page` 宣稱已解決。這是[正式版注入規則](https://github.com/quoid/userscripts/blob/v4.8.6/src/ext/content-scripts/entry-userscripts.js#L174)與本倉庫程式碼共同導出的限制。

### shared 更新是另一個獨立風險

五支 exporter 都以固定的 `main/shared/chat-export.js`、`main/shared/export-ui.js` URL 引入依賴。Userscripts 正式版發現相同 URL 的本機快取已存在，就不重新下載。因此，**只更新 shared，甚至只提高主腳本版本，也不能保證取得新版 shared**。

正式支援時可考慮發佈含 shared 的單檔產物，或使用隨發佈更新的不可變依賴 URL。現有使用者依官方做法移除該 `@require`、儲存、再加回並儲存，才能強制重新取得相同 URL 的資源。依據：[README 的 require 說明](https://github.com/quoid/userscripts/blob/v4.8.6/README.md#metadata)、[`getRequiredCode`](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/Ext-Safari/Functions.swift#L757)。

## 逐支相容性結果

「有阻礙」表示現有程式碼不能在原生 Userscripts API 環境直接正常啟動；「未發現阻礙」仍不等於實機通過。

| 腳本／版本 | 現況 | 明確依據與後續風險 |
| --- | --- | --- |
| [Page Title Tag](../userscripts/page-title-tag/page-title-tag.user.js) 1.0.1 | **未發現靜態阻礙，待實機** | `@grant none`，只操作 `document.title` 與 MutationObserver；最適合先試。需測 SPA 切換後標籤仍在 |
| [Hello Userscript](../userscripts/hello-userscript/hello-userscript.user.js) 1.0.2 | **有啟動阻礙** | 首先呼叫 `GM_addStyle`；另有同步 storage、clipboard、menu 依賴。適合作為第一支適配練習 |
| [YouTube Gemini Summary](../userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js) 0.1.2 | **有啟動阻礙＋手機網站缺口** | `installStyles()` 呼叫 `GM_addStyle`；pending 依賴跨網域 GM storage 與同步寫後讀；開分頁介面不同；未匹配 `m.youtube.com` |
| [ChatGPT Export Markdown](../userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js) 1.3.0 | **有啟動阻礙** | 設定迴圈先呼叫 `GM_getValue`；另依賴選單、共用同步 UI、頁面環境及資料來源。沒有 DOM 匯出保底 |
| [Claude Export Markdown](../userscripts/claude-export-markdown/claude-export-markdown.user.js) 1.0.0 | **有啟動阻礙** | 首先讀 `GM_getValue`；依賴頁面環境、選單及分享頁跨分頁狀態；沒有 DOM 匯出保底 |
| [Copilot Export Markdown](../userscripts/copilot-export-markdown/copilot-export-markdown.user.js) 1.2.1 | **有啟動阻礙** | 首先讀 `GM_getValue`；另有頁面環境、選單、分享頁 storage／開分頁依賴；沒有 DOM 匯出保底 |
| [Gemini Export Markdown](../userscripts/gemini-export-markdown/gemini-export-markdown.user.js) 0.2.0 | **有啟動阻礙** | 首先讀 `GM_getValue`；另依賴頁面全域資料、選單、分享頁流程。有 DOM fallback，但未解除啟動阻礙前走不到，且內容可能不完整 |
| [M365 Copilot Chat Export Markdown](../userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js) 0.12.0 | **有啟動阻礙；原本即實驗性** | 首先讀 `GM_getValue`；另有頁面環境、選單及跨網域資料取得限制。`GM_xmlhttpRequest` 名稱有支援不等於完整流程可用；DOM fallback 也走不到 |

[`_template/template.user.js`](../userscripts/_template/template.user.js) 不列入 8 支正式腳本：它是 `@grant none` 的空白範本，替換 placeholders 後沒有明顯 manager API 阻礙。

[`shared/chat-export.js`](../shared/chat-export.js) 的格式轉換不依賴 GM；下載則使用 Blob URL 與 `<a download>`。[`shared/export-ui.js`](../shared/export-ui.js) 已有 pointer events、`touch-action: none` 和位置夾限，觸控不是完全從零開始，但同步 storage 與小螢幕配置仍需處理。[`shared/dom.js`](../shared/dom.js) 目前沒有正式腳本引用，不影響上述 8 支結果。

### YouTube 行動版不是只補一條 match

腳本 metadata 只有 `https://www.youtube.com/*`，啟動分支也明確檢查 `location.hostname === 'www.youtube.com'`。雖然 URL 解析白名單包含 `m.youtube.com`，**那只影響影片連結解析，不會讓腳本在 m 站注入**。

即使補了 match 與入口，卡片／觀看頁 selector 仍主要面向桌面 `ytd-*` DOM，要另外檢查手機版結構。現有 `@media (hover: none)` 已讓觸控時按鈕可見，所以不能把問題單純歸因於沒有 hover。另需確認 Gemini 在切換分頁、喚起鍵盤及 iOS 背景暫停後的行為；目前 pending 有 120 秒期限。

## 若要正式支援，建議的工作順序

1. **先跑 Page Title Tag 的實機安裝／SPA 驗證**，確認擴充功能與檔案流程正常。
2. **以 Hello Userscript 建立共用 API 適配慣例**：非同步 storage、樣式、clipboard 成功回報、無 manager menu 時仍可操作的頁內 UI。
3. **再處理 YouTube 摘要**：跨來源 pending 的讀寫順序、開分頁參數與手機站 DOM。不要用各網站自己的 localStorage 代替跨網域 GM storage。
4. **逐支評估 exporter 的資料來源與執行環境**；設定、UI 能啟動和能完整匯出是兩個驗收項目。保留來源／完整性提示，避免把「有檔案下載」誤認為成功取得完整對話。
5. **確立 shared 發佈與相容性檢查策略**，再把文件狀態升級為正式支援。現有 `check-meta.mjs` 還把 `@inject-into` 視為限定 key；若新增支援目標，需一起調整規則與教學。

這些是後續工作建議，本次評估未實作。

## 實機驗收表

以下皆為**待測**。有啟動阻礙的腳本，要先完成適配才測完整功能。

| 驗收項目 | 通過條件 |
| --- | --- |
| 安裝／外部編輯 | 從 raw URL 安裝；外部改檔後開彈窗、重新整理可看到新內容 |
| 儲存 | reload 後設定與位置保留；跨分頁 pending 先寫入完成再被另一頁讀取 |
| 頁面與時機 | 直接進入、SPA 切換、重新整理、背景再回前景都可用；UI 出現之外也驗證資料完整性 |
| 觸控與版面 | iPhone 直／橫向、iPad、鍵盤展開時可開面板、拖曳與關閉；不遮住主要操作 |
| 複製 | 短文與長對話可真正貼入另一 App；失敗不能先顯示「已複製」 |
| 下載 | Markdown／JSON 能在「檔案」開啟，檔名、中文、內容完整；需特別測目前立即 revoke Blob URL 的做法 |
| 分享頁／摘要流程 | 開分頁、讀取 pending、清除狀態與逾時可預期；YouTube 桌面／手機版分開記錄 |
| 更新 | 主腳本版本更新和 shared 更新分別驗證；iCloud 同步不能代替遠端依賴更新測試 |

記錄時至少附上 iOS／iPadOS 版本、Userscripts 版本、腳本版本、URL 類型（一般／分享頁、桌面／手機版）、預期及實際結果。

`npm run check` 只驗證 metadata 與本倉庫定義的 TM／VM 規則，不是 Userscripts 的相容性測試。`npm run preview` 使用 Chromium 與同步 GM shim，也不能證明 Safari 擴充功能隔離環境、剪貼簿或 iOS 下載正常。工具限制可查 [`check-meta.mjs`](../scripts/check-meta.mjs)、[`preview.mjs`](../scripts/preview.mjs) 與 [13 · Playwright vs. userscript](./13-playwright-vs-userscript.md)。
