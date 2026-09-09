// ==UserScript==
// @name         Media Helper
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  預覽網頁圖片與影片、選擇頁面最大圖片版本，支援單檔與多選逐檔下載
// @author       Da-Wei Lee
// @license      MIT
// @match        https://*/*
// @match        http://*/*
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCgyMDcgNjIlIDQ2JSkiLz48dGV4dCB4PSIzMiIgeT0iMzMiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNyIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9ImNlbnRyYWwiPk1IPC90ZXh0Pjwvc3ZnPg==
// @run-at       document-start
// @grant        GM_download
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/media-helper/media-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/media-helper/media-helper.user.js
// ==/UserScript==

/** 頁面媒體與資源紀錄分開處理；不改寫 CDN URL，也不攔截網站請求。 */
(function () {
  'use strict';

  if (window.top !== window || !/html/i.test(document.contentType || '')) return;
  const marker = Symbol.for('media-helper.running');
  if (document[marker]) return;
  document[marker] = true;

  const ID = 'media-helper-ui';
  const CONFIG = 'mediaHelperConfig';
  const MAX_RESOURCES = 1000;
  const MAX_ACTIVE = 2;
  const IDLE_TIMEOUT = 60_000;
  const IMAGE_EXT = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
  const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;
  const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
  };
  const ids = new WeakMap();
  const backgrounds = new Set();
  const resources = new Map();
  const ownRequests = new Map();
  const variants = new Map();
  const selected = new Set();
  const cards = new Map();
  const tasks = [];
  let nextId = 0;
  let nextTask = 0;
  let items = [];
  let pageUrl = location.href;
  let lastLocationCheck = performance.now();
  let resourceCutoff = 0;
  let host, shadow, dock, panel, gallery, toolbar, notice, count, selectionButton, queue;
  let view, filter, scanTimer, hoverTimer, hovered, point, hoverFrame, previousFocus;
  let isOpen = false;
  let config;
  try {
    config = GM_getValue(CONFIG, {});
  } catch {
    config = {};
  }
  if (!config || typeof config !== 'object') config = {};
  const prefs = config.sites?.[location.origin] || {};
  let hidden = prefs.hidden === true;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function button(label, run, attrs = {}) {
    const node = el('button', label, { type: 'button', ...attrs });
    node.addEventListener('click', run);
    return node;
  }
  function owned(node) {
    return node === host || node?.getRootNode?.().host === host;
  }
  function notify(message) {
    if (notice) notice.textContent = message;
    if (!isOpen && hovered) toolbar.querySelector('.hover-label').textContent = message;
  }
  function normalized(raw) {
    if (!raw) return '';
    try {
      const url = new URL(raw, document.baseURI);
      return /^(https?:|blob:)$/.test(url.protocol) || /^data:image\//i.test(raw) ? url.href : '';
    } catch {
      return '';
    }
  }
  function pathOf(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  }
  function mimeOf(raw = '') {
    return raw.split(';')[0].trim().toLowerCase();
  }
  function capability(item, variant) {
    const url = variant?.url || '';
    const mime = mimeOf(variant?.mime);
    const path = pathOf(url);
    if (/\.(m3u8|mpd)$/i.test(path) || /mpegurl|dash\+xml/.test(mime)) return 'stream';
    if (
      /\.(m4s|ts|cmfv|cmfa)$/i.test(path) ||
      mime === 'video/mp2t' ||
      /[?&](?:bytestart|byteend|range|segment_index)=/i.test(url)
    )
      return 'segment';
    if (!/^https?:/.test(url)) return 'local';
    // Network 的 mp4 可能只有音軌、影像軌或分段；不能從副檔名推論完整影片。
    if (item.kind === 'video' && item.source === 'resource') return 'candidate';
    if (item.kind === 'video' && !VIDEO_EXT.test(path) && !mime.startsWith('video/'))
      return 'candidate';
    return 'direct';
  }
  const STATUS = {
    direct: '可下載',
    stream: '串流 · 尚未支援合併',
    segment: '分段資源 · 非完整影片',
    local: '暫存／播放器來源 · 尚未支援下載',
    candidate: '影片候選 · 完整性未確認',
  };
  function current(item) {
    return item.variants.find((entry) => entry.url === variants.get(item.id)) || item.variants[0];
  }
  function downloadable(item) {
    return capability(item, current(item)) === 'direct';
  }

  // 按 srcset 的 URL token／descriptor 分段；URL 中的逗號（含 data URL）不能直接 split。
  function parseSrcset(input = '') {
    const result = [];
    let i = 0;
    while (i < input.length) {
      while (/[\s,]/.test(input[i] || '') && i < input.length) i++;
      let raw = '';
      while (i < input.length && !/\s/.test(input[i])) raw += input[i++];
      if (!raw) break;
      let descriptor = '';
      if (/,$/.test(raw)) raw = raw.replace(/,+$/, '');
      else {
        let depth = 0;
        while (i < input.length) {
          const char = input[i++];
          if (char === ',' && depth === 0) break;
          if (char === '(') depth++;
          if (char === ')') depth--;
          descriptor += char;
        }
      }
      descriptor = descriptor.trim();
      const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/);
      if (descriptor && (!match || Number(match[1]) <= 0)) continue;
      if (match?.[2] === 'w' && !/^\d+$/.test(match[1])) continue;
      const url = normalized(raw);
      if (url)
        result.push({
          url,
          width: match?.[2] === 'w' ? Number(match[1]) : 0,
          density: match?.[2] === 'x' ? Number(match[1]) : descriptor ? 0 : 1,
          label: descriptor ? `srcset · ${descriptor}` : 'srcset',
        });
    }
    return result;
  }
  function unique(list) {
    const seen = new Set();
    return list.filter((entry) => entry.url && !seen.has(entry.url) && seen.add(entry.url));
  }
  function imageVariants(image) {
    const displayed = normalized(image.currentSrc);
    const picture = image.parentElement?.tagName === 'PICTURE' ? image.parentElement : null;
    const sources = picture ? [...picture.querySelectorAll('source')] : [];
    // currentSrc 是瀏覽器選擇的證據；不同 media／裁切構圖的 source 不混排。
    const activeSource = sources.find((source) =>
      parseSrcset(source.getAttribute('srcset') || '').some((entry) => entry.url === displayed)
    );
    let responsive = parseSrcset((activeSource || image).getAttribute('srcset') || '');
    const metric = responsive.some((entry) => entry.width) ? 'width' : 'density';
    responsive = responsive.sort((a, b) => b[metric] - a[metric]);
    const lazy = ['data-original', 'data-src', 'data-lazy-src'].map((key) => ({
      url: normalized(image.getAttribute(key)),
      label: key,
    }));
    const fallback = [
      { url: displayed, label: '目前顯示版本' },
      { url: normalized(image.getAttribute('src')), label: 'src' },
    ];
    const original = lazy.filter((entry) => entry.label === 'data-original');
    const validDisplay = displayed && !/^(data:|blob:)/.test(displayed);
    return unique([
      ...responsive,
      ...original,
      ...(validDisplay ? fallback : lazy),
      ...lazy,
      ...fallback,
    ]);
  }
  function backgroundUrls(node) {
    const style = getComputedStyle(node).backgroundImage;
    const urls = [];
    // v1 只處理 url()；image-set 的密度／格式選擇留給瀏覽器，不猜最大版本。
    if (/image-set\(/i.test(style)) return urls;
    for (const match of style.matchAll(
      /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/g
    )) {
      const url = normalized(
        (match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, '$1').trim()
      );
      if (url) urls.push(url);
    }
    return urls;
  }
  function idFor(node) {
    if (!ids.has(node)) ids.set(node, `page-${++nextId}`);
    return ids.get(node);
  }
  function scan(fullBackgrounds = false) {
    if (!document.body) return;
    const routeChanged = syncRoute();
    fullBackgrounds ||= routeChanged;
    const found = [];
    for (const node of document.querySelectorAll('img,video')) {
      if (owned(node)) continue;
      const video = node.tagName === 'VIDEO';
      const list = video
        ? unique([
            { url: normalized(node.currentSrc), label: '目前播放來源' },
            {
              url: normalized(node.getAttribute('src')),
              label: 'src',
              mime: node.getAttribute('type') || '',
            },
            ...[...node.querySelectorAll('source')].map((source) => ({
              url: normalized(source.getAttribute('src')),
              label: 'source',
              mime: source.type,
            })),
          ])
        : imageVariants(node);
      // 同一 URL 的 source.type 補到 currentSrc，避免遺失 extensionless HLS 等型別證據。
      if (video)
        for (const entry of list) {
          entry.mime ||=
            [...node.querySelectorAll('source')].find(
              (source) => normalized(source.src) === entry.url
            )?.type || '';
        }
      if (!list.length && !video) continue;
      found.push({
        id: idFor(node),
        kind: video ? 'video' : 'image',
        source: 'page',
        title:
          (video ? node.getAttribute('aria-label') || node.title : node.alt) ||
          (video ? '影片' : '圖片'),
        variants: list,
        elements: [node],
        preview: video ? normalized(node.poster) : normalized(node.currentSrc || node.src),
        width: video ? node.videoWidth : node.naturalWidth,
        height: video ? node.videoHeight : node.naturalHeight,
        duration: video && Number.isFinite(node.duration) ? node.duration : 0,
      });
      if (video && node.poster)
        found.push({
          id: `${idFor(node)}-poster`,
          kind: 'image',
          source: 'page',
          title: '影片封面',
          variants: [{ url: normalized(node.poster), label: 'poster · 封面' }],
          elements: [],
          preview: normalized(node.poster),
          width: 0,
          height: 0,
        });
    }
    const candidates = fullBackgrounds
      ? document.querySelectorAll('body *')
      : document.querySelectorAll('[style*="background"]');
    for (const node of candidates) {
      if (!owned(node) && node !== document.body && backgroundUrls(node).length)
        backgrounds.add(node);
    }
    for (const node of backgrounds) {
      if (!node.isConnected || owned(node)) {
        backgrounds.delete(node);
        continue;
      }
      const urls = backgroundUrls(node);
      if (!urls.length) {
        backgrounds.delete(node);
        continue;
      }
      urls.forEach((url, index) =>
        found.push({
          id: `${idFor(node)}-bg-${index}`,
          kind: 'image',
          source: 'page',
          title: '背景圖片',
          variants: [{ url, label: '背景圖片' }],
          elements: [node],
          preview: url,
          width: 0,
          height: 0,
        })
      );
    }
    const merged = new Map();
    for (const item of found) {
      const key = `${item.kind}:${item.variants[0]?.url || item.id}`;
      const existing = merged.get(key);
      if (existing) existing.elements.push(...item.elements);
      else merged.set(key, item);
    }
    items = [...merged.values()];
    const valid = new Set([
      ...items.map((item) => item.id),
      ...[...resources.values()].map((item) => item.id),
    ]);
    for (const key of selected) if (!valid.has(key)) selected.delete(key);
    for (const key of variants.keys()) if (!valid.has(key)) variants.delete(key);
    if (isOpen) renderCards();
    if (hovered) {
      const item = items.find((item) => item.elements.includes(hovered.node));
      if (item) showHover(item, hovered.node);
      else hideHover();
    }
  }
  function scheduleScan() {
    if (!scanTimer)
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scan();
      }, 220);
  }
  function addResource(entry) {
    if (syncRoute()) scheduleScan();
    if (entry.startTime < resourceCutoff) return;
    const url = normalized(entry.name);
    const ownStart = ownRequests.get(url);
    if (
      !/^https?:/.test(url) ||
      (ownStart !== undefined && entry.startTime >= ownStart) ||
      resources.has(url)
    )
      return;
    const path = pathOf(url);
    const mime = mimeOf(entry.contentType);
    const image =
      IMAGE_EXT.test(path) || entry.initiatorType === 'img' || mime.startsWith('image/');
    const video =
      VIDEO_EXT.test(path) ||
      /\.(m3u8|mpd|m4s|ts|cmfv|cmfa)$/i.test(path) ||
      entry.initiatorType === 'video' ||
      mime.startsWith('video/') ||
      /mpegurl|dash\+xml/.test(mime);
    if (!image && !video) return;
    resources.set(url, {
      id: `resource-${++nextId}`,
      kind: image ? 'image' : 'video',
      source: 'resource',
      title: image ? '圖片資源' : '影片資源候選',
      variants: [{ url, mime, label: '已載入資源' }],
      preview: image ? url : '',
      elements: [],
      width: 0,
      height: 0,
    });
    while (resources.size > MAX_RESOURCES) resources.delete(resources.keys().next().value);
    scheduleScan();
  }
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(addResource));
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    /* 不支援 buffered observer 時，手動重新掃描仍可讀取現有紀錄。 */
  }

  function sourceLabel(url) {
    try {
      return new URL(url).hostname || new URL(url).protocol;
    } catch {
      return '尚無網址';
    }
  }
  function rememberOwn(url) {
    // 不移除原頁已經出現的紀錄；只排除 helper 新產生的載入。
    if (url && !resources.has(url) && !ownRequests.has(url))
      ownRequests.set(url, performance.now());
    while (ownRequests.size > MAX_RESOURCES * 2)
      ownRequests.delete(ownRequests.keys().next().value);
  }
  function openSource(item) {
    const url = current(item)?.url;
    if (!url) return;
    try {
      GM_openInTab(url, { active: true, insert: true });
    } catch (error) {
      notify(`無法開啟來源：${error.message}`);
    }
  }
  function copySource(item) {
    const url = current(item)?.url;
    if (!url) return;
    try {
      GM_setClipboard(url, 'text');
      notify('已複製來源網址');
    } catch (error) {
      notify(`複製失敗：${error.message}`);
    }
  }
  function actions(item, compact = false) {
    const group = el('div', null, { class: 'actions' });
    const open = button('開啟來源', () => openSource(item));
    const copy = button('複製網址', () => copySource(item));
    open.disabled =
      !current(item)?.url || (item.kind === 'video' && capability(item, current(item)) === 'local');
    copy.disabled = !current(item)?.url;
    const download = button('下載', () => enqueue([item]), { 'data-action': 'download' });
    download.disabled = !downloadable(item);
    download.title = STATUS[capability(item, current(item))];
    group.append(open, copy, download);
    if (compact) group.append(button('查看其他版本', () => openPanel(item.id)));
    return group;
  }
  function visibleItems() {
    const list = view.value === 'page' ? items : [...resources.values()];
    return list.filter((item) => filter.value === 'all' || item.kind === filter.value);
  }
  function cardFor(item) {
    const variant = current(item);
    const card = el('article', null, {
      class: 'card',
      'data-item': item.id,
      'data-kind': item.kind,
      'data-capability': capability(item, variant),
    });
    const heading = el('label', null, { class: 'card-heading' });
    const check = el('input', null, { type: 'checkbox', 'aria-label': `選取 ${item.title}` });
    check.checked = selected.has(item.id);
    check.disabled = !downloadable(item);
    if (check.disabled) selected.delete(item.id);
    check.addEventListener('change', () => {
      if (check.checked) selected.add(item.id);
      else selected.delete(item.id);
      updateSelection();
    });
    heading.append(check, el('strong', item.title));
    const preview = el('div', null, { class: 'preview' });
    if (item.preview) {
      const image = el('img', null, {
        alt: item.kind === 'video' ? '影片封面' : item.title,
        loading: 'lazy',
        decoding: 'async',
      });
      rememberOwn(item.preview);
      image.src = item.preview;
      preview.append(image);
    } else preview.append(el('span', item.kind === 'video' ? '▶ 影片來源' : '圖片'));
    if (item.kind === 'video' && downloadable(item))
      preview.append(
        button(
          '預覽影片',
          (event) => {
            event.currentTarget.remove();
            const player = el('video', null, {
              controls: '',
              preload: 'metadata',
              playsinline: '',
            });
            rememberOwn(variant.url);
            player.src = variant.url;
            preview.replaceChildren(player);
          },
          { class: 'play-preview' }
        )
      );
    const info = [];
    if (item.width && item.height) info.push(`${item.width} × ${item.height}（顯示版本）`);
    else info.push('尺寸未知');
    if (item.duration) info.push(`${Math.round(item.duration)} 秒`);
    info.push(sourceLabel(variant?.url));
    const status = el('p', STATUS[capability(item, variant)], { class: 'badge' });
    card.append(heading, preview, el('p', info.join(' · '), { class: 'meta' }), status);
    if (item.variants.length > 1) {
      const picker = el('select', null, { 'aria-label': '圖片或影片版本' });
      item.variants.forEach((entry, index) =>
        picker.append(
          el(
            'option',
            `${index === 0 && item.kind === 'image' ? '預設候選 · ' : ''}${entry.label} · ${sourceLabel(entry.url)}`,
            { value: entry.url }
          )
        )
      );
      picker.value = variant.url;
      picker.addEventListener('change', () => {
        variants.set(item.id, picker.value);
        renderCards();
        if (hovered?.item.id === item.id) showHover(item, hovered.node);
      });
      card.append(picker);
    }
    const detail = el('details');
    detail.append(el('summary', '來源網址'));
    const source = el('input', null, { readonly: '', 'aria-label': '來源網址', type: 'text' });
    source.value = variant?.url || '播放器尚未提供可複製的網址';
    source.addEventListener('click', () => source.select());
    detail.append(source);
    card.append(detail, actions(item));
    return card;
  }
  function renderCards() {
    if (!gallery) return;
    const list = visibleItems();
    const visible = new Set(list.map((item) => item.id));
    for (const [id, value] of cards)
      if (!visible.has(id)) {
        value.node.remove();
        cards.delete(id);
      }
    list.forEach((item, index) => {
      const signature = JSON.stringify([
        item.title,
        item.preview,
        item.width,
        item.height,
        item.duration,
        item.variants,
        current(item)?.url,
      ]);
      let cached = cards.get(item.id);
      if (!cached || cached.signature !== signature) {
        const node = cardFor(item);
        if (cached) cached.node.replaceWith(node);
        cached = { node, signature };
        cards.set(item.id, cached);
      }
      if (gallery.children[index] !== cached.node)
        gallery.insertBefore(cached.node, gallery.children[index] || null);
      cached.node.querySelector('input[type=checkbox]').checked = selected.has(item.id);
    });
    count.textContent = list.length
      ? `${list.length} 項${view.value === 'resources' ? ' · 資源紀錄可能不完整，影片候選不代表完整影片' : ' · 頁面可用版本，不保證是上傳原檔'}`
      : '目前沒有符合的媒體；可捲動頁面、切換輪播後重新掃描。';
    updateSelection();
  }
  function updateSelection() {
    selectionButton.textContent = `下載已選（${selected.size}）`;
    selectionButton.disabled = !selected.size;
  }

  function safeName(text) {
    return (
      String(text)
        .normalize('NFC')
        .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-')
        .replace(/[.\s]+$/g, '')
        .slice(0, 72) || 'media'
    );
  }
  function filenameFor(item, variant, seq) {
    let leaf = pathOf(variant.url).split('/').pop() || '';
    try {
      leaf = decodeURIComponent(leaf);
    } catch {
      /* 保留無法解碼的原字串。 */
    }
    const ext =
      leaf.match(item.kind === 'image' ? IMAGE_EXT : VIDEO_EXT)?.[1]?.toLowerCase() ||
      MIME_EXT[mimeOf(variant.mime)] ||
      '';
    const title = safeName(document.title || item.title);
    return `${safeName(location.hostname)}-${title}-${String(seq).padStart(3, '0')}${ext ? `.${ext}` : ''}`;
  }
  function enqueue(list) {
    const pending = new Set(
      tasks.filter((task) => ['queued', 'downloading'].includes(task.state)).map((task) => task.url)
    );
    let added = 0;
    for (const item of list) {
      const variant = current(item);
      if (!downloadable(item) || pending.has(variant.url)) continue;
      const seq = ++nextTask;
      tasks.push({
        seq,
        url: variant.url,
        name: filenameFor(item, variant, seq),
        state: 'queued',
        loaded: 0,
        total: 0,
        attempt: 0,
      });
      pending.add(variant.url);
      added++;
    }
    // 保留正在進行的項目與最近的結果，避免長時間使用累积無限歷史。
    while (tasks.length > 200) {
      const index = tasks.findIndex((task) => !['queued', 'downloading'].includes(task.state));
      if (index < 0) break;
      tasks[index].node?.remove();
      tasks.splice(index, 1);
    }
    if (!isOpen) openPanel();
    notify(added ? `已加入 ${added} 個下載` : '沒有新的可下載項目（已在佇列的網址不會重複加入）');
    renderQueue();
    pump();
  }
  function errorText(error) {
    const code = error?.error || error?.message || String(error || '未知錯誤');
    return (
      {
        not_enabled: 'manager 尚未啟用下載',
        not_whitelisted: 'manager 尚未允許此副檔名',
        not_permitted: '下載權限或 CDN 網域尚未允許',
        not_supported: 'manager 不支援此下載方式',
        not_succeeded: '來源請求失敗；網址可能已過期，可重新掃描或開啟來源',
      }[code] || String(code)
    );
  }
  function pump() {
    while (tasks.filter((task) => task.state === 'downloading').length < MAX_ACTIVE) {
      const task = tasks.find((task) => task.state === 'queued');
      if (!task) break;
      startDownload(task);
    }
    renderQueue();
  }
  function startDownload(task) {
    task.state = 'downloading';
    const attempt = ++task.attempt;
    const live = () => task.state === 'downloading' && task.attempt === attempt;
    const finish = (state, message = '') => {
      if (!live()) return;
      clearTimeout(task.timer);
      task.state = state;
      task.message = message;
      renderQueue();
      setTimeout(pump, 0);
    };
    const stop = (state, message) => {
      finish(state, message);
      try {
        task.handle?.abort();
      } catch {
        /* 已完成的請求可能無法再次 abort。 */
      }
    };
    task.cancel = () => {
      if (live()) stop('canceled', '已取消');
    };
    const resetTimeout = () => {
      clearTimeout(task.timer);
      task.timer = setTimeout(() => {
        if (live()) stop('failed', '60 秒未收到進度，已停止；可重試或開啟來源');
      }, IDLE_TIMEOUT);
    };
    resetTimeout();
    try {
      task.handle = GM_download({
        url: task.url,
        name: task.name,
        onload: () => finish('done', 'manager 已回報完成'),
        onerror: (error) => finish('failed', errorText(error)),
        ontimeout: () => {
          if (live()) stop('failed', '下載逾時');
        },
        onprogress: (event) => {
          if (!live()) return;
          task.loaded = Math.max(0, Number(event.loaded) || 0);
          task.total = Math.max(0, Number(event.total) || 0);
          resetTimeout();
          renderQueue();
        },
      });
    } catch (error) {
      finish('failed', errorText(error));
    }
  }
  function cancelTask(task) {
    if (task.state === 'queued') {
      task.state = 'canceled';
      task.message = '已取消';
    } else task.cancel?.();
    renderQueue();
  }
  function retryTask(task) {
    if (!['failed', 'canceled'].includes(task.state)) return;
    if (
      tasks.some(
        (other) =>
          other !== task &&
          other.url === task.url &&
          ['queued', 'downloading'].includes(other.state)
      )
    ) {
      notify('同一網址已在下載佇列中');
      return;
    }
    task.state = 'queued';
    task.loaded = task.total = 0;
    task.message = '';
    task.handle = null;
    pump();
  }
  function renderQueue() {
    if (!queue) return;
    queue.parentElement.hidden = !tasks.length;
    const labels = {
      queued: '等待中',
      downloading: '下載中',
      done: '完成',
      failed: '失敗',
      canceled: '已取消',
    };
    for (const task of tasks) {
      if (!task.node) {
        task.node = el('li', null, { 'data-task': task.seq });
        task.status = el('span', null, { class: 'task-status' });
        task.progress = el('progress', null, { 'aria-label': '下載進度' });
        task.cancelButton = button('取消', () => cancelTask(task));
        task.retryButton = button('重試', () => retryTask(task));
        task.node.append(
          el('strong', task.name),
          task.status,
          task.progress,
          task.cancelButton,
          task.retryButton,
          button('開啟來源', () => {
            try {
              GM_openInTab(task.url, { active: true });
            } catch (error) {
              notify(error.message);
            }
          })
        );
        queue.append(task.node);
      }
      task.node.dataset.state = task.state;
      const size = task.loaded ? ` · ${(task.loaded / 1048576).toFixed(1)} MiB` : '';
      task.status.textContent = `${labels[task.state]}${size}${task.message ? ` · ${task.message}` : ''}`;
      task.progress.hidden = task.state !== 'downloading';
      if (task.total > 0) {
        task.progress.max = task.total;
        task.progress.value = task.loaded;
      } else task.progress.removeAttribute('value');
      task.cancelButton.hidden = !['queued', 'downloading'].includes(task.state);
      task.retryButton.hidden = !['failed', 'canceled'].includes(task.state);
    }
  }

  function savePrefs(patch) {
    try {
      const stored = GM_getValue(CONFIG, {});
      const base = stored && typeof stored === 'object' ? stored : {};
      GM_setValue(CONFIG, {
        ...base,
        sites: { ...base.sites, [location.origin]: { ...base.sites?.[location.origin], ...patch } },
      });
    } catch (error) {
      notify(`無法保存偏好：${error.message}`);
    }
  }
  function setHidden(value) {
    hidden = value;
    dock.hidden = value;
    hideHover();
    if (value) closePanel();
    savePrefs({ hidden: value });
  }
  function openPanel(focusId) {
    if (!panel) return;
    if (!isOpen) previousFocus = document.activeElement;
    isOpen = true;
    panel.hidden = false;
    dock.querySelector('button').setAttribute('aria-expanded', 'true');
    if (focusId) {
      view.value = 'page';
      filter.value = 'all';
    }
    performance.getEntriesByType('resource').forEach(addResource);
    scan(true);
    panel.querySelector('[data-close]').focus({ preventScroll: true });
    if (focusId) {
      const card = cards.get(focusId)?.node;
      card?.scrollIntoView({ block: 'nearest' });
    }
  }
  function closePanel() {
    isOpen = false;
    panel.hidden = true;
    dock.querySelector('button').setAttribute('aria-expanded', 'false');
    for (const video of gallery.querySelectorAll('video')) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    // 下次開啟重建被停止的預覽，避免卡在一個沒有 src 的播放器。
    gallery.replaceChildren();
    cards.clear();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function hideHover() {
    clearTimeout(hoverTimer);
    hovered = null;
    if (toolbar) toolbar.hidden = true;
  }
  function positionHover() {
    if (!hovered) return;
    const rect = hovered.node.getBoundingClientRect();
    if (
      !hovered.node.isConnected ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight ||
      rect.right <= 0 ||
      rect.left >= innerWidth
    ) {
      hideHover();
      return;
    }
    toolbar.style.left = `${Math.max(8, Math.min(innerWidth - toolbar.offsetWidth - 8, rect.right - toolbar.offsetWidth - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(innerHeight - toolbar.offsetHeight - 8, rect.top + 8))}px`;
  }
  function syncRoute() {
    const now = performance.now();
    if (location.href === pageUrl) {
      lastLocationCheck = now;
      return false;
    }
    pageUrl = location.href;
    // 從上次看到舊 URL 的時間切分，保留輪詢前已開始的新頁請求。
    // SPA 沒有通用的精確 navigation timestamp，邊界附近可能包含少量舊頁請求。
    resourceCutoff = lastLocationCheck;
    lastLocationCheck = now;
    resources.clear();
    ownRequests.clear();
    backgrounds.clear();
    variants.clear();
    selected.clear();
    hideHover();
    if (isOpen) notify('頁面已切換；媒體清單已更新，下載佇列保留原來源');
    return true;
  }
  function showHover(item, node) {
    if (hidden) return;
    clearTimeout(hoverTimer);
    const signature = `${item.id}:${current(item)?.url}:${capability(item, current(item))}`;
    if (hovered?.signature !== signature) {
      toolbar.replaceChildren(
        el(
          'span',
          item.kind === 'image' ? '圖片 · 頁面可用版本' : STATUS[capability(item, current(item))],
          { class: 'hover-label' }
        ),
        actions(item, true)
      );
    }
    hovered = { item, node, signature };
    toolbar.hidden = false;
    positionHover();
  }
  function inspectPoint() {
    hoverFrame = null;
    if (hidden || !point) return;
    const { x, y } = point;
    const stack = document.elementsFromPoint(x, y);
    if (stack.includes(host)) return;
    const top = stack[0];
    const sameContainer = (node) =>
      node === top ||
      node.contains(top) ||
      (node.parentElement !== document.body && node.parentElement?.contains(top));
    if (top && !owned(top) && backgroundUrls(top).length && !backgrounds.has(top)) {
      backgrounds.add(top);
      scan();
    }
    for (const element of stack) {
      const match = items.find((item) => item.elements.includes(element));
      if (match && sameContainer(element)) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.width >= 80 &&
          rect.height >= 60 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        ) {
          showHover(match, element);
          return;
        }
      }
    }
    // 某些社群遮罩不讓底層 img 出現在 hit-test stack；用已辨識媒體的可見矩形補足。
    const hits = items
      .flatMap((item) =>
        item.elements.map((node) => ({ item, node, rect: node.getBoundingClientRect() }))
      )
      .filter(
        ({ node, rect }) =>
          rect.width >= 80 &&
          rect.height >= 60 &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom &&
          getComputedStyle(node).visibility !== 'hidden' &&
          !node.closest('[hidden],[aria-hidden="true"]')
      )
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    // 限定在命中的同一媒體容器，避免把另一個不相關的 modal 背後圖片當成目標。
    const hit = hits.find(({ node }) => sameContainer(node));
    if (hit) {
      showHover(hit.item, hit.node);
      return;
    }
    if (!hoverTimer) hoverTimer = setTimeout(hideHover, 180);
  }

  function mount() {
    if (!document.body || host) return;
    host = el('div', null, { id: ID });
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = el(
      'style',
      `
      .panel,.dock,.toolbar{color-scheme:light;font:14px/1.5 system-ui,sans-serif;color:#182235}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,input,select{font:inherit}button,select{cursor:pointer}button{border:1px solid #c7d1df;border-radius:7px;background:#fff;color:#203552;padding:6px 9px}
      button:hover{background:#e8f1ff}button:disabled{opacity:.48;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #3686e5;outline-offset:2px}
      input[type=checkbox]{width:17px;height:17px;flex:none;accent-color:#246bd1}select,input[type=text]{max-width:100%;border:1px solid #c7d1df;border-radius:5px;padding:5px;color:inherit;background:#fff}
      .dock{position:fixed;right:18px;bottom:150px;pointer-events:auto;display:flex;box-shadow:0 4px 20px #14284626;border-radius:10px;background:#fff}
      .dock button{border-radius:0;border:none}.dock button:first-child{border-radius:10px 0 0 10px}.dock button:last-child{border-radius:0 10px 10px 0}
      .grip{touch-action:none;cursor:grab;color:#63758d}.panel{position:fixed;right:12px;top:12px;bottom:12px;width:min(780px,calc(100vw - 24px));pointer-events:auto;display:flex;flex-direction:column;border:1px solid #b8c7db;border-radius:14px;background:#f3f6fa;box-shadow:0 10px 50px #15253b40;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;border-bottom:1px solid #d5deea}h2{font-size:18px;margin:0}header p{margin:2px 0 0;font-size:12px;color:#5b6d83}
      .controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:10px 14px}.count,.notice{margin:0;padding:0 14px 8px;font-size:12px;color:#526780}.notice{color:#2461a9;min-height:26px}
      .scroll{overflow:auto;overscroll-behavior:contain;padding:0 14px 14px;min-height:0;flex:1}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(225px,100%),1fr));gap:12px}
      .card{background:#fff;border:1px solid #d2dce9;border-radius:10px;overflow:hidden;padding:10px;min-width:0}.card-heading{display:flex;align-items:center;gap:8px;margin-bottom:8px}.card-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .preview{position:relative;height:170px;background:#e9eef5;border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden}.preview img,.preview video{width:100%;height:100%;object-fit:contain}.play-preview{position:absolute;bottom:8px}
      .meta{color:#627289;font-size:11px;overflow-wrap:anywhere;margin:7px 0}.badge{display:inline-block;color:#285791;background:#e9f2ff;border-radius:5px;padding:2px 6px;font-size:11px;margin:0 0 8px}
      .card select{width:100%;font-size:12px}.card details{margin:8px 0;font-size:12px}.card input[type=text]{width:100%}.actions{display:flex;gap:5px;flex-wrap:wrap}.actions button{font-size:12px;flex:1;white-space:nowrap}
      .toolbar{position:fixed;pointer-events:auto;background:#fff;border:1px solid #c3d2e5;border-radius:10px;padding:8px;box-shadow:0 4px 24px #172d4940;width:min(354px,calc(100vw - 16px))}.hover-label{display:block;font-size:11px;color:#596c85;margin-bottom:5px}
      .queue{margin-top:16px;border-top:1px solid #c8d4e3;padding-top:10px}.queue ul{padding:0;list-style:none}.queue li{background:#fff;border-radius:8px;border:1px solid #d5deea;padding:9px;margin:8px 0}.queue strong,.task-status{display:block;overflow-wrap:anywhere;font-size:12px}.task-status{color:#5e7087;margin:4px 0}.queue progress{display:block;width:100%;height:7px;margin:8px 0}.queue button{font-size:12px;margin-right:5px}
      @media(prefers-color-scheme:dark){.panel,.dock,.toolbar{color:#e2eaf6;color-scheme:dark}.panel{background:#161f2d;border-color:#3b4b62}.dock,header,.card,.toolbar,.queue li{background:#202c3e;border-color:#43536c}button,select,input[type=text]{background:#26364b;color:#e4edfb;border-color:#4a5c76}button:hover{background:#344d70}.preview{background:#131d2b}.meta,.count,.task-status,.hover-label,header p{color:#a3b5ce}.badge{background:#263f60;color:#b8d7ff}.notice{color:#91c2ff}}
    `
    );
    dock = el('div', null, { class: 'dock' });
    const main = button('▧ Media', () => (isOpen ? closePanel() : openPanel()), {
      'aria-label': '開啟媒體面板',
      'aria-expanded': 'false',
      'aria-controls': `${ID}-panel`,
    });
    const grip = button('⠿', () => {}, {
      class: 'grip',
      'aria-label': '拖曳媒體按鈕',
      title: '拖曳位置；manager 選單可重設',
    });
    dock.append(main, grip);
    dock.hidden = hidden;
    toolbar = el('div', null, {
      class: 'toolbar',
      hidden: '',
      role: 'toolbar',
      'aria-label': '媒體工具列',
    });
    panel = el('section', null, {
      id: `${ID}-panel`,
      class: 'panel',
      role: 'region',
      'aria-label': 'Media Helper',
      hidden: '',
    });
    const header = el('header');
    const title = el('div');
    title.append(el('h2', 'Media Helper'), el('p', '圖片與影片 · 預覽、來源、下載'));
    header.append(title, button('關閉', closePanel, { 'data-close': '' }));
    const controls = el('div', null, { class: 'controls' });
    view = el('select', null, { 'aria-label': '檢視範圍' });
    view.append(
      el('option', '頁面媒體', { value: 'page' }),
      el('option', '已載入資源', { value: 'resources' })
    );
    filter = el('select', null, { 'aria-label': '媒體類型' });
    filter.append(
      el('option', '全部類型', { value: 'all' }),
      el('option', '圖片', { value: 'image' }),
      el('option', '影片與串流', { value: 'video' })
    );
    for (const select of [view, filter])
      select.addEventListener('change', () => {
        selected.clear();
        renderCards();
      });
    selectionButton = button('下載已選（0）', () =>
      enqueue(visibleItems().filter((item) => selected.has(item.id)))
    );
    controls.append(
      view,
      filter,
      button('重新掃描', () => {
        performance.getEntriesByType('resource').forEach(addResource);
        scan(true);
        notify('已重新掃描目前頁面；尚未載入的輪播圖片需先切換到該張');
      }),
      button('全選可下載項目', () => {
        visibleItems()
          .filter(downloadable)
          .forEach((item) => selected.add(item.id));
        renderCards();
      }),
      button('清除選取', () => {
        selected.clear();
        renderCards();
      }),
      selectionButton,
      button('隱藏本站工具', () => setHidden(true))
    );
    count = el('p', '', { class: 'count' });
    notice = el('p', '', { class: 'notice', role: 'status', 'aria-live': 'polite' });
    const scroll = el('div', null, { class: 'scroll' });
    gallery = el('div', null, { class: 'gallery' });
    const queueSection = el('section', null, {
      class: 'queue',
      hidden: '',
      'aria-label': '下載佇列',
    });
    queue = el('ul');
    queueSection.append(
      el('strong', '下載佇列'),
      button('取消所有待完成下載', () => tasks.forEach(cancelTask)),
      queue
    );
    scroll.append(gallery, queueSection);
    panel.append(header, controls, count, notice, scroll);
    shadow.append(style, dock, toolbar, panel);
    document.documentElement.append(host);

    let drag;
    const moveDock = (left, top) => {
      dock.style.right = dock.style.bottom = 'auto';
      dock.style.left = `${Math.max(8, Math.min(innerWidth - dock.offsetWidth - 8, left))}px`;
      dock.style.top = `${Math.max(8, Math.min(innerHeight - dock.offsetHeight - 8, top))}px`;
    };
    if (Number.isFinite(prefs.position?.left) && Number.isFinite(prefs.position?.top))
      moveDock(prefs.position.left, prefs.position.top);
    grip.addEventListener('pointerdown', (event) => {
      const rect = dock.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      grip.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    grip.addEventListener('pointermove', (event) => {
      if (drag) moveDock(event.clientX - drag.x, event.clientY - drag.y);
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      const rect = dock.getBoundingClientRect();
      savePrefs({ position: { left: rect.left, top: rect.top } });
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    document.addEventListener(
      'pointermove',
      (event) => {
        if (owned(event.composedPath()[0])) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
          return;
        }
        point = { x: event.clientX, y: event.clientY };
        if (!hoverFrame) hoverFrame = requestAnimationFrame(inspectPoint);
      },
      { passive: true }
    );
    document.addEventListener('focusin', (event) => {
      const item = items.find((entry) => entry.elements.includes(event.target));
      if (item) showHover(item, event.target);
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        // 原頁正在輸入或播放時不攔截 Escape；只有焦點在 helper 內才消耗事件。
        if (owned(event.composedPath()[0])) {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen) closePanel();
          hideHover();
        } else hideHover();
      },
      true
    );
    window.addEventListener('scroll', positionHover, { passive: true, capture: true });
    window.addEventListener('resize', () => {
      positionHover();
      if (dock.style.left) {
        const rect = dock.getBoundingClientRect();
        moveDock(rect.left, rect.top);
      }
    });
    document.addEventListener('mouseleave', hideHover);
    for (const name of ['load', 'loadedmetadata', 'emptied'])
      document.addEventListener(
        name,
        (event) => {
          if (!owned(event.target)) {
            // 原頁請求可能在 helper 建立縮圖之前開始、之後才完成；不能當成自產請求漏掉。
            const url = normalized(event.target.currentSrc || event.target.src);
            if (url) {
              ownRequests.delete(url);
              performance.getEntriesByName(url, 'resource').forEach(addResource);
            }
            scheduleScan();
          }
        },
        true
      );
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !owned(record.target))) {
        if (!host.isConnected) document.documentElement.append(host);
        scheduleScan();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'src',
        'srcset',
        'sizes',
        'media',
        'type',
        'poster',
        'style',
        'class',
        'data-src',
        'data-original',
        'data-lazy-src',
      ],
    });
    setInterval(() => {
      if (syncRoute()) scan(isOpen);
    }, 600);
    GM_registerMenuCommand('Media Helper：開啟媒體面板', () => openPanel());
    GM_registerMenuCommand('Media Helper：顯示本站工具', () => setHidden(false));
    GM_registerMenuCommand('Media Helper：隱藏本站工具', () => setHidden(true));
    GM_registerMenuCommand('Media Helper：重設按鈕位置', () => {
      dock.style.left = dock.style.top = '';
      dock.style.right = dock.style.bottom = '';
      savePrefs({ position: null });
    });
    GM_registerMenuCommand('Media Helper：取消下載', () => tasks.forEach(cancelTask));
    scan();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
