# Vimium C Companion

Vimium C 的常駐個人鍵位小抄。由 **Vimium C 執行操作**，Companion 提供分類參考、收藏、設定檔鍵位預覽與練習流程。

- **生效網站**：頂層 HTTP(S) 頁面。
- **安裝**：[安裝 userscript](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vimium-c-companion/vimium-c-companion.user.js)，支援 Tampermonkey／Violentmonkey 的共通 GM API。
- **原始碼**：[vimium-c-companion.user.js](vimium-c-companion.user.js)。
- **原生擴充**：[Vimium C](https://github.com/gdh1995/vimium-c)。Companion 不會自動安裝、偵測或更改原生擴充。

## 開始使用

1. 安裝並啟用 Vimium C 與本腳本。
2. 左下角選擇「練習分類」，查看常用鍵位及操作流程；星號可加入收藏。
3. 打開完整查詢，以按鍵、中文用途或英文命令名稱搜尋，包含進階與未綁定命令。
4. 有自訂 Vimium C 配置時，在設定中匯入原生設定；預覽後再套用。

面板可拖曳、收合、切換主題；位置和偏好會保存。分類是你手動選的練習主題，不是即時 Vimium C 模式。引用列只供閱讀，不能點擊來執行原生命令。

若同時裝了 repo 的 [Vim Navigation](../vim-navigation/README.md)，搭配原生 Vimium C 時應停用那支獨立導覽腳本，避免兩套導航攔截相同按鍵。Companion 不會替你更改其他腳本的啟用狀態。

## 顯示小抄與讓網站使用快捷鍵

| 需求 | 操作 |
| --- | --- |
| 暫時收起小抄 | 收合面板，保留小徽章 |
| 隱藏／恢復小抄 | userscript manager 選單「Vimium C Companion：顯示／隱藏小抄」 |
| 只在目前網站隱藏 | 面板設定或 manager 選單「本網站顯示／隱藏」；以 origin 儲存 |
| 網站使用自己的快捷鍵 | 使用 Vimium C 原生 `i` 進入 Insert，`Esc` 返回；實際鍵位以你的原生配置為準 |
| 持續停用某網站的原生導航 | 在 Vimium C Options 設定 exclusions |
| 打開原生完整 help | 使用原生 `?` |

Companion 不占用全域快捷鍵。它的顯示開關只控制說明面板，不會啟用／停用 Vimium C。一般頁面與面板非編輯控制項上的 `f`、`j`、`v` 等按鍵保留給原生擴充。

需要以一個按鍵切換原生暫停狀態，可以在 **Vimium C Options** 加入官方範例：

```text
map <f7> openUrl url="vimium://status/toggle/^\u0020<f7>"
```

這是 Vimium C 解析的命令，不是可從一般網頁開啟的連結。它保留 F7 恢復鍵；重新載入或導覽可能重設暫停狀態。[官方說明](https://github.com/gdh1995/vimium-c/wiki/Enable-or-Disable-all-frames-by-a-shortcut)

## 文字選取與複製練習

使用原生預設配置時：

- `yv`：選擇可見文字的提示，進入原生 Visual；接著以原生移動鍵調整選取，`y` 複製。
- `/` 搜尋文字 → `Enter` 接受搜尋 → `v` 進入 Visual → 調整選取 → `y` 複製。

操作流程依目前選用的設定檔顯示可確認的鍵位。自訂配置中未綁定或無法確定的命令會提示缺口，不會默默換成預設按鍵。Companion 不判定命令是否成功，也不自動切換練習分類。

## 匯入 Vimium C 設定

在 Vimium C Options 匯出設定 JSON，再到 Companion 設定的原生匯入入口選檔或貼上內容。也可以只貼 key mappings，例如：

```text
map z scrollDown
unmap j
map <c-j> scrollDown
```

匯入分成「解析預覽」與「套用」；只有套用才更新 Companion。可在「原生預設」和「匯入設定」之間切換，不會寫回 Vimium C。

原生匯出是頂層 JSON，`name` 為 `Vimium C`（也接受 `Vimium++`）；不是 `{settings: {...}}`。原生只匯出非預設設定，因此缺少 `keyMappings` 表示使用原生預設，與 `unmapAll` 不同。支援字串／字串陣列、續行、原生逐行 `$base64:` 編碼。

### 「設定檔鍵位預覽」的意思

本版靜態處理 `map`、`unmap`、`unmapAll`、`map!`、`unmap!` 與 mode suffix，並保留原始命令參數。`map!` 同時作用於 Normal 與 Insert；`map <key:i> ...` 只作用於 Insert。

以下情況會保留原文、行號與診斷，可能使預覽標示為「部分解析」：

- `#if`／`#else`／`#endif` 條件區塊、環境覆寫。
- `mapKey`／鍵盤布局轉譯、`runKey` 或其他自訂命令流程。
- 重複／錯誤映射、未知指令、無法確認的參數或條件。

條件分支不會被任選一支當作結果。若不確定操作可能影響所有映射（例如條件式 `unmapAll`），整份預覽都會標示限制。原生預設總表仍可另行查閱，但不會被假稱為匯入設定的實際結果。

`exclusionRules` 等資訊保留在原始設定中；Companion 不自行求值來聲稱原生目前已停用。瀏覽器管理的全域快捷鍵不包含於一般 key mappings 匯出，需到瀏覽器快捷鍵設定確認。顯示的是邏輯鍵位，實際鍵盤布局以 Vimium C 配置為準。

## 配置持久化與備份

Companion 使用 manager 的 **GM storage**，鍵名為 `vimiumCCompanionConfig`，設定版本為 `schemaVersion: 1`。儲存的是：

- 主題、練習分類、收藏、鍵位來源。
- 匯入原文與重新解析的設定檔資料。
- 面板位置、收合／隱藏狀態、各 origin 的顯示偏好。

同一個 manager 中跨網站共用這份設定；其他分頁透過 GM value-change listener 更新。它與網頁 localStorage、Vim Navigation 的 `vimNavigationConfig`、Vimium C 原生 storage 都是不同資料。

「Companion 備份」另有匯出／匯入入口，其頂層格式是：

```json
{
  "type": "Vimium C Companion",
  "schemaVersion": 1,
  "config": {}
}
```

上例只展示辨識欄位；請使用實際匯出的完整檔案還原。還原時會重新解析原生設定原文，不信任備份內的衍生鍵位。無效備份不覆蓋現有配置。重設只清除 Companion 的偏好與匯入設定，不會改動 Vimium C。

換機時請匯出 Companion 備份並在新 manager 匯入。manager 內建同步、userscript 程式碼更新與 GM 資料同步是不同機制，不能因腳本已同步就假設個人配置也已同步；詳見 [分佈與同步](../../docs/08-distribution-and-sync.md)。

## 版本來源與能力邊界

命令 catalog 來自官方 **Vimium C 2.12.2** 安裝包的命令表、help 分組與語系資料，對照版本來源 commit `9e780336ee36ef947e76258e2018cceb69de7e4f`；腳本內保留來源資訊及原生授權聲明：原創程式碼使用 MIT，原生衍生資料使用 Apache-2.0，兩份授權隨 raw userscript 一起分發。catalog 隨本腳本發版更新，執行時不抓取 Wiki。

- [原生命令與預設鍵位](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts)
- [原生 help 分組](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/help_dialog.ts)
- [原生設定匯入／匯出](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/pages/options_ext.ts)

顯示版本與不同商店的 package version 可能不同；匯入版本資訊僅供參考，不憑版本字串不同就判定配置錯誤。未來新增的命令會保留為未知／自訂項目，不能自動取得新版完整 catalog。

v0.1 沒有命令橋接或模式同步，設定中的互動模式標為「規劃中」。不使用私有 `VApi`、原生 extension 內部頁面訊息或合成 KeyboardEvent 執行命令。後續研究見 [TODO](../../TODO.md) 與 [橋接研究](../../backlog/vimium-c-companion-bridge.md)。

瀏覽器設定頁、擴充商店等禁止 userscript 的頁面不顯示面板；子 frame 不重複注入。Companion 的輸入框有範圍限定的鍵盤保護，但不能保證比所有 extension／網站更早收到事件；原生特殊 Insert 映射也需自行確認。實際 Vimium C 可能先處理 `Esc`，只移開輸入焦點而保留查詢視窗；此時可按 `f` 選擇 × 關閉，或直接點擊 ×。

## 開發與驗證

```bash
npm run test:vimium-c-companion
npm run check
npm run index
npm run verify
```

測試涵蓋原生設定解析、鍵位來源、面板操作、GM 配置、鍵盤隔離與 Chromium／Firefox 截圖。自動化 GM shim 只驗證 API 契約，不能替代真正 manager 與 Vimium C 的共存驗證。實測紀錄見 [VALIDATION.md](VALIDATION.md)。
