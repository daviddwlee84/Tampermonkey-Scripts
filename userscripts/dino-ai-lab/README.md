# Little Dino AI Lab

把約 **2016-03-24 大學 Hackathon** 的 Google Little Dinosaur AI 留下來，加上可以切換、調參與比較的預測 AI。

## 安裝與遊玩

1. 使用桌面 Tampermonkey 或 Violentmonkey，安裝本目錄的 `dino-ai-lab.user.js`。
2. 開啟 [chromedino.com](https://chromedino.com/) 或 [Wayou 的經典版](https://wayou.github.io/t-rex-runner/)。
3. 點右下角 🦖 開啟控制台。預設原版 AI 待命，按空白鍵、↑或「開始 / 重開」開局。

[GitHub raw 安裝網址](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/dino-ai-lab/dino-ai-lab.user.js) 在此版本推送到 main 後才會提供新腳本。發佈前可將工作區檔案直接匯入 manager。

`chrome://dino` 在連線時也能玩，但一般 userscript 不能注入 Chrome 的內建頁面。[Google 說明](https://blog.google/products-and-platforms/products/chrome/chrome-dino/)、[Chrome match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)。這支腳本支援上述網頁版及本地版；chromedino 的換皮、3D、其他遊戲路徑不在本版範圍。

## 本地離線版

在 repo 根目錄執行（Node 20+，伺服器只用內建模組）：

```sh
just dino  # 等同 npm run dino
```

開啟 `http://127.0.0.1:8787/dino/`。同一支 userscript 會自動載入；尚未安裝時，遊戲頁也有本機安裝連結。遊戲與 AI 都已備妥後，斷網仍能遊玩與實驗。按 `Ctrl-C` 關閉伺服器。

若連接埠已被占用，可使用 `DINO_PORT=8788 just dino`；未安裝 just 時也可直接執行 `npm run dino`。伺服器僅綁定 `127.0.0.1`，不是公開網站服務。

本地遊戲固定於 Wayou 的一個開源 revision，包含本地圖片與聲音。歷史 AI 的原始碼及目前的固定遊戲引擎分別保留來源；引擎適配見 [PROVENANCE.md](../../playgrounds/dino/PROVENANCE.md)。

## AI 策略

| 策略 | 行為 |
| --- | --- |
| **2016 原版** | 每 33 ms 判斷一次，保留 `jumpFactor <= 30`、原本的蹲下及加速落地邏輯。參數唯讀。 |
| **Predictive AI** | 讀取實際群組寬度、障礙物碰撞框及鳥的速度差，以遊戲物理預測安全起跳窗口和落點。 |
| **手動** | 「切換手動」後由原遊戲接收你的操作；再按「啟用 AI」可接手目前這局。 |

[歷史原檔](history/GoogleLittleDinosaurAI.2016.txt) 以原始位元組保存，包括原有拼字、CRLF 與 Arduino 空白段落。移植版保留決策中的第一障礙物與單株寬度判斷局限；啟停、DOM 相容與計時器管理由新控制器負責。

新版可調：

- **安全邊界**：0–20 px，預設 4 px，水平擴大碰撞判斷。
- **延遲補償**：0–200 ms，預設 33 ms，在可行起跳窗口內提前操作。
- **提早收跳**：預設開啟，在仍能通過障礙物時縮短跳躍。
- **安全快速落地**：預設開啟，只有預測落點安全時才快速下落。

預測約 1.5 秒，搜尋可行起跳與收跳時機，納入所有當前可見障礙物。若安全邊界太大而找不到窗口，會先退回實際碰撞框嘗試避讓。這是有限視野的規則與物理預測，未使用機器學習模型；不保證永不死亡。

參數可存成最多 40 組命名預設，可複製、改名、刪除並套用。未命名的調整也會保存。

## 浮動控制台

- 圖示可拖曳，位置與設定會記住；面板可按 × 或 Esc 關閉，manager 選單也能重新開啟。
- 「立即套用／下一局套用」可切換，預設立即。下一局模式會標示待套用設定。
- 中途更換策略、參數或人工介入會標記混合局；該局不列入單一策略平均。
- 自動重開預設關閉；可設定死亡後等待 100–30,000 ms，預設 1,000 ms。
- 即時數值、決策原因、碰撞框、預測軌跡與統計各自可開關，預設全關。
- 藍色預測軌跡將未來時間對應到相對跑道位移；綠色是恐龍碰撞框，橘色是障礙物碰撞框。
- 操作面板文字欄位不會觸發遊戲跳躍或蹲下。

## 加速與 A/B

本地版提供 **1×、2×、5×、10×、20×**。每個遊戲步驟仍是 1/60 秒，原版 AI 維持 33 ms 節奏。控制台同時顯示目標倍率與近期實際倍率；背景分頁會停止前進。

在「實驗」選擇 A、B 策略或已儲存的參數預設，再設定種子、局數和上限：

- 預設基底種子 `20160324`，每組依序加 1，A、B 使用相同種子。
- 預設 10 組配對，範圍 1–100 組。
- 每局預設上限 180 秒遊戲時間，範圍 10–600 秒。
- 實驗預設 10×，可透過控制分頁的倍率欄隨時修改。
- 批次執行時策略及參數固定，遊戲按鍵暫時隔離；仍可切換資訊顯示或取消。

結果顯示配對分數、平均、中位數與最高分。帶 `+` 的分數代表跑到時間上限，屬於截尾結果：平均分與存活時間受上限限制。取消局與混合局不納入摘要。批次完成或取消後，遊戲會暫停，策略與倍率還原。

「紀錄」保留最近 1,000 局。一般遊玩依網站、引擎、策略版本和參數分組；A/B 有獨立摘要。JSON 匯出包含種子、參數、策略／引擎版本、結束原因、分數、遊戲時間與本地障礙物序列；CSV 適合自行整理。最近一次完整實驗摘要保留在目前分頁，重新整理後各局仍可從紀錄匯出。

## 開發與驗證

```sh
npm run test:dino-ai          # Chromium + Firefox，含原版對照及物理驗證
npm run benchmark:dino       # 10 組 × 180 秒上限，以 20× 執行固定 A/B
npm run verify               # metadata 與 README 索引
```

Browser tests 需要 repo 的 Playwright 與對應瀏覽器；可使用 `npx playwright install chromium firefox` 安裝。指定單引擎可用 `DINO_BROWSERS=chromium npm run test:dino-ai`。

基準測試輸出 `.preview/dino-ai-lab/benchmark.json` 與截圖。它使用明確的 GM shim；真實 manager 注入與儲存另外驗證。實測範圍見 [VALIDATION.md](VALIDATION.md)，成績見 [BENCHMARK.md](BENCHMARK.md)。

userscript 是單檔 IIFE，無 `@require`。Core 區塊提供策略 registry 及純函式；adapter 讀取 Runner，控制器管理單一 AI 排程、局狀態、交接與批次，Shadow DOM 負責 UI。新增策略需固定 ID、版本、判斷間隔與 `decide(snapshot, settings)`；回傳 `actions` 與診斷資料。

權限只有 `unsafeWindow`、`GM_getValue`、`GM_setValue`、`GM_registerMenuCommand`。遊戲內部介面可能隨線上站點更新；沒有找到相容引擎時會顯示重試入口。Safari Userscripts、真實 Firefox manager 與 Chrome 內建恐龍頁不在此次相容性承諾內。

新 UI 與控制器採 repo 的 MIT；Chromium 衍生碰撞／物理部分保留 BSD 授權於腳本及 [LICENSE.chromium](LICENSE.chromium)。
