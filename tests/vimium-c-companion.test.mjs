import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '.preview', 'vimium-c-companion-tests');
const SCRIPT = await readFile(
  join(ROOT, 'userscripts/vimium-c-companion/vimium-c-companion.user.js'),
  'utf8'
);
const FIXTURE = await readFile(join(ROOT, 'tests/fixtures/vimium-c-companion-ui.html'), 'utf8');
const ORIGIN = 'https://companion.test';
const PAGE_URL = `${ORIGIN}/practice`;
const UI = '#vimium-c-companion-ui';
const KEY = 'vimiumCCompanionConfig';
const IMPORTED = {
  name: 'Vimium C',
  environment: { extension: '2.12.3', platform: 'mac' },
  keyMappings: 'unmap j\nmap z scrollDown',
};
await mkdir(OUT, { recursive: true });

function gmShim(initial) {
  const storageKey = '__companionTestValues';
  window.__gmStore = JSON.parse(localStorage.getItem(storageKey) || JSON.stringify(initial));
  window.__gmMenus = [];
  window.__gmUnexpected = [];
  window.__gmRemoteEvents = 0;
  const listeners = new Map();
  let counter = 0;
  window.GM_getValue = (key, fallback) =>
    Object.hasOwn(window.__gmStore, key) ? window.__gmStore[key] : fallback;
  window.GM_setValue = (key, value) => {
    const old = window.__gmStore[key];
    window.__gmStore[key] = value;
    localStorage.setItem(storageKey, JSON.stringify(window.__gmStore));
    for (const listener of listeners.values())
      if (listener.key === key) listener.callback(key, old, value, false);
  };
  window.GM_addValueChangeListener = (key, callback) => {
    listeners.set(++counter, { key, callback });
    return counter;
  };
  window.GM_removeValueChangeListener = (id) => listeners.delete(id);
  window.GM_registerMenuCommand = (label, callback) => {
    window.__gmMenus.push({ label, callback });
    return window.__gmMenus.length;
  };
  window.GM_unregisterMenuCommand = () => {};
  window.GM_openInTab = (...args) => {
    window.__gmUnexpected.push({ type: 'openTab', args });
  };
  window.GM_setClipboard = (...args) => {
    window.__gmUnexpected.push({ type: 'clipboard', args });
  };
  // localStorage 只用於這個測試 shim；以同 origin 的 storage 事件模擬跨分頁的
  // GM remote:true 通知。真實 manager 的同步仍需另外驗證。
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey || !event.newValue) return;
    const previous = window.__gmStore;
    window.__gmStore = JSON.parse(event.newValue);
    for (const listener of listeners.values()) {
      if (
        JSON.stringify(previous[listener.key]) !== JSON.stringify(window.__gmStore[listener.key])
      ) {
        window.__gmRemoteEvents++;
        listener.callback(
          listener.key,
          previous[listener.key],
          window.__gmStore[listener.key],
          true
        );
      }
    }
  });
  window.GM = {
    getValue: async (...args) => window.GM_getValue(...args),
    setValue: async (...args) => window.GM_setValue(...args),
    addValueChangeListener: (...args) => window.GM_addValueChangeListener(...args),
    registerMenuCommand: (...args) => window.GM_registerMenuCommand(...args),
  };
}

