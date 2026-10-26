// ==UserScript==
// @name         Clean Share Helper
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  Threads／Instagram／Facebook／YouTube 一鍵複製乾淨連結，另提供任意網址去追蹤碼面板
// @author       Da-Wei Lee
// @license      MIT
// @match        https://*/*
// @match        http://*/*
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyMTYgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkNTPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/clean-share-helper/clean-share-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/clean-share-helper/clean-share-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  // BEGIN CORE
  // Keep retained query fields byte-for-byte: URLSearchParams serialization can
  // change '+' / '%20', duplicate values, and signatures unrelated to our rules.
  const GLOBAL_TRACKING = new Set([
    'fbclid',
    'gclid',
    'dclid',
    'msclkid',
    'gbraid',
    'wbraid',
    'mc_cid',
    'mc_eid',
    '_ga',
    '_gl',
  ]);
  const SITE_TRACKING = {
    threads: new Set(['xmt', 'igsh', 'igshid']),
    instagram: new Set(['igsh', 'igshid']),
    facebook: new Set(['mibextid', '__cft__', '__tn__']),
    youtube: new Set(['si', 'feature']),
  };
  const SIGNATURE_KEYS = new Set([
    'sig',
    'signature',
    'x-amz-signature',
    'x-goog-signature',
    'oauth_signature',
    'hmac',
  ]);

  function onDomain(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }
  function siteFor(host) {
    host = host.toLowerCase();
    if (onDomain(host, 'threads.com') || onDomain(host, 'threads.net')) return 'threads';
    if (onDomain(host, 'instagram.com')) return 'instagram';
    if (onDomain(host, 'facebook.com') || host === 'fb.watch') return 'facebook';
    if (onDomain(host, 'youtube.com') || host === 'youtu.be') return 'youtube';
    return null;
  }
  function httpUrl(raw, base) {
    try {
      const url = base ? new URL(raw, base) : new URL(raw);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }
  function decodeField(raw) {
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      return raw;
    }
  }
  function fieldsOf(raw) {
    const hashAt = raw.indexOf('#');
    const end = hashAt < 0 ? raw.length : hashAt;
    const queryAt = raw.indexOf('?');
    if (queryAt < 0 || queryAt >= end) return null;
    return {
      prefix: raw.slice(0, queryAt),
      suffix: raw.slice(end),
      fields: raw
        .slice(queryAt + 1, end)
        .split('&')
        .map((field) => {
          const equalAt = field.indexOf('=');
          return {
            raw: field,
            name: decodeField(equalAt < 0 ? field : field.slice(0, equalAt)),
            value: decodeField(equalAt < 0 ? '' : field.slice(equalAt + 1)),
          };
        }),
    };
  }
  function redirectTarget(url) {
    if (['l.facebook.com', 'lm.facebook.com'].includes(url.hostname) && url.pathname === '/l.php')
      return url.searchParams.get('u');
    if (url.hostname === 'l.instagram.com' && url.pathname === '/')
      return url.searchParams.get('u');
    if (onDomain(url.hostname, 'youtube.com') && url.pathname === '/redirect')
      return url.searchParams.get('q');
    return null;
  }
  function cleanUrl(input) {
    const original = String(input ?? '').trim();
    const result = { original, url: original, removed: [], unwrapped: [], warnings: [], error: '' };
    if (!httpUrl(original) || /[\u0000-\u0020\u007f]/.test(original)) {
      result.error = '請輸入完整 HTTP(S) 網址，一行一個。';
      return result;
    }
    let raw = original;
    const seen = new Set();
    for (let depth = 0; depth <= 8; depth++) {
      const url = httpUrl(raw);
      const query = fieldsOf(raw);
      if (query?.fields.some((field) => SIGNATURE_KEYS.has(field.name.toLowerCase()))) {
        result.warnings.push('含簽章參數，保留這段網址原樣。');
        result.url = raw;
        return result;
      }
      const site = siteFor(url.hostname);
      if (query) {
        const kept = query.fields.filter((field) => {
          const name = field.name.toLowerCase();
          const remove =
            /^utm_/.test(name) || GLOBAL_TRACKING.has(name) || SITE_TRACKING[site]?.has(name);
          if (remove) result.removed.push({ name: field.name, value: field.value, source: raw });
          return !remove;
        });
        if (kept.length !== query.fields.length) {
          const search = kept.map((field) => field.raw).join('&');
          raw = query.prefix + (search ? `?${search}` : '') + query.suffix;
        }
      }
      const target = redirectTarget(httpUrl(raw));
      if (!target) {
        result.url = raw;
        return result;
      }
      const next = httpUrl(target);
      if (!next || next.username || next.password || /[\u0000-\u0020\u007f]/.test(target)) {
        result.warnings.push('轉址目的地格式不支援，保留轉址連結。');
        result.url = raw;
        return result;
      }
      if (seen.has(target)) {
        result.warnings.push('偵測到重複轉址，停止解析。');
        result.url = raw;
        return result;
      }
      if (depth === 8) {
        // Roll back rather than return a partially unwrapped chain that would
        // change again on a second clean operation.
        return {
          ...result,
          url: original,
          removed: [],
          unwrapped: [],
          warnings: ['轉址超過八層，保留原網址。'],
        };
      }
      seen.add(raw);
      result.unwrapped.push({ from: raw, to: target });
      raw = target;
    }
  }

  // A content identity excludes share attribution, but never guesses a post ID
  // from arbitrary query fields or a different origin's canonical link.
  function contentLink(raw, site, base) {
    const url = httpUrl(raw, base);
    if (!url || siteFor(url.hostname) !== site || url.username || url.password) return null;
    const path = url.pathname;
    let key;
    if (site === 'threads')
      key = path
        .match(/^\/@([^/]+)\/post\/([\w-]+)\/?$/)
        ?.slice(1)
        .join('/');
    if (site === 'instagram')
      key = path.match(/^\/(?:[\w.]+\/)?(?:p|reel|reels)\/([\w-]+)\/?$/)?.[1];
    if (site === 'facebook') {
      key = path.match(/\/(?:posts|videos|reel|reels)\/([\w.-]+)\/?$/)?.[1];
      if (!key && /^\/(?:permalink|story)\.php$/.test(path))
        key = url.searchParams.get('story_fbid');
      if (!key && /^\/photo(?:\.php|\/)?$/.test(path)) key = url.searchParams.get('fbid');
      if (!key && /^\/watch\/?$/.test(path)) key = url.searchParams.get('v');
    }
    if (site === 'youtube') {
      if (url.hostname === 'youtu.be') key = path.match(/^\/([\w-]+)\/?$/)?.[1];
      else if (path === '/watch') key = url.searchParams.get('v');
      else key = path.match(/^\/(?:shorts|live)\/([\w-]+)\/?$/)?.[1];
    }
    return key ? { url: url.href, key: `${site}:${key}` } : null;
  }
  // END CORE

  if (window.top !== window || !/html/i.test(document.contentType || '')) return;
  const MARKER = 'data-clean-share-helper-running';
  if (document.documentElement.hasAttribute(MARKER)) return;
  document.documentElement.setAttribute(MARKER, '');

  const SITE = siteFor(location.hostname);
  const OWN = '[data-clean-share-helper]';
  const controls = new Map();
  const jobs = new Set();
  const SHARE_LABEL =
    /^(?:share(?: post| video| reel)?|send(?: post)?|分享(?:貼文|影片)?|共享|分享此貼文|傳送|发送|分享帖子)$/i;
  const FB_SHARE_LABEL = /^send this to friends or post it on your profile\.?$/i;
  let ui, shadow, dialog, input, output, copyAll, tooltip, toast, previousFocus;
  let tooltipOwner, tooltipTimer, toastTimer, scanTimer;
  let pageUrl = location.href;
  let generation = 0;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }
  function button(text, run, attrs = {}) {
    const node = el('button', text, { type: 'button', ...attrs });
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      run(event);
    });
    return node;
  }
  function stopPageEvents(root) {
    for (const type of ['click', 'pointerdown', 'keyup'])
      root.addEventListener(type, (event) => event.stopPropagation());
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (dialog?.open || (tooltip && !tooltip.hidden))) {
        event.preventDefault();
        if (dialog?.open) closePanel();
        hideTooltip();
      }
      event.stopPropagation();
    });
  }
  function ensureUI() {
    if (ui) return;
    ui = el('div', null, { id: 'clean-share-helper-ui', 'data-clean-share-helper': '' });
    shadow = ui.attachShadow({ mode: 'open' });
    const style = el(
      'style',
      `
      :host { all: initial; color-scheme: light dark; font: 14px/1.5 system-ui,sans-serif; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button,textarea { font: inherit; }
      button { cursor: pointer; border: 1px solid #aab6be; border-radius: 7px; padding: 7px 11px; background: #edf3f6; color: #162b37; }
      button:hover { background: #dcebf1; }
      button:focus-visible,textarea:focus-visible { outline: 3px solid #1482b9; outline-offset: 2px; }
      button:disabled { cursor: default; opacity: .55; }
      dialog,.tip,.toast { color: #172e3b; background: #fff; border: 1px solid #b8c6ce; box-shadow: 0 8px 35px #0003; }
      dialog { width: min(780px,calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 20px; border-radius: 14px; overflow: auto; }
      dialog::backdrop { background: #0007; }
      header,.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      header { justify-content: space-between; margin-bottom: 12px; }
      h2 { margin: 0; font-size: 20px; }
      label { display: block; margin: 10px 0 5px; }
      textarea { display: block; width: 100%; min-height: 105px; resize: vertical; border: 1px solid #9bafb9; border-radius: 7px; padding: 8px; background: #fff; color: #172e3b; }
      .actions { margin-top: 10px; }
      .hint,.status { font-size: 12px; color: #526775; }
      .result { border: 1px solid #b8c6ce; border-radius: 9px; margin-top: 12px; padding: 12px; }
      .result[data-status=error] { border-color: #bd4b4b; }
      dt { margin-top: 8px; font-size: 12px; color: #526775; }
      dd { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
      dl { margin: 0; }
      .warning { color: #855500; }
      .error { color: #ae2828; }
      .tip { position: fixed; z-index: 2147483647; pointer-events: none; width: min(460px,calc(100vw - 20px)); max-height: 60vh; overflow: hidden; border-radius: 10px; padding: 12px; font-size: 12px; }
      .tip dd { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
      .toast { position: fixed; z-index: 2147483647; bottom: 24px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 24px); border-radius: 9px; padding: 9px 16px; pointer-events: none; }
      @media (prefers-color-scheme: dark) {
        dialog,.tip,.toast { background: #19252e; color: #eef4f7; border-color: #506572; }
        button { background: #294553; color: #f2f7fa; border-color: #7693a2; }
        button:hover { background: #365b6d; }
        textarea { background: #101b22; color: #f2f7fa; }
        .hint,.status,dt { color: #b1c5d0; }
        .warning { color: #ffd280; }
        .error { color: #ffabab; }
      }
    `
    );
    tooltip = el('section', null, {
      class: 'tip',
      role: 'tooltip',
      id: 'clean-share-tooltip',
      hidden: '',
    });
    toast = el('div', null, { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: '' });
    dialog = el('dialog', null, { 'aria-labelledby': 'clean-share-heading' });
    const header = el('header');
    header.append(
      el('h2', '移除追蹤碼', { id: 'clean-share-heading' }),
      button('關閉', closePanel)
    );
    const label = el('label', 'HTTP(S) 網址（一行一個）', { for: 'clean-share-input' });
    input = el('textarea', null, {
      id: 'clean-share-input',
      spellcheck: 'false',
      placeholder: '貼上網址，或使用「目前頁面」',
    });
    const actions = el('div', null, { class: 'actions' });
    copyAll = button(
      '複製全部成功結果',
      () => {
        const urls = [...output.children]
          .map((row) => row.cleanResult)
          .filter((r) => r && !r.error)
          .map((r) => r.url);
        if (urls.length) void copy(urls.join('\n'));
      },
      { disabled: '' }
    );
    actions.append(
      button('清理網址', processInput),
      button('目前頁面', () => {
        input.value = location.href;
        processInput();
      }),
      copyAll
    );
    output = el('div', null, { 'aria-label': '清理結果' });
    dialog.append(
      header,
      label,
      input,
      actions,
      el('p', '預設僅在本機清理。只有按「展開短連結」才會向該網址送出請求。', { class: 'hint' }),
      output
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closePanel();
    });
    shadow.append(style, tooltip, toast, dialog);
    stopPageEvents(shadow);
    document.documentElement.append(ui);
  }
  function notify(message) {
    ensureUI();
    // Keep feedback in the modal's top layer, where it is visible and announced.
    (dialog.open ? dialog : shadow).append(toast);
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3500);
  }
  async function copy(text) {
    try {
      // GM_setClipboard is synchronous in VM, callback-capable in TM; failures
      // thrown by either manager are reported, never turned into success.
      await GM_setClipboard(text, 'text');
      notify('已複製乾淨網址');
    } catch {
      notify('複製失敗，請從詳細資訊手動選取網址。');
    }
  }
  function details(result) {
    const node = el('dl');
    const pair = (label, value) => node.append(el('dt', label), el('dd', value));
    pair('原網址', result.original);
    if (result.error) {
      node.append(el('dd', result.error, { class: 'error' }));
      return node;
    }
    if (result.expanded) pair('展開目的地', result.expanded);
    pair('清理結果', result.url);
    pair(
      '移除的參數',
      result.removed.length
        ? result.removed.map((item) => `${item.name}=${item.value}`).join('\n')
        : '無'
    );
    if (result.unwrapped.length) pair('本機解析轉址', `${result.unwrapped.length} 層`);
    for (const message of result.warnings) node.append(el('dd', message, { class: 'warning' }));
    return node;
  }
  function cancelJobs(message = '已取消展開。') {
    for (const job of [...jobs]) job.cancel(message);
  }
  function closePanel() {
    cancelJobs();
    dialog?.close();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function openPanel(value) {
    routeCheck();
    ensureUI();
    hideTooltip();
    if (!dialog.open) {
      previousFocus = document.activeElement;
      while (previousFocus?.shadowRoot?.activeElement)
        previousFocus = previousFocus.shadowRoot.activeElement;
      dialog.showModal();
    }
    if (value !== undefined) {
      input.value = value;
      processInput();
    }
    input.focus();
  }
  function processInput() {
    cancelJobs();
    output.replaceChildren();
    const lines = input.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const row = el('article', null, { class: 'result' });
      output.append(row);
      renderRow(row, cleanUrl(line));
    }
    updateCopyAll();
  }
  function updateCopyAll() {
    copyAll.disabled = ![...output.children].some(
      (row) => row.cleanResult && !row.cleanResult.error
    );
  }
  function renderRow(row, result, status = '') {
    row.cleanResult = result;
    row.dataset.status = result.error ? 'error' : 'ok';
    row.replaceChildren(details(result));
    if (!result.error) {
      const actions = el('div', null, { class: 'actions' });
      actions.append(
        button('複製乾淨網址', () => void copy(result.url)),
        button('展開短連結', (event) => expandRow(row, event.currentTarget))
      );
      row.append(actions);
    }
    row.append(el('p', status, { class: 'status', role: 'status' }));
    updateCopyAll();
  }
  function expandRow(row, trigger) {
    routeCheck();
    const before = row.cleanResult;
    const target = httpUrl(before.url);
    if (!target || target.username || target.password) {
      row.querySelector('.status').textContent = '不支援展開含帳號或密碼的網址。';
      return;
    }
    trigger.disabled = true;
    const status = row.querySelector('.status');
    status.textContent = '正在展開…';
    const startGeneration = generation;
    let request,
      settled = false;
    const job = {
      cancel(message) {
        finish(message);
        request?.abort();
      },
    };
    jobs.add(job);
    function finish(message, result = before) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      jobs.delete(job);
      if (row.isConnected) renderRow(row, result, message);
    }
    const timer = setTimeout(() => job.cancel('展開逾時，保留原結果。'), 10000);
    const nativeFetch = typeof GM_info === 'object' && GM_info.scriptHandler === 'Violentmonkey';
    function send(method) {
      try {
        const options = {
          method,
          url: before.url,
          anonymous: true,
          timeout: 10000,
          onload(response) {
            if (settled || generation !== startGeneration) return;
            if (method === 'HEAD' && [405, 501].includes(response.status)) {
              send('GET');
              return;
            }
            if (response.status < 200 || response.status >= 400) {
              finish('目的地回應失敗，保留原結果。');
              return;
            }
            const finalUrl = response.finalUrl || '';
            if (!finalUrl || finalUrl === before.url) {
              finish('未取得不同目的地；可能需要登入或 JavaScript 轉址。');
              return;
            }
            const next = cleanUrl(finalUrl);
            const nextUrl = httpUrl(next.url);
            if (next.error || !nextUrl || nextUrl.username || nextUrl.password) {
              finish('目的地格式不支援，保留原結果。');
              return;
            }
            finish('已展開，請自行複製清理結果。', {
              ...next,
              original: before.original,
              expanded: finalUrl,
              removed: [...before.removed, ...next.removed],
              unwrapped: [...before.unwrapped, ...next.unwrapped],
              warnings: [
                ...new Set([...before.warnings, ...next.warnings, ...(response.warnings || [])]),
              ],
            });
          },
          onerror() {
            finish('展開失敗或網域權限遭拒，保留原結果。');
          },
          ontimeout() {
            finish('展開逾時，保留原結果。');
          },
          onabort() {
            finish('已取消展開。');
          },
          onprogress(event) {
            if (event.loaded > 1024 * 1024) job.cancel('回應內容過大，保留原結果。');
          },
        };
        if (nativeFetch) {
          // VM 2.49 MV3's anonymous XHR strips cookies only on the first hop.
          // Native fetch enforces omission for the whole chain. Never fall back
          // to credentialed manager XHR when CORS denies the destination.
          const controller = new AbortController();
          request = { abort: () => controller.abort() };
          fetch(before.url, {
            method,
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          })
            .then((response) => {
              // Only headers and URL are needed, including for GET fallback.
              void response.body?.cancel().catch(() => {});
              const hash = before.url.indexOf('#');
              options.onload({
                status: response.status,
                finalUrl: response.redirected
                  ? response.url + (hash < 0 ? '' : before.url.slice(hash))
                  : before.url,
                warnings: response.redirected
                  ? ['瀏覽器展開不提供目的地的定位片段；已保留輸入網址的定位片段（若有）。']
                  : [],
              });
            })
            .catch(() => finish('展開失敗，目的地可能未允許跨站讀取，保留原結果。'));
        } else request = GM_xmlhttpRequest(options);
      } catch {
        finish('無法展開或網域權限遭拒，保留原結果。');
      }
    }
    send('HEAD');
  }

  function shareControls(root) {
    const found = new Set();
    const nodes = root.querySelectorAll('[aria-label],[title],svg title,button,[role="button"]');
    for (const node of nodes) {
      if (node.closest(OWN)) continue;
      const label = (
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        (node.matches('svg title') ? node.textContent : '')
      ).trim();
      const text = node.matches('button,[role="button"]') ? node.textContent.trim() : '';
      if (
        !SHARE_LABEL.test(label) &&
        !(SITE === 'facebook' && FB_SHARE_LABEL.test(label)) &&
        !SHARE_LABEL.test(text)
      )
        continue;
      const control = node.closest('button,[role="button"]');
      if (control && !control.closest(OWN)) found.add(control);
    }
    return [...found];
  }
  function visible(node) {
    return (
      node.isConnected &&
      !node.closest('[hidden],[aria-hidden="true"]') &&
      node.getClientRects().length > 0
    );
  }
  function candidatesIn(scope, control) {
    const article = control.closest('article,[role="article"]');
    const candidates = [];
    for (const link of scope.querySelectorAll('a[href]')) {
      if (link.closest(OWN)) continue;
      if (article && link.closest('article,[role="article"]') !== article) continue;
      // Threads quote cards can have their own pressable container. Never use
      // one of those links as the parent post's permalink.
      if (SITE === 'threads') {
        const pressable = link.closest('[data-pressable-container]');
        if (pressable && scope.contains(pressable) && !pressable.contains(control)) continue;
      }
      const content = contentLink(link.getAttribute('href'), SITE, location.href);
      if (content)
        candidates.push({ ...content, timed: !!link.querySelector('time,abbr,[data-utime]') });
    }
    const timed = candidates.filter((item) => item.timed);
    const pool = timed.length ? timed : candidates;
    const identities = new Map(pool.map((item) => [item.key, item]));
    return identities.size === 1 ? [...identities.values()][0] : null;
  }
  function youtubeSource(control) {
    const route = contentLink(location.href, 'youtube');
    if (!route) return null;
    const short = control.closest('ytd-reel-video-renderer');
    if (short) {
      if (!short.hasAttribute('is-active')) return null;
      const links = [...short.querySelectorAll('a[href*="/shorts/"]')]
        .map((link) => contentLink(link.href, 'youtube'))
        .filter(Boolean);
      if (links.some((link) => link.key !== route.key)) return null;
    } else if (
      !control.closest('ytd-watch-metadata,ytd-watch-flexy,ytd-reel-player-overlay-renderer')
    )
      return null;
    return route.url;
  }
  function sourceFor(control) {
    if (!visible(control)) return null;
    if (SITE === 'youtube') return youtubeSource(control);
    const boundary =
      control.closest('article,[role="article"]') ||
      (SITE === 'threads' ? control.closest('[data-pressable-container]') : null);
    let scope = control.parentElement;
    for (let depth = 0; scope && depth < 12; depth++, scope = scope.parentElement) {
      if (
        scope === document.body ||
        scope === document.documentElement ||
        scope.matches('main,[role="main"]')
      )
        break;
      if (!boundary && shareControls(scope).length > 1) break;
      const match = candidatesIn(scope, control);
      if (match) return match.url;
      if (scope === boundary || scope.matches('article,[role="article"]')) break;
      // Stop before a feed container can associate a post without a permalink
      // with a neighbouring post. Nested quote/reply ambiguity stays disabled.
      if (shareControls(scope).length > 1) break;
    }
    // Fullscreen Reels can omit an in-card permalink. Only use the route when
    // exactly one share control is visible in that view, never for a feed card.
    if (SITE === 'instagram' || SITE === 'facebook') {
      const route = contentLink(location.href, SITE);
      if (route && /\/(?:reel|reels|videos)\//.test(new URL(route.url).pathname)) {
        const view = control.closest('[role="dialog"]') || document;
        const active = shareControls(view).filter((node) => {
          const rect = node.getBoundingClientRect();
          return (
            visible(node) &&
            rect.bottom > 0 &&
            rect.top < innerHeight &&
            rect.right > 0 &&
            rect.left < innerWidth
          );
        });
        if (active.length === 1 && active[0] === control) return route.url;
      }
    }
    return null;
  }
  function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipOwner?.removeAttribute('aria-description');
    tooltipOwner = null;
    if (tooltip) tooltip.hidden = true;
  }
  function showTooltip(owner, raw) {
    clearTimeout(tooltipTimer);
    if (!raw) {
      hideTooltip();
      return;
    }
    ensureUI();
    hideTooltip();
    tooltip.replaceChildren(
      details(cleanUrl(raw)),
      el('p', '點 ⓘ 可固定查看完整資訊。', { class: 'hint' })
    );
    tooltip.hidden = false;
    tooltipOwner = owner;
    // The tooltip is outside this button's shadow tree, so use aria-description
    // here rather than an IDREF that cannot cross a shadow boundary.
    owner.setAttribute('aria-description', `清理結果：${cleanUrl(raw).url}`);
    const rect = owner.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(10, Math.min(innerWidth - box.width - 10, rect.left))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(innerHeight - box.height - 10, rect.bottom + 8))}px`;
  }
  function mountControl(control) {
    const host = el('span', null, { 'data-clean-share-helper': '', class: 'clean-share-action' });
    host.style.cssText =
      'display:inline-flex;vertical-align:middle;flex-shrink:0;position:relative;z-index:1;';
    const root = host.attachShadow({ mode: 'open' });
    const main = button(
      '🔗',
      () => {
        routeCheck();
        const raw = sourceFor(control);
        if (!raw) {
          notify('無法確定這篇內容的網址，請使用管理器的清理面板。');
          return;
        }
        const result = cleanUrl(raw);
        if (result.error) {
          notify(result.error);
          return;
        }
        void copy(result.url);
      },
      { 'aria-label': '複製乾淨網址', title: '複製乾淨網址' }
    );
    const info = button(
      'ⓘ',
      () => {
        routeCheck();
        const raw = sourceFor(control);
        if (raw) openPanel(raw);
        else notify('無法確定這篇內容的網址。');
      },
      { 'aria-label': '查看連結清理明細', title: '查看連結清理明細' }
    );
    root.append(
      el(
        'style',
        `
      :host { all: initial; display: inline-flex; vertical-align: middle; }
      button { box-sizing: border-box; font: 14px/1 system-ui,sans-serif; color: #54717f; background: transparent; border: 0; border-radius: 6px; min-width: 28px; height: 30px; cursor: pointer; padding: 4px; }
      button:hover { background: #7c9baa25; }
      button:focus-visible { outline: 2px solid #1482b9; outline-offset: 1px; }
      @media (prefers-color-scheme: dark) { button { color: #b8ceda; } }
    `
      ),
      main,
      info
    );
    stopPageEvents(root);
    for (const node of [main, info]) {
      node.addEventListener('mouseenter', () => {
        routeCheck();
        showTooltip(node, sourceFor(control));
      });
      node.addEventListener('focus', () => {
        routeCheck();
        showTooltip(node, sourceFor(control));
      });
      node.addEventListener('mouseleave', () => {
        tooltipTimer = setTimeout(hideTooltip, 100);
      });
      node.addEventListener('blur', hideTooltip);
    }
    const anchor = placementFor(control);
    anchor.after(host);
    controls.set(control, { host, anchor });
  }
  function placementFor(control) {
    return SITE === 'youtube'
      ? control.closest('ytd-button-renderer,yt-button-view-model') || control
      : control;
  }
  // YouTube's native share dialog owns its chosen timestamp/playlist URL.
  // Add a separate action without replacing its input or original Copy button.
  function reconcileYoutubeDialogs() {
    for (const renderer of document.querySelectorAll(
      'ytd-unified-share-panel-renderer,ytd-share-panel-renderer,yt-unified-share-panel-renderer,yt-share-panel-renderer'
    )) {
      const field = renderer.querySelector('input#share-url,input[readonly]');
      const existing = renderer.querySelector('.clean-share-dialog-action');
      if (!field || !contentLink(field.value, 'youtube') || !visible(field)) {
        existing?.remove();
        continue;
      }
      if (existing) continue;
      const host = el('span', null, {
        class: 'clean-share-dialog-action',
        'data-clean-share-helper': '',
      });
      const root = host.attachShadow({ mode: 'open' });
      const action = button('複製乾淨網址', () => {
        const raw = field.value;
        if (contentLink(raw, 'youtube')) void copy(cleanUrl(raw).url);
      });
      action.style.cssText =
        'font:14px system-ui;cursor:pointer;padding:8px;margin:6px;border:1px solid #8aa4b2;border-radius:8px;color:#153a4e;background:#edf5f9;';
      action.addEventListener('mouseenter', () => showTooltip(action, field.value));
      action.addEventListener('focus', () => showTooltip(action, field.value));
      action.addEventListener('mouseleave', hideTooltip);
      action.addEventListener('blur', hideTooltip);
      root.append(
        action,
        button('ⓘ', () => openPanel(field.value), { 'aria-label': '查看連結清理明細' })
      );
      stopPageEvents(root);
      field.parentElement.append(host);
    }
  }
  function routeCheck() {
    if (pageUrl === location.href) return;
    pageUrl = location.href;
    generation++;
    hideTooltip();
    cancelJobs('已換頁，展開已取消。');
    scheduleScan();
  }
  function scan() {
    scanTimer = null;
    routeCheck();
    for (const [control, record] of controls) {
      if (!sourceFor(control)) {
        record.host.remove();
        controls.delete(control);
      } else {
        record.anchor = placementFor(control);
        if (record.anchor.nextSibling !== record.host) record.anchor.after(record.host);
      }
    }
    for (const control of shareControls(document))
      if (!controls.has(control) && sourceFor(control)) mountControl(control);
    if (SITE === 'youtube') reconcileYoutubeDialogs();
  }
  function scheduleScan() {
    if (!SITE || scanTimer) return;
    scanTimer = setTimeout(scan, 180);
  }

  GM_registerMenuCommand('Clean Share：清理任意網址', () => openPanel());
  GM_registerMenuCommand('Clean Share：清理目前頁面網址', () => openPanel(location.href));
  addEventListener('popstate', () => {
    routeCheck();
    scheduleScan();
  });
  addEventListener('hashchange', () => {
    routeCheck();
    scheduleScan();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      routeCheck();
      scheduleScan();
    }
  });
  // History changes need not mutate DOM, and patching sandbox History methods
  // misses page-realm pushState. Ordinary sites only check while the panel opens.
  setInterval(() => {
    if (!document.hidden && (SITE || dialog?.open)) routeCheck();
  }, 1000);
  if (SITE) {
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            !mutation.target.closest?.(OWN) &&
            (mutation.type === 'attributes' ||
              [...mutation.addedNodes, ...mutation.removedNodes].some(
                (node) => node.nodeType === 1 && !node.matches(OWN)
              ))
        )
      )
        scheduleScan();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'aria-label', 'title', 'aria-hidden', 'is-active', 'hidden'],
    });
    addEventListener('scroll', hideTooltip, { capture: true, passive: true });
    addEventListener('resize', () => {
      hideTooltip();
      scheduleScan();
    });
    scan();
  }
})();
