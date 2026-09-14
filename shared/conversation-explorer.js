/* global ConversationArchive, marked, DOMPurify, filenameFor, downloadText, formatUtc */
/** An isolated, optional browsing mode. All selection state belongs to this instance. */
function createConversationExplorer(config) {
  'use strict';
  config = config || {};
  const C = ConversationArchive;
  const host = document.createElement('div');
  host.id = 'conversation-explorer';
  const shadow = host.attachShadow({ mode: 'open' });
  const embedded = config.embedded === true;
  let archive = null,
    selected = new Set(),
    options = C.defaults(),
    activeEnd = null;
  let collapsed = new Set(),
    expanded = new Set(),
    rows = [],
    focusedId = null,
    rangeAnchor = null;
  let tab = 'read',
    mobileTab = 'read',
    readStart = 0,
    readCount = 60,
    destroyed = false;
  let operation = 0,
    cache = null,
    restoreFocus = null,
    readingBlocks = [];
  const ROW_HEIGHT = 48,
    WINDOW_SIZE = 100;
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const element = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === 'text') node.textContent = value;
      else if (name === 'class') node.className = value;
      else node.setAttribute(name, value);
    }
    for (const child of children) node.append(child);
    return node;
  };
  const button = (text, action, attrs = {}) => {
    const node = element('button', { type: 'button', text, ...attrs });
    node.addEventListener('click', action);
    return node;
  };
  const style = element('style', {
    text: `
    :host{color-scheme:light dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:light-dark(#202827,#e1ebe8)}
    *{box-sizing:border-box} [hidden]{display:none!important}
    .shell{--paper:light-dark(#fff,#182320);--soft:light-dark(#f3f7f5,#202e29);--line:light-dark(#dce5df,#3b4a43);--ink:light-dark(#202827,#e1ebe8);--muted:light-dark(#62716a,#a4b6ac);--accent:light-dark(#126e54,#79dcb6);--tint:light-dark(#e7f5ee,#29473a);color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:0;box-shadow:0 24px 90px #0004;width:min(1220px,calc(100vw - 40px));height:min(880px,calc(100vh - 40px));max-width:none;max-height:none;overflow:hidden}
    dialog::backdrop{background:#12231d66;backdrop-filter:blur(3px)}
    .shell.embedded{width:100%;height:100dvh;border:0;border-radius:0;box-shadow:none}
    .layout{height:100%;display:flex;flex-direction:column}.header{padding:18px 22px 14px;display:flex;gap:16px;align-items:flex-start;border-bottom:1px solid var(--line)}
    .heading{flex:1;min-width:0}h1{font-size:20px;letter-spacing:-.4px;margin:0 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source{font-size:12px;color:var(--muted);overflow-wrap:anywhere;margin:0}
    .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{font:inherit;cursor:pointer;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:7px 11px;min-height:34px;white-space:nowrap}button:hover{background:var(--soft)}button:disabled{cursor:default;opacity:.45}button.primary{background:var(--accent);border-color:var(--accent);color:light-dark(#fff,#102d22);font-weight:600}button:focus-visible,input:focus-visible,textarea:focus-visible,[role=treeitem]:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}button.quiet{background:transparent;border-color:transparent}.small{font-size:12px}
    .body{display:grid;grid-template-columns:340px minmax(0,1fr);min-height:0;flex:1}.sidebar{border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;background:var(--soft)}.filters{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px 12px;font-size:12px}.filters label{display:flex;gap:5px;align-items:center}input[type=checkbox]{accent-color:var(--accent);width:16px;height:16px;margin:0;flex-shrink:0}
    .tree{overflow:auto;flex:1;position:relative;min-height:0;overscroll-behavior:contain}.treeitem{height:48px;display:flex;align-items:center;gap:7px;padding:4px 8px 4px calc(8px + var(--indent)*12px);border-bottom:1px solid transparent;cursor:pointer}.treeitem:hover{background:var(--paper)}.treeitem.focused{background:var(--tint);box-shadow:inset 3px 0 var(--accent)}.treeitem[aria-checked=true] .row-title{color:var(--accent)}.row-main{min-width:0;flex:1}.row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.row-meta{font-size:10px;color:var(--muted)}.expander{border:0;padding:0;min-height:24px;width:16px;background:transparent}.path-mini{font-size:10px;padding:3px 5px;min-height:26px}.empty{margin:auto;padding:32px;max-width:580px;text-align:center;color:var(--muted)}.empty h2{color:var(--ink);font-size:24px;letter-spacing:-.6px}.empty p{margin:12px 0;line-height:1.8}
    .reader{min-height:0;display:flex;flex-direction:column}.readerbar{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap}.tabs{display:flex;gap:3px}.tabs button{border-color:transparent;background:transparent}.tabs button[aria-selected=true]{color:var(--accent);background:var(--tint);font-weight:600}.content{overflow:auto;min-height:0;flex:1;padding:22px clamp(16px,3vw,42px);overscroll-behavior:contain}.message{margin-bottom:22px;border-bottom:1px solid var(--line);padding-bottom:20px}.message-head{display:flex;gap:10px;align-items:center;margin-bottom:12px}.message-title{flex:1;min-width:0}.message-title strong{font-size:13px}.message-title time{display:block;color:var(--muted);font-size:11px}.prose{overflow-wrap:anywhere;line-height:1.75;font-size:14px}.prose h1{font-size:24px;white-space:normal;overflow:visible}.prose h2{font-size:20px;line-height:1.45}.prose h3{font-size:17px}.prose p{margin:10px 0}.prose pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);border-radius:8px;padding:14px;line-height:1.5}.prose code{font-size:12px}.prose table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}.prose th,.prose td{padding:8px 12px;border:1px solid var(--line)}.prose a{color:var(--accent)}.prose blockquote{border-left:3px solid var(--line);margin:14px 0;padding-left:14px;color:var(--muted)}.error{color:light-dark(#a52932,#ffaab0);background:light-dark(#fff0f1,#442a2c);border-radius:8px;padding:12px}.hint{color:var(--muted);font-size:12px}.footer{border-top:1px solid var(--line);padding:12px 18px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.count{font-weight:600;font-size:13px}.status{font-size:12px;color:var(--muted);min-height:18px;max-width:480px;overflow-wrap:anywhere}.manual{padding:12px 18px;border-bottom:1px solid var(--line)}textarea{width:100%;min-height:130px;resize:vertical;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,monospace}.mobile-tabs{display:none}
    @media(max-width:760px){.shell{width:calc(100vw - 12px);height:calc(100dvh - 12px);border-radius:12px}.header{padding:12px;flex-wrap:wrap;gap:8px}.header .actions{gap:4px}.header button{font-size:11px;padding:5px 8px}.heading{flex-basis:calc(100% - 44px)}h1{font-size:17px}.body{display:block;position:relative}.sidebar,.reader{height:100%;border:0}.body[data-mobile=tree] .reader{display:none}.body:not([data-mobile=tree]) .sidebar{display:none}.mobile-tabs{display:flex;padding:5px 10px;border-bottom:1px solid var(--line)}.readerbar{padding:8px 12px}.content{padding:16px}.footer{padding:9px 12px;gap:8px}.footer .actions{width:100%;gap:5px}.footer button{font-size:12px;padding:6px 8px;flex:1}.status{font-size:11px}.path-mini{min-width:42px}.header .close{margin-left:auto}.source{font-size:10px}}
  `,
  });
  style.textContent += `
    .export-meta{font-size:12px;color:var(--muted);margin-bottom:18px}.export-meta summary{cursor:pointer}.export-meta pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:12px;border-radius:8px}
    @media(max-width:760px){.readerbar .tabs{display:none}.readerbar{justify-content:flex-end}}
  `;
  shadow.append(style);
  const frame = element(embedded ? 'section' : 'dialog', {
    class: `shell${embedded ? ' embedded' : ''}`,
    'aria-label': '對話樹瀏覽與選取',
  });
  const layout = element('div', { class: 'layout' });
  frame.append(layout);
  shadow.append(frame);
  const title = element('h1', { text: '對話樹瀏覽器' }),
    source = element('p', {
      class: 'source',
      text: '開啟 JSON，保留分支脈絡，只匯出你選取的內容。',
    });
  const importInput = element('input', {
    type: 'file',
    accept: '.json,application/json',
    'aria-label': '匯入對話 JSON',
    hidden: '',
  });
  const importButton = button('匯入 JSON', () => importInput.click());
  const saveButton = button('儲存完整對話＋選取', () => saveArchive());
  const refreshButton = button('重新讀取網頁', () => refresh());
  refreshButton.hidden = !config.onRefresh;
  const closeButton = button('✕', () => close(), {
    class: 'quiet close',
    'aria-label': '關閉瀏覽模式',
  });
  closeButton.hidden = embedded;
  layout.append(
    element('header', { class: 'header' }, [
      element('div', { class: 'heading' }, [title, source]),
      element('div', { class: 'actions' }, [importButton, saveButton, refreshButton]),
      closeButton,
      importInput,
    ])
  );
  const mobile = element('nav', { class: 'mobile-tabs tabs', 'aria-label': '瀏覽區域' });
  for (const [value, text] of [
    ['tree', '分支'],
    ['read', '閱讀'],
    ['preview', '匯出預覽'],
  ])
    mobile.append(
      button(
        text,
        () => {
          mobileTab = value;
          if (value !== 'tree') tab = value;
          render();
        },
        { 'data-mobile-tab': value }
      )
    );
  layout.append(mobile);
  const body = element('div', { class: 'body', 'data-mobile': mobileTab });
  const sidebar = element('aside', { class: 'sidebar', 'aria-label': '分支與訊息' });
  const filters = element('div', { class: 'filters' });
  const filterInputs = {};
  for (const [name, text] of [
    ['showTools', '顯示工具'],
    ['showThinking', '顯示思考'],
    ['includeResearchDetails', '研究細節'],
  ]) {
    const input = element('input', { type: 'checkbox' });
    filterInputs[name] = input;
    input.addEventListener('change', () => {
      options[name] = input.checked;
      cache = null;
      rebuildRows();
      render();
    });
    filters.append(element('label', {}, [input, document.createTextNode(text)]));
  }
  const tree = element('div', {
    class: 'tree',
    role: 'tree',
    'aria-label': '對話分支',
    'aria-multiselectable': 'true',
    tabindex: '0',
  });
  sidebar.append(filters, tree);
  const reader = element('section', { class: 'reader', 'aria-label': '閱讀與匯出預覽' });
  const tabs = element('div', { class: 'tabs', role: 'tablist', 'aria-label': '內容模式' });
  const readTab = button(
    '閱讀路徑',
    () => {
      tab = 'read';
      mobileTab = 'read';
      render();
    },
    { role: 'tab', id: 'ce-read-tab', 'aria-controls': 'ce-content' }
  );
  const previewTab = button(
    '匯出預覽',
    () => {
      tab = 'preview';
      mobileTab = 'preview';
      render();
    },
    { role: 'tab', id: 'ce-preview-tab', 'aria-controls': 'ce-content' }
  );
  tabs.append(readTab, previewTab);
  const addPath = button('＋ 加入整條 path', () => selectPath(activeEnd), {
    class: 'primary',
    'aria-label': '加入目前整條 path',
  });
  reader.append(element('div', { class: 'readerbar' }, [tabs, addPath]));
  const manual = element('div', { class: 'manual', hidden: '' });
  const manualText = element('textarea', { readonly: '', 'aria-label': '手動複製所選內容' });
  manual.append(
    element('p', {
      class: 'hint',
      text: '瀏覽器未允許直接複製。請使用 ⌘C／Ctrl+C，或下載 Markdown。',
    }),
    manualText,
    button('關閉手動複製', () => {
      manual.hidden = true;
    })
  );
  reader.append(manual);
  const content = element('div', { class: 'content', id: 'ce-content', role: 'tabpanel' });
  reader.append(content);
  body.append(sidebar, reader);
  layout.append(body);
  const count = element('div', { class: 'count' }),
    status = element('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const clear = button(
    '清除選取',
    () => {
      selected.clear();
      changed();
    },
    { class: 'quiet small' }
  );
  const copy = button('複製所選 Markdown', () => deliver('copy'), { class: 'primary' });
  const download = button('下載所選 Markdown', () => deliver('download'));
  const handoff = button('複製所選 Handoff', () => deliver('handoff'));
  layout.append(
    element('footer', { class: 'footer' }, [
      element('div', {}, [element('div', { class: 'actions' }, [count, clear]), status]),
      element('div', { class: 'actions' }, [copy, download, handoff]),
    ])
  );
  document.body.append(host);

  function setStatus(text) {
    status.textContent = text;
  }
  function snapshot() {
    return archive ? C.withSelection(archive, selected, options) : null;
  }
  function getExport(isHandoff = false) {
    if (!archive) throw new Error('請先匯入對話。');
    if (!cache) cache = { at: new Date().toISOString() };
    const field = isHandoff ? 'handoff' : 'markdown';
    if (!cache[field])
      cache[field] = C.renderSelection(snapshot(), { handoff: isHandoff, exportedAt: cache.at });
    return cache[field];
  }
  function changed() {
    cache = null;
    manual.hidden = true;
    render();
  }
  function toggle(id, checked) {
    if (checked) selected.add(id);
    else selected.delete(id);
    changed();
  }
  function selectPath(endId) {
    if (!archive || !endId) return;
    const units = C.pathBlocks(archive, endId, options);
    for (const block of units) selected.add(block.id);
    changed();
    setStatus(`已加入這條 path 的 ${units.length} 則訊息；其他選取保留。`);
  }
  function preferredEnd(nodeId) {
    const current = C.pathIds(archive);
    if (current.includes(nodeId)) return archive.graph.currentNodeId;
    let cursor = nodeId;
    while (archive.graph.nodes[cursor].children.length)
      cursor = archive.graph.nodes[cursor].children[0];
    return cursor;
  }
  function readAt(row) {
    activeEnd = preferredEnd(row.nodeId);
    const path = C.pathBlocks(archive, activeEnd, options);
    let index = path.findIndex((b) => b.id === row.id);
    if (index < 0) {
      activeEnd = row.nodeId;
      index = 0;
    }
    focusedId = row.id;
    readStart = Math.max(0, index - 3);
    readCount = 60;
    rangeAnchor = null;
    tab = 'read';
    mobileTab = 'read';
    render();
  }
  function rebuildRows() {
    rows = [];
    if (!archive) return;
    const nodes = archive.graph.nodes,
      current = new Set(C.pathIds(archive));
    const groups = new Map();
    const stack = archive.graph.roots
      .map((id) => ({ id, depth: 0, level: 1, group: null }))
      .reverse();
    while (stack.length) {
      const { id, depth, level, group } = stack.pop(),
        node = nodes[id];
      const units = node.blockIds
        .map((bid) => archive.graph.blocks[bid])
        .filter((b) => C.visible(b, options));
      units.forEach((block, i) => {
        const row = {
          ...block,
          depth,
          level,
          foldable: i === units.length - 1 && node.children.length > 0,
          current: current.has(id),
        };
        const siblings = groups.get(group) || [];
        siblings.push(row);
        groups.set(group, siblings);
        rows.push(row);
      });
      if (!collapsed.has(id))
        for (let i = node.children.length - 1; i >= 0; i--)
          stack.push({
            id: node.children[i],
            depth: depth + (node.children.length > 1 ? 1 : 0),
            level: level + (units.length ? 1 : 0),
            group: units.length ? id : group,
          });
    }
    for (const siblings of groups.values())
      siblings.forEach((row, index) => {
        row.setSize = siblings.length;
        row.position = index + 1;
      });
    tree.tabIndex = rows.length ? -1 : 0;
    if (!rows.some((row) => row.id === focusedId)) focusedId = rows[0]?.id || null;
  }
  function rowLabel(block) {
    return block.error
      ? '研究報告無法解析'
      : block.markdown
          .split('\n')
          .find((line) => line.trim())
          ?.replace(/^#+\s*/, '')
          .slice(0, 100) || '研究計畫／狀態';
  }
  function focusRow(index) {
    const row = rows[Math.min(rows.length - 1, Math.max(0, index))];
    if (!row) return;
    focusedId = row.id;
    const at = rows.indexOf(row) * ROW_HEIGHT;
    if (at < tree.scrollTop || at + ROW_HEIGHT > tree.scrollTop + tree.clientHeight)
      tree.scrollTop = at;
    renderTree();
    [...tree.querySelectorAll('[role=treeitem]')]
      .find((node) => node.dataset.blockId === focusedId)
      ?.focus();
  }
  function renderTree() {
    const hadFocus = !!shadow.activeElement?.closest?.('[role=treeitem]');
    const start = Math.max(0, Math.min(rows.length, Math.floor(tree.scrollTop / ROW_HEIGHT) - 8));
    const end = Math.min(rows.length, start + WINDOW_SIZE);
    const top = element('div', { 'aria-hidden': 'true' });
    top.style.height = `${start * ROW_HEIGHT}px`;
    const bottom = element('div', { 'aria-hidden': 'true' });
    bottom.style.height = `${(rows.length - end) * ROW_HEIGHT}px`;
    const fragment = document.createDocumentFragment();
    fragment.append(top);
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const line = element('div', {
        class: `treeitem${row.id === focusedId ? ' focused' : ''}`,
        role: 'treeitem',
        tabindex: row.id === focusedId ? '0' : '-1',
        'aria-checked': String(selected.has(row.id)),
        'aria-level': row.level,
        'aria-setsize': row.setSize,
        'aria-posinset': row.position,
        'data-block-id': row.id,
        'aria-label': `${row.role}：${rowLabel(row)}`,
      });
      line.style.setProperty('--indent', Math.min(row.depth, 10));
      line.addEventListener('focus', () => {
        focusedId = row.id;
        for (const item of tree.querySelectorAll('[role=treeitem]')) {
          const active = item.dataset.blockId === focusedId;
          item.tabIndex = active ? 0 : -1;
          item.classList.toggle('focused', active);
        }
      });
      if (row.foldable) line.setAttribute('aria-expanded', String(!collapsed.has(row.nodeId)));
      const expander = button(
        row.foldable ? (collapsed.has(row.nodeId) ? '▸' : '▾') : '·',
        (event) => {
          event.stopPropagation();
          if (!row.foldable) return;
          if (collapsed.has(row.nodeId)) collapsed.delete(row.nodeId);
          else collapsed.add(row.nodeId);
          rebuildRows();
          renderTree();
          updateCount();
        },
        { class: 'expander', tabindex: '-1', 'aria-label': '展開或收合分支' }
      );
      expander.disabled = !row.foldable;
      const box = element('input', {
        type: 'checkbox',
        tabindex: '-1',
        'aria-label': `選取 ${rowLabel(row)}`,
      });
      box.checked = selected.has(row.id);
      box.addEventListener('click', (event) => event.stopPropagation());
      box.addEventListener('change', () => {
        focusedId = row.id;
        toggle(row.id, box.checked);
      });
      const meta = `${row.kind === 'research' ? '研究報告' : row.role}${row.current ? ' · 網頁目前路徑' : ''}`;
      line.append(
        expander,
        box,
        element('div', { class: 'row-main' }, [
          element('div', { class: 'row-title', text: rowLabel(row) }),
          element('div', { class: 'row-meta', text: meta }),
        ]),
        button(
          '＋path',
          (event) => {
            event.stopPropagation();
            selectPath(row.nodeId);
          },
          { class: 'path-mini', tabindex: '-1', 'aria-label': `加入到 ${rowLabel(row)} 的 path` }
        )
      );
      line.addEventListener('click', () => readAt(row));
      line.addEventListener('keydown', (event) => {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const index = rows.findIndex((r) => r.id === row.id);
        if (
          ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(
            event.key
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (event.key === 'ArrowDown') focusRow(index + 1);
        else if (event.key === 'ArrowUp') focusRow(index - 1);
        else if (event.key === 'Home') focusRow(0);
        else if (event.key === 'End') focusRow(rows.length - 1);
        else if (event.key === ' ') toggle(row.id, !selected.has(row.id));
        else if (event.key === 'Enter') readAt(row);
        else if (event.key === 'ArrowRight') {
          if (row.foldable && collapsed.has(row.nodeId)) {
            collapsed.delete(row.nodeId);
            rebuildRows();
            renderTree();
          } else focusRow(index + 1);
        } else if (event.key === 'ArrowLeft') {
          if (row.foldable && !collapsed.has(row.nodeId)) {
            collapsed.add(row.nodeId);
            rebuildRows();
            renderTree();
          } else {
            const parents = C.pathIds(archive, row.nodeId).slice(0, -1).reverse();
            const parent = parents
              .map((id) => rows.findIndex((r) => r.nodeId === id))
              .find((at) => at >= 0);
            if (parent !== undefined) focusRow(parent);
          }
        }
      });
      fragment.append(line);
    }
    fragment.append(bottom);
    tree.replaceChildren(fragment);
    if (hadFocus)
      [...tree.querySelectorAll('[role=treeitem]')]
        .find((node) => node.dataset.blockId === focusedId)
        ?.focus({ preventScroll: true });
  }
  tree.addEventListener('scroll', () => renderTree());
  tree.addEventListener('keydown', (event) => {
    if (event.target === tree && event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(0);
    }
  });

  function prose(markdown) {
    const node = element('div', { class: 'prose' });
    const renderer = {
      image(token) {
        return `<a href="${escape(token.href)}">[圖片：${escape(token.text || '外部資源')}]</a>`;
      },
    };
    const parser = new marked.Marked({ gfm: true, renderer });
    node.innerHTML = DOMPurify.sanitize(parser.parse(markdown), {
      USE_PROFILES: { html: true },
      RETURN_TRUSTED_TYPE: true,
      FORBID_TAGS: [
        'img',
        'style',
        'iframe',
        'video',
        'audio',
        'source',
        'form',
        'input',
        'button',
        'textarea',
      ],
      FORBID_ATTR: ['style', 'src', 'srcset'],
    });
    for (const link of node.querySelectorAll('a')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    return node;
  }
  function renderReader() {
    content.replaceChildren();
    content.setAttribute('aria-labelledby', tab === 'read' ? 'ce-read-tab' : 'ce-preview-tab');
    if (!archive) {
      content.append(
        element('div', { class: 'empty' }, [
          element('h2', { text: '保留完整脈絡，選出需要的內容。' }),
          element('p', {
            text: '匯入 ChatGPT 原始 JSON 或 .chat-archive.json，即可閱讀分支、加入整條 path，或只選一則訊息。',
          }),
          button('開啟 JSON 存檔', () => importInput.click(), { class: 'primary' }),
          element('p', {
            class: 'hint',
            text: '檔案在本機處理；不會上傳，也不會自動載入外部圖片。',
          }),
        ])
      );
      return;
    }
    if (tab === 'preview') {
      try {
        const markdown = getExport();
        const header = markdown.match(/^---\n([\s\S]*?)\n---\n/);
        if (header) {
          content.append(
            element('details', { class: 'export-meta' }, [
              element('summary', { text: '匯出檔資訊' }),
              element('pre', { text: header[1] }),
            ])
          );
        }
        content.append(prose(header ? markdown.slice(header[0].length) : markdown));
      } catch (error) {
        content.append(
          element('p', { class: selected.size ? 'error' : 'hint', text: error.message })
        );
      }
      return;
    }
    readingBlocks = C.pathBlocks(archive, activeEnd, options);
    if (!readingBlocks.length)
      content.append(element('p', { class: 'hint', text: '此路徑沒有目前顯示設定下的訊息。' }));
    if (readStart > 0)
      content.append(
        button(`顯示較早的 ${Math.min(readStart, 60)} 則`, () => {
          readStart = Math.max(0, readStart - 60);
          readCount += 60;
          renderReader();
        })
      );
    const shown = readingBlocks.slice(readStart, readStart + readCount);
    for (const block of shown) {
      const card = element('article', { class: 'message', 'data-block-id': block.id });
      const box = element('input', { type: 'checkbox', 'aria-label': `選取 ${rowLabel(block)}` });
      box.checked = selected.has(block.id);
      box.addEventListener('click', (event) => {
        if (event.shiftKey && rangeAnchor?.endId === activeEnd) {
          const from = readingBlocks.findIndex((b) => b.id === rangeAnchor.id),
            to = readingBlocks.findIndex((b) => b.id === block.id);
          if (from >= 0)
            for (const item of readingBlocks.slice(Math.min(from, to), Math.max(from, to) + 1)) {
              if (box.checked) selected.add(item.id);
              else selected.delete(item.id);
            }
        }
        if (box.checked) selected.add(block.id);
        else selected.delete(block.id);
        rangeAnchor = { id: block.id, endId: activeEnd };
        changed();
      });
      card.append(
        element('div', { class: 'message-head' }, [
          box,
          element('div', { class: 'message-title' }, [
            element('strong', {
              text: `${block.role}${block.kind === 'research' ? ' · Deep Research' : ''}`,
            }),
            element('time', { text: formatUtc(block.time) }),
          ]),
          button(
            '只選這則',
            () => {
              selected = new Set([block.id]);
              changed();
            },
            { class: 'small quiet' }
          ),
        ])
      );
      if (block.error) card.append(element('div', { class: 'error', text: block.error }));
      else {
        const full = `${options.includeResearchDetails && block.details ? `${block.details}\n\n` : ''}${block.markdown}`;
        const isLong = full.length > 1400,
          isExpanded = expanded.has(block.id);
        card.append(prose(isLong && !isExpanded ? `${full.slice(0, 1000)}\n\n…` : full));
        if (isLong)
          card.append(
            button(
              isExpanded ? '收合正文' : `展開完整正文（${full.length.toLocaleString()} 字）`,
              () => {
                if (isExpanded) expanded.delete(block.id);
                else expanded.add(block.id);
                renderReader();
              },
              { class: 'small' }
            )
          );
      }
      content.append(card);
    }
    if (readStart + readCount < readingBlocks.length)
      content.append(
        button('再顯示 60 則', () => {
          readCount += 60;
          renderReader();
        })
      );
  }
  function updateCount() {
    const visibleIds = new Set(rows.map((row) => row.id));
    const hidden = [...selected].filter((id) => !visibleIds.has(id)).length;
    count.textContent = `已選 ${selected.size.toLocaleString()} 則${hidden ? ` · ${hidden} 則目前隱藏` : ''}`;
    for (const node of [copy, download, handoff, clear]) node.disabled = selected.size === 0;
    saveButton.disabled = !archive;
    addPath.disabled = !archive;
  }
  function render() {
    if (destroyed) return;
    for (const [name, input] of Object.entries(filterInputs))
      input.checked = options[name] === true;
    body.dataset.mobile = mobileTab;
    for (const node of mobile.children)
      node.setAttribute('aria-selected', String(node.dataset.mobileTab === mobileTab));
    readTab.setAttribute('aria-selected', String(tab === 'read'));
    previewTab.setAttribute('aria-selected', String(tab === 'preview'));
    renderTree();
    renderReader();
    updateCount();
  }
  function setArchive(value, { preserveSelection = false } = {}) {
    const next = C.load(value);
    const same =
      preserveSelection &&
      archive &&
      archive.source.provider === next.source.provider &&
      archive.source.conversationId &&
      archive.source.conversationId === next.source.conversationId;
    const previous = selected.size;
    selected = same
      ? new Set(
          [...selected].filter((id) => Object.prototype.hasOwnProperty.call(next.graph.blocks, id))
        )
      : new Set(next.selection.blockIds);
    options = same ? options : { ...C.defaults(), ...next.selection.options };
    archive = next;
    activeEnd = next.graph.currentNodeId;
    focusedId = null;
    rangeAnchor = null;
    collapsed = new Set();
    expanded = new Set();
    readStart = 0;
    readCount = 60;
    cache = null;
    manual.hidden = true;
    title.textContent = next.source.title;
    source.textContent = `${next.source.provider} · ${next.source.type || '存檔'} · ${next.source.capturedAt || ''} · 僅含來源回傳的分支`;
    rebuildRows();
    tree.scrollTop = 0;
    render();
    setStatus(
      same
        ? `已重新讀取；保留 ${selected.size} 則選取${previous > selected.size ? `，${previous - selected.size} 則已不存在` : ''}。新訊息未自動加入。`
        : '已載入對話。瀏覽與勾選不影響一般一鍵匯出。'
    );
  }
  async function importFile(file) {
    if (!file) return;
    const ticket = ++operation;
    setStatus('讀取存檔…');
    try {
      const loaded = C.load(await file.text());
      if (!destroyed && ticket === operation) setArchive(loaded);
    } catch (error) {
      if (!destroyed && ticket === operation) setStatus(`匯入失敗：${error.message}`);
    }
  }
  importInput.addEventListener('change', () => {
    importFile(importInput.files[0]);
    importInput.value = '';
  });
  async function refresh() {
    if (!config.onRefresh) return;
    const ticket = ++operation;
    refreshButton.disabled = true;
    setStatus('讀取網頁的新快照…');
    try {
      const next = await config.onRefresh();
      if (!destroyed && ticket === operation && next) setArchive(next, { preserveSelection: true });
    } catch (error) {
      if (!destroyed && ticket === operation) setStatus(`讀取失敗：${error.message}`);
    } finally {
      if (!destroyed) refreshButton.disabled = false;
    }
  }
  function saveArchive() {
    if (!archive) return;
    const text = JSON.stringify(snapshot(), null, 2);
    downloadText(
      filenameFor(
        { source: archive.source.provider, title: archive.source.title },
        'chat-archive.json'
      ),
      text,
      'application/json;charset=utf-8'
    );
    setStatus('已儲存完整對話與選取狀態，包含未勾選內容。');
  }
  async function deliver(action) {
    try {
      const text = getExport(action === 'handoff');
      if (action === 'download') {
        downloadText(
          filenameFor(
            { source: archive.source.provider, title: `${archive.source.title}-selected` },
            'md'
          ),
          text
        );
        setStatus('已下載所選 Markdown。');
      } else {
        try {
          if (config.copyText) await config.copyText(text);
          else await navigator.clipboard.writeText(text);
          setStatus(`已複製所選 ${text.length.toLocaleString()} 字。`);
        } catch {
          manual.hidden = false;
          manualText.value = text;
          manualText.focus();
          manualText.select();
          setStatus('請手動複製已選取的文字，或下載 Markdown。');
        }
      }
    } catch (error) {
      setStatus(error.message);
    }
  }
  function open() {
    if (destroyed) return;
    restoreFocus = document.activeElement;
    if (!embedded && !frame.open) frame.showModal();
    render();
  }
  function close() {
    if (!embedded && frame.open) frame.close();
    restoreFocus?.focus?.();
    config.onClose?.();
  }
  if (!embedded)
    frame.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
  frame.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !embedded) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  function destroy() {
    destroyed = true;
    ++operation;
    if (!embedded && frame.open) frame.close();
    host.remove();
  }
  render();
  return Object.freeze({
    open,
    close,
    destroy,
    setArchive,
    getArchive: snapshot,
    refresh,
    setStatus,
    importFile,
  });
}