for (const engine of (process.env.VCC_BROWSERS || 'chromium,firefox').split(',')) {
  if (!{ chromium, firefox }[engine]) throw new Error(`Unknown browser: ${engine}`);
  describe(`vimium-c-companion / ${engine}`, { concurrency: false }, () => {
    let browser;
    let contexts = [];
    let errors = [];
    before(async () => {
      browser = await { chromium, firefox }[engine].launch();
    });
    after(async () => browser?.close());
    afterEach(async () => {
      for (const context of contexts) await context.close();
      contexts = [];
      const actual = errors;
      errors = [];
      assert.deepEqual(actual, [], 'No uncaught page errors');
    });

    async function open({ config, width = 1280, colorScheme = 'light' } = {}) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme,
        reducedMotion: 'reduce',
      });
      contexts.push(context);
      await context.addInitScript({
        content: `(${gmShim.toString()})(${JSON.stringify(config ? { [KEY]: config } : {})});\n${SCRIPT}`,
      });
      await context.route('**/*', (route) =>
        route.fulfill({ contentType: 'text/html', body: FIXTURE })
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(PAGE_URL);
      await page.locator(UI).waitFor({ state: 'attached' });
      return page;
    }
    const dock = (page) => page.locator(`${UI} .card`);
    const row = (page, id) => dock(page).locator(`.reference-row[data-entry-id="${id}"]`);
    async function menu(page, label) {
      await page.evaluate(async (name) => {
        const item = window.__gmMenus.find((command) => command.label === name);
        if (!item) throw new Error(`Missing menu: ${name}`);
        await item.callback();
      }, label);
    }
    async function settings(page) {
      await menu(page, 'Vimium C Companion：設定');
      return page.getByRole('dialog', { name: 'Companion 設定' });
    }
    async function stored(page) {
      return page.evaluate((key) => window.__gmStore[key], KEY);
    }
    async function backup(page) {
      await settings(page);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '匯出 Companion 備份', exact: true }).click();
      await downloading;
      return JSON.parse(
        await page.getByRole('textbox', { name: 'Companion 備份 JSON' }).inputValue()
      );
    }
    async function restoreGuide(page) {
      await menu(page, 'Vimium C Companion：顯示／隱藏小抄');
      await dock(page).waitFor({ state: 'visible' });
    }

    it('leaves f/j/? native on the page and focused Companion buttons', async () => {
      const page = await open();
      for (const key of ['f', 'j', '?']) await page.keyboard.press(key);
      let keys = await page.evaluate(() =>
        window.__siteKeys.filter((event) => event.type === 'keydown')
      );
      assert.deepEqual(
        keys.map((event) => event.key),
        ['f', 'j', '?']
      );
      assert.ok(keys.every((event) => !event.prevented));
      await dock(page).getByRole('button', { name: '設定', exact: true }).focus();
      await page.evaluate(() => {
        window.__siteKeys = [];
      });
      for (const key of ['f', 'j', '?']) await page.keyboard.press(key);
      keys = await page.evaluate(() =>
        window.__siteKeys.filter((event) => event.type === 'keydown')
      );
      assert.deepEqual(
        keys.map((event) => event.key),
        ['f', 'j', '?']
      );
      assert.ok(keys.every((event) => !event.prevented));
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(page.url(), PAGE_URL);
      assert.deepEqual(await page.evaluate(() => window.__gmUnexpected), []);
    });

    it('displays reference rows without executing navigation when clicked', async () => {
      const page = await open();
      const down = row(page, 'scrollDown');
      await down.waitFor({ state: 'visible' });
      assert.ok((await down.innerText()).includes('j'));
      await down.click({ position: { x: 80, y: 12 } });
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.deepEqual(await page.evaluate(() => window.__pageActions), []);
      assert.deepEqual(
        await page.evaluate(() => window.__siteKeys),
        [],
        'Reference rows must not synthesize keyboard commands'
      );
      assert.deepEqual(await page.evaluate(() => window.__gmUnexpected), []);
      assert.equal(page.context().pages().length, 1);
      assert.equal(page.url(), PAGE_URL);
    });

    it('protects native search typing, editing and IME while page s shortcuts still work outside', async () => {
      const page = await open();
      await page.evaluate(() => {
        window.__trapSearch = true;
      });
      await menu(page, 'Vimium C Companion：完整查詢');
      const search = page.getByRole('searchbox', { name: '搜尋 Vimium C 指令' });
      await search.focus();
      await page.keyboard.type('scripts scroll');
      assert.equal(await search.inputValue(), 'scripts scroll');
      assert.equal(await page.locator(`${UI} .catalog-results .reference-row`).count(), 0);
      assert.equal(await page.evaluate(() => window.__searchSteals), 0);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('scrollDown');
      assert.equal(await search.inputValue(), 'scrollDown');
      assert.equal(
        await page
          .locator(`${UI} .catalog-results .reference-row[data-entry-id="scrollDown"]`)
          .count(),
        1
      );
      assert.deepEqual(
        await page.evaluate(() => window.__siteKeys),
        [],
        'Owned text editing keeps keyboard events away from document shortcuts'
      );
      const prevented = await search.evaluate((input) => {
        input.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true, composed: true })
        );
        const escape = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          composed: true,
          isComposing: true,
          cancelable: true,
        });
        input.dispatchEvent(escape);
        input.value = '中文';
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertCompositionText',
            data: '中文',
            isComposing: true,
          })
        );
        input.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, composed: true, data: '中文' })
        );
        return escape.defaultPrevented;
      });
      assert.equal(prevented, false);
      assert.equal(await search.inputValue(), '中文');
      assert.equal(await page.evaluate(() => window.__searchSteals), 0);
      await search.evaluate((input) => input.blur());
      await page.keyboard.press('s');
      assert.equal(await page.evaluate(() => window.__searchSteals), 1);
    });

    it('filters categories, favorites a reference and persists both across reload', async () => {
      const page = await open();
      await row(page, 'scrollDown')
        .getByRole('button', { name: /^收藏：/ })
        .click();
      await menu(page, 'Vimium C Companion：完整查詢');
      await page.getByRole('searchbox', { name: '搜尋 Vimium C 指令' }).fill('zoomIn');
      const zoom = page.locator(`${UI} .catalog-results .reference-row[data-entry-id="zoomIn"]`);
      assert.equal(await zoom.locator('kbd').count(), 0, 'Fixture command is advanced and unbound');
      await zoom.getByRole('button', { name: /^收藏：/ }).click();
      await page.getByRole('button', { name: '關閉 Companion 面板' }).click();
      await dock(page).getByRole('combobox', { name: '練習分類' }).selectOption('favorites');
      assert.equal(await row(page, 'scrollDown').count(), 1);
      assert.equal(
        await row(page, 'zoomIn').count(),
        1,
        'Advanced favorite remains alongside an ordinary bound command'
      );
      assert.equal(await dock(page).locator('.reference-row').count(), 2);
      await page.reload();
      await dock(page).waitFor();
      assert.equal(
        await dock(page).getByRole('combobox', { name: '練習分類' }).inputValue(),
        'favorites'
      );
      assert.equal(
        await row(page, 'scrollDown')
          .getByRole('button', { name: /^取消收藏：/ })
          .getAttribute('aria-pressed'),
        'true'
      );
      assert.equal(await row(page, 'zoomIn').count(), 1);
      await dock(page).getByRole('combobox', { name: '練習分類' }).selectOption('tabs');
      assert.equal(await row(page, 'scrollDown').count(), 0);
      assert.ok((await dock(page).locator('.reference-row').count()) > 0);
      await dock(page).getByRole('combobox', { name: '練習分類' }).selectOption('favorites');
      await row(page, 'scrollDown')
        .getByRole('button', { name: /^取消收藏：/ })
        .click();
      assert.equal(await row(page, 'zoomIn').count(), 1);
      await row(page, 'zoomIn')
        .getByRole('button', { name: /^取消收藏：/ })
        .click();
      assert.equal(await dock(page).locator('.reference-row').count(), 0);
    });

    it('suggests only mode-correct option-free recipe keys and explains uncertain steps', async () => {
      const page = await open();
      await dock(page).getByRole('combobox', { name: '練習分類' }).selectOption('find');
      assert.ok(
        (await dock(page).locator('.recipe kbd').allTextContents()).includes('v'),
        'Default Normal visual-entry key is usable in this step'
      );
      await settings(page);
      const imported = {
        ...IMPORTED,
        keyMappings:
          'unmap v\nunmap <f8>\nmap <c-x:i> enterVisualMode\nmap f LinkHints.activate mode=hover',
      };
      await page
        .getByRole('textbox', { name: 'Vimium C 設定 JSON' })
        .fill(JSON.stringify(imported));
      await page.getByRole('button', { name: '預覽匯入', exact: true }).click();
      await page.getByRole('button', { name: '套用個人鍵位', exact: true }).click();
      await page.getByRole('button', { name: '關閉 Companion 面板' }).click();
      assert.equal(await page.locator(UI).getAttribute('data-source'), 'imported');
      const findKeys = await dock(page).locator('.recipe kbd').allTextContents();
      assert.ok(
        findKeys.includes('/') && findKeys.includes('w') && findKeys.includes('y'),
        'Confirmed keys in the other modes remain visible'
      );
      assert.ok(
        !findKeys.some((key) => /c-x|^v$|f8/i.test(key)),
        'Insert-only visual entry must not be suggested as a Normal step'
      );
      const visualStep = dock(page).locator('.recipe span[title]').filter({ hasText: '選取模式' });
      assert.equal(await visualStep.count(), 1);
      assert.match(await visualStep.getAttribute('title'), /沒有可確定.*適用/);
      await dock(page).getByRole('combobox', { name: '練習分類' }).selectOption('hints');
      assert.ok(
        !(await dock(page).locator('.recipe kbd').allTextContents()).includes('f'),
        'A hover-option mapping is not the ordinary hints recipe'
      );
      const hintStep = dock(page).locator('.recipe span[title]').filter({ hasText: '顯示提示' });
      assert.equal(await hintStep.count(), 1);
      assert.match(await hintStep.getAttribute('title'), /請對照 Vimium C 設定/);
      assert.deepEqual(await page.evaluate(() => window.__gmUnexpected), []);
      assert.deepEqual(await page.evaluate(() => window.__pageActions), []);
    });

    it('previews a native Vimium C export, applies it, and switches key sources', async () => {
      const page = await open();
      await settings(page);
      const before = await stored(page);
      await page.getByRole('textbox', { name: 'Vimium C 設定 JSON' }).fill('{broken');
      await page.getByRole('button', { name: '預覽匯入', exact: true }).click();
      assert.equal(
        await page.getByRole('button', { name: '套用個人鍵位', exact: true }).isDisabled(),
        true
      );
      assert.deepEqual(await stored(page), before);
      await page
        .getByRole('textbox', { name: 'Vimium C 設定 JSON' })
        .fill(JSON.stringify(IMPORTED));
      await page.getByRole('button', { name: '預覽匯入', exact: true }).click();
      assert.match(await page.locator(`${UI} .import-preview`).innerText(), /已解析/);
      assert.equal(
        await page.getByRole('button', { name: '套用個人鍵位', exact: true }).isEnabled(),
        true
      );
      assert.deepEqual(await stored(page), before, 'Preview must not persist imported mappings');
      assert.equal(await page.locator(UI).getAttribute('data-source'), 'default');
      await page.getByRole('button', { name: '套用個人鍵位', exact: true }).click();
      await page.waitForFunction(
        (selector) => document.querySelector(selector)?.dataset.source === 'imported',
        UI
      );
      const profile = (await stored(page)).profile;
      assert.ok(profile && JSON.stringify(profile.raw).includes('map z scrollDown'));
      await page.getByRole('combobox', { name: '顯示鍵位來源' }).selectOption('default');
      assert.equal(await page.locator(UI).getAttribute('data-source'), 'default');
      await page.getByRole('combobox', { name: '顯示鍵位來源' }).selectOption('imported');
      assert.equal(await page.locator(UI).getAttribute('data-source'), 'imported');
      await page.reload();
      await dock(page).waitFor();
      const keys = await row(page, 'scrollDown').locator('kbd').allTextContents();
      assert.ok(keys.includes('z'));
      assert.ok(!keys.includes('j'));
      assert.deepEqual(await page.evaluate(() => window.__gmUnexpected), []);
    });

    it('rejects invalid Companion backups without overwriting saved preferences', async () => {
      const page = await open();
      const valid = await backup(page);
      const box = page.getByRole('textbox', { name: 'Companion 備份 JSON' });
      const before = await stored(page);
      for (const candidate of [
        '{invalid',
        JSON.stringify({ ...valid, type: 'Wrong product' }),
        JSON.stringify({ ...valid, schemaVersion: 999 }),
        JSON.stringify({ ...valid, config: { ...valid.config, theme: 'unknown' } }),
      ]) {
        await box.fill(candidate);
        await page.getByRole('button', { name: '匯入 Companion 備份', exact: true }).click();
        assert.deepEqual(await stored(page), before);
      }
      await box.fill(JSON.stringify({ ...valid, config: { ...valid.config, theme: 'dark' } }));
      await page.getByRole('button', { name: '匯入 Companion 備份', exact: true }).click();
      await page.waitForFunction(
        (selector) => document.querySelector(selector)?.dataset.theme === 'dark',
        UI
      );
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '匯出 Companion 備份', exact: true }).click();
      const downloaded = await downloading;
      const target = join(OUT, `${engine}-companion-backup.json`);
      await downloaded.saveAs(target);
      const exported = JSON.parse(await readFile(target, 'utf8'));
      assert.equal(exported.type, 'Vimium C Companion');
      assert.equal(exported.schemaVersion, 1);
      assert.equal(exported.config.theme, 'dark');
      await page.reload();
      await dock(page).waitFor();
      assert.equal(await page.locator(UI).getAttribute('data-theme'), 'dark');
    });

    it('updates a second tab through remote GM value notifications', async () => {
      const page = await open();
      const valid = await backup(page);
      const second = await page.context().newPage();
      second.on('pageerror', (error) => errors.push(error.message));
      await second.goto(PAGE_URL + '/second');
      await second.locator(UI).waitFor();
      await page
        .getByRole('textbox', { name: 'Companion 備份 JSON' })
        .fill(JSON.stringify({ ...valid, config: { ...valid.config, theme: 'dark' } }));
      await page.getByRole('button', { name: '匯入 Companion 備份', exact: true }).click();
      await second.waitForFunction(
        (selector) => document.querySelector(selector)?.dataset.theme === 'dark',
        UI
      );
      assert.ok(await second.evaluate(() => window.__gmRemoteEvents > 0));
    });

    it('restores hidden guides through manager menus and preserves site hiding on reload', async () => {
      const page = await open();
      await dock(page).getByRole('button', { name: '隱藏小抄', exact: true }).click();
      assert.equal(await dock(page).isVisible(), false);
      await restoreGuide(page);
      await menu(page, 'Vimium C Companion：本網站顯示／隱藏');
      assert.equal(await dock(page).isVisible(), false);
      await page.reload();
      await page.waitForFunction(() => window.__gmMenus.length > 0);
      assert.equal(await dock(page).isVisible(), false);
      await restoreGuide(page);
      assert.equal(await dock(page).isVisible(), true);
      await page.reload();
      await dock(page).waitFor({ state: 'visible' });
    });

    it('persists dragging and repairs one host after SPA replacement', async () => {
      const page = await open();
      const handle = dock(page).getByRole('button', { name: '拖曳小抄；方向鍵移動' });
      const position = await handle.boundingBox();
      await page.mouse.move(position.x + 30, position.y + 12);
      await page.mouse.down();
      await page.mouse.move(position.x + 280, position.y - 100, { steps: 8 });
      await page.mouse.up();
      const moved = await dock(page).boundingBox();
      await page.reload();
      await dock(page).waitFor();
      const restored = await dock(page).boundingBox();
      assert.ok(Math.abs(moved.x - restored.x) < 2 && Math.abs(moved.y - restored.y) < 2);
      const menus = await page.evaluate(() => window.__gmMenus.length);
      await page.evaluate((selector) => {
        history.pushState({}, '', '/spa-route');
        document.querySelector(selector).remove();
      }, UI);
      await page.locator(UI).waitFor({ state: 'attached' });
      assert.equal(await page.locator(UI).count(), 1);
      assert.equal(await page.evaluate(() => window.__gmMenus.length), menus);
      await page.evaluate(() => {
        document.body.replaceChildren(document.createElement('main'));
      });
      await page.locator(UI).waitFor({ state: 'attached' });
      assert.equal(await page.locator(UI).count(), 1);
      assert.equal(await page.locator(UI).getAttribute('data-source'), 'default');
    });

    it('renders readable light, dark and narrow guides and remembers collapse', async () => {
      for (const colorScheme of ['light', 'dark']) {
        const page = await open({ colorScheme });
        await page.screenshot({ path: join(OUT, `${engine}-${colorScheme}.png`) });
        await dock(page).getByRole('button', { name: '完整小抄', exact: true }).click();
        await page.screenshot({ path: join(OUT, `${engine}-${colorScheme}-full.png`) });
      }
      const page = await open({ width: 480 });
      const bounds = await dock(page).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 481);
      await page.screenshot({ path: join(OUT, `${engine}-narrow.png`) });
      await dock(page).getByRole('button', { name: '收合小抄', exact: true }).click();
      await page.reload();
      await dock(page).waitFor();
      assert.equal(
        await dock(page).getByRole('button', { name: '展開小抄', exact: true }).isVisible(),
        true
      );
    });
  });
}
