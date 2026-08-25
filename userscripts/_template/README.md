# Userscript 範本

這個資料夾**不會**被 `npm run check` / `npm run index` 掃到（底線開頭的目錄一律略過），
它只是新腳本的起點。

## 用法

```bash
npm run new -- <slug> "<Script Name>" "<@match pattern>"
# 例：
npm run new -- github-pr-tools "GitHub PR Tools" "https://github.com/*"
```

會產生：

```text
userscripts/<slug>/
├── <slug>.user.js   # 從 template.user.js 展開，metadata 已填好
└── README.md        # 這個腳本自己的說明
```

## 手動建立的話

複製 `template.user.js`，把這些 placeholder 換掉：

| Placeholder       | 換成                                     |
| ----------------- | ---------------------------------------- |
| `{{NAME}}`        | 腳本顯示名稱                             |
| `{{SLUG}}`        | 資料夾名稱（kebab-case，也是檔名）       |
| `{{DESCRIPTION}}` | 一句話說明，會出現在 README 索引表        |
| `{{MATCH}}`       | `@match` pattern                         |
| `{{DOMAIN}}`      | favicon 用的網域，例如 `github.com`      |

最後跑一次 `npm run check && npm run index`。

範本裡附了兩個常用小工具：`waitForElement()` 與 `onUrlChange()`，
理由見 [`docs/05-spa-and-timing.md`](../../docs/05-spa-and-timing.md)。
