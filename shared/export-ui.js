/* eslint-env browser */
/**
 * 匯出腳本共用的右下角浮動按鈕 + 可拖曳面板，用 `@require` 引入：
 *
 *   // @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/export-ui.js
 *
 * 這不是 ES module —— `@require` 進來的檔案會直接在腳本的 scope 執行。
 *
 * **這裡刻意不呼叫任何 GM API**：位置記憶走呼叫端注入的 `storage`，
 * 剪貼簿 / 選單 / 儲存都留在各腳本裡。理由是 `scripts/check-meta.mjs` 只掃腳本本體
 * 來交叉比對 `@grant`，GM 呼叫留在腳本裡 `npm run check` 才驗得到。
 */

/**
 * @param {object} config
 * @param {string} config.ns            DOM id 前綴，各腳本要不一樣
 * @param {string} config.buttonLabel   浮動按鈕上的字
 * @param {string} [config.buttonTitle] 按鈕的 tooltip
 * @param {Array<{label: string, run: Function}>} config.actions
 * @param {Array<{label: string, get: Function, set: Function}>} [config.toggles]
 * @param {{placeholder: string, buttonLabel: string, onSubmit: Function}} [config.shareInput]
 * @param {{get: Function, set: Function}} config.storage  位置記憶（GM_getValue / GM_setValue 包一層）
 * @param {Function} [config.onStatus]  每次 setStatus 也會呼叫一次，通常拿去 console.log
 * @returns {{mount: Function, openPanel: Function, setStatus: Function, resetPosition: Function}}
 */
