set positional-arguments

# 列出常用命令
default:
    @just --list

# 驗證腳本 metadata 與 README 索引
check:
    npm run verify

# 啟動本地恐龍 AI 實驗場（http://127.0.0.1:8787/dino/）
dino:
    npm run dino

# 開啟 Violentmonkey 官方安裝頁；macOS 可指定 arc/chrome/edge/zen/firefox
vm-install *args:
    @python3 scripts/open-violentmonkey.py "$@"

# 預覽桌面 ZIP 清單；預設排除教學／實驗，可加 --all、--category ID、--only SLUG
vm-plan *args:
    @python3 scripts/sync-userscripts.py --zip dist/violentmonkey-scripts.zip --dry-run "$@"

# 產生 ZIP，供各瀏覽器的 Violentmonkey 一次匯入；篩選參數同 vm-plan
vm-pack *args:
    @python3 scripts/sync-userscripts.py --zip dist/violentmonkey-scripts.zip "$@"

# 只列出準備同步的腳本，不連接裝置、不寫檔
sync-plan *args:
    @python3 scripts/sync-userscripts.py --plan "$@"

# 列出 USB 連接的 iOS 裝置（首次執行 uv 會下載相依套件）
ipad-devices:
    @uv run --script scripts/sync-userscripts.py --list-devices

# 同步到 USB iPad；可加 --dry-run、--udid ID、--only SLUG
sync-ipad *args:
    @uv run --script scripts/sync-userscripts.py "$@"

# 同步到指定本機／iCloud 資料夾；可加 --dry-run、--only SLUG
sync-folder directory *args:
    @python3 scripts/sync-userscripts.py --folder "$@"

# 傳輸／ZIP 工具測試（不需要 iPad 或第三方 Python 套件）
test-sync:
    python3 -m unittest discover -s tests -p 'test_sync_userscripts.py'
