// ==UserScript==
// @name         Copilot Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      1.0.0
// @description  把整段 Microsoft Copilot 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用
// @author       Da-Wei Lee
// @license      MIT
// @match        https://copilot.microsoft.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyNjMgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkNFPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @require      https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/chat-export.js
// @require      https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/export-ui.js
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/copilot-export-markdown/copilot-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/copilot-export-markdown/copilot-export-markdown.user.js
// ==/UserScript==

/* global createExportPanel, downloadText, filenameFor, jsonFence, renderTranscript, sourcesBlock */

/**
 * 把一整段 Microsoft Copilot 對話匯成 Markdown，格式跟 chatgpt / claude 那兩支一致
 * （SpecStory 風格的 `_**User (ts)**_` / `---` / `_**Assistant**_`），目的是貼給 coding agent。
 *
 * 這支腳本刻意「不把 API 綁死」，因為實測時有一段是黑箱：
 *
 * - 登入中的對話：`/chats/<id>` ＋ `GET /c/api/conversations/<id>/history?api-version=2`
 *   → `{ results: [{ author: { type: 'ai' | 'human' }, content: [...], createdAt }] }`
 * - 分享出來的對話：`/shares/<id>`。匿名開只會拿到「Sign in to Copilot」擋頁，
 *   打 `/c/api/shares/<id>` 回 **401**（endpoint 存在但要登入），
 *   所以**它的回應長什麼樣沒辦法事先確認**。
 *
 * 因應方式：攔下 `/c/api/{shares,conversations}/…` 的所有 JSON，然後**用形狀找訊息列表**
 * （元素同時有 author/sender 與 content 的那個陣列，取最長的），
 * 不假設 top-level key 叫 `results`。成功時會把命中的 URL 與 top-level keys 印到 console，
 * 遇到沒見過的形狀請把那行連同 Download .json 的內容回報。
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const NS = 'copilot-export-md';
  const EXPORTER = `copilot-export-markdown v${VERSION}`;
  const LOG_PREFIX = '[copilot-export-markdown]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // 有任何 @grant 就會被 sandbox，頁面的全域要走 unsafeWindow 才看得到。
  const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------------------------------------------------------------- 設定

  const SETTINGS_KEYS = ['includeThinking', 'includeTools'];
  const PENDING_KEY = 'pendingExport'; // 「貼 share URL → 開新分頁自動匯出」的一次性交棒
  const settings = { includeThinking: false, includeTools: false };

  for (const key of SETTINGS_KEYS) {
    settings[key] = GM_getValue(key, settings[key]) === true;
  }

  function setSetting(key, value) {
    settings[key] = value === true;
    GM_setValue(key, settings[key]);
  }

  // ------------------------------------------------- 來源 1：攔截網站自己的請求

  const CAPTURE_URL = /\/c\/api\/(shares|conversations)\//;
  const DEFAULT_TITLE = 'Copilot conversation';
  /** [{ url, data, messages }]，最新的排最後。 */
  const captured = [];
  let capturedAuth = null;

  /** 深掃找「訊息列表」：元素同時有 author/sender 與 content 的陣列，取最長的那個。 */
  function findMessageList(root, maxDepth = 6) {
    const seen = new Set();
    let best = null;

    const isMessage = (item) =>
      !!item &&
      typeof item === 'object' &&
      (item.author || item.sender || item.role) &&
      (Array.isArray(item.content) || typeof item.content === 'string' || 'text' in item);

    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > maxDepth || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        if (node.length > 0 && node.every(isMessage)) {
          if (!best || node.length > best.length) best = node;
          return;
        }
        for (const item of node) walk(item, depth + 1);
        return;
      }
      for (const value of Object.values(node)) walk(value, depth + 1);
    };

    walk(root, 0);
    return best;
  }

  function rememberPayload(url, payload) {
    const messages = findMessageList(payload);
    if (!messages) return;
    captured.push({ url, data: payload, messages });
    log('captured conversation:', url, `${messages.length} messages`);
  }

  function rememberAuth(value) {
    if (typeof value === 'string' && /^Bearer\s+/i.test(value)) capturedAuth = value;
  }

  function installFetchCapture() {
    const originalFetch = pageWin.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__copilotExportPatched) return;

    const patched = function (...args) {
      try {
        const [input, init] = args;
        const headers = init?.headers || (input && input.headers);
        if (headers) {
          const list = headers instanceof Headers ? headers : new Headers(headers);
          rememberAuth(list.get('authorization'));
        }
      } catch {
        /* 取不到 header 不影響主流程 */
      }

      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input?.url || '';
          // body 只能讀一次，一定要 clone，否則網站自己就讀不到了。
          if (response.ok && CAPTURE_URL.test(url)) {
            response
              .clone()
              .json()
              .then((json) => rememberPayload(url, json))
              .catch(() => {});
          }
        } catch {
          /* 攔截失敗不能影響網站本身 */
        }
        return response; // 一定要把原本的 response 還回去
      });
    };
    patched.__copilotExportPatched = true;
    pageWin.fetch = patched;
  }

  /** Copilot 有些請求走 XHR，所以兩種都要攔。 */
  function installXhrCapture() {
    const XHR = pageWin.XMLHttpRequest;
    if (!XHR || XHR.prototype.__copilotExportPatched) return;

    const { open, send, setRequestHeader } = XHR.prototype;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__copilotExportUrl = String(url || '');
      return open.call(this, method, url, ...rest);
    };

    XHR.prototype.setRequestHeader = function (name, value) {
      if (String(name).toLowerCase() === 'authorization') rememberAuth(value);
      return setRequestHeader.call(this, name, value);
    };

    XHR.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = this.__copilotExportUrl || '';
          if (this.status < 200 || this.status >= 300 || !CAPTURE_URL.test(url)) return;
          const raw =
            this.responseType === '' || this.responseType === 'text'
              ? this.responseText
              : this.response;
          rememberPayload(url, typeof raw === 'string' ? JSON.parse(raw) : raw);
        } catch {
          /* 不是 JSON 就算了 */
        }
      });
      return send.apply(this, args);
    };

    XHR.prototype.__copilotExportPatched = true;
  }

  // ------------------------------------------------------- 來源 2：自己打 API

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function pickCaptured({ chatId, shareId }) {
    const id = shareId || chatId;
    if (id) {
      for (let i = captured.length - 1; i >= 0; i--) {
        if (captured[i].url.includes(id)) return captured[i];
      }
    }
    return captured[captured.length - 1] || null;
  }

  async function waitForCapture(ids, { timeout = 8_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = pickCaptured(ids);
      if (hit) return hit;
      if (Date.now() >= deadline) return null;
      await delay(interval);
    }
  }

  /** 暖一下 session。公開的 Copilot exporter 都這樣做，401 之後再試一次常常就過了。 */
  async function warmSession() {
    try {
      await fetch('/c/api/start', { method: 'POST', credentials: 'include' });
    } catch {
      /* 暖不起來就直接試 */
    }
  }

  async function fromApi({ chatId, shareId }) {
    const paths = [];
    if (shareId) paths.push(`/c/api/shares/${shareId}`, `/c/api/shares/${shareId}?api-version=2`);
    if (chatId) paths.push(`/c/api/conversations/${chatId}/history?api-version=2`);

    for (const path of paths) {
      for (const attempt of [1, 2]) {
        try {
          const headers = { accept: 'application/json' };
          if (capturedAuth) headers.authorization = capturedAuth;
          const res = await fetch(path, { credentials: 'include', headers });
          if (!res.ok) {
            log('api fallback failed:', path, res.status);
            if (attempt === 1 && (res.status === 401 || res.status === 403)) {
              await warmSession();
              continue;
            }
            break;
          }
          const json = await res.json();
          const messages = findMessageList(json);
          if (messages) return { url: path, data: json, messages };
          break;
        } catch (error) {
          log('api fallback threw:', error.message);
          break;
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------ 來源總調度

  function currentIds() {
    const chat = location.pathname.match(/\/chats\/([A-Za-z0-9_-]+)/);
    const share = location.pathname.match(/^\/shares\/([A-Za-z0-9_-]+)/);
    return { chatId: chat?.[1] || null, shareId: share?.[1] || null };
  }

  function shareIdFromUrl(input) {
    const match = String(input).match(/\/shares\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  }

  async function resolveConversation(ids) {
    const hit = pickCaptured(ids) || (await waitForCapture(ids));
    if (hit) return { ...hit, source: 'network-capture' };

    const api = await fromApi(ids);
    if (api) return { ...api, source: 'api' };

    throw new Error('抓不到對話資料。請確認已登入、對話已載完，再重新整理這一頁試一次。');
  }

  // ------------------------------------------------------------ 轉成 Markdown

  function roleOf(message) {
    const type = String(
      message.author?.type || message.author || message.sender || message.role || ''
    );
    if (/human|user/i.test(type)) return 'User';
    if (/^(ai|bot|assistant|copilot)$/i.test(type)) return 'Assistant';
    return type ? type[0].toUpperCase() + type.slice(1) : 'Unknown';
  }

  function partToText(part, opts, citations) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';

    switch (part.type) {
      case 'text':
        return String(part.text ?? '');
      case 'image': {
        if (!part.url) return '';
        const caption = part.prompt ? `\n\n*Prompt: ${part.prompt}*` : '';
        return `![image](${part.url})${caption}`;
      }
      case 'citation':
        if (part.url) citations.push({ url: part.url, title: part.title || '' });
        return '';
      case 'chainOfThought': {
        if (!opts.includeThinking) return '';
        const shot = part.screenshotUrl ? `\n\n![screenshot](${part.screenshotUrl})` : '';
        return `${String(part.text ?? '')}${shot}`;
      }
      default:
        // 沒見過的 part。預設不塞進正文（避免整篇被 tool 雜訊淹掉），
        // 但打開「含工具呼叫」時原樣留 JSON，不靜默丟掉。
        if (!opts.includeTools) return '';
        return `**${part.type || 'part'}**\n\n${jsonFence(part)}`;
    }
  }

  function messageToBody(message, opts) {
    const citations = [];
    const parts = Array.isArray(message.content)
      ? message.content
      : message.content
        ? [message.content]
        : [];

    const texts = parts
      .map((part) => partToText(part, opts, citations))
      .filter((text) => String(text).trim());

    if (texts.length === 0 && typeof message.text === 'string' && message.text.trim()) {
      texts.push(message.text);
    }

    const sources = sourcesBlock(citations);
    if (sources) texts.push(sources);
    return texts.join('\n\n');
  }

  /**
   * `/c/api/conversations/<id>/history` 的回應裡沒有標題，
   * 標題在對話列表那支 API 上。拿不到就算了，frontmatter 留預設值。
   */
  async function lookupTitle(chatId) {
    try {
      const headers = { accept: 'application/json' };
      if (capturedAuth) headers.authorization = capturedAuth;
      const res = await fetch('/c/api/conversations?api-version=2', {
        credentials: 'include',
        headers,
      });
      if (!res.ok) return '';
      const json = await res.json();
      const items = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
      return items.find((item) => item?.id === chatId)?.title || '';
    } catch {
      return '';
    }
  }

  /** title 藏在哪一層不確定，往下找兩層就好。 */
  function pickTitle(data) {
    const keys = ['title', 'conversationTitle', 'name', 'snapshotName'];
    const look = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 2) return '';
      for (const key of keys) {
        if (typeof node[key] === 'string' && node[key].trim()) return node[key];
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const hit = look(value, depth + 1);
          if (hit) return hit;
        }
      }
      return '';
    };
    return look(data, 0) || DEFAULT_TITLE;
  }

  function normalize(hit, ctx, opts) {
    const messages = [...hit.messages].sort((a, b) => {
      const at = new Date(a.createdAt || a.created_at || 0).getTime() || 0;
      const bt = new Date(b.createdAt || b.created_at || 0).getTime() || 0;
      return at - bt;
    });

    const sections = messages
      .map((message) => ({
        role: roleOf(message),
        model: '',
        time: message.createdAt || message.created_at,
        body: messageToBody(message, opts),
      }))
      .filter((section) => section.body.trim());

    return {
      source: 'copilot',
      sourceLabel: 'Microsoft Copilot',
      title: pickTitle(hit.data),
      url: ctx.url,
      ids: { conversation_id: ctx.chatId || '', share_id: ctx.shareId || '' },
      model: '',
      createdAt: messages[0]?.createdAt || messages[0]?.created_at,
      sections,
    };
  }

  // ------------------------------------------------------------------ 動作

  async function doExport({ mode, to, ids }) {
    ui.setStatus('讀取對話…');
    try {
      const target = ids || currentIds();
      const hit = await resolveConversation(target);
      const url = target.shareId ? `${location.origin}/shares/${target.shareId}` : location.href;
      // 這一行就是把「/c/api/shares/<id> 到底長怎樣」收斂掉的手段，不要拿掉。
      log('using payload from', hit.url, '| top-level keys:', Object.keys(hit.data || {}));

      const doc = normalize(hit, { ...target, url }, settings);
      if (doc.title === DEFAULT_TITLE && target.chatId) {
        doc.title = (await lookupTitle(target.chatId)) || doc.title;
      }
      const text =
        mode === 'json'
          ? JSON.stringify(hit.data, null, 2)
          : renderTranscript(doc, {
              ...settings,
              handoff: mode === 'handoff',
              exporter: EXPORTER,
            });

      if (to === 'clipboard') {
        GM_setClipboard(text, 'text');
        ui.setStatus(`已複製 ${text.length.toLocaleString()} 字（來源：${hit.source}）`);
      } else {
        downloadText(
          filenameFor(doc, mode === 'json' ? 'json' : 'md'),
          text,
          mode === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
        );
        ui.setStatus(`已下載（來源：${hit.source}）`);
      }
      log('exported', { mode, to, source: hit.source, length: text.length });
    } catch (error) {
      ui.setStatus(`失敗：${error.message}`);
      log('export failed:', error);
    }
  }

  /** share 的內容要登入 session 才看得到，所以一律開分頁讓那邊的腳本自己抓。 */
  function exportFromShareUrl(raw) {
    const shareId = shareIdFromUrl(raw);
    if (!shareId) {
      ui.setStatus('這不像 share URL（要有 /shares/<id>）。');
      return;
    }
    if (shareId === currentIds().shareId) {
      doExport({ mode: 'transcript', to: 'clipboard' });
      return;
    }
    GM_setValue(PENDING_KEY, { shareId, expires: Date.now() + 120_000 });
    GM_openInTab(`${location.origin}/shares/${shareId}`, { active: true });
    ui.setStatus('已開新分頁，那邊載完就會自動複製。');
  }

  async function consumePending() {
    const pending = GM_getValue(PENDING_KEY, null);
    if (!pending || typeof pending !== 'object') return;
    const { shareId } = currentIds();
    if (!shareId || pending.shareId !== shareId) return;

    GM_deleteValue(PENDING_KEY); // 一次性：先消耗再執行，免得失敗時每次開頁都重跑
    if (Date.now() > (pending.expires ?? 0)) return;

    ui.openPanel();
    await doExport({ mode: 'transcript', to: 'clipboard' });
  }

  const ACTIONS = [
    { label: 'Copy Markdown', run: () => doExport({ mode: 'transcript', to: 'clipboard' }) },
    { label: 'Copy Agent Handoff', run: () => doExport({ mode: 'handoff', to: 'clipboard' }) },
    { label: 'Download .md', run: () => doExport({ mode: 'transcript', to: 'file' }) },
    { label: 'Download .json', run: () => doExport({ mode: 'json', to: 'file' }) },
  ];

  // -------------------------------------------------------------------- UI

  const ui = createExportPanel({
    ns: NS,
    buttonLabel: '⇩ Export MD',
    actions: ACTIONS,
    toggles: [
      {
        label: '含 thinking / reasoning',
        get: () => settings.includeThinking,
        set: (value) => setSetting('includeThinking', value),
      },
      {
        label: '含工具呼叫與未知區塊',
        get: () => settings.includeTools,
        set: (value) => setSetting('includeTools', value),
      },
    ],
    shareInput: {
      placeholder: '貼上任意 share URL…',
      buttonLabel: 'Open & copy share URL',
      onSubmit: exportFromShareUrl,
    },
    storage: { get: (key, fallback) => GM_getValue(key, fallback), set: GM_setValue },
    onStatus: log,
  });

  function registerMenu() {
    for (const action of ACTIONS) {
      // 不要用 accessKey —— 那是 Tampermonkey 限定的。
      GM_registerMenuCommand(action.label, () => {
        ui.openPanel();
        action.run();
      });
    }
    GM_registerMenuCommand('Export from share URL…', () => {
      ui.openPanel();
      const raw = prompt('貼上 Copilot share URL：');
      if (raw) exportFromShareUrl(raw);
    });
    GM_registerMenuCommand('Toggle thinking / reasoning', () => {
      setSetting('includeThinking', !settings.includeThinking);
      ui.openPanel();
      ui.setStatus(`thinking / reasoning：${settings.includeThinking ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Toggle 工具呼叫與未知區塊', () => {
      setSetting('includeTools', !settings.includeTools);
      ui.openPanel();
      ui.setStatus(`工具呼叫：${settings.includeTools ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Reset button position', () => {
      ui.mount();
      ui.resetPosition();
      ui.openPanel();
      ui.setStatus('按鈕已放回右下角');
    });
  }

  // ----------------------------------------------------------------- 啟動

  installFetchCapture(); // 必須在網站發出請求之前，所以 @run-at document-start
  installXhrCapture();
  registerMenu();

  function start() {
    ui.mount();
    consumePending();

    // SPA 換對話不會 reload，只要確保 UI 還在（抓資料完全不碰 DOM，不需要重建狀態）。
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      ui.mount();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // document-start 時 <body>（有時連 <html>）都還沒有，所以 UI 與 observer 等到 DOM 就緒再掛。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
