# 02 · 第一支腳本

## 1. 裝一個 userscript manager

| 瀏覽器            | 建議                                        |
| ----------------- | ------------------------------------------- |
| Chrome / Edge / Brave | [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/) |
| Firefox           | Violentmonkey 或 Tampermonkey               |
| Safari            | Userscripts（App Store）                    |

差別見 [09 Manager 比較](./09-managers-comparison.md)。本教學兩者通用，
metadata 與 GM API 在 Tampermonkey / Violentmonkey 上大致相容。

### Chrome 需要打開 Developer mode

Chrome 的 Manifest V3 之後，userscript manager 需要你在
`chrome://extensions` 開啟 **Developer mode**（開發人員模式）才能執行腳本。
沒開的話會看到「腳本裝了但完全沒反應」——這是最常見的第一個坑。

## 2. 建立腳本

點工具列的 manager 圖示 → **Create a new script**（建立新腳本）。
會得到一個編輯器與一段預設 metadata。

## 3. 貼上這段

```js
// ==UserScript==
// @name         My First Script
// @namespace    local
// @version      0.1.0
// @description  在頁面右下角放一個按鈕
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const button = document.createElement('button');
  button.textContent = 'Hello';
  button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;padding:8px 12px;';
  button.addEventListener('click', () => {
    console.log('page title:', document.title);
    alert(`共有 ${document.querySelectorAll('a').length} 個連結`);
  });

  document.body.appendChild(button);
})();
```

存檔（Ctrl/Cmd + S）→ 打開 <https://example.com> → reload。右下角應該出現按鈕。

## 4. 讀懂每一行 metadata

```js
// @name         腳本清單裡顯示的名字
// @namespace    命名空間，避免和別人的同名腳本衝突。用你的 GitHub URL 最省事
// @version      版本號。自動更新完全靠它，改 code 就要往上加
// @description  一句話說明
// @match        哪些網址要執行 —— 最重要的一行
// @grant        要用哪些 GM_* API；不用就寫 none
```

完整清單見 [03 Metadata 完整參考](./03-metadata-reference.md)。

## 5. Debug

userscript 的 `console.log` 會直接印在該分頁的 DevTools Console，
和頁面本身的 log 混在一起。建議加前綴：

```js
const log = (...args) => console.log('[my-script]', ...args);
```

在 Console 的 filter 打 `[my-script]` 就只剩你的 log。

Sources / Debugger 面板裡，腳本會出現在 `userscript.html` 之類的虛擬檔案下，
可以正常下中斷點。

## 6. 從 Console PoC 開始的實務流程

寫 userscript 最有效率的路徑不是直接寫腳本，而是：

```text
DevTools Console 試 selector / 邏輯
        ↓ 確認可行
搬進 userscript
        ↓
加 button / 熱鍵 / 剪貼簿
```

例如先在 Console 確認：

```js
document.querySelectorAll('article');           // 抓得到對話嗎
[...document.querySelectorAll('article')].length // 數量對嗎
```

確認 selector 有效再搬進腳本，可以省掉大量「到底是 selector 錯還是時機錯」的來回。

## 7. 接下來把它變成 repo 裡的腳本

不要讓 manager 內建編輯器那份變成 master —— 沒有 diff、沒有歷史、換機器就沒了。
本 repo 的做法：

```bash
npm run new -- my-first-script "My First Script" "https://example.com/*"
# 編輯 userscripts/my-first-script/my-first-script.user.js
npm run check   # 檢查 metadata
npm run index   # 更新 README 索引
```

理由與完整流程見 [07 開發工作流](./07-dev-workflow.md) 與
[08 發佈與同步](./08-distribution-and-sync.md)。

## 下一步

[03 · Metadata 完整參考](./03-metadata-reference.md)
