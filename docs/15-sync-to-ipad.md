# 15 · 用 just 同步腳本到 iPad

在 Mac 執行 **`just sync-ipad`**，就會把目前工作區的正式 `.user.js` 平鋪複製到 USB iPad 的 Userscripts App。包含尚未 commit 的腳本內容，不需要先 push GitHub。

同步工具只搬檔案，不會適配 GM API。能在資料夾看見腳本和能在 Safari 正常執行是不同的驗收項目，請搭配 [14 · Userscripts 相容性評估](./14-ios-userscripts.md)。第 14 章是 2026-09-08 的 8 支腳本快照；同步命令會自動收集目前倉庫的全部非範本腳本，實際數量以 `just sync-plan` 為準。iPad／資料夾同步包含教學與實驗腳本，與 [桌面 ZIP](./16-desktop-install.md) 的預設選擇不同。

## 第一次設定

Mac 需要 `just`、`uv` 及 Python 3；`just sync-ipad` 會用 uv 的隔離環境安裝固定版本 `pymobiledevice3==11.10.2`，不需要全域 pip 安裝、完整 Xcode 或 macFUSE。

1. iPad 安裝並開啟 Userscripts。
2. 用可傳輸資料的 USB 線接到 Mac，解鎖 iPad，先在 Finder 完成「信任這部電腦」。同步工具使用已有的配對，不會自動配對或等待你處理信任提示。
3. 在 repo 執行：

   ```bash
   just sync-plan           # 看來源清單，不存取 iPad
   just ipad-devices        # 列出 USB 裝置 ID
   just sync-ipad --dry-run # 讀取 iPad 比較差異，不寫入
   just sync-ipad           # 實際同步
   ```

4. 在 iPad 的 Userscripts App 設定 Scripts Directory，選擇：

   ```text
   我的 iPad / Userscripts / Tampermonkey-Scripts
   ```

5. 啟用 Safari 的 Userscripts 擴充功能與目標網站權限，開一次擴充功能彈窗並等它載入完，再重新整理網站。

**步驟 4 是首次必要的手動設定。** USB 只能寫入 App 開放的 Documents，不能自動改 Userscripts 的目錄選擇，也不能透過這個 App 取得你在「檔案」中選過的其他 App／iCloud 資料夾。

