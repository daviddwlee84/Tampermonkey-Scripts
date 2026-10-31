// ==UserScript==
// @name         Grok Export Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  將 Grok 對話匯出為 Markdown、Agent Handoff 或 JSON
// @author       Da-Wei Lee
// @license      MIT
// @match        https://grok.com/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyNjYgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkdFPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/chat-export.js
// @require      https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/export-ui.js
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/grok-export-markdown/grok-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/grok-export-markdown/grok-export-markdown.user.js
// ==/UserScript==

/* global createExportPanel, renderTranscript, fence, sourcesBlock, filenameFor, downloadText */
(function () {
  'use strict';
  if (window.top !== window.self) return;

  const VERSION = '0.1.0';
  const NS = 'grok-export-md';
  const EXPORTER = `grok-export-markdown v${VERSION}`;
  const MESSAGE_SELECTOR = '[data-testid="user-message"], [data-testid="assistant-message"]';
  const CONTENT_SELECTOR = '.response-content-markdown';
  const FETCH_TIMEOUT = 12_000;
  const DOM_TIMEOUT = 5_000;
  const SHARE_NOTICE = '此匯出僅包含已公開的分享快照，不代表完整私人對話歷史。';
  const DOM_NOTICE = '此匯出僅包含目前已載入的頁面訊息；未載入、收合或虛擬化內容可能缺漏。';
  const NOISE = [
    `[id^="${NS}"]`,
    '[data-no-copy]:not([data-no-copy="false"])',
    '.thinking-container',
    'script',
    'style',
    'svg',
    'button',
    '[role="button"]',
    'input',
    'textarea',
    'select',
    'form',
    'nav',
    '[data-code-block-header]',
  ].join(',');

  const panel = createExportPanel({
    ns: NS,
    buttonLabel: '⇩ Export MD',
    actions: [
      { label: 'Copy Markdown', run: () => doExport('markdown') },
      { label: 'Copy Agent Handoff', run: () => doExport('handoff') },
      { label: 'Download .md', run: () => doExport('md') },
      { label: 'Download .json', run: () => doExport('json') },
    ],
    storage: {
      get: (key, fallback) => GM_getValue(key, fallback),
      set: (key, value) => GM_setValue(key, value),
    },
    onStatus: (text) => console.log('[grok-export-markdown]', text),
  });

  // 只保留目前頁面節點的 identity，不快取其他對話的正文。
  let route = readRoute();
  let routeKey = currentKey();
  let generation = 0;
  let operation = null;
  let lastMessages = [];
  let staleMessages = [];
  let reconcileTimer = null;

  function readRoute() {
    const match = location.pathname.match(/^\/(share|c)\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) return null;
    return { kind: match[1], id: match[2], url: `${location.origin}/${match[1]}/${match[2]}` };
  }

  function currentKey() {
    return readRoute()?.url || `${location.origin}${location.pathname}`;
  }

  function messageNodes() {
    return [...document.querySelectorAll(MESSAGE_SELECTOR)].filter(
      (node) => !node.closest(`[id^="${NS}"]`)
    );
  }

  function responseId(node) {
    return node.closest('[id^="response-"]')?.id.slice('response-'.length) || '';
  }

  function staleNode(node) {
    const id = responseId(node);
    return staleMessages.some(
      (old) => (id && old.id === id) || (old.node === node && (!id || !old.id))
    );
  }

  function updateRoute() {
    const key = currentKey();
    if (key === routeKey) return;
    operation?.controller.abort();
    operation = null;
    generation += 1;
    // 連續換頁、但中間頁尚未載入時，仍須記住最早殘留的舊訊息。
    if (lastMessages.length) staleMessages = lastMessages;
    lastMessages = [];
    routeKey = key;
    route = readRoute();
    panel.setStatus(
      route ? '已切換頁面，請等目前對話載入後匯出。' : '請開啟 Grok 分享頁或 /c/ 對話頁。'
    );
  }

  function reconcile() {
    if (reconcileTimer !== null) clearTimeout(reconcileTimer);
    reconcileTimer = null;
    updateRoute();
    const nodes = messageNodes();
    if (!nodes.some(staleNode))
      lastMessages = nodes.map((node) => ({ node, id: responseId(node) }));
    if (!document.body) return;
    if (route) panel.mount();
    const root = document.getElementById(`${NS}-root`);
    if (root && root.hidden !== !route) root.hidden = !route;
  }

  function scheduleReconcile() {
    // 固定上限，不讓 streaming 每個 token 都重新延後工作。
    updateRoute();
    if (reconcileTimer === null) reconcileTimer = setTimeout(reconcile, 100);
  }

  function assertCurrent(op) {
    updateRoute();
    if (operation !== op || generation !== op.generation || op.controller.signal.aborted) {
      throw new DOMException('頁面或匯出操作已變更。', 'AbortError');
    }
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('匯出已取消。', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  async function fromShare(op) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    op.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, FETCH_TIMEOUT);
    try {
      const response = await fetch(
        `${location.origin}/rest/app-chat/share_links/${encodeURIComponent(op.route.id)}`,
        {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }
      );
      assertCurrent(op);
      if (!response.ok) throw new Error(`分享 API HTTP ${response.status}`);
      if (
        !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')
      ) {
        throw new Error('分享 API 未回傳 JSON（可能是登入或驗證頁）。');
      }
      const data = await response.json();
      assertCurrent(op);
      // 不要求 Markdown schema 完全可解析，讓 JSON 仍能作為格式改版時的救援。
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.error ||
        data.errors ||
        (!Object.hasOwn(data, 'responses') && !Object.hasOwn(data, 'conversation'))
      ) {
        throw new Error('分享 API 回傳的不是可辨識的對話資料。');
      }
      return { kind: 'share', data, route: op.route, warnings: [], partial: false };
    } catch (error) {
      assertCurrent(op);
      if (controller.signal.aborted) throw new Error('分享 API 等待逾時。');
      throw error;
    } finally {
      clearTimeout(timer);
      op.controller.signal.removeEventListener('abort', abort);
    }
  }

  function pageTitle() {
    const title = (document.title || '')
      .replace(/\s*\|\s*Shared Grok Conversation\s*$/i, '')
      .replace(/\s*[-–—|]\s*Grok\s*$/i, '')
      .trim();
    return title && !/^Grok$/i.test(title) ? title : 'Grok conversation';
  }

  function cleanClone(source) {
    const clone = source.cloneNode(true);
    const images = source.querySelectorAll('img');
    clone.querySelectorAll('img').forEach((image, index) => {
      const original = images[index];
      const src =
        original.currentSrc || original.getAttribute('src') || original.getAttribute('data-src');
      if (src) image.setAttribute('src', src);
    });
    for (const node of clone.querySelectorAll(NOISE)) node.remove();
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') node.removeAttribute(attr.name);
      }
    }
    return clone;
  }

  function domSnapshot(op) {
    const bubbles = messageNodes();
    // 換 URL 不等於換正文：寧可等待／報錯，不把舊泡泡貼上新對話 URL。
    if (!bubbles.length || bubbles.some(staleNode)) return null;
    const messages = [];
    const nodes = new Map();
    const warnings = [];
    for (const bubble of bubbles) {
      const parts = [];
      const roots = [...bubble.querySelectorAll(CONTENT_SELECTOR)].filter(
        (root) =>
          root.closest(MESSAGE_SELECTOR) === bubble && !root.parentElement.closest(CONTENT_SELECTOR)
      );
      for (const source of roots) {
        const clone = cleanClone(source);
        const placeholders = [...clone.querySelectorAll('.invisible.whitespace-pre-wrap')];
        const raw = placeholders.map((node) => node.textContent).join('\n\n');
        placeholders.forEach((node) => node.remove());
        const rendered = clone.textContent.trim() || clone.querySelector('img, pre, table, math');
        if (!rendered && raw.trim()) {
          parts.push({ format: 'markdown', content: raw });
        } else if (rendered) {
          const part = { format: 'html', content: clone.innerHTML };
          parts.push(part);
          nodes.set(part, clone);
        }
      }
      if (parts.length) {
        messages.push({
          id: responseId(bubble),
          role: bubble.getAttribute('data-testid') === 'user-message' ? 'User' : 'Assistant',
          parts,
        });
      } else {
        warnings.push('有訊息尚未載入或包含未支援的非文字內容。');
      }
      if (
        bubble.querySelector(
          '.inline-media-container img, .inline-media-container video, .inline-media-container a'
        )
      ) {
        warnings.push('獨立附件區未匯出；目前只保留正文內可辨識的圖片與連結。');
      }
    }
    if (!messages.length) return null;
    return {
      kind: 'dom',
      route: op.route,
      nodes,
      warnings,
      partial: true,
      data: {
        schema: 'grok-loaded-dom-v1',
        source: 'grok',
        url: op.route.url,
        title: pageTitle(),
        capturedAt: new Date().toISOString(),
        export_scope: 'loaded-dom',
        completeness: 'partial',
        messages,
      },
    };
  }

  async function fromDom(op) {
    const deadline = Date.now() + DOM_TIMEOUT;
    for (;;) {
      assertCurrent(op);
      const capture = domSnapshot(op);
      if (capture) return capture;
      if (Date.now() >= deadline)
        throw new Error('找不到可確認屬於目前對話的已載入訊息；請等待內容完成或重新載入頁面。');
      await delay(150, op.controller.signal);
    }
  }

  async function acquire(op) {
    if (op.route.kind === 'share') {
      try {
        return await fromShare(op);
      } catch (error) {
        assertCurrent(op);
        panel.setStatus(`${error.message} 改用已載入 DOM（可能不完整）。`);
        const capture = await fromDom(op);
        capture.warnings.push(`分享 API 無法讀取，已改用 DOM：${error.message}`);
        return capture;
      }
    }
    return fromDom(op);
  }

  function safeUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, base);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function linkDestination(url) {
    return url.replace(/[()<>\\]/g, (char) =>
      encodeURIComponent(char).replace(/\(/g, '%28').replace(/\)/g, '%29')
    );
  }

  function escapeText(text) {
    return String(text).replace(/([\\`*_[\]])/g, '\\$1');
  }

  /** 只轉換清理過的 clone；code／math 先保護，避免段落整理破壞內部空白。 */
  function htmlToMarkdown(root, base) {
    const protectedText = [];
    let prefix = '\u0000grok-code-';
    while (root.textContent.includes(prefix)) prefix += '-';
    const protect = (text) => `${prefix}${protectedText.push(text) - 1}\u0000`;
    const restore = (text) =>
      text.replace(new RegExp(`${prefix}(\\d+)\\u0000`, 'g'), (_, i) => protectedText[Number(i)]);
    const tidy = (text) =>
      text
        .replace(/\n[ \t]+(?=\n)/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const kids = (node) => [...node.childNodes].map(walk).join('');
    const block = (text) => `\n\n${text}\n\n`;

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      if (node.matches('.katex, .katex-display, math')) {
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if (tex)
          return node.matches('.katex-display, math[display="block"]')
            ? block(protect(`$$\n${tex}\n$$`))
            : protect(`$${tex}$`);
      }
      if (tag === 'pre') {
        const code = node.querySelector('code') || node;
        const language =
          code.className.match?.(/(?:^|\s)language-([\w+#.-]+)/)?.[1] ||
          code.getAttribute('data-language') ||
          node.getAttribute('data-language') ||
          '';
        return block(
          protect(fence(code.textContent, /^[\w+#.-]{1,30}$/.test(language) ? language : ''))
        );
      }
      if (tag === 'code') {
        const text = node.textContent.replace(/\n/g, ' ');
        const size = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length)) + 1;
        const ticks = '`'.repeat(size);
        const padding = /^[` ]|[` ]$/.test(text) ? ' ' : '';
        return protect(`${ticks}${padding}${text}${padding}${ticks}`);
      }
      if (/^h[1-6]$/.test(tag)) return block(`${'#'.repeat(Number(tag[1]))} ${kids(node).trim()}`);
      if (tag === 'br') return '\n';
      if (tag === 'hr') return block('---');
      if (tag === 'strong' || tag === 'b') return `**${kids(node)}**`;
      if (tag === 'em' || tag === 'i') return `*${kids(node)}*`;
      if (tag === 'del' || tag === 's') return `~~${kids(node)}~~`;
      if (tag === 'a') {
        const text = kids(node).trim();
        const url = safeUrl(node.getAttribute('href'), base);
        return url ? `[${text || escapeText(url)}](${linkDestination(url)})` : text;
      }
      if (tag === 'img') {
        const url = safeUrl(node.getAttribute('src') || node.getAttribute('data-src'), base);
        const alt = escapeText(node.getAttribute('alt') || 'image');
        return url ? `![${alt}](${linkDestination(url)})` : `[${alt}：圖片 URL 無法匯出]`;
      }
      if (tag === 'ul' || tag === 'ol') {
        const start = Number.parseInt(node.getAttribute('start') || '1', 10) || 1;
        const items = [...node.children].filter((child) => child.tagName === 'LI');
        return block(
          items
            .map((item, index) => {
              const marker = tag === 'ol' ? `${start + index}.` : '-';
              // 先還原 code 的多行內容再縮排，最後整段保護，保留巢狀 code 的空白。
              const content = restore(tidy(kids(item)));
              return protect(
                `${marker} ${content.replace(/\n/g, `\n${' '.repeat(marker.length + 1)}`)}`
              );
            })
            .join('\n')
        );
      }
      if (tag === 'blockquote')
        return block(protect(restore(tidy(kids(node))).replace(/^/gm, '> ')));
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')]
          .filter((row) => row.closest('table') === node)
          .map((row) =>
            [...row.children]
              .filter((cell) => /^(TH|TD)$/.test(cell.tagName))
              .map((cell) =>
                restore(tidy(kids(cell)))
                  .replace(/\|/g, '\\|')
                  .replace(/\n/g, '<br>')
              )
          );
        if (!rows.length) return '';
        const width = Math.max(...rows.map((row) => row.length));
        const row = (cells) =>
          `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
        return block(
          [row(rows[0]), row(Array(width).fill('---')), ...rows.slice(1).map(row)].join('\n')
        );
      }
      if (['p', 'div', 'section', 'article', 'figure', 'figcaption'].includes(tag))
        return block(kids(node));
      return kids(node);
    }
    return restore(tidy(walk(root)));
  }

  function baseDoc(capture) {
    const data = capture.data;
    const conversation = capture.kind === 'share' ? data.conversation || {} : {};
    return {
      source: 'grok',
      sourceLabel: 'Grok',
      title:
        typeof conversation.title === 'string' ? conversation.title : data.title || pageTitle(),
      url: capture.route.url,
      ids: {
        conversation_id:
          conversation.conversationId || (capture.route.kind === 'c' ? capture.route.id : ''),
        share_id: capture.route.kind === 'share' ? capture.route.id : '',
      },
      model: '',
      createdAt: conversation.createTime || '',
      sections: [],
    };
  }

  function normalize(capture) {
    const doc = baseDoc(capture);
    if (capture.kind === 'dom') {
      doc.sections = capture.data.messages.map((message) => ({
        role: message.role,
        body: message.parts
          .map((part) =>
            part.format === 'markdown'
              ? part.content
              : htmlToMarkdown(capture.nodes.get(part), doc.url)
          )
          .join('\n\n'),
      }));
      return doc;
    }
    const data = capture.data;
    if (!Array.isArray(data.responses))
      throw new Error('分享資料格式已變更；請下載原始 JSON 保存資料。');
    const seen = new Map();
    const warn = (text) => {
      capture.warnings.push(text);
      capture.partial = true;
    };
    for (const message of data.responses) {
      if (!message || typeof message !== 'object') {
        warn('有未支援的訊息格式，請下載原始 JSON。');
        continue;
      }
      if (message.isControl) continue;
      if (message.sender !== 'human' && message.sender !== 'assistant') {
        warn('有未知角色／工具訊息未納入正文；原始 JSON 仍保留。');
        continue;
      }
      if (message.responseId) {
        const serialized = JSON.stringify(message);
        if (seen.has(message.responseId)) {
          if (seen.get(message.responseId) !== serialized)
            warn('有衝突的重複 response ID，僅保留首次版本；請查看原始 JSON。');
          continue;
        }
        seen.set(message.responseId, serialized);
      }
      if (message.partial === true) warn('有尚未完成（partial）的回覆。');
      if (typeof message.message !== 'string') {
        warn('有未支援的非文字訊息，請下載原始 JSON。');
        continue;
      }
      let body = message.message;
      const cited = (
        Array.isArray(message.citedWebSearchResults) ? message.citedWebSearchResults : []
      )
        .map((source) => ({
          url: linkDestination(safeUrl(source?.url, doc.url)),
          title: escapeText(source?.title || source?.url || ''),
        }))
        .filter((source) => source.url);
      const sources = sourcesBlock(cited);
      if (sources) body += `\n\n${sources}`;
      for (const field of [
        'generatedImageUrls',
        'imageAttachments',
        'fileAttachments',
        'fileUris',
        'fileAttachmentsMetadata',
        'fileAttachmentAssetMetadata',
        'fileIds',
        'cardAttachmentsJson',
      ]) {
        const attachments = message[field];
        if (!Array.isArray(attachments) || !attachments.length) continue;
        for (const asset of attachments) {
          const rawUrl = typeof asset === 'string' ? asset : asset?.url;
          // 只接受明確的網路 URL，不能把 opaque file ID 當成網站相對路徑。
          const url = /^https?:\/\//i.test(rawUrl || '') ? safeUrl(rawUrl, doc.url) : '';
          if (!url) {
            warn('有未支援的附件參照未匯出；請查看原始 JSON。');
            continue;
          }
          const image = field === 'generatedImageUrls' || field === 'imageAttachments';
          const label = escapeText(
            asset?.fileName || asset?.name || (image ? 'image' : 'attachment')
          );
          const link = `${image ? '!' : ''}[${label}](${linkDestination(url)})`;
          if (!body.includes(url)) body += `\n\n${link}`;
        }
      }
      if (!body.trim()) {
        warn('有空白或尚未載入的訊息。');
        continue;
      }
      const model = typeof message.model === 'string' ? message.model : '';
      if (model) doc.model = model;
      doc.sections.push({
        role: message.sender === 'human' ? 'User' : 'Assistant',
        model,
        time: message.createTime,
        body,
      });
    }
    return doc;
  }

  function renderGrokTranscript(doc, capture, handoff) {
    const markdown = renderTranscript(doc, { handoff, exporter: EXPORTER });
    const end = markdown.indexOf('\n---\n', 4);
    if (!markdown.startsWith('---\n') || end < 0)
      throw new Error('共用 renderer 格式已變更，無法安全加入匯出範圍。');
    const scope = capture.kind === 'dom' ? 'loaded-dom' : 'published-share-snapshot';
    const state = capture.partial ? 'partial' : 'unknown';
    const metadata = `\nexport_scope: "${scope}"\ncompleteness: "${state}"`;
    const notices = [
      capture.kind === 'dom' ? DOM_NOTICE : SHARE_NOTICE,
      ...new Set(capture.warnings),
    ];
    const notice = notices.map((text) => `> ${text.replace(/[\r\n]+/g, ' ')}`).join('\n>\n');
    return `${markdown.slice(0, end)}${metadata}${markdown.slice(end, end + 5)}\n${notice}\n${markdown.slice(end + 5)}`;
  }

  async function doExport(mode) {
    reconcile();
    if (!route) {
      panel.setStatus('請開啟 Grok 分享頁或 /c/ 對話頁。');
      return;
    }
    operation?.controller.abort();
    const op = { route: { ...route }, generation, controller: new AbortController() };
    operation = op;
    panel.setStatus('正在讀取目前對話…');
    try {
      const capture = await acquire(op);
      assertCurrent(op);
      if (mode === 'json') {
        // JSON 不經 normalize / renderer；新格式造成 Markdown 失敗時仍可取回來源。
        const doc = baseDoc(capture);
        const text = JSON.stringify(capture.data, null, 2);
        assertCurrent(op);
        downloadText(
          filenameFor(doc, capture.kind === 'dom' ? 'dom-snapshot.json' : 'json'),
          text,
          'application/json;charset=utf-8'
        );
        panel.setStatus(
          capture.kind === 'dom'
            ? '已下載 DOM snapshot（僅已載入訊息，非原始 API JSON）。'
            : '已下載原始分享 JSON（公開快照，含未納入 Markdown 的欄位）。'
        );
      } else {
        const doc = normalize(capture);
        const text = renderGrokTranscript(doc, capture, mode === 'handoff');
        assertCurrent(op);
        if (mode === 'md') downloadText(filenameFor(doc, 'md'), text);
        else GM_setClipboard(text, 'text');
        panel.setStatus(
          `${mode === 'md' ? '已下載' : '已複製'} Markdown；${capture.kind === 'dom' ? 'DOM／僅已載入內容' : '公開分享快照'}${capture.warnings.length ? '（有部分內容限制，請看匯出說明）' : ''}。`
        );
      }
    } catch (error) {
      if (operation === op && !op.controller.signal.aborted)
        panel.setStatus(`匯出失敗：${error.message}`);
    } finally {
      if (operation === op) operation = null;
    }
  }

  GM_registerMenuCommand('Copy Markdown', () => doExport('markdown'));
  GM_registerMenuCommand('Copy Agent Handoff', () => doExport('handoff'));
  GM_registerMenuCommand('Download .md', () => doExport('md'));
  GM_registerMenuCommand('Download .json', () => doExport('json'));
  GM_registerMenuCommand('Reset button position', () => {
    panel.resetPosition();
    reconcile();
  });

  reconcile();
  new MutationObserver((records) => {
    if (records.some((record) => !record.target.closest?.(`[id^="${NS}"]`))) scheduleReconcile();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'data-testid'],
  });
  window.addEventListener('popstate', reconcile);
  window.addEventListener('hashchange', reconcile);
  setInterval(() => {
    if (currentKey() !== routeKey) reconcile();
  }, 250);
})();
