// ==UserScript==
// @name         arXiv AI Assistant
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.4.0
// @description  arXiv／papers.cool 論文資訊與引用探索、Google Scholar 跳轉，以及 Kimi／Gemini 繁中摘要
// @author       Da-Wei Lee
// @license      MIT
// @match        https://arxiv.org/abs/*
// @match        https://papers.cool/arxiv/*
// @match        https://gemini.google.com/app*
// @match        https://scholar.google.com/scholar*
// @match        https://scholar.google.com/citations*
// @match        https://scholar.google.com.tw/scholar*
// @match        https://scholar.google.com.tw/citations*
// @match        https://scholar.google.com.hk/scholar*
// @match        https://scholar.google.com.hk/citations*
// @match        https://scholar.google.co.uk/scholar*
// @match        https://scholar.google.co.uk/citations*
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyNDIgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPkFBPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      arxiv.org
// @connect      api.semanticscholar.org
// @connect      api.openalex.org
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js
// ==/UserScript==

/**
 * 同一支腳本負責 arXiv／Scholar 入口、papers.cool FAQ 與 Gemini 跨站交接。
 * Gemini composer 操作沿用 youtube-gemini-summary 的模式，使用獨立 namespace。
 * Kimi 採網站的 prefill deep link，無須在 Kimi 注入或呼叫模型 API。
 */
