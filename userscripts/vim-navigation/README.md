# Vim Navigation

在一般網頁使用 Vim 式導航、連結提示、文字選取與複製。左下角常駐繁中小抄會跟著模式及已輸入的按鍵改變，適合一邊使用一邊練習。

- **安裝**：[Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vim-navigation/vim-navigation.user.js)
- **原始碼**：[vim-navigation.user.js](./vim-navigation.user.js)
- **適用範圍**：HTTP／HTTPS 頂層 HTML 頁面；桌面 Chromium／Firefox，目標 manager 為 Tampermonkey／Violentmonkey。

Install 連結指向已發布的 GitHub `main` 版本。要安裝目前工作目錄中的開發版，可在 userscript manager 建立「新增腳本」，將本地 `.user.js` 的完整內容（包括 metadata）貼入並儲存，再重新載入網頁；不必等候提交或發布。

## 開始練習

1. 在目標網站停用 Vimium／Vimium C 的重疊快捷鍵，再安裝本腳本並重新載入頁面。
2. 使用 `j/k` 捲動，`f` 顯示可操作元素的提示字母。輸入字母執行，`Esc` 取消。
3. `/` 搜尋正文，`Enter` 確認，`n/N` 跳轉；`v` 進入文字選取，移動後按 `y` 複製。
4. 左下角小抄可以拖曳、收合；`?` 開啟完整指令清單，支援搜尋與釘選。
5. 網站有自己的快捷鍵時，按 `i` 暫時放行；`Esc` 回到 Normal。需要把 `Esc` 也交給網站時，用 `Alt+Shift+V` 暫停本頁。

自然聚焦輸入框、`contenteditable` 或編輯器時，腳本會保護文字輸入與中文輸入法，不要求先按 `i`。編輯區內的 `Esc` 也會交給網站，需自行離開輸入框才能回到一般導航。

0.2 版改善 ARIA 檔案樹／選單、換行連結及標題錨點的提示辨識；加入可全域或按網站調整的偵測範圍、`zh` 模擬 hover，並修正 `zv` 的文字起點。腳本自己的搜尋、小抄與設定輸入框會接管鍵盤事件，避免常見網站快捷鍵搶走打字。

## 預設鍵位

### Normal：導航與複製

| 按鍵 | 操作 |
| --- | --- |
| `h/j/k/l` | 左／下／上／右捲動；優先操作最近聚焦或互動的捲動容器 |
| `d/u` | 向下／上捲半頁 |
| `gg/G` | 目前捲動容器頂端／底端 |
| `H/L` | 瀏覽紀錄上一頁／下一頁 |
| `r` | 重新載入 |
| `gu/gU` | 網址上一層／網站根目錄 |
| `gi` | 聚焦可見輸入框 |
| `f/F` | 顯示提示並點擊／在背景分頁開啟 HTTP(S) 連結 |
| `yf` | 以提示選擇並複製連結網址 |
| `/`、`n/N` | 搜尋、下一個／上一個命中 |
| `c/v/V` | Caret 游標／Visual 選取／Visual Line 畫面行選取 |
| `zv` | 以區塊提示指定文字操作起點 |
| `zh` | 以提示選擇目標，模擬 hover |
| `yy/ym` | 複製頁面 URL／Markdown link |
| `ys` | 複製現有選取 |
| `yb/yc` | 以提示選擇並複製文字區塊／程式碼 |
| `i` | 手動 Insert，暫時使用網站快捷鍵 |
| `Alt+Shift+V` | 暫停／恢復本頁腳本 |
| `?` | 展開完整小抄 |

移動可加數字，例如 `5j`、`3w`。Normal 模式的 `y` 是複製指令前綴；按下後，小抄列出可接的鍵。

### Caret／Visual／Visual Line：文字操作

| 按鍵 | 操作 |
| --- | --- |
| `h/l` | 前／後一個字元 |
| `j/k` | 下／上一個畫面行 |
| `w/e/b` | 下一詞開頭／詞尾／前一詞開頭 |
| `0/$` | 畫面行開頭／結尾 |
| `gg/G` | 文件文字開頭／結尾 |
| `v/V` | 切換一般選取／畫面行選取 |
| `c` | 收合選取成游標 |
| `o` | 交換選取的固定端點與移動端點 |
| `y/Y` | 複製目前選取／完整畫面行，成功後回到 Normal |
| `Esc` | 退出目前模式或取消提示 |

