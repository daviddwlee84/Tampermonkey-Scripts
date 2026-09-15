// ==UserScript==
// @name         arXiv AI Assistant
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  在 arXiv 加入 papers.cool、Kimi 與 Gemini 入口，自動展開 FAQ 或送出繁中論文摘要請求
// @author       Da-Wei Lee
// @license      MIT
// @match        https://arxiv.org/abs/*
// @match        https://papers.cool/arxiv/*
// @match        https://gemini.google.com/app*
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyNDIgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkFBPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js
// ==/UserScript==

/**
 * 同一支腳本負責 arXiv 入口、papers.cool FAQ 與 Gemini 跨站交接。
 * Gemini composer 操作沿用 youtube-gemini-summary 的模式，使用獨立 namespace。
 * Kimi 採網站的 prefill deep link，無須在 Kimi 注入或呼叫模型 API。
 */
(function () {
  'use strict';

  const NS = 'arxiv-ai-assistant';
  const PANEL_ID = `${NS}-panel`;
  const NOTICE_ID = `${NS}-notice`;
  const PENDING_KEY = `${NS}.pending.v1`;
  const REQUEST_FRAGMENT_PARAM = NS;
  const REQUEST_ID_RE = /^[A-Za-z0-9-]{12,80}$/;
  const PENDING_TTL_MS = 120_000;
  const GEMINI_URL = 'https://gemini.google.com/app';
  const PAPER_ID_RE = /^(?:\d{4}\.\d{4,5}|[a-zA-Z][a-zA-Z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/;
  const log = (...args) => console.log(`[${NS}]`, ...args);
  let noticeTimer = null;

  function paperIdFromPath(pathname, prefix) {
    if (!pathname.startsWith(prefix)) return null;
    try {
      const id = decodeURIComponent(pathname.slice(prefix.length)).replace(/\/$/, '');
      return PAPER_ID_RE.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function normalizeText(text) {
    return (text || '')
      .replace(/\r\n?/g, '\n')
      .replaceAll('\u00a0', ' ')
      .replaceAll('\u200b', '')
      .trim();
  }

  function readPaper() {
    // citation_arxiv_id / citation_pdf_url 可能省略版本；目前網址才是版本來源。
    const id = paperIdFromPath(location.pathname, '/abs/');
    if (!id) return null;
    const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content;
    const withoutLabel = (selector) => {
      const clone = document.querySelector(selector)?.cloneNode(true);
      clone?.querySelectorAll('.descriptor').forEach((el) => el.remove());
      return clone?.textContent;
    };
    return {
      id,
      title: normalizeText(meta('citation_title') || withoutLabel('h1.title')) || `arXiv ${id}`,
      abstract: normalizeText(meta('citation_abstract') || withoutLabel('blockquote.abstract')),
    };
  }

  function promptFor(paper) {
    const baseId = paper.id.replace(/v\d+$/, '');
    return normalizeText(
      [
        '請用繁體中文協助我閱讀以下論文，先整理研究問題、方法、主要結果與限制，之後以這篇論文為背景回答我的問題。',
        '請區分論文內容與推測。如果無法讀取 PDF 全文或 FAQ，請明確說明，並根據實際取得的內容回答。FAQ 連結可能尚未有內容，也可能不是指定版本的解讀。',
        '',
        `論文題名：${paper.title}`,
        `arXiv ID：${paper.id}`,
        `論文頁面：https://arxiv.org/abs/${paper.id}`,
        `PDF：https://arxiv.org/pdf/${paper.id}`,
        `papers.cool：https://papers.cool/arxiv/${paper.id}`,
        `可參考的 FAQ：https://papers.cool/arxiv/kimi?${new URLSearchParams({ paper: baseId })}`,
        '',
        '以下是論文頁面提供的摘要：',
        paper.abstract || '（頁面未提供摘要，請使用以上連結。）',
      ].join('\n')
    );
  }

  function papersUrlFor(id) {
    return `https://papers.cool/arxiv/${id}#${REQUEST_FRAGMENT_PARAM}=faq`;
  }

  function kimiUrlFor(paper) {
    const url = new URL('https://www.kimi.com/_prefill_chat');
    url.search = new URLSearchParams({
      prefill_prompt: promptFor(paper),
      send_immediately: 'true',
    });
    return url.href;
  }

  function geminiUrlFor(requestId) {
    const url = new URL(GEMINI_URL);
    url.hash = new URLSearchParams({ [REQUEST_FRAGMENT_PARAM]: requestId });
    return url.href;
  }

  function requestIdFromFragment() {
    const value = new URLSearchParams(location.hash.slice(1)).get(REQUEST_FRAGMENT_PARAM);
    return value && REQUEST_ID_RE.test(value) ? value : null;
  }

  function clearRequestFragment() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has(REQUEST_FRAGMENT_PARAM)) return true;
    params.delete(REQUEST_FRAGMENT_PARAM);
    try {
      const hash = params.size ? `#${params}` : '';
      history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
      return !new URLSearchParams(location.hash.slice(1)).has(REQUEST_FRAGMENT_PARAM);
    } catch (error) {
      log('cannot clear request marker:', error);
      return false;
    }
  }

  function parsePending(value) {
    if (!value || typeof value !== 'object' || !REQUEST_ID_RE.test(value.requestId)) return null;
    const paper = value.paper;
    if (
      !paper ||
      typeof paper.id !== 'string' ||
      !PAPER_ID_RE.test(paper.id) ||
      typeof paper.title !== 'string' ||
      !paper.title.trim() ||
      typeof paper.abstract !== 'string' ||
      !Number.isFinite(value.createdAt) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= value.createdAt ||
      value.expiresAt - value.createdAt > PENDING_TTL_MS
    )
      return null;
    return {
      requestId: value.requestId,
      paper,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
    };
  }

  function deletePending() {
    try {
      GM_deleteValue(PENDING_KEY);
      return GM_getValue(PENDING_KEY, null) === null;
    } catch (error) {
      log('cannot delete pending request:', error);
      return false;
    }
  }

  function deletePendingRequest(requestId) {
    try {
      const current = parsePending(GM_getValue(PENDING_KEY, null));
      return current?.requestId === requestId && deletePending();
    } catch (error) {
      log('cannot verify pending request:', error);
      return false;
    }
  }

  function copyPrompt(prompt) {
    try {
      GM_setClipboard(prompt, 'text');
      return true;
    } catch (error) {
      log('cannot copy prompt:', error);
      return false;
    }
  }

  function installStyles() {
    GM_addStyle(`
      #${PANEL_ID}, #${NOTICE_ID} { box-sizing: border-box; font: 13px/1.5 system-ui, sans-serif; text-align: left; }
      #${PANEL_ID} { list-style: none; margin: 12px 0 4px; padding: 12px; border: 1px solid #d8c6ed; border-radius: 10px; background: #f7f2fd; color: #482667; }
      #${PANEL_ID} .${NS}-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; }
      #${PANEL_ID} .${NS}-badge { padding: 1px 6px; border-radius: 4px; background: #e9dff4; color: #624182; font-size: 10px; letter-spacing: .02em; }
      #${PANEL_ID} .${NS}-actions { display: flex; flex-wrap: wrap; gap: 7px; }
      #${PANEL_ID} a, #${PANEL_ID} button, #${NOTICE_ID} button {
        display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; margin: 0;
        min-height: 32px; max-width: 100%; padding: 5px 9px; border: 1px solid #cbb4e1; border-radius: 6px;
        background: #fff; color: #562980; font: 600 12px/1.5 system-ui, sans-serif; text-decoration: none; cursor: pointer;
      }
      #${PANEL_ID} a:hover, #${PANEL_ID} button:hover, #${NOTICE_ID} button:hover { background: #ede1fa; color: #3d1b5b; }
      #${PANEL_ID} :focus-visible, #${NOTICE_ID} :focus-visible { outline: 2px solid #8655b2; outline-offset: 2px; }
      #${PANEL_ID} button:disabled { opacity: .6; cursor: wait; }
      #${NOTICE_ID} { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(420px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow: auto; padding: 16px; border: 1px solid #cbb4e1; border-radius: 10px; background: #fcfaff; color: #332440; box-shadow: 0 8px 30px #0002; }
      #${NOTICE_ID}.${NS}-notice-error { border-color: #b74b59; }
      #${NOTICE_ID} strong, #${NOTICE_ID} p { display: block; margin: 0 0 8px; }
      #${NOTICE_ID} p:last-child { margin-bottom: 0; }
      #${NOTICE_ID} textarea { box-sizing: border-box; width: 100%; min-height: 120px; margin: 4px 0 10px; padding: 8px; resize: vertical; border: 1px solid #cbb4e1; border-radius: 6px; background: #fff; color: #332440; font: 12px/1.5 monospace; }
      #${NOTICE_ID} .${NS}-notice-actions { display: flex; justify-content: flex-end; gap: 8px; }
    `);
  }

  function makeLink(label, href, title) {
    const link = document.createElement('a');
    link.textContent = label;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = title;
    let openedAt = -Infinity;
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      if (Date.now() - openedAt < 1500) {
        event.preventDefault();
        return;
      }
      openedAt = Date.now();
      try {
        GM_openInTab(link.href, { active: true });
        event.preventDefault();
      } catch (error) {
        log('using native link navigation:', error);
      }
    });
    return link;
  }

  async function initArxiv() {
    const list = await waitFor(
      () => document.querySelector('.extra-services .full-text > ul'),
      20_000
    );
    if (!list || document.getElementById(PANEL_ID)) return;
    const paper = readPaper();
    if (!paper) return;
    const panel = document.createElement('li');
    panel.id = PANEL_ID;
    const heading = document.createElement('div');
    heading.className = `${NS}-heading`;
    const name = document.createElement('strong');
    name.textContent = 'AI 論文助手';
    const badge = document.createElement('span');
    badge.className = `${NS}-badge`;
    badge.textContent = 'Userscript';
    heading.append(name, badge);
    const actions = document.createElement('div');
    actions.className = `${NS}-actions`;
    const gemini = document.createElement('button');
    gemini.type = 'button';
    gemini.textContent = 'Gemini 摘要';
    gemini.title = '開啟 Gemini，自動送出繁中論文摘要請求';
    gemini.addEventListener('click', () => launchSummary(paper, gemini));
    actions.append(
      makeLink('papers.cool', papersUrlFor(paper.id), '開啟 papers.cool 並自動展開 Kimi FAQ'),
      makeLink('Kimi 摘要', kimiUrlFor(paper), '開啟 Kimi，自動送出繁中論文摘要請求'),
      gemini
    );
    panel.append(heading, actions);
    list.append(panel);
  }

  async function initPapersCool() {
    const id = paperIdFromPath(location.pathname, '/arxiv/');
    if (!id || new URLSearchParams(location.hash.slice(1)).get(REQUEST_FRAGMENT_PARAM) !== 'faq')
      return;
    // 先消耗標記，再等待網站；重新整理不會重複觸發 native POST / star。
    if (!clearRequestFragment()) {
      showStatus('無法啟動自動展開，請手動點擊這篇論文的 Kimi。', { error: true });
      return;
    }
    const baseId = id.replace(/v\d+$/, '');
    const target = await waitFor(() => {
      if (document.readyState !== 'complete') return null;
      const paper = document.getElementById(baseId);
      const button = document.getElementById(`kimi-${baseId}`);
      const container = document.getElementById(`kimi-container-${baseId}`);
      return paper?.classList.contains('paper') &&
        paper.contains(button) &&
        paper.contains(container)
        ? { button, container }
        : null;
    }, 20_000);
    if (!target) {
      showStatus('找不到這篇論文的 Kimi 按鈕，請在 papers.cool 手動開啟 FAQ。', { error: true });
      return;
    }
    const { button, container } = target;
    if (button.dataset.clickable === 'false' || isVisible(container)) return;
    button.click();
    // 僅確認原生 handler 已接手，後續的排隊、生成和錯誤訊息由網站處理。
    const started = await waitFor(
      () => button.dataset.clickable === 'false' || isVisible(container),
      1500
    );
    if (!started) showStatus('無法確認 FAQ 已展開，請手動檢查 Kimi 按鈕。', { error: true });
  }

  async function waitFor(predicate, timeout) {
    const deadline = Date.now() + timeout;
    do {
      const result = predicate();
      if (result) return result;
      await sleep(100);
    } while (Date.now() < deadline);
    return null;
  }

  function launchSummary(paper, button) {
    const prompt = promptFor(paper);
    let requestId = null;
    try {
      const raw = GM_getValue(PENDING_KEY, null);
      const existing = parsePending(raw);
      if (existing && !isPendingExpired(existing)) {
        showStatus('上一個 Gemini 摘要仍在開啟中，請稍候再試（最多兩分鐘）。', { duration: 5000 });
        return;
      }
      if (raw !== null && !deletePending()) throw new Error('cannot clear old request');
      button.disabled = true;
      button.textContent = '開啟中…';
      requestId = crypto.randomUUID();
      const createdAt = Date.now();
      GM_setValue(PENDING_KEY, {
        requestId,
        paper,
        createdAt,
        expiresAt: createdAt + PENDING_TTL_MS,
      });
      if (parsePending(GM_getValue(PENDING_KEY, null))?.requestId !== requestId) {
        throw new Error('pending request was not stored');
      }
      GM_openInTab(geminiUrlFor(requestId), { active: true });
      showStatus('已開啟 Gemini，新分頁載入後會自動送出。', { duration: 4000 });
    } catch (error) {
      if (requestId) deletePendingRequest(requestId);
      showManualFallback(
        '無法開啟 Gemini 新分頁。',
        prompt,
        '請開啟 Gemini 新對話，貼上這段提示後送出。'
      );
      log('cannot open Gemini:', error);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Gemini 摘要';
      }, 1500);
    }
  }
  const EDITOR_SELECTORS = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor.textarea.new-input-ui[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="prompt" i]',
  ];
  const SEND_SELECTORS = [
    '[data-test-id="send-button-container"] button',
    'gem-icon-button.send-button button',
    'button.send-button.submit',
    'button.send-button',
    'button[data-test-id="send-button"]',
    'button[aria-label*="send" i]',
    'button[mattooltip*="send" i]',
  ];

  function ensureNotice() {
    let notice = document.getElementById(NOTICE_ID);
    if (notice) return notice;

    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(notice);
    return notice;
  }

  function showStatus(message, { error = false, duration = 0 } = {}) {
    clearTimeout(noticeTimer);
    const notice = ensureNotice();
    notice.classList.toggle(`${NS}-notice-error`, error);
    notice.setAttribute('role', 'status');
    notice.replaceChildren();

    const text = document.createElement('p');
    text.textContent = message;
    notice.appendChild(text);

    if (duration > 0) {
      noticeTimer = setTimeout(() => notice.remove(), duration);
    }
  }

  function showManualFallback(reason, prompt, hint) {
    clearTimeout(noticeTimer);
    const copied = copyPrompt(prompt);
    const notice = ensureNotice();
    notice.classList.add(`${NS}-notice-error`);
    notice.setAttribute('role', 'alert');
    notice.replaceChildren();

    const title = document.createElement('strong');
    title.textContent = '無法自動完成';

    const detail = document.createElement('p');
    detail.textContent = `${reason}${copied ? ' Prompt 已複製到剪貼簿。' : ''}`;

    const instruction = document.createElement('p');
    instruction.textContent = hint;

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.value = prompt;
    textarea.setAttribute('aria-label', '可手動貼到 Gemini 的 prompt');

    const actions = document.createElement('div');
    actions.className = `${NS}-notice-actions`;

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '再次複製';
    copyButton.addEventListener('click', () => {
      const ok = copyPrompt(prompt);
      copyButton.textContent = ok ? '已複製' : '複製失敗';
      setTimeout(() => {
        if (copyButton.isConnected) copyButton.textContent = '再次複製';
      }, 1_500);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '關閉';
    closeButton.addEventListener('click', () => notice.remove());

    actions.append(copyButton, closeButton);
    notice.append(title, detail, instruction, textarea, actions);
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function isEnabled(element) {
    return !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
  }

  function findCandidate(selectors, predicate, root = document) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (predicate(element)) return element;
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForCandidate(
    selectors,
    predicate,
    timeout,
    expiresAt = Infinity,
    root = document
  ) {
    const deadline = Math.min(Date.now() + timeout, expiresAt);
    while (Date.now() < deadline) {
      const found = findCandidate(selectors, predicate, root);
      if (found) return found;
      await sleep(Math.min(200, Math.max(0, deadline - Date.now())));
    }
    return null;
  }

  function normalizedEditorText(editor) {
    const text =
      editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText || editor.textContent;
    return (text || '').replaceAll(' ', ' ').replaceAll('​', '').trim();
  }

  function composerRootForEditor(editor) {
    return (
      editor.closest('fieldset.input-area-container') ||
      editor.closest('input-area-v2') ||
      editor.closest('form') ||
      null
    );
  }

  function hasAttachmentDraft(editor) {
    const root = composerRootForEditor(editor);
    return Boolean(
      root &&
      Array.from(
        root.querySelectorAll(
          'uploader-file-preview-container, uploader-file-preview, .file-preview-chip, [data-test-id="file-preview"]'
        )
      ).some(isVisible)
    );
  }

  function dispatchInput(element, prompt) {
    try {
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: prompt,
        })
      );
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillEditor(editor, prompt) {
    editor.focus();
    if (normalizedEditorText(editor) !== '' || hasAttachmentDraft(editor)) return 'has-draft';

    if (editor instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(editor, prompt);
      else editor.value = prompt;
      dispatchInput(editor, prompt);
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);

      try {
        document.execCommand('insertText', false, prompt);
      } catch (error) {
        log('execCommand insertText failed:', error);
      }

      if (normalizedEditorText(editor) !== prompt) {
        // Preserve line breaks even in contenteditables without white-space: pre-wrap.
        // Text nodes also keep paper titles/abstracts from being interpreted as HTML.
        const fragment = document.createDocumentFragment();
        prompt.split('\n').forEach((line, index) => {
          if (index) fragment.append(document.createElement('br'));
          fragment.append(document.createTextNode(line));
        });
        editor.replaceChildren(fragment);
        dispatchInput(editor, prompt);
      }
    }

    await sleep(150);
    return normalizedEditorText(editor) === prompt ? 'filled' : 'failed';
  }

  function isFreshGeminiPath() {
    return location.pathname.replace(/\/+$/, '') === '/app';
  }

  function isPendingExpired(pending) {
    return Date.now() >= pending.expiresAt;
  }

  function fallbackExpired(pending, prompt, promptIsInEditor = false) {
    fallbackAndDiscard(
      pending,
      '摘要請求已過期。',
      prompt,
      promptIsInEditor
        ? 'Prompt 已在輸入框；請確認內容後手動按 Send，不要再次貼上。'
        : '請將已複製的 prompt 貼到目前的新對話後送出。'
    );
  }

  function fallbackAndDiscard(pending, reason, prompt, hint) {
    showManualFallback(reason, prompt, hint);
    if (!deletePendingRequest(pending.requestId)) {
      log('pending request was already replaced or could not be deleted');
    }
    clearRequestFragment();
  }

  async function waitForSubmission(editor, timeout) {
    const deadline = Date.now() + timeout;
    do {
      // Route change 本身不代表這一則真的送出；只接受原 composer 清空。
      if (editor.isConnected && normalizedEditorText(editor) === '') return true;
      await sleep(200);
    } while (Date.now() < deadline);
    return false;
  }

  async function consumePendingOnGemini() {
    const requestId = requestIdFromFragment();
    if (!requestId) return;

    let raw;
    try {
      raw = GM_getValue(PENDING_KEY, null);
    } catch (error) {
      clearRequestFragment();
      showStatus('無法讀取論文背景，請回 arXiv 重試。', { error: true });
      log('cannot read pending request:', error);
      return;
    }
    if (raw == null) {
      clearRequestFragment();
      showStatus('找不到這個摘要請求，請回 arXiv 再試一次。', { error: true });
      return;
    }

    const pending = parsePending(raw);
    if (!pending) {
      deletePending();
      clearRequestFragment();
      showStatus('摘要請求格式無效，請回 arXiv 再試一次。', { error: true });
      log('discarded malformed pending request');
      return;
    }
    if (pending.requestId !== requestId) {
      clearRequestFragment();
      showStatus('這個摘要請求已被較新的操作取代，請回 arXiv 再試一次。', {
        error: true,
      });
      return;
    }

    const prompt = promptFor(pending.paper);
    if (isPendingExpired(pending)) {
      fallbackExpired(pending, prompt);
      return;
    }
    if (!isFreshGeminiPath()) {
      fallbackAndDiscard(
        pending,
        'Gemini 沒有停在新對話頁。',
        prompt,
        '請先建立新對話，再貼上 prompt 後送出。'
      );
      return;
    }

    // 等待期間保留 pending + fragment；若頁面 reload，同一個 tab 還能重新接手。
    showStatus('正在準備摘要…');

    try {
      const editor = await waitForCandidate(EDITOR_SELECTORS, isVisible, 20_000, pending.expiresAt);
      if (!editor) {
        if (isPendingExpired(pending)) fallbackExpired(pending, prompt);
        else {
          fallbackAndDiscard(
            pending,
            '20 秒內找不到 Gemini 輸入框。',
            prompt,
            '請把 prompt 貼到 Gemini 輸入框後送出。'
          );
        }
        return;
      }
      if (!isFreshGeminiPath()) {
        fallbackAndDiscard(
          pending,
          'Gemini 已離開新對話頁。',
          prompt,
          '請先建立新對話，再貼上 prompt 後送出。'
        );
        return;
      }

      const composerRoot = composerRootForEditor(editor);
      if (!composerRoot) {
        fallbackAndDiscard(
          pending,
          '無法確認 Gemini 輸入框所屬的 composer。',
          prompt,
          '請把 prompt 貼到 Gemini 輸入框後手動送出。'
        );
        return;
      }

      const fillResult = await fillEditor(editor, prompt);
      if (isPendingExpired(pending)) {
        fallbackExpired(pending, prompt, normalizedEditorText(editor) === prompt);
        return;
      }
      if (fillResult === 'has-draft') {
        fallbackAndDiscard(
          pending,
          'Gemini 輸入框已有文字或附件，為了保留草稿不會自動覆寫。',
          prompt,
          '現有草稿沒有被修改；請另開新對話，再貼上 prompt 後送出。'
        );
        return;
      }
      if (fillResult !== 'filled') {
        fallbackAndDiscard(
          pending,
          'Gemini 沒有接受完整的 prompt。',
          prompt,
          '請清空輸入框，貼上 prompt 後送出。'
        );
        return;
      }

      const sendButton = await waitForCandidate(
        SEND_SELECTORS,
        (element) => isVisible(element) && isEnabled(element),
        8_000,
        pending.expiresAt,
        composerRoot
      );
      if (!sendButton) {
        if (isPendingExpired(pending)) {
          fallbackExpired(pending, prompt, normalizedEditorText(editor) === prompt);
        } else {
          fallbackAndDiscard(
            pending,
            '找不到可用的 Send 按鈕。',
            prompt,
            'Prompt 應已在輸入框；請先檢查內容，再手動按 Send。'
          );
        }
        return;
      }
      if (isPendingExpired(pending)) {
        fallbackExpired(pending, prompt, normalizedEditorText(editor) === prompt);
        return;
      }
      if (
        !isFreshGeminiPath() ||
        !editor.isConnected ||
        !sendButton.isConnected ||
        !isEnabled(sendButton) ||
        normalizedEditorText(editor) !== prompt ||
        hasAttachmentDraft(editor)
      ) {
        fallbackAndDiscard(
          pending,
          '送出前頁面或 prompt 已經改變。',
          prompt,
          '請確認目前是新對話，再貼上 prompt 後送出。'
        );
        return;
      }

      // 所有 async wait 都完成後才消耗；刪除失敗時絕不送出，避免 reload 後 duplicate。
      if (!deletePendingRequest(pending.requestId)) {
        showManualFallback(
          '無法安全地消耗摘要請求，因此沒有自動送出。',
          prompt,
          'Prompt 已在輸入框；請確認內容後手動按 Send。'
        );
        clearRequestFragment();
        return;
      }
      if (isPendingExpired(pending)) {
        showManualFallback(
          '摘要請求在送出前已過期，因此沒有自動送出。',
          prompt,
          'Prompt 已在輸入框；請確認內容後手動按 Send。'
        );
        clearRequestFragment();
        return;
      }
      clearRequestFragment();
      sendButton.click(); // 只 click 一次；不補 pointer/mouse events，避免重複送出。

      if (!(await waitForSubmission(editor, 5_000))) {
        showManualFallback(
          '無法確認 Gemini 是否已送出。',
          prompt,
          '請先檢查對話中是否已有這段 prompt；不要直接重貼，以免重複送出。'
        );
        return;
      }

      showStatus('已送出摘要請求。', { duration: 3_000 });
      log('submitted prompt for', pending.paper.id);
    } catch (error) {
      showManualFallback('操作 Gemini 時發生錯誤。', prompt, '請貼上 prompt 後手動送出。');
      deletePendingRequest(pending.requestId);
      clearRequestFragment();
      log('Gemini automation failed:', error);
    }
  }

  const host = location.hostname;
  const shouldRun =
    (host === 'arxiv.org' && paperIdFromPath(location.pathname, '/abs/')) ||
    (host === 'papers.cool' &&
      paperIdFromPath(location.pathname, '/arxiv/') &&
      new URLSearchParams(location.hash.slice(1)).get(REQUEST_FRAGMENT_PARAM) === 'faq') ||
    (host === 'gemini.google.com' && requestIdFromFragment());
  const runningAttribute = `data-${NS}-running`;
  if (
    !shouldRun ||
    window.top !== window.self ||
    document.documentElement.hasAttribute(runningAttribute)
  )
    return;
  document.documentElement.setAttribute(runningAttribute, 'true');
  installStyles();
  const run =
    host === 'arxiv.org'
      ? initArxiv
      : host === 'papers.cool'
        ? initPapersCool
        : consumePendingOnGemini;
  run().catch((error) => {
    log('initialization failed:', error);
    showStatus('AI 論文助手無法自動完成，請重新整理頁面後再試。', { error: true });
  });
})();
