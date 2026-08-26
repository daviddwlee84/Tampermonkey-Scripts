# Tampermonkey Scripts

我的 userscript 倉庫，順便寫成一份**中文 userscript 教學**。

- 🧩 **[腳本清單](#腳本清單)** —— 點 Install 就能裝
- 📖 **[教學文件](./docs/)** —— 從「這不就是 DevTools Console 嗎」到 SPA、GM API、自動更新

## 腳本清單

<!-- 這個表格由 `npm run index` 自動產生，不要手改。 -->
<!-- BEGIN SCRIPT INDEX -->

| Script | 用途 | 生效網站 | Version | 安裝 |
| --- | --- | --- | --- | --- |
| [ChatGPT Export Markdown](userscripts/chatgpt-export-markdown/) | 把整段 ChatGPT 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用 | `https://chatgpt.com/*` | 1.2.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js) |
| [Claude Export Markdown](userscripts/claude-export-markdown/) | 把整段 Claude 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用 | `https://claude.ai/*` | 1.0.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/claude-export-markdown/claude-export-markdown.user.js) |
| [Copilot Export Markdown](userscripts/copilot-export-markdown/) | 把整段 Microsoft Copilot 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用 | `https://copilot.microsoft.com/*` | 1.2.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/copilot-export-markdown/copilot-export-markdown.user.js) |
| [Gemini Export Markdown](userscripts/gemini-export-markdown/) | 把整段 Gemini 對話匯成 Markdown（含 share 頁與 Agent Handoff），貼給 coding agent 用 | `https://gemini.google.com/*` | 0.1.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/gemini-export-markdown/gemini-export-markdown.user.js) |
| [Hello Userscript](userscripts/hello-userscript/) | 教學用 demo：示範 metadata、GM API、MutationObserver 與注入 UI | `https://example.com/*`<br>`https://www.example.com/*` | 1.0.2 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/hello-userscript/hello-userscript.user.js) |
| [M365 Copilot Chat Export Markdown](userscripts/m365-copilot-export-markdown/) | 【實驗性】把 Microsoft 365 Copilot Chat 對話匯成 Markdown，優先讀原始資料、失敗退回畫面 | `https://m365.cloud.microsoft/*`<br>`https://copilot.cloud.microsoft/*` | 0.11.0 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js) |
| [Page Title Tag](userscripts/page-title-tag/) | 在分頁標題前面加上網站標籤（如 [GPT]），一堆分頁時好找 | `https://chatgpt.com/*`<br>`https://claude.ai/*`<br>`https://gemini.google.com/*` | 1.0.1 | [Install](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-title-tag/page-title-tag.user.js) |

<!-- END SCRIPT INDEX -->

> 點 **Install** 之前要先裝好 [Tampermonkey](https://www.tampermonkey.net/) 或
> [Violentmonkey](https://violentmonkey.github.io/) —— 本 repo 的腳本**兩者皆相容**，
> `npm run check` 會強制這件事（見 [09 Manager 比較](./docs/09-managers-comparison.md)）。
>
> Chromium 系瀏覽器（Chrome / Edge / Brave / Vivaldi / **Arc**）還要到
> `<browser>://extensions` 開啟 **Developer mode**，否則腳本裝了不會執行。
>
> **第一次安裝**如果點 Install 沒反應（瀏覽器把檔案下載下來而不是交給 manager），
> 改用 Dashboard 的 **Install from URL** 貼上同一個網址。
> 不要用 `New from file` / `Import from zip` —— 那樣裝的是副本，收不到自動更新。
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
    ├── build-index.mjs          # 產生上面那張腳本清單（零相依）
    └── preview.mjs              # 用 Playwright 跑一次腳本並截圖
```

## 開發

```bash
# 建立新腳本
npm run new -- <slug> "<Name>" "<@match>" ["<description>"]
npm run new -- github-pr-tools "GitHub PR Tools" "https://github.com/*"

npm run check      # 驗證 metadata：必填欄位、@grant 對不對、URL 有沒有指對
npm run index      # 依據 metadata 重新產生上面的腳本清單
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

[MIT](./LICENSE)
