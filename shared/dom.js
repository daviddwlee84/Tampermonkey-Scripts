/* eslint-env browser */
/**
 * 共用 DOM 工具，給 userscript 用 `@require` 引入：
 *
 *   // @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/dom.js
 *
 * 注意這不是 ES module —— `@require` 進來的檔案會直接在腳本的 scope 執行，
 * 所以這裡用的是全域函式宣告。
 *
 * 先讀 shared/README.md：多數情況直接把需要的函式複製到腳本裡更省事。
 */

/** 等某個 selector 出現，逾時就 reject。SPA 上最常用的一個。 */
function waitForElement(selector, { timeout = 10_000, root = document.documentElement } = {}) {
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
    observer.observe(root, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

/** SPA 路由變化偵測。history.pushState 不會觸發任何原生事件，所以比對 URL。 */
function onUrlChange(callback) {
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      callback(location.href);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** MutationObserver callback 幾乎都該包一層 debounce。 */
function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** 只做一次：已標記過的節點直接跳過。SPA 重複呼叫時的去重手段。 */
function markOnce(element, key) {
  if (element.dataset[key]) return false;
  element.dataset[key] = '1';
  return true;
}

/** 右下角浮動按鈕。重複呼叫只會建立一個。 */
function addFloatingButton({ id, label, onClick, offset = 16 }) {
  const existing = document.getElementById(id);
  if (existing) return existing;

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = label;
  btn.style.cssText = `
    position: fixed; right: ${offset}px; bottom: ${offset}px; z-index: 2147483647;
    padding: 8px 14px; border: 0; border-radius: 8px; cursor: pointer;
    background: #3ba3ff; color: #06131f; font-weight: 600;
    font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  `;
  btn.addEventListener('click', onClick);
  document.body.appendChild(btn);
  return btn;
}

/** 不需要任何 @grant 的檔案下載。 */
function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
