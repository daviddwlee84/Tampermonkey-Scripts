# CLAUDE.md

給 coding agent 的 repo 慣例說明。

## 這個 repo 是什麼

兩個目的：

1. Da-Wei Lee 的 Tampermonkey / Violentmonkey userscript 倉庫（**source of truth**，
   不是 manager 內建編輯器裡那份）
2. 一份中文 userscript 教學（`docs/`）

## 結構慣例

```text
userscripts/<slug>/<slug>.user.js   # 檔名必須等於資料夾名，否則 npm run check 會失敗
userscripts/<slug>/README.md        # 每支腳本都要有
userscripts/_template/              # 底線開頭的資料夾會被所有工具略過
shared/                             # 用 @require 引入的共用工具（非 ES module）
docs/NN-topic.md                    # 教學，編號固定
scripts/*.mjs                       # repo 維護工具，零外部相依（只用 node: 內建模組）
```

`slug` 用 lowercase kebab-case。

## 新增腳本

一律用 scaffolder，不要手動建目錄：

```bash
npm run new -- <slug> "<Name>" "<@match>" ["<description>"]
```

它會從 `userscripts/_template/template.user.js` 展開，metadata（含正確的
`@updateURL` / `@downloadURL`）已經填好。

## 修改腳本時**必做**

1. **把 `@version` 往上加**（`X.Y.Z`）。Tampermonkey 只靠版本號判斷要不要更新，
   沒加等於這次改動不會送到任何機器。工具檢查不到這件事。
2. `npm run check` —— 驗證 metadata
3. 改了 `@name` / `@description` / `@match` 的話跑 `npm run index` ——
   重新產生 README 的腳本清單表格
4. 動到 `README.md` 的腳本清單表格時，**只透過 `npm run index`**，
   絕對不要手改 `<!-- BEGIN SCRIPT INDEX -->` / `<!-- END SCRIPT INDEX -->` 之間的內容

`npm run verify` = `check` + `index:check`，等同 CI 跑的內容。

## 寫腳本的規範

- 每個用到的 `GM_*` API 都要有對應的 `// @grant`。`npm run check` 會掃程式碼交叉比對。
- 用底線版 GM API（`GM_setValue`）而非 `GM.setValue`，為了 Violentmonkey 相容性。
- 主邏輯包在 `(function () { 'use strict'; ... })()` 裡。
- **假設所有目標網站都是 SPA**：進入點函式必須 idempotent（可重複呼叫），
  並搭配 `MutationObserver` / URL 變化偵測。理由見 `docs/05-spa-and-timing.md`。
- `@match` 與 `@connect` 開最小必要範圍。
- **絕對不要放 secret 進腳本**（見 `docs/12-security.md`）。
- 註解用繁體中文，技術名詞保留英文。

## 寫文件的規範

- 繁體中文，技術名詞保留英文（如 metadata、sandbox、SPA、MutationObserver）
- 每篇 `docs/NN-*.md` 結尾指向下一篇
- 教學裡的程式碼片段要能直接複製使用
- 新增 `docs/` 檔案時，同步更新 `docs/README.md` 和根目錄 `README.md` 的兩張目錄表

## 不要做的事

- 不要引入 bundler / TypeScript。目前刻意維持「一支腳本一個檔案、零建置」，
  raw URL 直接就是可安裝的腳本。升級的時機與代價寫在 `docs/07-dev-workflow.md`。
- 不要給 `scripts/*.mjs` 加外部相依套件。
- 不要在沒有明確要求的情況下改 `@match` 範圍。