Userscripts 的 [iOS Info.plist](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/App-iOS/Info.plist) 啟用了 `UIFileSharingEnabled`。工具透過 pymobiledevice3 的 [House Arrest Documents 服務](https://github.com/doronz88/pymobiledevice3/blob/v11.10.2/pymobiledevice3/services/house_arrest.py)及 [AFC 檔案服務](https://github.com/doronz88/pymobiledevice3/blob/v11.10.2/pymobiledevice3/services/afc.py)操作，僅使用正常檔案共享，不需要越獄。iOS 正式 App 的 bundle ID 同樣是 `com.userscripts.macos`，見 [Userscripts release 設定](https://github.com/quoid/userscripts/blob/v4.8.6/xcode/xcconfig/Userscripts-Release.xcconfig)。

## 日常操作

```bash
just sync-ipad

# 只同步指定腳本；--only 可重複
just sync-ipad --only page-title-tag
just sync-ipad --only page-title-tag --only hello-userscript

# 接了多台 Apple 裝置時，明確指定剛才列出的 iPad ID
just sync-ipad --udid DEVICE_ID

# 改成 App Documents 內的另一個子資料夾
just sync-ipad --remote-folder scripts
```

預設專用子資料夾可避免和之前從 URL 安裝、以 `@name` 命名的副本混在一起。若自行改用既有資料夾，請檢查是否同時存在同一支腳本的多份副本；工具不會根據 `@name` 刪除或重新命名舊檔。

只選擇 **USB** 裝置，不使用 Wi-Fi 連線；沒有裝置、未信任、選到非 iPad 或同時接了多台卻沒指定 ID，命令會報錯退出。同步中拔線也會以失敗狀態退出，不能把失敗當作已同步。

## iCloud 或本機資料夾

如果 Userscripts 已經指向 iCloud，Mac 端直接同步到**同一個** iCloud 資料夾即可，不需要插線：

```bash
just sync-folder "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Userscripts" --dry-run
just sync-folder "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Userscripts"
```

這個命令只需要 Python 標準庫，不會載入或安裝 USB 相依套件。路徑可以含空白，範例中的 `Userscripts` 只是資料夾名稱；請替換成你在 iPad 上實際選取的目錄。工具確認的是 Mac 上的檔案內容，不能確認 iCloud 已傳到 iPad；要在 iPad「檔案」App 確認下載完成，再開擴充功能彈窗。

## 寫入規則

- 自動收集 `userscripts/<slug>/<slug>.user.js`，排除 `_template`、隱藏目錄和其他檔案；遇到壞掉的來源或不認得的 `--only` 名稱會停止。
- 目標是平鋪的 `<slug>.user.js`，完整保留原始 bytes、版本、grant、更新 URL 及 `@require`；不改腳本功能。
- 比較內容，相同就跳過；新增與覆寫前先寫暫存檔並讀回校驗，避免半份傳輸直接取代舊腳本。
- 實際執行時每支成功的檔案顯示 `synced`，括號區分 `added`、`updated` 或 `unchanged`。例如 `Synced 10 file(s); 0 written, 10 unchanged` 表示 10 支都已一致，這次無須寫入；dry-run 則顯示預計動作與 `to write` 數量。
- 覆寫前把舊版本留在目標的 `.sync-backups/<本次 ID>/<slug>.user.js.bak`。備份子目錄和 `.tmp` 不會被 Userscripts 當成腳本執行。需要回復時，可在「檔案」App 將備份複製回最外層並移除 `.bak`。
- 不刪除目標的其他檔案；從 repo 刪除或改名的腳本也不會自動從 iPad 清除，請自行停用或刪除。
- 每支檔案獨立更新，整批不是單一交易。斷線後，已完成的檔案保留；若剛好在搬移舊檔後失敗，舊檔仍在備份位置。重新執行即可繼續，也可手動回復備份；殘留 `.tmp` 可刪除。

**`shared/` 不會被複製或打包。** 目前腳本仍由 `@require` 讀取遠端 shared／第三方依賴。若只在本地修改 shared，這條同步命令不會把變更帶到 iPad；固定 URL 的相依快取限制見 [14 的 shared 更新說明](./14-ios-userscripts.md#shared-更新是另一個獨立風險)。同樣，遠端 `@updateURL` 保持有效，使用 manager 的更新功能可能把本地未發佈版本換成 GitHub 版本。

## 驗證與排錯

```bash
just check
just test-sync
just sync-ipad --dry-run  # 同步後應全部顯示 unchanged
```

測試覆蓋平鋪複製、原始內容保留、增量跳過、備份、不刪其他檔案、dry-run 零寫入、符號連結拒絕、失敗回復、裝置選擇與 AFC 傳輸介面；不需要接 iPad。

2026-09-09 已在連接的 iPad 上完成 USB dry-run 與 10 支腳本的實際傳輸，重新讀回比對全部為 `unchanged`；Safari 的腳本執行相容性不包含在這次傳輸驗證中。

| 症狀 | 處理 |
| --- | --- |
| 找不到 USB 裝置 | 用 `just ipad-devices` 檢查；確認資料線、解鎖及 Finder 信任。不要只依賴 `system_profiler` 的 USB 清單 |
| 配對或服務錯誤 | 先在 Finder 確認能開啟 iPad，並確認已安裝、開啟 Userscripts；一般檔案共享不需要 Developer Mode |
| 同步完成卻沒看到腳本 | 確認 Userscripts 選的是工具列出的子資料夾，而非 Documents 根目錄或另一個 iCloud 目錄；開彈窗再刷新 |
| 看得到但執行失敗 | 檢查網站權限、match 與 GM API 相容性；檔案傳輸成功不代表腳本已適配 |
| 不想使用 just | `python3 scripts/sync-userscripts.py --help`；USB 用 `uv run --script scripts/sync-userscripts.py` |

## 下一步

[16 · 桌面批量安裝](./16-desktop-install.md)
