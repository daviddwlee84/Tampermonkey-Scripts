# Tampermonkey Scripts

我的 userscript 倉庫，順便寫成一份**中文 userscript 教學**。

- 🧩 **[腳本清單](#腳本清單)** —— 點 Install 就能裝
- 📦 **[桌面批量安裝](#桌面批量安裝violentmonkey)** —— 產生 ZIP，在各瀏覽器一次匯入
- 📖 **[教學文件](./docs/)** —— 從「這不就是 DevTools Console 嗎」到 SPA、GM API、自動更新

## 腳本清單

<!-- 這個表格由 `npm run index` 自動產生，不要手改。 -->
<!-- BEGIN SCRIPT INDEX -->

### AI 對話匯出

把 AI 對話帶到 Markdown、筆記或 coding agent。 分類代號：`ai-export`。

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [arXiv AI Assistant](userscripts/arxiv-ai-assistant/) | 在 arXiv 加入 papers.cool、Kimi 與 Gemini 入口，自動展開 FAQ 或送出繁中論文摘要請求 | `https://arxiv.org/abs/*`<br>`https://papers.cool/arxiv/*`<br>`https://gemini.google.com/app*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js) |
| [ChatGPT Export Markdown](userscripts/chatgpt-export-markdown/) | 把 ChatGPT 對話匯成 Markdown，另提供樹狀選取、Agent Handoff 與可攜 JSON 存檔 | `https://chatgpt.com/*` | 1.4.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js) |
| [arXiv AI Assistant](userscripts/arxiv-ai-assistant/) | 在 arXiv 與 papers.cool 間快速跳轉，自動展開 FAQ 或用 Kimi／Gemini 取得繁中論文摘要 | `https://arxiv.org/abs/*`<br>`https://papers.cool/arxiv/*`<br>`https://gemini.google.com/app*` | 0.2.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js) |
| [Claude Export Markdown](userscripts/claude-export-markdown/) | 把整段 Claude 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用 | `https://claude.ai/*` | 1.0.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/claude-export-markdown/claude-export-markdown.user.js) |
| [Copilot Export Markdown](userscripts/copilot-export-markdown/) | 把整段 Microsoft Copilot 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用 | `https://copilot.microsoft.com/*`<br>`https://www.copilot.com/*` | 1.2.1 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/copilot-export-markdown/copilot-export-markdown.user.js) |
| [Gemini Export Markdown](userscripts/gemini-export-markdown/) | 把整段 Gemini 對話匯成 Markdown（含 share 頁與 Agent Handoff），貼給 coding agent 用 | `https://gemini.google.com/*` | 0.2.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/gemini-export-markdown/gemini-export-markdown.user.js) |

### 閱讀與媒體工具

網頁正文、圖片影片與 YouTube 摘要。 分類代號：`page-tools`。

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [Media Helper](userscripts/media-helper/) | 預覽網頁圖片與影片、選擇頁面最大圖片版本，支援單檔與多選逐檔下載 | `https://*/*`<br>`http://*/*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/media-helper/media-helper.user.js) |
| [Page Reader & Markdown](userscripts/page-reader-markdown/) | 從目前網頁擷取乾淨正文，支援專注閱讀、Markdown 與含附件 ZIP 匯出 | `https://*/*`<br>`http://*/*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-reader-markdown/page-reader-markdown.user.js) |
| [YouTube Gemini Summary](userscripts/youtube-gemini-summary/) | 在 YouTube 影片卡片與觀看頁一鍵開啟 Gemini，送出繁中摘要提示 | `https://www.youtube.com/*`<br>`https://gemini.google.com/app*` | 0.1.2 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js) |

### 鍵盤導航

