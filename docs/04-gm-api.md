# 04 · GM API

GM API 是 userscript **比一般網頁 JS 多出來的能力**。用哪個就要在 metadata 加對應的
`// @grant`，否則該函式是 `undefined`。

本章範例以 **Tampermonkey／Violentmonkey** 為目標。Safari 的 Userscripts
主要提供非同步 `GM.*`，且沒有 `GM_registerMenuCommand` 或 `unsafeWindow`；
底線 API 不能直接照抄，差異見 [14 · iOS Userscripts 評估](./14-ios-userscripts.md)。

## 持久化儲存

```js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_listValues
```

```js
GM_setValue('lastExport', Date.now());
const last = GM_getValue('lastExport', 0); // 第二個參數是預設值
GM_deleteValue('lastExport');
GM_listValues(); // ['lastExport', ...]
```

特性：

- 跨 manager 建議只存 JSON 可序列化的字串、數字、物件、陣列、boolean 與 `null`；不直接存 DOM、函式或循環參照
- 綁在「已安裝腳本」上，不是網域：同一 manager、同一瀏覽器 profile 中，這支腳本在不同網站可讀到同一份值
- 重新載入、關閉分頁或重開瀏覽器後通常仍保留；同一腳本的一般版本更新不等於清除值
- 和網站的 `localStorage` 分開：清除網站 `localStorage` 不會同步清掉 manager 的值

適合存：設定、上次執行時間、UI 狀態、已處理過的 ID 清單。

