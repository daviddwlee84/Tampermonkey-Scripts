// ==UserScript==
// @name         Claude Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      1.1.1
// @description  把整段 Claude 對話（含 Claude Code on the web session）匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用
// @author       Da-Wei Lee
// @license      MIT
// @match        https://claude.ai/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgxNTMgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkNFPC90ZXh0Pjwvc3ZnPg==
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
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/claude-export-markdown/claude-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/claude-export-markdown/claude-export-markdown.user.js
// ==/UserScript==

/* global createExportPanel, downloadText, filenameFor, jsonFence, renderTranscript, sourcesBlock */

/**
 * 把一整段 Claude 對話匯成 Markdown，格式跟 chatgpt-export-markdown 一致
 * （SpecStory 風格的 `_**User (ts)**_` / `---` / `_**Assistant**_`），目的是貼給 coding agent。
 *
 * 為什麼只有「攔截」這一條路（實測結果，不要照 ChatGPT 那支的四層 fallback 抄）：
 *
 * 1. share 頁在載入時只打一次 `/api/chat_snapshots/<id>?rendering_mode=messages&render_all_tools=true`，
 *    回來的 JSON 就是完整對話（`chat_messages[]`，裡面是模型吐出的 raw markdown）。
 * 2. **同一個 endpoint 再打第二次一律被 Cloudflare 擋 403**（同頁 fetch、別的分頁 fetch、
 *    同源 iframe 載入 share 頁全部試過）。只有頁面自己那一次會過。
 * 3. 頁面上也沒有留副本：TanStack Router 的 match 沒有 loaderData、
 *    `__PUBLIC_VIEWER_PRELOAD__.responses[url]` 在 hydration 後就被清掉、
 *    React Query 的 cache 關在 module closure 裡。
 *
 * 所以：`@run-at document-start` 攔 `fetch`，接住頁面自己那一次成功的回應。
 * 攔不到就明白報錯叫使用者重新整理，**不要退回去 scrape DOM**——
 * 殘缺的 transcript 比沒有 transcript 更糟，agent 不會知道少了什麼。
 */