Vim 式頁內操作，以及搭配原生 Vimium C 的小抄與練習。 分類代號：`keyboard`。

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [Vim Navigation](userscripts/vim-navigation/) | Vim 式頁內導航、搜尋、文字選取與區塊複製，附可客製的常駐情境小抄 | `https://*/*`<br>`http://*/*` | 0.2.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vim-navigation/vim-navigation.user.js) |
| [Vimium C Companion](userscripts/vimium-c-companion/) | Vimium C 個人鍵位小抄、設定匯入與操作流程，陪你練習原生鍵盤導覽 | `https://*/*`<br>`http://*/*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vimium-c-companion/vimium-c-companion.user.js) |

### 實驗性腳本

仍在驗證與調整，請先閱讀個別限制；不納入預設桌面安裝包。 分類代號：`experimental`。

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [M365 Copilot Chat Export Markdown](userscripts/m365-copilot-export-markdown/) | 【實驗性】把 Microsoft 365 Copilot Chat 對話匯成 Markdown，優先讀原始資料、失敗退回畫面 | `https://m365.cloud.microsoft/*`<br>`https://copilot.cloud.microsoft/*` | 0.12.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js) |
| [Little Dino AI Lab](userscripts/dino-ai-lab/) | 保留 2016 恐龍 AI，加入預測策略、浮動調參、離線加速與可重現 A/B 實驗 | `https://chromedino.com/*`<br>`https://wayou.github.io/t-rex-runner/*`<br>`http://127.0.0.1/dino/*`<br>`http://localhost/dino/*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/dino-ai-lab/dino-ai-lab.user.js) |

### 入門與教學範例

用來理解 metadata、GM API 與頁面修改的最小範例；不納入預設桌面安裝包。 分類代號：`examples`。

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [Hello Userscript](userscripts/hello-userscript/) | 教學用 demo：示範 metadata、GM API、MutationObserver 與注入 UI | `https://example.com/*`<br>`https://www.example.com/*` | 1.0.2 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/hello-userscript/hello-userscript.user.js) |
| [Page Title Tag](userscripts/page-title-tag/) | 在分頁標題前面加上網站標籤（如 [GPT]），一堆分頁時好找 | `https://chatgpt.com/*`<br>`https://claude.ai/*`<br>`https://gemini.google.com/*` | 1.0.1 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-title-tag/page-title-tag.user.js) |

<!-- END SCRIPT INDEX -->

