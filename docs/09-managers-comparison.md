# 09 · Manager 比較

`userscript` 是概念本身，manager 是執行它的軟體：

```text
        userscript
            ↑
┌───────────────────────┐
│ Tampermonkey          │
│ Violentmonkey         │
│ Greasemonkey          │
│ Userscripts (Safari)  │
└───────────────────────┘
```

## 對照

|                | Tampermonkey                  | Violentmonkey            | Greasemonkey    |
| -------------- | ----------------------------- | ------------------------ | --------------- |
| 開源           | 部分（有 open source 版本）    | ✅ MIT                   | ✅              |
| 瀏覽器         | Chrome / Edge / Firefox / Safari / Opera | Chrome / Edge / Firefox | Firefox 為主 |
| GM API 完整度  | 最完整                         | 完整，少數 API 不同       | 較舊            |
| 雲端同步       | Drive / Dropbox / WebDAV / S3 / Browser Sync | Dropbox / OneDrive / Drive / WebDAV | 靠瀏覽器同步 |
| 本機檔案追蹤   | ✅（較新版本）                 | ❌（可用 `@require file://` 代替） | ❌ |
| 生態圈／教學量 | 最多                           | 中                        | 少（歷史文獻多）|

## 怎麼選

- **只想最快裝起來用** → Tampermonkey。教學最多、GM API 最全、本機檔案追蹤對開發很有感。
- **偏好 open source / developer 導向** → Violentmonkey。介面乾淨，官方有 TypeScript + Rollup 的 workflow。
- **Firefox 老用戶** → Greasemonkey 是這一切的老祖宗，但新專案沒理由選它。
- **Safari** → App Store 上的 Userscripts（開源），GM API 支援較有限。

## 寫腳本時的相容性建議

想讓腳本在 Tampermonkey 和 Violentmonkey 都能跑：

1. 明確寫出每個 `// @grant`，不要靠 manager 自動推斷
2. 用底線版 GM API（`GM_setValue`）而不是 `GM.setValue`
3. 少碰 `unsafeWindow` 與 sandbox 細節——兩者實作不同
4. 避免 Tampermonkey 專屬的 key（例如 `@sandbox`），除非真的需要

本 repo 的腳本都照這幾條寫。

## Chrome 的 Developer mode

Manifest V3 之後，Chrome 系瀏覽器需要在 `chrome://extensions` 開啟
**Developer mode** 才能讓 manager 執行腳本。三個 manager 都受影響。
腳本裝了卻完全沒反應時，先檢查這個。

## 下一步

[10 · 常用食譜](./10-recipes.md)