進入文字模式會優先沿用現有選取或搜尋命中，否則從畫面中可見正文開始。`V` 依照實際畫面折行選取，視窗寬度與字型會影響行界；詞界依瀏覽器原生分詞，中文與不同語系的結果可能有差異。複製程式碼時保留縮排與換行。

`zv` 明確選到哪個段落，就從那個段落第一個可閱讀、非空白字元開始；跳過隱藏內容與表單／編輯器文字，不會改選畫面上別段正文。巢狀區塊優先顯示細部段落；段落開頭位於內層捲動區上方時，會捲回實際起點。

Visual／Visual Line 不跨過表單控制項、按鈕或編輯器邊界；遇到邊界時保留原選取並提示。因此 `gg/G` 在含有這些元件的頁面可能無法一次選取整頁，可用 `zv` 重選文字起點，或以 `yb/yc` 複製個別區塊。

## 提示偵測與 hover

在設定的「全域提示偵測」選擇預設範圍，或用「本站提示偵測」覆寫目前 origin。本站選擇「沿用全域」即取消覆寫。

| 範圍 | 會增加哪些候選 | 適合情況 |
| --- | --- | --- |
| 精準 `precise` | 原生控制項、具明確互動角色的 ARIA 元件及可用 label；包含 roving tabindex 的檔案樹列 | 想減少非互動區塊的提示 |
| 廣泛 `broad`，預設 | 在精準範圍上，加入明確 click／pointerdown／mousedown handler 與 `cursor:pointer` 互動區域；hover 另辨識 tooltip 線索 | 一般 SPA、自訂按鈕與選單 |
| 積極 `aggressive` | 再加入至少具有兩種弱線索的元件，例如負 tabindex、互動 ARIA 狀態、按鈕／選單類別名稱 | 廣泛模式仍漏掉自訂元件時；可能出現誤判 |

JSON 的全域欄位是 `hintDetection`；`sites[origin].hintDetection` 省略時繼承全域。

三種範圍都保留可操作性與遮擋檢查。檔案樹列只顯示一個主要提示，列內獨立的「更多」按鈕仍能單獨選擇；換行連結使用未被遮住的文字片段。標題旁平時透明、hover 才顯示的 permalink 可列入候選，但透明的整個祖先區塊、隱藏或禁用元件仍會排除。偵測只能推斷 DOM 線索，不能列舉所有網站以事件委派註冊的 handler；可用更高範圍或自訂 selector 補足。

`zh` 送出合成的 pointer／mouse hover 事件，可開啟部分由 JavaScript 控制的選單。選單出現後可接 `f` 點擊，或 `zv` 進入其中的文字。`Esc` 先退出目前的 hints／搜尋／文字模式；回到 Normal 後再按 `Esc`，才清除保留的 hover。實體滑鼠移動、頁面離開或目標失效也會結束模擬狀態。自訂動作的「模擬 hover」使用同一機制。

模擬 hover 不移動真實指標，不會建立瀏覽器的 CSS `:hover` 狀態，也不會偷偷點擊或聚焦。只靠 CSS `:hover`、檢查 `isTrusted` 或使用其他手勢的元件可能沒有反應；HUD 顯示的是正在模擬的目標，不表示網站一定已打開選單。

## 本頁暫停與本站預設

- **本頁暫停**：`Alt+Shift+V`、小抄上的切換按鈕或 manager 選單。除恢復快捷鍵外，其餘按鍵都交給網站；清除腳本提示，保留網頁選取。SPA 換頁繼續暫停，重新載入回到本站預設。
- **本站預設停用**：依完整 origin（協定、主機與 port）保存，適合網頁原生鍵盤操作豐富的網站。暫停時仍保留可恢復的面板按鈕和 manager 選單。
- **手動 Insert**：快速暫借鍵盤給網站，`Esc` 退出；和本頁暫停相比，仍接管退出鍵。

## 客製化與可攜設定

設定介面提供鍵位修改／解除綁定、捲動步長、提示字母、主題及本站設定。所有變更保存在 userscript manager 的 `vimNavigationConfig`，腳本更新不會覆蓋客製值；可用 JSON 匯入／匯出備份。

