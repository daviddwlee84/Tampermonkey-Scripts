# 09 · Manager 比較

`userscript` 是概念本身，manager 是執行它的軟體：

```text
        userscript
            ↑
┌───────────────────────┐
│ Tampermonkey (TM)     │
│ Violentmonkey (VM)    │
│ Greasemonkey          │
│ Userscripts (Safari)  │
└───────────────────────┘
```

## 結論先講

**本 repo 的腳本兩邊都能跑**，開發時建議：

```text
主力開發        Violentmonkey   （OSS、external editor workflow 成熟）
相容性驗證      Tampermonkey    （順便涵蓋 Safari / iOS）
腳本本身        只用兩邊都有的 API，不綁任何一家
```

## 對照（2026）

|                        | **Tampermonkey**                              | **Violentmonkey**                       |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| 授權                   | 2.9 之後轉為 proprietary，GitHub 只有舊版 source | **完全 open source（MIT）**             |
| 定位                   | polished、相容性優先、功能多                    | 輕量、developer-friendly                |
| Chrome / Edge / Brave / Vivaldi / Arc | ✅ MV3                       | ✅ MV3                                  |
| Firefox                | ✅                                             | ✅                                       |
| **Safari / iOS**       | **✅ 官方支援**                                | ❌ 沒有正式版                            |
| 內建編輯器             | 較完整（含 ESLint）                            | 刻意保持簡單，鼓勵用外部編輯器           |
| 外部編輯器 / 本機檔案追蹤 | ✅（較新版本加入）                            | ✅ 成熟，可設定「偵測到變更就 reload 分頁」|
| GM API                 | 最完整                                         | 完整（含 `GM_download`、`GM_cookie`、`GM.*` async 版）|
| Cloud Sync             | Drive / Dropbox / WebDAV / Browser Sync / S3   | Drive / Dropbox / OneDrive / WebDAV     |
| TS / bundler 官方支援  | 自己建                                         | **官方 generator（ESNext / TypeScript）**|
| 官方 helper libraries  | 無                                             | `@violentmonkey/dom`、`/ui`、`/shortcut`|
| 企業 provisioning      | ✅ OS policy                                   | 較少                                     |
| MCP integration        | ✅（5.5+，需額外的 Editors extension）          | 無                                       |

## 怎麼選

```text
                    你的使用方式
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
  自己寫、Git 管理、IDE            主要是裝別人寫的腳本
          │                               │
          ▼                               ▼
   Violentmonkey                    Tampermonkey
```

再加幾條決定性因素：

| 如果你…                          | 選              |
| -------------------------------- | --------------- |
| 想在 iPhone / iPad Safari 也用   | **Tampermonkey**（VM 沒有 Safari 版）|
| 在意 OSS / 可稽核                | **Violentmonkey** |
| 用 TypeScript + 外部 IDE 開發    | **Violentmonkey** |
| 需要企業 policy 部署、或想試 MCP | **Tampermonkey** |
| 只是想最快裝起來用               | 都行，Tampermonkey 教學最多 |

**為什麼 OSS 在這裡比一般 extension 更值得在意**：userscript manager 本來就有
「讀寫任意頁面 + 執行腳本 + 跨域請求 + 剪貼簿 + 儲存」的完整權限。
兩個產品功能差不多時，可稽核的那個是比較自然的選擇。

不過也不必二選一——**兩個都裝**，一個當主力、一個當相容性測試目標，
成本很低。

## Chromium 系瀏覽器（Arc、Brave、Vivaldi、Edge…）

兩者都是標準的 MV3 WebExtension，所有 Chromium 衍生瀏覽器都能從
Chrome Web Store 安裝，包含 **Arc**。

⚠️ 但 Chrome 138 之後，MV3 的 User Scripts API 需要使用者主動開啟開發者模式。
所以**所有** Chromium 系瀏覽器（Arc 也一樣）都要：

```text
開啟 <browser>://extensions
  → 右上角開啟 Developer mode
```

沒開的話症狀是「腳本裝了，但完全沒有任何反應」。這是目前最常見的第一個坑。

Arc 另外要注意它的 Chromium base 更新步調可能落後主線；遇到 extension 行為怪異時，
先拿一般 Chrome 對照一次再判斷是不是腳本的問題。

## 寫腳本時的相容性守則

本 repo 的所有腳本都照這幾條寫：

1. **明寫每一個 `// @grant`**，不要靠 manager 自動推斷
2. **明寫 `@run-at`** —— 預設值兩邊不同（TM 是 `document-idle`，VM 是 `document-end`）
3. **`@updateURL` 和 `@downloadURL` 兩個都寫** —— VM 只看後者
4. **用底線版 GM API**（`GM_setValue`）而非 `GM.setValue`，避免 async 傳染
5. **避開 manager 限定的 key**：`@sandbox`（TM）、`@inject-into`（VM）、`@antifeature`
6. **避開 manager 限定的參數**：`GM_registerMenuCommand` 的 `accessKey`（TM 限定）；
   要反註冊就自己指定 `{ id: '...' }`
7. **少碰 `unsafeWindow` 與 sandbox 細節** —— 這是兩邊差異最大的地方
8. **不要用 manager 專屬的 helper**（例如 `VM.observe`、`VM.shortcut`）；
   它們很好用，但會把腳本綁在 Violentmonkey 上

`npm run check` 會自動擋掉第 1、2、3、5 條，其餘靠 review。

## 也可以考慮的其他 manager

- **Greasemonkey**（Firefox）：這一切的老祖宗，但 GM API 較舊，新專案沒理由選它。
- **Userscripts**（Safari，開源）：Safari 上 Tampermonkey 之外的選擇，GM API 支援較有限。

## 下一步

[10 · 常用食譜](./10-recipes.md)
