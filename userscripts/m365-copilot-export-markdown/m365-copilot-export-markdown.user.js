// ==UserScript==
// @name         M365 Copilot Chat Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.2.0
// @description  【實驗性】把 Microsoft 365 Copilot Chat 對話匯成 Markdown，貼給 coding agent 用——尚未經真實帳號驗證
// @author       Da-Wei Lee
// @license      MIT
// @match        https://m365.cloud.microsoft/*
// @match        https://copilot.cloud.microsoft/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyMTUgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPk1DPC90ZXh0Pjwvc3ZnPg==
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
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/m365-copilot-export-markdown/m365-copilot-export-markdown.user.js
// ==/UserScript==

/* global createExportPanel, downloadText, filenameFor, jsonFence, renderTranscript, sourcesBlock */

/**
 * ⚠️ 實驗性：這支腳本完全沒有在真實 M365 Copilot 帳號上跑過，隨時可能整支不能用。
 *
 * 背景：這是 `copilot-export-markdown`（消費版 copilot.microsoft.com）的姊妹腳本，
 * 目標是 Microsoft 365 的企業版／個人版 Copilot Chat。這兩個產品**不是同一個 API**：
 *
 * - `copilot.cloud.microsoft` —— 使用者確認是他們公司帳號用的「for organization」網域
 * - `m365.cloud.microsoft` —— 個人版，有公開分享連結，例如
 *   `https://m365.cloud.microsoft/chat/share/<base64url(JSON)>`，base64 解出來是
 *   `{"shareId":"…","conversationId":"…"}`——但**這個連結需要登入才看得到內容**
 *   （匿名開會被導去 login.microsoftonline.com），跟 ChatGPT / Claude 的「匿名可看」不同，
 *   所以沒辦法在沒有帳號的情況下探到真正的 API 回應。
 *
 * 因為不確定兩個網域、甚至「登入中的歷史紀錄」與「share 連結」是不是打同一套 API，
 * 這支腳本的**主要來源是攔截**（跟 chatgpt / claude / copilot 三支同一個模式）：
 * `document-start` 攔 `fetch` / `XMLHttpRequest`，攔到的 JSON **不限定 URL host**，
 * 用形狀辨識找訊息列表——不管網站實際上打的是哪個 endpoint 都攔得到，因為攔截是包一層
 * `window.fetch`，跟目標 API 在哪個網域無關（不受同源限制：是頁面自己發的跨網域請求，
 * 我們只是攔截再照樣呼叫原本的）。
 *
 * 次要 fallback（只給「登入中查看自己的歷史紀錄」用，覆蓋不到 share 連結）是從公開專案
 * ganyuke/copilot-exporter（MIT license，github.com/ganyuke/copilot-exporter）的 build
 * 產物反推出來的真實 API 事實——不是抄它的程式碼，是照這個 repo 一貫的風格自己刻，
 * 只是 token 這段沒辦法憑空猜出來，來源列在下面：
 *
 * - `GET https://substrate.office.com/m365Copilot/GetConversation?request={"conversationId":…}`
 *   → `{ chatName, createTimeUtc, updateTimeUtc, conversationId,
 *        messages: [{ messageId, author: 'user'|'assistant', createdAt|timestamp, text,
 *                      adaptiveCards?, references? }] }`
 * - citation 是 `adaptiveCards[0].body[0].text` 裡的『【key】』全形括號 marker，
 *   對照 `references[key]`（`targetLink` 是 URL，`displayData.content` 是含 `label` /
 *   `Title` 的 JSON 字串）
 * - 驗證要讀 MSAL（`@azure/msal-browser`）存在 localStorage 的**加密** token cache：
 *   `msal.3.account.keys` 找帳號、`msal.3.token.keys.<clientId>`
 *   （clientId 固定 `c0ab8ce9-e9a0-42e7-b064-33d422df41f1`，M365 Copilot Chat 的第一方
 *   app id）找 scope 含 `substrate.office.com/sydney/.default` 的 token，
 *   配合 cookie `msal.cache.encryption` 做 HKDF → AES-GCM 解密。這是 MSAL 自己的公開
 *   「cache encryption」機制，不是漏洞——單純是讀使用者自己瀏覽器裡、自己帳號已登入的
 *   token 來呼叫網站自己的 API，跟另外三支腳本讀 `Authorization` header 是同一類事情。
 *
 * **Copy Diagnostics**：因為不確定真實 API 長怎樣，這支腳本會把「攔到的每一個 JSON
 * 回應」的 `{url, status, top-level keys}`（不含任何內容）記下來，一鍵複製。
 * 拿到真實帳號測試的人請先按這個，把結果回報，才能把 `findMessageList` / `normalize()`
 * 對準真實形狀微調。
 */
