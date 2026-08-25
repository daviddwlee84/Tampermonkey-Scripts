# 10 · 常用食譜

可以直接抄的 pattern。每段都假設放在 `(function () { 'use strict'; ... })()` 裡面。

## 目錄

- [注入一個浮動按鈕](#注入一個浮動按鈕)
- [隱藏礙眼的元素](#隱藏礙眼的元素)
- [鍵盤快捷鍵](#鍵盤快捷鍵)
- [把頁面內容轉成 Markdown 並複製](#把頁面內容轉成-markdown-並複製)
- [下載成檔案](#下載成檔案)
- [設定面板](#設定面板)
- [自動點擊 / 自動翻頁](#自動點擊--自動翻頁)
- [攔截網站的 API 回應](#攔截網站的-api-回應)
- [送到本機 coding agent](#送到本機-coding-agent)

## 注入一個浮動按鈕

```js
function addFloatingButton(label, onClick) {
  const existing = document.getElementById('my-fab');
  if (existing) return existing;

  const btn = document.createElement('button');
  btn.id = 'my-fab';
  btn.textContent = label;
  btn.style.cssText = `
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    padding: 8px 14px; border: 0; border-radius: 8px; cursor: pointer;
    background: #3ba3ff; color: #06131f; font-weight: 600;
    box-shadow: 0 4px 16px rgba(0,0,0,.25);
  `;
  btn.addEventListener('click', onClick);
  document.body.appendChild(btn);
  return btn;
}
```

`z-index: 2147483647` 是 32-bit 有號整數上限，確保蓋在網站所有東西上面。
記得檢查有沒有已存在（SPA 會重複呼叫）。

## 隱藏礙眼的元素

```js
// @grant  GM_addStyle
// @run-at document-start
GM_addStyle(`
  .promo-banner,
  aside[aria-label="Sponsored"] { display: none !important; }
`);
```

用 CSS 而不是 `element.remove()`：CSS 對後來才出現的元素也有效，不用 observer。
`document-start` 是為了避免元素先閃一下。

## 鍵盤快捷鍵

```js
document.addEventListener('keydown', (e) => {
  // 在輸入框裡就不要攔
  const el = document.activeElement;
  if (el?.matches('input, textarea, [contenteditable="true"]')) return;

  if (e.altKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    exportConversation();
  }
});
```

用 `Alt` / `Ctrl+Shift` 組合，避免和網站或瀏覽器內建快捷鍵撞到。

## 把頁面內容轉成 Markdown 並複製

```js
// @grant GM_setClipboard

function conversationToMarkdown() {
  const turns = [...document.querySelectorAll('[data-message-author-role]')];
  return turns
    .map((el) => {
      const role = el.dataset.messageAuthorRole === 'user' ? 'User' : 'Assistant';
      return `## ${role}\n\n${el.innerText.trim()}`;
    })
    .join('\n\n---\n\n');
}

GM_setClipboard(conversationToMarkdown(), 'text');
```

`innerText` 而不是 `textContent`：前者尊重換行與可見性，後者會把
`display:none` 的內容也一起吐出來、而且沒有換行。

## 下載成檔案

```js
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

downloadText(`conversation-${new Date().toISOString().slice(0, 10)}.md`, markdown);
```

不需要任何 `@grant`。也可以用 `GM_download`，但這版相容性最好。

## 設定面板

```js
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_registerMenuCommand

const defaults = { autoExport: false, tag: 'GPT' };
const config = { ...defaults, ...GM_getValue('config', {}) };

function saveConfig(patch) {
  Object.assign(config, patch);
  GM_setValue('config', config);
}

GM_registerMenuCommand(`Auto export: ${config.autoExport ? 'ON' : 'OFF'}`, () => {
  saveConfig({ autoExport: !config.autoExport });
  location.reload();   // 讓選單文字重新產生
});
```

小設定用選單指令就夠了，不必做完整的設定 UI。

## 自動點擊 / 自動翻頁

```js
async function loadAll({ max = 50 } = {}) {
  for (let i = 0; i < max; i++) {
    const more = document.querySelector('button[data-testid="load-more"]');
    if (!more) break;
    more.click();
    await new Promise((r) => setTimeout(r, 800));
  }
}
```

**一定要有上限**（這裡是 `max`）。沒有上限的自動點擊迴圈，
遇到網站改版就會變成無限打 request。

## 攔截網站的 API 回應

```js
// @run-at document-start
// @grant  unsafeWindow

const origFetch = unsafeWindow.fetch;
unsafeWindow.fetch = async function (...args) {
  const response = await origFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';

  if (url.includes('/backend-api/conversation')) {
    response.clone().json().then((data) => {
      window.__captured = data;
      console.log('[my-script] captured conversation', data);
    }).catch(() => {});
  }
  return response;
};
```

兩個不能省的細節：`@run-at document-start`（不然來不及），
以及 `response.clone()`（body 只能讀一次，讀掉網站就壞了）。
背景見 [06](./06-sandbox-and-unsafewindow.md)。

## 送到本機 coding agent

userscript 在這個場景等於你的 **browser-side adapter**：

```text
ChatGPT webpage
    ↓
Userscript
    ↓ 抽出對話
Markdown / JSON
    ↓ GM_xmlhttpRequest
localhost:8765
    ↓
handoff daemon
    ↓ 寫檔
~/handoff/chatgpt-2026-08-25.md
    ↓
Claude Code / Codex
```

腳本端：

```js
// @grant   GM_xmlhttpRequest
// @connect localhost
// @connect 127.0.0.1

function sendToLocal(markdown) {
  GM_xmlhttpRequest({
    method: 'POST',
    url: 'http://127.0.0.1:8765/handoff',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ url: location.href, markdown }),
    onload: (res) => console.log('[handoff]', res.status),
    onerror: (err) => console.error('[handoff]', err),
  });
}
```

於是 UI 可以是：

```text
[Send to Claude Code]
[Send to Codex]
[Copy Markdown]
[Download .md]
```

本機那端接到之後：

```bash
claude "$(cat ~/handoff/chatgpt-2026-08-25.md)"
```

⚠️ 本機 daemon 只綁 `127.0.0.1`，並且要驗證來源——別讓任何網站都能往它塞東西。

## 下一步

[11 · 疑難排解](./11-troubleshooting.md)