(function () {
  'use strict';

  const VERSION = '1.1.1';
  const NS = 'claude-export-md';
  const EXPORTER = `claude-export-markdown v${VERSION}`;
  const LOG_PREFIX = '[claude-export-markdown]';
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

  // ------------------------------------------------- 來源：攔截網站自己的請求

  /** id（snapshot uuid / conversation uuid）-> 對話 JSON。 */
  const captured = new Map();
  let lastCaptured = null;

  // share 頁走 chat_snapshots，登入中的 /chat/<uuid> 走 chat_conversations。
  const CAPTURE_URL = /\/api\/(chat_snapshots\/|organizations\/[^/]+\/chat_conversations\/)/;

  function looksLikeConversation(value) {
    return !!value && typeof value === 'object' && Array.isArray(value.chat_messages);
  }

  function rememberPayload(payload) {
    const data = looksLikeConversation(payload?.data) ? payload.data : payload;
    if (!looksLikeConversation(data)) return;
    for (const id of [data.uuid, data.conversation_uuid]) {
      if (id) captured.set(id, data);
    }
    lastCaptured = data;
    log(
      'captured conversation:',
      data.uuid || '(no uuid)',
      `${data.chat_messages.length} messages`
    );
  }

  // ------------------------------------- 來源：Claude Code on the web（/code/session_…）

  /**
   * Claude Code web 不走 chat_conversations，而是 `/v1/...sessions...` 系列 API，
   * 內容是 Claude Code SDK message（`type: user|assistant|system|result`）。
   * endpoint 與分頁欄位沒有文件，所以這裡刻意寫得寬鬆：
   * 只要 `/v1/` 回應裡找得到 SDK message 陣列就收，並把每個 `/v1/` 回應的形狀印到 console，
   * 改版時看 log 就知道該怎麼調。
   */
  const V1_URL = /^(?:https:\/\/(?:claude\.ai|api\.anthropic\.com))?\/v1\//;
  const SESSION_ID_RE = /session_[0-9A-Za-z]+/;

  /** session id -> { meta, events: Map<key, event>, urls: Set<string> } */
  const codeSessions = new Map();
  /** 頁面自己打 `/v1/` 時帶的 header（anthropic-version、org id 之類），重放用。 */
  let v1Headers = null;

  function codeSessionEntry(id) {
    if (!codeSessions.has(id)) {
      codeSessions.set(id, { meta: null, events: new Map(), urls: new Set() });
    }
    return codeSessions.get(id);
  }

  function headersToObject(init) {
    const out = {};
    try {
      if (!init) return out;
      const list = typeof init.forEach === 'function' && !Array.isArray(init) ? init : null;
      if (list) list.forEach((value, name) => (out[name.toLowerCase()] = String(value)));
      else if (Array.isArray(init)) for (const [n, v] of init) out[String(n).toLowerCase()] = String(v);
      else for (const [n, v] of Object.entries(init)) out[n.toLowerCase()] = String(v);
    } catch {
      /* header 拿不到就算了 */
    }
    delete out['content-type'];
    delete out['content-length'];
    return out;
  }

  function rememberV1Headers(url, init) {
    if (!V1_URL.test(url)) return;
    const headers = headersToObject(init);
    if (Object.keys(headers).length) v1Headers = headers;
  }

  /** 這個物件是不是一則 SDK message（可能被包在 `payload` / `data` / `event` 裡）。 */
  function unwrapEvent(item) {
    for (const candidate of [item, item?.payload, item?.data, item?.event, item?.message_data]) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        ['user', 'assistant', 'system', 'result'].includes(candidate.type) &&
        (candidate.message || candidate.type === 'system' || candidate.type === 'result')
      ) {
        return candidate;
      }
    }
    return null;
  }

  function findEventList(payload) {
    const candidates = Array.isArray(payload)
      ? [payload]
      : [payload?.data, payload?.events, payload?.messages, payload?.items, payload?.results];
    for (const list of candidates) {
      if (Array.isArray(list) && list.some((item) => unwrapEvent(item))) return list;
    }
    return null;
  }

  function eventKey(raw, event) {
    return (
      event.uuid ||
      raw.uuid ||
      raw.id ||
      (event.message?.id && `${event.message.id}:${JSON.stringify(event.message.content)}`) ||
      JSON.stringify(event)
    );
  }

  function shapeOf(value) {
    if (Array.isArray(value)) return `array(${value.length})`;
    if (!value || typeof value !== 'object') return typeof value;
    const keys = Object.keys(value).slice(0, 12).join(',');
    const list = findEventList(value) || value.data;
    const first = Array.isArray(list) && list[0] && typeof list[0] === 'object'
      ? ` first{${Object.keys(list[0]).slice(0, 12).join(',')}}`
      : '';
    return `{${keys}}${first}`;
  }

  function mergeCodeEvents(id, list) {
    const entry = codeSessionEntry(id);
    for (const raw of list) {
      const event = unwrapEvent(raw);
      if (!event) continue;
      const ts = event.timestamp || raw.created_at || raw.timestamp;
      entry.events.set(eventKey(raw, event), ts && !event.timestamp ? { ...event, timestamp: ts } : event);
    }
    log('captured code session:', id, `${entry.events.size} events`);
  }

  function rememberV1Payload(url, status, payload) {
    log('v1 response:', url.replace(/^https:\/\/claude\.ai/, ''), status, shapeOf(payload));
    if (status < 200 || status >= 300) return;
    const id = url.match(SESSION_ID_RE)?.[0] || currentIds().codeSessionId;
    if (!id) return;

    const list = findEventList(payload);
    if (list) {
      codeSessionEntry(id).urls.add(url);
      mergeCodeEvents(id, list);
      return;
    }
    // 不是 event 清單、但 id 對得上的物件，當成 session metadata（標題等）。
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.id === id) {
      codeSessionEntry(id).meta = payload;
    }
  }

  /** 讀 body 但不碰串流（SSE / watch），否則 clone 會一直掛著。 */
  function readJsonBody(text) {
    try {
      return JSON.parse(text);
    } catch {
      // NDJSON：一行一個 event
      const lines = text.split('\n').filter((line) => line.trim());
      const items = [];
      for (const line of lines) {
        try {
          items.push(JSON.parse(line));
        } catch {
          return null;
        }
      }
      return items.length ? items : null;
    }
  }

  function inspectResponse(url, response) {
    if (response.ok && CAPTURE_URL.test(url)) {
      // body 只能讀一次，一定要 clone，否則網站自己就讀不到了。
      response
        .clone()
        .json()
        .then(rememberPayload)
        .catch(() => {});
      return;
    }
    if (!V1_URL.test(url)) return;
    const type = response.headers.get('content-type') || '';
    if (/event-stream/.test(type)) {
      log('v1 stream (not captured):', url, type);
      return;
    }
    response
      .clone()
      .text()
      .then((text) => {
        const payload = readJsonBody(text);
        if (payload !== null) rememberV1Payload(url, response.status, payload);
      })
      .catch(() => {});
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function installNetworkCapture() {
    const originalFetch = pageWin.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__claudeExportPatched) return;

    const patched = function (...args) {
      const input = args[0];
      const url = urlOf(input);
      try {
        // Request 物件的 header 掛在自己身上，否則看第二個參數的 init.headers。
        rememberV1Headers(url, args[1]?.headers || input?.headers);
      } catch {
        /* 攔截失敗不能影響網站本身 */
      }
      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        try {
          inspectResponse(url, response);
        } catch {
          /* 攔截失敗不能影響網站本身 */
        }
        return response; // 一定要把原本的 response 還回去
      });
    };
    patched.__claudeExportPatched = true;
    pageWin.fetch = patched;
  }

  /** Claude Code web 的部分請求可能走 XHR（axios），所以兩種都攔。 */
  function installXhrCapture() {
    const XHR = pageWin.XMLHttpRequest;
    if (!XHR || XHR.prototype.__claudeExportPatched) return;

    const { open, send, setRequestHeader } = XHR.prototype;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__claudeExportUrl = String(url || '');
      this.__claudeExportHeaders = {};
      return open.call(this, method, url, ...rest);
    };

    // XHR 的 header 是一個一個設的，得自己累積起來。
    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        if (this.__claudeExportHeaders) {
          this.__claudeExportHeaders[String(name).toLowerCase()] = String(value);
        }
      } catch {
        /* 攔截失敗不能影響網站本身 */
      }
      return setRequestHeader.call(this, name, value);
    };

    XHR.prototype.send = function (...args) {
      try {
        const url = this.__claudeExportUrl || '';
        rememberV1Headers(url, this.__claudeExportHeaders);
        if (V1_URL.test(url) || CAPTURE_URL.test(url)) {
          this.addEventListener('load', () => {
            try {
              const raw =
                this.responseType === '' || this.responseType === 'text'
                  ? this.responseText
                  : this.responseType === 'json'
                    ? JSON.stringify(this.response)
                    : null;
              if (typeof raw !== 'string') return;
              const payload = readJsonBody(raw);
              if (payload === null) return;
              if (CAPTURE_URL.test(url)) {
                if (this.status >= 200 && this.status < 300) rememberPayload(payload);
              } else {
                rememberV1Payload(url, this.status, payload);
              }
            } catch {
              /* 讀不到就算了 */
            }
          });
        }
      } catch {
        /* 同上 */
      }
      return send.apply(this, args);
    };

    XHR.prototype.__claudeExportPatched = true;
  }

  // ------------------------------------------------------- 來源：自己打 API

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 頁面自己的請求是 async 的，剛載入就按按鈕會撲空 —— 給它一點時間。 */
  async function waitForCapture(ids, { timeout = 8_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = pickCaptured(ids);
      if (hit) return hit;
      if (Date.now() >= deadline) return null;
      await delay(interval);
    }
  }

  function pickCaptured({ convId, shareId }) {
    if (shareId && captured.has(shareId)) return captured.get(shareId);
    if (convId && captured.has(convId)) return captured.get(convId);
    if (!convId && !shareId && captured.size === 1) return lastCaptured;
    return null;
  }

  /**
   * 自己打一次 API。登入中的 /chat/<uuid> 這條實測可行；
   * share 那條幾乎一定會被 Cloudflare 403 —— 還是留著，因為它不花什麼成本，
   * 而且不同網路環境的 CF 判定不一樣。
   */
  async function fromApi({ convId, shareId }) {
    const paths = [];
    if (shareId) {
      paths.push(`/api/chat_snapshots/${shareId}?rendering_mode=messages&render_all_tools=true`);
    }
    if (convId) {
      const orgId = await currentOrgId();
      if (orgId) {
        paths.push(
          `/api/organizations/${orgId}/chat_conversations/${convId}` +
            '?tree=True&rendering_mode=messages&render_all_tools=true'
        );
      }
    }

    for (const path of paths) {
      try {
        const res = await fetch(path, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        if (!res.ok) {
          log('api fallback failed:', path, res.status);
          continue;
        }
        const json = await res.json();
        const data = looksLikeConversation(json?.data) ? json.data : json;
        if (looksLikeConversation(data)) return data;
      } catch (error) {
        log('api fallback threw:', error.message);
      }
    }
    return null;
  }

  async function currentOrgId() {
    try {
      const res = await fetch('/api/organizations', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const list = await res.json();
      return Array.isArray(list) ? list[0]?.uuid || null : null;
    } catch {
      return null;
    }
  }

  /**
   * Claude Code session 自己補打。endpoint 沒文件，所以依序試幾個候選，
   * 每個的 status 都印出來（失敗時這就是除錯線索）。events 會沿分頁游標走到底——
   * 攔截可能只接到最近一頁，長 session 不補齊就會少前半段。
   */
  async function fromCodeSessionApi(id) {
    const headers = { accept: 'application/json', ...(v1Headers || {}) };
    const get = async (path) => {
      try {
        const res = await pageWin.fetch(path, { credentials: 'include', headers });
        const text = await res.text();
        const payload = readJsonBody(text);
        if (!res.ok) log('code session api failed:', path, res.status, text.slice(0, 200));
        return { ok: res.ok, payload };
      } catch (error) {
        log('code session api threw:', path, error.message);
        return { ok: false, payload: null };
      }
    };

    const entry = codeSessionEntry(id);
    if (!entry.meta) {
      for (const path of [`/v1/sessions/${id}`, `/v1/code/sessions/${id}`]) {
        const { ok, payload } = await get(path);
        if (ok && payload && !Array.isArray(payload)) {
          entry.meta = payload;
          break;
        }
      }
    }

    for (const base of [`/v1/sessions/${id}/events`, `/v1/code/sessions/${id}/events`]) {
      let cursor = null;
      let gotAny = false;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ limit: '1000' });
        if (cursor) query.set('after_id', cursor);
        const { ok, payload } = await get(`${base}?${query}`);
        const list = ok ? findEventList(payload) : null;
        if (!list) break;
        // 攔截那層的合併是 async 的，這裡直接併進去，不要等它（重複的會被 key 去重）。
        mergeCodeEvents(id, list);
        gotAny = true;
        const next = payload?.has_more ? payload.last_id || payload.next_page || null : null;
        if (!next || next === cursor) break;
        cursor = next;
      }
      if (gotAny) break;
    }
    return entry.events.size ? entry : null;
  }

  // ------------------------------------------------------------ 來源總調度

  function currentIds() {
    const chat = location.pathname.match(/\/chat\/([0-9a-zA-Z-]+)/);
    const share = location.pathname.match(/^\/share\/([0-9a-zA-Z-]+)/);
    const code = location.pathname.match(/^\/code\/(session_[0-9A-Za-z]+)/);
    return {
      convId: chat?.[1] || null,
      shareId: share?.[1] || null,
      codeSessionId: code?.[1] || null,
    };
  }

  function shareIdFromUrl(input) {
    const match = String(input).match(/\/share\/([0-9a-zA-Z-]+)/);
    return match ? match[1] : null;
  }

  async function resolveCodeSession(id) {
    const seen = codeSessions.get(id);
    // 攔到的可能只是部分頁，先試著補齊；補不到就用攔到的。
    const full = (await fromCodeSessionApi(id)) || (seen?.events.size ? seen : null);
    if (full) {
      return {
        data: { kind: 'claude-code-session', session_id: id, meta: full.meta, events: sortedEvents(full) },
        source: full.urls.size ? 'network-capture' : 'api',
      };
    }
    throw new Error(
      '抓不到 Claude Code session 的 events。請開 DevTools console 看 ' +
        `${LOG_PREFIX} 開頭的 v1 response / api failed 紀錄（回報時請附上）。`
    );
  }

  async function resolveConversation(ids) {
    if (ids.codeSessionId) return resolveCodeSession(ids.codeSessionId);
    if (!ids.convId && !ids.shareId && captured.size === 0) {
      throw new Error('這一頁不是對話頁（支援 /chat/<id>、/share/<id>、/code/session_<id>）。');
    }

    const hit = pickCaptured(ids) || (await waitForCapture(ids));
    if (hit) return { data: hit, source: 'network-capture' };

    const api = await fromApi(ids);
    if (api) return { data: api, source: 'api' };

    throw new Error(
      '抓不到對話資料。Claude 只放行頁面自己的第一次請求 —— 請重新整理這一頁再按一次。'
    );
  }

  // ------------------------------------------------------------ 轉成 Markdown

  /**
   * 取出目前這條 branch。snapshot 幾乎都是線性的（照 index 排就好），
   * 但登入中的 `?tree=True` 會把編輯／重生過的分支一起送來 ——
   * 那時就從最後一則沿 parent_message_uuid 往回走。
   */
  function buildThread(data) {
    const messages = (data.chat_messages || []).filter(Boolean);
    if (messages.length === 0) return [];

    const parentCount = new Map();
    for (const message of messages) {
      const parent = message.parent_message_uuid;
      parentCount.set(parent, (parentCount.get(parent) || 0) + 1);
    }
    const branched = [...parentCount.values()].some((count) => count > 1);
    const byIndex = [...messages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!branched) return byIndex;

    const byUuid = new Map(messages.map((message) => [message.uuid, message]));
    const thread = [];
    const guard = new Set();
    let cursor = byIndex[byIndex.length - 1];
    while (cursor && !guard.has(cursor.uuid)) {
      guard.add(cursor.uuid);
      thread.push(cursor);
      cursor = byUuid.get(cursor.parent_message_uuid);
    }
    return thread.reverse();
  }

  /** citation 的欄位名在不同型態下不太一樣，能拿到 url 就算數。 */
  function citationTargets(block) {
    return (block.citations || [])
      .map((citation) => {
        const details = citation.details || citation.metadata || citation;
        return {
          url: details.url || citation.url || '',
          title: details.title || citation.title || '',
        };
      })
      .filter((citation) => citation.url);
  }

  function thinkingText(block) {
    if (typeof block.thinking === 'string' && block.thinking.trim()) return block.thinking;
    if (Array.isArray(block.summaries)) {
      const summaries = block.summaries
        .map((item) => item?.summary || item?.text || '')
        .filter(Boolean);
      if (summaries.length) return summaries.join('\n\n');
    }
    return String(block.text ?? '');
  }

  /** tool_result 的 content 可能是字串、`[{type:'text', text}]`，或整包結構化資料。 */
  function toolResultText(block) {
    const content = block.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const texts = content
        .map((item) => (typeof item === 'string' ? item : item?.text || ''))
        .filter(Boolean);
      if (texts.length) return texts.join('\n\n');
    }
    return jsonFence(block.structured_content ?? content ?? block.message ?? null);
  }

  function blockToText(block, opts) {
    if (!block || typeof block !== 'object') return '';

    switch (block.type) {
      case 'text': {
        const body = String(block.text ?? '');
        const sources = sourcesBlock(citationTargets(block));
        return sources ? `${body}\n\n${sources}` : body;
      }
      case 'thinking':
        return opts.includeThinking ? thinkingText(block) : '';
      case 'tool_use': {
        if (!opts.includeTools) return '';
        const name = block.name || 'tool';
        const input = block.input ?? block.message ?? null;
        return input === null
          ? `**Tool call: ${name}**`
          : `**Tool call: ${name}**\n\n${jsonFence(input)}`;
      }
      case 'tool_result': {
        if (!opts.includeTools) return '';
        return `**Tool result: ${block.name || 'tool'}**\n\n${toolResultText(block)}`;
      }
      default:
        // 未知型態（Claude 一直在加新的 block）不靜默丟掉，寧可留 JSON。
        if (typeof block.text === 'string' && block.text.trim()) return block.text;
        return jsonFence(block);
    }
  }

  function attachmentLines(message) {
    const names = [
      ...(message.attachments || []).map((item) => item?.file_name || item?.name),
      ...(message.files || []).map((item) => item?.file_name || item?.name),
    ].filter(Boolean);
    return names.length ? `**附件**\n\n${names.map((name) => `- ${name}`).join('\n')}` : '';
  }

  function messageToBody(message, opts) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const parts = blocks.map((block) => blockToText(block, opts)).filter((text) => text.trim());
    // 舊格式（或 rendering_mode 不同時）只有 message.text。
    if (parts.length === 0 && typeof message.text === 'string' && message.text.trim()) {
      parts.push(message.text);
    }
    const attachments = attachmentLines(message);
    if (attachments) parts.unshift(attachments);
    return parts.join('\n\n');
  }

  function roleOf(message) {
    return message.sender === 'human' ? 'User' : 'Assistant';
  }

  function normalize(data, ctx, opts) {
    const sections = buildThread(data)
      .map((message) => ({
        role: roleOf(message),
        model: message.sender === 'human' ? '' : message.model || '',
        time: message.created_at,
        body: messageToBody(message, opts),
      }))
      .filter((section) => section.body.trim());

    const isSnapshot = Boolean(data.conversation_uuid);
    return {
      source: 'claude',
      sourceLabel: 'Claude',
      title: data.snapshot_name || data.name || 'Claude conversation',
      url: ctx.url,
      ids: {
        conversation_id: data.conversation_uuid || data.uuid || '',
        snapshot_id: isSnapshot ? data.uuid || '' : '',
      },
      model: data.model || '',
      createdAt: data.created_at,
      sections,
    };
  }

  // ------------------------------------------ Claude Code session → Markdown

  const toMillis = (value) => {
    const time = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
    return Number.isFinite(time) ? time : null;
  };

  /** 有時間戳就照時間排（穩定排序，同時間保留收到的順序），否則照收到的順序。 */
  function sortedEvents(entry) {
    const events = [...entry.events.values()];
    if (!events.every((event) => toMillis(event.timestamp) !== null)) return events;
    return events
      .map((event, order) => ({ event, order, time: toMillis(event.timestamp) }))
      .sort((a, b) => a.time - b.time || a.order - b.order)
      .map((item) => item.event);
  }

  function contentBlocks(message) {
    const content = message?.content;
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    return Array.isArray(content) ? content : [];
  }

  function blocksText(blocks, opts) {
    return blocks
      .map((block) => blockToText(block, opts))
      .filter((text) => text.trim())
      .join('\n\n');
  }

  /**
   * SDK message → section：
   * - user 的文字是 User；只含 tool_result 的 user event 其實是工具輸出，歸到 Assistant 側
   * - `parent_tool_use_id` 有值的是 subagent 內部對話，當成工具細節
   * - system / result 是 session 控制訊息，不進 transcript
   */
  function codeEventToSection(event, opts) {
    if (event.type !== 'user' && event.type !== 'assistant') return null;
    if (event.isMeta) return null;
    if (event.parent_tool_use_id && !opts.includeTools) return null;

    // harness 注入的 user turn（背景 task 通知、subagent 回報）帶 `origin`；
    // 真人打的訊息沒有。這些不是使用者說的話，當成工具細節。
    if (event.type === 'user' && event.origin?.kind) {
      if (!opts.includeTools) return null;
      const origin = event.origin;
      const body =
        origin.kind === 'peer' && typeof origin.handbackReportText === 'string'
          ? `**Subagent report: ${origin.name || origin.from || 'agent'}**\n\n${origin.handbackReportText}`
          : `**${origin.kind}**\n\n${blocksText(contentBlocks(event.message), opts)}`;
      return { role: 'Assistant', model: '', time: event.timestamp, body };
    }

    const blocks = contentBlocks(event.message);
    const isToolOutput =
      event.type === 'user' && blocks.length > 0 && blocks.every((b) => b?.type === 'tool_result');
    const body = blocksText(blocks, opts);
    const role = event.type === 'user' && !isToolOutput ? 'User' : 'Assistant';
    return {
      role,
      model: role === 'Assistant' ? event.message?.model || '' : '',
      time: event.timestamp,
      body,
    };
  }

  function normalizeCodeSession(data, ctx, opts) {
    const meta = data.meta || {};
    const sections = data.events
      .map((event) => codeEventToSection(event, opts))
      .filter((section) => section && section.body.trim());
    const init = data.events.find((event) => event.type === 'system' && event.model);
    const firstUser = sections.find((section) => section.role === 'User');
    return {
      source: 'claude-code',
      sourceLabel: 'Claude Code',
      title:
        meta.title || meta.name || firstUser?.body.split('\n')[0].slice(0, 80) || 'Claude Code session',
      url: ctx.url,
      ids: { session_id: data.session_id },
      model: init?.model || '',
      createdAt: meta.created_at || data.events[0]?.timestamp,
      sections,
    };
  }

  function toDoc(data, ctx, opts) {
    return data?.kind === 'claude-code-session'
      ? normalizeCodeSession(data, ctx, opts)
      : normalize(data, ctx, opts);
  }

  // ------------------------------------------------------------------ 動作

  async function doExport({ mode, to, ids }) {
    ui.setStatus('讀取對話…');
    try {
      const target = ids || currentIds();
      const { data, source } = await resolveConversation(target);
      const url = target.shareId ? `${location.origin}/share/${target.shareId}` : location.href;

      const text =
        mode === 'json'
          ? JSON.stringify(data, null, 2)
          : renderTranscript(toDoc(data, { url }, settings), {
              ...settings,
              handoff: mode === 'handoff',
              exporter: EXPORTER,
            });

      if (to === 'clipboard') {
        GM_setClipboard(text, 'text');
        ui.setStatus(`已複製 ${text.length.toLocaleString()} 字（來源：${source}）`);
      } else {
        const doc = toDoc(data, { url }, settings);
        downloadText(
          filenameFor(doc, mode === 'json' ? 'json' : 'md'),
          text,
          mode === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
        );
        ui.setStatus(`已下載（來源：${source}）`);
      }
      log('exported', { mode, to, source, length: text.length });
    } catch (error) {
      ui.setStatus(`失敗：${error.message}`);
      log('export failed:', error);
    }
  }

  /**
   * 貼上的 share URL 沒辦法就地讀（見檔頭第 2 點）——
   * 改成把「等一下要匯出什麼」寫進 GM storage，再開一個分頁，
   * 讓那邊的腳本自己攔到資料後匯出。
   */
  function exportFromShareUrl(raw) {
    const shareId = shareIdFromUrl(raw);
    if (!shareId) {
      ui.setStatus('這不像 share URL（要有 /share/<id>）。');
      return;
    }
    if (shareId === currentIds().shareId) {
      doExport({ mode: 'transcript', to: 'clipboard' });
      return;
    }
    GM_setValue(PENDING_KEY, { shareId, expires: Date.now() + 120_000 });
    GM_openInTab(`${location.origin}/share/${shareId}`, { active: true });
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
        label: '含工具呼叫與搜尋結果',
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
      const raw = prompt('貼上 Claude share URL：');
      if (raw) exportFromShareUrl(raw);
    });
    GM_registerMenuCommand('Toggle thinking / reasoning', () => {
      setSetting('includeThinking', !settings.includeThinking);
      ui.openPanel();
      ui.setStatus(`thinking / reasoning：${settings.includeThinking ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Toggle 工具呼叫與搜尋結果', () => {
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

  installNetworkCapture(); // 必須在網站發出請求之前，所以 @run-at document-start
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
