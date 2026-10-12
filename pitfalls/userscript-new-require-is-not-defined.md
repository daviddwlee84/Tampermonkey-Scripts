# 新增 `@require` 後，腳本執行時報 `XXX is not defined`

## 症狀

chatgpt-export-markdown v1.5.0 的 **Download .zip** 顯示：

```text
失敗：ZipStore is not defined
```

同一版的其他功能正常，包括同一個 commit 一起改的 `shared/chatgpt-adapter.js`。

## 原因

只有新的 `@require` URL（`shared/zip-store.js`）缺失。manager 在檔案能從
raw.githubusercontent.com 取得之前（例如尚未 push、或 push 前就安裝／匯入）抓過它，
得到 404，之後就不帶這個依賴執行腳本。已存在的 `@require` URL 不受影響，所以只有新的全域變數不存在。
版本號不變時，manager 不會重抓。

## 解法

- 使用者：在 manager 對該腳本「檢查更新」或重新安裝／重新匯入。
- 發布：再加一次 `@version`，讓已安裝的 manager 重新下載所有 `@require`。
- 腳本：在入口檢查 `typeof XXX === 'undefined'`，顯示可操作的提示。

## 預防

- 新增 `shared/*.js` 時，先 push，再到 manager 安裝或執行 `just vm-pack` 匯入。
- `npm run preview` 和測試都讀工作區檔案，抓不到這個問題；`npm run check` 只確認檔案存在於本機。
- 相關：iOS Userscripts 對相同 URL 的快取問題見 [docs/14](../docs/14-ios-userscripts.md#shared-更新是另一個獨立風險)。
