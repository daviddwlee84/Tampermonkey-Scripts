// ==UserScript==
// @name         Page Title Tag
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      1.0.0
// @description  在分頁標題前面加上網站標籤（如 [GPT]），一堆分頁時好找
// @author       Da-Wei Lee
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-title-tag/page-title-tag.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-title-tag/page-title-tag.user.js
// ==/UserScript==

/**
 * 開一排 AI 分頁時，favicon 太小、標題又都長很像。這支在標題前加一個短標籤。
 *
 * 麻煩的點：這些網站都是 SPA，而且會在切換對話時自己覆寫 document.title。
 * 所以不能只設定一次 —— 必須監看 <title> 節點的變化再補上去。
 * 細節見 docs/05-spa-and-timing.md。
 */
(function () {
  'use strict';

  /** hostname 後綴 → 標籤。第一個命中的就用。 */
  const TAGS = [
    ['chatgpt.com', 'GPT'],
    ['claude.ai', 'Claude'],
    ['gemini.google.com', 'Gemini'],
  ];

  const tag = TAGS.find(([host]) => location.hostname.endsWith(host))?.[1];
  if (!tag) return;

  const prefix = `[${tag}] `;
  let applying = false;

  function applyTag() {
    if (applying) return; // 我們自己改 title 也會觸發 observer，擋掉遞迴
    if (document.title.startsWith(prefix)) return;

    applying = true;
    document.title = prefix + document.title;
    applying = false;
  }

  applyTag();

  // <title> 的文字節點被網站換掉時再貼一次。
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(applyTag).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // 保險：SPA 有時整個 <head> 重建，<title> 元素本身被換掉。
  new MutationObserver(applyTag).observe(document.head, { childList: true });
})();
