// ==UserScript==
// @name         Hello Userscript
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      1.0.0
// @description  教學用 demo：示範 metadata、GM API、MutationObserver 與注入 UI
// @author       Da-Wei Lee
// @license      MIT
// @match        https://example.com/*
// @match        https://www.example.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/hello-userscript/hello-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/hello-userscript/hello-userscript.user.js
// ==/UserScript==

/**
 * 這支腳本不解決任何真實問題，它存在的目的是「一次看完 userscript 的常見零件」：
 *
 *   1. metadata block      —— 上面那段 ==UserScript== 註解，決定何時／何處執行
 *   2. GM_addStyle         —— 注入 CSS
 *   3. 注入自己的 UI       —— createElement + appendChild
 *   4. GM_setValue/GetValue —— 跨頁、跨 reload 的持久化儲存
 *   5. GM_setClipboard     —— 寫入剪貼簿（不需要使用者手勢）
 *   6. GM_registerMenuCommand —— 在 Tampermonkey 選單加指令
 *   7. MutationObserver    —— 應付 SPA 的 DOM 變化
 *
 * 對應教學：docs/02-getting-started.md 與 docs/04-gm-api.md
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'visitCount';
  const PANEL_ID = 'hello-userscript-panel';

  // 1) 注入 CSS。用高 z-index 與獨特 class 名，避免和網站樣式打架。
  GM_addStyle(`
    #${PANEL_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #1f2933;
      color: #f5f7fa;
      border-radius: 10px;
      padding: 12px 14px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
      max-width: 260px;
    }
    #${PANEL_ID} h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
    #${PANEL_ID} p  { margin: 0 0 8px; opacity: 0.8; }
    #${PANEL_ID} button {
      cursor: pointer;
      border: 0;
      border-radius: 6px;
      padding: 5px 10px;
      margin-right: 6px;
      background: #3ba3ff;
      color: #06131f;
      font-weight: 600;
    }
    #${PANEL_ID} button.secondary { background: #3e4c59; color: #f5f7fa; }
  `);

  // 2) 持久化儲存：GM_getValue 的第二個參數是預設值。
  const visitCount = Number(GM_getValue(STORAGE_KEY, 0)) + 1;
  GM_setValue(STORAGE_KEY, visitCount);

  /** 把目前頁面整理成 Markdown —— 真正的 exporter 腳本大多是這個形狀的放大版。 */
  function pageAsMarkdown() {
    const heading = document.querySelector('h1')?.textContent?.trim() ?? document.title;
    const paragraphs = [...document.querySelectorAll('p')]
      .map((p) => p.textContent.trim())
      .filter(Boolean);
    return [`# ${heading}`, '', `<${location.href}>`, '', ...paragraphs].join('\n');
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return; // idempotent：SPA 會重複呼叫

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h4>Hello Userscript 👋</h4>
      <p>你在這個網站觸發本腳本第 <b>${visitCount}</b> 次（存在 GM storage，reload 不會歸零）。</p>
    `;

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy as Markdown';
    copyBtn.addEventListener('click', () => {
      GM_setClipboard(pageAsMarkdown(), 'text');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy as Markdown'), 1500);
    });

    const hideBtn = document.createElement('button');
    hideBtn.className = 'secondary';
    hideBtn.textContent = 'Hide';
    hideBtn.addEventListener('click', () => panel.remove());

    panel.append(copyBtn, hideBtn);
    document.body.appendChild(panel);
  }

  // 3) Tampermonkey 選單指令：不用動網站 UI 也能提供功能。
  GM_registerMenuCommand('Copy page as Markdown', () => {
    GM_setClipboard(pageAsMarkdown(), 'text');
  });
  GM_registerMenuCommand('Reset visit counter', () => {
    GM_setValue(STORAGE_KEY, 0);
    location.reload();
  });
  GM_registerMenuCommand('Show panel', buildPanel);

  buildPanel();

  // 4) SPA 保險：網站自己重繪 DOM 時把面板補回去。
  new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID)) buildPanel();
  }).observe(document.body, { childList: true, subtree: true });
})();
