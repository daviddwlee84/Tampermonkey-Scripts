// ==UserScript==
// @name         YouTube Gemini Summary
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  在 YouTube 影片卡片與觀看頁一鍵開啟 Gemini，送出繁中摘要提示
// @author       Da-Wei Lee
// @license      MIT
// @match        https://www.youtube.com/*
// @match        https://gemini.google.com/app*
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCg5NiA2MiUgNDYlKSIvPjx0ZXh0IHg9IjMyIiB5PSIzMyIgZmlsbD0iI2ZmZiIgZm9udC1mYW1pbHk9IkhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjI3IiBmb250LXdlaWdodD0iNzAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0iY2VudHJhbCI+WUc8L3RleHQ+PC9zdmc+
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js
// ==/UserScript==

/**
 * YouTube Gemini Summary
 *
 * 同一支腳本在 YouTube 寫入短效 pending record，再由新開的 Gemini 分頁消費。
 * Gemini Web 沒有公開的 prompt deep link，所以 DOM automation 失敗時一定保留人工 fallback。
 */
(function () {
  'use strict';

  const NS = 'youtube-gemini-summary';
  const LOG_PREFIX = `[${NS}]`;
  const GEMINI_URL = 'https://gemini.google.com/app';
  const PENDING_KEY = `${NS}.pending.v1`;
  const REQUEST_FRAGMENT_PARAM = 'ytgs';
  const REQUEST_ID_RE = /^[A-Za-z0-9-]{12,80}$/;
  const PENDING_TTL_MS = 120_000;
  const PROMPT_PREFIX = '總結 ';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
  ]);

  const CARD_RENDERERS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytm-shorts-lockup-view-model-v2',
    'yt-lockup-view-model',
    'ytd-compact-video-renderer',
    'ytd-playlist-panel-video-renderer',
  ];
  const CARD_SELECTOR = CARD_RENDERERS.join(', ');
  const CARD_HOST_CLASS = `${NS}-card`;
  const CARD_BUTTON_CLASS = `${NS}-card-button`;
  const PAGE_BUTTON_ID = `${NS}-page-button`;
  const PAGE_BUTTON_CLASS = `${NS}-page-button`;
  const FLOATING_CLASS = `${NS}-floating`;
  const NOTICE_ID = `${NS}-notice`;

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

  const log = (...args) => console.log(LOG_PREFIX, ...args);
  let noticeTimer = null;

  function extractYouTubeVideoId(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

    let url;
    try {
      url = new URL(rawUrl, 'https://www.youtube.com');
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();
    let id = null;

    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (YOUTUBE_HOSTS.has(host)) {
      if (url.pathname === '/watch') {
        id = url.searchParams.get('v');
      } else {
        id = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
      }
    }

    return typeof id === 'string' && VIDEO_ID_RE.test(id) ? id : null;
  }

  function canonicalizeYouTubeUrl(rawUrl) {
    const id = extractYouTubeVideoId(rawUrl);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  }

  function promptFor(videoUrl) {
    return `${PROMPT_PREFIX}${videoUrl}`;
  }

  function createRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

    const words = new Uint32Array(4);
    crypto.getRandomValues(words);
    return `${Date.now().toString(36)}-${Array.from(words, (word) => word.toString(36)).join('-')}`;
  }

  function geminiUrlFor(requestId) {
    const url = new URL(GEMINI_URL);
    url.hash = new URLSearchParams({ [REQUEST_FRAGMENT_PARAM]: requestId }).toString();
    return url.href;
  }

  function requestIdFromFragment() {
    const requestId = new URLSearchParams(location.hash.slice(1)).get(REQUEST_FRAGMENT_PARAM);
    return requestId && REQUEST_ID_RE.test(requestId) ? requestId : null;
  }

  function clearRequestFragment() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has(REQUEST_FRAGMENT_PARAM)) return;

    params.delete(REQUEST_FRAGMENT_PARAM);
    const hash = params.size > 0 ? `#${params}` : '';
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
    } catch (error) {
      log('cannot clear request marker:', error);
    }
  }

  function parsePending(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!REQUEST_ID_RE.test(value.requestId)) return null;
    if (
      typeof value.videoUrl !== 'string' ||
      !Number.isFinite(value.createdAt) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= value.createdAt
    ) {
      return null;
    }

    const videoUrl = canonicalizeYouTubeUrl(value.videoUrl);
    if (!videoUrl || videoUrl !== value.videoUrl) return null;
    return {
      requestId: value.requestId,
      videoUrl,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
    };
  }

  function deletePending() {
    try {
      GM_deleteValue(PENDING_KEY);
      return true;
    } catch (error) {
      log('cannot delete pending request:', error);
      return false;
    }
  }

  function deletePendingRequest(requestId) {
    try {
      const current = parsePending(GM_getValue(PENDING_KEY, null));
      if (!current || current.requestId !== requestId) return false;
      return deletePending();
    } catch (error) {
      log('cannot verify pending request before deletion:', error);
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
      .${CARD_HOST_CLASS} {
        position: relative !important;
      }

      .${CARD_BUTTON_CLASS},
      .${PAGE_BUTTON_CLASS},
      #${NOTICE_ID} button {
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        background: rgba(24, 24, 27, 0.92);
        color: #fff;
        cursor: pointer;
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      }

      .${CARD_BUTTON_CLASS} {
        position: absolute;
        z-index: 2147483645;
        top: 8px;
        left: 8px;
        padding: 7px 10px;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-2px);
        transition: opacity 120ms ease, transform 120ms ease;
      }

      .${CARD_HOST_CLASS}:hover > .${CARD_BUTTON_CLASS},
      .${CARD_BUTTON_CLASS}:focus-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .${PAGE_BUTTON_CLASS} {
        min-height: 36px;
        margin-right: 8px;
        padding: 0 14px;
      }

      .${PAGE_BUTTON_CLASS}.${FLOATING_CLASS} {
        position: fixed !important;
        z-index: 2147483646;
        right: 24px;
        bottom: 88px;
        margin: 0;
      }

      .${CARD_BUTTON_CLASS}:hover,
      .${PAGE_BUTTON_CLASS}:hover,
      #${NOTICE_ID} button:hover {
        background: rgba(55, 65, 81, 0.96);
      }

      .${CARD_BUTTON_CLASS}:focus-visible,
      .${PAGE_BUTTON_CLASS}:focus-visible,
      #${NOTICE_ID} button:focus-visible {
        outline: 3px solid #8ab4f8;
        outline-offset: 2px;
      }

      .${CARD_BUTTON_CLASS}:disabled,
      .${PAGE_BUTTON_CLASS}:disabled,
      #${NOTICE_ID} button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      #${NOTICE_ID} {
        position: fixed;
        z-index: 2147483647;
        right: 24px;
        bottom: 24px;
        box-sizing: border-box;
        width: min(420px, calc(100vw - 48px));
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        background: rgba(24, 24, 27, 0.97);
        color: #f9fafb;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
      }

      #${NOTICE_ID}.${NS}-notice-error {
        border-color: rgba(248, 113, 113, 0.75);
      }

      #${NOTICE_ID} strong,
      #${NOTICE_ID} p {
        display: block;
        margin: 0 0 8px;
      }

      #${NOTICE_ID} p:last-child {
        margin-bottom: 0;
      }

      #${NOTICE_ID} textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 86px;
        margin: 4px 0 10px;
        padding: 9px;
        resize: vertical;
        border: 1px solid #6b7280;
        border-radius: 8px;
        background: #111827;
        color: #f9fafb;
        font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      #${NOTICE_ID} .${NS}-notice-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      #${NOTICE_ID} button {
        min-height: 34px;
        padding: 0 12px;
      }

      @media (hover: none) {
        .${CARD_BUTTON_CLASS} {
          opacity: 1;
          pointer-events: auto;
          transform: none;
        }
      }
    `);
  }

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

  function findVideoUrlInRoot(root) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      const videoUrl = canonicalizeYouTubeUrl(anchor.getAttribute('href') || anchor.href);
      if (videoUrl) return videoUrl;
    }
    return null;
  }

  function rootHasCollectionLink(root) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href') || anchor.href, 'https://www.youtube.com');
        if (
          YOUTUBE_HOSTS.has(url.hostname) &&
          (url.pathname === '/playlist' || url.pathname.startsWith('/course'))
        ) {
          return true;
        }
      } catch {
        // 壞掉的 href 交給下一個 anchor，不影響其他 card。
      }
    }
    return false;
  }

  function isCollectionLockup(card) {
    if (!card.matches('yt-lockup-view-model')) return false;
    return (
      rootHasCollectionLink(card) ||
      Boolean(card.shadowRoot && rootHasCollectionLink(card.shadowRoot))
    );
  }

  function findCardVideoUrl(card) {
    // Playlist/course lockup 可能內含第一支 lesson 的 watch link，但整張卡不是單一影片。
    if (isCollectionLockup(card)) return null;

    const direct = findVideoUrlInRoot(card);
    if (direct) return direct;

    if (card.shadowRoot) {
      const inCardShadow = findVideoUrlInRoot(card.shadowRoot);
      if (inCardShadow) return inCardShadow;
    }

    // YouTube 偶爾把真正的 link 放進 descendant 的 open shadow root；只在 light DOM 找不到時才掃。
    for (const element of card.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      const nested = findVideoUrlInRoot(element.shadowRoot);
      if (nested) return nested;
    }
    return null;
  }

  function directCardButtons(card) {
    return Array.from(card.children).filter((child) =>
      child.classList?.contains(CARD_BUTTON_CLASS)
    );
  }

  function cardHasRendererAncestor(card) {
    return Boolean(card.parentElement?.closest(CARD_SELECTOR));
  }

  function createCardButton(card) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = CARD_BUTTON_CLASS;
    button.textContent = '✨ Gemini';
    button.setAttribute('aria-label', '用 Gemini 總結這支影片');
    button.title = '用 Gemini 總結這支影片';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const currentVideoUrl = findCardVideoUrl(card);
      launchSummary(currentVideoUrl, button);
    });
    return button;
  }

  function syncCard(card) {
    const buttons = directCardButtons(card);
    if (cardHasRendererAncestor(card)) {
      buttons.forEach((button) => button.remove());
      card.classList.remove(CARD_HOST_CLASS);
      return;
    }

    const videoUrl = findCardVideoUrl(card);
    if (!videoUrl) {
      buttons.forEach((button) => button.remove());
      card.classList.remove(CARD_HOST_CLASS);
      return;
    }

    let button = buttons.shift();
    buttons.forEach((duplicate) => duplicate.remove());
    if (!button) {
      button = createCardButton(card);
      card.appendChild(button);
    }

    card.classList.add(CARD_HOST_CLASS);
    if (button.dataset.videoUrl !== videoUrl) button.dataset.videoUrl = videoUrl;
  }

  function findWatchActionContainer() {
    const selectors = [
      'ytd-watch-metadata #actions-inner ytd-menu-renderer #top-level-buttons-computed',
      'ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed',
      'ytd-watch-metadata #top-level-buttons-computed',
    ];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) ?? null;
  }

  function isCurrentVideoRoute() {
    return location.pathname === '/watch' || /^\/(?:shorts|live)\/[^/]+/.test(location.pathname);
  }

  function usesWatchActionRow() {
    return location.pathname === '/watch' || location.pathname.startsWith('/live/');
  }

  function createPageButton() {
    const button = document.createElement('button');
    button.id = PAGE_BUTTON_ID;
    button.type = 'button';
    button.className = PAGE_BUTTON_CLASS;
    button.textContent = '✨ Gemini';
    button.setAttribute('aria-label', '用 Gemini 總結目前影片');
    button.title = '用 Gemini 總結目前影片';
    button.addEventListener('click', () => {
      launchSummary(canonicalizeYouTubeUrl(location.href), button);
    });
    return button;
  }

  function syncPageButton() {
    const existing = Array.from(document.querySelectorAll(`#${PAGE_BUTTON_ID}`));
    let button = existing.shift() ?? null;
    existing.forEach((duplicate) => duplicate.remove());

    const videoUrl = isCurrentVideoRoute() ? canonicalizeYouTubeUrl(location.href) : null;
    if (!videoUrl) {
      button?.remove();
      return;
    }

    if (!button) button = createPageButton();
    if (button.dataset.videoUrl !== videoUrl) button.dataset.videoUrl = videoUrl;

    const watchActions = usesWatchActionRow() ? findWatchActionContainer() : null;
    if (watchActions) {
      button.classList.remove(FLOATING_CLASS);
      if (button.parentElement !== watchActions) watchActions.prepend(button);
    } else {
      button.classList.add(FLOATING_CLASS);
      if (button.parentElement !== document.body) document.body.appendChild(button);
    }
  }

  function scanYouTube() {
    document.querySelectorAll(CARD_SELECTOR).forEach(syncCard);
    syncPageButton();
  }

  function activePendingRequest() {
    const raw = GM_getValue(PENDING_KEY, null);
    if (raw == null) return null;

    const pending = parsePending(raw);
    if (!pending || isPendingExpired(pending)) {
      deletePending();
      return null;
    }
    return pending;
  }

  function setButtonBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? '開啟中…' : '✨ Gemini';
  }

  function launchSummary(rawUrl, button) {
    const videoUrl = canonicalizeYouTubeUrl(rawUrl);
    if (!videoUrl) {
      showStatus('找不到這張卡片目前對應的 YouTube 影片 URL。', { error: true, duration: 5_000 });
      return;
    }

    if (activePendingRequest()) {
      showStatus('上一個摘要仍在開啟中，請稍候再試。', { error: true, duration: 5_000 });
      return;
    }

    const prompt = promptFor(videoUrl);
    let requestId = null;
    setButtonBusy(button, true);

    try {
      requestId = createRequestId();
      const createdAt = Date.now();
      GM_setValue(PENDING_KEY, {
        requestId,
        videoUrl,
        createdAt,
        expiresAt: createdAt + PENDING_TTL_MS,
      });

      const stored = parsePending(GM_getValue(PENDING_KEY, null));
      if (!stored || stored.requestId !== requestId) {
        throw new Error('pending request was not stored');
      }

      GM_openInTab(geminiUrlFor(requestId), { active: true });
      showStatus('已開啟 Gemini，新分頁載入後會自動送出。', { duration: 4_000 });
      log('opened Gemini for', videoUrl);
    } catch (error) {
      if (requestId) deletePendingRequest(requestId);
      showManualFallback(
        '無法開啟 Gemini 新分頁。',
        prompt,
        '請自行開啟 Gemini，貼上這段 prompt 後送出。'
      );
      log('cannot open Gemini:', error);
    } finally {
      setTimeout(() => {
        if (button?.isConnected) setButtonBusy(button, false);
      }, 1_500);
    }
  }

  function initYouTube() {
    let scanScheduled = false;
    let lastUrl = location.href;

    const scheduleScan = () => {
      if (scanScheduled) return;
      scanScheduled = true;
      setTimeout(() => {
        scanScheduled = false;
        scanYouTube();
      }, 200);
    };

    scanYouTube();
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log('YouTube route changed:', lastUrl);
      }
      scheduleScan();
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('yt-navigate-finish', scheduleScan);
    document.addEventListener('yt-page-data-updated', scheduleScan);
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
    const field = editor.closest('.text-input-field');
    if (!field?.classList.contains('with-file-preview')) return false;

    return Boolean(
      field.querySelector(
        '.attachment-preview-wrapper uploader-file-preview-container, ' +
          '.attachment-preview-wrapper uploader-file-preview, ' +
          '.attachment-preview-wrapper .file-preview-chip, ' +
          '.attachment-preview-wrapper [data-test-id="file-preview"]'
      )
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
        editor.replaceChildren(document.createTextNode(prompt));
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

    const raw = GM_getValue(PENDING_KEY, null);
    if (raw == null) {
      clearRequestFragment();
      showStatus('找不到這個摘要請求，請回 YouTube 再試一次。', { error: true });
      return;
    }

    const pending = parsePending(raw);
    if (!pending) {
      deletePending();
      clearRequestFragment();
      showStatus('摘要請求格式無效，請回 YouTube 再試一次。', { error: true });
      log('discarded malformed pending request');
      return;
    }
    if (pending.requestId !== requestId) {
      clearRequestFragment();
      showStatus('這個摘要請求已被較新的操作取代，請回 YouTube 再試一次。', {
        error: true,
      });
      return;
    }

    const prompt = promptFor(pending.videoUrl);
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
      log('submitted prompt for', pending.videoUrl);
    } catch (error) {
      showManualFallback('操作 Gemini 時發生錯誤。', prompt, '請貼上 prompt 後手動送出。');
      deletePendingRequest(pending.requestId);
      clearRequestFragment();
      log('Gemini automation failed:', error);
    }
  }

  installStyles();
  if (location.hostname === 'www.youtube.com') {
    initYouTube();
  } else if (location.hostname === 'gemini.google.com') {
    consumePendingOnGemini();
  }
})();
