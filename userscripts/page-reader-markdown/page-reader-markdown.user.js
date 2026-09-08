// ==UserScript==
// @name         Page Reader & Markdown
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  從目前網頁擷取乾淨正文，支援專注閱讀、Markdown 與含附件 ZIP 匯出
// @author       Da-Wei Lee
// @license      MIT
// @match        https://*/*
// @match        http://*/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyMjcgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPlBSPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-idle
// @noframes
// @require      https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/Readability.js
// @require      https://cdn.jsdelivr.net/npm/dompurify@3.4.15/dist/purify.min.js
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.4/dist/turndown.js
// @require      https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-reader-markdown/page-reader-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/page-reader-markdown/page-reader-markdown.user.js
// ==/UserScript==

/** 從目前 DOM 建立原文快照；Reader 與翻譯只操作副本。 */
(function () {
  'use strict';

  const PREFIX = 'page-reader-markdown';
  const DOCK = `${PREFIX}-dock`;
  const READER = `${PREFIX}-reader`;
  const CONTENT = `${PREFIX}-content`;
  if (window.top !== window.self || !/^https?:$/.test(location.protocol)) return;
  if (document.getElementById(DOCK) || !/html/i.test(document.contentType)) return;

  const TARGETS =
    '.immersive-translate-target-wrapper,.immersive-translate-target-inner,' +
    '.immersive-translate-target,immersive-translate-target';
  const NOISE =
    'script,style,noscript,template,nav,[role="navigation"],[role="banner"],' +
    '[role="contentinfo"],form,button,textarea,select,' +
    '.adsbygoogle,[data-ad-slot],[data-ad-client],.ad-container,.advertisement,' +
    '.related-posts,.related-articles,.social-share,.share-buttons,' +
    '#js_pc_qr_code,#js_profile_qrcode,#js_article_bottom_bar,#js_ad_area';
  const FILE_EXTENSIONS = new Set([
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'odt',
    'ods',
    'odp',
    'rtf',
    'txt',
    'md',
    'csv',
    'epub',
  ]);
  const MiB = 1024 * 1024;
  const LIMITS = { file: 50 * MiB, total: 200 * MiB, timeout: 30_000, workers: 3 };
  const stored = GM_getValue('readerSettings', {});
  const settings = {
    fontSize: Math.min(30, Math.max(16, Number(stored?.fontSize) || 20)),
    theme: ['auto', 'light', 'dark'].includes(stored?.theme) ? stored.theme : 'auto',
  };
  const state = {
    url: location.href,
    scope: 'article',
    selection: null,
    snapshot: null,
    reader: null,
    restore: null,
    job: null,
    dock: null,
    panel: null,
    status: '從目前分頁擷取正文',
    toast: null,
    scopeSelect: null,
  };
  let hideTimer;
  let toastTimer;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function textOf(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function ownNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(
      element?.closest(`#${DOCK},#${READER}`) || node?.getRootNode?.().host?.id === DOCK
    );
  }

  function notify(message, error = false) {
    state.status = message;
    const status = state.dock?.shadowRoot.querySelector('.status');
    if (status) status.textContent = message;
    if (state.toast) {
      state.toast.textContent = message;
      state.toast.hidden = false;
      state.toast.classList.toggle('error', error);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(
        () => {
          if (state.toast) state.toast.hidden = true;
        },
        error ? 8000 : 3500
      );
    }
    if (error) console.warn(`[${PREFIX}]`, message);
  }

  function action(fn) {
    return () =>
      Promise.resolve()
        .then(fn)
        .catch((error) => {
          notify(error?.message || String(error), true);
        });
  }

  function absoluteUrl(raw, base = document.baseURI) {
    if (!raw) return '';
    try {
      const url = new URL(raw, base);
      return /^(https?:|data:|blob:|mailto:|tel:)$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function resourceUrl(raw) {
    const url = new URL(raw);
    url.hash = '';
    return url.href;
  }

  function extension(name) {
    return (
      String(name)
        .split(/[?#]/)[0]
        .match(/\.([a-z0-9]{1,8})$/i)?.[1]
        .toLowerCase() || ''
    );
  }

  function safeName(value, fallback = 'article') {
    const name = String(value || '')
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '-')
      .replace(/^\.+|[.\s]+$/g, '')
      .trim();
    const characters = Array.from(name).slice(0, 90);
    while (new TextEncoder().encode(characters.join('')).length > 180) characters.pop();
    const shortened = characters.join('') || fallback;
    return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(shortened) ? `_${shortened}` : shortened;
  }

  function metaContent(selector) {
    return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
  }

  function pageMetadata() {
    let structured = {};
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(node.textContent);
        const entries = (Array.isArray(data) ? data : [data]).flatMap((item) => [
          item,
          ...(item?.['@graph'] || []),
        ]);
        const found = entries.find((item) => /Article|BlogPosting/i.test(String(item?.['@type'])));
        if (found) {
          structured = found;
          break;
        }
      } catch {
        /* 網站 JSON-LD 不合法時仍可讀取 DOM metadata。 */
      }
    }
    const authors = [structured.author]
      .flat()
      .filter(Boolean)
      .map((author) => (typeof author === 'string' ? author : author.name))
      .filter(Boolean)
      .join(', ');
    const wechat = location.hostname === 'mp.weixin.qq.com';
    return {
      title:
        (wechat && textOf(document.querySelector('#activity-name'))) ||
        structured.headline ||
        metaContent('meta[property="og:title"]') ||
        document.title ||
        'Untitled',
      url: location.href,
      site:
        (wechat && textOf(document.querySelector('#js_name'))) ||
        metaContent('meta[property="og:site_name"]') ||
        location.hostname,
      author:
        (wechat && textOf(document.querySelector('#js_author_name'))) ||
        authors ||
        metaContent('meta[name="author"]'),
      published_at:
        (wechat && textOf(document.querySelector('#publish_time'))) ||
        structured.datePublished ||
        metaContent('meta[property="article:published_time"]') ||
        document.querySelector('time[datetime]')?.getAttribute('datetime') ||
        '',
      captured_at: new Date().toISOString(),
      lang: document.documentElement.lang || '',
    };
  }

  /** 預先保存 currentSrc；cloneNode 不會複製瀏覽器選出的 picture/srcset 圖片。 */
  function imageSources(source, copy) {
    const originals = Array.isArray(source) ? source : source.querySelectorAll('img');
    copy.querySelectorAll('img').forEach((image, index) => {
      const original = originals[index];
      const candidates = [
        original?.getAttribute('data-src'),
        original?.getAttribute('data-original'),
        original?.getAttribute('data-lazy-src'),
        original?.currentSrc,
        original?.getAttribute('src'),
        original?.getAttribute('srcset')?.split(',').at(-1)?.trim().split(/\s+/)[0],
      ];
      const chosen =
        candidates.find((url) => url && !/^data:image\/(gif|svg\+xml)/i.test(url)) ||
        candidates.find(Boolean);
      if (chosen) image.setAttribute('src', absoluteUrl(chosen));
    });
  }

  /** 先移除譯文，再恢復被擴充套件隱藏的原文；不修改原頁。 */
  function cleanTree(root) {
    root.querySelectorAll('pre,code').forEach((node) => {
      const language = (node.getAttribute('class') || '').match(/(?:language|lang)-([\w+-]+)/)?.[1];
      if (language) node.setAttribute('data-prm-language', language);
    });
    const translated = root.querySelectorAll(TARGETS).length > 0;
    root.querySelectorAll(TARGETS).forEach((node) => node.remove());
    root.querySelectorAll('[class*="immersive-translate-source"]').forEach((node) => {
      node.removeAttribute('hidden');
      node.removeAttribute('aria-hidden');
      node.removeAttribute('style');
      node.removeAttribute('class');
    });
    root
      .querySelectorAll(`#${DOCK},#${READER},#${PREFIX}-style,${NOISE}`)
      .forEach((node) => node.remove());
    root
      .querySelectorAll('body > header,body > footer,[hidden],[aria-hidden="true"]')
      .forEach((node) => node.remove());
    root.querySelectorAll('[style]').forEach((node) => {
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style')))
        node.remove();
    });
    root.querySelectorAll('input').forEach((node) => {
      if (node.type === 'checkbox') node.setAttribute('disabled', '');
      else node.remove();
    });
    root.querySelectorAll('video,audio,iframe').forEach((node) => {
      const url = absoluteUrl(
        node.getAttribute('src') || node.querySelector('source')?.getAttribute('src')
      );
      if (url)
        node.replaceWith(
          el('a', node.tagName === 'AUDIO' ? '音訊' : '影片／嵌入內容', { href: url })
        );
      else node.remove();
    });
    root.querySelectorAll('img').forEach((image) => {
      const url = absoluteUrl(
        image.getAttribute('data-src') ||
          image.getAttribute('data-original') ||
          image.getAttribute('data-lazy-src') ||
          image.getAttribute('src')
      );
      if (url && /^(https?:|data:image\/|blob:)/.test(url)) image.setAttribute('src', url);
      else image.replaceWith(document.createTextNode(image.getAttribute('alt') || ''));
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
    });
    root.querySelectorAll('a[href]').forEach((link) => {
      const url = absoluteUrl(link.getAttribute('href'));
      if (url) link.setAttribute('href', url);
      else link.removeAttribute('href');
    });
    return translated;
  }

  function sanitizedTree(html) {
    const root = document.createElement('div');
    root.append(
      DOMPurify.sanitize(html, {
        RETURN_DOM_FRAGMENT: true,
        USE_PROFILES: { html: true },
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        FORBID_TAGS: [
          'style',
          'script',
          'iframe',
          'object',
          'embed',
          'form',
          'button',
          'textarea',
          'select',
        ],
        FORBID_ATTR: ['style', 'srcset', 'sizes', 'autofocus'],
      })
    );
    return root;
  }

  function meaningful(root) {
    if (!root) return false;
    const length = textOf(root).length;
    const links = [...root.querySelectorAll('a')].reduce(
      (sum, link) => sum + textOf(link).length,
      0
    );
    return (length >= 20 && links < length * 0.85) || Boolean(root.querySelector('pre,img[src]'));
  }

  function collectAssets(root) {
    const assets = [];
    const byUrl = new Map();
    for (const node of root.querySelectorAll('img[src],a[href]')) {
      const image = node.tagName === 'IMG';
      const url = node.getAttribute(image ? 'src' : 'href');
      if (!url || !/^(https?:|blob:|data:)/.test(url)) continue;
      const hint = image ? '' : node.getAttribute('download') || '';
      if (
        !image &&
        !FILE_EXTENSIONS.has(extension(url)) &&
        !FILE_EXTENSIONS.has(extension(hint)) &&
        !node.hasAttribute('download')
      )
        continue;
      const key = resourceUrl(url);
      let asset = byUrl.get(key);
      if (!asset) {
        asset = Object.freeze({
          id: `asset-${assets.length + 1}`,
          url: key,
          kind: image ? 'image' : 'document',
          hint,
        });
        assets.push(asset);
        byUrl.set(key, asset);
      }
      node.setAttribute('data-prm-asset', asset.id);
    }
    return Object.freeze(assets);
  }

  function markdownBody(html, { bodyOnly = false, paths = null } = {}) {
    const root = sanitizedTree(html);
    if (bodyOnly) root.querySelectorAll('img').forEach((image) => image.remove());
    if (paths)
      root.querySelectorAll('[data-prm-asset]').forEach((node) => {
        const path = paths.get(node.getAttribute('data-prm-asset'));
        if (!path) return;
        const attr = node.tagName === 'IMG' ? 'src' : 'href';
        const hash = new URL(node.getAttribute(attr)).hash;
        node.setAttribute(attr, path.split('/').map(encodeURIComponent).join('/') + hash);
      });
    root
      .querySelectorAll('[data-prm-asset]')
      .forEach((node) => node.removeAttribute('data-prm-asset'));
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      hr: '---',
    });
    service.use(turndownPluginGfm.gfm);
    service.addRule('code-fences', {
      filter: 'pre',
      replacement(_content, node) {
        const code = node.querySelector('code') || node;
        const body = code.textContent.replace(/\n$/, '');
        const longest = (body.match(/`+/g) || []).reduce(
          (max, run) => Math.max(max, run.length),
          0
        );
        const fence = '`'.repeat(Math.max(3, longest + 1));
        const language =
          code.getAttribute('data-prm-language') ||
          node.getAttribute('data-prm-language') ||
          `${code.className} ${node.className}`.match(/(?:language|lang)-([\w+-]+)/)?.[1] ||
          '';
        return `\n\n${fence}${language}\n${body}\n${fence}\n\n`;
      },
    });
    service.addRule('complex-tables', {
      filter: (node) =>
        node.nodeName === 'TABLE' && Boolean(node.querySelector('[rowspan],[colspan]')),
      replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
    });
    return service.turndown(root).trim();
  }

  function extractSnapshot() {
    checkRoute();
    if (state.snapshot && state.reader?.isConnected) return state.snapshot;
    const metadata = pageMetadata();
    let html;
    let extraction;
    let translated = false;
    if (state.scope === 'selection') {
      if (!state.selection || state.selection.url !== location.href)
        throw new Error('請先在原頁圈選要擷取的內容。');
      const root = document.createElement('div');
      root.append(state.selection.fragment.cloneNode(true));
      translated = cleanTree(root);
      html = root.innerHTML;
      extraction = 'selection';
    } else {
      const copy = document.cloneNode(true);
      imageSources(document, copy);
      translated = cleanTree(copy);
      const wechat = location.hostname === 'mp.weixin.qq.com' && copy.querySelector('#js_content');
      if (wechat && meaningful(wechat)) {
        html = wechat.innerHTML;
        extraction = 'wechat';
      } else {
        const candidates = [...copy.querySelectorAll('article,main,[role="main"],.markdown-body')]
          .filter(meaningful)
          .sort((a, b) => textOf(b).length - textOf(a).length);
        const fallback = candidates[0];
        let article;
        try {
          article = new Readability(copy.cloneNode(true), { charThreshold: 120 }).parse();
        } catch {
          /* 不規則 DOM 仍可嘗試語意化正文容器。 */
        }
        if (article?.content && meaningful(sanitizedTree(article.content))) {
          html = article.content;
          extraction = 'readability';
          metadata.title = article.title || metadata.title;
          metadata.author ||= article.byline || '';
          metadata.site = article.siteName || metadata.site;
          metadata.lang ||= article.lang || '';
          metadata.published_at ||= article.publishedTime || '';
          // 文件頁若被 Readability 刪掉程式碼區，保守保留清理後的 main/article。
          if (
            fallback &&
            fallback.querySelectorAll('pre').length >
              sanitizedTree(html).querySelectorAll('pre').length
          ) {
            html = fallback.innerHTML;
            extraction = 'semantic';
          }
        } else if (fallback) {
          html = fallback.innerHTML;
          extraction = 'semantic';
        }
      }
    }
    if (!html)
      throw new Error(
        translated
          ? '無法可靠取得原文，請先在 Immersive Translate 恢復原文，再重新擷取。'
          : '沒有找到正文。請在原頁圈選內容，再選擇「目前圈選」。'
      );
    const root = sanitizedTree(html);
    if (!textOf(root) && !root.querySelector('img[src]'))
      throw new Error('圈選或擷取範圍沒有可匯出的原文；請恢復原文或重新圈選。');
    metadata.title = String(metadata.title).replace(/\s+/g, ' ').trim();
    metadata.scope = state.scope;
    metadata.extraction = extraction;
    // Readability 可能把原本的 h1 降成 h2。
    const firstHeading = root.querySelector('h1,h2');
    if (state.scope === 'article' && firstHeading && textOf(firstHeading) === metadata.title)
      firstHeading.remove();
    const assets = collectAssets(root);
    return Object.freeze({
      metadata: Object.freeze(metadata),
      html: root.innerHTML,
      assets,
      markdown: markdownBody(root.innerHTML),
      scope: state.scope,
    });
  }

  function renderMarkdown(snapshot, { bodyOnly = false, paths = null } = {}) {
    const body =
      bodyOnly || paths ? markdownBody(snapshot.html, { bodyOnly, paths }) : snapshot.markdown;
    const title = snapshot.metadata.title.replace(/([\\`*_[\]<>#])/g, '\\$1');
    const heading = snapshot.scope === 'article' ? `# ${title}\n\n` : '';
    if (bodyOnly) return `${heading}${body}\n`;
    const metadata = Object.entries(snapshot.metadata)
      .filter(([, value]) => value !== '' && value != null)
      .map(([key, value]) => `${key}: ${JSON.stringify(String(value))}`)
      .join('\n');
    return `---\n${metadata}\n---\n\n${heading}${body}\n`;
  }

  function copyMarkdown(bodyOnly = false) {
    const snapshot = extractSnapshot();
    GM_setClipboard(renderMarkdown(snapshot, { bodyOnly }), 'text');
    notify(
      `已複製${snapshot.scope === 'selection' ? '圈選內容' : '正文'}${bodyOnly ? '（文字 Markdown）' : '與 metadata'}`
    );
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: name, hidden: '' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadMarkdown() {
    const snapshot = extractSnapshot();
    downloadBlob(
      `${safeName(snapshot.metadata.title)}.md`,
      new Blob([renderMarkdown(snapshot)], { type: 'text/markdown;charset=utf-8' })
    );
    notify('已下載 Markdown（圖片與文件保留原網址）');
  }

  const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/rtf': 'rtf',
    'text/rtf': 'rtf',
    'application/epub+zip': 'epub',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.presentation': 'odp',
  };

  function canceled() {
    return new DOMException('已取消本機匯出', 'AbortError');
  }

  function checkCanceled(job) {
    if (job.controller.signal.aborted) throw canceled();
  }

  /** 只有使用者啟動 ZIP 匯出才請求附件；不請求文章或遍歷一般連結。 */
  function requestAsset(asset, job) {
    checkCanceled(job);
    if (/^(data:|blob:)/.test(asset.url)) return requestLocalAsset(asset, job);
    return new Promise((resolve, reject) => {
      let handle;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        job.controller.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      };
      const stop = (error) => {
        finish(error);
        handle?.abort();
      };
      const abort = () => stop(canceled());
      job.controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop(new Error('下載逾時（30 秒）')), LIMITS.timeout);
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET',
          url: asset.url,
          responseType: 'arraybuffer',
          timeout: LIMITS.timeout,
          onprogress(event) {
            if (Math.max(event.loaded || 0, event.total || 0) > LIMITS.file)
              stop(new Error('超過單檔 50 MiB 上限'));
          },
          onload(response) {
            if (response.status < 200 || response.status >= 300)
              return finish(new Error(`HTTP ${response.status}`));
            if (!response.response || typeof response.response.byteLength !== 'number')
              return finish(new Error('沒有收到檔案資料'));
            const headers = response.responseHeaders || '';
            finish(null, {
              bytes: new Uint8Array(response.response),
              mime:
                headers
                  .match(/^content-type:\s*([^;\r\n]+)/im)?.[1]
                  .trim()
                  .toLowerCase() || '',
              disposition: headers.match(/^content-disposition:\s*(.+)$/im)?.[1] || '',
            });
          },
          onerror: () => finish(new Error('下載失敗或未允許此附件網域')),
          ontimeout: () => finish(new Error('下載逾時（30 秒）')),
          onabort: () => finish(canceled()),
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  async function requestLocalAsset(asset, job) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    job.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LIMITS.timeout);
    try {
      // data URL 先估算大小，避免把遠超上限的 base64 再解碼一份。
      if (asset.url.startsWith('data:') && asset.url.length > LIMITS.file * 1.4)
        throw new Error('超過單檔 50 MiB 上限');
      const response = await fetch(asset.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > LIMITS.file)
        throw new Error('超過單檔 50 MiB 上限');
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mime: (response.headers.get('content-type') || '').split(';')[0].toLowerCase(),
        disposition: '',
      };
    } catch (error) {
      if (timedOut) throw new Error('下載逾時（30 秒）');
      if (job.controller.signal.aborted) throw canceled();
      throw error;
    } finally {
      clearTimeout(timer);
      job.controller.signal.removeEventListener('abort', abort);
    }
  }

  function decoded(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function validateAsset(asset, result) {
    if (!result.bytes.length) throw new Error('收到空檔案');
    if (result.bytes.length > LIMITS.file) throw new Error('超過單檔 50 MiB 上限');
    const beginning = new TextDecoder().decode(result.bytes.subarray(0, 1024)).trimStart();
    if (
      /html/i.test(result.mime) ||
      /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(beginning)
    ) {
      throw new Error('伺服器回傳 HTML／登入頁，未當成附件保存');
    }
    const isGeneric =
      !result.mime || /^(application\/octet-stream|binary\/octet-stream)$/.test(result.mime);
    if (asset.kind === 'image' && !result.mime.startsWith('image/') && !isGeneric)
      throw new Error('回應不是圖片');
    const fromDisposition =
      result.disposition.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i)?.[1] ||
      result.disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
      result.disposition.match(/filename\s*=\s*([^;\r\n]+)/i)?.[1] ||
      '';
    const fromUrl = /^https?:/.test(asset.url) ? new URL(asset.url).pathname.split('/').at(-1) : '';
    let filename = decoded(fromDisposition || asset.hint || fromUrl || asset.kind).trim();
    const mimeExtension = MIME_EXTENSIONS[result.mime];
    const ext = extension(filename);
    if (asset.kind === 'document') {
      if (
        !(mimeExtension && FILE_EXTENSIONS.has(mimeExtension)) &&
        !(isGeneric && FILE_EXTENSIONS.has(ext))
      ) {
        throw new Error('此回應不是支援的文件格式');
      }
      // 避免有 download 屬性的影片或執行檔被當成文件。
      if (mimeExtension && !FILE_EXTENSIONS.has(ext)) filename += `.${mimeExtension}`;
    } else if (
      mimeExtension &&
      ext !== mimeExtension &&
      !(mimeExtension === 'jpg' && ext === 'jpeg')
    ) {
      filename += `.${mimeExtension}`;
    } else if (!ext) filename += '.img';
    const suffix = extension(filename);
    const safe = safeName(filename, asset.kind);
    return suffix && !safe.toLowerCase().endsWith(`.${suffix}`) ? `${safe}.${suffix}` : safe;
  }

  function updateJobControls() {
    if (!state.dock) return;
    const shadow = state.dock.shadowRoot;
    shadow.querySelector('[data-action="zip"]').disabled = Boolean(state.job);
    shadow.querySelector('[data-action="cancel"]').hidden = !state.job;
  }

  function cancelExport() {
    state.job?.controller.abort();
  }

  async function exportZip() {
    if (state.job) {
      notify('附件匯出進行中，可按「取消匯出」停止');
      return;
    }
    const snapshot = extractSnapshot();
    const job = { controller: new AbortController(), bytes: 0 };
    state.job = job;
    updateJobControls();
    showPanel();
    try {
      const archive = new JSZip();
      const stamp = snapshot.metadata.captured_at.replace(/\D/g, '').slice(0, 12);
      const name = `${safeName(snapshot.metadata.title)}-${stamp}`;
      const folder = archive.folder(name);
      folder.folder('attachments');
      const paths = new Map();
      const report = Array(snapshot.assets.length);
      let next = 0;
      let completed = 0;
      notify(`準備下載 ${snapshot.assets.length} 個附件…`);
      const worker = async () => {
        while (next < snapshot.assets.length) {
          checkCanceled(job);
          const index = next++;
          const asset = snapshot.assets[index];
          const entry = {
            source: asset.url.startsWith('data:') ? '[內嵌 data URL]' : asset.url,
            kind: asset.kind,
            status: 'failed',
          };
          try {
            if (job.bytes >= LIMITS.total) throw new Error('超過附件總計 200 MiB 上限');
            const result = await requestAsset(asset, job);
            checkCanceled(job);
            const filename = validateAsset(asset, result);
            if (job.bytes + result.bytes.length > LIMITS.total)
              throw new Error('超過附件總計 200 MiB 上限');
            const path = `attachments/${String(index + 1).padStart(3, '0')}-${filename}`;
            folder.file(path, result.bytes, { binary: true, compression: 'STORE' });
            job.bytes += result.bytes.length;
            paths.set(asset.id, path);
            Object.assign(entry, { status: 'saved', path, bytes: result.bytes.length });
          } catch (error) {
            checkCanceled(job);
            entry.error = error.message || String(error);
          }
          report[index] = entry;
          completed++;
          notify(`附件 ${completed}/${snapshot.assets.length}：已保存 ${paths.size} 個`);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(LIMITS.workers, snapshot.assets.length) }, worker)
      );
      checkCanceled(job);
      const failed = report.filter((entry) => entry.status === 'failed').length;
      folder.file('article.md', renderMarkdown(snapshot, { paths }), { compression: 'DEFLATE' });
      folder.file(
        'export-report.json',
        JSON.stringify(
          {
            source: snapshot.metadata.url,
            captured_at: snapshot.metadata.captured_at,
            complete: failed === 0,
            saved: paths.size,
            failed,
            bytes: job.bytes,
            assets: report,
          },
          null,
          2
        ) + '\n',
        { compression: 'DEFLATE' }
      );
      const blob = await archive.generateAsync({ type: 'blob' }, ({ percent }) => {
        checkCanceled(job);
        notify(`打包 ZIP：${Math.round(percent)}%`);
      });
      checkCanceled(job);
      downloadBlob(`${name}.zip`, blob);
      notify(
        `ZIP 已下載：${paths.size} 個附件成功、${failed} 個失敗${failed ? '（保留原連結；詳見 export-report.json）' : ''}`
      );
    } catch (error) {
      if (job.controller.signal.aborted) notify('已取消本機匯出');
      else throw error;
    } finally {
      if (state.job === job) state.job = null;
      updateJobControls();
    }
  }

  function readerTheme() {
    return settings.theme === 'auto'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme;
  }

  function applyAppearance() {
    if (state.reader) {
      state.reader.dataset.theme = readerTheme();
      state.reader.style.setProperty('--prm-size', `${settings.fontSize}px`);
    }
    if (state.dock) state.dock.shadowRoot.querySelector('.shell').dataset.theme = readerTheme();
  }

  function saveAppearance() {
    GM_setValue('readerSettings', settings);
    applyAppearance();
  }

  function addReaderStyle() {
    if (document.getElementById(`${PREFIX}-style`)) return;
    const style = el(
      'style',
      `
      #${READER} {
        all:initial; position:fixed; inset:0; z-index:2147483000; display:block;
        overflow:auto; overscroll-behavior:contain; height:100dvh;
        --prm-bg:#faf9f5; --prm-fg:#25332f; --prm-muted:#65746d; --prm-line:#dfe4df; --prm-accent:#146e61;
        background:var(--prm-bg); color:var(--prm-fg); color-scheme:light;
        font:400 16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei",sans-serif;
        text-align:start; letter-spacing:normal;
      }
      #${READER}[data-theme=dark] {
        --prm-bg:#18211f; --prm-fg:#e2e9e4; --prm-muted:#a2b4aa; --prm-line:#35473f; --prm-accent:#8cd4bf;
        color-scheme:dark;
      }
      #${READER},#${READER} * { box-sizing:border-box; }
      #${READER} .prm-toolbar {
        position:sticky; top:0; z-index:1; display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:12px 24px; background:var(--prm-bg); border-bottom:1px solid var(--prm-line);
        font:500 13px/1.5 system-ui,sans-serif; color:var(--prm-muted);
      }
      #${READER} .prm-toolbar div { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      #${READER} button {
        appearance:none; font:600 13px/1.5 system-ui,sans-serif; color:var(--prm-accent);
        background:transparent; border:1px solid var(--prm-line); border-radius:9px; padding:7px 12px; cursor:pointer;
      }
      #${READER} button:hover { background:var(--prm-line); }
      #${READER} :focus-visible { outline:2px solid var(--prm-accent); outline-offset:3px; }
      #${READER} .prm-page { display:block; max-width:824px; margin:0 auto; padding:56px 32px 100px; }
      #${READER} .prm-heading { font-family:inherit; font-size:clamp(26px,3vw,40px); font-weight:700; line-height:1.35; margin:0 0 20px; color:var(--prm-fg); }
      #${READER} .prm-meta { color:var(--prm-muted); font-size:13px; line-height:1.8; margin:0 0 36px; overflow-wrap:anywhere; }
      #${READER} a { color:var(--prm-accent); text-decoration:underline; text-underline-offset:3px; }
      #${CONTENT} { display:block; font-size:var(--prm-size,20px); line-height:1.8; overflow-wrap:anywhere; }
      #${CONTENT} :where(p,div,section,span,a,li,td,th,blockquote,em,strong) { font-family:inherit; font-size:inherit; line-height:inherit; color:inherit; background:transparent; }
      #${CONTENT} p { display:block; margin:0 0 1.2em; }
      #${CONTENT} a { color:var(--prm-accent); }
      #${CONTENT} :where(h1,h2,h3,h4,h5,h6) { font-family:inherit; color:inherit; font-weight:700; line-height:1.45; margin:1.6em 0 .7em; }
      #${CONTENT} h1 { font-size:1.65em; } #${CONTENT} h2 { font-size:1.4em; } #${CONTENT} h3 { font-size:1.2em; }
      #${CONTENT} :where(h4,h5,h6) { font-size:1em; }
      #${CONTENT} :where(ul,ol) { padding-inline-start:1.6em; margin:1em 0; }
      #${CONTENT} li { display:list-item; margin:.3em 0; }
      #${CONTENT} img { display:block; max-width:100%; height:auto; margin:1.5em auto; border-radius:5px; }
      #${CONTENT} figure { margin:1.5em 0; } #${CONTENT} figcaption { font-size:.8em; color:var(--prm-muted); text-align:center; }
      #${CONTENT} blockquote { margin:1.5em 0; padding:.3em 0 .3em 1.2em; border-left:3px solid var(--prm-accent); }
      #${CONTENT} :where(pre,code) { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.85em; }
      #${CONTENT} pre { display:block; overflow:auto; white-space:pre; padding:20px; background:var(--prm-line); border-radius:10px; line-height:1.65; }
      #${CONTENT} pre code { font-size:inherit; white-space:pre; }
      #${CONTENT} table { display:block; overflow:auto; border-collapse:collapse; margin:1.4em 0; width:max-content; max-width:100%; font-size:.85em; }
      #${CONTENT} :where(td,th) { border:1px solid var(--prm-line); padding:8px 12px; min-width:60px; }
      #${CONTENT} hr { border:0; border-top:1px solid var(--prm-line); margin:2em 0; }
      @media(max-width:600px) { #${READER} .prm-page { padding:32px 20px 80px; } #${READER} .prm-toolbar { padding:10px 16px; } }
    `
    );
    document.documentElement.append(style);
  }

  function openReader() {
    if (state.reader?.isConnected) return;
    const snapshot = extractSnapshot();
    const reader = el('section', null, {
      id: READER,
      role: 'region',
      'aria-label': '專注閱讀',
      tabindex: '-1',
    });
    const toolbar = el('div', null, { class: 'prm-toolbar notranslate', translate: 'no' });
    const left = el('div', null);
    left.append(
      el('span', 'PAGE READER'),
      el('span', snapshot.scope === 'selection' ? '圈選內容' : '專注閱讀')
    );
    const right = el('div', null);
    const copy = el('button', '複製 Markdown', { type: 'button' });
    copy.addEventListener(
      'click',
      action(() => copyMarkdown())
    );
    const options = el('button', '匯出與設定', { type: 'button' });
    options.addEventListener('click', () => {
      state.dock.style.display = 'block';
      showPanel();
      state.scopeSelect?.focus();
    });
    const close = el('button', '返回原頁 · Esc', { type: 'button', 'data-action': 'close-reader' });
    close.addEventListener('click', () => closeReader());
    right.append(copy, options, close);
    toolbar.append(left, right);
    const page = el('div', null, { class: 'prm-page' });
    const title = el('h1', snapshot.metadata.title, { class: 'prm-heading' });
    const metadata = el('div', null, { class: 'prm-meta notranslate', translate: 'no' });
    const rawDate = snapshot.metadata.published_at;
    const publishedDate = rawDate ? new Date(rawDate) : null;
    const dateLabel =
      publishedDate && !Number.isNaN(publishedDate.getTime())
        ? publishedDate.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : rawDate;
    const details = [snapshot.metadata.author, dateLabel].filter(Boolean).join(' · ');
    if (details) metadata.append(el('div', details));
    metadata.append(
      el('a', snapshot.metadata.site, {
        href: snapshot.metadata.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      })
    );
    const article = el('article', null, { id: CONTENT, lang: snapshot.metadata.lang || '' });
    const content = sanitizedTree(snapshot.html);
    // 原頁仍在 DOM，Reader 的錨點必須有自己的 id，才不會跳到覆蓋層後方。
    const anchors = new Map();
    content.querySelectorAll('[id]').forEach((node, index) => {
      const id = node.id;
      node.id = `${PREFIX}-anchor-${index}`;
      anchors.set(id, node.id);
    });
    content.querySelectorAll('a[href]').forEach((link) => {
      const url = new URL(link.href);
      if (
        resourceUrl(url.href) === resourceUrl(snapshot.metadata.url) &&
        anchors.has(decoded(url.hash.slice(1)))
      ) {
        const id = anchors.get(decoded(url.hash.slice(1)));
        link.href = `#${id}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          document.getElementById(id)?.scrollIntoView({ block: 'center' });
        });
      } else {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
    content.querySelectorAll('img').forEach((image) => {
      image.loading = 'lazy';
      image.removeAttribute('width');
      image.removeAttribute('height');
    });
    article.append(...content.childNodes);
    page.append(title, metadata, article);
    reader.append(toolbar, page);
    state.restore = {
      body: document.body,
      overflow: document.body.style.getPropertyValue('overflow'),
      priority: document.body.style.getPropertyPriority('overflow'),
      x: scrollX,
      y: scrollY,
      focus: document.activeElement,
      url: location.href,
    };
    state.snapshot = snapshot;
    state.reader = reader;
    addReaderStyle();
    document.body.append(reader);
    document.body.style.setProperty('overflow', 'hidden', 'important');
    applyAppearance();
    hidePanel();
    updateScope();
    updateMainButton();
    close.focus({ preventScroll: true });
  }

  function closeReader(restorePosition = true) {
    state.reader?.remove();
    state.reader = null;
    state.snapshot = null;
    const saved = state.restore;
    state.restore = null;
    if (saved) {
      if (saved.overflow) saved.body.style.setProperty('overflow', saved.overflow, saved.priority);
      else saved.body.style.removeProperty('overflow');
      if (restorePosition && saved.url === location.href) {
        window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
        if (saved.focus?.isConnected) saved.focus.focus?.({ preventScroll: true });
      }
    }
    updateScope();
    updateMainButton();
  }

  function toggleReader() {
    checkRoute();
    if (state.reader) closeReader();
    else openReader();
  }

  function rememberSelection(preserve = false) {
    if (state.reader) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (ownNode(range.startContainer) || ownNode(range.endContainer)) return;
      const fragment = range.cloneContents();
      imageSources(
        [...document.images].filter((image) => range.intersectsNode(image)),
        fragment
      );
      state.selection = { url: location.href, fragment };
    } else if (!preserve && document.activeElement !== state.dock) {
      state.selection = null;
      state.scope = 'article';
    }
    updateScope();
  }

  function updateScope() {
    if (!state.scopeSelect) return;
    state.scopeSelect.disabled = Boolean(state.reader);
    state.scopeSelect.querySelector('[value="selection"]').disabled = !state.selection;
    state.scopeSelect.value = state.scope;
  }

  function updateMainButton() {
    const button = state.dock?.shadowRoot.querySelector('.main');
    if (!button) return;
    const label = state.reader ? '返回原頁' : '專注閱讀';
    button.title = `${label}；移入展開複製與匯出`;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(Boolean(state.reader)));
    button.classList.toggle('active', Boolean(state.reader));
  }

  function placePanel() {
    if (!state.panel || !state.dock) return;
    const rect = state.dock.getBoundingClientRect();
    const leftSide = rect.left > innerWidth / 2;
    state.panel.style.maxHeight = 'calc(100dvh - 16px)';
    const width = state.panel.offsetWidth;
    const x = Math.max(
      8,
      Math.min(leftSide ? rect.left - 12 - width : rect.right + 12, innerWidth - width - 8)
    );
    state.panel.style.left = `${x - rect.left}px`;
    state.panel.style.right = 'auto';
    if (Math.max(rect.left - 20, innerWidth - rect.right - 20) < width) {
      // 窄視窗改放上／下方，避免面板蓋住「直接切換 Reader」的主按鈕。
      const above = rect.top > innerHeight - rect.bottom;
      const space = Math.max(0, (above ? rect.top : innerHeight - rect.bottom) - 20);
      state.panel.style.maxHeight = `${space}px`;
      state.panel.style.top = `${above ? -state.panel.offsetHeight - 12 : rect.height + 12}px`;
    } else {
      state.panel.style.top = `${Math.max(8 - rect.top, Math.min(-12, innerHeight - rect.top - state.panel.offsetHeight - 8))}px`;
    }
  }

  function showPanel() {
    clearTimeout(hideTimer);
    if (!state.panel) return;
    state.panel.hidden = false;
    state.dock.shadowRoot.querySelector('.main').setAttribute('aria-expanded', 'true');
    updateScope();
    placePanel();
  }

  function hidePanel() {
    clearTimeout(hideTimer);
    if (state.panel) state.panel.hidden = true;
    state.dock?.shadowRoot.querySelector('.main').setAttribute('aria-expanded', 'false');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (state.job || state.dock?.shadowRoot.activeElement) return;
      hidePanel();
    }, 220);
  }

  function positionDock(position) {
    if (!state.dock) return;
    const left = Math.max(8, Math.min(Number(position?.left) || innerWidth - 64, innerWidth - 56));
    const top = Math.max(
      8,
      Math.min(Number(position?.top) || innerHeight * 0.55, innerHeight - 56)
    );
    state.dock.style.left = `${left}px`;
    state.dock.style.top = `${top}px`;
    placePanel();
  }

  function makeDraggable(button) {
    let drag = null;
    let suppressClick = false;
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      rememberSelection(true);
      button.setPointerCapture(event.pointerId);
      const rect = state.dock.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    });
    button.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        button.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      hidePanel();
      positionDock({ left: drag.left + dx, top: drag.top + dy });
    });
    const finish = (event) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      if (!moved) return;
      const rect = state.dock.getBoundingClientRect();
      GM_setValue('buttonPosition', { left: rect.left, top: rect.top });
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    };
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', finish);
    button.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      action(toggleReader)();
    });
  }

  function hideSite() {
    GM_setValue(`hidden:${location.hostname}`, true);
    hidePanel();
    state.dock.style.display = 'none';
  }

  function showSite() {
    GM_setValue(`hidden:${location.hostname}`, false);
    mount();
    state.dock.style.display = 'block';
    notify('已顯示本站按鈕');
  }

  function copyLink() {
    const title = document.title.replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ');
    const url = location.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    GM_setClipboard(`[${title}](${url})`, 'text');
    notify('已複製 Markdown link');
  }

  const ACTIONS = [
    {
      label: '複製 Markdown',
      hint: '正文、metadata、圖片連結',
      run: () => copyMarkdown(),
      id: 'copy',
    },
    {
      label: '複製僅正文',
      hint: '文字 Markdown，方便貼給 AI',
      run: () => copyMarkdown(true),
      id: 'body',
    },
    {
      label: '下載 Markdown',
      hint: '儲存 .md，附件保留網址',
      run: downloadMarkdown,
      id: 'markdown',
    },
    { label: '完整本機匯出 · ZIP', hint: 'Markdown ＋圖片與文件附件', run: exportZip, id: 'zip' },
  ];

  function mount() {
    if (!document.body || state.dock?.isConnected) return;
    const host = el('div', null, { id: DOCK, class: 'notranslate', translate: 'no' });
    host.style.cssText =
      'all:initial;position:fixed;display:block;width:48px;height:48px;z-index:2147483646;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(
      el(
        'style',
        `
      :host { font:400 13px/1.5 system-ui,-apple-system,"PingFang TC",sans-serif; }
      * { box-sizing:border-box; } [hidden] { display:none !important; }
      .shell { font:400 13px/1.5 system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif; --bg:#fff; --fg:#253b34; --muted:#74847b; --line:#e4ebe6; --accent:#147661; --hover:#f0f6f2; color:var(--fg); }
      .shell[data-theme=dark] { --bg:#222f29; --fg:#e2ebe5; --muted:#a3b5a9; --line:#3b4d42; --accent:#9edcc4; --hover:#304338; }
      button,select,input { font:inherit; } button { cursor:pointer; }
      button:disabled,select:disabled { opacity:.5; cursor:default; }
      :focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
      .main { display:grid; place-items:center; width:48px; height:48px; padding:0; border:1px solid var(--line); border-radius:50%;
        background:var(--bg); color:var(--accent); box-shadow:0 4px 24px #143b2520; touch-action:none; opacity:.82; transition:opacity .15s,transform .15s; }
      .main:hover,.main:focus-visible,.main.active { opacity:1; } .main:hover { transform:scale(1.04); }
      .main svg { width:23px; height:23px; pointer-events:none; }
      .panel { position:absolute; width:280px; max-width:calc(100vw - 80px); max-height:calc(100dvh - 16px); overflow:auto;
        padding:16px; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:16px; box-shadow:0 12px 48px #153b2525; }
      .eyebrow { font-size:10px; font-weight:750; letter-spacing:1.5px; color:var(--muted); margin:0 0 12px; }
      .scope { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; color:var(--muted); }
      select { border:1px solid var(--line); background:var(--bg); color:var(--fg); padding:5px 7px; border-radius:7px; max-width:165px; }
      .item { display:block; width:100%; text-align:left; color:var(--fg); background:transparent; border:0; border-radius:9px; padding:10px 9px; }
      .item:hover { background:var(--hover); } .item strong { display:block; font-size:13px; font-weight:650; }
      .item small { display:block; font-size:11px; color:var(--muted); margin-top:2px; }
      .item.primary { background:var(--hover); color:var(--accent); }
      .rule { height:1px; background:var(--line); margin:12px 0; }
      details { font-size:12px; } summary { cursor:pointer; padding:4px 0; color:var(--muted); }
      .setting { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; }
      input[type=range] { width:115px; accent-color:var(--accent); }
      .status { margin-top:12px; padding-top:10px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
      .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); max-width:min(640px,90vw); padding:12px 20px;
        border-radius:12px; background:#203d32; color:#fff; font-size:13px; box-shadow:0 4px 24px #0002; pointer-events:none; }
      .toast.error { background:#743d35; }
      .cancel { color:#af5149; }
    `
      )
    );
    const shell = el('div', null, { class: 'shell' });
    const main = el('button', null, {
      class: 'main',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'actions',
    });
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1m0-15v15'
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linejoin', 'round');
    icon.append(path);
    main.append(icon);
    const panel = el('div', null, {
      class: 'panel',
      id: 'actions',
      hidden: '',
      'aria-label': '內容匯出與閱讀設定',
    });
    panel.append(el('div', 'PAGE READER', { class: 'eyebrow' }));
    const scopeLabel = el('label', '擷取範圍', { class: 'scope' });
    const scopeSelect = el('select', null, { 'aria-label': '擷取範圍' });
    scopeSelect.append(
      el('option', '正文', { value: 'article' }),
      el('option', '目前圈選', { value: 'selection' })
    );
    scopeSelect.addEventListener('change', () => {
      state.scope = scopeSelect.value;
    });
    scopeLabel.append(scopeSelect);
    panel.append(scopeLabel);
    for (const item of ACTIONS) {
      const button = el('button', null, {
        class: `item${item.id === 'copy' ? ' primary' : ''}`,
        type: 'button',
        'data-action': item.id,
      });
      button.append(el('strong', item.label), el('small', item.hint));
      button.addEventListener('click', action(item.run));
      panel.append(button);
    }
    const cancel = el('button', '取消匯出', {
      class: 'item cancel',
      type: 'button',
      'data-action': 'cancel',
      hidden: '',
    });
    cancel.addEventListener('click', cancelExport);
    panel.append(cancel, el('div', null, { class: 'rule' }));
    const more = el('details');
    more.append(el('summary', '更多與閱讀設定'));
    for (const [label, run] of [
      [
        '複製 URL',
        () => {
          GM_setClipboard(location.href, 'text');
          notify('已複製 URL');
        },
      ],
      ['複製 Markdown link', copyLink],
      ['隱藏本站按鈕', hideSite],
    ]) {
      const button = el('button', label, { class: 'item', type: 'button' });
      button.addEventListener('click', action(run));
      more.append(button);
    }
    const fontLabel = el('label', null, { class: 'setting' });
    const fontValue = el('span', `字級 ${settings.fontSize}`);
    const size = el('input', null, {
      type: 'range',
      min: '16',
      max: '30',
      step: '1',
      value: String(settings.fontSize),
      'aria-label': '閱讀字級',
    });
    size.addEventListener('input', () => {
      settings.fontSize = Number(size.value);
      fontValue.textContent = `字級 ${settings.fontSize}`;
      saveAppearance();
    });
    fontLabel.append(fontValue, size);
    const themeLabel = el('label', '主題', { class: 'setting' });
    const theme = el('select', null, { 'aria-label': '閱讀主題' });
    for (const [value, label] of [
      ['auto', '跟隨系統'],
      ['light', '亮色'],
      ['dark', '暗色'],
    ])
      theme.append(el('option', label, { value }));
    theme.value = settings.theme;
    theme.addEventListener('change', () => {
      settings.theme = theme.value;
      saveAppearance();
    });
    themeLabel.append(theme);
    more.append(fontLabel, themeLabel);
    more.addEventListener('toggle', placePanel);
    panel.append(more, el('div', state.status, { class: 'status' }));
    const toast = el('div', '', {
      class: 'toast',
      role: 'status',
      'aria-live': 'polite',
      hidden: '',
    });
    shell.append(main, panel, toast);
    shadow.append(shell);
    Object.assign(state, { dock: host, panel, toast, scopeSelect });
    host.addEventListener('pointerdown', () => rememberSelection(true), true);
    main.addEventListener('pointerenter', showPanel);
    main.addEventListener('pointerleave', scheduleHide);
    main.addEventListener('focus', showPanel);
    panel.addEventListener('pointerenter', showPanel);
    panel.addEventListener('pointerleave', scheduleHide);
    host.addEventListener('focusout', scheduleHide);
    makeDraggable(main);
    document.body.append(host);
    if (GM_getValue(`hidden:${location.hostname}`, false)) host.style.display = 'none';
    positionDock(GM_getValue('buttonPosition', null));
    applyAppearance();
    updateScope();
    updateMainButton();
    updateJobControls();
  }

  function checkRoute() {
    if (state.url === location.href) return;
    state.url = location.href;
    cancelExport();
    closeReader(false);
    state.selection = null;
    state.scope = 'article';
    hidePanel();
    updateScope();
    notify('已切換頁面，下次操作會重新擷取');
  }

  for (const item of ACTIONS) GM_registerMenuCommand(item.label, action(item.run));
  GM_registerMenuCommand('切換專注閱讀', action(toggleReader));
  GM_registerMenuCommand(
    '以目前圈選開啟 Reader',
    action(() => {
      if (state.reader) closeReader();
      rememberSelection(true);
      state.scope = 'selection';
      updateScope();
      openReader();
    })
  );
  GM_registerMenuCommand('複製 URL', () => {
    GM_setClipboard(location.href, 'text');
    notify('已複製 URL');
  });
  GM_registerMenuCommand('複製 Markdown link', action(copyLink));
  GM_registerMenuCommand('顯示本站按鈕', showSite);
  GM_registerMenuCommand('隱藏本站按鈕', hideSite);
  GM_registerMenuCommand('重設按鈕位置', () => {
    GM_setValue('buttonPosition', null);
    positionDock(null);
  });
  GM_registerMenuCommand('取消本機匯出', cancelExport);

  document.addEventListener('selectionchange', () => rememberSelection());
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || (!state.reader && state.panel?.hidden)) return;
      event.preventDefault();
      event.stopPropagation();
      closeReader();
      hidePanel();
    },
    true
  );
  window.addEventListener('resize', () => {
    if (!state.dock) return;
    const rect = state.dock.getBoundingClientRect();
    positionDock({ left: rect.left, top: rect.top });
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  window.addEventListener('pagehide', cancelExport);
  let mountTimer;
  new MutationObserver((records) => {
    if (records.every((record) => ownNode(record.target))) return;
    clearTimeout(mountTimer);
    mountTimer = setTimeout(() => {
      checkRoute();
      if (state.reader && !state.reader.isConnected) closeReader(false);
      mount();
    }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // pushState 可以完全沒有 DOM mutation，額外比對 URL 才不會沿用舊快照。
  setInterval(checkRoute, 750);
  mount();
})();