> 點 **Install** 之前要先裝好 [Tampermonkey](https://www.tampermonkey.net/) 或
> [Violentmonkey 官方安裝頁](https://violentmonkey.github.io/get-it/) —— 本 repo 以這兩者為相容目標，
> `npm run check` 檢查 metadata／API 規則，不代替瀏覽器實測（見 [09 Manager 比較](./docs/09-managers-comparison.md)）。
> **iPhone／iPad 的 Userscripts 使用者**請先看 [相容性評估](./docs/14-ios-userscripts.md)：
> 2026-09-08 評估的 8 支中只有 Page Title Tag 未發現靜態阻礙，其餘 7 支需適配，尚未做 iOS 執行實測。
>
> Chromium 系瀏覽器（Chrome / Edge / **Arc**）請檢查 manager 詳細資料的
> **Allow User Scripts／允許使用者指令碼**。Chrome 138+ 使用這個個別開關；
> 較舊版本使用 **Developer mode**，其他瀏覽器以實際介面為準。
>
> **第一次安裝**如果點 Install 沒反應（瀏覽器把檔案下載下來而不是交給 manager），
> 改用 Dashboard 的 **Install from URL** 貼上同一個網址。
> 也可用下方 ZIP 批量匯入；本 repo 會保留版本與更新 URL，匯入後請確認更新開關。
> 完整說明見 [08 發佈與同步](./docs/08-distribution-and-sync.md#新機器-bootstrap第一次怎麼把腳本裝進去)。

## 教學文件

| #  | 文件                                                             | 你會得到                                                     |
| -- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 01 | [什麼是 userscript](./docs/01-what-is-userscript.md)              | 和 Console / Extension 的定位差異                             |
| 02 | [第一支腳本](./docs/02-getting-started.md)                        | 裝好 manager、寫出並跑起第一支腳本                            |
| 03 | [Metadata 完整參考](./docs/03-metadata-reference.md)              | `@match`、`@run-at`、`@require`… 每個 key 的實際效果          |
| 04 | [GM API](./docs/04-gm-api.md)                                     | 儲存、剪貼簿、跨域請求、選單指令                              |
| 05 | [SPA 與執行時機](./docs/05-spa-and-timing.md)                     | 為什麼你的腳本「有時候有效」，以及怎麼修                      |
| 06 | [Sandbox 與 unsafeWindow](./docs/06-sandbox-and-unsafewindow.md)  | 為什麼 Console 能做的事在腳本裡失敗                           |
| 07 | [開發工作流](./docs/07-dev-workflow.md)                           | 從 Console PoC 到 repo，含 TypeScript 升級路徑                |
| 08 | [發佈與同步](./docs/08-distribution-and-sync.md)                  | GitHub 當 source of truth + 自動更新 + 跨機器 bootstrap       |
| 09 | [Manager 比較](./docs/09-managers-comparison.md)                  | Tampermonkey / Violentmonkey / Greasemonkey 怎麼選            |
| 10 | [常用食譜](./docs/10-recipes.md)                                  | 可直接抄的 pattern                                            |
| 11 | [疑難排解](./docs/11-troubleshooting.md)                          | 症狀 → 原因 → 修法對照表                                      |
| 12 | [安全性](./docs/12-security.md)                                   | 別把 secret 放腳本裡，以及安裝別人的腳本前該看什麼            |
| 13 | [Playwright vs. userscript](./docs/13-playwright-vs-userscript.md)          | 什麼時候該用哪個，以及 `npm run preview` 測試 harness |
| 14 | [iOS Userscripts 評估](./docs/14-ios-userscripts.md) | 安裝／同步、API 差異、逐支腳本相容性與實機驗收 |
| 15 | [同步到 iPad](./docs/15-sync-to-ipad.md) | 用 just 經 USB 或 iCloud 平鋪同步腳本、預覽差異與保留備份 |
| 16 | [桌面批量安裝](./docs/16-desktop-install.md) | Arc／Chrome／Edge／Zen／Firefox 安裝引導、分類 ZIP 與重複匯入 |

## 桌面批量安裝（Violentmonkey）

需要 `just` 與 Python 3.10+。在 Mac 可直接選擇要裝 manager 的瀏覽器：

```bash
just vm-install arc      # 開啟官方商店頁；也可填 chrome / edge / zen / firefox
just vm-plan             # 預覽預設的日常工具，排除教學與實驗腳本
just vm-pack             # 產生 dist/violentmonkey-scripts.zip
```

在該瀏覽器開啟 **Violentmonkey → Dashboard → Settings → Import from zip**，
選取 ZIP 即可一次匯入。Arc／Chrome／Edge／Zen／Firefox 的每個 profile 各做一次；
命令只開安裝頁與打包，擴充功能安裝和 ZIP 匯入由使用者在瀏覽器完成。

```bash
just vm-pack --category ai-export           # 只要 AI 對話匯出
just vm-pack --category examples            # Hello Userscript、Page Title Tag
just vm-pack --only page-reader-markdown    # 只要某一支；--only 可重複
just vm-pack --all                          # 全部，含教學與實驗腳本
```

分類由 [`scripts/catalog.json`](./scripts/catalog.json) 統一管理，README 透過 `npm run index` 產生。
ZIP 使用目前工作區原始碼，保留 `@require` 與更新 URL，不包含 GM values 或 manager 設定。
日常重裝也可重新打包匯入；會更新同身分的已安裝腳本，先確認 manager 裡沒有要保留的手改內容。
完整操作、瀏覽器權限與驗證範圍見 [16 · 桌面批量安裝](./docs/16-desktop-install.md)。

## 同步腳本到 iPad

Mac 裝好 `just`、`uv`，用 USB 接上已在 Finder 信任的 iPad：

```bash
just sync-plan           # 列出要同步的正式腳本
just sync-ipad --dry-run # 比較差異，不寫入
just sync-ipad           # 同步；覆寫前備份，不刪其他腳本
```

第一次在 iPad 的 Userscripts 選取「**我的 iPad / Userscripts / Tampermonkey-Scripts**」，
再開 Safari 的擴充功能彈窗並重新整理。也支援 `just sync-folder "<iCloud 資料夾>"`。
同步保留原始碼，不會自動修正 iOS API 相容性；完整設定與限制見 [15 · 同步到 iPad](./docs/15-sync-to-ipad.md)。

## 這個 repo 怎麼運作

```text
本 repo（source of truth）
        │ git push
        ▼
   GitHub
        │ raw.githubusercontent.com + @updateURL
        ▼
   Tampermonkey（各機器自動更新）
```

Git 管原始碼與歷史，`@updateURL` 管發佈，manager 內建的 Sync 管新機器 bootstrap。
三層各司其職，細節見 [08 發佈與同步](./docs/08-distribution-and-sync.md)。

## 目錄結構

```text
.
├── userscripts/                 # 一支腳本一個資料夾
│   ├── _template/               # 新腳本的範本（底線開頭 = 不會被工具掃到）
│   └── <slug>/
│       ├── <slug>.user.js       # 腳本本體（檔名必須等於資料夾名）
│       └── README.md            # 這支腳本的說明
├── shared/                      # 可用 @require 引入的共用工具
├── docs/                        # 教學文件
└── scripts/                     # repo 自己的維護工具
    ├── new-script.mjs           # 從範本產生新腳本
    ├── check-meta.mjs           # 驗證 metadata（零相依）
    ├── catalog.json             # README 分類與桌面 ZIP 的預設選擇
    ├── build-index.mjs          # 產生上面的分類清單（零相依）
    ├── sync-userscripts.py      # iPad／資料夾同步與桌面 ZIP
    ├── open-violentmonkey.py    # 在指定瀏覽器開啟官方安裝頁
    └── preview.mjs              # 用 Playwright 跑一次腳本並截圖
```

## 開發

```bash
# 建立新腳本
npm run new -- <slug> "<Name>" "<@match>" ["<description>"]
npm run new -- github-pr-tools "GitHub PR Tools" "https://github.com/*"

npm run check      # 驗證 metadata：必填欄位、@grant 對不對、URL 有沒有指對
npm run index      # 依據 metadata + scripts/catalog.json 重新產生分類清單
npm run verify     # check + 確認 README 索引是最新的（CI 跑這個）

# 用 Playwright 把腳本注入真實頁面跑一次並截圖到 .preview/
npm run preview -- hello-userscript
npm run preview -- hello-userscript --menu "Copy page as Markdown"
npm run preview -- <slug> <url> --headed

npm install                   # prettier + playwright（check/index 本身零相依）
npx playwright install chromium   # preview 需要，只需做一次
npm run format                # 格式化 JS 與 docs（README.md 被排除，見 .prettierignore）
```

### 改動腳本的檢查清單

1. 改 code
2. **把 `@version` 往上加** —— 沒加的話其他機器永遠收不到更新
3. `npm run check`
4. 改了 `@name` / `@description` / `@match` 的話跑 `npm run index`
5. commit + push

`npm run check` 會擋下：缺必填 metadata、用了沒宣告的 `GM_*` API、
`@updateURL` / `@downloadURL` 指錯路徑、腳本檔名和資料夾名不一致。
但它**無法知道你有沒有記得加版本號**，那要靠自覺。

## License

[MIT](./LICENSE)。各腳本內含第三方資料的授權，以該腳本的 `@license` 與內嵌授權聲明為準。

<!-- project-knowledge-harness:readme-roadmap -->

## 後續計畫與經驗記錄

長期待辦見 [TODO.md](TODO.md)，需要研究的項目連到 [backlog/](backlog/)；曾經踩過的問題以症狀索引於 [pitfalls/](pitfalls/)。

<!-- project-knowledge-harness:readme-roadmap --> (end)
