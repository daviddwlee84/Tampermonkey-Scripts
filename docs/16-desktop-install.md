# 16 · 桌面批量安裝（Violentmonkey）

**`just vm-pack` 把目前工作區的腳本打成 ZIP，在 Violentmonkey 一次匯入。**
Arc／Chrome／Edge／Zen／Firefox 的每個 profile 各匯入一次，同一份 ZIP 可以重複使用。
這也適合本機尚未 push 的修改；要更新時重新打包、匯入即可。

## 第一次：安裝 Violentmonkey

| 瀏覽器  | 官方來源                                                                                                                   | Mac 上的命令              |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Arc     | [Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)                | `just vm-install arc`     |
| Chrome  | [Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)                | `just vm-install chrome`  |
| Edge    | [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao) | `just vm-install edge`    |
| Zen     | [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/violentmonkey/)                                                 | `just vm-install zen`     |
| Firefox | [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/violentmonkey/)                                                 | `just vm-install firefox` |

`just vm-install` 不帶瀏覽器時，使用預設瀏覽器開啟 [Violentmonkey 官方下載入口](https://violentmonkey.github.io/get-it/)。
指定瀏覽器使用 macOS 的 `open -a`；Windows／Linux 請在目標瀏覽器開上表連結。
可加 `--dry-run` 只看 URL。找不到指定 App 時報錯，不會悄悄開到另一個瀏覽器。
命令不選 profile；安裝前請在瀏覽器確認目前使用的是預期的 profile。

官方下載入口目前列有 Chromium 的 MV3 版本，以及 Firefox 的版本；請由官方頁面前往適合的商店。
[Zen 官方文件](https://docs.zen-browser.app/user-manual/extensions) 說明其支援 Mozilla Add-ons；
Arc 的安裝入口也可由 [Add Extension](https://resources.arc.net/hc/en-us/articles/19434259167767-Extensions-in-Arc-How-to-Import-Add-Open) 開啟。

安裝後把 Violentmonkey 固定到工具列，並確認它有目標網站的存取權限。
Chrome 138+ 還要在 `chrome://extensions` → Violentmonkey → Details 開啟 **Allow User Scripts**；
較舊 Chrome 使用 **Developer mode**。Arc／Edge 請檢查其擴充功能詳細資料中的對應開關，
不同版本的介面可能不同。[Chrome 官方 userscripts 說明](https://developer.chrome.com/docs/extensions/reference/api/userScripts)

## 產生安裝包

只需要 Python 3.10+ 與 `just`，不需 `npm install`、`uv`、USB 裝置或第三方 Python 套件。

```bash
just vm-plan   # 顯示預設腳本及 ZIP 路徑，不寫檔
just vm-pack   # 寫入 dist/violentmonkey-scripts.zip
```

分類與 [README 清單](../README.md#腳本清單) 共用 [`scripts/catalog.json`](../scripts/catalog.json)：

| 代號           | 內容                                              | 預設 ZIP |
| -------------- | ------------------------------------------------- | -------- |
| `ai-export`    | ChatGPT、Claude、Copilot、Gemini 對話匯出         | 包含     |
| `page-tools`   | Page Reader、Media Helper、YouTube Gemini Summary | 包含     |
| `keyboard`     | Vim Navigation、Vimium C Companion                | 包含     |
| `experimental` | M365 Copilot Chat 匯出                            | 不包含   |
| `examples`     | Hello Userscript、Page Title Tag                  | 不包含   |

分類依用途與成熟度整理，預設包含不代表所有瀏覽器／網站都已驗證。
Vim Navigation 提供頁內操作；Vimium C Companion 用來搭配另行安裝的原生 Vimium C，請按需求選擇。

```bash
just vm-plan --all
just vm-pack --category ai-export --category page-tools
just vm-pack --category examples
just vm-pack --only page-reader-markdown --only media-helper
just vm-pack --all

# 指定輸出路徑（含空白也可以）
just vm-pack --zip "/tmp/My Scripts.zip" --category ai-export
```

`--category`、`--only`、`--all` 三種選法互斥；前兩種可重複。
每次完整重建 ZIP，不會把上次選入的腳本殘留在新包。
未知腳本／分類、未分類或重複分類的來源都會報錯，避免漏裝。
`_template` 永遠排除；iPad 的 `just sync-ipad`／`sync-folder` 仍預設複製全部非範本腳本。

## 在 manager 匯入

1. 點 Violentmonkey 圖示，開啟 **Dashboard**，進入 **Settings**。
2. 找到 **Import from zip**（介面語言不同時為對應的 ZIP 匯入按鈕）。
3. 選取 `dist/violentmonkey-scripts.zip`；檔案選定後 manager 會開始匯入。
4. 檢查匯入報告的數量、錯誤與依賴下載結果，再回腳本清單核對名稱、版本及啟用狀態。
5. 重新整理目標網站，確認需要的工具出現。在下一個 browser profile 重複以上步驟。

這是批量匯入，不是持續監看 repo；重新執行 `vm-pack` 只更新 ZIP，仍要在各 profile 再匯入。
命令不直接寫入瀏覽器的擴充功能資料庫；manager 的腳本儲存格式由瀏覽器管理，
不同瀏覽器不能照搬 iOS 的資料夾同步方式。[Violentmonkey FAQ](https://violentmonkey.github.io/faq/)

## 內容與更新規則

- ZIP 只含平鋪的 `<slug>.user.js`，逐 byte 保留原始碼與 metadata；沒有 manager 設定、啟用清單或 GM values。
- `@name`／`@namespace` 沒改時，重複匯入會更新同身分的腳本。它可能覆寫 manager 編輯器裡的手改內容，即使版本號相同；要保留的修改請先匯出。
- 選入更少腳本只會縮小 ZIP，不會停用或刪除 manager 裡之前裝過的其他腳本。
- `@updateURL`／`@downloadURL` 保留，ZIP 匯入本身不會阻止自動更新；請確認 manager 的全域更新頻率與各腳本更新設定。
- 這個包不是設定備份。要跨瀏覽器搬 GM values、鍵位與自訂設定，使用腳本自己的設定 JSON，或 manager 明確包含 values 的匯出功能。
- `shared/` 和第三方依賴不打包，`@require` 仍由 manager 下載原本的遠端 URL。本地 shared 改動與遠端依賴快取要另行處理。
- GitHub 的自動更新可能替換本地匯入版本；需要測試未發佈修改時，留意該腳本的更新設定。
- ZIP 先寫暫存檔、讀回核對再替換舊產物；輸出在已忽略的 `dist/`，不需 commit ZIP。

純腳本 ZIP 的依據是 [Violentmonkey v2.49.0 匯入程式](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/options/views/tab-settings/vm-import.vue)：
它讀取 `.user.js` entries，額外的 manager／values 資料可省略。
更新來源規則見 [metadata 文件](https://violentmonkey.github.io/api/metadata-block/#downloadurl)。

## 驗證與排錯

```bash
just check
just test-sync
just vm-plan --all
just vm-install firefox --dry-run
```

ZIP 測試核對分類選擇、來源 bytes、內容重建、dry-run、錯誤路徑與既有 iPad 同步行為。

2026-09-09 驗證結果：

- `just check` 通過：12 支腳本零 metadata 錯誤，保留原有 5 項第三方依賴提醒，README 索引一致。
- `just test-sync` 的 22 項測試通過；`vm-install` 的五個瀏覽器與預設入口皆完成 dry-run 路由檢查。
- 在隔離的 Playwright Chromium **151.0.7922.34** profile，載入官方 release 的 **Violentmonkey 2.49.0／MV3**，透過 Settings UI 成功匯入預設 9 支 ZIP。
- 重複匯入同版本 ZIP 後，仍為相同的 9 個 script ID；更新 URL、啟用狀態與自動更新開關保留。
- `--all` 的 12 支 ZIP 匯入成功，manager 儲存的 12 份原始碼均與工作區內容一致。

這些是實際 manager 匯入證據；尚未逐一操作 Arc／Chrome／Edge／Zen／Firefox 的日常 profiles，
也不代表所有腳本在各目標網站的功能均已驗證。未測試伺服器發佈新版後的完整自動更新週期。
額外的 Hello Userscript 執行檢查停在 Playwright `browserContext.route` 的 fixture 設定階段，
數分鐘後結束隔離 Chromium；尚未導覽 fixture，因此這項執行檢查記為未驗證。
本機測試記錄與匯入報告截圖位於 `.preview/desktop-install/`，隔離 profile 在結束後移除。

| 症狀                                      | 處理                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| ZIP 不含 Hello Userscript／Page Title Tag | 使用 `--category examples` 或 `--all`                                      |
| 重打包後 dashboard 沒變                   | 還需要選取新 ZIP 匯入；確認 browser profile                                |
| 匯入成功但工具沒出現                      | 重新整理網頁，檢查 `@match`、啟用狀態、網站權限與 Allow User Scripts       |
| 依賴下載失敗                              | 核對 manager 報告中的 `@require` URL 與網路；ZIP 不含離線依賴              |
| 新 ZIP 移除腳本但 manager 裡還在          | ZIP 不會 prune；自行停用或刪除舊腳本                                       |
| 不想使用 just                             | `python3 scripts/sync-userscripts.py --zip dist/violentmonkey-scripts.zip` |

## 下一步

回到 [08 · 發佈與同步](./08-distribution-and-sync.md)，設定 GitHub 更新來源與跨瀏覽器的設定移轉。
