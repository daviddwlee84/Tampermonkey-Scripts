// ==UserScript==
// @name         {{NAME}}
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  {{DESCRIPTION}}
// @author       Da-Wei Lee
// @license      MIT
// @match        {{MATCH}}
// @icon         {{ICON}}
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/{{SLUG}}/{{SLUG}}.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/{{SLUG}}/{{SLUG}}.user.js
// ==/UserScript==

/**
 * {{NAME}}
 *
 * 開發備忘：
 * - 改動後記得把 @version 往上加，否則其他機器的 Tampermonkey 不會更新。
 * - 用到任何 GM_* API 都要在上面加對應的 `// @grant`，`npm run check` 會擋。
 * - 現代網站多半是 SPA：換頁不會 reload，所以下面用 MutationObserver + URL 監看。
 */
(function () {
  'use strict';

  const LOG_PREFIX = '[{{SLUG}}]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  /** 頁面（或 SPA 路由）進入可用狀態時要做的事。可重複呼叫，必須 idempotent。 */
  function run() {
    // TODO: 在這裡實作。範例：
    // const target = document.querySelector('main');
    // if (!target || target.dataset.myScriptDone) return;
    // target.dataset.myScriptDone = '1';
    log('running on', location.href);
  }

  /** 等某個 selector 出現（SPA 常見需求），逾時就放棄。 */
  function waitForElement(selector, { timeout = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  /** SPA 路由變化偵測：history API 不會觸發任何原生事件，所以自己輪詢 URL。 */
  function onUrlChange(callback) {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        callback(location.href);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  run();
  onUrlChange(run);

  // 用不到就刪掉，留著只是提醒有這個工具可用。
  void waitForElement;
})();
