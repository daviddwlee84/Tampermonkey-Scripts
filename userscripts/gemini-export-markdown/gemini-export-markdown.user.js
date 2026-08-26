// ==UserScript==
// @name         Gemini Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.2.0
// @description  把整段 Gemini 對話匯成 Markdown（含 share 頁與 Agent Handoff），貼給 coding agent 用
// @author       Da-Wei Lee
// @license      MIT
// @match        https://gemini.google.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgxMDQgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkdFPC90ZXh0Pjwvc3ZnPg==
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
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/gemini-export-markdown/gemini-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/gemini-export-markdown/gemini-export-markdown.user.js
// ==/UserScript==

/* global createExportPanel, downloadText, filenameFor, jsonFence, renderTranscript, sourcesBlock */

/**
 * 把一整段 Gemini 對話匯成 Markdown，格式跟 chatgpt / claude / copilot 那幾支一致
 * （SpecStory 風格的 `_**User**_` / `---` / `_**Assistant**_`），目的是貼給 coding agent。
 *
 * Gemini 的資料層跟前面幾支很不一樣，實測（Playwright + curl）確認過的重點：
 *
 * - 初始 HTML 完全沒有對話內容，只有一個 Angular 殼，所以一定要走 RPC 或掃 DOM。
 * - 資料來自 `POST /_/BardChatUi/data/batchexecute`，回應是
 *   `)]}'` + 「長度行 + JSON」重複，每個 `["wrb.fr", <rpcid>, "<JSON string>"]`。
 * - **payload 裡 assistant 的內容就是原始 Markdown**（不是 render 過的 HTML），
 *   所以 API 這條路完全不用做 HTML→Markdown 轉換，品質遠勝掃 DOM。
 * - share 頁（`/share/<id>`）用 `rpcids=ujx1Bf`，而且**匿名就打得通**（不用 cookie、
 *   不用 `at` token），所以 share 頁可以自己補發請求，不必只靠攔截。
 * - app 頁（`/app/<id>`）載入歷史的 rpcid 只能從攔截學到，猜不得，
 *   所以那邊沒攔到就只剩掃 DOM。
 *
 * 因應方式：**API 優先，全部失敗才退回掃 DOM，而且明白標示「可能不完整」**
 * （比照 `m365-copilot-export-markdown`）。解析 payload 時錨在 `c_` / `r_` / `rc_`
 * 這組語意穩定的 id 前綴上做形狀比對，不寫死 `[0][1][0][3][0][0][1][0]` 這種索引路徑——
 * 那種寫法 Google 一改版就死。
 */
