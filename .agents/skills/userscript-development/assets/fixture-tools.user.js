// ==UserScript==
// @name         Userscript Fixture Tools
// @namespace    https://example.com/userscript-fixtures
// @version      0.1.0
// @description  Counter and reset menu for an isolated userscript test page
// @license      MIT
// @match        https://userscript.test/*
// @match        http://127.0.0.1/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';
  const KEY = 'fixtureCount';
  const ID = 'fixture-tools-counter';

  function reconcile() {
    const main = document.getElementById('fixture-main');
    if (!main) return;
    let button = main.querySelector('#' + ID);
    if (!button) {
      button = document.createElement('button');
      button.id = ID;
      button.type = 'button';
      button.dataset.userscriptOwned = 'fixture-tools';
      button.addEventListener('click', () => {
        GM_setValue(KEY, GM_getValue(KEY, 0) + 1);
        reconcile();
      });
      main.append(button);
    }
    const label = `Fixture count: ${GM_getValue(KEY, 0)}`;
    if (button.textContent !== label) button.textContent = label;
  }

  GM_registerMenuCommand('Reset fixture count', () => {
    GM_setValue(KEY, 0);
    reconcile();
  });

  function start() {
    reconcile();
    // This tiny fixture owns no route-specific cache. A general SPA tool also
    // needs explicit route handling, cancellation and feature-disable cleanup.
    new MutationObserver(reconcile).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
