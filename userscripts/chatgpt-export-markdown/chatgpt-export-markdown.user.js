// ==UserScript==
// @name         ChatGPT Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      1.0.0
// @description  把整段 ChatGPT 對話匯成 Markdown（含 Agent Handoff 與原始 JSON），貼給 coding agent 用
// @author       Da-Wei Lee
// @license      MIT
// @match        https://chatgpt.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyNzggNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkNFPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js
// ==/UserScript==

/**
 * 把一整段 ChatGPT 對話匯成 Markdown，格式仿 SpecStory 的 chat history
 * （`_**User (ts)**_` / `---` / `_**Assistant (model)**_`），目的是貼給 coding agent。
 *
 * 為什麼不 scrape DOM（這支腳本最重要的設計決定）：
 * ChatGPT 的訊息列表是 virtualized 的。實測一段 44 則的對話，DOM 裡同時只存在 4 個
 * `[data-message-author-role]`。所以常見的「clone DOM → innerText」做法先天就殘缺，
 * 而且 markdown 是從已渲染的 HTML 反推回來的，code fence / 表格都可能失真。
 *
 * 這裡改抓 ChatGPT 自己的對話 JSON —— 裡面是**模型原本吐出的 raw markdown**。
 * 取得順序見 resolveConversation()，四層 fallback。
 *
 * 代價：靠的是 app internals（`__reactRouterContext`）與私有 API，ChatGPT 改版就可能失效。
 * docs/06-sandbox-and-unsafewindow.md 把這列為最脆弱的一層 —— 這裡明知故犯，
 * 因為更穩的那層（DOM）根本拿不到完整資料。壞掉時寧可明白報錯，也不要吐出殘缺的 transcript。
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const NS = 'cgpt-export-md';
  const LOG_PREFIX = '[chatgpt-export-markdown]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // 有任何 @grant 就會被 sandbox，頁面的全域要走 unsafeWindow 才看得到。
  const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------------------------------------------------------------- 設定

  const SETTINGS_KEYS = ['includeThinking', 'includeTools'];
  const settings = { includeThinking: false, includeTools: false };

  for (const key of SETTINGS_KEYS) {
    settings[key] = GM_getValue(key, settings[key]) === true;
  }

  function setSetting(key, value) {
    settings[key] = value === true;
    GM_setValue(key, settings[key]);
  }

  // ------------------------------------------------- 來源 1：攔截網站自己的請求

  /** conversation_id -> 對話 JSON。document-start 才來得及攔到。 */
  const captured = new Map();

  function looksLikeConversation(value) {
    return (
      !!value &&
      typeof value === 'object' &&
      !!value.mapping &&
      typeof value.mapping === 'object' &&
      (Array.isArray(value.linear_conversation) || typeof value.current_node === 'string')
    );
  }

  function rememberPayload(payload) {
    const data = looksLikeConversation(payload?.data) ? payload.data : payload;
    if (!looksLikeConversation(data)) return;
    const id = data.conversation_id || data.id;
    captured.set(id || `anonymous-${captured.size}`, data);
    log('captured conversation payload:', id || '(no id)');
  }

  function installNetworkCapture() {
    const originalFetch = pageWin.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__cgptExportPatched) return;

    const patched = function (...args) {
      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input?.url || '';
          // body 只能讀一次，一定要 clone，否則網站自己就讀不到了。
          if (response.ok && /\/backend-api\/(conversation|share)\//.test(url)) {
            response
              .clone()
              .json()
              .then(rememberPayload)
              .catch(() => {});
          }
        } catch {
          /* 攔截失敗不能影響網站本身 */
        }
        return response; // 一定要把原本的 response 還回去
      });
    };
    patched.__cgptExportPatched = true;
    pageWin.fetch = patched;
  }

  // ------------------------------------------- 來源 2：頁面的 React Router state

  /**
   * share 頁把整份對話塞在
   * `__reactRouterContext.state.loaderData['routes/share.$shareId.($action)'].serverResponse.data`。
   * route key 會隨改版變動，所以這裡用「找形狀」而不是 hard-code key。
   */
  function scanForConversation(root, maxDepth = 6) {
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > maxDepth || seen.has(node)) return null;
      seen.add(node);
      if (looksLikeConversation(node)) return node;
      for (const value of Object.values(node)) {
        const hit = walk(value, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    return walk(root, 0);
  }

  function fromRouterState(win = pageWin) {
    try {
      const loaderData = win.__reactRouterContext?.state?.loaderData;
      return loaderData ? scanForConversation(loaderData) : null;
    } catch {
      return null;
    }
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** loaderData 是 hydration 過程中才填進去的，剛載入就按按鈕會撲空 —— 給它一點時間。 */
  async function waitForRouterState({ timeout = 3_000, interval = 150 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const state = fromRouterState();
      if (state) return state;
      if (Date.now() >= deadline) return null;
      await delay(interval);
    }
  }

  // ------------------------------------------------------- 來源 3：backend API

  async function fromBackendApi(convId, shareId) {
    let authorization = null;
    try {
      const session = await fetch('/api/auth/session', { credentials: 'include' });
      if (session.ok) {
        const json = await session.json();
        if (json?.accessToken) authorization = `Bearer ${json.accessToken}`;
      }
    } catch {
      /* 未登入或被擋，往下試沒有 token 的請求 */
    }

    const paths = [];
    if (convId) paths.push(`/backend-api/conversation/${convId}`);
    if (shareId) paths.push(`/backend-api/share/${shareId}`);

    for (const path of paths) {
      try {
        const headers = { accept: 'application/json' };
        if (authorization) headers.authorization = authorization;
        const res = await fetch(path, { credentials: 'include', headers });
        if (!res.ok) continue;
        const json = await res.json();
        const data = looksLikeConversation(json?.data) ? json.data : json;
        if (looksLikeConversation(data)) return data;
      } catch {
        /* 換下一個 */
      }
    }
    return null;
  }

  // -------------------------------------------------- 來源 4：同源隱藏 iframe

  /**
   * 貼任意 public share URL 用的。chatgpt.com 的 CSP 是 `frame-ancestors 'self' …`，
   * 所以同源 iframe 框得起來，載入後直接讀它的 router state。
   */
  function fromShareIframe(shareId, { timeout = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.id = `${NS}-loader`;
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1200px;height:900px;opacity:0;pointer-events:none;border:0';
      frame.src = `/share/${shareId}`;

      let poll = 0;
      const timer = setTimeout(() => {
        finish(null, new Error('讀取 share 頁逾時（連結可能已取消公開）'));
      }, timeout);

      function finish(data, error) {
        clearInterval(poll);
        clearTimeout(timer);
        frame.remove();
        if (error) reject(error);
        else resolve(data);
      }

      frame.addEventListener('load', () => {
        poll = setInterval(() => {
          let data = null;
          try {
            data = fromRouterState(frame.contentWindow);
          } catch (err) {
            finish(null, err);
            return;
          }
          // iframe 一移除，裡面的物件就跟著沒了 —— 先深拷貝再收工。
          if (data) finish(JSON.parse(JSON.stringify(data)));
        }, 250);
      });

      document.body.appendChild(frame);
    });
  }

  // ------------------------------------------------------------ 來源總調度

  function currentIds() {
    const chat = location.pathname.match(/\/c\/([0-9a-zA-Z-]+)/);
    const share = location.pathname.match(/^\/share\/([0-9a-zA-Z-]+)/);
    return { convId: chat?.[1] || null, shareId: share?.[1] || null };
  }

  function shareIdFromUrl(input) {
    const match = String(input).match(/\/share\/([0-9a-zA-Z-]+)/);
    return match ? match[1] : null;
  }

  async function resolveConversation(ids) {
    const { convId, shareId } = ids;

    if (convId && captured.has(convId)) {
      return { data: captured.get(convId), source: 'network-capture' };
    }

    if (!shareId || shareId === currentIds().shareId) {
      const state = await waitForRouterState();
      if (state) return { data: state, source: 'router-state' };
    }

    if (convId || shareId) {
      const api = await fromBackendApi(convId, shareId);
      if (api) return { data: api, source: 'backend-api' };
    }

    if (shareId) {
      const framed = await fromShareIframe(shareId).catch((err) => {
        log('iframe fallback failed:', err.message);
        return null;
      });
      if (framed) return { data: framed, source: 'share-iframe' };
    }

    if (!convId && !shareId && captured.size === 1) {
      return { data: [...captured.values()][0], source: 'network-capture' };
    }

    throw new Error('抓不到對話資料。重新整理頁面後再試一次（share 連結請確認仍是公開的）。');
  }

  // ------------------------------------------------------------ 轉成 Markdown

  const SKIP_CONTENT_TYPES = new Set([
    'model_editable_context',
    'user_editable_context',
    'system_error',
  ]);
  const THINKING_CONTENT_TYPES = new Set(['thoughts', 'reasoning_recap']);
  // citation 是私有區 unicode sentinel：\uE200cite\uE202turn0search1\uE201
  // （寫成 escape 而不是直接放字元，那些是看不見的私有區字碼，很容易被編輯器吃掉）
  const CITATION_SENTINEL = /\uE200[\s\S]*?\uE201/g;

  /** 取出目前選中的那條 branch（編輯／重生過的分支自動被排除）。 */
  function buildThread(data) {
    if (Array.isArray(data.linear_conversation) && data.linear_conversation.length > 0) {
      return data.linear_conversation.map((node) => node.message).filter(Boolean);
    }
    // /backend-api/conversation 只回 mapping + current_node，得自己往上走。
    const mapping = data.mapping || {};
    const thread = [];
    const guard = new Set();
    let id = data.current_node;
    while (id && mapping[id] && !guard.has(id)) {
      guard.add(id);
      if (mapping[id].message) thread.push(mapping[id].message);
      id = mapping[id].parent;
    }
    return thread.reverse();
  }

  /** 這串判斷是照 ChatGPT UI 自己的判準寫的。 */
  function visibleMessages(messages, opts) {
    return messages.filter((message) => {
      if (message.metadata?.is_visually_hidden_from_conversation) return false;

      const role = message.author?.role;
      if (role === 'system') return false;

      const contentType = message.content?.content_type;
      if (SKIP_CONTENT_TYPES.has(contentType)) return false;
      if (THINKING_CONTENT_TYPES.has(contentType)) return opts.includeThinking;

      const isToolTraffic = role === 'tool' || (message.recipient && message.recipient !== 'all');
      if (isToolTraffic) return opts.includeTools;

      return true;
    });
  }

  /** fence 要比內文裡最長的一串 backtick 還長，否則 code block 會被自己的內容截斷。 */
  function fence(body, lang = '') {
    const longest = (String(body).match(/`+/g) || []).reduce(
      (max, run) => Math.max(max, run.length),
      0
    );
    const ticks = '`'.repeat(Math.max(3, longest + 1));
    return `${ticks}${lang}\n${String(body).replace(/\n$/, '')}\n${ticks}`;
  }

  function partToText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.content_type === 'image_asset_pointer')
      return `![image](${part.asset_pointer || 'image'})`;
    if (typeof part.text === 'string') return part.text;
    return fence(JSON.stringify(part, null, 2), 'json');
  }

  function textOf(message) {
    const content = message.content || {};
    const parts = Array.isArray(content.parts)
      ? content.parts.map(partToText).filter(Boolean)
      : null;

    switch (content.content_type) {
      case 'text':
      case 'multimodal_text':
        return parts ? parts.join('\n\n') : '';
      case 'code': {
        const lang = content.language && content.language !== 'unknown' ? content.language : '';
        return fence(content.text ?? (parts ? parts.join('\n') : ''), lang);
      }
      case 'execution_output':
        return fence(content.text ?? '', 'text');
      case 'thoughts':
        return (content.thoughts || [])
          .map((t) => [t.summary && `**${t.summary}**`, t.content].filter(Boolean).join('\n\n'))
          .join('\n\n');
      case 'reasoning_recap':
        return String(content.content ?? content.text ?? '');
      case 'tether_browsing_display':
      case 'tether_quote':
        return String(content.result ?? content.text ?? '');
      default:
        // 未知型態（Deep Research、canvas 之類的新東西）不靜默丟掉，寧可留 JSON。
        if (parts && parts.length > 0) return parts.join('\n\n');
        if (typeof content.text === 'string') return content.text;
        return fence(JSON.stringify(content, null, 2), 'json');
    }
  }

  /**
   * 把 sentinel 換成 content_references 提供的現成 markdown 連結。
   *
   * 這裡只換「那一段」而不是全文 replace，是踩過坑的：`sources_footnote` 型的
   * ref 的 matched_text 是**一個半形空白**、alt 是空字串。全文 split/join 會把整篇
   * 文章的空白全部刪光（中英混排看起來就像整段黏在一起）。
   */
  function applyCitations(text, message) {
    const refs = (message.metadata?.content_references || []).filter(
      (ref) => typeof ref.matched_text === 'string' && ref.matched_text.trim() !== ''
    );
    let out = text;
    // 由後往前換，前面那些 start_idx 才不會被前一次替換推掉。
    for (const ref of [...refs].sort((a, b) => (b.start_idx ?? -1) - (a.start_idx ?? -1))) {
      const alt = ref.alt || '';
      const { start_idx: start, end_idx: end } = ref;
      if (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        out.slice(start, end) === ref.matched_text
      ) {
        out = out.slice(0, start) + alt + out.slice(end);
        continue;
      }
      const at = out.indexOf(ref.matched_text); // index 對不上時退而求其次，只換第一個
      if (at >= 0) out = out.slice(0, at) + alt + out.slice(at + ref.matched_text.length);
    }
    // 有些 sentinel（例如 inline url 型）不會出現在 content_references 裡，掃掉。
    return out.replace(CITATION_SENTINEL, '');
  }

  function pad(n) {
    return String(Math.floor(Math.abs(n))).padStart(2, '0');
  }

  /** 對齊 .specstory/history/ 的寫法：UTC 的 `YYYY-MM-DD HH:mm:ssZ`。 */
  function formatUtc(epochSeconds) {
    if (!epochSeconds) return '';
    const d = new Date(epochSeconds * 1000);
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
    );
  }

  function localIso(date = new Date()) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
    );
  }

  function roleOf(message) {
    const role = message.author?.role;
    if (role === 'user') return 'User';
    if (role === 'tool') return `Tool (${message.author?.name || 'tool'})`;
    if (message.recipient && message.recipient !== 'all') return `Assistant → ${message.recipient}`;
    return 'Assistant';
  }

  /**
   * 連續同 role 的訊息要合併。一輪 assistant 常被拆成「開場白 → 搜尋 → 正文」好幾則，
   * 不合併的話 transcript 會出現一堆只有一行的 Assistant 區塊。
   */
  function toSections(messages) {
    const sections = [];
    for (const message of messages) {
      const body = applyCitations(textOf(message), message).trim();
      if (!body) continue;

      const role = roleOf(message);
      const model = role === 'Assistant' ? message.metadata?.model_slug || '' : '';
      const previous = sections[sections.length - 1];
      if (previous && previous.role === role) {
        previous.body += `\n\n${body}`;
        if (!previous.model) previous.model = model;
        continue;
      }
      sections.push({ role, model, body, time: message.create_time });
    }
    return sections;
  }

  function yaml(value) {
    return JSON.stringify(String(value ?? '')); // JSON 字串剛好是合法的 YAML double-quoted scalar
  }

  const HANDOFF_HEADER = [
    '# Prior ChatGPT Context',
    '',
    'The following is a prior discussion between the user and ChatGPT.',
    '',
    '## Instructions for the coding agent',
    '',
    '- Treat established decisions as existing project decisions.',
    '- Do not reopen settled design questions unless implementation reveals a conflict.',
    "- Preserve the user's stated constraints.",
    '- Consult the original conversation below when necessary.',
    '',
    '---',
    '',
    '## Conversation',
  ].join('\n');

  function render(data, opts, ctx) {
    const sections = toSections(visibleMessages(buildThread(data), opts));
    if (sections.length === 0) throw new Error('這個對話沒有可匯出的訊息。');

    const title = data.title || 'ChatGPT conversation';
    const frontMatter = [
      '---',
      'source: chatgpt',
      `title: ${yaml(title)}`,
      `url: ${yaml(ctx.url)}`,
      `conversation_id: ${yaml(data.conversation_id || data.id || '')}`,
      `model: ${yaml(data.default_model_slug || '')}`,
      `created_at: ${yaml(formatUtc(data.create_time))}`,
      `exported_at: ${yaml(localIso())}`,
      `messages: ${sections.length}`,
      `include_thinking: ${opts.includeThinking}`,
      `include_tools: ${opts.includeTools}`,
      `exporter: ${yaml(`chatgpt-export-markdown v${VERSION}`)}`,
      '---',
    ].join('\n');

    const body = sections
      .map((section) => {
        const label = [section.model, formatUtc(section.time)].filter(Boolean).join(', ');
        return `_**${section.role}${label ? ` (${label})` : ''}**_\n\n${section.body}`;
      })
      .join('\n\n---\n\n');

    const heading = opts.handoff ? HANDOFF_HEADER : `# ${title}`;
    return `${frontMatter}\n\n${heading}\n\n<!-- Generated by chatgpt-export-markdown v${VERSION} -->\n\n${body}\n`;
  }

  function filenameFor(data, extension) {
    const slug =
      String(data.title || 'conversation')
        .replace(/[\\/:*?"<>|]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'conversation';
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `chatgpt-${slug}-${stamp}.${extension}`;
  }

  /** 不需要任何 @grant 的下載（同 shared/dom.js 的 downloadText）。 */
  function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------------ 動作

  async function doExport({ mode, to, ids }) {
    setStatus('讀取對話…');
    try {
      const target = ids || currentIds();
      const { data, source } = await resolveConversation(target);
      const url = target.shareId ? `${location.origin}/share/${target.shareId}` : location.href;

      const text =
        mode === 'json'
          ? JSON.stringify(data, null, 2)
          : render(data, { ...settings, handoff: mode === 'handoff' }, { url });

      if (to === 'clipboard') {
        GM_setClipboard(text, 'text');
        setStatus(`已複製 ${text.length.toLocaleString()} 字（來源：${source}）`);
      } else {
        downloadText(
          filenameFor(data, mode === 'json' ? 'json' : 'md'),
          text,
          mode === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
        );
        setStatus(`已下載（來源：${source}）`);
      }
      log('exported', { mode, to, source, length: text.length });
    } catch (error) {
      setStatus(`失敗：${error.message}`);
      log('export failed:', error);
    }
  }

  function exportFromShareUrl(raw) {
    const shareId = shareIdFromUrl(raw);
    if (!shareId) {
      setStatus('這不像 share URL（要有 /share/<id>）。');
      return;
    }
    doExport({ mode: 'transcript', to: 'clipboard', ids: { convId: null, shareId } });
  }

  const ACTIONS = [
    { label: 'Copy Markdown', run: () => doExport({ mode: 'transcript', to: 'clipboard' }) },
    { label: 'Copy Agent Handoff', run: () => doExport({ mode: 'handoff', to: 'clipboard' }) },
    { label: 'Download .md', run: () => doExport({ mode: 'transcript', to: 'file' }) },
    { label: 'Download .json', run: () => doExport({ mode: 'json', to: 'file' }) },
  ];

  // -------------------------------------------------------------------- UI

  let statusEl = null;

  function setStatus(text) {
    log(text);
    if (statusEl) statusEl.textContent = text;
  }

  function style(el, css) {
    el.style.cssText = css;
    return el;
  }

  function makeButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return style(
      button,
      'display:block;width:100%;margin:0 0 6px;padding:7px 10px;border:0;border-radius:7px;' +
        'cursor:pointer;background:#3ba3ff;color:#06131f;font:600 13px/1.4 inherit;text-align:left;'
    );
  }

  function makeToggle(key, label) {
    const wrapper = style(
      document.createElement('label'),
      'display:flex;align-items:center;gap:6px;margin:0 0 4px;font:400 12px/1.4 inherit;cursor:pointer;'
    );
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = settings[key];
    box.addEventListener('change', () => {
      setSetting(key, box.checked);
      setStatus(`${label}：${box.checked ? '含' : '不含'}`);
    });
    wrapper.append(box, document.createTextNode(label));
    return wrapper;
  }

  /** 掛 UI。可重複呼叫，必須 idempotent（SPA 換頁會再跑一次）。 */
  function mount() {
    if (!document.body || document.getElementById(`${NS}-root`)) return;

    const root = style(
      document.createElement('div'),
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
        'font:400 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    );
    root.id = `${NS}-root`;

    const panel = style(
      document.createElement('div'),
      'display:none;width:230px;margin-bottom:8px;padding:12px;border-radius:10px;' +
        'background:#12181f;color:#e6edf3;box-shadow:0 8px 28px rgba(0,0,0,.35);'
    );
    panel.id = `${NS}-panel`;

    for (const action of ACTIONS) panel.appendChild(makeButton(action.label, action.run));

    panel.appendChild(
      style(document.createElement('hr'), 'margin:10px 0;border:0;border-top:1px solid #2a3441;')
    );
    panel.appendChild(makeToggle('includeThinking', '含 thinking / reasoning'));
    panel.appendChild(makeToggle('includeTools', '含工具呼叫與搜尋結果'));

    const input = style(
      document.createElement('input'),
      'width:100%;box-sizing:border-box;margin:10px 0 6px;padding:6px 8px;border-radius:6px;' +
        'border:1px solid #2a3441;background:#0b0f14;color:#e6edf3;font:400 12px/1.4 inherit;'
    );
    input.type = 'text';
    input.placeholder = '貼上任意 share URL…';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') exportFromShareUrl(input.value);
    });
    panel.appendChild(input);
    panel.appendChild(makeButton('Copy from share URL', () => exportFromShareUrl(input.value)));

    statusEl = style(
      document.createElement('div'),
      'margin-top:8px;color:#8b98a5;font:400 11px/1.5 inherit;word-break:break-word;'
    );
    statusEl.textContent = '就緒';
    panel.appendChild(statusEl);

    const toggle = style(
      document.createElement('button'),
      'padding:8px 14px;border:0;border-radius:8px;cursor:pointer;background:#3ba3ff;color:#06131f;' +
        'font:600 13px/1.4 inherit;box-shadow:0 4px 16px rgba(0,0,0,.25);'
    );
    toggle.type = 'button';
    toggle.textContent = '⇩ Export MD';
    toggle.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });

    root.append(panel, toggle);
    document.body.appendChild(root);
  }

  function openPanel() {
    mount();
    const panel = document.getElementById(`${NS}-panel`);
    if (panel) panel.style.display = 'block';
  }

  function registerMenu() {
    for (const action of ACTIONS) {
      // 不要用 accessKey —— 那是 Tampermonkey 限定的。
      GM_registerMenuCommand(action.label, () => {
        openPanel();
        action.run();
      });
    }
    GM_registerMenuCommand('Export from share URL…', () => {
      openPanel();
      const raw = prompt('貼上 ChatGPT share URL：');
      if (raw) exportFromShareUrl(raw);
    });
    GM_registerMenuCommand('Toggle thinking / reasoning', () => {
      setSetting('includeThinking', !settings.includeThinking);
      openPanel();
      setStatus(`thinking / reasoning：${settings.includeThinking ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Toggle 工具呼叫與搜尋結果', () => {
      setSetting('includeTools', !settings.includeTools);
      openPanel();
      setStatus(`工具呼叫：${settings.includeTools ? '含' : '不含'}`);
    });
  }

  // ----------------------------------------------------------------- 啟動

  installNetworkCapture(); // 必須在網站發出請求之前，所以 @run-at document-start
  registerMenu();

  function start() {
    mount();

    // SPA 換對話不會 reload，只要確保 UI 還在（抓資料完全不碰 DOM，不需要重建狀態）。
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      mount();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // document-start 時 <body>（有時連 <html>）都還沒有，所以 UI 與 observer 等到 DOM 就緒再掛。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
