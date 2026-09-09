# 本地 Dino 引擎來源

- 上游：[wayou/t-rex-runner](https://github.com/wayou/t-rex-runner/tree/5455bfa408ec6b707c7300ff194b7390733a766d)
- 固定 revision：`5455bfa408ec6b707c7300ff194b7390733a766d`
- `vendor/upstream.js` SHA-256：`e7a50d337bdbe4299068de034e4564cfe5fd45ca9257ded37b6ada9330cedf0f`
- 取得日期：2026-09-09。
- `upstream.js`、`upstream.html`、`upstream.css`、四份 PNG 及 `LICENSE` 保留上游內容。`LICENSE.chromium` 另保留 Chromium 的 BSD 聲明。

## 本地適配

`scripts/dino-server.mjs` 在記憶體中產生 `/dino/runner.js`，逐一驗證替換位置。上游檔案若有變動，伺服器會報錯，避免套用不完整的適配。

1. 遊戲自身的 rAF 排程與時間函式改由 `DinoLab` 的固定 60 Hz 時鐘提供。
2. 障礙物種類、群組大小、高度、間距與鳥的速度偏移使用獨立 Mulberry32 種子亂數。
3. 開局使用已完成 intro 的初始狀態，避免 CSS 動畫時間影響加速比較。
4. 邏輯跑道固定 600 × 150；窄視窗只縮放顯示，resize 不改變障礙物與速度，也不打斷實驗。

`lab-engine.js` 管理時計、倍率、暫停、重開種子與障礙物紀錄。每一個邏輯步驟依序送出 `dino-lab-before-step`、執行遊戲 callback、送出 `dino-lab-after-step`。userscript 在前者判斷操作、後者檢查局數與時間上限。

加速只增加每段牆鐘時間執行的邏輯步數；不更改遊戲的速度、加速度、碰撞或跳躍規則。每個繪圖週期最多使用約 9 ms 運算；電腦忙碌時實際倍率可低於目標倍率，不跳過物理步驟。前景頁面才前進遊戲時間。

裝飾物仍使用上游亂數；它們不參與障礙物亂數流。最高分、裝飾畫面及牆鐘起訖時間不屬於重現性斷言；相同種子、策略版本與參數的障礙物序列、動作、分數與死亡時點屬於斷言。

## 更新固定引擎

更新 revision 時，同步更新原始檔、素材、授權、SHA-256、適配位置、`DinoLab.version` 與 userscript 的版本辨識。重新執行物理交叉驗證、兩引擎 browser tests、倍率一致性與 A/B 報告。
