// ==UserScript==
// @name         Vim Navigation
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.2.0
// @description  Vim 式頁內導航、搜尋、文字選取與區塊複製，附可客製的常駐情境小抄
// @author       Da-Wei Lee
// @license      MIT
// @match        https://*/*
// @match        http://*/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vim-navigation/vim-navigation.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vim-navigation/vim-navigation.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  const STORAGE_KEY = 'vimNavigationConfig';
  const MODES = ['normal', 'caret', 'visual', 'line'];
  const TEXT_MODES = ['caret', 'visual', 'line'];
  const DEFAULTS = {
    schemaVersion: 1,
    scrollStep: 64,
    hintChars: 'asdfghjkl',
    hintDetection: 'broad',
    theme: 'system',
    bindings: { normal: {}, caret: {}, visual: {}, line: {} },
    sites: {},
    customActions: [],
    ui: { collapsed: false, position: null },
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = {
    mode: 'normal',
    pageOverride: null,
    keyPrefix: '',
    count: '',
    lastCommand: '',
    lastCommandTime: 0,
    status: '',
    statusKind: 'info',
    composing: false,
    hints: null,
    hoverActive: false,
    hoverLabel: '',
  };
  let config = clone(DEFAULTS),
    commands = [],
    ui,
    textTools,
    hover,
    overlay,
    overlayRoot;
  let sequenceTimer, pointerTarget, lastScrollTarget, statusTimer;
  let maps = {},
    composingTimer,
    startupError = '';
  const ownHosts = new Set();
  const uiKeyCycles = new Set();
  const parentElement = (node) => node?.parentElement || node?.getRootNode?.().host || null;
  function isOwned(node) {
    for (
      let current = node?.nodeType === 3 ? node.parentElement : node;
      current;
      current = parentElement(current)
    ) {
      if (
        ownHosts.has(current) ||
        current.id === 'vim-navigation-ui' ||
        current.id === 'vim-navigation-overlays'
      )
        return true;
    }
    return false;
  }
  function isEditable(node) {
    for (
      let el = node?.nodeType === 3 ? node.parentElement : node;
      el?.nodeType === 1;
      el = parentElement(el)
    ) {
      if (
        el.matches(
          'input,textarea,select,[role="textbox"],[role="combobox"],.monaco-editor,.CodeMirror,.cm-editor'
        ) ||
        el.isContentEditable
      )
        return true;
    }
    return false;
  }
  function isVisible(element, viewportOnly = false) {
    if (!element?.isConnected || element.nodeType !== 1 || isOwned(element)) return false;
    if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
      return false;
    for (
      let ancestor = parentElement(element);
      ancestor?.nodeType === 1;
      ancestor = parentElement(ancestor)
    ) {
      const inherited = getComputedStyle(ancestor);
      if (
        Number(inherited.opacity) === 0 ||
        inherited.contentVisibility === 'hidden' ||
        ancestor.matches('[hidden],[inert],[aria-hidden="true"]')
      )
        return false;
    }
    const rects = Array.from(element.getClientRects());
    return rects.some(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        (!viewportOnly ||
          (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth))
    );
  }
  function roots() {
    const list = [document];
    for (let i = 0; i < list.length; i++) {
      for (const element of list[i].querySelectorAll('*')) {
        if (element.shadowRoot && !isOwned(element)) list.push(element.shadowRoot);
      }
    }
    return list;
  }
  function queryAll(selector) {
    return roots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  }
  function deepActive() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }
  function siteConfig() {
    return config.sites[location.origin] || {};
  }
  function enabled() {
    return state.pageOverride ?? siteConfig().enabled !== false;
  }
  function clearSequence() {
    clearTimeout(sequenceTimer);
    state.keyPrefix = '';
    state.count = '';
  }
  function setMode(mode) {
    state.mode = mode;
    clearSequence();
    render();
  }
  function notify(message, kind = 'info') {
    state.status = message;
    state.statusKind = kind;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      state.status = '';
      render();
    }, 4500);
    render();
  }
  function snapshot() {
    const mode = enabled() ? state.mode : 'paused';
    return {
      mode,
      enabled: enabled(),
      siteEnabled: siteConfig().enabled !== false,
      pageOverride: state.pageOverride,
      prefix: state.count + state.keyPrefix,
      keyPrefix: state.keyPrefix,
      lastCommand: state.lastCommand,
      lastCommandTime: state.lastCommandTime,
      status: state.status,
      statusKind: state.statusKind,
      hoverActive: state.hoverActive,
      hoverLabel: state.hoverLabel,
      origin: location.origin,
      config: clone(config),
      commands: commands.map((command) => ({
        ...command,
        run: undefined,
        keys: Object.entries(maps[state.mode] || {})
          .filter(([, id]) => id === command.id)
          .map(([key]) => key),
        keysByMode: Object.fromEntries(
          MODES.map((m) => [
            m,
            Object.entries(maps[m] || {})
              .filter(([, id]) => id === command.id)
              .map(([key]) => key),
          ])
        ),
      })),
    };
  }
  function render() {
    if (!ui) return;
    ui.render(snapshot());
    const host = ui.getHost();
    if (host) {
      ownHosts.add(host);
      host.dataset.mode = enabled() ? state.mode : 'paused';
      host.dataset.enabled = String(enabled());
    }
  }

  // All user-facing commands, bindings, help and custom actions share this registry.
  function buildCommands(candidate = config) {
    const list = [];
    const add = (id, label, category, modes, defaultKeys, run) =>
      list.push({ id, label, category, modes, defaultKeys, run });
    const normal = ['normal'];
    [
      ['scrollLeft', '向左捲動', 'h', 'x', -1],
      ['scrollDown', '向下捲動', 'j', 'y', 1],
      ['scrollUp', '向上捲動', 'k', 'y', -1],
      ['scrollRight', '向右捲動', 'l', 'x', 1],
    ].forEach(([id, label, key, axis, sign]) =>
      add(id, label, '導航', normal, [key], (n) => scroll(axis, sign * config.scrollStep * n))
    );
    add('halfPageDown', '向下半頁', '導航', normal, ['d'], (n) => scroll('y', n * 0.5, null));
    add('halfPageUp', '向上半頁', '導航', normal, ['u'], (n) => scroll('y', -n * 0.5, null));
    add('scrollTop', '捲到頂端', '導航', normal, ['gg'], () => scrollBoundary(false));
    add('scrollBottom', '捲到底端', '導航', normal, ['G'], () => scrollBoundary(true));
    add('goBack', '上一頁', '導航', normal, ['H'], () => history.back());
    add('goForward', '下一頁', '導航', normal, ['L'], () => history.forward());
    add('reload', '重新整理', '導航', normal, ['r'], () => location.reload());
    add('urlUp', '網址上一層', '導航', normal, ['gu'], () => {
      const url = new URL(location.href);
      url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
      url.search = '';
      url.hash = '';
      location.assign(url.href);
    });
    add('urlRoot', '網站根目錄', '導航', normal, ['gU'], () =>
      location.assign(location.origin + '/')
    );
    add('focusInput', '聚焦輸入框', '導航', normal, ['gi'], () => {
      const target = queryAll(
        'input:not([type="hidden"]),textarea,[contenteditable="true"],[role="textbox"]'
      ).find((el) => isVisible(el, true) && !el.disabled);
      if (target) target.focus();
      else notify('目前畫面沒有可輸入的欄位');
    });
    add('hintsClick', '提示：點擊連結／按鈕', '連結', normal, ['f'], () => startHints('click'));
    add('hintsOpen', '提示：背景開啟連結', '連結', normal, ['F'], () => startHints('open'));
    add('hintsHover', '提示：模擬 Hover', '連結', normal, ['zh'], () => startHints('hover'));
    add('hintsCopy', '提示：複製連結網址', '複製', normal, ['yf'], () => startHints('url'));
    add('copyUrl', '複製頁面 URL', '複製', normal, ['yy'], () => copyAndNotify(location.href));
    add('copyMarkdownLink', '複製 Markdown link', '複製', normal, ['ym'], () =>
      copyAndNotify(
        '[' +
          document.title.replace(/([\\[\]])/g, '\\$1') +
          '](' +
          location.href.replace(/\(/g, '%28').replace(/\)/g, '%29') +
          ')'
      )
    );
    add('copySelection', '複製目前選取', '複製', normal, ['ys'], () => {
      return copySelectedText(false);
    });
    add('hintsCopyBlock', '提示：複製文字區塊', '複製', normal, ['yb'], () => startHints('block'));
    add('hintsCopyCode', '提示：複製程式碼', '複製', normal, ['yc'], () => startHints('code'));
    add('hintsCaret', '跳至段首', '選取', normal, ['zv'], () => startHints('caret'));
    add('enterCaret', 'Caret 游標模式', '選取', MODES, ['c'], () => textTools.enter('caret'));
    add('enterVisual', 'Visual 字元選取', '選取', MODES, ['v'], () =>
      textTools.enter(state.mode === 'visual' ? 'caret' : 'visual')
    );
    add('enterLine', 'Visual Line 行選取', '選取', MODES, ['V'], () => textTools.enter('line'));
    [
      ['moveLeft', '上一個字元', 'h', 'left'],
      ['moveRight', '下一個字元', 'l', 'right'],
      ['moveUp', '上一個畫面行', 'k', 'up'],
      ['moveDown', '下一個畫面行', 'j', 'down'],
      ['wordNext', '下一詞起點', 'w', 'wordNext'],
      ['wordEnd', '詞尾', 'e', 'wordEnd'],
      ['wordPrev', '上一詞起點', 'b', 'wordPrev'],
      ['lineStart', '行首', '0', 'lineStart'],
      ['lineEnd', '行尾', '$', 'lineEnd'],
      ['docStart', '文件起點', 'gg', 'docStart'],
      ['docEnd', '文件終點', 'G', 'docEnd'],
    ].forEach(([id, label, key, motion]) =>
      add(id, label, '選取', TEXT_MODES, [key], (n) => textTools.move(motion, n))
    );
    add('reverseSelection', '交換選取端點', '選取', TEXT_MODES, ['o'], () => textTools.reverse());
    add('yank', '複製選取並返回', '選取', TEXT_MODES, ['y'], () => copySelectedText(false));
    add('yankLines', '複製完整畫面行', '選取', TEXT_MODES, ['Y'], () => copySelectedText(true));
    add('find', '搜尋頁面文字', '搜尋', normal, ['/'], () => textTools.openFind());
    add('nextMatch', '下一個搜尋命中', '搜尋', normal, ['n'], () => textTools.findNext(false));
    add('previousMatch', '上一個搜尋命中', '搜尋', normal, ['N'], () => textTools.findNext(true));
    add('insert', '交給網站：Insert', '模式', normal, ['i'], () => {
      textTools.exit();
      setMode('insert');
    });
    add('toggleEnabled', '切換本頁啟用', '模式', normal, ['<a-s-v>'], toggleEnabled);
    add('help', '完整鍵位小抄', '模式', MODES, ['?'], () => ui.toggleHelp());
    for (const action of candidate.customActions) {
      add(action.id, action.label, '自訂', normal, [], () => {
        if (action.origin && action.origin !== location.origin) return notify('此動作不適用於本站');
        const targets = queryAll(action.selector).filter(
          (el) => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
        );
        if (targets.length === 1) {
          const element = targets[0];
          if (action.action === 'scroll') {
            element.scrollIntoView({ block: 'center' });
            return;
          }
          if (action.action === 'copy') return copyAndNotify(cleanBlockText(element));
          if (action.action === 'hover') {
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const hit = hitTest(element);
            if (hit) hover.enter(element, hit.point);
            else notify('目前無法觸及這個 Hover 目標');
            return;
          }
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return activateHint({ element }, { kind: 'custom', action });
        }
        startHints('custom', action);
      });
    }
    return list;
  }
  function effectiveMaps(candidate, registry, origin = location.origin) {
    return Object.fromEntries(
      MODES.map((mode) => {
        const result = {};
        for (const command of registry)
          if (command.modes.includes(mode)) {
            for (const key of command.defaultKeys) result[key] = command.id;
          }
        for (const overrides of [
          candidate.bindings[mode],
          candidate.sites[origin]?.bindings?.[mode],
        ]) {
          for (const [key, id] of Object.entries(overrides || {})) {
            if (id === null) delete result[key];
            else result[key] = id;
          }
        }
        // v0.1 users may already bind zh… or z (with zv explicitly unbound).
        // Only retire the NEW default, never discard their existing mappings.
        if (mode === 'normal' && result.zh === 'hintsHover') {
          const explicit = {
            ...candidate.bindings[mode],
            ...candidate.sites[origin]?.bindings?.[mode],
          };
          if (
            !Object.hasOwn(explicit, 'zh') &&
            Object.entries(explicit).some(
              ([key, id]) =>
                id !== null && key !== 'zh' && (key.startsWith('zh') || 'zh'.startsWith(key))
            )
          )
            delete result.zh;
        }
        return [mode, result];
      })
    );
  }
  function keyTokens(sequence) {
    const tokens = sequence.match(/<[^<>]+>|[^<>]/gu) || [];
    if (!sequence || tokens.join('') !== sequence || tokens.length > 8)
      throw new Error('鍵位格式無效：' + sequence);
    for (const token of tokens) {
      if (
        token.startsWith('<') &&
        !/^<(?:[acms]-)*(?:[a-z0-9]|space|tab|enter|backspace|up|down|left|right)>$/.test(token)
      )
        throw new Error('修飾鍵格式無效：' + token);
    }
    return tokens;
  }
  function validate(candidate) {
    const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (!object(candidate) || candidate.schemaVersion !== 1)
      throw new Error('schemaVersion 必須為 1');
    candidate = { ...candidate };
    if (!Object.hasOwn(candidate, 'hintDetection')) candidate.hintDetection = 'broad';
    if (!['precise', 'broad', 'aggressive'].includes(candidate.hintDetection))
      throw new Error('提示偵測須為 precise、broad 或 aggressive');
    if (
      !Number.isFinite(candidate.scrollStep) ||
      candidate.scrollStep < 8 ||
      candidate.scrollStep > 1000
    )
      throw new Error('捲動步長須介於 8～1000');
    if (
      typeof candidate.hintChars !== 'string' ||
      !/^[a-z]{2,26}$/.test(candidate.hintChars) ||
      new Set(candidate.hintChars).size !== candidate.hintChars.length
    )
      throw new Error('提示字母須為 2～26 個不重複的小寫英文字母');
    if (!['system', 'light', 'dark'].includes(candidate.theme))
      throw new Error('主題須為 system、light 或 dark');
    if (
      !object(candidate.bindings) ||
      !object(candidate.sites) ||
      !object(candidate.ui) ||
      !Array.isArray(candidate.customActions)
    )
      throw new Error('bindings、sites、ui 或 customActions 格式無效');
    if (typeof candidate.ui.collapsed !== 'boolean') throw new Error('ui.collapsed 必須為布林值');
    if (
      candidate.ui.position !== null &&
      (!object(candidate.ui.position) ||
        !Number.isFinite(candidate.ui.position.x) ||
        !Number.isFinite(candidate.ui.position.y))
    )
      throw new Error('面板位置須為 null 或 {x,y}');
    const ids = new Set();
    for (const action of candidate.customActions) {
      if (!object(action) || !/^custom:[a-zA-Z0-9_-]+$/.test(action.id) || ids.has(action.id))
        throw new Error('自訂動作 ID 須為不重複的 custom:名稱');
      ids.add(action.id);
      if (
        typeof action.label !== 'string' ||
        !action.label.trim() ||
        !['click', 'focus', 'scroll', 'copy', 'hover'].includes(action.action) ||
        typeof action.selector !== 'string' ||
        !action.selector.trim()
      )
        throw new Error('自訂動作需要名稱、action 與 selector');
      try {
        document.querySelector(action.selector);
      } catch {
        throw new Error('selector 無效：' + action.selector);
      }
      if (action.origin && new URL(action.origin).origin !== action.origin)
        throw new Error('自訂 origin 必須是完整來源，例如 https://example.com');
    }
    const registry = buildCommands(candidate);
    const validateBindings = (bindingSet) => {
      if (!object(bindingSet)) throw new Error('鍵位表必須是物件');
      for (const [mode, values] of Object.entries(bindingSet)) {
        if (!MODES.includes(mode) || !object(values)) throw new Error('不支援的鍵位模式：' + mode);
        for (const [key, id] of Object.entries(values)) {
          const tokens = keyTokens(key);
          if (/^[1-9]$/.test(tokens[0]) || key === '<a-s-v>')
            throw new Error('數字前綴與 <a-s-v> 恢復鍵保留使用');
          if (id !== null && !registry.some((c) => c.id === id && c.modes.includes(mode)))
            throw new Error('未知指令或模式不符：' + id);
        }
      }
    };
    validateBindings(candidate.bindings);
    for (const [origin, site] of Object.entries(candidate.sites)) {
      if (
        !/^https?:\/\//.test(origin) ||
        new URL(origin).origin !== origin ||
        !object(site) ||
        typeof site.enabled !== 'boolean'
      )
        throw new Error('網站規則須使用 HTTP(S) origin 與 enabled');
      if (site.bindings) validateBindings(site.bindings);
      if (
        Object.hasOwn(site, 'hintDetection') &&
        !['precise', 'broad', 'aggressive'].includes(site.hintDetection)
      )
        throw new Error('本站提示偵測須為 precise、broad 或 aggressive');
    }
    for (const origin of new Set([
      location.origin,
      'https://vim-navigation.invalid',
      ...Object.keys(candidate.sites),
    ])) {
      for (const [mode, bindings] of Object.entries(effectiveMaps(candidate, registry, origin))) {
        const keys = Object.keys(bindings).map((key) => [key, keyTokens(key)]);
        for (const [key, tokens] of keys)
          for (const [other, otherTokens] of keys) {
            if (
              key !== other &&
              tokens.length < otherTokens.length &&
              tokens.every((token, i) => token === otherTokens[i])
            )
              throw new Error('鍵位前綴衝突 (' + mode + ')：' + key + ' / ' + other);
          }
      }
    }
    return clone(candidate);
  }
  function applyConfig(candidate) {
    try {
      const next = validate(candidate);
      GM_setValue(STORAGE_KEY, next);
      config = next;
      commands = buildCommands();
      maps = effectiveMaps(config, commands);
      cancelTransient();
      render();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  function saveUI(patch) {
    config.ui = { ...config.ui, ...patch };
    GM_setValue(STORAGE_KEY, clone(config));
    render();
  }
  async function copyText(value) {
    if (typeof value !== 'string' || !value.length) throw new Error('沒有可複製的文字');
    if (typeof GM !== 'undefined' && typeof GM.setClipboard === 'function') {
      await GM.setClipboard(value, 'text/plain');
    } else {
      await GM_setClipboard(value, 'text/plain');
    }
  }
  async function copySelectedText(lines) {
    const target = hover.getState().target;
    const commandTime = state.lastCommandTime;
    const copied = await textTools.copy(lines);
    // Disconnect text observers before mouseleave can remove a preview's DOM.
    if (
      copied &&
      state.mode === 'normal' &&
      state.lastCommandTime === commandTime &&
      hover.getState().target === target
    )
      hover.clear('copy');
    return copied;
  }
  async function copyAndNotify(value) {
    const target = hover.getState().target;
    const commandTime = state.lastCommandTime;
    await copyText(value);
    if (
      state.mode === 'normal' &&
      state.lastCommandTime === commandTime &&
      hover.getState().target === target
    )
      hover.clear('copy');
    notify('已複製 ' + value.length + ' 個字元', 'success');
  }
  function run(id, count = 1) {
    const command = commands.find((c) => c.id === id);
    if (!command) return;
    state.lastCommand = id;
    state.lastCommandTime = Date.now();
    clearSequence();
    render();
    try {
      Promise.resolve(command.run(count)).catch((error) =>
        notify(error.message || String(error), 'error')
      );
    } catch (error) {
      notify(error.message || String(error), 'error');
    }
  }
  function cancelTransient() {
    clearSequence();
    exitHints();
    textTools?.clear();
    hover?.clear('disabled');
    state.mode = 'normal';
  }
  function toggleEnabled() {
    const next = !enabled();
    cancelTransient();
    state.pageOverride = next;
    notify(next ? '本頁已啟用' : '本頁暫停：Esc 也交給網站；⌥⇧V 或按鈕恢復');
  }
  function toggleSite() {
    const next = clone(config);
    next.sites[location.origin] = { ...siteConfig(), enabled: siteConfig().enabled === false };
    const result = applyConfig(next);
    if (result.ok) {
      state.pageOverride = null;
      render();
    } else notify(result.error, 'error');
  }

  function scrollContainer(axis = 'y', amount = 0, boundary = false) {
    const dimension =
      axis === 'y'
        ? ['scrollHeight', 'clientHeight', 'scrollTop', 'overflowY']
        : ['scrollWidth', 'clientWidth', 'scrollLeft', 'overflowX'];
    const doc = document.scrollingElement;
    const candidates = [
      deepActive(),
      pointerTarget,
      lastScrollTarget,
      document.elementFromPoint(innerWidth / 2, innerHeight / 2),
      doc,
    ];
    const seen = new Set();
    for (const candidate of candidates) {
      for (let el = candidate; el?.nodeType === 1; el = parentElement(el)) {
        if (seen.has(el) || isOwned(el) || el === doc) continue;
        seen.add(el);
        if (el !== doc && !isVisible(el)) continue;
        const range = el[dimension[0]] - el[dimension[1]];
        if (
          range <= 1 ||
          (el !== doc && !/(auto|scroll|overlay)/.test(getComputedStyle(el)[dimension[3]]))
        )
          continue;
        if (
          boundary ||
          !amount ||
          (amount > 0 ? el[dimension[2]] < range - 1 : el[dimension[2]] > 0)
        )
          return el;
      }
    }
    return doc;
  }
  function scroll(axis, amount, pixels = true) {
    const el = scrollContainer(axis, amount);
    if (!el) return;
    const delta =
      pixels === null
        ? amount * (el === document.scrollingElement ? innerHeight : el.clientHeight)
        : amount;
    el.scrollBy({
      left: axis === 'x' ? delta : 0,
      top: axis === 'y' ? delta : 0,
      behavior: 'instant',
    });
    lastScrollTarget = el;
  }
  function scrollBoundary(bottom) {
    const el = scrollContainer('y', 0, true);
    if (el) {
      el.scrollTop = bottom ? el.scrollHeight : 0;
      lastScrollTarget = el;
    }
  }
  function scrollFocus(range) {
    const node =
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement;
    const doc = document.scrollingElement;
    for (let el = node; el; el = parentElement(el)) {
      if (el.nodeType !== 1) continue;
      const style = getComputedStyle(el);
      const canY =
        el.scrollHeight > el.clientHeight + 1 &&
        (el === doc || /(auto|scroll|overlay)/.test(style.overflowY));
      const canX =
        el.scrollWidth > el.clientWidth + 1 &&
        (el === doc || /(auto|scroll|overlay)/.test(style.overflowX));
      if (!canY && !canX) continue;
      const rect = range.getBoundingClientRect();
      if (!rect.height) continue;
      const box =
        el === doc
          ? { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
          : el.getBoundingClientRect();
      const insetY = Math.min(24, (box.bottom - box.top) / 4),
        insetX = Math.min(12, (box.right - box.left) / 4);
      const top = Math.max(0, box.top) + insetY,
        bottom = Math.min(innerHeight, box.bottom) - insetY;
      const left = Math.max(0, box.left) + insetX,
        right = Math.min(innerWidth, box.right) - insetX;
      const dy = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      const dx = rect.left < left ? rect.left - left : rect.right > right ? rect.right - right : 0;
      el.scrollBy({ top: canY ? dy : 0, left: canX ? dx : 0, behavior: 'instant' });
    }
  }

  function ensureOverlay() {
    if (overlay?.isConnected) return;
    if (!document.documentElement) return;
    overlay = document.createElement('div');
    overlay.id = 'vim-navigation-overlays';
    overlay.style.cssText =
      'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    overlayRoot = overlay.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      '.hint{position:fixed;box-sizing:border-box;padding:2px 5px;border:1px solid #876d17;border-radius:5px;background:#fff0a3;color:#292108;font:700 12px/1.25 ui-monospace,monospace;box-shadow:0 2px 5px #0003;pointer-events:none;white-space:nowrap}.hint mark{color:#847139;background:none}.caret{position:fixed;background:#139578;width:2px;box-shadow:0 0 0 1px #fff9;pointer-events:none}';
    overlayRoot.append(style);
    document.documentElement.append(overlay);
    ownHosts.add(overlay);
    if (!document.getElementById('vim-navigation-highlight-style')) {
      const sheet = document.createElement('style');
      sheet.id = 'vim-navigation-highlight-style';
      sheet.textContent =
        '::highlight(vim-nav-search){background:#f5dc83;color:#292108}::highlight(vim-nav-search-current){background:#e69b46;color:#241709}';
      document.documentElement.append(sheet);
    }
  }
  function setCaretRect(rect) {
    ensureOverlay();
    if (!overlayRoot) return;
    let marker = overlayRoot.querySelector('.caret');
    if (!rect) {
      marker?.remove();
      return;
    }
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'caret';
      overlayRoot.append(marker);
    }
    marker.style.left = rect.left + 'px';
    marker.style.top = rect.top + 'px';
    marker.style.height = Math.max(14, rect.height) + 'px';
  }
  function cleanBlockText(element) {
    const target = element.matches('pre') ? element.querySelector('code') || element : element;
    const preserve = element.matches('pre,code');
    function extract(node) {
      if (node.nodeType === 3) return preserve ? node.data : node.data.replace(/\s+/gu, ' ');
      if (
        node.nodeType !== 1 ||
        isOwned(node) ||
        node.matches(
          'button,input,textarea,select,[aria-hidden="true"],[hidden],[inert],script,style'
        )
      )
        return '';
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible') return '';
      if (node.localName === 'br') return '\n';
      const text = Array.from(node.childNodes).map(extract).join('');
      const block =
        !preserve &&
        node !== target &&
        /^(block|list-item|table-row|flex|grid|flow-root)$/.test(style.display);
      return block ? '\n' + text + '\n' : text;
    }
    const result = extract(target);
    return preserve
      ? result
      : result
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
  }
  const NATIVE_HINTS =
    'a[href],area[href],button,input:not([type="hidden"]),textarea,select,summary,[contenteditable="true"]';
  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'treeitem',
    'option',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'combobox',
    'textbox',
    'searchbox',
    'slider',
    'spinbutton',
    'gridcell',
  ]);
  function hintLevel() {
    return siteConfig().hintDetection || config.hintDetection || 'broad';
  }
  function roleOf(element) {
    return (
      (element.getAttribute('role') || '')
        .toLowerCase()
        .split(/\s+/)
        .find((role) => INTERACTIVE_ROLES.has(role)) || ''
    );
  }
  function linkURL(element) {
    const raw =
      typeof element.href === 'string'
        ? element.href
        : element.href?.baseVal || element.getAttribute('href');
    if (!raw) return '';
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return '';
    }
  }
  function permalinkHeading(element) {
    if (!element.matches('a[href]')) return null;
    const url = linkURL(element);
    if (!url) return null;
    const parsed = new URL(url);
    if (
      !parsed.hash ||
      parsed.origin !== location.origin ||
      parsed.pathname !== location.pathname ||
      parsed.search !== location.search
    )
      return null;
    let fragment;
    try {
      fragment = decodeURIComponent(parsed.hash.slice(1));
    } catch {
      return null;
    }
    const destination =
      document.getElementById(fragment) || document.getElementById('user-content-' + fragment);
    const containing = element.closest('h1,h2,h3,h4,h5,h6');
    const sibling = Array.from(element.parentElement?.children || []).find((node) =>
      node.matches('h1,h2,h3,h4,h5,h6')
    );
    return (
      [containing, destination, sibling].find(
        (node) => node?.matches('h1,h2,h3,h4,h5,h6') && isVisible(node, true)
      ) || null
    );
  }
  // A zero-opacity permalink can be deliberately hidden until hover; invisible
  // wrappers and text remain excluded. Do not weaken the shared text visibility.
  function hintVisible(element) {
    if (!element?.isConnected || element.nodeType !== 1 || isOwned(element)) return false;
    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      style.contentVisibility === 'hidden' ||
      element.matches('[hidden],[inert],[aria-hidden="true"]')
    )
      return false;
    if (Number(style.opacity) === 0 && !permalinkHeading(element)) return false;
    for (let node = parentElement(element); node?.nodeType === 1; node = parentElement(node)) {
      const inherited = getComputedStyle(node);
      if (
        inherited.display === 'none' ||
        Number(inherited.opacity) === 0 ||
        inherited.contentVisibility === 'hidden' ||
        node.matches('[hidden],[inert],[aria-hidden="true"]')
      )
        return false;
    }
    return true;
  }
  function rectSources(element) {
    const rects = Array.from(element.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length || getComputedStyle(element).display !== 'contents') return rects;
    // display:contents has no own box. Bound the fallback to its immediate
    // rendered subtree; hit testing still requires an actual descendant.
    const descendants = Array.from(element.querySelectorAll('*')).slice(0, 100);
    return descendants
      .filter(hintVisible)
      .flatMap((node) =>
        Array.from(node.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
      );
  }
  function clippedRect(rect, element) {
    let left = Math.max(0, rect.left),
      right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top),
      bottom = Math.min(innerHeight, rect.bottom);
    for (let node = parentElement(element); node?.nodeType === 1; node = parentElement(node)) {
      const style = getComputedStyle(node);
      if (style.display === 'contents') continue;
      const bounds = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip|overlay)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + node.clientLeft);
        right = Math.min(right, bounds.left + node.clientLeft + node.clientWidth);
      }
      if (/(auto|scroll|hidden|clip|overlay)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + node.clientTop);
        bottom = Math.min(bottom, bounds.top + node.clientTop + node.clientHeight);
      }
    }
    return right > left && bottom > top
      ? { left, top, right, bottom, width: right - left, height: bottom - top }
      : null;
  }
  function deepElementAt(x, y) {
    let hit = document.elementFromPoint(x, y);
    const seen = new Set();
    while (hit?.shadowRoot?.elementFromPoint && !seen.has(hit)) {
      seen.add(hit);
      const nested = hit.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === hit) break;
      hit = nested;
    }
    return hit;
  }
  function containsComposed(owner, node) {
    for (let current = node; current; current = parentElement(current)) {
      if (current === owner) return true;
    }
    return false;
  }
  function hitTest(element, options = {}) {
    const region = options.region || element;
    if (!hintVisible(element) || !region?.isConnected) return null;
    for (const rect of rectSources(region)) {
      const clipped = clippedRect(rect, region);
      if (!clipped) continue;
      const { left, right, top, bottom } = clipped;
      const dx = Math.min(1, (right - left) / 4),
        dy = Math.min(1, (bottom - top) / 4);
      const points = [
        [(left + right) / 2, (top + bottom) / 2],
        [left + dx, top + dy],
        [right - dx, top + dy],
        [left + dx, bottom - dy],
        [right - dx, bottom - dy],
      ];
      for (const [x, y] of points) {
        const hit = deepElementAt(x, y);
        if (!hit || !containsComposed(region, hit)) continue;
        if (
          options.owner?.getAttribute('role') === 'treeitem' &&
          hit.closest('[role="treeitem"]') !== options.owner
        )
          continue;
        const independent = (options.exclusions || []).some(
          (other) => other !== element && other !== region && containsComposed(other, hit)
        );
        if (independent) continue;
        return { rect: clipped, point: { x, y }, hit };
      }
    }
    return null;
  }
  function labelledRegion(owner) {
    const root = owner.getRootNode();
    for (const id of (owner.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      if (!id) continue;
      const node = root.getElementById?.(id) || root.querySelector('#' + CSS.escape(id));
      if (
        node &&
        owner.contains(node) &&
        node.closest('[role="treeitem"]') === owner &&
        hintVisible(node)
      )
        return node;
    }
    return (
      Array.from(owner.children).find(
        (node) =>
          !node.matches('ul,ol,[role="group"],[role="treeitem"],button,input,select') &&
          hintVisible(node)
      ) || owner
    );
  }
  function hasHandler(element, names) {
    return names.some((name) => element.hasAttribute(name) || typeof element[name] === 'function');
  }
  function classifyHint(element, kind, level) {
    if (element.matches('html,body,iframe,script,style,template') || isOwned(element)) return null;
    if (
      !rectSources(element).some(
        (r) => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      )
    )
      return null;
    if (!hintVisible(element)) return null;
    const role = roleOf(element);
    const native = element.matches(NATIVE_HINTS);
    const control = element.matches('label') ? element.control : null;
    const disabled =
      element.matches(':disabled,[aria-disabled="true"]') ||
      Boolean(element.closest('[aria-disabled="true"]')) ||
      control?.matches(':disabled,[type="hidden"]');
    const hoverOnly = kind === 'hover';
    if (!hoverOnly && disabled) return null;
    const clickHandler = hasHandler(element, ['onclick', 'onmousedown', 'onpointerdown']);
    const hoverHandler = hasHandler(element, [
      'onmouseover',
      'onmouseenter',
      'onpointerover',
      'onpointerenter',
    ]);
    let score = native
      ? 400
      : role
        ? 350
        : control
          ? 300
          : element.hasAttribute('tabindex') && element.tabIndex >= 0
            ? 280
            : 0;
    let reason = score ? 'semantic' : '';
    if (hoverOnly && hoverHandler) {
      score = Math.max(score, 320);
      reason ||= 'hover-handler';
    }
    if (level !== 'precise') {
      if (clickHandler) {
        score = Math.max(score, 250);
        reason ||= 'handler';
      }
      const cursor = getComputedStyle(element).cursor;
      const parentCursor = parentElement(element)
        ? getComputedStyle(parentElement(element)).cursor
        : '';
      if (cursor === 'pointer' && cursor !== parentCursor) {
        score = Math.max(score, 200);
        reason ||= 'pointer';
      }
      if (
        hoverOnly &&
        (element.hasAttribute('title') ||
          element.hasAttribute('aria-describedby') ||
          element.matches('[data-tooltip],[data-tooltip-content],[data-original-title]') ||
          (cursor === 'help' && cursor !== parentCursor))
      ) {
        score = Math.max(score, 220);
        reason ||= 'tooltip';
      }
    }
    if (level === 'aggressive') {
      const signals = [
        element.hasAttribute('tabindex') && element.tabIndex < 0,
        element.matches('[aria-selected],[aria-pressed],[aria-expanded],[aria-haspopup]'),
        /(?:^|\s)(?:btn|button|clickable|tree-item|menu-item)(?:\s|$)/i.test(
          element.getAttribute('class') || ''
        ),
      ].filter(Boolean).length;
      if (signals >= 2) {
        score = Math.max(score, 100);
        reason ||= 'weak';
      }
    }
    if (!score) return null;
    if (
      hoverOnly &&
      disabled &&
      !hoverHandler &&
      !element.matches('[title],[aria-describedby],[data-tooltip]')
    )
      return null;
    const region = role === 'treeitem' ? labelledRegion(element) : element;
    const focusOnly =
      element.matches(
        'textarea,select,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="file"]),[contenteditable="true"]'
      ) ||
      ['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'].includes(role) ||
      (!native && !role && !control && !clickHandler && reason === 'semantic');
    return {
      element,
      region,
      target: region,
      identity: control || region,
      operation: hoverOnly ? 'hover' : focusOnly ? 'focus' : 'click',
      score,
      reason,
      url: element.matches('a[href],area[href]') ? linkURL(element) : '',
    };
  }
  function hintCandidates(kind, action) {
    let items;
    if (kind === 'caret') {
      items = textTools.caretTargets().map(({ element, point }) => ({
        element,
        target: element,
        region: element,
        identity: element,
        caretPoint: point,
        score: 400,
      }));
    } else if (kind === 'block' || kind === 'code') {
      const selector = kind === 'code' ? 'pre,code' : 'p,pre,h1,h2,h3,h4,h5,h6,li,blockquote,td,th';
      let elements = queryAll(selector).filter(
        (element) => isVisible(element, true) && !isEditable(element) && element.textContent.trim()
      );
      elements = elements.filter(
        (element) =>
          !elements.some(
            (other) =>
              other !== element &&
              other.contains(element) &&
              (other.matches('pre') ||
                (element.matches('p,code') && other.matches('li,blockquote')))
          )
      );
      items = elements.map((element) => ({
        element,
        target: element,
        region: element,
        identity: element,
        score: 400,
      }));
    } else if (kind === 'open' || kind === 'url') {
      items = queryAll('a[href],area[href]')
        .filter(
          (element) =>
            hintVisible(element) &&
            !element.matches(':disabled,[aria-disabled="true"]') &&
            !element.closest('[aria-disabled="true"]')
        )
        .map((element) => ({
          element,
          target: element,
          region: element,
          identity: element,
          score: 400,
          url: linkURL(element),
        }))
        .filter((item) => item.url && (kind !== 'open' || /^https?:/.test(item.url)));
    } else if (kind === 'custom') {
      items = queryAll(action.selector)
        .filter(
          (element) =>
            hintVisible(element) &&
            (action.action === 'hover' || !element.matches(':disabled,[aria-disabled="true"]'))
        )
        .map((element) => ({
          element,
          target: element,
          region: element,
          identity: element,
          score: 400,
          operation: action.action,
        }));
    } else {
      const level = hintLevel();
      items = queryAll('*')
        .map((element) => classifyHint(element, kind, level))
        .filter(Boolean);
    }
    // Every candidate must stand on its own reachable region before de-duplication.
    const regions = items.filter((item) => item.score >= 300).map((item) => item.region);
    items = items
      .map((item) => {
        const exclusions =
          item.operation === 'click' && item.reason !== 'semantic'
            ? regions.filter((region) => item.region.contains(region) && region !== item.region)
            : [];
        const hit = hitTest(item.element, { region: item.region, owner: item.element, exclusions });
        return hit ? { ...item, exclusions, ...hit } : null;
      })
      .filter(Boolean);
    const seen = new Map();
    for (const item of items) {
      const previous = seen.get(item.identity);
      if (!previous || item.score > previous.score) seen.set(item.identity, item);
    }
    const unique = Array.from(seen.values());
    return unique.filter(
      (item) =>
        !unique.some((other) => {
          if (other === item || other.score <= item.score || !item.region.contains(other.region))
            return false;
          // The pointer row wrapper and its ARIA-labelled item perform the same
          // primary action. Keep a sibling chevron/secondary handler independently.
          if (
            item.reason === 'pointer' &&
            other.element.getAttribute('role') === 'treeitem' &&
            item.element.closest('[role="treeitem"]') === other.element
          )
            return true;
          const a = item.rect,
            b = other.rect;
          return (
            Math.abs(a.left - b.left) < 2 &&
            Math.abs(a.top - b.top) < 2 &&
            Math.abs(a.right - b.right) < 2 &&
            Math.abs(a.bottom - b.bottom) < 2
          );
        })
    );
  }

  function exitHints() {
    if (!state.hints) return;
    state.hints.observer?.disconnect();
    state.hints.controller.abort();
    state.hints = null;
    overlayRoot?.querySelectorAll('.hint').forEach((el) => el.remove());
    if (state.mode === 'hints') state.mode = 'normal';
  }
  function positionHints() {
    const hintState = state.hints;
    if (!hintState) return;
    for (const hint of hintState.items) {
      const hit = hitTest(hint.element, {
        region: hint.region,
        owner: hint.element,
        exclusions: hint.exclusions,
      });
      if (!hint.element.isConnected || !hit) {
        exitHints();
        notify('提示目標已變更，請重新按提示鍵');
        return;
      }
      hint.rect = hit.rect;
      hint.point = hit.point;
      hint.marker.style.left = Math.max(2, Math.min(innerWidth - 40, hit.point.x)) + 'px';
      hint.marker.style.top = Math.max(2, Math.min(innerHeight - 22, hit.point.y)) + 'px';
    }
  }
  function startHints(kind, action) {
    exitHints();
    textTools.exit();
    ensureOverlay();
    // The compact Hints dock can uncover page targets hidden by the practice card.
    setMode('hints');
    const candidates = hintCandidates(kind, action);
    if (!candidates.length) {
      setMode('normal');
      notify('目前畫面沒有符合條件的目標');
      return;
    }
    const chars = Array.from(config.hintChars);
    const width = Math.max(1, Math.ceil(Math.log(candidates.length) / Math.log(chars.length)));
    const labelFor = (index) => {
      let label = '';
      for (let i = 0; i < width; i++) {
        label = chars[index % chars.length] + label;
        index = Math.floor(index / chars.length);
      }
      return label;
    };
    const controller = new AbortController();
    const items = candidates.map((candidate, index) => {
      const label = labelFor(index);
      const marker = document.createElement('span');
      marker.className = 'hint';
      marker.textContent = label;
      marker.dataset.hint = label;
      marker.dataset.targetId = candidate.element.id;
      marker.dataset.activationId = candidate.target.id;
      overlayRoot.append(marker);
      return { ...candidate, label, marker };
    });
    state.hints = { kind, action, items, input: '', controller };
    positionHints();
    const refresh = () => requestAnimationFrame(positionHints);
    document.addEventListener('scroll', refresh, {
      capture: true,
      passive: true,
      signal: controller.signal,
    });
    window.addEventListener('resize', refresh, { signal: controller.signal });
    const observer = new MutationObserver((records) => {
      if (!state.hints || records.every((record) => isOwned(record.target))) return;
      if (records.some((record) => !isOwned(record.target))) {
        exitHints();
        notify('頁面內容已更新，請重新選擇提示');
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-disabled'],
    });
    state.hints.observer = observer;
    notify(
      kind === 'hover'
        ? '選擇模擬 Hover 目標 · 不點擊 · Esc 取消'
        : kind === 'caret'
          ? '選擇段首 → v 開始選取 → 移動 → y 複製'
          : '輸入字母選擇目標 · Esc 取消'
    );
  }
  async function activateHint(item, hintState) {
    const { element } = item;
    const target = item.target || element;
    const hit = hitTest(element, {
      region: item.region || target,
      owner: element,
      exclusions: item.exclusions,
    });
    if (!element.isConnected || !target.isConnected || !hit) {
      notify('目標已變更，請重新選擇');
      return;
    }
    const kind = hintState.kind;
    if (kind === 'url') return copyAndNotify(item.url || linkURL(element));
    if (kind === 'open') {
      GM_openInTab(item.url || linkURL(element), { active: false, insert: true });
      hover.clear('open');
      return;
    }
    if (kind === 'block' || kind === 'code') return copyAndNotify(cleanBlockText(element));
    if (kind === 'caret') {
      textTools.enterAt(item.caretPoint, 'caret');
      return;
    }
    const action =
      kind === 'hover'
        ? 'hover'
        : kind === 'custom'
          ? hintState.action.action
          : item.operation || 'click';
    if (action === 'hover') {
      hover.enter(target, hit.point);
      return;
    }
    if (action === 'copy') return copyAndNotify(cleanBlockText(element));
    if (action === 'scroll') {
      element.scrollIntoView({ block: 'center' });
      return;
    }
    if (action === 'focus') {
      if (
        !target.hasAttribute('tabindex') &&
        !target.matches('input,textarea,select,button,a[href]') &&
        !target.isContentEditable
      ) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus();
      return;
    }
    if (typeof target.click === 'function') target.click();
    else
      target.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: hit.point.x,
          clientY: hit.point.y,
          button: 0,
          buttons: 0,
        })
      );
    hover.clear('click');
  }
  function handleHint(event) {
    if (event.repeat) {
      consume(event);
      return;
    }
    const hints = state.hints;
    if (!hints) return;
    if (event.key === 'Backspace') hints.input = hints.input.slice(0, -1);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
      hints.input += event.key.toLowerCase();
    else return;
    consume(event);
    const matches = hints.items.filter((item) => item.label.startsWith(hints.input));
    if (!matches.length) {
      hints.input = '';
      notify('沒有符合的提示；重新輸入或 Esc 取消');
    }
    for (const item of hints.items) item.marker.hidden = !item.label.startsWith(hints.input);
    state.keyPrefix = hints.input;
    render();
    const exact = matches.find((item) => item.label === hints.input);
    if (exact) {
      exitHints();
      clearSequence();
      // Validate/activate against the compact dock's geometry before Normal
      // rendering can cover the chosen target again.
      const activation = activateHint(exact, hints);
      render();
      Promise.resolve(activation).catch((error) => notify(error.message, 'error'));
    }
  }

  function eventToken(event) {
    let key = event.key;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase();
      else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
      const modifiers = [
        event.altKey && 'a',
        event.ctrlKey && 'c',
        event.metaKey && 'm',
        event.shiftKey && 's',
      ].filter(Boolean);
      return '<' + modifiers.join('-') + '-' + key.toLowerCase() + '>';
    }
    const names = {
      ' ': 'space',
      Enter: 'enter',
      Tab: 'tab',
      Backspace: 'backspace',
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    return names[key] ? '<' + names[key] + '>' : key;
  }
  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function protectUIKeys(event) {
    const owned = event.composedPath().some((node) => isOwned(node));
    const cycle = event.code || event.key;
    const tracked = uiKeyCycles.has(cycle);
    if (!owned && !tracked) return false;
    if (event.type === 'keydown' && owned) uiKeyCycles.add(cycle);
    if (event.type === 'keyup') uiKeyCycles.delete(cycle);
    // Retargeting exposes our shadow input as a DIV to website shortcuts.
    // Stop at window, but preserve native typing, editing and control defaults.
    event.stopImmediatePropagation();
    // A held Enter/Space must not activate a newly focused website control.
    if (tracked && !owned) event.preventDefault();
    if (event.type === 'keydown' && owned) {
      const composing = state.composing || event.isComposing || event.keyCode === 229;
      if (!composing && eventToken(event) === '<a-s-v>') {
        event.preventDefault();
        if (!event.repeat) toggleEnabled();
      } else {
        ui?.handleKeyDown(event);
      }
    }
    return true;
  }
  function onKey(event) {
    if (protectUIKeys(event)) return;
    if (state.composing || event.isComposing || event.keyCode === 229) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process'].includes(event.key))
      return;
    const token = eventToken(event);
    // The recovery chord is reserved, including inside controls and while paused.
    if (token === '<a-s-v>') {
      consume(event);
      if (!event.repeat) toggleEnabled();
      return;
    }
    if (!enabled()) return;
    const path = event.composedPath();
    if (state.mode === 'insert') {
      if (event.key === 'Escape') {
        consume(event);
        setMode('normal');
      }
      return;
    }
    if (path.some((node) => node?.nodeType === 1 && isEditable(node))) {
      clearSequence();
      return;
    }
    if (event.key === 'Escape') {
      if (ui.closeTopPanel()) {
        consume(event);
        return;
      }
      if (state.mode === 'find') {
        consume(event);
        textTools.findCancel();
        return;
      }
      if (state.mode === 'hints') {
        consume(event);
        exitHints();
        clearSequence();
        render();
        return;
      }
      if (TEXT_MODES.includes(state.mode)) {
        consume(event);
        textTools.exit();
        return;
      }
      if (state.keyPrefix || state.count) {
        consume(event);
        clearSequence();
        render();
        return;
      }
      if (state.hoverActive) {
        consume(event);
        hover.clear('escape');
      }
      return;
    }
    if (state.mode === 'hints') {
      handleHint(event);
      return;
    }
    if (state.mode === 'find') return;
    const activeMap = maps[state.mode] || {};
    if (!state.keyPrefix && /^\d$/.test(token) && (token !== '0' || state.count)) {
      consume(event);
      state.count = String(Math.min(999, Number(state.count + token)));
      clearTimeout(sequenceTimer);
      sequenceTimer = setTimeout(() => {
        clearSequence();
        render();
      }, 1500);
      render();
      return;
    }
    const sequence = state.keyPrefix + token;
    const id = activeMap[sequence];
    if (id) {
      consume(event);
      if (!event.repeat || /^(scroll|halfPage|move|word|line|doc)/.test(id))
        run(id, Number(state.count) || 1);
      return;
    }
    if (Object.keys(activeMap).some((key) => key.startsWith(sequence))) {
      consume(event);
      state.keyPrefix = sequence;
      clearTimeout(sequenceTimer);
      sequenceTimer = setTimeout(() => {
        clearSequence();
        render();
      }, 1500);
      render();
      return;
    }
    clearSequence();
    render();
  }
  try {
    const saved = GM_getValue(STORAGE_KEY, null);
    if (saved) config = validate(saved);
  } catch (error) {
    startupError = '設定未載入，暫用預設：' + error.message;
  }
  commands = buildCommands();
  maps = effectiveMaps(config, commands);
  textTools = createTextTools({
    mode: () => state.mode,
    setMode,
    notify,
    copyText,
    isEditable,
    isVisible,
    isOwned,
    getUIHost: () => ui?.getHost(),
    scrollFocus,
    setCaretRect,
    setFindUI: (value) => ui?.setFindUI(value),
  });
  hover = createHoverController({
    isOwned,
    parentElement,
    notify,
    isReachable: (target) => Boolean(hintVisible(target) && hitTest(target)),
    onChange: ({ active, label }) => {
      state.hoverActive = active;
      state.hoverLabel = label || '';
      render();
    },
  });
  ui = createNavigationUI({
    getSnapshot: snapshot,
    toggleEnabled,
    toggleSite,
    execute: (id) => run(id),
    saveConfig: applyConfig,
    resetConfig: () => applyConfig(clone(DEFAULTS)),
    saveUI,
    findInput: (value) => textTools.findInput(value),
    findCommit: () => textTools.findCommit(),
    findCancel: () => textTools.findCancel(),
  });
  function mount() {
    if (!document.body) return;
    ensureOverlay();
    ui.mount();
    render();
    if (startupError) {
      notify(startupError, 'error');
      startupError = '';
    } else if (!Object.values(maps.normal).includes('hintsHover')) {
      notify('Hover 目前未綁定；已保留既有客製鍵位，可在設定中為它指定按鍵。');
    }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keypress', protectUIKeys, true);
  window.addEventListener('keyup', protectUIKeys, true);
  window.addEventListener(
    'compositionstart',
    () => {
      clearTimeout(composingTimer);
      state.composing = true;
      clearSequence();
    },
    true
  );
  window.addEventListener(
    'compositionend',
    () => {
      composingTimer = setTimeout(() => {
        state.composing = false;
      }, 0);
    },
    true
  );
  window.addEventListener('blur', () => {
    uiKeyCycles.clear();
    clearSequence();
    state.composing = false;
    exitHints();
    render();
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.composedPath().some(isOwned))
        pointerTarget = event.composedPath().find((node) => node?.nodeType === 1);
    },
    true
  );
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target?.nodeType === 1 && !isOwned(event.target)) lastScrollTarget = event.target;
    },
    { capture: true, passive: true }
  );
  document.addEventListener('DOMContentLoaded', mount, { once: true });
  mount();
  GM_registerMenuCommand('切換本頁 Vim Navigation', toggleEnabled);
  GM_registerMenuCommand('切換本站預設啟用', toggleSite);
  GM_registerMenuCommand('Vim Navigation 設定', () => {
    mount();
    ui.openSettings();
  });
  GM_registerMenuCommand('顯示完整鍵位小抄', () => {
    mount();
    ui.toggleHelp();
  });
  GM_registerMenuCommand('重設小抄位置', () => saveUI({ position: null, collapsed: false }));
  if (typeof GM_addValueChangeListener === 'function')
    GM_addValueChangeListener(STORAGE_KEY, (_key, _old, value, remote) => {
      if (!remote) return;
      try {
        config = validate(value);
        commands = buildCommands();
        maps = effectiveMaps(config, commands);
        cancelTransient();
        render();
      } catch {
        notify('其他分頁的設定無效，維持目前設定', 'error');
      }
    });

  // Native, read-only text navigation and literal find. This factory owns no global API.

  function createTextTools(api) {
    'use strict';

    const TEXT_MODES = new Set(['caret', 'visual', 'line']);
    const SKIP =
      'script,style,noscript,template,input,textarea,select,option,button,[hidden],[inert]';
    const EDITORS =
      'input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],.monaco-editor,.CodeMirror,.cm-editor';
    const SEARCH_HIGHLIGHT = 'vim-nav-search';
    const CURRENT_HIGHLIGHT = 'vim-nav-search-current';
    const MAX_MATCHES = 5000;
    const MAX_INDEX_CHARS = 5000000;
    const MAX_MOTIONS = 1000;
    let lineAnchor = null;
    let lineFocus = null;
    let lineForward = true;
    let lastTextSelection = null;
    let destroyed = false;
    let caretFrame = 0;
    let generation = 0;
    let searchActive = false;
    let query = '';
    let matches = [];
    let matchIndex = -1;
    let searchBusy = false;
    let searchOriginal = null;
    let searchPreviousMode = 'normal';
    let pendingSearch = Promise.resolve();
    const textObserver = new MutationObserver((records) => {
      if (TEXT_MODES.has(api.mode()) && records.some((record) => !owned(record.target)))
        scheduleCaret();
    });

    const selection = () => window.getSelection();
    const point = (node, offset) => ({ node, offset });
    const focusPoint = (sel) => point(sel.focusNode, sel.focusOffset);
    const anchorPoint = (sel) => point(sel.anchorNode, sel.anchorOffset);
    const samePoint = (a, b) => a && b && a.node === b.node && a.offset === b.offset;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

    function owned(node) {
      const host = api.getUIHost();
      return Boolean(api.isOwned?.(node) || (host && (node === host || host.contains(node))));
    }

    function readable(node, viewportOnly = false) {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return Boolean(
        el &&
        el.isConnected &&
        el.getRootNode() === document &&
        !owned(el) &&
        !el.closest(SKIP) &&
        !api.isEditable(el) &&
        !el.closest('[contenteditable]:not([contenteditable="false"])') &&
        api.isVisible(el, viewportOnly)
      );
    }

    function validPoint(p) {
      if (!p?.node || !p.node.isConnected || p.node.getRootNode() !== document || owned(p.node))
        return false;
      const length =
        p.node.nodeType === Node.TEXT_NODE ? p.node.data.length : p.node.childNodes.length;
      return Number.isInteger(p.offset) && p.offset >= 0 && p.offset <= length && readable(p.node);
    }

    function snapshot() {
      const sel = selection();
      if (!sel?.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
      return { anchor: anchorPoint(sel), focus: focusPoint(sel) };
    }

    function applyPoints(anchor, focus = anchor) {
      if (!validPoint(anchor) || !validPoint(focus)) return false;
      selection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      return true;
    }

    function restore(saved, clearWhenEmpty = false) {
      if (saved && applyPoints(saved.anchor, saved.focus)) return true;
      if (clearWhenEmpty && !saved) selection()?.removeAllRanges();
      return false;
    }

    function comparePoints(a, b) {
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.collapse(true);
      return range.comparePoint(b.node, b.offset) === -1 ? 1 : samePoint(a, b) ? 0 : -1;
    }

    function textWalker(root = document.body) {
      return document.createTreeWalker(root || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          readable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
    }

    function endpoint(last = false) {
      const walker = textWalker();
      let found = null;
      let node;
      while ((node = walker.nextNode())) {
        if (!node.data.trim()) continue;
        found = point(node, last ? node.data.length : node.data.search(/\S/u));
        if (!last) break;
      }
      return found;
    }

    function seedPoint() {
      const scopes = [...document.querySelectorAll('main,article'), document.body].filter(Boolean);
      let fallback = null;
      for (const scope of scopes) {
        const walker = textWalker(scope);
        let node;
        while ((node = walker.nextNode())) {
          const offset = node.data.search(/\S/u);
          if (offset < 0 || !readable(node, true)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (
            ![...range.getClientRects()].some(
              (rect) =>
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < innerHeight &&
                rect.right > 0 &&
                rect.left < innerWidth
            )
          )
            continue;
          fallback ||= point(node, offset);
          if (node.data.trim().length >= 24) return point(node, offset);
        }
        if (fallback) return fallback;
      }
      return null;
    }

    function firstReadablePoint(element) {
      if (!readable(element)) return null;
      const walker = textWalker(element);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.data.search(/\S/u);
        if (offset < 0) continue;
        const start = point(node, offset);
        if (validPoint(start)) return start;
      }
      return null;
    }

    // A visible paragraph owns its true start, even when that start is above the
    // viewport. Containers only substitute for missing finer reading blocks.
    function caretTargets() {
      if (destroyed) return [];
      const fineSelector = 'p,h1,h2,h3,h4,h5,h6,pre';
      const fallbackSelector = 'li,blockquote,td,th';
      const starts = new WeakMap();
      const hasFineBlock = new WeakSet();
      const elements = [...document.querySelectorAll(`${fineSelector},${fallbackSelector}`)];
      for (const element of elements) {
        const start = firstReadablePoint(element);
        if (!start) continue;
        starts.set(element, start);
        if (!element.matches(fineSelector)) continue;
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.matches(fallbackSelector)) hasFineBlock.add(ancestor);
        }
      }
      return elements
        .filter(
          (element) =>
            starts.has(element) &&
            readable(element, true) &&
            (element.matches(fineSelector) || !hasFineBlock.has(element))
        )
        .map((element) => ({ element, point: starts.get(element) }));
    }

    function selectionVisible(saved) {
      if (!saved || !validPoint(saved.anchor) || !validPoint(saved.focus)) return false;
      const range = selection().getRangeAt(0);
      return [...range.getClientRects()].some(
        (rect) =>
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.right >= 0 &&
          rect.left < innerWidth &&
          rect.height > 0
      );
    }

    function selectionWithinReadingText() {
      const sel = selection();
      if (!sel?.rangeCount) return true;
      if (!validPoint(anchorPoint(sel)) || !validPoint(focusPoint(sel))) return false;
      if (sel.isCollapsed) return true;
      const range = sel.getRangeAt(0);
      const controls = document.querySelectorAll(EDITORS);
      for (const control of controls) {
        if (!owned(control) && api.isVisible(control) && range.intersectsNode(control))
          return false;
      }
      return true;
    }

    function nativeAvailable() {
      if (typeof selection()?.modify === 'function') return true;
      api.notify('這個瀏覽器不支援文字游標移動；仍可用滑鼠選取後複製。', 'warning');
      return false;
    }

    function clipCaret(rect, node) {
      let left = Math.max(0, rect.left);
      let right = Math.min(innerWidth, rect.left + rect.width);
      let top = Math.max(0, rect.top);
      let bottom = Math.min(innerHeight, rect.top + rect.height);
      for (
        let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        el && el !== document.documentElement;
        el = el.parentElement
      ) {
        const style = getComputedStyle(el);
        const clipsX = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX);
        const clipsY = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const bounds = el.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, bounds.left + el.clientLeft);
          right = Math.min(right, bounds.left + el.clientLeft + el.clientWidth);
        }
        if (clipsY) {
          top = Math.max(top, bounds.top + el.clientTop);
          bottom = Math.min(bottom, bounds.top + el.clientTop + el.clientHeight);
        }
      }
      return right > left && bottom > top
        ? { left, top, width: right - left, height: bottom - top }
        : null;
    }

    function caretRect() {
      const sel = selection();
      if (!sel?.rangeCount || !validPoint(focusPoint(sel))) return null;
      const range = document.createRange();
      range.setStart(sel.focusNode, sel.focusOffset);
      range.collapse(true);
      let rect = range.getBoundingClientRect();
      if (!rect.height && sel.focusNode.nodeType === Node.TEXT_NODE && sel.focusNode.length) {
        const length = sel.focusNode.length;
        const atEnd = sel.focusOffset >= length;
        range.setStart(sel.focusNode, Math.min(sel.focusOffset, length - 1));
        range.setEnd(sel.focusNode, Math.min(length, sel.focusOffset + 1));
        rect = range.getBoundingClientRect();
        return rect.height
          ? clipCaret(
              {
                left: atEnd ? rect.right : rect.left,
                top: rect.top,
                width: 2,
                height: rect.height,
              },
              sel.focusNode
            )
          : null;
      }
      return rect.height
        ? clipCaret(
            { left: rect.left, top: rect.top, width: 2, height: rect.height },
            sel.focusNode
          )
        : null;
    }

    function refreshCaret() {
      caretFrame = 0;
      if (
        !destroyed &&
        TEXT_MODES.has(api.mode()) &&
        lastTextSelection &&
        (!validPoint(lastTextSelection.anchor) || !validPoint(lastTextSelection.focus))
      ) {
        exit();
        api.notify('頁面文字已變更，請重新選取。', 'warning');
        return;
      }
      if (!destroyed) api.setCaretRect?.(api.mode() === 'caret' ? caretRect() : null);
    }

    function watchText() {
      textObserver.disconnect();
      if (document.documentElement)
        textObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function scheduleCaret() {
      if (!caretFrame && !destroyed) caretFrame = requestAnimationFrame(refreshCaret);
    }

    function scrollToFocus() {
      const sel = selection();
      if (!sel?.rangeCount || !validPoint(focusPoint(sel))) return;
      const range = document.createRange();
      range.setStart(sel.focusNode, sel.focusOffset);
      range.collapse(true);
      api.scrollFocus(range);
      refreshCaret();
    }

    // Probe a native movement with a collapsed selection; callers restore their anchor.
    function probe(from, direction, granularity) {
      const sel = selection();
      if ((!sel.isCollapsed || !samePoint(focusPoint(sel), from)) && !applyPoints(from))
        return from;
      selection().modify('move', direction, granularity);
      const next = focusPoint(selection());
      return validPoint(next) ? next : from;
    }

    function nextCharacter(from) {
      if (!applyPoints(from)) return '';
      selection().modify('extend', 'forward', 'character');
      const text = selection().toString();
      applyPoints(from);
      return text;
    }

    function nativeMotion(from, motion) {
      if (motion === 'docStart' || motion === 'docEnd')
        return endpoint(motion === 'docEnd') || from;
      const mappings = {
        left: ['backward', 'character'],
        right: ['forward', 'character'],
        up: ['backward', 'line'],
        down: ['forward', 'line'],
        wordEnd: ['forward', 'word'],
        wordPrev: ['backward', 'word'],
        lineStart: ['backward', 'lineboundary'],
        lineEnd: ['forward', 'lineboundary'],
      };
      if (motion === 'wordNext') {
        let next = probe(from, 'forward', 'word');
        // Native word boundaries handle Chinese and punctuation; skip only trailing whitespace.
        for (let i = 0; i < MAX_MOTIONS; i++) {
          const text = nextCharacter(next);
          if (!text || !/^\s+$/u.test(text)) break;
          const after = probe(next, 'forward', 'character');
          if (samePoint(after, next)) break;
          next = after;
        }
        return next;
      }
      return mappings[motion] ? probe(from, ...mappings[motion]) : from;
    }

    function renderLine() {
      if (!validPoint(lineAnchor) || !validPoint(lineFocus)) return false;
      const order = comparePoints(lineAnchor, lineFocus);
      const forward = order === 0 ? lineForward : order < 0;
      lineForward = forward;
      const anchor = probe(lineAnchor, forward ? 'backward' : 'forward', 'lineboundary');
      const focus = probe(lineFocus, forward ? 'forward' : 'backward', 'lineboundary');
      return applyPoints(anchor, focus);
    }

    function enter(kind) {
      if (!TEXT_MODES.has(kind) || destroyed || !nativeAvailable()) return false;
      const previous = snapshot();
      try {
        const saved = selectionVisible(previous) ? previous : null;
        const start = saved?.focus || seedPoint();
        if (!start) {
          api.notify('目前畫面沒有可選取的文字。', 'warning');
          return false;
        }
        if (kind === 'caret') applyPoints(start);
        else if (kind === 'line') {
          lineAnchor = saved?.anchor || start;
          lineFocus = start;
          lineForward = comparePoints(lineAnchor, lineFocus) <= 0;
          renderLine();
        } else if (saved && !samePoint(saved.anchor, saved.focus)) restore(saved);
        else {
          applyPoints(start);
          selection().modify('extend', 'forward', 'character');
          if (selection().isCollapsed) selection().modify('extend', 'backward', 'character');
        }
        if (!selectionWithinReadingText()) {
          restore(previous);
          api.notify('選取範圍跨過輸入區；請在同一段閱讀內容內選取。', 'warning');
          return false;
        }
        api.setMode(kind);
        lastTextSelection = snapshot();
        watchText();
        scrollToFocus();
        return true;
      } catch {
        restore(previous);
        api.notify('無法在這段文字啟用選取。', 'warning');
        return false;
      }
    }

    // Explicit hint entry deliberately bypasses selectionVisible/seedPoint.
    // A stale hint must never relocate the user to unrelated text.
    function enterAt(start, kind = 'caret') {
      if (destroyed || !TEXT_MODES.has(kind)) return false;
      if (!validPoint(start)) {
        exit();
        api.notify('這個文字起點已失效，請重新選擇。', 'warning');
        return false;
      }
      if (!nativeAvailable()) return false;
      const previous = snapshot();
      try {
        if (!applyPoints(start)) throw new Error('stale text point');
        if (kind === 'visual') {
          selection().modify('extend', 'forward', 'character');
          if (selection().isCollapsed) selection().modify('extend', 'backward', 'character');
        } else if (kind === 'line') {
          lineAnchor = point(start.node, start.offset);
          lineFocus = point(start.node, start.offset);
          lineForward = true;
          if (!renderLine()) throw new Error('unavailable line');
        }
        if (!selectionWithinReadingText()) throw new Error('outside reading text');
        api.setMode(kind);
        lastTextSelection = snapshot();
        watchText();
        scrollToFocus();
        return true;
      } catch {
        restore(previous);
        exit();
        api.notify('這個文字起點無法使用，請重新選擇。', 'warning');
        return false;
      }
    }

    function move(motion, count = 1) {
      const mode = api.mode();
      if (!TEXT_MODES.has(mode) || !nativeAvailable()) return false;
      const saved = snapshot();
      const previousLineFocus = lineFocus;
      if (
        !saved ||
        !validPoint(saved.anchor) ||
        !validPoint(saved.focus) ||
        (lastTextSelection &&
          (!validPoint(lastTextSelection.anchor) || !validPoint(lastTextSelection.focus))) ||
        (mode === 'line' && (!validPoint(lineAnchor) || !validPoint(lineFocus)))
      ) {
        exit();
        api.notify('頁面文字已變更，請重新選取。', 'warning');
        return false;
      }
      try {
        let focus = mode === 'line' ? lineFocus : saved.focus;
        const steps = Math.min(MAX_MOTIONS, Math.max(1, Math.floor(Number(count) || 1)));
        for (let i = 0; i < steps; i++) {
          const next = nativeMotion(focus, motion);
          if (samePoint(next, focus)) break;
          focus = next;
          if (motion === 'docStart' || motion === 'docEnd') break;
        }
        if (mode === 'line') {
          lineFocus = focus;
          renderLine();
        } else if (
          mode !== 'caret' ||
          !selection().isCollapsed ||
          !samePoint(focusPoint(selection()), focus)
        ) {
          applyPoints(mode === 'caret' ? focus : saved.anchor, focus);
        }
        if (!selectionWithinReadingText()) {
          lineFocus = previousLineFocus;
          restore(saved);
          api.notify('選取已到輸入區邊界。', 'info');
          return false;
        }
        lastTextSelection = snapshot();
        scrollToFocus();
        return true;
      } catch {
        lineFocus = previousLineFocus;
        restore(saved);
        api.notify('這個位置無法移動文字游標。', 'warning');
        return false;
      }
    }

    function reverse() {
      if (!TEXT_MODES.has(api.mode())) return false;
      const saved = snapshot();
      if (
        !saved ||
        !validPoint(saved.anchor) ||
        !validPoint(saved.focus) ||
        (lastTextSelection &&
          (!validPoint(lastTextSelection.anchor) || !validPoint(lastTextSelection.focus)))
      ) {
        exit();
        api.notify('頁面文字已變更，請重新選取。', 'warning');
        return false;
      }
      try {
        if (api.mode() === 'line') {
          [lineAnchor, lineFocus] = [lineFocus, lineAnchor];
          lineForward = !lineForward;
          renderLine();
        } else if (!applyPoints(saved.focus, saved.anchor)) return false;
        lastTextSelection = snapshot();
        scrollToFocus();
        return true;
      } catch {
        restore(saved);
        return false;
      }
    }

    async function copy(lines = false) {
      const saved = snapshot();
      const previousMode = api.mode();
      if (
        TEXT_MODES.has(previousMode) &&
        lastTextSelection &&
        (!validPoint(lastTextSelection.anchor) || !validPoint(lastTextSelection.focus))
      ) {
        exit();
        api.notify('頁面文字已變更，請重新選取。', 'warning');
        return false;
      }
      const copyGeneration = generation;
      let copiedSelection = null;
      const unchanged = () => {
        const current = snapshot();
        return (
          copyGeneration === generation &&
          api.mode() === previousMode &&
          copiedSelection &&
          current &&
          samePoint(copiedSelection.anchor, current.anchor) &&
          samePoint(copiedSelection.focus, current.focus)
        );
      };
      try {
        if (
          lines &&
          previousMode !== 'line' &&
          nativeAvailable() &&
          saved &&
          validPoint(saved.anchor) &&
          validPoint(saved.focus)
        ) {
          const forward = comparePoints(saved.anchor, saved.focus) <= 0;
          const low = forward ? saved.anchor : saved.focus;
          let high = forward ? saved.focus : saved.anchor;
          // A range's far endpoint is exclusive; an endpoint at the next line's start
          // must not add that unselected line to Y's expansion.
          if (!samePoint(low, high)) high = probe(high, 'backward', 'character');
          const start = probe(low, 'backward', 'lineboundary');
          const end = probe(high, 'forward', 'lineboundary');
          applyPoints(forward ? start : end, forward ? end : start);
        }
        if (!selectionWithinReadingText()) {
          restore(saved);
          api.notify('選取範圍跨過輸入區；請縮小選取範圍。', 'warning');
          return false;
        }
        const text = selection()?.toString() || '';
        if (!text) {
          api.notify('尚未選取文字；按 v 選取，或 Y 複製目前行。', 'warning');
          return false;
        }
        copiedSelection = snapshot();
        await api.copyText(text);
        if (TEXT_MODES.has(previousMode) && unchanged()) exit();
        api.notify(`已複製 ${text.length} 個字元`, 'success');
        return true;
      } catch {
        if (!copiedSelection || unchanged()) restore(saved);
        api.notify('複製失敗；選取內容已保留。', 'error');
        return false;
      }
    }

    function exit() {
      textObserver.disconnect();
      lineAnchor = null;
      lineFocus = null;
      lastTextSelection = null;
      api.setCaretRect?.(null);
      if (TEXT_MODES.has(api.mode())) api.setMode('normal');
    }

    function publishFind() {
      api.setFindUI({
        visible: searchActive,
        query,
        index: matchIndex < 0 ? 0 : matchIndex + 1,
        total: matches.length,
        busy: searchBusy,
      });
    }

    function removeHighlights() {
      if (!window.CSS?.highlights) return;
      CSS.highlights.delete(SEARCH_HIGHLIGHT);
      CSS.highlights.delete(CURRENT_HIGHLIGHT);
    }

    function drawHighlights() {
      removeHighlights();
      if (!window.CSS?.highlights || typeof window.Highlight !== 'function') return;
      if (matches.length)
        CSS.highlights.set(SEARCH_HIGHLIGHT, new Highlight(...matches.map((match) => match.range)));
      if (matches[matchIndex])
        CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(matches[matchIndex].range));
    }

    function blockOwner(node, cache) {
      let el = node.parentElement;
      const chain = [];
      let block = document.body;
      while (el) {
        if (cache.has(el)) {
          block = cache.get(el);
          break;
        }
        chain.push(el);
        const display = getComputedStyle(el).display;
        if (
          el === document.body ||
          !['inline', 'contents', 'inline-block', 'inline-flex', 'inline-grid'].includes(display)
        ) {
          block = el;
          break;
        }
        el = el.parentElement;
      }
      for (const item of chain) cache.set(item, block);
      return block;
    }

    function rangeFor(group, start, end) {
      const first = group.parts.find((part) => part.end > start);
      const last = group.parts.find((part) => part.end >= end && part.start < end);
      if (!first || !last || !first.node.isConnected || !last.node.isConnected) return null;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      return {
        range,
        start: point(first.node, start - first.start),
        end: point(last.node, end - last.start),
        text: range.toString(),
      };
    }

    function freshMatch(match) {
      return (
        match &&
        validPoint(match.start) &&
        validPoint(match.end) &&
        match.range.startContainer === match.start.node &&
        match.range.startOffset === match.start.offset &&
        match.range.endContainer === match.end.node &&
        match.range.endOffset === match.end.offset &&
        match.range.toString() === match.text
      );
    }

    function preferredIndex(found) {
      const origin = searchOriginal?.focus;
      if (validPoint(origin)) {
        const index = found.findIndex(
          (match) => match.range.comparePoint(origin.node, origin.offset) <= 0
        );
        if (index >= 0) return index;
      }
      const visible = found.findIndex((match) => {
        const rect = match.range.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      });
      return visible >= 0 ? visible : found.length ? 0 : -1;
    }

    async function runSearch(token, term) {
      const groups = [];
      const blocks = new WeakMap();
      let current = null;
      let totalChars = 0;
      let inspected = 0;
      let limited = false;
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                owned(node) ||
                node.matches(SKIP) ||
                api.isEditable(node) ||
                node.matches('[contenteditable]:not([contenteditable="false"])')
              ) {
                current = null;
                return NodeFilter.FILTER_REJECT;
              }
              return node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            if (readable(node)) return NodeFilter.FILTER_ACCEPT;
            current = null;
            return NodeFilter.FILTER_REJECT;
          },
        }
      );
      let node;
      while ((node = walker.nextNode())) {
        if (destroyed || token !== generation) return;
        if (node.nodeType !== Node.TEXT_NODE) {
          current = null;
          continue;
        }
        const owner = blockOwner(node, blocks);
        if (!current || current.owner !== owner) {
          current = { owner, text: '', parts: [] };
          groups.push(current);
        }
        if (totalChars + node.data.length > MAX_INDEX_CHARS) {
          limited = true;
          break;
        }
        current.parts.push({
          node,
          start: current.text.length,
          end: current.text.length + node.data.length,
        });
        current.text += node.data;
        totalChars += node.data.length;
        if (++inspected % 250 === 0) await pause();
      }
      if (destroyed || token !== generation) return;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'giu');
      const found = [];
      let work = 0;
      for (const group of groups) {
        if (destroyed || token !== generation) return;
        pattern.lastIndex = 0;
        let hit;
        while ((hit = pattern.exec(group.text))) {
          const match = rangeFor(group, hit.index, hit.index + hit[0].length);
          if (match) found.push(match);
          if (found.length >= MAX_MATCHES) {
            limited = true;
            break;
          }
          if (++work % 250 === 0) {
            await pause();
            if (destroyed || token !== generation) return;
          }
        }
        if (found.length >= MAX_MATCHES) break;
        if (++work % 250 === 0) await pause();
      }
      if (destroyed || token !== generation) return;
      matches = found;
      matchIndex = preferredIndex(found);
      searchBusy = false;
      drawHighlights();
      publishFind();
      if (limited)
        api.notify('頁面很大：搜尋已限制為前 500 萬字元、最多 5,000 筆結果。', 'warning');
    }

    function findInput(value) {
      query = String(value ?? '');
      const token = ++generation;
      matches = [];
      matchIndex = -1;
      searchBusy = Boolean(query);
      removeHighlights();
      publishFind();
      if (!query) {
        pendingSearch = Promise.resolve();
        return pendingSearch;
      }
      pendingSearch = runSearch(token, query).catch(() => {
        if (token !== generation || destroyed) return;
        searchBusy = false;
        publishFind();
        api.notify('無法搜尋目前的頁面文字。', 'warning');
      });
      return pendingSearch;
    }

    function openFind() {
      if (destroyed) return Promise.resolve();
      if (!searchActive) {
        searchOriginal = snapshot();
        searchPreviousMode = api.mode();
      }
      searchActive = true;
      textObserver.disconnect();
      api.setCaretRect?.(null);
      api.setMode('find');
      publishFind();
      return findInput(query);
    }

    async function selectedMatch(expectedGeneration = generation) {
      await pendingSearch;
      if (destroyed || expectedGeneration !== generation) return false;
      if (!matches.length) return false;
      if (!freshMatch(matches[matchIndex])) {
        const rebuild = findInput(query);
        expectedGeneration = generation;
        await rebuild;
        if (destroyed || expectedGeneration !== generation) return false;
        if (!freshMatch(matches[matchIndex])) return false;
      }
      const match = matches[matchIndex];
      if (!match || !applyPoints(match.start, match.end)) return false;
      api.scrollFocus(match.range);
      drawHighlights();
      return true;
    }

    async function findCommit() {
      if (!searchActive || destroyed) return false;
      await pendingSearch;
      if (!searchActive || destroyed) return false;
      if (!(await selectedMatch())) {
        if (!searchActive || destroyed) return false;
        api.notify(query ? '找不到符合的文字。' : '輸入要搜尋的文字。', 'warning');
        return false;
      }
      if (!searchActive || destroyed) return false;
      searchActive = false;
      api.setMode('normal');
      publishFind();
      return true;
    }

    function findCancel() {
      ++generation;
      searchBusy = false;
      const wasActive = searchActive;
      searchActive = false;
      const restored = !wasActive || restore(searchOriginal, true);
      removeHighlights();
      if (api.mode() === 'find')
        api.setMode(restored && TEXT_MODES.has(searchPreviousMode) ? searchPreviousMode : 'normal');
      if (TEXT_MODES.has(api.mode())) {
        lastTextSelection = snapshot();
        watchText();
      }
      publishFind();
      refreshCaret();
    }

    async function findNext(backwards = false) {
      if (!query) {
        api.notify('先按 / 輸入搜尋文字。', 'info');
        return false;
      }
      let operationGeneration = generation;
      await pendingSearch;
      if (destroyed || operationGeneration !== generation) return false;
      const nextIndex = matches.length
        ? (matchIndex + (backwards ? -1 : 1) + matches.length) % matches.length
        : -1;
      if (!matches.length || !freshMatch(matches[nextIndex])) {
        searchOriginal = snapshot();
        const rebuild = findInput(query);
        operationGeneration = generation;
        await rebuild;
        if (destroyed || operationGeneration !== generation) return false;
      } else {
        matchIndex = nextIndex;
      }
      if (!(await selectedMatch(operationGeneration))) {
        if (destroyed || operationGeneration !== generation) return false;
        api.notify('找不到符合的文字。', 'warning');
        return false;
      }
      publishFind();
      if (!searchActive) api.notify(`搜尋 ${matchIndex + 1} / ${matches.length}`);
      return true;
    }

    function clear() {
      ++generation;
      searchActive = false;
      searchBusy = false;
      matches = [];
      matchIndex = -1;
      removeHighlights();
      publishFind();
      exit();
      if (api.mode() === 'find') api.setMode('normal');
    }

    function destroy() {
      clear();
      destroyed = true;
      if (caretFrame) cancelAnimationFrame(caretFrame);
      document.removeEventListener('selectionchange', scheduleCaret);
      window.removeEventListener('scroll', scheduleCaret, true);
      window.removeEventListener('resize', scheduleCaret);
    }

    document.addEventListener('selectionchange', scheduleCaret);
    window.addEventListener('scroll', scheduleCaret, { capture: true, passive: true });
    window.addEventListener('resize', scheduleCaret, { passive: true });

    return {
      enter,
      enterAt,
      caretTargets,
      move,
      reverse,
      copy,
      exit,
      openFind,
      findInput,
      findCommit,
      findCancel,
      findNext,
      clear,
      destroy,
    };
  }

  // Synthetic hover is independent of keyboard mode. It never clicks, focuses,
  // moves the physical pointer, or establishes the browser's CSS :hover state.
  function createHoverController(api) {
    let current = null;
    let destroyed = false;
    let checkFrame = 0;
    let listening = false;

    const observer = new MutationObserver((records) => {
      if (current && records.some((record) => !api.isOwned(record.target))) scheduleCheck();
    });

    function ancestorPath(target) {
      const result = [];
      const seen = new Set();
      for (
        let element = target;
        element?.nodeType === Node.ELEMENT_NODE;
        element = api.parentElement(element)
      ) {
        if (seen.has(element)) break;
        seen.add(element);
        result.unshift(element);
      }
      return result;
    }

    function within(element, target) {
      if (!element || !target) return false;
      return ancestorPath(element).includes(target);
    }

    function usable(target) {
      if (
        !target ||
        target.nodeType !== Node.ELEMENT_NODE ||
        !target.isConnected ||
        target.ownerDocument !== document ||
        api.isOwned(target)
      )
        return false;
      try {
        return Boolean(api.isReachable(target));
      } catch {
        return false;
      }
    }

    function describe(target) {
      const root = target.getRootNode();
      const named = (target.getAttribute('aria-labelledby') || '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
        .trim();
      const value =
        named ||
        target.getAttribute('aria-label') ||
        target.getAttribute('title') ||
        target.getAttribute('alt') ||
        target.textContent ||
        target.getAttribute('role') ||
        target.localName;
      return value.replace(/\s+/gu, ' ').trim().slice(0, 100);
    }

    function coordinates(target, supplied) {
      const x = supplied?.x ?? supplied?.clientX;
      const y = supplied?.y ?? supplied?.clientY;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return {
          x: Math.max(0, Math.min(innerWidth - 1, x)),
          y: Math.max(0, Math.min(innerHeight - 1, y)),
        };
      }
      for (const rect of target.getClientRects()) {
        const left = Math.max(0, rect.left);
        const right = Math.min(innerWidth, rect.right);
        const top = Math.max(0, rect.top);
        const bottom = Math.min(innerHeight, rect.bottom);
        if (right > left && bottom > top) return { x: (left + right) / 2, y: (top + bottom) / 2 };
      }
      return null;
    }

    function send(element, type, position, relatedTarget = null) {
      if (!element?.isConnected || api.isOwned(element)) return false;
      const view = element.ownerDocument.defaultView || window;
      const pointer = type.startsWith('pointer');
      const enterLeave = type.endsWith('enter') || type.endsWith('leave');
      const Constructor = pointer ? view.PointerEvent : view.MouseEvent;
      if (typeof Constructor !== 'function') return true;
      const options = {
        bubbles: !enterLeave,
        cancelable: !enterLeave,
        composed: !enterLeave,
        view,
        detail: 0,
        clientX: position.x,
        clientY: position.y,
        button: pointer ? -1 : 0,
        buttons: 0,
        relatedTarget,
      };
      if (pointer)
        Object.assign(options, {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          width: 1,
          height: 1,
          pressure: 0,
        });
      element.dispatchEvent(new Constructor(type, options));
      return true;
    }

    function publish() {
      api.onChange({ active: Boolean(current), label: current?.label || '' });
    }

    function stopWatching() {
      observer.disconnect();
      if (checkFrame) cancelAnimationFrame(checkFrame);
      checkFrame = 0;
      if (!listening) return;
      window.removeEventListener('pointermove', physicalMove, true);
      window.removeEventListener('mousemove', physicalMove, true);
      window.removeEventListener('scroll', scheduleCheck, true);
      window.removeEventListener('resize', scheduleCheck);
      window.removeEventListener('pagehide', pageHide);
      listening = false;
    }

    function watch() {
      stopWatching();
      if (!current) return;
      const roots = new Set([document.documentElement]);
      for (const element of current.path) {
        const root = element.getRootNode();
        if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) roots.add(root);
      }
      for (const root of roots) {
        if (root)
          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'disabled'],
          });
      }
      window.addEventListener('pointermove', physicalMove, { capture: true, passive: true });
      window.addEventListener('mousemove', physicalMove, { capture: true, passive: true });
      window.addEventListener('scroll', scheduleCheck, { capture: true, passive: true });
      window.addEventListener('resize', scheduleCheck, { passive: true });
      window.addEventListener('pagehide', pageHide);
      listening = true;
    }

    // Keep common ancestors entered when moving between descendants. Out events
    // still bubble from the old leaf with the new leaf as relatedTarget.
    function leave(session, relatedTarget = null, retained = new Set()) {
      if (!session) return;
      if (session.pointerOver) send(session.target, 'pointerout', session.point, relatedTarget);
      for (const element of [...session.pointerEntered].reverse()) {
        if (!retained.has(element)) send(element, 'pointerleave', session.point, relatedTarget);
      }
      if (session.mouseOver) send(session.target, 'mouseout', session.point, relatedTarget);
      for (const element of [...session.mouseEntered].reverse()) {
        if (!retained.has(element)) send(element, 'mouseleave', session.point, relatedTarget);
      }
    }

    function clear(reason = 'manual', relatedTarget = null, bookkeepingOnly = false) {
      const previous = current;
      current = null;
      stopWatching();
      if (!previous) return false;
      if (!bookkeepingOnly) leave(previous, relatedTarget);
      publish();
      if (reason === 'invalid') api.notify('懸停目標已變更，請重新選擇。', 'info');
      return true;
    }

    function validateCurrent() {
      checkFrame = 0;
      if (current && !usable(current.target)) clear('invalid');
    }

    function scheduleCheck() {
      if (current && !checkFrame && !destroyed) checkFrame = requestAnimationFrame(validateCurrent);
    }

    function physicalMove(event) {
      if (!current || !event.isTrusted) return;
      const target =
        event.composedPath?.().find((node) => node?.nodeType === Node.ELEMENT_NODE) || event.target;
      // Browser-generated enter events have already established real hover here;
      // sending a synthetic leave would immediately undo the website's state.
      clear('pointer', target, within(target, current.target));
    }

    function pageHide() {
      clear('navigation');
    }

    function enter(target, suppliedPoint) {
      if (destroyed) return false;
      const position = usable(target) && coordinates(target, suppliedPoint);
      if (!position) {
        if (current?.target === target) clear('invalid');
        else api.notify('目前無法懸停這個目標，請重新選擇。', 'warning');
        return false;
      }
      if (current?.target === target) {
        current.point = position;
        send(target, 'pointermove', position);
        send(target, 'mousemove', position);
        scheduleCheck();
        return true;
      }

      const previous = current;
      const path = ancestorPath(target);
      const retained = new Set(previous?.path.filter((element) => path.includes(element)) || []);
      stopWatching();
      // A transition temporarily has no published owner, preventing stale checks.
      current = null;
      leave(previous, target, retained);
      if (!usable(target)) {
        leave(
          previous && {
            ...previous,
            pointerOver: false,
            mouseOver: false,
            pointerEntered: previous.pointerEntered.filter((element) => retained.has(element)),
            mouseEntered: previous.mouseEntered.filter((element) => retained.has(element)),
          }
        );
        if (previous) publish();
        api.notify('懸停目標已變更，請重新選擇。', 'warning');
        return false;
      }
      const session = {
        target,
        point: position,
        path,
        label: describe(target),
        pointerOver: false,
        mouseOver: false,
        pointerEntered: path.filter(
          (element) => retained.has(element) && previous?.pointerEntered.includes(element)
        ),
        mouseEntered: path.filter(
          (element) => retained.has(element) && previous?.mouseEntered.includes(element)
        ),
      };
      current = session;
      try {
        session.pointerOver = true;
        send(target, 'pointerover', position, previous?.target || null);
        for (const element of path) {
          if (!target.isConnected) break;
          if (session.pointerEntered.includes(element)) continue;
          session.pointerEntered.push(element);
          send(element, 'pointerenter', position, previous?.target || null);
        }
        if (!target.isConnected) {
          clear('invalid');
          return false;
        }
        session.mouseOver = true;
        send(target, 'mouseover', position, previous?.target || null);
        for (const element of path) {
          if (!target.isConnected) break;
          if (session.mouseEntered.includes(element)) continue;
          session.mouseEntered.push(element);
          send(element, 'mouseenter', position, previous?.target || null);
        }
        if (!target.isConnected) {
          clear('invalid');
          return false;
        }
        send(target, 'pointermove', position);
        send(target, 'mousemove', position);
        if (!target.isConnected) {
          clear('invalid');
          return false;
        }
        watch();
        publish();
        api.notify(`懸停：${session.label} · Esc 結束`, 'info');
        return true;
      } catch {
        clear('error');
        api.notify('無法模擬這個目標的懸停。', 'warning');
        return false;
      }
    }

    function getState() {
      return {
        active: Boolean(current),
        label: current?.label || '',
        target: current?.target || null,
      };
    }

    function destroy() {
      clear('destroy');
      destroyed = true;
    }

    return { enter, clear, getState, destroy };
  }

  function createNavigationUI(api) {
    let host;
    let shadow;
    let snapshot;
    let refs = {};
    let helpOpen = false;
    let helpPinned = false;
    let settingsOpen = false;
    let helpQuery = '';
    let findOpen = false;
    let findComposing = false;
    let uiComposing = false;
    let compositionTimer;
    let drag;
    let localPosition = null;
    let settingsScope = 'global';
    let settingsMode = 'normal';
    let previousFindFocus;
    let recentTimer;
    let recentStamp = 0;
    const modeNames = {
      normal: 'NORMAL',
      insert: 'INSERT',
      caret: 'CARET',
      visual: 'VISUAL',
      line: 'VISUAL LINE',
      hints: 'HINTS',
      find: 'FIND',
      disabled: 'PAUSED',
    };
    const modeDescriptions = {
      normal: '用鍵盤，慢慢熟悉每一頁。',
      insert: '網頁快捷鍵已放行 · Esc 返回',
      caret: '移動游標 · v 開始選取',
      visual: '延伸選取 · y 複製',
      line: '按畫面行選取 · y 複製',
      hints: '輸入提示字母 · Esc 取消',
      find: 'Enter 確認 · Esc 取消',
      disabled: '本頁已暫停 · 隨時一鍵恢復',
    };
    const styleText = `
      :host { all: initial; color-scheme: light dark; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif; --bg:#faf8f3; --paper:#fffefb; --ink:#272d29; --muted:#6f7972; --border:#dedfd6; --accent:#3c6b55; --accent-soft:#e6eee6; --shadow:0 16px 54px #25382b26,0 2px 8px #25382b12; --key:#f1f1e9; --danger:#b83f43; --code:"SFMono-Regular",Consolas,monospace; }
      :host([data-theme="dark"]) { --bg:#212622; --paper:#282e29; --ink:#edf1e9; --muted:#a9b3a9; --border:#444c43; --accent:#a4c8ab; --accent-soft:#364c3c; --shadow:0 16px 54px #0005,0 2px 8px #0003; --key:#343c34; --danger:#ffaaaa; color-scheme:dark; }
      :host([data-theme="light"]) { color-scheme:light; }
      @media (prefers-color-scheme: dark) { :host([data-theme="system"]) { --bg:#212622; --paper:#282e29; --ink:#edf1e9; --muted:#a9b3a9; --border:#444c43; --accent:#a4c8ab; --accent-soft:#364c3c; --shadow:0 16px 54px #0005,0 2px 8px #0003; --key:#343c34; --danger:#ffaaaa; } }
      *, *::before, *::after { box-sizing:border-box; }
      [hidden] { display:none !important; }
      button,input,select,textarea { font:inherit; color:inherit; }
      button { border:0; background:transparent; cursor:pointer; padding:5px 8px; border-radius:7px; line-height:1.35; }
      button:hover { background:var(--accent-soft); }
      button:disabled { opacity:.5; cursor:default; }
      button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      input,select,textarea { min-width:0; border:1px solid var(--border); background:var(--paper); border-radius:7px; padding:7px 9px; }
      input[type="checkbox"] { accent-color:var(--accent); }
      textarea { resize:vertical; width:100%; min-height:140px; font:12px/1.6 var(--code); }
      p { margin:8px 0; } h2,h3 { margin:0; font-size:inherit; } kbd { display:inline-block; min-width:23px; text-align:center; border:1px solid var(--border); border-bottom-width:2px; border-radius:5px; padding:1px 5px; background:var(--key); color:var(--ink); font:11px/1.6 var(--code); white-space:nowrap; }
      .surface { position:fixed; pointer-events:auto; background:var(--bg); border:1px solid var(--border); border-radius:15px; color:var(--ink); box-shadow:var(--shadow); }
      .card { left:18px; bottom:18px; width:302px; overflow:hidden; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); display:flex; flex-direction:column; }
      .card[data-mode="visual"], .card[data-mode="line"] { --accent:#946423; --accent-soft:#f5ecd9; }
      .card[data-mode="caret"] { --accent:#586aad; --accent-soft:#e9ecfa; }
      .card[data-mode="insert"], .card[data-mode="disabled"] { --accent:var(--muted); --accent-soft:var(--key); }
      :host([data-theme="dark"]) .card[data-mode="visual"],:host([data-theme="dark"]) .card[data-mode="line"] { --accent:#e9bf72; --accent-soft:#514634; }
      :host([data-theme="dark"]) .card[data-mode="caret"] { --accent:#b6c3fc; --accent-soft:#39415a; }
      @media (prefers-color-scheme:dark) { :host([data-theme="system"]) .card[data-mode="visual"],:host([data-theme="system"]) .card[data-mode="line"] { --accent:#e9bf72; --accent-soft:#514634; } :host([data-theme="system"]) .card[data-mode="caret"] { --accent:#b6c3fc; --accent-soft:#39415a; } }
      .header { display:flex; align-items:center; gap:8px; padding:12px 12px 9px; border-bottom:1px solid var(--border); }
      .drag-handle { flex:1; min-width:0; cursor:grab; touch-action:none; user-select:none; }
      .eyebrow { text-transform:uppercase; color:var(--muted); font:10px/1.4 var(--code); letter-spacing:.15em; }
      .brand { font-weight:700; letter-spacing:.015em; font-size:15px; }
      .brand small { font:10px var(--code); color:var(--muted); margin-left:6px; font-weight:400; }
      .icon { min-width:28px; min-height:28px; padding:4px; color:var(--muted); font-size:16px; }
      .mode { padding:10px 14px 9px; display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
      .badge { background:var(--accent-soft); color:var(--accent); border-radius:5px; padding:3px 6px; font:700 10px/1.3 var(--code); letter-spacing:.08em; }
      .mode-description { color:var(--muted); font-size:11px; }
      .card-body { overflow:auto; }
      .commands { padding:0 8px 8px; display:grid; gap:2px; }
      .command { display:flex; align-items:center; text-align:left; gap:12px; padding:6px; width:100%; }
      .command-key { flex:0 0 100px; display:flex; gap:4px; flex-wrap:wrap; }
      .command-label { color:var(--muted); font-size:12px; }
      .command.is-recent { background:var(--accent-soft); }
      .command.is-recent .command-label { color:var(--ink); }
      .prefix { margin:0 14px 7px; padding:8px 9px; border:1px solid var(--border); border-radius:8px; background:var(--paper); }
      .prefix-label { color:var(--muted); font-size:11px; margin-right:8px; }
      .footer { border-top:1px solid var(--border); padding:7px 8px; display:flex; align-items:center; gap:4px; }
      .footer button { font-size:11px; color:var(--muted); }
      .footer .toggle { color:var(--accent); margin-right:auto; }
      .status { padding:0 14px 9px; font-size:11px; color:var(--muted); overflow-wrap:anywhere; }
      .status[data-kind="error"] { color:var(--danger); }
      .practice-flow { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:0 14px 9px; padding-top:8px; border-top:1px solid var(--border); color:var(--muted); font-size:10px; }
      .practice-flow kbd { font-size:10px; }
      .hover-status { margin:0 14px 9px; padding:8px; border:1px solid var(--border); border-radius:8px; color:var(--muted); background:var(--paper); font-size:10px; }
      .hover-status strong { display:block; color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
      .panel { width:min(680px,calc(100vw - 32px)); max-height:calc(100vh - 40px); left:336px; bottom:18px; display:flex; flex-direction:column; overflow:hidden; }
      .panel-header { display:flex; align-items:center; gap:8px; padding:16px 18px 12px; border-bottom:1px solid var(--border); }
      .panel-title { flex:1; } .panel-title h2 { font-size:18px; line-height:1.5; } .panel-title p { color:var(--muted); font-size:11px; margin:2px 0 0; }
      .panel-body { overflow:auto; padding:16px 18px; }
      .search { width:100%; margin-bottom:14px; }
      .group { margin:0 0 17px; } .group:last-child { margin:0; }
      .group h3 { font-size:11px; letter-spacing:.08em; color:var(--accent); margin-bottom:5px; }
      .help-row { display:grid; grid-template-columns:140px 1fr auto; align-items:center; gap:12px; border-top:1px solid var(--border); padding:9px 2px; }
      .help-row:first-of-type { border-top:0; }
      .help-keys { display:flex; flex-wrap:wrap; gap:4px; }
      .help-key-groups { display:grid; gap:8px; }
      .help-key-mode { flex-basis:100%; color:var(--muted); font:9px/1.4 var(--code); }
      .help-mode { color:var(--muted); font:9px/1.4 var(--code); text-align:right; }
      .muted { color:var(--muted); font-size:12px; } .empty { padding:12px 4px; color:var(--muted); }
      .settings { left:auto; right:18px; width:min(660px,calc(100vw - 32px)); }
      .section { border-bottom:1px solid var(--border); padding-bottom:18px; margin-bottom:18px; } .section:last-child { border-bottom:0; padding-bottom:0; margin-bottom:0; }
      .section h3 { font-size:14px; margin-bottom:9px; }
      .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 12px; }
      .field { display:flex; flex-direction:column; gap:4px; font-size:12px; }
      .field > span { color:var(--muted); }
      .wide { grid-column:1 / -1; }
      .actions { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:10px; }
      .primary { background:var(--accent); color:var(--bg); padding:7px 11px; }
      .primary:hover { background:var(--accent); filter:brightness(1.1); }
      .outline { border:1px solid var(--border); }
      .feedback { font-size:12px; margin:8px 0; min-height:18px; color:var(--accent); overflow-wrap:anywhere; }
      .feedback[data-error="true"] { color:var(--danger); }
      .binding-list { max-height:150px; overflow:auto; margin-top:10px; }
      .binding-row { display:flex; gap:8px; align-items:center; padding:5px 0; border-top:1px solid var(--border); }
      .binding-row span { flex:1; font-size:12px; }
      .binding-row button { font-size:11px; }
      details { margin-top:12px; } summary { cursor:pointer; color:var(--muted); font-size:12px; }
      code { font-family:var(--code); font-size:11px; overflow-wrap:anywhere; }
      .find { left:50%; transform:translateX(-50%); top:18px; width:min(580px,calc(100vw - 24px)); display:flex; gap:8px; align-items:center; padding:10px; }
      .find-label { color:var(--accent); font:18px var(--code); padding-left:5px; }
      .find input { flex:1; width:0; }
      .find-count { color:var(--muted); font:11px var(--code); min-width:45px; text-align:center; }
      @media (max-width:1040px) { .panel:not(.settings) { left:auto; right:18px; } }
      @media (max-width:700px) { .panel,.panel.settings { left:8px; right:8px; bottom:8px; width:auto; max-height:calc(100vh - 16px); } .help-row { grid-template-columns:106px 1fr; gap:8px; } .help-mode { display:none; } .fields { grid-template-columns:1fr; } }
      @media (prefers-reduced-motion:no-preference) { button { transition:background-color .12s,color .12s; } }
    `;

    function el(tag, attrs = {}, children = []) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'onClick') node.addEventListener('click', value);
        else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
      }
      for (const child of [].concat(children)) {
        if (child != null)
          node.append(typeof child === 'string' ? document.createTextNode(child) : child);
      }
      return node;
    }
    function button(label, action, attrs = {}) {
      const node = el('button', { type: 'button', ...attrs, onClick: action }, label);
      // Mouse use of the controls must not collapse the page's text selection.
      node.addEventListener('pointerdown', (event) => event.preventDefault());
      return node;
    }
    function keyCap(key) {
      const display = key
        .replace(/<a-s-v>/gi, 'Alt ⇧ V')
        .replace(/<esc>/gi, 'Esc')
        .replace(/<enter>/gi, 'Enter')
        .replace(/<space>/gi, 'Space');
      return el('kbd', { text: display });
    }
    function labelField(label, control, wide = false) {
      if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
      return el('label', { class: `field${wide ? ' wide' : ''}` }, [
        el('span', { text: label }),
        control,
      ]);
    }
    function selectOptions(options, value) {
      const node = el('select');
      options.forEach(([id, label]) => node.append(el('option', { value: id, text: label })));
      node.value = value;
      return node;
    }
    function current() {
      return api.getSnapshot();
    }
    function configCopy() {
      return JSON.parse(JSON.stringify(current().config));
    }
    function isApplicable(command, mode) {
      return !command.modes || command.modes.includes(mode) || command.modes.includes('*');
    }
    function mode() {
      return snapshot.enabled ? snapshot.mode : 'disabled';
    }
    function displayKeys(command) {
      if (command.keysByMode) return [...new Set(Object.values(command.keysByMode).flat())];
      if (isApplicable(command, snapshot.mode)) return command.keys || [];
      const keys = command.keys || [];
      if (keys.length) return keys;
      const defaults = command.defaultKeys;
      if (Array.isArray(defaults)) return defaults;
      if (defaults && typeof defaults === 'object')
        return [...new Set(Object.values(defaults).flat())];
      return [];
    }
    function helpKeyCell(command) {
      const groups = new Map();
      for (const commandMode of command.modes || []) {
        const keys = command.keysByMode?.[commandMode] || displayKeys(command);
        const signature = JSON.stringify(keys);
        if (!groups.has(signature)) groups.set(signature, { keys, modes: [] });
        groups.get(signature).modes.push(commandMode);
      }
      if (!groups.size) groups.set('', { keys: displayKeys(command), modes: [] });
      const cell = el('div', { class: 'help-key-groups' });
      for (const group of groups.values()) {
        const row = el('div', { class: 'help-keys' });
        if (groups.size > 1)
          row.append(
            el('span', {
              class: 'help-key-mode',
              text: group.modes.map((name) => modeNames[name] || name).join(' / '),
            })
          );
        row.append(
          ...(group.keys.length
            ? group.keys.map(keyCap)
            : [el('span', { class: 'muted', text: '未綁定' })])
        );
        cell.append(row);
      }
      return cell;
    }
    function setFeedback(text, error = false) {
      if (!refs.feedback) return;
      refs.feedback.textContent = text;
      refs.feedback.dataset.error = String(error);
    }
    function save(candidate, message = '已儲存。') {
      try {
        const result = api.saveConfig(candidate);
        if (result && result.ok === false) {
          setFeedback(result.error || '設定無效，尚未套用。', true);
          return false;
        }
        snapshot = current();
        render(snapshot);
        setFeedback(message);
        return true;
      } catch (error) {
        setFeedback(error.message || String(error), true);
        return false;
      }
    }
    function clampPosition(position) {
      const width = refs.card?.offsetWidth || 302;
      const height = refs.card?.offsetHeight || 200;
      return {
        x: Math.max(8, Math.min(position.x, Math.max(8, innerWidth - width - 8))),
        y: Math.max(8, Math.min(position.y, Math.max(8, innerHeight - height - 8))),
      };
    }
    function positionCard() {
      if (!refs.card) return;
      const source = localPosition || snapshot?.config?.ui?.position;
      if (source && Number.isFinite(source.x) && Number.isFinite(source.y)) {
        const position = clampPosition(source);
        refs.card.style.left = `${position.x}px`;
        refs.card.style.top = `${position.y}px`;
        refs.card.style.bottom = 'auto';
      } else {
        refs.card.style.left = '18px';
        refs.card.style.top = 'auto';
        refs.card.style.bottom = '18px';
      }
    }
    function onResize() {
      positionCard();
    }
    function blurPanel(panel) {
      const focused = shadow?.activeElement;
      if (focused && panel?.contains(focused) && typeof focused.blur === 'function') focused.blur();
    }
    function closeHelp() {
      helpOpen = false;
      blurPanel(refs.help);
      refs.help.hidden = true;
    }
    function closeSettings() {
      settingsOpen = false;
      blurPanel(refs.settings);
      refs.settings.hidden = true;
    }
    function mount() {
      if (host) return;
      snapshot = current();
      host = el('div', {
        id: 'vim-navigation-ui',
        'data-theme': snapshot.config.theme || 'system',
      });
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
      shadow = host.attachShadow({ mode: 'open' });
      shadow.addEventListener(
        'compositionstart',
        () => {
          clearTimeout(compositionTimer);
          uiComposing = true;
        },
        true
      );
      shadow.addEventListener(
        'compositionend',
        () => {
          compositionTimer = setTimeout(() => {
            uiComposing = false;
          }, 0);
        },
        true
      );
      shadow.append(el('style', { text: styleText }));
      refs.card = el('aside', { class: 'surface card', 'aria-label': 'Vim Navigation 練習小抄' });
      const dragHandle = el(
        'div',
        {
          class: 'drag-handle',
          tabindex: '0',
          role: 'button',
          'aria-label': '拖曳小抄；使用方向鍵移動位置',
        },
        [
          el('div', { class: 'eyebrow', text: 'YOUR KEYBOARD COMPANION' }),
          el('div', { class: 'brand' }, ['Vim Navigation', el('small', { text: '02' })]),
        ]
      );
      dragHandle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const rect = refs.card.getBoundingClientRect();
        drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
        };
        dragHandle.setPointerCapture(event.pointerId);
      });
      dragHandle.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        localPosition = clampPosition({
          x: drag.left + event.clientX - drag.x,
          y: drag.top + event.clientY - drag.y,
        });
        positionCard();
      });
      const finishDrag = () => {
        if (!drag) return;
        drag = null;
        if (localPosition) {
          const position = localPosition;
          localPosition = null;
          api.saveUI({ position });
        }
      };
      dragHandle.addEventListener('pointerup', finishDrag);
      dragHandle.addEventListener('pointercancel', finishDrag);
      refs.dragHandle = dragHandle;
      refs.collapse = button('−', () => api.saveUI({ collapsed: !current().config.ui.collapsed }), {
        class: 'icon',
        'aria-label': '收合小抄',
      });
      refs.card.append(el('div', { class: 'header' }, [dragHandle, refs.collapse]));
      refs.badge = el('span', { class: 'badge' });
      refs.description = el('span', { class: 'mode-description' });
      refs.card.append(el('div', { class: 'mode' }, [refs.badge, refs.description]));
      refs.cardBody = el('div', { class: 'card-body' });
      refs.prefix = el('div', { class: 'prefix', hidden: '' });
      refs.commands = el('div', { class: 'commands' });
      refs.status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
      refs.practiceFlow = el('div', { class: 'practice-flow', 'aria-label': '文字選取練習流程' });
      refs.hoverStatus = el('div', {
        class: 'hover-status',
        role: 'status',
        'aria-live': 'polite',
        hidden: '',
      });
      refs.cardBody.append(
        refs.prefix,
        refs.commands,
        refs.practiceFlow,
        refs.hoverStatus,
        refs.status
      );
      refs.card.append(refs.cardBody);
      refs.toggle = button('', () => api.toggleEnabled(), { class: 'toggle' });
      refs.site = button('本站', () => api.toggleSite(), { title: '切換本站預設啟用狀態' });
      refs.card.append(
        el('div', { class: 'footer' }, [
          refs.toggle,
          refs.site,
          button('? 小抄', toggleHelp, { title: '完整指令小抄' }),
          button('設定', openSettings, { title: '鍵位、外觀與客製化' }),
        ])
      );
      shadow.append(refs.card);
      buildHelp();
      buildFind();
      (document.body || document.documentElement).append(host);
      window.addEventListener('resize', onResize);
      render(snapshot);
    }
    function render(next) {
      snapshot = next || current();
      if (!host) return;
      host.dataset.theme = snapshot.config.theme || 'system';
      const activeMode = mode();
      refs.card.dataset.mode = activeMode;
      host.dataset.mode = activeMode;
      host.dataset.hoverActive = String(Boolean(snapshot.hoverActive));
      refs.badge.textContent = modeNames[activeMode] || activeMode.toUpperCase();
      refs.description.textContent =
        activeMode === 'normal' && snapshot.hoverActive
          ? 'Hover 保持中 · Esc 清除'
          : modeDescriptions[activeMode] || 'Esc 返回';
      const collapsed = Boolean(snapshot.config.ui.collapsed);
      refs.cardBody.hidden = collapsed;
      refs.collapse.textContent = collapsed ? '+' : '−';
      refs.collapse.setAttribute('aria-label', collapsed ? '展開小抄' : '收合小抄');
      refs.collapse.setAttribute('aria-expanded', String(!collapsed));
      refs.toggle.textContent = snapshot.enabled ? '● 本頁啟用' : '○ 恢復本頁';
      refs.toggle.title = 'Alt+Shift+V · 僅切換目前頁面，重新載入後恢復本站預設';
      refs.toggle.setAttribute('aria-pressed', String(snapshot.enabled));
      refs.site.textContent = snapshot.siteEnabled === false ? '本站預設停用' : '本站';
      refs.site.setAttribute('aria-pressed', String(snapshot.siteEnabled !== false));
      refs.status.textContent =
        snapshot.status ||
        (snapshot.enabled ? '數字＋移動鍵，例如 5j。' : 'Alt ⇧ V 恢復 · 本站設定仍會保留');
      refs.status.dataset.kind = snapshot.statusKind || '';
      refs.prefix.replaceChildren();
      refs.prefix.hidden = !snapshot.prefix;
      if (snapshot.prefix)
        refs.prefix.append(
          el('span', { class: 'prefix-label', text: '已輸入' }),
          keyCap(snapshot.prefix)
        );
      renderContext();
      renderPracticeFlow();
      refs.hoverStatus.hidden = !snapshot.hoverActive;
      refs.hoverStatus.replaceChildren();
      if (snapshot.hoverActive)
        refs.hoverStatus.append(
          el('strong', { text: `模擬 hover · ${snapshot.hoverLabel || '目前目標'}` }),
          el('span', { text: 'Esc 清除 · 純 CSS :hover 或需要真實滑鼠事件的元件可能沒有反應。' })
        );
      if (snapshot.lastCommandTime && snapshot.lastCommandTime !== recentStamp) {
        recentStamp = snapshot.lastCommandTime;
        clearTimeout(recentTimer);
        recentTimer = setTimeout(
          () => {
            if (host) renderContext();
          },
          Math.max(0, 1850 - (Date.now() - recentStamp))
        );
      }
      if (helpOpen) renderHelpRows();
      positionCard();
    }
    function renderPracticeFlow() {
      refs.practiceFlow.hidden =
        !snapshot.enabled || snapshot.mode !== 'normal' || Boolean(snapshot.prefix);
      refs.practiceFlow.replaceChildren();
      if (refs.practiceFlow.hidden) return;
      const flowKey = (id, commandMode, fallback) => {
        const command = snapshot.commands.find((item) => item.id === id);
        const keys =
          command?.keysByMode?.[commandMode] ||
          (isApplicable(command || {}, snapshot.mode) ? command?.keys : []);
        return keys?.length
          ? keyCap(keys[0])
          : el('span', { text: fallback, title: '此步驟尚未綁定按鍵' });
      };
      refs.practiceFlow.append(
        el('span', { text: '文字練習' }),
        flowKey('hintsCaret', 'normal', '選點'),
        '→',
        flowKey('enterVisual', 'caret', '選取'),
        '→',
        el('span', { text: '移動' }),
        '→',
        flowKey('yank', 'visual', '複製')
      );
    }
    function renderContext() {
      refs.commands.replaceChildren();
      if (!snapshot.enabled) {
        refs.commands.append(
          el('p', {
            class: 'empty',
            text: '網頁的 keyboard shortcuts 可以直接使用。重新載入會套用本站預設。',
          })
        );
        return;
      }
      const activeMode = snapshot.mode;
      const sequence = snapshot.keyPrefix ?? (snapshot.prefix || '').replace(/^\d+/, '');
      const commands = (snapshot.commands || []).filter(
        (command) => command.keys?.length && isApplicable(command, activeMode)
      );
      let chosen = commands;
      if (sequence)
        chosen = commands.filter((command) => command.keys.some((key) => key.startsWith(sequence)));
      const rowLimit = activeMode === 'normal' && !sequence ? 7 : 8;
      if (!sequence && chosen.length > rowLimit) {
        // Prefer a balanced practice set using the registry's original keys;
        // remapping a command keeps it in the same place on the cheat sheet.
        const practiceKeys =
          activeMode === 'normal'
            ? ['j', 'f', 'zv', 'zh', 'yb', 'yc', 'i']
            : ['h', 'j', 'w', 'b', 'v', 'o', 'y', 'Y'];
        const rank = (command) => {
          const defaults = Array.isArray(command.defaultKeys) ? command.defaultKeys : [];
          const index = practiceKeys.findIndex((key) => defaults.includes(key));
          return index < 0 ? 100 : index;
        };
        chosen = [...chosen].sort((a, b) => rank(a) - rank(b));
      }
      chosen.slice(0, rowLimit).forEach((command) => {
        const keys = command.keys.filter((key) => !sequence || key.startsWith(sequence));
        const recent =
          snapshot.lastCommand === command.id &&
          (!snapshot.lastCommandTime || Date.now() - snapshot.lastCommandTime < 1800);
        const row = button(
          '',
          () => {
            blurPanel(refs.card);
            api.execute(command.id);
          },
          { class: `command${recent ? ' is-recent' : ''}`, title: command.label }
        );
        row.append(
          el('span', { class: 'command-key' }, keys.slice(0, 3).map(keyCap)),
          el('span', { class: 'command-label', text: command.label })
        );
        refs.commands.append(row);
      });
      if (!chosen.length)
        refs.commands.append(
          el('p', {
            class: 'empty',
            text:
              activeMode === 'insert'
                ? 'Esc 返回 Normal；輸入框與中文組字會自動受到保護。'
                : sequence
                  ? '等待後續按鍵 · Esc 取消'
                  : '按 ? 查看完整小抄。',
          })
        );
    }
    function buildHelp() {
      refs.help = el('section', {
        class: 'surface panel',
        role: 'dialog',
        'aria-label': '完整指令小抄',
        hidden: '',
      });
      refs.pin = button(
        '釘選',
        () => {
          helpPinned = !helpPinned;
          refs.pin.textContent = helpPinned ? '已釘選' : '釘選';
          refs.pin.setAttribute('aria-pressed', String(helpPinned));
        },
        { class: 'outline', 'aria-pressed': 'false', title: '釘選後，Esc 保留小抄並返回頁面操作' }
      );
      refs.help.append(
        el('div', { class: 'panel-header' }, [
          el('div', { class: 'panel-title' }, [
            el('div', { class: 'eyebrow', text: 'LEARN BY DOING' }),
            el('h2', { text: '讓每個按鍵都順手' }),
            el('p', { text: '查看目前生效鍵位 · 點選指令也能練習' }),
          ]),
          refs.pin,
          button('×', closeHelp, { class: 'icon', 'aria-label': '關閉完整小抄' }),
        ])
      );
      const body = el('div', { class: 'panel-body' });
      refs.helpSearch = el('input', {
        class: 'search',
        type: 'search',
        placeholder: '搜尋指令、鍵位或分類…',
        'aria-label': '搜尋指令',
      });
      refs.helpSearch.addEventListener('input', () => {
        helpQuery = refs.helpSearch.value;
        renderHelpRows();
      });
      refs.helpRows = el('div');
      body.append(refs.helpSearch, refs.helpRows);
      refs.help.append(body);
      shadow.append(refs.help);
    }
    function renderHelpRows() {
      refs.helpRows.replaceChildren();
      const query = helpQuery.trim().toLocaleLowerCase();
      const groups = new Map();
      for (const command of snapshot.commands || []) {
        const keys = displayKeys(command);
        if (
          query &&
          ![command.label, command.id, command.category, ...keys]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)
        )
          continue;
        const category = command.category || '其他操作';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(command);
      }
      for (const [category, commands] of groups) {
        const group = el('div', { class: 'group' }, el('h3', { text: category }));
        for (const command of commands) {
          const keys = displayKeys(command);
          const enabledHere = snapshot.enabled && isApplicable(command, snapshot.mode);
          const commandButton = button(
            command.label,
            () => {
              blurPanel(refs.help);
              api.execute(command.id);
            },
            { title: enabledHere ? command.id : '切換至適用模式後操作' }
          );
          commandButton.disabled = !enabledHere;
          const modeText = (command.modes || []).map((name) => modeNames[name] || name).join(' / ');
          group.append(
            el('div', { class: 'help-row' }, [
              helpKeyCell(command),
              commandButton,
              el('span', { class: 'help-mode', text: modeText }),
            ])
          );
        }
        refs.helpRows.append(group);
      }
      if (!groups.size)
        refs.helpRows.append(
          el('p', { class: 'empty', text: '沒有符合的指令。可用鍵位或部分名稱搜尋。' })
        );
    }
    function toggleHelp() {
      if (!host) mount();
      if (helpOpen) {
        closeHelp();
        return;
      }
      helpOpen = true;
      refs.help.hidden = false;
      if (helpOpen) {
        snapshot = current();
        renderHelpRows();
      }
    }
    function openSettings() {
      if (!host) mount();
      settingsOpen = true;
      buildSettings();
    }
    function buildSettings() {
      refs.settings?.remove();
      snapshot = current();
      const config = snapshot.config;
      refs.settings = el('section', {
        class: 'surface panel settings',
        role: 'dialog',
        'aria-label': 'Vim Navigation 設定',
      });
      refs.settings.append(
        el('div', { class: 'panel-header' }, [
          el('div', { class: 'panel-title' }, [
            el('div', { class: 'eyebrow', text: 'MAKE IT YOURS' }),
            el('h2', { text: '把操作調成你的習慣' }),
            el('p', { text: snapshot.origin }),
          ]),
          button('×', closeSettings, { class: 'icon', 'aria-label': '關閉設定' }),
        ])
      );
      const body = el('div', { class: 'panel-body' });
      refs.feedback = el('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
      body.append(refs.feedback);
      const common = el('section', { class: 'section' }, el('h3', { text: '日常偏好' }));
      const theme = selectOptions(
        [
          ['system', '跟隨系統'],
          ['light', '米白'],
          ['dark', '石墨'],
        ],
        config.theme
      );
      const step = el('input', {
        type: 'number',
        min: '8',
        max: '1000',
        value: config.scrollStep,
        'aria-label': '單步捲動像素',
      });
      const chars = el('input', {
        type: 'text',
        value: config.hintChars,
        spellcheck: 'false',
        'aria-label': '提示字母',
      });
      const detectionOptions = [
        ['precise', '精準'],
        ['broad', '廣泛（預設）'],
        ['aggressive', '積極'],
      ];
      const globalDetection = selectOptions(detectionOptions, config.hintDetection || 'broad');
      const siteDetection = selectOptions(
        [['', '沿用全域'], ...detectionOptions],
        config.sites?.[snapshot.origin]?.hintDetection || ''
      );
      const siteEnabled = el('input', { type: 'checkbox', 'aria-label': '本站預設啟用' });
      siteEnabled.checked = snapshot.siteEnabled !== false;
      common.append(
        el('div', { class: 'fields' }, [
          labelField('外觀', theme),
          labelField('單步捲動（px）', step),
          labelField('提示字母（不可重複）', chars),
          labelField('全域提示偵測', globalDetection),
          labelField('本站提示偵測', siteDetection),
          el('label', { class: 'field' }, [
            el('span', { text: '本站預設' }),
            el('span', {}, [siteEnabled, ' 啟用 Vim Navigation']),
          ]),
        ])
      );
      common.append(
        el('div', { class: 'actions' }, [
          button(
            '儲存偏好',
            () => {
              const next = configCopy();
              next.theme = theme.value;
              next.scrollStep = Number(step.value);
              next.hintChars = chars.value;
              next.hintDetection = globalDetection.value;
              next.sites ||= {};
              next.sites[snapshot.origin] = {
                ...next.sites[snapshot.origin],
                enabled: siteEnabled.checked,
              };
              if (siteDetection.value)
                next.sites[snapshot.origin].hintDetection = siteDetection.value;
              else delete next.sites[snapshot.origin].hintDetection;
              save(next, '偏好已儲存。本站預設在重新載入後生效，本頁也可用切換鈕調整。');
            },
            { class: 'primary' }
          ),
          button(
            '重設小抄位置',
            () => {
              localPosition = null;
              api.saveUI({ position: null, collapsed: false });
              positionCard();
            },
            { class: 'outline' }
          ),
        ])
      );
      common.append(
        el('p', {
          class: 'muted',
          text: '精準較少雜訊；廣泛涵蓋常見自訂控制項；積極會增加提示，也較可能包含無效目標。Alt+Shift+V 切換本頁；i 暫時放行網站快捷鍵，Esc 返回。瀏覽器保留的快捷鍵可能無法覆寫。',
        })
      );
      body.append(common);
      buildBindingsSection(body);
      buildCustomSection(body);
      const jsonSection = el('section', { class: 'section' }, el('h3', { text: '備份與進階設定' }));
      const json = el('textarea', { 'aria-label': '設定 JSON', spellcheck: 'false' });
      json.value = JSON.stringify(config, null, 2);
      jsonSection.append(
        json,
        el('div', { class: 'actions' }, [
          button(
            '套用 JSON',
            () => {
              try {
                if (save(JSON.parse(json.value), 'JSON 已驗證並套用。')) {
                  buildSettings();
                  setFeedback('JSON 已驗證並套用。');
                }
              } catch (error) {
                setFeedback(`JSON 格式錯誤：${error.message}`, true);
              }
            },
            { class: 'primary' }
          ),
          button(
            '載入目前設定',
            () => {
              json.value = JSON.stringify(current().config, null, 2);
              setFeedback('已載入目前設定。');
            },
            { class: 'outline' }
          ),
          button(
            '下載 JSON',
            () => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(current().config, null, 2)], { type: 'application/json' })
              );
              const anchor = el('a', { href: url, download: 'vim-navigation-settings.json' });
              shadow.append(anchor);
              anchor.click();
              anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setFeedback('已匯出目前設定。');
            },
            { class: 'outline' }
          ),
          button(
            '還原全部預設',
            () => {
              api.resetConfig();
              localPosition = null;
              buildSettings();
              setFeedback('已還原預設；客製鍵位與本站設定已清除。');
            },
            { class: 'outline' }
          ),
        ])
      );
      jsonSection.append(
        el('p', {
          class: 'muted',
          text: '設定保存於 userscript manager，更新腳本會保留。匯入會先完整驗證；錯誤時不會覆蓋現有設定。JSON 僅儲存宣告式設定，不執行 JavaScript。',
        })
      );
      body.append(jsonSection);
      refs.settings.append(body);
      shadow.append(refs.settings);
    }
    function buildBindingsSection(body) {
      const section = el(
        'section',
        { class: 'section' },
        el('h3', { text: '鍵位 · 可全域或只改本站' })
      );
      const scope = selectOptions(
        [
          ['global', '全域'],
          ['site', '僅目前網站'],
        ],
        settingsScope
      );
      const modeSelect = selectOptions(
        [
          ['normal', 'Normal'],
          ['caret', 'Caret'],
          ['visual', 'Visual'],
          ['line', 'Visual Line'],
        ],
        settingsMode
      );
      const commandSelect = selectOptions([['', '解除此鍵綁定']], '');
      const keyInput = el('input', {
        type: 'text',
        placeholder: '例如 gg 或 <a-x>',
        spellcheck: 'false',
        'aria-label': '按鍵序列',
      });
      const list = el('div', { class: 'binding-list' });
      const populate = () => {
        const commands = current().commands.filter((command) =>
          isApplicable(command, settingsMode)
        );
        commandSelect.replaceChildren(el('option', { value: '', text: '解除此鍵綁定' }));
        commands.forEach((command) =>
          commandSelect.append(
            el('option', { value: command.id, text: `${command.label} · ${command.id}` })
          )
        );
        list.replaceChildren();
        const cfg = current().config;
        const overrides =
          settingsScope === 'global'
            ? cfg.bindings?.[settingsMode]
            : cfg.sites?.[current().origin]?.bindings?.[settingsMode];
        Object.entries(overrides || {}).forEach(([key, id]) => {
          const label =
            id === null
              ? '已解除綁定'
              : current().commands.find((command) => command.id === id)?.label || id;
          list.append(
            el('div', { class: 'binding-row' }, [
              keyCap(key),
              el('span', { text: label }),
              button('恢復繼承', () => {
                const next = configCopy();
                const bindings =
                  settingsScope === 'global'
                    ? next.bindings
                    : next.sites?.[current().origin]?.bindings;
                if (bindings?.[settingsMode]) delete bindings[settingsMode][key];
                if (save(next, '已移除覆寫，恢復繼承鍵位。')) populate();
              }),
            ])
          );
        });
        if (!list.childNodes.length)
          list.append(el('p', { class: 'muted', text: '尚無覆寫，使用繼承鍵位。' }));
      };
      scope.addEventListener('change', () => {
        settingsScope = scope.value;
        populate();
      });
      modeSelect.addEventListener('change', () => {
        settingsMode = modeSelect.value;
        populate();
      });
      section.append(
        el('div', { class: 'fields' }, [
          labelField('作用範圍', scope),
          labelField('模式', modeSelect),
          labelField('按鍵序列', keyInput),
          labelField('指令', commandSelect),
        ])
      );
      section.append(
        el(
          'div',
          { class: 'actions' },
          button(
            '儲存鍵位',
            () => {
              const key = keyInput.value.trim();
              if (!key) {
                setFeedback('請輸入一個按鍵序列。', true);
                return;
              }
              const next = configCopy();
              let bindings = (next.bindings ||= {});
              if (settingsScope === 'site') {
                next.sites ||= {};
                const site = (next.sites[current().origin] ||= {
                  enabled: current().siteEnabled !== false,
                });
                bindings = site.bindings ||= {};
              }
              (bindings[settingsMode] ||= {})[key] = commandSelect.value || null;
              if (save(next, '鍵位已儲存，小抄會顯示目前生效設定。')) populate();
            },
            { class: 'primary' }
          )
        )
      );
      section.append(
        el('p', {
          class: 'muted',
          text: '每次編輯一個序列；大小寫不同，例如 j 與 J。特殊鍵使用 <enter>、<tab>；修飾鍵例如 <a-x>（Alt+X）。Esc、數字前綴及 Alt+Shift+V 恢復鍵由系統保留。改鍵會新增或覆寫該鍵；要移走原鍵，另將原鍵設為「解除此鍵綁定」。',
        }),
        list
      );
      populate();
      body.append(section);
    }
    function buildCustomSection(body) {
      const section = el('section', { class: 'section' }, el('h3', { text: '網站專用動作' }));
      section.append(
        el('p', {
          class: 'muted',
          text: '以 CSS selector 指向目標，選擇操作，再在上方綁定按鍵。多個符合元素會顯示提示供你選擇。',
        })
      );
      const label = el('input', { type: 'text', placeholder: '例如：複製程式碼' });
      const action = selectOptions(
        [
          ['click', '點擊'],
          ['focus', '聚焦'],
          ['scroll', '捲入視野'],
          ['copy', '複製文字'],
          ['hover', '模擬 hover'],
        ],
        'click'
      );
      const hoverNote = el('p', {
        class: 'muted',
        id: 'vim-navigation-hover-note',
        hidden: '',
        text: '模擬 hover 會送出網頁事件；純 CSS :hover 或需要真實滑鼠事件的元件可能沒有反應。Esc 可清除目前狀態。',
      });
      action.setAttribute('aria-describedby', 'vim-navigation-hover-note');
      action.addEventListener('change', () => {
        hoverNote.hidden = action.value !== 'hover';
      });
      const selector = el('input', {
        type: 'text',
        placeholder: '例如 main pre',
        spellcheck: 'false',
      });
      const origin = selectOptions(
        [
          ['site', '只在目前網站'],
          ['global', '所有網站'],
        ],
        'site'
      );
      section.append(
        el('div', { class: 'fields' }, [
          labelField('動作名稱', label),
          labelField('操作', action),
          labelField('CSS selector', selector),
          labelField('作用範圍', origin),
        ])
      );
      section.append(hoverNote);
      section.append(
        el(
          'div',
          { class: 'actions' },
          button(
            '新增動作',
            () => {
              if (!label.value.trim() || !selector.value.trim()) {
                setFeedback('請填入動作名稱與 CSS selector。', true);
                return;
              }
              const next = configCopy();
              const custom = {
                id: `custom:action-${Date.now().toString(36)}`,
                label: label.value.trim(),
                action: action.value,
                selector: selector.value.trim(),
              };
              if (origin.value === 'site') custom.origin = current().origin;
              (next.customActions ||= []).push(custom);
              if (save(next)) {
                buildSettings();
                setFeedback('已新增動作，可在「鍵位」中選取它並綁定。');
              }
            },
            { class: 'primary' }
          )
        )
      );
      const list = el('div', { class: 'binding-list' });
      for (const custom of current().config.customActions || []) {
        list.append(
          el('div', { class: 'binding-row' }, [
            el('span', {}, [
              el('strong', { text: custom.label }),
              el('br'),
              el('code', { text: `${custom.action} · ${custom.selector}` }),
              el('br'),
              el('small', { class: 'muted', text: custom.origin || '所有網站' }),
            ]),
            button('移除', () => {
              const next = configCopy();
              next.customActions = next.customActions.filter((item) => item.id !== custom.id);
              const removeReferences = (bindings) => {
                for (const mapping of Object.values(bindings || {}))
                  for (const [key, id] of Object.entries(mapping))
                    if (id === custom.id) mapping[key] = null;
              };
              removeReferences(next.bindings);
              Object.values(next.sites || {}).forEach((site) => removeReferences(site.bindings));
              if (save(next)) {
                buildSettings();
                setFeedback('已移除動作與相關鍵位綁定。');
              }
            }),
          ])
        );
      }
      section.append(list);
      const details = el('details', {}, [
        el('summary', { text: 'JSON 設定範例' }),
        el('p', {
          class: 'muted',
          text: 'customActions 新增動作後，在 bindings.normal 用相同 id 綁鍵。未指定 origin 即適用所有網站。',
        }),
        el('code', {
          text: '{"id":"custom:copy-code","label":"複製程式碼","action":"copy","selector":"main pre","origin":"https://example.com"}',
        }),
        el('p', {}, el('code', { text: '"bindings": {"normal": {"zp": "custom:copy-code"}}' })),
      ]);
      section.append(details);
      body.append(section);
    }
    function buildFind() {
      refs.find = el('form', {
        class: 'surface find',
        hidden: '',
        role: 'search',
        'aria-label': '頁內搜尋',
      });
      refs.findInput = el('input', {
        type: 'search',
        placeholder: '搜尋此頁文字…',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': '搜尋此頁文字',
      });
      refs.findCount = el('span', { class: 'find-count', 'aria-live': 'polite' });
      refs.findInput.addEventListener('compositionstart', () => {
        findComposing = true;
      });
      refs.findInput.addEventListener('compositionend', () => {
        findComposing = false;
        api.findInput(refs.findInput.value);
      });
      refs.findInput.addEventListener('input', (event) => {
        if (!findComposing && !event.isComposing) api.findInput(refs.findInput.value);
      });
      refs.find.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!uiComposing && !findComposing) api.findCommit();
      });
      refs.find.append(
        el('span', { class: 'find-label', 'aria-hidden': 'true', text: '/' }),
        refs.findInput,
        refs.findCount,
        button('↵', () => api.findCommit(), { class: 'icon', 'aria-label': '確認搜尋' }),
        button('×', () => api.findCancel(), { class: 'icon', 'aria-label': '取消搜尋' })
      );
      shadow.append(refs.find);
    }
    function setFindUI({ visible, query = '', index = 0, total = 0, busy = false }) {
      if (!host) mount();
      refs.find.hidden = !visible;
      if (!findComposing && refs.findInput.value !== query) refs.findInput.value = query;
      refs.findCount.textContent = busy
        ? '搜尋中…'
        : `${total && index > 0 ? index : 0} / ${total}`;
      refs.findInput.setAttribute('aria-busy', String(busy));
      if (visible && !findOpen) {
        previousFindFocus = document.activeElement;
        refs.findInput.focus({ preventScroll: true });
        refs.findInput.select();
      } else if (!visible && findOpen) {
        blurPanel(refs.find);
        if (
          previousFindFocus?.isConnected &&
          previousFindFocus !== host &&
          typeof previousFindFocus.focus === 'function'
        )
          previousFindFocus.focus({ preventScroll: true });
      }
      findOpen = Boolean(visible);
    }
    // Core calls this directly before the protected keyboard event can reach
    // the website. Native input, button, select and Tab behavior stays uncancelled.
    function handleKeyDown(event) {
      if (!host || uiComposing || findComposing || event.isComposing || event.keyCode === 229)
        return false;
      const target = event.composedPath?.()[0] || shadow.activeElement;
      if (!target || target.getRootNode?.() !== shadow) return false;
      if (findOpen && refs.find.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!event.repeat) api.findCancel();
          return true;
        }
        if (target === refs.findInput && event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat) api.findCommit();
          return true;
        }
      }
      if (event.key === 'Escape') {
        if (settingsOpen && refs.settings.contains(target)) {
          event.preventDefault();
          closeSettings();
          return true;
        }
        if (helpOpen && refs.help.contains(target)) {
          event.preventDefault();
          blurPanel(refs.help);
          if (!helpPinned) closeHelp();
          return true;
        }
        if (refs.card.contains(target)) {
          event.preventDefault();
          blurPanel(refs.card);
          return true;
        }
      }
      if (target === refs.dragHandle && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const offsets = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const offset = offsets[event.key];
        if (offset) {
          event.preventDefault();
          const rect = refs.card.getBoundingClientRect();
          const step = event.shiftKey ? 30 : 10;
          localPosition = clampPosition({
            x: rect.left + offset[0] * step,
            y: rect.top + offset[1] * step,
          });
          positionCard();
          const position = localPosition;
          localPosition = null;
          api.saveUI({ position });
          return true;
        }
      }
      return false;
    }
    function closeTopPanel() {
      if (settingsOpen) {
        closeSettings();
        return true;
      }
      if (helpOpen && !helpPinned) {
        closeHelp();
        return true;
      }
      return false;
    }
    function destroy() {
      window.removeEventListener('resize', onResize);
      clearTimeout(recentTimer);
      clearTimeout(compositionTimer);
      host?.remove();
      host = shadow = undefined;
      refs = {};
    }
    return {
      mount,
      render,
      getHost: () => host,
      toggleHelp,
      openSettings,
      closeTopPanel,
      handleKeyDown,
      setFindUI,
      destroy,
    };
  }
})();