(function () {
  'use strict';

  const NS = 'arxiv-ai-assistant';
  const PANEL_ID = `${NS}-panel`;
  const RETURN_LINK_ID = `${NS}-arxiv-return`;
  const NOTICE_ID = `${NS}-notice`;
  const PENDING_KEY = `${NS}.pending.v1`;
  const RESEARCH_CACHE_KEY = `${NS}.research.v1`;
  const SCHOLAR_BACKOFF_KEY = `${NS}.scholar-backoff`;
  const DAY_MS = 86_400_000;
  const RESEARCH_ID = `${NS}-research`;
  const REQUEST_FRAGMENT_PARAM = NS;
  const REQUEST_ID_RE = /^[A-Za-z0-9-]{12,80}$/;
  const PENDING_TTL_MS = 120_000;
  const GEMINI_URL = 'https://gemini.google.com/app';
  const GOOGLE_SCHOLAR_HOSTS = new Set([
    'scholar.google.com',
    'scholar.google.com.tw',
    'scholar.google.com.hk',
    'scholar.google.co.uk',
  ]);
  const SCHOLAR_TOOLS_CLASS = `${NS}-scholar`;
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
      #${RESEARCH_ID} { margin-top: 12px; padding-top: 10px; border-top: 1px solid #d8c6ed; overflow-wrap: anywhere; }
      #${PANEL_ID} > #${RESEARCH_ID}:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
      #${RESEARCH_ID} > strong { display: block; margin-bottom: 6px; }
      #${RESEARCH_ID} #${NS}-dates { display: grid; gap: 4px; margin: 6px 0 10px; }
      #${RESEARCH_ID} p { margin: 7px 0; font: inherit; color: inherit; }
      #${RESEARCH_ID} .${NS}-muted, #${RESEARCH_ID} [role="status"] { color: #6b597a; font-size: 11px; }
      #${RESEARCH_ID} .${NS}-actions { margin-top: 10px; }
      #${RESEARCH_ID} details { padding: 7px 0; border-top: 1px solid #e4d9ee; }
      #${RESEARCH_ID} summary { cursor: pointer; font-weight: 600; }
      #${RESEARCH_ID} .${NS}-relations { max-height: 300px; overflow: auto; padding: 0 3px; }
      #${RESEARCH_ID} ol { margin: 8px 0; padding-left: 20px; list-style: decimal; }
      #${RESEARCH_ID} li { display: list-item; margin: 7px 0; padding: 0; }
      #${RESEARCH_ID} li a { display: inline; min-height: 0; padding: 0; border: 0; border-radius: 0; background: none; font-weight: 400; text-decoration: underline; }
      #${RETURN_LINK_ID} { display: inline-flex; align-items: center; gap: 7px; margin-left: 8px; padding: 5px 9px; border: 1px solid #cbb4e1; border-radius: 6px; background: #f7f2fd; color: #562980; font: 600 13px/1.5 system-ui, sans-serif; text-decoration: none; vertical-align: middle; white-space: nowrap; }
      #${RETURN_LINK_ID}:hover { background: #ede1fa; color: #3d1b5b; }
      #${RETURN_LINK_ID}:focus-visible { outline: 2px solid #8655b2; outline-offset: 2px; }
      #${RETURN_LINK_ID} .${NS}-badge { padding: 1px 5px; border-radius: 4px; background: #e9dff4; color: #624182; font-size: 10px; font-weight: 400; }
      .${SCHOLAR_TOOLS_CLASS} { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; box-sizing: border-box; max-width: 100%; margin: 8px 0 2px; font: 12px/1.5 system-ui, sans-serif; text-align: left; }
      .${SCHOLAR_TOOLS_CLASS} > a { display: inline-flex; align-items: center; box-sizing: border-box; min-height: 28px; max-width: 100%; padding: 3px 8px; margin: 0; border: 1px solid #cbb4e1; border-radius: 6px; background: #f7f2fd; color: #562980; font: 600 12px/1.5 system-ui, sans-serif; text-decoration: none; overflow-wrap: anywhere; }
      .${SCHOLAR_TOOLS_CLASS} > a:hover { background: #ede1fa; color: #3d1b5b; text-decoration: none; }
      .${SCHOLAR_TOOLS_CLASS} > a:focus-visible { outline: 2px solid #8655b2; outline-offset: 2px; }
      .${SCHOLAR_TOOLS_CLASS} > .${NS}-badge { color: #725d84; font: 10px/1.5 system-ui, sans-serif; }
      #gs_aa_fv_wrap:has(> .${SCHOLAR_TOOLS_CLASS}) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
      #gs_aa_fv_wrap > .${SCHOLAR_TOOLS_CLASS} { margin: 0; }
      #gs_aa_ftr:has(.${SCHOLAR_TOOLS_CLASS}) { height: auto; min-height: 41px; flex-wrap: wrap; }
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

  function isGoogleScholarPage() {
    return (
      GOOGLE_SCHOLAR_HOSTS.has(location.hostname) &&
      /^\/(?:scholar|citations)\/?$/.test(location.pathname)
    );
  }

  function scholarArxivId(href) {
    try {
      let url = new URL(href, location.href);
      // Scholar sometimes wraps an external URL for click tracking. Unwrap only
      // its known redirect endpoint, never a search query or arbitrary ?url=.
      if (GOOGLE_SCHOLAR_HOSTS.has(url.hostname) && url.pathname === '/scholar_url') {
        url = new URL(url.searchParams.get('url'));
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port ||
        !['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname)
      )
        return null;
      const path = url.pathname.replace(/\.pdf\/?$/i, '');
      return (
        paperIdFromPath(path, '/abs/') ||
        paperIdFromPath(path, '/pdf/') ||
        paperIdFromPath(path, '/html/')
      );
    } catch {
      return null;
    }
  }

  function scholarPaperIn(root, selector) {
    const ids = [...root.querySelectorAll(selector)]
      .filter((link) => !link.closest(`.${SCHOLAR_TOOLS_CLASS}`))
      .map((link) => scholarArxivId(link.getAttribute('href')))
      .filter(Boolean);
    if (new Set(ids.map(basePaperId)).size !== 1) return null;
    // Prefer an explicit version, then the title/PDF order supplied by the DOM.
    return ids.find((id) => /v\d+$/.test(id)) || ids[0];
  }

  async function initGoogleScholar() {
    const owned = `.${SCHOLAR_TOOLS_CLASS}`;
    const mounted = new Map();
    let scheduled = null;
    let routeTimer = null;
    let lastPath = location.pathname;

    function reconcile() {
      scheduled = null;
      const desired = new Map();
      const collect = (root, container, selector) => {
        if (!root || !container) return;
        const resolve = () => root.isConnected && scholarPaperIn(root, selector);
        const id = resolve();
        if (id) desired.set(container, { id, resolve });
      };
      if (isGoogleScholarPage()) {
        document.querySelectorAll('.gs_r.gs_or').forEach((row) => {
          collect(row, row.querySelector('.gs_ri'), '.gs_rt a[href], .gs_or_ggsm a[href]');
        });
        // The native Quick Read code clones the selected paper's .gs_aa_fv
        // into this footer. Its generated answer can cite OTHER papers, so do
        // not inspect the answer body or infer identity from the search box.
        const footer = document.getElementById('gs_aa_fv_wrap');
        collect(footer, footer, 'a.gs_aa_fv[href]');
        const citationTitle = document.getElementById('gsc_oci_title');
        collect(citationTitle, citationTitle?.parentElement, '#gsc_oci_title a[href]');
      }
      for (const [container, state] of mounted) {
        if (desired.get(container)?.id !== state.id || state.element.parentElement !== container) {
          state.element.remove();
          mounted.delete(container);
        }
      }
      // Cached/cloned HTML has no live listeners, including toolbars whose
      // paper link has since disappeared. Never leave such copies actionable.
      document.querySelectorAll(owned).forEach((element) => {
        if (mounted.get(element.parentElement)?.element !== element) element.remove();
      });
      for (const [container, { id, resolve }] of desired) {
        if (mounted.has(container)) {
          mounted.get(container).resolve = resolve;
          continue;
        }
        const element = document.createElement('div');
        element.className = SCHOLAR_TOOLS_CLASS;
        element.dataset.paperId = id;
        element.setAttribute('role', 'group');
        element.setAttribute('aria-label', `arXiv ${id} 論文跳轉`);
        element.append(
          makeLink('↗ arXiv', `https://arxiv.org/abs/${id}`, `在 arXiv 開啟 ${id}`),
          makeLink('papers.cool', papersUrlFor(id), `開啟 ${id} 並展開 Kimi FAQ`)
        );
        const badge = document.createElement('span');
        badge.className = `${NS}-badge`;
        badge.textContent = 'Userscript';
        element.append(badge);
        const guard = (event) => {
          if (!isGoogleScholarPage() || mounted.get(container)?.resolve() !== id) {
            event.preventDefault();
            event.stopImmediatePropagation();
            schedule();
          }
        };
        element.addEventListener('click', guard, true);
        element.addEventListener('auxclick', guard, true);
        if (container.querySelector(':scope > #gsc_oci_title')) {
          container.querySelector(':scope > #gsc_oci_title').after(element);
        } else container.append(element);
        mounted.set(container, { id, element, resolve });
      }
    }

    function schedule() {
      // Fixed delay rather than trailing debounce: streamed Quick Read content
      // cannot postpone an update forever.
      if (scheduled === null) scheduled = setTimeout(reconcile, 100);
    }
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) => {
          if (record.target.closest?.(owned)) return false;
          if (record.type === 'attributes') return record.target.tagName === 'A';
          if ([...record.removedNodes].some((node) => node === mounted.get(record.target)?.element))
            return true;
          return [...record.addedNodes, ...record.removedNodes].some(
            (node) => node.nodeType === 1 && !node.matches(owned)
          );
        })
      )
        schedule();
    });
    function start() {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href'],
      });
      if (routeTimer === null)
        routeTimer = setInterval(() => {
          if (!document.hidden && location.pathname !== lastPath) {
            lastPath = location.pathname;
            schedule();
          }
        }, 1000);
      reconcile();
    }
    window.addEventListener('popstate', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      clearTimeout(scheduled);
      clearInterval(routeTimer);
      scheduled = routeTimer = null;
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) start();
    });
    start();
  }

  // Research lookups use work-level IDs; navigation and AI prompts retain the version.
  function basePaperId(id) {
    return id.replace(/v\d+$/, '');
  }

  function researchCache(id, kind, value) {
    try {
      const stored = GM_getValue(RESEARCH_CACHE_KEY, {});
      const cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
      const key = `${basePaperId(id)}:${kind}`;
      if (value === undefined) {
        const entry = cache[key];
        const age = Date.now() - entry?.at;
        return age >= 0 && age < DAY_MS ? entry.value : null;
      }
      cache[key] = { at: Date.now(), value };
      // Bound storage even when browsing many papers. Cache failures never block the UI.
      GM_setValue(
        RESEARCH_CACHE_KEY,
        Object.fromEntries(
          Object.entries(cache)
            .sort((a, b) => b[1]?.at - a[1]?.at)
            .slice(0, 60)
        )
      );
    } catch (error) {
      log('research cache unavailable:', error);
    }
    return null;
  }

  function requestResearch(url, type = 'json') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: true,
        timeout: 15_000,
        onload(response) {
          if (response.status !== 200) {
            reject(
              Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
            );
            return;
          }
          try {
            if (response.finalUrl && new URL(response.finalUrl).origin !== new URL(url).origin)
              throw new Error('查詢被轉往其他網站');
            resolve(type === 'json' ? JSON.parse(response.responseText) : response.responseText);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error('無法連線或尚未允許跨站查詢')),
        ontimeout: () => reject(new Error('查詢逾時')),
        onabort: () => reject(new Error('查詢已取消')),
      });
    });
  }

  function readDates(doc) {
    const history = doc.querySelector('.submission-history')?.textContent || '';
    const versions = [];
    const pattern =
      /\[v(\d+)\]\s*(?:[A-Za-z]{3},?\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(?:UTC|GMT)/g;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    for (const match of history.matchAll(pattern)) {
      const [, version, day, month, year, hours, minutes, seconds] = match;
      const monthIndex = months.indexOf(month);
      const at = Date.UTC(+year, monthIndex, +day, +hours, +minutes, +seconds);
      const date = new Date(at);
      if (
        monthIndex < 0 ||
        date.getUTCDate() !== +day ||
        +hours > 23 ||
        +minutes > 59 ||
        +seconds > 59
      )
        continue;
      versions.push({ version: +version, at });
    }
    versions.sort((a, b) => a.version - b.version);
    const first = versions.find((item) => item.version === 1);
    const latest = versions.at(-1);
    const metaDate = doc.querySelector('meta[name="citation_date"]')?.content?.replaceAll('/', '-');
    const fallback = /^\d{4}-\d{2}-\d{2}$/.test(metaDate || '')
      ? Date.parse(`${metaDate}T00:00:00Z`)
      : NaN;
    return {
      submittedAt: first?.at ?? (Number.isFinite(fallback) ? fallback : null),
      latestAt: latest?.at ?? null,
      latestVersion: latest?.version ?? null,
    };
  }

  function dateDescription(at) {
    if (!Number.isFinite(at)) return '未取得';
    const days = Math.floor((Date.now() - at) / DAY_MS);
    const age =
      days < 0
        ? '日期尚未到'
        : days === 0
          ? '今天'
          : days < 365
            ? `${days} 天前`
            : `${(days / 365.25).toFixed(1)} 年前`;
    return `${new Date(at).toISOString().slice(0, 10)}（${age}）`;
  }

  function renderDates(container, dates, id) {
    container.replaceChildren();
    const first = document.createElement('div');
    first.textContent = `首次提交：${dateDescription(dates.submittedAt)}`;
    const updated = document.createElement('div');
    updated.textContent = `最新修訂：${dateDescription(dates.latestAt)}${dates.latestVersion ? ` · v${dates.latestVersion}` : ''}`;
    container.append(first, updated);
    const selectedVersion = id.match(/v(\d+)$/)?.[1];
    if (selectedVersion && dates.latestVersion && +selectedVersion !== dates.latestVersion) {
      container.append(
        makeLink(
          `目前 v${selectedVersion} → 最新 v${dates.latestVersion}`,
          `https://arxiv.org/abs/${basePaperId(id)}v${dates.latestVersion}`,
          '目前閱讀的是舊版本；在新分頁開啟最新版本'
        )
      );
    }
  }

  function openAlexUrl(params) {
    return `https://api.openalex.org/works?${new URLSearchParams(params)}`;
  }

  function matchesArxivLocation(work, id) {
    return (work.locations || []).some((item) => {
      if (item.id === `pmh:oai:arXiv.org:${id}`) return true;
      return [item.landing_page_url, item.pdf_url].some((href) => {
        if (!href) return false;
        try {
          const url = new URL(href);
          if (url.hostname === 'doi.org')
            return (
              decodeURIComponent(url.pathname).toLowerCase() ===
              `/10.48550/arxiv.${id}`.toLowerCase()
            );
          if (!['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname))
            return false;
          const path = url.pathname.replace(/\.pdf$/, '');
          const found = paperIdFromPath(path, '/abs/') || paperIdFromPath(path, '/pdf/');
          return found && basePaperId(found) === id;
        } catch {
          return false;
        }
      });
    });
  }

  function countLabel(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : '未提供';
  }

  function validMetrics(value) {
    return (
      value &&
      Number.isFinite(value.checkedAt) &&
      ((value.provider === 'Semantic Scholar' && /^[a-f0-9]{40}$/.test(value.id)) ||
        (value.provider === 'OpenAlex' && /^W\d+$/.test(value.id)))
    );
  }

  function metricsUrl(value) {
    return value.provider === 'OpenAlex'
      ? `https://openalex.org/${value.id}`
      : `https://www.semanticscholar.org/paper/${value.id}`;
  }

  async function lookupMetrics(paper) {
    const id = basePaperId(paper.id);
    let scholarError;
    try {
      let backoff = 0;
      try {
        backoff = GM_getValue(SCHOLAR_BACKOFF_KEY, 0);
      } catch {
        /* optional throttle */
      }
      if (backoff > Date.now()) throw Object.assign(new Error('暫時限流'), { status: 429 });
      const work = await requestResearch(
        `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(id)}?fields=externalIds,citationCount,referenceCount`
      );
      if (
        !work.externalIds?.ArXiv ||
        basePaperId(work.externalIds.ArXiv) !== id ||
        !/^[a-f0-9]{40}$/.test(work.paperId)
      )
        throw new Error('Semantic Scholar 未回傳相符的 arXiv ID');
      return {
        provider: 'Semantic Scholar',
        id: work.paperId,
        citations: work.citationCount,
        references: work.referenceCount,
        checkedAt: Date.now(),
      };
    } catch (error) {
      scholarError = error;
      if (error.status === 429) {
        try {
          GM_setValue(SCHOLAR_BACKOFF_KEY, Date.now() + 60_000);
        } catch {
          /* optional throttle */
        }
      }
    }
    // Title search is candidate discovery only. Require an exact arXiv location;
    // same titles and arXiv DOI redirects alone can identify the wrong work.
    try {
      const data = await requestResearch(
        openAlexUrl({
          search: paper.title,
          per_page: 10,
          select: 'id,title,locations,cited_by_count,referenced_works',
        })
      );
      if (!Array.isArray(data.results)) throw new Error('OpenAlex 回應格式不符');
      const matches = data.results.filter((work) => matchesArxivLocation(work, id));
      if (matches.length !== 1) {
        const prefix = scholarError.status === 429 ? 'Semantic Scholar 暫時限流；' : '';
        throw new Error(
          `${prefix}OpenAlex ${matches.length > 1 ? '有多筆符合紀錄，需人工確認' : '未找到可核對 arXiv ID 的紀錄'}。請使用外部工具確認。`
        );
      }
      const work = matches[0];
      const metrics = {
        provider: 'OpenAlex',
        id: work.id?.match(/^https:\/\/openalex\.org\/(W\d+)$/)?.[1],
        citations: work.cited_by_count,
        references: Array.isArray(work.referenced_works) ? work.referenced_works.length : null,
        checkedAt: Date.now(),
      };
      if (!validMetrics(metrics)) throw new Error('OpenAlex 回傳的論文 ID 無效');
      return metrics;
    } catch (error) {
      if (error.status === 429)
        throw new Error('引用資料庫暫時限流，請稍後重試，或使用下方外部工具。');
      if (error.status === 401 || error.status === 403)
        throw new Error('引用資料庫目前限制匿名存取，請使用下方外部工具。');
      throw error;
    }
  }

  async function lookupRelations(metrics, direction) {
    if (metrics.provider === 'OpenAlex') {
      const data = await requestResearch(
        openAlexUrl({
          filter: `${direction === 'references' ? 'cited_by' : 'cites'}:${metrics.id}`,
          per_page: 20,
          sort: direction === 'references' ? 'cited_by_count:desc' : 'publication_date:desc',
          select: 'id,title,publication_year,cited_by_count',
        })
      );
      if (!Array.isArray(data.results)) throw new Error('引用關係回應格式不符');
      return data.results.map((work) => ({
        id: work.id?.match(/^https:\/\/openalex\.org\/(W\d+)$/)?.[1],
        provider: metrics.provider,
        title: work.title,
        year: work.publication_year,
      }));
    }
    const data = await requestResearch(
      `https://api.semanticscholar.org/graph/v1/paper/${metrics.id}/${direction}?limit=20&fields=title,year`
    );
    if (!Array.isArray(data.data)) throw new Error('引用關係回應格式不符');
    return data.data.map((item) => {
      const work = direction === 'references' ? item.citedPaper : item.citingPaper;
      return {
        id: work?.paperId,
        provider: metrics.provider,
        title: work?.title,
        year: work?.year,
      };
    });
  }

  function appendRelations(container, metrics, isCurrent) {
    for (const [direction, label] of [
      ['references', '上游：本篇引用的研究'],
      ['citations', '下游：引用本篇的研究'],
    ]) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = label;
      const body = document.createElement('div');
      body.className = `${NS}-relations`;
      details.append(summary, body);
      container.append(details);
      let busy = false;
      let loaded = false;
      async function load() {
        if (busy || loaded || !isCurrent() || !details.isConnected) return;
        busy = true;
        body.textContent = '正在查詢…';
        try {
          const works = await lookupRelations(metrics, direction);
          if (!isCurrent() || !details.isConnected) return;
          body.replaceChildren();
          const list = document.createElement('ol');
          for (const work of works) {
            if (!validMetrics({ ...work, checkedAt: 0 }) || typeof work.title !== 'string')
              continue;
            const row = document.createElement('li');
            row.append(makeLink(work.title, metricsUrl(work), '在資料來源查看這篇論文'));
            if (Number.isInteger(work.year)) row.append(`（${work.year}）`);
            list.append(row);
          }
          body.append(list);
          const note = document.createElement('p');
          note.textContent = list.childElementCount
            ? `顯示 ${list.childElementCount} 篇（最多 20 篇）；更多結果請至資料來源。`
            : '資料庫尚未提供可顯示的引用關係。';
          body.append(note);
          loaded = true;
        } catch (error) {
          if (!isCurrent() || !details.isConnected) return;
          body.textContent =
            error.status === 429
              ? '資料庫暫時限流，請稍後再試。'
              : '引用關係查詢失敗，可重試或至資料來源查看。';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = '重試';
          retry.addEventListener('click', load);
          body.append(retry);
        } finally {
          busy = false;
        }
      }
      details.addEventListener('toggle', () => {
        if (details.open) void load();
      });
    }
  }

  function addResearchCard(panel, paper) {
    if (document.getElementById(RESEARCH_ID)) return;
    const route = location.pathname;
    const card = document.createElement('section');
    card.id = RESEARCH_ID;
    card.setAttribute('aria-label', '論文資訊與引用探索');
    const isCurrent = () => card.isConnected && location.pathname === route;
    const heading = document.createElement('strong');
    heading.textContent = '論文資訊';
    const dates = document.createElement('div');
    dates.id = `${NS}-dates`;
    const metrics = document.createElement('div');
    metrics.id = `${NS}-metrics`;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = '引用資料尚未查詢。';
    const lookup = document.createElement('button');
    lookup.type = 'button';
    lookup.textContent = '查詢引用';
    lookup.id = `${NS}-lookup`;
    const tools = document.createElement('div');
    tools.className = `${NS}-actions`;
    const baseId = basePaperId(paper.id);
    const scholar = new URL('https://scholar.google.com/scholar');
    scholar.search = new URLSearchParams({ q: `"${paper.title}"` });
    tools.append(
      makeLink('Google Scholar', scholar.href, '以完整題名搜尋，查看被引用與相關文章'),
      makeLink(
        'Semantic Scholar',
        `https://api.semanticscholar.org/arXiv:${baseId}`,
        '以 arXiv ID 開啟文獻紀錄'
      ),
      makeLink(
        'Connected Papers',
        `https://www.connectedpapers.com/api/redirect/arxiv/${encodeURIComponent(baseId)}`,
        '探索相似論文圖譜；圖中的連線表示相似性，並非直接引用'
      )
    );
    const help = document.createElement('p');
    help.className = `${NS}-muted`;
    help.textContent = '引用依資料庫收錄；Connected Papers 提供相似性圖譜。';
    card.append(heading, dates, lookup, status, metrics, tools, help);
    panel.append(card);

    function showMetrics(value, cached = false) {
      metrics.replaceChildren();
      const counts = document.createElement('p');
      counts.textContent = `被引用：${countLabel(value.citations)} · 參考文獻：${countLabel(value.references)}`;
      const source = document.createElement('p');
      source.append(
        makeLink(
          value.provider,
          metricsUrl(value),
          '查看資料庫中的整篇論文紀錄（可能合併多個版本）'
        )
      );
      source.append(
        ` · ${new Date(value.checkedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC${cached ? '（快取）' : ''}`
      );
      source.className = `${NS}-muted`;
      metrics.append(counts, source);
      appendRelations(metrics, value, isCurrent);
      status.textContent = '依整篇論文紀錄統計，可能合併版本；資料快取 24 小時。';
      lookup.textContent = '更新引用資料';
    }
    const cached = researchCache(paper.id, 'metrics');
    if (validMetrics(cached)) showMetrics(cached, true);
    lookup.addEventListener('click', async () => {
      if (lookup.disabled || !isCurrent()) return;
      lookup.disabled = true;
      status.textContent = '正在查詢引用資料…';
      try {
        const value = await lookupMetrics(paper);
        researchCache(paper.id, 'metrics', value);
        if (isCurrent()) showMetrics(value);
      } catch (error) {
        if (isCurrent())
          status.textContent = `未能更新引用資料：${error.message}（查詢失敗不代表零引用。）`;
      } finally {
        lookup.disabled = false;
      }
    });

    if (location.hostname === 'arxiv.org') {
      const value = readDates(document);
      renderDates(dates, value, paper.id);
      if (value.submittedAt !== null) researchCache(paper.id, 'dates', value);
    } else {
      const cachedDates = researchCache(paper.id, 'dates');
      if (cachedDates) {
        renderDates(dates, cachedDates, paper.id);
        dates.title = 'arXiv 提交紀錄（24 小時快取）';
      } else {
        dates.textContent = '正在讀取 arXiv 提交紀錄…';
        void requestResearch(`https://arxiv.org/abs/${baseId}`, 'text')
          .then((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const returnedId = doc.querySelector('meta[name="citation_arxiv_id"]')?.content;
            if (!returnedId || basePaperId(returnedId) !== baseId)
              throw new Error('arXiv 紀錄不符');
            const value = readDates(doc);
            if (value.submittedAt === null) throw new Error('未提供提交紀錄');
            researchCache(paper.id, 'dates', value);
            if (isCurrent()) renderDates(dates, value, paper.id);
          })
          .catch(() => {
            if (isCurrent()) dates.textContent = '未取得提交紀錄，請按「↗ arXiv」查看。';
          });
      }
    }
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
    addResearchCard(panel, paper);
  }

  async function initPapersCool() {
    const id = paperIdFromPath(location.pathname, '/arxiv/');
    if (!id) return;
    await Promise.all([addArxivReturnLink(id), expandPapersCoolFaq(id)]);
  }

  async function addArxivReturnLink(id) {
    const baseId = id.replace(/v\d+$/, '');
    const heading = await waitFor(() => {
      const paper = document.getElementById(baseId);
      return paper?.classList.contains('paper') ? paper.querySelector('h2.title') : null;
    }, 20_000);
    if (!heading || document.getElementById(RETURN_LINK_ID)) return;
    const link = makeLink('↗ arXiv', `https://arxiv.org/abs/${id}`, `在 arXiv 開啟 ${id}`);
    link.id = RETURN_LINK_ID;
    link.className = 'notranslate';
    const badge = document.createElement('span');
    badge.className = `${NS}-badge`;
    badge.textContent = 'Userscript';
    badge.setAttribute('aria-hidden', 'true');
    link.append(badge);
    heading.append(link);
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    heading.after(panel);
    const title =
      normalizeText(
        document.querySelector('meta[name="citation_title"]')?.content ||
          heading.querySelector('.title-link')?.textContent
      ) || `arXiv ${id}`;
    addResearchCard(panel, { id, title });
  }

  async function expandPapersCoolFaq(id) {
    if (new URLSearchParams(location.hash.slice(1)).get(REQUEST_FRAGMENT_PARAM) !== 'faq') return;
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
    (host === 'papers.cool' && paperIdFromPath(location.pathname, '/arxiv/')) ||
    isGoogleScholarPage() ||
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
        : isGoogleScholarPage()
          ? initGoogleScholar
          : consumePendingOnGemini;
  run().catch((error) => {
    log('initialization failed:', error);
    showStatus('AI 論文助手無法自動完成，請重新整理頁面後再試。', { error: true });
  });
})();
