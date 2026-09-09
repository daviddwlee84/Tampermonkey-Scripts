# v0.1.0 驗證紀錄

日期：2026-09-09。交付物為單檔 userscript、固定版本的本地遊戲與測試工具；驗證過程未修改日常瀏覽器 profile 的設定或安裝腳本。

## 自動化

瀏覽器：Playwright 綁定 Chromium **151.0.7922.34**、Firefox **153.0**。

| 層級               | 案例數 | 結果與範圍                                                                            |
| ------------------ | ------ | ------------------------------------------------------------------------------------- |
| 歷史原檔／純函式   | 4      | 通過；原檔與上游 SHA-256、600 組原版決策對照、固定引擎適配位置、參數及統計            |
| Chromium + GM shim | 9      | 通過；物理／碰撞交叉驗證、控制台、預設、鍵盤隔離、延遲載入、啟停、A/B、倍率及高速場景 |
| Firefox + GM shim  | 9      | 通過；同 Chromium 場景，高速測試分段重跑完成                                          |

共 **22 個不同案例通過**。完整執行中 21 個通過，Firefox 高速測試曾碰到 120 秒時間上限；將相同模擬改為每 5 秒遊戲時間讓出主執行緒後，兩引擎的高速場景定向重跑均通過。Firefox 此項執行約 60.7 秒，測試的 240 秒上限另容納 fixture 與環境延遲。

每個瀏覽器的高速場景涵蓋 6／9／13 三種起始速度、三個種子，各 60 秒遊戲時間。物理交叉驗證包含保持跳躍、提早收跳、快速落地及跑步／蹲姿碰撞框。

相同種子、策略與參數在 **1×／20×** 的動作序列、障礙物序列、分數與死亡狀態相同；20× 測試同時開啟資訊顯示並將視窗縮到 390 px，確認邏輯跑道仍保持 600 px。

`npm run verify` 通過：13 支腳本、0 個 metadata 錯誤、索引一致；5 項既有外部 `@require` 提醒皆來自 page-reader，Dino 無新增提醒。桌面 ZIP／同步測試 **22 / 22 通過**；新增實驗性腳本不進入預設安裝包。交付 JS 的 syntax、修改檔案的 Prettier 與 `git diff --check` 通過。

GM shim 用 localStorage 模擬設定保存，無法證明 manager sandbox 或真實 GM storage。以上 browser tests 和下列 manager 狀態分開記錄。

## 固定種子 A/B

透過交付控制台以 20× 完成 10 組配對，共 20 局；每局上限 180 秒。兩策略全部達到上限，分數都是 2,898。10 組配對的完整障礙物紀錄亦逐組一致。

詳細條件、腳本 SHA-256 與逐組表格見 [BENCHMARK.md](BENCHMARK.md)。此結果支持固定條件下的平手，不支持新版必定分數較高。

## 線上 smoke test

以下使用 Chromium 與明確 GM shim，在線上原頁執行交付腳本，未繞過 CSP。這是頁面相容性測試，不是 manager 安裝測試。

| 網站                                    | 實際操作與觀察                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `https://wayou.github.io/t-rex-runner/` | 偵測 Runner、原版啟動、切 Predictive、面板輸入、切手動；觀察約 9.7 秒遊戲時間，無 userscript／page error。 |
| `https://chromedino.com/`               | 同樣操作，觀察約 9.3 秒遊戲時間，無 userscript／page error；觀察結束時該局已死亡。                         |

短時間 smoke 不代表可持續存活或分數提升；線上頁面的 frame timing 和固定 60 Hz 本地模型不同，卡頓可能使 AI 錯過操作時機。線上加速、批次 A/B、換皮與 3D 遊戲未提供。

## 真實 manager：未驗證

已使用官方擴充檔案與全新隔離 profile 嘗試：

- **Violentmonkey 2.49.0**：官方 MV3 release ZIP，headless Chromium；擴充詳細頁在 30 秒內未載入，`body` 查詢亦逾時。
- **Violentmonkey 2.48.0**：唯讀使用本機既有官方擴充程式目錄，另建隔離 profile，headed Chromium；options 與擴充詳細頁均無可讀 DOM，本地 HTTP 遊戲頁則能載入。
- **Tampermonkey 5.5.0**：先前取得的官方 CRX 解包目錄，另建隔離 profile，headed Chromium；options 頁在 15 秒內未載入，`body` 查詢逾時。
- 另嘗試 Computer Use 讀取測試瀏覽器，該工具在 20 秒後逾時。

因此尚未經 manager UI 安裝這支腳本，**真實注入、`unsafeWindow` 跨環境存取與 GM 儲存均未標為通過**。沒有用 GM shim 替代此步驟。測試程序已停止；未操作日常 profile 的 manager 設定。

待環境可用時，在隔離 manager 匯入交付 `.user.js`，於本地與兩個正式網址驗證：只注入一次、Runner 存取、兩版 AI 切換、參數跨 reload 保存及 manager 選單開啟控制台。Firefox 真實 manager、Safari Userscripts 和 `chrome://dino` 注入不在本次已驗證範圍。

## 本地證據

`.preview/dino-ai-lab/` 包含：

- `suite-before-slicing.log`：完整套件的 21 個通過與舊高速測試逾時紀錄。
- `high-speed-chromium.log`、`high-speed-firefox.json`：分段後高速場景的定向重跑；Firefox JSON 依工具回傳的 stdout 整理。
- `benchmark.json`、`benchmark.png`：20 局 A/B 與逐局障礙物資料。
- `light-*.png`、`narrow-*.png`、`experiment-*.png`：兩瀏覽器介面，已目視檢查。
- `live.json`、`live-*.png`：線上頁面 smoke 紀錄與畫面。
- `managers.json`：真實 manager 嘗試及阻擋原因。

這些執行產物不納入 Git；固定遊戲、測試程式、歷史原檔及此摘要納入 repo。