(function () {
  'use strict';

  const VERSION = '0.2.0';
  const NS = 'gemini-export-md';
  const EXPORTER = `gemini-export-markdown v${VERSION}`;
  const LOG_PREFIX = '[gemini-export-markdown]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  // 有任何 @grant 就會被 sandbox，頁面的全域要走 unsafeWindow 才看得到。
  const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const DEFAULT_TITLE = 'Gemini conversation';
  const BATCH_RE = /\/_\/BardChatUi\/data\/batchexecute/;
  const SHARE_RPC = 'ujx1Bf';

  // ---------------------------------------------------------------- 設定

  const SETTINGS_KEYS = ['includeThinking', 'includeTools', 'includeDrafts'];
  const PENDING_KEY = 'pendingExport'; // 「貼 share URL → 開新分頁自動匯出」的一次性交棒
  const settings = { includeThinking: false, includeTools: false, includeDrafts: false };

  for (const key of SETTINGS_KEYS) {
    settings[key] = GM_getValue(key, settings[key]) === true;
  }

  function setSetting(key, value) {
    settings[key] = value === true;
    GM_setValue(key, settings[key]);
  }

  // -------------------------------------------------------- batchexecute 解析

  /**
   * batchexecute 的回應是 `)]}'` 開頭，接著「長度行 + JSON」重複（`rt=c` 時），
   * 或直接就是一個陣列（沒帶 `rt` 時）。
   *
   * 那個長度是**位元組數不是字元數**，中文一多就對不上，所以不要照長度切——
   * 直接掃平衡括號比較穩，順便兩種框法都吃得下。
   *
   * @returns {{ rpcid: string, payload: unknown }[]}
   */
  function parseBatchExecute(body) {
    const text = String(body || '').replace(/^\)\]\}'\s*/, '');
    const out = [];

    // 找出每個 top-level `[...]`，中間的長度行 parse 會失敗，跳過就好。
    for (let i = 0; i < text.length;) {
      const start = text.indexOf('[', i);
      if (start < 0) break;
      const end = matchBracket(text, start);
      if (end < 0) break;
      i = end + 1;

      let envelope;
      try {
        envelope = JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
      if (!Array.isArray(envelope)) continue;

      for (const row of envelope) {
        if (!Array.isArray(row) || row[0] !== 'wrb.fr' || typeof row[2] !== 'string') continue;
        try {
          out.push({ rpcid: String(row[1] || ''), payload: JSON.parse(row[2]) });
        } catch {
          /* 這格不是 JSON 就算了，別擋住其他格 */
        }
      }
    }
    return out;
  }

  /** 從 `text[start]` 的 `[` 找到對應的 `]`，會跳過字串裡的括號。找不到回 -1。 */
  function matchBracket(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // -------------------------------------------------------- payload 形狀比對

  /** 一輪對話：`[["c_<conversationId>", "r_<responseId>"], null, <user>, <response>, …]` */
  const isTurn = (node) =>
    Array.isArray(node) &&
    Array.isArray(node[0]) &&
    typeof node[0][0] === 'string' &&
    typeof node[0][1] === 'string' &&
    node[0][0].startsWith('c_') &&
    node[0][1].startsWith('r_');

  /** 一份候選草稿：`["rc_<id>", ["<markdown>"], …]`。`[1][0]` 就是原始 Markdown。 */
  const isDraft = (node) =>
    Array.isArray(node) &&
    typeof node[0] === 'string' &&
    node[0].startsWith('rc_') &&
    Array.isArray(node[1]) &&
    typeof node[1][0] === 'string';

  /** 深掃找出所有符合 predicate 的陣列。命中就不再往下鑽，免得撈到自己的子節點。 */
  function collectMatches(root, predicate, maxDepth = 10) {
    const out = [];
    const seen = new Set();
    const walk = (node, depth) => {
      if (!Array.isArray(node) || depth > maxDepth || seen.has(node)) return;
      seen.add(node);
      if (predicate(node)) {
        out.push(node);
        return;
      }
      for (const item of node) walk(item, depth + 1);
    };
    walk(root, 0);
    return out;
  }

  /**
   * 從一份 payload 找出「這段對話」。實測兩種容器形狀：
   *
   * - share 頁 `ujx1Bf`：`[null, <turns>, <meta>, "<shareId>", [<epoch 秒>, <奈秒>], …]`
   *   meta 是 `[true, "<title>", …, [2, "<modelId>", "Flash"], true]`
   * - app 頁載歷史：`[<turns>, null, null, []]` —— **沒有 meta，也沒有標題**
   *
   * 與其兩種各寫一次，不如掃前幾格找「元素是 turn 的陣列」，meta / shareId / 時間
   * 就固定跟在它後面三格；app 那邊那三格是 null / null / []，型別檢查會擋掉。
   * 連容器都認不出來（例如串流回應）就退回「把 payload 裡所有 turn 撿一撿」。
   */
  function findConversation(payload) {
    let best = null;
    const seen = new Set();

    const walk = (node, depth) => {
      if (!Array.isArray(node) || depth > 10 || seen.has(node)) return;
      seen.add(node);
      for (let i = 0; i < Math.min(node.length, 3); i += 1) {
        const turns = Array.isArray(node[i]) ? node[i].filter(isTurn) : [];
        if (turns.length === 0 || (best && turns.length <= best.turns.length)) continue;
        best = {
          turns,
          meta: Array.isArray(node[i + 1]) ? node[i + 1] : null,
          shareId: typeof node[i + 2] === 'string' ? node[i + 2] : '',
          created: Array.isArray(node[i + 3]) ? node[i + 3] : null,
        };
      }
      for (const item of node) walk(item, depth + 1);
    };
    walk(payload, 0);
    if (best) return best;

    const turns = collectMatches(payload, isTurn);
    return turns.length > 0 ? { turns, meta: null, shareId: '', created: null } : null;
  }

  // ------------------------------------------------- 來源 1：攔截網站自己的請求

  /** [{ url, rpcid, convo, data }]，最新的排最後。 */
  const captured = [];

  function rememberBody(url, text) {
    if (typeof text !== 'string' || !text.includes('wrb.fr')) return;
    for (const { rpcid, payload } of parseBatchExecute(text)) {
      const convo = findConversation(payload);
      if (!convo) continue;
      captured.push({ url, rpcid, convo, data: payload });
      log('captured conversation:', rpcid, `${convo.turns.length} turns`);
    }
  }

  function installFetchCapture() {
    const originalFetch = pageWin.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__geminiExportPatched) return;

    const patched = function (...args) {
      const promise = originalFetch.apply(this, args);
      return promise.then((response) => {
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input?.url || String(input || '');
          // body 只能讀一次，一定要 clone，否則網站自己就讀不到了。
          if (response.ok && BATCH_RE.test(url)) {
            response
              .clone()
              .text()
              .then((text) => rememberBody(url, text))
              .catch(() => {});
          }
        } catch {
          /* 攔截失敗不能影響網站本身 */
        }
        return response; // 一定要把原本的 response 還回去
      });
    };
    patched.__geminiExportPatched = true;
    pageWin.fetch = patched;
  }

  /** Google 的 boq 前端有些請求走 XHR，所以兩種都要攔。 */
  function installXhrCapture() {
    const XHR = pageWin.XMLHttpRequest;
    if (!XHR || XHR.prototype.__geminiExportPatched) return;

    const { open, send } = XHR.prototype;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__geminiExportUrl = String(url || '');
      return open.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const url = this.__geminiExportUrl || '';
          if (this.status < 200 || this.status >= 300 || !BATCH_RE.test(url)) return;
          const raw =
            this.responseType === '' || this.responseType === 'text'
              ? this.responseText
              : this.response;
          rememberBody(url, raw);
        } catch {
          /* 讀不到就算了 */
        }
      });
      return send.apply(this, args);
    };

    XHR.prototype.__geminiExportPatched = true;
  }

  // -------------------------------------------- 來源 2：自己補打 share 的 RPC

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * share 頁的 `ujx1Bf` 匿名就打得通，實測 `bl` / `f.sid` 都可以省略，
   * 但有就帶上，跟頁面自己發的請求長得像一點。
   *
   * 這也是 `npm run preview` 唯一測得到的 API 路徑——preview 是在
   * domcontentloaded 之後才注入腳本，攔截層在那裡永遠不會生效。
   */
  async function fromShareApi(shareId) {
    const wiz = pageWin.WIZ_global_data || {};
    const params = new URLSearchParams({
      rpcids: SHARE_RPC,
      'source-path': `/share/${shareId}`,
      hl: 'en-US',
      _reqid: String(100000 + Math.floor(Math.random() * 900000)),
      rt: 'c',
    });
    if (typeof wiz.cfb2h === 'string') params.set('bl', wiz.cfb2h);
    if (typeof wiz.FdrFJe === 'string') params.set('f.sid', wiz.FdrFJe);

    const inner = JSON.stringify([null, shareId, [4]]);
    const body = `f.req=${encodeURIComponent(JSON.stringify([[[SHARE_RPC, inner, null, 'generic']]]))}`;

    try {
      const res = await fetch(`/_/BardChatUi/data/batchexecute?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-same-domain': '1',
        },
        body,
      });
      if (!res.ok) {
        log('share api failed:', res.status);
        return null;
      }
      for (const { payload } of parseBatchExecute(await res.text())) {
        const convo = findConversation(payload);
        if (convo) return { url: `/share/${shareId}`, rpcid: SHARE_RPC, convo, data: payload };
      }
    } catch (error) {
      log('share api threw:', error.message);
    }
    return null;
  }

  // ------------------------------------------------- 來源 4：掃畫面上的 DOM
  //
  // 這是最後一條路，只在 API 全部走不通時才用（app 頁沒攔到就會落到這裡）。
  // 掃 DOM 拿到的是 render 過的 HTML 反推回來的 Markdown，code fence / 表格 /
  // 引用都可能失真，而且 Gemini 長對話會 virtualize，所以**一定要標示可能不完整**，
  // 不假裝跟 API 來源一樣可靠。

  const DOM_USER_SEL = 'user-query-content .query-content';
  const DOM_MODEL_SEL = 'message-content .markdown-main-panel';

  /**
   * 「畫面上有、但不是對話內容」的東西，轉 Markdown 之前要先拆掉。
   * 其中 `.cdk-visually-hidden` 特別重要：`.query-content` 裡有一顆
   * `<h5 class="cdk-visually-hidden">You said …</h5>` 把提問整段重複了一次，
   * 不剔掉輸出就會出現兩份一樣的問題。
   */
  const DOM_NOISE_SELECTOR = [
    '.cdk-visually-hidden',
    '.code-block-decoration', // code block 上緣的語言列 + 複製／下載鈕
    'mat-icon',
    'gem-icon',
    'gem-icon-button',
    'button',
    '[role="button"]',
    '[aria-hidden="true"]',
    'script',
    'style',
    'svg',
  ].join(', ');

  /** 把 render 過的 HTML 轉回 Markdown。 */
  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === 3) return (node.nodeValue || '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    const kids = () =>
      Array.from(node.childNodes)
        .map((child) => nodeToMarkdown(child, depth))
        .join('');

    switch (tag) {
      // 純互動元素不是內容，帶進去只會變雜訊
      case 'script':
      case 'style':
      case 'svg':
      case 'button':
      case 'textarea':
        return '';
      case 'br':
        return '\n';
      case 'hr':
        return '\n\n---\n\n';
      // 空的行內標記要整個丟掉，不然畫面上的 icon/spacer 會變成一堆孤兒 `**`
      case 'strong':
      case 'b': {
        const text = kids().trim();
        return text ? `**${text}**` : '';
      }
      case 'em':
      case 'i': {
        const text = kids().trim();
        return text ? `*${text}*` : '';
      }
      case 'del':
      case 's': {
        const text = kids().trim();
        return text ? `~~${text}~~` : '';
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        const text = kids().trim();
        return href && text ? `[${text}](${href})` : text;
      }
      case 'img':
        return `![image](${node.getAttribute('src') || ''})`;
      case 'code': {
        // <pre><code> 由 pre 那邊整塊處理，這裡只管行內的
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return kids();
        const text = kids().trim();
        return text ? `\`${text}\`` : '';
      }
      case 'pre': {
        // Gemini 不用 `language-xxx` class，語言在 header 上，htmlToMarkdown 會先搬過來。
        const className = node.querySelector('code')?.className || '';
        const lang =
          node.getAttribute('data-gemini-lang') || /language-([\w+-]+)/.exec(className)?.[1] || '';
        return `\n\n\`\`\`${lang}\n${(node.textContent || '').replace(/\n+$/, '')}\n\`\`\`\n\n`;
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `\n\n${'#'.repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
      case 'blockquote':
        return `\n\n> ${kids().trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'ul':
      case 'ol': {
        const items = Array.from(node.children).filter(
          (child) => child.tagName.toLowerCase() === 'li'
        );
        const body = items
          .map((li, index) => {
            const marker = tag === 'ol' ? `${index + 1}.` : '-';
            const text = nodeToMarkdown(li, depth + 1)
              .trim()
              .replace(/\n/g, '\n  ');
            return `${'  '.repeat(depth)}${marker} ${text}`;
          })
          .join('\n');
        return `\n\n${body}\n\n`;
      }
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        const toCells = (tr) =>
          Array.from(tr.children).map((cell) => nodeToMarkdown(cell, depth).trim() || ' ');
        const head = toCells(rows[0]);
        const lines = [
          `| ${head.join(' | ')} |`,
          `| ${head.map(() => '---').join(' | ')} |`,
          ...rows.slice(1).map((tr) => `| ${toCells(tr).join(' | ')} |`),
        ];
        return `\n\n${lines.join('\n')}\n\n`;
      }
      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'li':
        return `\n\n${kids().trim()}\n\n`;
      // `response-element` / `link-block` 之類的 Gemini custom element 只是包裝，
      // 裡面就是 <a>，落到 default 遞迴 children 就對了。
      default:
        return kids();
    }
  }

  function htmlToMarkdown(el) {
    // 在 clone 上動刀，不要碰到真的頁面
    const clone = el.cloneNode(true);
    // code block 的語言寫在 header 那顆 decoration 上，剝掉噪音之前先搬到 <pre> 身上
    for (const block of clone.querySelectorAll('code-block')) {
      const label = block.querySelector('.code-block-decoration')?.textContent?.trim() || '';
      const pre = block.querySelector('pre');
      if (pre && /^[\w+#.-]{1,20}$/.test(label)) {
        pre.setAttribute('data-gemini-lang', label.toLowerCase());
      }
    }
    for (const noise of clone.querySelectorAll(DOM_NOISE_SELECTOR)) noise.remove();
    return nodeToMarkdown(clone)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 側欄選中那條的標題。app 頁的歷史 payload 沒有標題，只剩畫面上這個來源。 */
  const DOM_TITLE_SELECTOR = [
    'share-viewer h1',
    '.share-viewer_header-container-old h1',
    '.selected [data-test-id="conversation-title"]',
    '[aria-selected="true"] [data-test-id="conversation-title"]',
  ].join(', ');

  function domTitle() {
    const text = document.querySelector(DOM_TITLE_SELECTOR)?.textContent?.trim();
    if (text) return text;

    // document.title 可能被別的腳本加了前綴（本 repo 的 page-title-tag 就會加
    // `[Gemini] `），也可能帶站名前後綴。全部剝掉再看剩下什麼還有沒有資訊量——
    // 之前直接用 /gemini/i 一刀切，結果把加了前綴的真標題也一起丟掉了。
    const stripped = (document.title || '')
      .replace(/[‎‏]/g, '')
      .replace(/^\s*\[[^\]]{1,20}\]\s*/, '')
      .replace(/\s*[-–—|]\s*Gemini\s*$/i, '')
      .replace(/^\s*Gemini\s*[-–—|]\s*/i, '')
      .trim();
    if (!stripped || /^gemini$/i.test(stripped)) return DEFAULT_TITLE;
    if (/direct access to Google AI/i.test(stripped)) return DEFAULT_TITLE;
    return stripped;
  }

  function fromDom() {
    const ownRoot = document.getElementById(`${NS}-root`);
    // 一定要排掉自己注入的 UI，否則會把自己的按鈕文字當成對話內容。
    const outside = (el) => !(ownRoot && ownRoot.contains(el));

    const messages = [];
    const push = (role, body) => {
      if (body && body.trim()) messages.push({ role, body: body.trim() });
    };

    // share 頁一個 <share-turn-viewer> 就是一輪；app 頁是 .conversation-container。
    const turns = Array.from(
      document.querySelectorAll('share-turn-viewer, .conversation-container')
    ).filter(outside);

    if (turns.length > 0) {
      for (const turn of turns) {
        const user = turn.querySelector(DOM_USER_SEL);
        if (user) push('User', htmlToMarkdown(user));
        for (const model of turn.querySelectorAll(DOM_MODEL_SEL))
          push('Assistant', htmlToMarkdown(model));
      }
    } else {
      // 連容器都認不出來（Gemini 改版）：退回照文件順序把 user / model 節點串起來。
      const nodes = Array.from(
        document.querySelectorAll(`${DOM_USER_SEL}, ${DOM_MODEL_SEL}`)
      ).filter(outside);
      for (const node of nodes) {
        push(
          node.closest('user-query, user-query-content') ? 'User' : 'Assistant',
          htmlToMarkdown(node)
        );
      }
    }

    if (messages.length === 0) return null;
    log('dom scrape:', `${messages.length} messages`);
    return { url: location.href, rpcid: '', data: null, dom: { messages, title: domTitle() } };
  }

  // ------------------------------------------------------------ 來源總調度

  function currentIds() {
    const app = location.pathname.match(/\/app\/([A-Za-z0-9_-]+)/);
    const share = location.pathname.match(/\/share\/([A-Za-z0-9_-]+)/);
    return { conversationId: app?.[1] || null, shareId: share?.[1] || null };
  }

  /**
   * `share.gemini.google/<code>` 是短網址，會 302 到 `gemini.google.com/share/<id>`，
   * 在這裡沒辦法解出真的 id，所以只回 URL、讓新分頁那邊自己認。
   */
  function shareTargetFromUrl(input) {
    const raw = String(input || '').trim();
    const full = raw.match(/gemini\.google\.com\/share\/([A-Za-z0-9_-]+)/);
    if (full) return { shareId: full[1], url: `${location.origin}/share/${full[1]}` };
    const short = raw.match(/share\.gemini\.google\/([A-Za-z0-9_-]+)/);
    if (short) return { shareId: null, url: `https://share.gemini.google/${short[1]}` };
    const bare = raw.match(/^\/?share\/([A-Za-z0-9_-]+)\/?$/);
    if (bare) return { shareId: bare[1], url: `${location.origin}/share/${bare[1]}` };
    return null;
  }

  function pickCaptured({ conversationId, shareId }) {
    for (let i = captured.length - 1; i >= 0; i -= 1) {
      const hit = captured[i];
      if (shareId && (hit.url.includes(shareId) || hit.convo.shareId === shareId)) return hit;
      if (conversationId && hit.convo.turns.some((turn) => turn[0][0] === `c_${conversationId}`)) {
        return hit;
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
    const hit = pickCaptured(ids);
    if (hit) return { ...hit, source: 'network-capture' };

    if (ids.shareId) {
      const api = await fromShareApi(ids.shareId);
      if (api) return { ...api, source: 'share-api' };
    }

    const late = await waitForCapture(ids);
    if (late) return { ...late, source: 'network-capture (late)' };

    const dom = fromDom();
    if (dom) return { ...dom, source: 'dom-scrape (可能不完整)' };

    throw new Error('抓不到對話資料。請重新整理這一頁，等對話載完再試一次。');
  }

  // ------------------------------------------------------------ 轉成 Markdown

  const ASSET_HOST_RE = /(gstatic\.com|ytimg\.com|googleusercontent\.com|\/images\/branding\/)/;

  /** 深掃第一個「看起來是內容」的字串（跳過 16 進位的內部 id）。 */
  function firstString(node) {
    if (typeof node === 'string') {
      return node.trim() && !/^[0-9a-f]{16,}$/.test(node) ? node : '';
    }
    if (!Array.isArray(node)) return '';
    for (const item of node) {
      const hit = firstString(item);
      if (hit) return hit;
    }
    return '';
  }

  /**
   * 草稿本體之外、同一層還躺著的長字串就是 thinking（「顯示思考過程」）。
   * 手邊的樣本沒有 thinking，所以這裡刻意只掃草稿陣列的直接欄位、不往下鑽，
   * 而且**找不到就靜靜略過**，不丟錯也不硬塞東西進正文。
   */
  function thinkingOf(draft) {
    const out = [];
    for (let i = 2; i < draft.length; i += 1) {
      const value = draft[i];
      if (typeof value !== 'string' || value.length < 40) continue;
      if (/^(https?:|rc_|c_|r_)/.test(value)) continue;
      out.push(value);
    }
    return out.join('\n\n');
  }

  /** 工具呼叫的名字，例如 `youtube_tool`。 */
  function collectTools(response) {
    const names = new Set();
    const seen = new Set();
    const walk = (node, depth) => {
      if (!Array.isArray(node) || depth > 10 || seen.has(node)) return;
      seen.add(node);
      for (const item of node) {
        if (typeof item === 'string' && /^[a-z0-9]+(_[a-z0-9]+)*_tool$/.test(item)) names.add(item);
        else walk(item, depth + 1);
      }
    };
    walk(response, 0);
    return [...names];
  }

  /**
   * 引用來源：找出所有非資產的 http(s) 網址，標題取同一層、它前面最近的一個字串。
   *
   * `body` 是已經產好的正文，用來把「內文裡已經有的連結」濾掉——Gemini 的 payload
   * 除了正文之外還躺著一份渲染用的 structured content 鏡像，不濾的話每個
   * `[03:17](…&t=197)` 這種行內連結都會在 Sources 再列一次，整段變成雜訊。
   */
  function collectSources(response, body) {
    const out = [];
    const seenUrl = new Set();
    const seenNode = new Set();

    const walk = (node, depth) => {
      if (!Array.isArray(node) || depth > 10 || seenNode.has(node)) return;
      seenNode.add(node);
      for (let i = 0; i < node.length; i += 1) {
        const value = node[i];
        if (typeof value !== 'string') {
          walk(value, depth + 1);
          continue;
        }
        if (!/^https?:\/\//.test(value) || ASSET_HOST_RE.test(value) || seenUrl.has(value))
          continue;
        seenUrl.add(value);
        if (body.includes(value)) continue;
        let title = '';
        for (let j = i - 1; j >= 0; j -= 1) {
          const candidate = node[j];
          if (
            typeof candidate === 'string' &&
            candidate.trim().length > 3 &&
            !/^https?:\/\//.test(candidate) &&
            !/^[a-z0-9_-]+$/i.test(candidate) // 純 id / slug 不是標題
          ) {
            title = candidate.trim();
            break;
          }
        }
        out.push({ url: value, title });
      }
    };

    walk(response, 0);
    return out;
  }

  /** `turn[4]` 是 `[epoch 秒, 奈秒]`，share 與 app 兩種 payload 都有這格。 */
  function turnTime(turn) {
    const stamp = turn[4];
    return Array.isArray(stamp) && typeof stamp[0] === 'number' ? stamp[0] : undefined;
  }

  /**
   * app 頁的歷史 RPC 把型號寫在 response 的某一格（實測是 `"3 Flash"`），
   * share 頁的 response 沒有這格、型號在容器的 meta 裡。
   * 位置會變所以認字樣不認索引 —— 順便擋掉同一層那些 `"JP"` / `"zh"` / 16 進位 id。
   */
  const MODEL_LABEL_RE = /^(\d+(\.\d+)?\s+)?(flash|pro|ultra|nano)(\s+\S+)?$/i;

  function modelOf(turn) {
    if (!Array.isArray(turn[3])) return '';
    for (const value of turn[3]) {
      if (typeof value === 'string' && MODEL_LABEL_RE.test(value.trim())) return value.trim();
    }
    return '';
  }

  function turnToSections(turn, opts) {
    const sections = [];
    const time = turnTime(turn);

    const userText = firstString(turn[2]);
    if (userText) sections.push({ role: 'User', model: '', time, body: userText });

    const response = turn[3];
    const drafts = collectMatches(response, isDraft);
    if (drafts.length === 0) {
      // 沒見過的形狀不靜默丟掉，寧可留 JSON（但預設不塞進正文，避免整篇被雜訊淹掉）。
      if (opts.includeTools) {
        sections.push({ role: 'Assistant', model: modelOf(turn), time, body: jsonFence(response) });
      }
      return sections;
    }

    const parts = [];
    if (opts.includeThinking) {
      const thinking = thinkingOf(drafts[0]);
      if (thinking) parts.push(`**Thinking**\n\n${thinking}`);
    }
    parts.push(String(drafts[0][1][0] ?? ''));

    if (opts.includeDrafts) {
      drafts.slice(1).forEach((draft, index) => {
        parts.push(`---\n\n**Draft ${index + 2}**\n\n${String(draft[1][0] ?? '')}`);
      });
    }

    if (opts.includeTools) {
      const tools = collectTools(response);
      if (tools.length > 0) parts.push(`**Tools**\n\n${tools.map((t) => `- ${t}`).join('\n')}`);
      const sources = sourcesBlock(collectSources(response, parts.join('\n\n')));
      if (sources) parts.push(sources);
    }

    sections.push({
      role: 'Assistant',
      model: modelOf(turn),
      time,
      body: parts.filter(Boolean).join('\n\n'),
    });
    return sections;
  }

  function normalize(hit, ctx, opts) {
    if (hit.dom) {
      return {
        source: 'gemini',
        sourceLabel: 'Gemini（從畫面擷取，可能不完整）',
        title: hit.dom.title,
        url: ctx.url,
        ids: { conversation_id: ctx.conversationId || '', share_id: ctx.shareId || '' },
        model: '',
        createdAt: undefined,
        sections: hit.dom.messages.map((message) => ({
          role: message.role,
          model: '',
          time: undefined,
          body: message.body,
        })),
      };
    }

    const { turns, meta, shareId, created } = hit.convo;

    // 同一份 payload 有時會重複帶到同一輪，用 response id 去重。
    const seen = new Set();
    const sections = [];
    for (const turn of turns) {
      const id = turn[0][1];
      if (seen.has(id)) continue;
      seen.add(id);
      sections.push(...turnToSections(turn, opts));
    }

    const conversationId = String(turns[0]?.[0]?.[0] || '').replace(/^c_/, '');

    return {
      source: 'gemini',
      sourceLabel: 'Gemini',
      // app 頁載歷史的 RPC 沒有 meta 那格，標題只能退回頁面本身；
      // domTitle() 找不到可用的標題時一樣回 DEFAULT_TITLE，所以這條退路不會更糟。
      title: (typeof meta?.[1] === 'string' && meta[1].trim()) || domTitle(),
      url: ctx.url,
      ids: {
        conversation_id: conversationId || ctx.conversationId || '',
        share_id: shareId || ctx.shareId || '',
      },
      // share 頁：meta[7] 是 `[2, "<modelId>", "Flash"]`，第三格才是給人看的名字。
      // app 頁沒有 meta，型號只能從 response 認字樣（實測是 `"3 Flash"`）。
      model: (typeof meta?.[7]?.[2] === 'string' && meta[7][2]) || modelOf(turns[0] || []),
      // share 頁容器帶了整段對話的建立時間；app 頁沒有，退回第一輪的時間戳。
      createdAt: typeof created?.[0] === 'number' ? created[0] : turnTime(turns[0] || []),
      sections,
    };
  }

  // ------------------------------------------------------------------ 動作

  async function doExport({ mode, to, ids }) {
    ui.setStatus('讀取對話…');
    try {
      const target = ids || currentIds();
      const hit = await resolveConversation(target);
      const url = target.shareId ? `${location.origin}/share/${target.shareId}` : location.href;
      log('using payload from', hit.url || hit.source, '| rpcid:', hit.rpcid || '(none)');

      const doc = normalize(hit, { ...target, url }, settings);
      const text =
        mode === 'json'
          ? JSON.stringify(hit.data ?? hit.dom, null, 2)
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

  /** 別的對話要換到那一頁才抓得到（尤其短網址解不出 id），所以一律開分頁交棒過去。 */
  function exportFromShareUrl(raw) {
    const target = shareTargetFromUrl(raw);
    if (!target) {
      ui.setStatus('這不像 Gemini share URL（要有 /share/<id> 或 share.gemini.google/<code>）。');
      return;
    }
    if (target.shareId && target.shareId === currentIds().shareId) {
      doExport({ mode: 'transcript', to: 'clipboard' });
      return;
    }
    GM_setValue(PENDING_KEY, { shareId: target.shareId, expires: Date.now() + 120_000 });
    GM_openInTab(target.url, { active: true });
    ui.setStatus('已開新分頁，那邊載完就會自動複製。');
  }

  async function consumePending() {
    const pending = GM_getValue(PENDING_KEY, null);
    if (!pending || typeof pending !== 'object') return;
    const { shareId } = currentIds();
    if (!shareId) return;
    // 短網址交棒時存的是 null（那時候還不知道真的 id），落到任何 share 頁都算數。
    if (pending.shareId && pending.shareId !== shareId) return;

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
        label: '含工具呼叫與來源',
        get: () => settings.includeTools,
        set: (value) => setSetting('includeTools', value),
      },
      {
        label: '含其他候選草稿',
        get: () => settings.includeDrafts,
        set: (value) => setSetting('includeDrafts', value),
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
      const raw = prompt('貼上 Gemini share URL：');
      if (raw) exportFromShareUrl(raw);
    });
    GM_registerMenuCommand('Toggle thinking / reasoning', () => {
      setSetting('includeThinking', !settings.includeThinking);
      ui.openPanel();
      ui.setStatus(`thinking / reasoning：${settings.includeThinking ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Toggle 工具呼叫與來源', () => {
      setSetting('includeTools', !settings.includeTools);
      ui.openPanel();
      ui.setStatus(`工具呼叫與來源：${settings.includeTools ? '含' : '不含'}`);
    });
    GM_registerMenuCommand('Toggle 其他候選草稿', () => {
      setSetting('includeDrafts', !settings.includeDrafts);
      ui.openPanel();
      ui.setStatus(`其他候選草稿：${settings.includeDrafts ? '含' : '不含'}`);
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

    // SPA 換對話不會 reload，只要確保 UI 還在（API 路徑不碰 DOM，不需要重建狀態）。
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