這裡的持久化是 **目前 manager／profile 的本機儲存**，不是自動跨瀏覽器或裝置同步。
換 profile、換 Tampermonkey／Violentmonkey，或重新建立另一份腳本，都不能假設會看到原值。
刪除腳本或 manager 時也可能一併刪除儲存，應先匯出備份。
[Tampermonkey 儲存 API](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_values)、
[Violentmonkey 儲存 API](https://violentmonkey.github.io/api/gm/#gm_setvalue)。

### 腳本身分與設定作用域

manager 以自己的已安裝腳本身分管理值；metadata 的 `@name`／`@namespace` 參與腳本識別。
維持原腳本並更新版本通常能沿用儲存，但修改名稱／namespace、另存副本、刪除再安裝或換 manager
可能產生不同身分。不要把程式碼檔名、網站 origin 或相同 `@version` 當成共用資料庫的保證。

若要讓設定只對一個網站生效，由腳本在同一份值裡自行分組，例如：

```js
const settings = GM_getValue('preferences', { sites: {} });
settings.sites[location.origin] = { enabled: false };
GM_setValue('preferences', settings);
```

這樣分組的 origin 包含協定、主機及 port，和 manager 儲存本身的作用域是兩回事。
例如 Vim Navigation 的全域鍵位、主題、小抄位置與 `sites[origin]` 都存於 `vimNavigationConfig`；
本頁暫停、目前選取模式等暫時狀態則只放在記憶體。

### GM values 不等於雲端同步

manager 的 Script Sync、瀏覽器帳號同步、GitHub 程式碼更新、GM values 是不同機制。
能在新裝置看到腳本，不代表腳本內的所有設定值也已移轉；同步或 ZIP 匯出是否包含 values，
要確認目前 manager 版本、服務及所選選項。`GM_setValue` 本身不會替腳本建立雲端同步。

對提供匯入／匯出的腳本，先下載設定 JSON，移轉後匯入並核對實際鍵位或主題最容易驗證。
例如 Vim Navigation 的設定 JSON 可跨 profile／manager 移轉，但不包含目前分頁的暫停狀態。
完整流程見 [08 · 發佈與同步](./08-distribution-and-sync.md)。

### 監看變化

```js
// @grant GM_addValueChangeListener
GM_addValueChangeListener('theme', (key, oldValue, newValue, remote) => {
  if (remote) applyTheme(newValue); // remote = 另一個分頁改的
});
```

多分頁之間同步設定很好用。
這個 listener 只通知 manager 中相關執行環境的值變化，不會自行建立跨裝置同步。

## 剪貼簿

```js
// @grant GM_setClipboard
GM_setClipboard(markdown, 'text');
GM_setClipboard('<b>hi</b>', 'html');
```

比 `navigator.clipboard.writeText()` 好用的地方：**不需要使用者手勢**，
在 `setTimeout` 或 observer callback 裡也能寫入。

典型用途——把整段對話轉成 Markdown 丟給 coding agent：

```text
ChatGPT
──────────────────────
conversation...

                  [Copy MD]
```

## 跨域請求

```js
// @grant   GM_xmlhttpRequest
// @connect api.example.com
```

```js
GM_xmlhttpRequest({
  method: 'GET',
  url: 'https://api.example.com/data',
  headers: { Accept: 'application/json' },
  onload(res) {
    const data = JSON.parse(res.responseText);
    console.log(data);
  },
  onerror(err) {
    console.error(err);
  },
});
```

這是 GM API 最有價值的一個：**繞過 CORS**。一般網頁的 `fetch()` 打別的網域會被擋，
`GM_xmlhttpRequest` 由 extension 發出，不受同源政策限制。

⚠️ 目標網域一定要列在 `@connect`。

Promise 版本包裝：

```js
function gmFetch(options) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({ ...options, onload: resolve, onerror: reject, ontimeout: reject });
  });
}

const res = await gmFetch({ method: 'GET', url: 'https://api.example.com/data' });
```

## 選單指令

```js
// @grant GM_registerMenuCommand
GM_registerMenuCommand('Export conversation', exportConversation);
```

⚠️ 第三個參數的 options 兩邊不完全一樣（`accessKey` 是 Tampermonkey 限定）。
想跨 manager 就只用前兩個參數。

不用動網站 UI 就能提供功能：

```text
Tampermonkey
 ├─ Export conversation
 ├─ Copy as Markdown
 └─ Debug selectors
```

想移除的話，**自己指定一個 id**，不要依賴回傳值：

```js
// @grant GM_unregisterMenuCommand
GM_registerMenuCommand('Stop', stop, { id: 'stop' });
GM_unregisterMenuCommand('stop');
```

Tampermonkey 的 `GM_registerMenuCommand` 會回傳一個 id，Violentmonkey 則是用
caption 或你自己給的 id 來反註冊。明確指定 id 是唯一兩邊都可靠的寫法。

## 注入 CSS

```js
// @grant GM_addStyle
GM_addStyle(`
  .ad-banner { display: none !important; }
  #my-panel { position: fixed; z-index: 2147483647; }
`);
```

搭配 `@run-at document-start` 可以避免元素先閃一下才被隱藏。

沒有 `GM_addStyle` 的環境（例如 `@grant none`）可以自己來：

```js
const style = document.createElement('style');
style.textContent = '...';
document.head.appendChild(style);
```

## 通知與分頁

```js
// @grant GM_notification
GM_notification({ title: 'Done', text: '匯出完成', timeout: 3000 });

// @grant GM_openInTab
GM_openInTab('https://example.com', { active: false, insert: true });

// @grant GM_download
GM_download({ url: blobUrl, name: 'conversation.md' });
```

## 腳本自身資訊

`GM_info` 不需要 `@grant`：

```js
console.log(GM_info.script.version); // '1.0.0'
console.log(GM_info.scriptHandler); // 'Tampermonkey' / 'Violentmonkey'
```

寫「版本更新後跳一次提示」很好用。

## `GM_*` vs `GM.*`

較新的規範提供 Promise 版本：

```js
// @grant GM.setValue
// @grant GM.getValue
const value = await GM.getValue('key', 0);
await GM.setValue('key', value);
```

- `GM_setValue`（底線）：同步，相容性最好
- `GM.setValue`（點）：回傳 Promise

本 repo 多數腳本使用底線版；需要 Promise 語意或特定 manager 相容處理時，也會搭配 `GM.*`。
兩種名稱都要依實際使用宣告 grant，不能只把底線換成點就假設所有呼叫方式相同。

## 相容性提醒

Tampermonkey 和 Violentmonkey 的 GM API 大致相同，但不是 100%。
會跨 manager 分享的腳本，用之前先確認一下。

## 下一步

[05 · SPA 與執行時機](./05-spa-and-timing.md)