(function () {
  'use strict';

  const VERSION = '0.2.0';
  const NS = 'm365-copilot-export-md';
  const EXPORTER = `m365-copilot-export-markdown v${VERSION}`;
  const LOG_PREFIX = '[m365-copilot-export-markdown]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // 有任何 @grant 就會被 sandbox，頁面的全域要走 unsafeWindow 才看得到。
  const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // M365 Copilot Chat 的第一方 app id，來自 ganyuke/copilot-exporter 的反推結果。
  const MSAL_CLIENT_ID = 'c0ab8ce9-e9a0-42e7-b064-33d422df41f1';
  const MSAL_TOKEN_SCOPE = 'https://substrate.office.com/sydney/.default';

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

  /**
   * 深掃找「訊息列表」：元素同時有 author/sender/role 與 content/text 的陣列，
   * 取最長的那個。跟 `copilot-export-markdown.user.js` 是同一套邏輯，因為我們也不知道
   * M365 Copilot Chat 的回應會不會長得跟消費版一樣。
   */
  function findMessageList(root, maxDepth = 6) {
    const seen = new Set();
    let best = null;

    // 實測中被 EventListener/telemetry 回應誤判成「一則訊息」：那類回應也常有
    // 一個看起來像 author/content 的欄位，所以除了形狀，還要求有 id 或時間戳
    // 這種訊息才會有的欄位，降低誤判機率。
    const hasMessageIdentity = (item) =>
      'messageId' in item ||
      'id' in item ||
      'createdAt' in item ||
      'timestamp' in item ||
      'create_time' in item;

    const isMessage = (item) =>
      !!item &&
      typeof item === 'object' &&
      (item.author || item.sender || item.role) &&
      (Array.isArray(item.content) || typeof item.content === 'string' || 'text' in item) &&
      hasMessageIdentity(item);

    // 已知的 telemetry / event-listener key：底下不管形狀多像都不要當成對話內容
    // （實測到 EventListener/Client?EventId=ExecuteAction 的 result 欄位誤判過一次）。
    const SKIP_KEYS = new Set(['telemetry', 'instrumentation', 'diagnostics']);

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
      for (const [key, value] of Object.entries(node)) {
        if (SKIP_KEYS.has(key)) continue;
        walk(value, depth + 1);
      }
    };

    walk(root, 0);
    return best;
  }

  /** [{ url, data, messages }]，最新的排最後。 */
  const captured = [];
  /** 每一個攔到的 JSON 都記一筆（不含內容），供 Copy Diagnostics 用。 */
  const diagnostics = [];
  const DIAGNOSTICS_LIMIT = 100;

  // 實測中撞到一個扁平的 i18n 字典回應，Object.keys() 有上千個 key，
  // 整份 Copy Diagnostics 因此爆量。這裡只留前 N 個 key + 總數。
  const DIAGNOSTICS_KEYS_LIMIT = 20;

  function rememberDiagnostics(url, status, json) {
    const allKeys = json && typeof json === 'object' ? Object.keys(json) : [];
    diagnostics.push({
      url,
      status,
      keys: allKeys.slice(0, DIAGNOSTICS_KEYS_LIMIT),
      keyCount: allKeys.length,
      at: new Date().toISOString(),
    });
    if (diagnostics.length > DIAGNOSTICS_LIMIT) diagnostics.shift();
  }

  // 已知只是 telemetry / event-listener 回應的 URL：形狀再像也不當成對話內容
  // （實測到 EventListener/Client?EventId=ExecuteAction 被誤判成一則訊息）。
  const NON_CONVERSATION_URL_RE = /EventListener|OneCollector|\/events(\?|$)/i;

  function rememberPayload(url, status, payload) {
    rememberDiagnostics(url, status, payload);
    if (NON_CONVERSATION_URL_RE.test(url)) return;
    const messages = findMessageList(payload);
    if (!messages) return;
    captured.push({ url, data: payload, messages });
    log('captured conversation:', url, `${messages.length} messages`);
  }

  function installFetchCapture() {
    const originalFetch = pageWin.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__m365ExportPatched) return;

    const patched = function (...args) {
      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input?.url || '';
          if (!/json/.test(response.headers.get('content-type') || '')) return response;
          // body 只能讀一次，一定要 clone，否則網站自己就讀不到了。
          response
            .clone()
            .json()
            .then((json) => rememberPayload(url, response.status, json))
            .catch(() => {});
        } catch {
          /* 攔截失敗不能影響網站本身 */
        }
        return response; // 一定要把原本的 response 還回去
      });
    };
    patched.__m365ExportPatched = true;
    pageWin.fetch = patched;
  }

  /** 有些請求可能走 XHR，所以兩種都要攔（跟 copilot-export-markdown 一致）。 */
  function installXhrCapture() {
    const XHR = pageWin.XMLHttpRequest;
    if (!XHR || XHR.prototype.__m365ExportPatched) return;

    const { open, send } = XHR.prototype;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__m365ExportUrl = String(url || '');
      return open.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const contentType = this.getResponseHeader('content-type') || '';
          if (!/json/.test(contentType)) return;
          const raw =
            this.responseType === '' || this.responseType === 'text'
              ? this.responseText
              : this.response;
          const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
          rememberPayload(this.__m365ExportUrl || '', this.status, json);
        } catch {
          /* 不是 JSON 就算了 */
        }
      });
      return send.apply(this, args);
    };

    XHR.prototype.__m365ExportPatched = true;
  }

  // --------------------------------------------- 來源 2：登入中歷史紀錄的 fallback
  //
  // 只覆蓋「登入中查看自己的對話」這個情境，share 連結目前沒有已知的直接呼叫方式，
  // 所以這條路不會對 share 連結生效（見 resolveConversation）。

  function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    return Uint8Array.from(binary, (ch) => ch.codePointAt(0));
  }

  function getCookie(name) {
    const match = document.cookie.match(`(^|;)\\s*${name}\\s*=\\s*([^;]+)`);
    return match ? decodeURIComponent(match.pop()) : '';
  }

  function getMsalAccount() {
    const raw = pageWin.localStorage.getItem('msal.3.account.keys');
    if (!raw)
      throw new Error(
        '沒有 MSAL 帳號 key（msal.3.account.keys）——可能沒有登入，或 MSAL cache 版本不是 msal.3'
      );
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('MSAL 帳號 key 是空的');
    const [homeAccountId, , tenantId] = keys[0].split('|');
    const [localAccountId] = homeAccountId.split('.');
    return { localAccountId, tenantId, homeAccountId, clientId: MSAL_CLIENT_ID };
  }

  async function getEncryptionCookie() {
    const cookieValue = getCookie('msal.cache.encryption');
    if (!cookieValue) throw new Error('沒有 msal.cache.encryption cookie，解不了 token cache');
    const parsed = JSON.parse(cookieValue);
    if (!parsed.key) throw new Error('msal.cache.encryption cookie 格式不對（缺 key）');
    const baseKey = await pageWin.crypto.subtle.importKey(
      'raw',
      base64UrlDecode(parsed.key).buffer,
      'HKDF',
      false,
      ['deriveKey']
    );
    return baseKey;
  }

  /** HKDF 衍生金鑰 → AES-GCM 解密，演算法照 ganyuke/copilot-exporter 反推的結果。 */
  async function decryptMsalToken(baseKey, nonce, context, ciphertext) {
    const derivedKey = await pageWin.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: base64UrlDecode(nonce).buffer,
        hash: 'SHA-256',
        info: new TextEncoder().encode(context),
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const decrypted = await pageWin.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12) },
      derivedKey,
      base64UrlDecode(ciphertext).buffer
    );
    return new TextDecoder().decode(decrypted);
  }

  async function getMsalAccessToken(msalIds) {
    const baseKey = await getEncryptionCookie();
    const tokenKeysRaw = pageWin.localStorage.getItem(`msal.3.token.keys.${msalIds.clientId}`);
    if (!tokenKeysRaw) throw new Error(`沒有 msal.3.token.keys.${msalIds.clientId}`);
    const tokenKeys = JSON.parse(tokenKeysRaw);
    const scopedKey = (tokenKeys.accessToken || []).find((key) => key.includes(MSAL_TOKEN_SCOPE));
    if (!scopedKey) throw new Error(`token cache 裡沒有 scope 含 ${MSAL_TOKEN_SCOPE} 的 token`);
    const entryRaw = pageWin.localStorage.getItem(scopedKey);
    if (!entryRaw) throw new Error('對應的 token cache entry 不見了');
    const entry = JSON.parse(entryRaw);
    const decrypted = await decryptMsalToken(baseKey, entry.nonce, msalIds.clientId, entry.data);
    return JSON.parse(decrypted).secret;
  }

  async function fromLoggedInHistory(conversationId) {
    if (!conversationId) return null;
    let msalIds;
    let token;
    try {
      msalIds = getMsalAccount();
      token = await getMsalAccessToken(msalIds);
    } catch (error) {
      log('MSAL fallback unavailable:', error.message);
      return null;
    }

    const requestObj = { conversationId, source: 'officeweb', traceId: crypto.randomUUID() };
    const url = `https://substrate.office.com/m365Copilot/GetConversation?request=${encodeURIComponent(JSON.stringify(requestObj))}`;
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-anchormailbox': `Oid:${msalIds.localAccountId}@${msalIds.tenantId}`,
      'x-scenario': 'OfficeWebIncludedCopilot',
    };

    try {
      const res = await fetch(url, { headers });
      const json = await res.json();
      rememberDiagnostics(url, res.status, json);
      if (!res.ok) {
        log('GetConversation fallback failed:', res.status);
        return null;
      }
      const messages = findMessageList(json);
      return messages ? { url, data: json, messages } : null;
    } catch (error) {
      log('GetConversation fallback threw:', error.message);
      return null;
    }
  }

  // ------------------------------------------------------------ 來源總調度

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** `/chat/share/<base64url(JSON)>` → { shareId, conversationId }。 */
  function decodeShareParam(param) {
    try {
      return JSON.parse(new TextDecoder().decode(base64UrlDecode(decodeURIComponent(param))));
    } catch {
      return null;
    }
  }

  function currentIds() {
    const share = location.pathname.match(/\/chat\/share\/([^/?#]+)/);
    if (share) {
      const decoded = decodeShareParam(share[1]);
      if (decoded)
        return { shareId: decoded.shareId || null, conversationId: decoded.conversationId || null };
    }
    // 真實 URL 長這樣：/chat/conversation/<uuid>（之前只認得 /chat/share/<...>，
    // 使用者實測後發現這條沒被認到，conversationId 一直是 null）。
    const conversation = location.pathname.match(/\/chat\/conversation\/([^/?#]+)/);
    if (conversation) return { shareId: null, conversationId: conversation[1] };
    return { shareId: null, conversationId: null };
  }

  function shareIdFromUrl(input) {
    const match = String(input).match(/\/chat\/share\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function pickCaptured(ids) {
    if (ids.conversationId) {
      for (let i = captured.length - 1; i >= 0; i--) {
        if (captured[i].url.includes(ids.conversationId)) return captured[i];
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

  async function resolveConversation(ids) {
    const hit = pickCaptured(ids) || (await waitForCapture(ids));
    if (hit) return { ...hit, source: 'network-capture' };

    // fallback 只覆蓋「登入中的歷史紀錄」，share 連結沒有已知的直接呼叫方式。
    if (!ids.shareId && ids.conversationId) {
      const api = await fromLoggedInHistory(ids.conversationId);
      if (api) return { ...api, source: 'api (未實測)' };
    }

    throw new Error(
      '抓不到對話資料。這支腳本是實驗性的——請按 "Copy Diagnostics" 把結果回報，' +
        '再確認已登入、對話已載完、重新整理這一頁試一次。'
    );
  }

  // ------------------------------------------------------------ 轉成 Markdown

  function roleOf(message) {
    const raw = message.author?.type || message.author || message.sender || message.role || '';
    const type = String(raw);
    if (/human|user/i.test(type)) return 'User';
    if (/^(ai|bot|assistant|copilot)$/i.test(type)) return 'Assistant';
    return type ? type[0].toUpperCase() + type.slice(1) : 'Unknown';
  }

  const CITATION_MARKER_RE = /【([^】]+)】/g;

  /**
   * citation 藏在 adaptiveCards[0].body[0].text 裡的『【key】』marker，
   * 對照 references[key]（targetLink 是 URL，displayData.content 是含 label/Title 的
   * JSON 字串）。查證來源：ganyuke/copilot-exporter。
   */
  function resolveAdaptiveCardBody(message) {
    const cardText = message.adaptiveCards?.[0]?.body?.[0]?.text;
    if (typeof cardText !== 'string') return null;

    const references = message.references || {};
    const citations = [];
    const rewritten = cardText.replace(CITATION_MARKER_RE, (whole, key) => {
      const ref = references[key];
      if (!ref?.targetLink) return whole;
      let title = '';
      try {
        title = JSON.parse(ref.displayData?.content || '{}')?.Title || '';
      } catch {
        /* 拿不到 Title 就用 URL 當標題 */
      }
      citations.push({ url: ref.targetLink, title });
      return '';
    });

    const sources = sourcesBlock(citations);
    return sources ? `${rewritten}\n\n${sources}` : rewritten;
  }

  function partToText(part, opts) {
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
      default:
        if (!opts.includeTools) return '';
        return `**${part.type || 'part'}**\n\n${jsonFence(part)}`;
    }
  }

  function messageToBody(message, opts) {
    // 優先用 adaptive card（citation 都在那裡），沒有就退回 content[] 或 text。
    const cardBody = resolveAdaptiveCardBody(message);
    if (cardBody) return cardBody;

    if (Array.isArray(message.content)) {
      const texts = message.content.map((part) => partToText(part, opts)).filter(Boolean);
      if (texts.length > 0) return texts.join('\n\n');
    }

    if (typeof message.text === 'string' && message.text.trim()) return message.text;

    // 完全辨認不出的形狀：留 JSON fence，不要靜默丟掉。
    return jsonFence(message);
  }

  /** 標題可能藏在哪一層不確定，優先找已知的 chatName，其次往下找兩層。 */
  function pickTitle(data) {
    if (typeof data.chatName === 'string' && data.chatName.trim()) return data.chatName;
    const keys = ['title', 'conversationTitle', 'name'];
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
    return look(data, 0) || 'M365 Copilot conversation';
  }

  function normalize(hit, ctx, opts) {
    const messages = [...hit.messages].sort((a, b) => {
      const at = new Date(a.createdAt || a.timestamp || 0).getTime() || 0;
      const bt = new Date(b.createdAt || b.timestamp || 0).getTime() || 0;
      return at - bt;
    });

    const sections = messages
      .map((message) => ({
        role: roleOf(message),
        model: '',
        time: message.createdAt || message.timestamp,
        body: messageToBody(message, opts),
      }))
      .filter((section) => section.body.trim());

    return {
      source: 'm365-copilot',
      sourceLabel: 'Microsoft 365 Copilot Chat',
      title: pickTitle(hit.data),
      url: ctx.url,
      ids: { conversation_id: ctx.conversationId || '', share_id: ctx.shareId || '' },
      model: '',
      createdAt: hit.data.createTimeUtc || messages[0]?.createdAt || messages[0]?.timestamp,
      sections,
    };
  }

  // ------------------------------------------------------------------ 動作

  async function doExport({ mode, to, ids }) {
    ui.setStatus('讀取對話…');
    try {
      const target = ids || currentIds();
      const hit = await resolveConversation(target);
      const url = target.shareId ? location.href : location.href;

      const doc = normalize(hit, { ...target, url }, settings);
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

  function copyDiagnostics() {
    if (diagnostics.length === 0) {
      GM_setClipboard('（這次頁面存活期間沒有攔到任何 JSON 回應）', 'text');
      ui.setStatus('沒有攔到任何 JSON 回應——把這個結果回報也是有用的資訊。');
      return;
    }
    const lines = diagnostics.map((entry) => {
      const more = entry.keyCount > entry.keys.length ? `, …+${entry.keyCount - entry.keys.length} more` : '';
      return `${entry.at}  ${entry.status}  ${entry.url}\n  keys (${entry.keyCount}): [${entry.keys.join(', ')}${more}]`;
    });
    const report = [
      `${EXPORTER} diagnostics`,
      `page: ${location.href}`,
      `captured ${diagnostics.length} JSON response(s):`,
      '',
      ...lines,
    ].join('\n');
    GM_setClipboard(report, 'text');
    ui.setStatus(`已複製 ${diagnostics.length} 筆 diagnostics，麻煩回報給開發者。`);
  }

  /** share 連結需要登入才看得到內容，且目前沒有已知的就地重打 API 方式，一律開新分頁。 */
  function exportFromShareUrl(raw) {
    const shareId = shareIdFromUrl(raw);
    if (!shareId) {
      ui.setStatus('這不像 share 連結（要有 /chat/share/<id>）。');
      return;
    }
    if (shareId === currentIds().shareId) {
      doExport({ mode: 'transcript', to: 'clipboard' });
      return;
    }
    GM_setValue(PENDING_KEY, { shareId, expires: Date.now() + 120_000 });
    GM_openInTab(new URL(`/chat/share/${shareId}`, location.origin).href, { active: true });
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
    { label: 'Copy Diagnostics', run: copyDiagnostics },
  ];

  // -------------------------------------------------------------------- UI

  const ui = createExportPanel({
    ns: NS,
    buttonLabel: '⇩ Export MD (實驗性)',
    buttonTitle: '實驗性腳本：如果失敗，請先按 Copy Diagnostics 回報',
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
      placeholder: '貼上任意 share 連結…',
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
      const raw = prompt('貼上 M365 Copilot Chat share 連結：');
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