function createExportPanel(config) {
  const { ns, storage } = config;
  const panelWidth = config.panelWidth ?? 230;
  const toggles = config.toggles ?? [];
  const POSITION_KEY = 'buttonPosition'; // 拖曳後記住的位置：{ left, top }（viewport 座標）

  const ROOT_CSS =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
    'font:400 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  let statusEl = null;
  let justDragged = false;

  function setStatus(text) {
    if (config.onStatus) config.onStatus(text);
    if (statusEl) statusEl.textContent = text;
  }

  function style(el, css) {
    el.style.cssText = css;
    return el;
  }

  function makeButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return style(
      button,
      'display:block;width:100%;margin:0 0 6px;padding:7px 10px;border:0;border-radius:7px;' +
        'cursor:pointer;background:#3ba3ff;color:#06131f;font:600 13px/1.4 inherit;text-align:left;'
    );
  }

  function makeToggle(toggle) {
    const wrapper = style(
      document.createElement('label'),
      'display:flex;align-items:center;gap:6px;margin:0 0 4px;font:400 12px/1.4 inherit;cursor:pointer;'
    );
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = toggle.get() === true;
    box.addEventListener('change', () => {
      toggle.set(box.checked);
      setStatus(`${toggle.label}：${box.checked ? '含' : '不含'}`);
    });
    wrapper.append(box, document.createTextNode(toggle.label));
    return wrapper;
  }

  /** 把面板放在按鈕的哪一邊：上面塞不下就往下、右邊塞不下就往左。 */
  function placePanel(root, panel) {
    const rect = root.getBoundingClientRect();
    const above = rect.top >= panel.offsetHeight + 16;
    panel.style.top = above ? 'auto' : '100%';
    panel.style.bottom = above ? '100%' : 'auto';
    panel.style.marginTop = above ? '0' : '8px';
    panel.style.marginBottom = above ? '8px' : '0';

    const rightAligned = rect.right - panelWidth >= 8;
    panel.style.right = rightAligned ? '0' : 'auto';
    panel.style.left = rightAligned ? 'auto' : '0';
  }

  /** 用 left/top 定位（取代預設的 right/bottom），並夾在畫面裡。 */
  function moveTo(root, left, top) {
    const x = Math.min(Math.max(left, 4), window.innerWidth - root.offsetWidth - 4);
    const y = Math.min(Math.max(top, 4), window.innerHeight - root.offsetHeight - 4);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function resetPosition() {
    storage.set(POSITION_KEY, null);
    const root = document.getElementById(`${ns}-root`);
    if (root) root.style.cssText = ROOT_CSS;
  }

  /**
   * 讓按鈕可以拖到任何地方。用 pointer events（滑鼠 / 觸控同一套），
   * 位移小於 4px 就當成「手抖的點擊」而不是拖曳，否則單純想開面板會很難按。
   */
  function makeDraggable(root, handle, onMoved) {
    let drag = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault(); // 不要順便選到頁面的文字
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      moveTo(root, drag.left + dx, drag.top + dy);
    });

    const end = (event) => {
      if (!drag) return;
      const { moved } = drag;
      drag = null;
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      if (!moved) return;
      const rect = root.getBoundingClientRect();
      storage.set(POSITION_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
      onMoved();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** 掛 UI。可重複呼叫，必須 idempotent（SPA 換頁會再跑一次）。 */
  function mount() {
    if (!document.body || document.getElementById(`${ns}-root`)) return;

    const root = style(document.createElement('div'), ROOT_CSS);
    root.id = `${ns}-root`;

    const panel = style(
      document.createElement('div'),
      `display:none;position:absolute;right:0;bottom:100%;margin-bottom:8px;width:${panelWidth}px;` +
        'padding:12px;border-radius:10px;background:#12181f;color:#e6edf3;' +
        'box-shadow:0 8px 28px rgba(0,0,0,.35);'
    );
    panel.id = `${ns}-panel`;

    for (const action of config.actions) panel.appendChild(makeButton(action.label, action.run));

    if (toggles.length > 0) {
      panel.appendChild(
        style(document.createElement('hr'), 'margin:10px 0;border:0;border-top:1px solid #2a3441;')
      );
      for (const toggle of toggles) panel.appendChild(makeToggle(toggle));
    }

    if (config.shareInput) {
      const input = style(
        document.createElement('input'),
        'width:100%;box-sizing:border-box;margin:10px 0 6px;padding:6px 8px;border-radius:6px;' +
          'border:1px solid #2a3441;background:#0b0f14;color:#e6edf3;font:400 12px/1.4 inherit;'
      );
      input.type = 'text';
      input.placeholder = config.shareInput.placeholder;
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') config.shareInput.onSubmit(input.value);
      });
      panel.appendChild(input);
      panel.appendChild(
        makeButton(config.shareInput.buttonLabel, () => config.shareInput.onSubmit(input.value))
      );
    }

    statusEl = style(
      document.createElement('div'),
      'margin-top:8px;color:#8b98a5;font:400 11px/1.5 inherit;word-break:break-word;'
    );
    statusEl.textContent = '就緒';
    panel.appendChild(statusEl);

    const toggle = style(
      document.createElement('button'),
      'padding:8px 14px;border:0;border-radius:8px;cursor:grab;touch-action:none;' +
        'background:#3ba3ff;color:#06131f;font:600 13px/1.4 inherit;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.25);'
    );
    toggle.type = 'button';
    toggle.textContent = config.buttonLabel;
    toggle.title = config.buttonTitle || '點一下開關面板，拖曳可以搬到別的位置';
    toggle.addEventListener('click', () => {
      if (justDragged) {
        justDragged = false; // 拖曳結束後瀏覽器還是會補一個 click，忽略它
        return;
      }
      if (panel.style.display === 'block') {
        panel.style.display = 'none';
      } else {
        panel.style.display = 'block';
        placePanel(root, panel);
      }
    });

    makeDraggable(root, toggle, () => {
      justDragged = true;
      if (panel.style.display === 'block') placePanel(root, panel);
    });

    root.append(panel, toggle);
    document.body.appendChild(root);

    // 位置要等進 DOM 才量得到寬高。
    const saved = storage.get(POSITION_KEY, null);
    if (saved && typeof saved.left === 'number') moveTo(root, saved.left, saved.top);

    // 視窗縮小後按鈕可能被推到畫面外，重新夾一次。
    window.addEventListener('resize', () => {
      if (root.style.left === 'auto' || !root.style.left) return;
      moveTo(root, parseFloat(root.style.left), parseFloat(root.style.top));
      if (panel.style.display === 'block') placePanel(root, panel);
    });
  }

  function openPanel() {
    mount();
    const root = document.getElementById(`${ns}-root`);
    const panel = document.getElementById(`${ns}-panel`);
    if (!root || !panel) return;
    panel.style.display = 'block';
    placePanel(root, panel);
  }

  return { mount, openPanel, setStatus, resetPosition };
}