| 資料 | 保存範圍與生命週期 |
| --- | --- |
| 全域鍵位、提示偵測、捲動步長、提示字母、主題、自訂動作、小抄位置 | 同一 manager／瀏覽器 profile 內，這個已安裝腳本的 GM storage；跨網站、重新載入與重開瀏覽器可沿用 |
| 本站預設啟用、本站鍵位與提示偵測 | 同一份 GM storage 的 `sites[origin]`；origin 包含協定、主機與 port |
| 本頁暫停覆寫、Insert／Caret／Visual、搜尋與模擬 hover | 目前頁面的記憶體狀態；不透過 JSON 備份，重新載入重新建立 |
| 另一個瀏覽器、profile、manager 或裝置 | 獨立的儲存空間；先匯出 JSON，再在目標安裝腳本並匯入設定 |

GM 儲存不是網站的 `localStorage`，也不是瀏覽器雲端同步的保證。manager 同步「腳本」不代表一定同步腳本寫入的 GM values；服務、版本與匯出選項都可能不同。移轉前使用本腳本的「下載 JSON」，移轉後核對鍵位、本站設定與主題，詳見 [GM 儲存](../../docs/04-gm-api.md#持久化儲存) 與 [發佈及同步](../../docs/08-distribution-and-sync.md)。

指令由同一份 command registry 驅動，改鍵後完整小抄與前綴提示立即顯示生效鍵位。匯入會驗證版本、指令 ID、selector、同模式重複鍵位及前綴衝突；失敗時保留原設定並顯示原因。

自訂動作可以指定 CSS selector，執行點擊、聚焦、捲入視野、複製文字或模擬 hover，並限定 origin。多個可用目標會顯示 hints 供你選擇；自訂動作也能綁鍵並顯示在小抄。例如針對常用對話網站，以按鈕或訊息區塊的穩定 selector 建立自己的跳轉／複製操作。網站改版後，selector 可能需要更新。

JSON 的 `bindings` 依模式分組，鍵名是按鍵序列，值是 command ID；`null` 解除預設綁定。例如將匯出設定的 `bindings.normal` 改為以下內容，便能用 `J` 向下捲動，並將 `j` 交還網站：

```json
{
  "j": null,
  "J": "scrollDown"
}
```

這是欄位片段；匯入時仍保留完整匯出檔案中的 `schemaVersion` 等其餘欄位。本站改鍵存於 `sites[origin].bindings`，優先於全域。修飾鍵以 `<a-s-x>`（Alt＋Shift＋X）等格式表示；數字前綴及 `<a-s-v>` 恢復鍵保留。提示字母限定 2～26 個不重複的小寫英文字母，捲動步長為 8～1000px。

0.1 的設定可繼續使用：缺少 `hintDetection` 時沿用預設 `broad`，保留原本鍵位、本站規則、動作與外觀。既有 `zh` 綁定或 `zha` 等相衝突前綴會優先保留；新 hover 指令可能因此沒有預設鍵位，可在設定另綁一組。

匯入設定是宣告式資料，不會執行 JavaScript。需要更深入的擴充時，可在原始碼的 registry 加入指令函式；目前沒有提供可由網站直接呼叫的全域控制 API。

## 權限與資料

不依賴外部函式庫，不將正文、搜尋或設定送往遠端服務。`GM_getValue`／`GM_setValue` 保存設定，`GM_addValueChangeListener` 同步設定，`GM_setClipboard` 寫入剪貼簿，`GM_openInTab` 開啟你透過 `F` 指定的連結，`GM_registerMenuCommand` 提供管理選單。

提示只在啟動時掃描；搜尋處理目前 DOM 內已呈現的文字，不自動載入整篇、翻頁或展開摺疊區塊。

搜尋採不分大小寫的純文字比對，可跨同一區塊內的 inline 元素，不支援正規表示式。為保持頁面可操作，文字索引上限約 500 萬 UTF-16 字元，最多保留 5000 個命中；大型頁面可按 `Esc` 取消。

## 驗證與限制

```bash
npm ci
npx playwright install chromium firefox
npm run test:vim-navigation
npm run verify

# 僅測一個引擎
VN_BROWSERS=chromium npm run test:vim-navigation
```

固定 HTML fixtures 與 GM shim 全部在本機執行；瀏覽器網路請求由測試攔截，不依賴線上網站。截圖輸出在 `.preview/vim-navigation-tests/`，CI 會保存供檢查。

| 環境／能力 | 驗證方式與狀態 |
| --- | --- |
| Chromium／Firefox 的鍵盤、DOM、捲動、選取、搜尋及 UI | v0.2 的 70 項 Playwright 測試通過（每個引擎 35 項），涵蓋 ARIA、偵測範圍、hover、文字起點、輸入隔離與既有功能 |
| GM 儲存、剪貼簿、開頁及選單呼叫 | 測試 shim；不等於真實 manager 驗證 |
| Chromium 151.0.7922.34＋Violentmonkey 2.48.0，v0.2 | 隔離 profile、真實 manager、公開 GitHub：17/17 檔案樹列有 hints，實際輸入搜尋文字、搜尋接 Visual、`zv` 接明確 Caret 起點通過 |
| Chromium 151.0.7922.34＋Violentmonkey 2.48.0，v0.1 基線 | macOS 隔離 profile、正常視窗，固定頁面的 10 項煙霧驗證通過 |
| Chromium 151.0.7922.34＋Tampermonkey 5.5.0，v0.1 基線 | 官方 CRX 解包副本、隔離 profile，9 項真實 manager 檢查通過；原生剪貼簿尚未驗證 |
| Firefox 上的真實 manager | 已載入 Mozilla 簽署的 Violentmonkey；控制頁導航超時，尚未驗證 userscript 注入 |
| 任意網站／Vimium C 全部快捷鍵的相容性 | 不作全面相容保證；優先測常用網站 |

v0.2 的 GitHub 驗證使用真實 Violentmonkey、公開且未登入的頁面，沒有 GM shim；特別核對檔案樹提示覆蓋，以及實際輸入 `scripts` 時不被網站快捷鍵帶走，並接續 Visual／Caret。此紀錄限於上述互動，不等於所有網站或 manager 的完整驗收。

另保留 v0.1.0 的固定頁面實機基線。Violentmonkey 的基線驗證透過 manager 介面匯入腳本，在本機 HTTP 頁面確認注入與樣式、捲動、URL 與 Visual yank 的系統剪貼簿內容、提示點擊、背景開分頁、暫停／Esc／重載、輸入欄位及搜尋；沒有注入 GM shim。剪貼簿以正常瀏覽器視窗驗證，headless 的 offscreen clipboard 結果不能作為系統剪貼簿驗收依據。測試只使用隔離 profile，沒有把測試腳本裝進日常瀏覽資料。

Tampermonkey 的 v0.1 基線檢查涵蓋注入、內層捲動、提示點擊、暫停／Esc／重載、GM 設定保存、輸入保護、搜尋與背景開頁。測試副本的 extension ID 與商店安裝版不同；切換到正常視窗後未能完成注入，原生剪貼簿步驟因此沒有執行，不能聲稱已驗證。Firefox 的隔離 manager 控制頁也未能開啟，因此 Firefox 目前的功能證據來自引擎與 GM shim 測試。

鍵盤隔離針對腳本 UI 的 `keydown`／`keypress`／`keyup`，會保留原生文字編輯與 IME 流程；並非文字隱私隔離，網站仍可能觀察原生 `input` 或 composition 事件。若網站更早註冊 window capture listener 並先攔截，userscript 也無法保證取得事件。

尚需在常用真實網站核對中文輸入法、網站自訂元件、複雜 SPA 與各 manager 的選單操作；不把固定頁面煙霧測試當作所有網站相容保證。

目前只處理頂層 HTML 頁面；連結 hints 可遍歷 open Shadow DOM，文字操作限定同一棵 DOM tree。不讀取 iframe、closed Shadow DOM 或 canvas 內文字；不提供分頁切換／重排、關閉分頁復原、瀏覽器書籤與歷史搜尋，也不能注入瀏覽器保護頁面。由 JavaScript 模擬的點擊不是 trusted click，部分元件仍須手動操作。SPA 移除目前文字或提示目標時，腳本會取消操作並提示重新選取。
