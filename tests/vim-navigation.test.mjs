import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '.preview', 'vim-navigation-tests');
const SCRIPT = await readFile(
  join(ROOT, 'userscripts/vim-navigation/vim-navigation.user.js'),
  'utf8'
);
const FIXTURES = Object.fromEntries(
  await Promise.all(
    ['article', 'interaction'].map(async (name) => [
      name,
      await readFile(join(ROOT, `tests/fixtures/vim-navigation/${name}.html`), 'utf8'),
    ])
  )
);
const ORIGIN = 'https://navigation.test';
const PAGE_URL = `${ORIGIN}/practice?source=test`;
const UI = '#vim-navigation-ui';
const OVERLAYS = '#vim-navigation-overlays';
await mkdir(OUT, { recursive: true });

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    scrollStep: 64,
    hintChars: 'asdfghjkl',
    hintDetection: 'broad',
    theme: 'system',
    bindings: { normal: {}, caret: {}, visual: {}, line: {} },
    sites: {},
    customActions: [],
    ui: { collapsed: false, position: null },
    ...overrides,
  };
}

// 本機 shim 只驗證 GM 呼叫契約。localStorage 用來模擬同 origin 重載後的
// manager 儲存，正式脚本不使用這個 shim，也不在 localStorage 存設定。
function gmShim(initialStorage) {
  const storageKey = '__vimNavigationTestStorage';
  const stored = localStorage.getItem(storageKey);
  window.__gmStore = stored ? JSON.parse(stored) : initialStorage;
  window.__gmClipboard = null;
  window.__gmClipboardFailure = false;
  window.__gmTabs = [];
  window.__gmMenus = [];
  const listeners = new Map();
  let listenerId = 0;
  window.GM_getValue = (key, fallback) =>
    Object.hasOwn(window.__gmStore, key) ? window.__gmStore[key] : fallback;
  window.GM_setValue = (key, value) => {
    const previous = window.__gmStore[key];
    window.__gmStore[key] = value;
    localStorage.setItem(storageKey, JSON.stringify(window.__gmStore));
    for (const listener of listeners.values()) {
      if (listener.key === key) listener.callback(key, previous, value, false);
    }
  };
  window.GM_addValueChangeListener = (key, callback) => {
    listeners.set(++listenerId, { key, callback });
    return listenerId;
  };
  window.GM_removeValueChangeListener = (id) => listeners.delete(id);
  window.GM_setClipboard = (value, options, callback) => {
    if (window.__gmClipboardFailure) throw new Error('Clipboard denied by test fixture');
    window.__gmClipboard = value;
    callback?.();
  };
  window.GM_openInTab = (url, options) => {
    window.__gmTabs.push({ url, options });
    return { close() {}, closed: false };
  };
  window.GM_registerMenuCommand = (label, callback) => {
    window.__gmMenus.push({ label, callback });
    return window.__gmMenus.length;
  };
  window.GM_unregisterMenuCommand = () => {};
  window.GM = {
    getValue: async (...args) => window.GM_getValue(...args),
    setValue: async (...args) => window.GM_setValue(...args),
    setClipboard: async (...args) => window.GM_setClipboard(...args),
    openInTab: (...args) => window.GM_openInTab(...args),
    registerMenuCommand: (...args) => window.GM_registerMenuCommand(...args),
    addValueChangeListener: (...args) => window.GM_addValueChangeListener(...args),
    removeValueChangeListener: (...args) => window.GM_removeValueChangeListener(...args),
  };
}

for (const engine of (process.env.VN_BROWSERS || 'chromium,firefox').split(',')) {
  if (!{ chromium, firefox }[engine]) throw new Error(`Unknown VN_BROWSERS engine: ${engine}`);
  describe(`vim-navigation / ${engine}`, { concurrency: false }, () => {
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
      const captured = errors;
      errors = [];
      assert.deepEqual(captured, [], 'No uncaught page errors');
    });

    async function open({
      settings,
      colorScheme = 'light',
      width = 1280,
      fixture = 'article',
      legacy = false,
    } = {}) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme,
        reducedMotion: 'reduce',
      });
      contexts.push(context);
      const initial =
        fixture === 'interaction'
          ? { ui: { collapsed: true, position: null }, ...settings }
          : settings;
      const storage = initial ? { vimNavigationConfig: config(initial) } : {};
      if (legacy && storage.vimNavigationConfig) delete storage.vimNavigationConfig.hintDetection;
      // 一個 init script 保證 shim 先於 userscript；在 document-start 注入。
      await context.addInitScript({
        content: `(${gmShim.toString()})(${JSON.stringify(storage)});\n${SCRIPT}`,
      });
      await context.route('**/*', (route) =>
        route.fulfill({ contentType: 'text/html', body: FIXTURES[fixture] })
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(PAGE_URL);
      await page.locator(UI).waitFor({ state: 'attached' });
      if (fixture === 'interaction') await page.waitForFunction(() => window.__layoutReady);
      return page;
    }

    const openInteraction = (options = {}) => open({ fixture: 'interaction', ...options });

    async function mode(page, expected) {
      await page.waitForFunction(
        ({ selector, expectedMode }) =>
          document.querySelector(selector)?.dataset.mode === expectedMode,
        { selector: UI, expectedMode: expected },
        { timeout: 3000 }
      );
    }

    async function keys(page, sequence) {
      for (const key of sequence) await page.keyboard.press(key);
    }

    async function chooseHint(page, id) {
      const hint = page.locator(`${OVERLAYS} [data-hint][data-target-id="${id}"]`);
      await hint.waitFor({ state: 'visible', timeout: 3000 });
      const label = (await hint.getAttribute('data-hint')) || (await hint.textContent());
      assert.match(label, /^[a-z]+$/i, 'Hint labels should be keyboard letters');
      await keys(page, [...label]);
    }

    async function clipboard(page) {
      return page.evaluate(() => window.__gmClipboard);
    }

    async function waitClipboard(page, text) {
      await page.waitForFunction((value) => window.__gmClipboard === value, text, {
        timeout: 3000,
      });
    }

    async function select(page, id, start = 0, end = start) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.evaluate(
        ({ id, start, end }) => {
          const element = document.getElementById(id);
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const locate = (offset) => {
            walker.currentNode = element;
            let node;
            let remaining = offset;
            while ((node = walker.nextNode())) {
              if (remaining <= node.length) return [node, remaining];
              remaining -= node.length;
            }
            throw new Error(`Selection offset ${offset} outside ${id}`);
          };
          const [anchorNode, anchorOffset] = locate(start);
          const [focusNode, focusOffset] = locate(end);
          getSelection().setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
          document.activeElement?.blur();
        },
        { id, start, end }
      );
    }

    it('scrolls the interacted container with counts and boundaries', async () => {
      const page = await open();
      await page.locator('#nested-scroll').focus();
      const before = await page.evaluate(() => scrollY);
      await keys(page, ['5', 'j']);
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop >= 300);
      assert.equal(await page.evaluate(() => scrollY), before, 'Outer page stays in place');
      await page.keyboard.press('G');
      await page.waitForFunction(() => {
        const element = document.querySelector('#nested-scroll');
        return element.scrollTop >= element.scrollHeight - element.clientHeight - 1;
      });
      await keys(page, ['g', 'g']);
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop === 0);
      await page.keyboard.press('d');
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop >= 65);
      await page.keyboard.press('u');
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop === 0);
    });

    it('clicks visible link and open Shadow DOM hints', async () => {
      const page = await open();
      await page.keyboard.down('f');
      await page.keyboard.down('f');
      await mode(page, 'hints');
      assert.deepEqual(
        await page.evaluate(() => window.__actions),
        [],
        'Held f never selects a hint'
      );
      await page.keyboard.up('f');
      await chooseHint(page, 'first-link');
      assert.deepEqual(await page.evaluate(() => window.__actions), ['first-link']);
      await mode(page, 'normal');
      await page.keyboard.press('f');
      await chooseHint(page, 'shadow-action');
      assert.deepEqual(await page.evaluate(() => window.__actions), [
        'first-link',
        'shadow-action',
      ]);
    });

    it('prioritizes an interacted non-focusable nested scroller over the scrollable document', async () => {
      const page = await open();
      await page
        .locator('#nested-scroll')
        .evaluate((element) => element.removeAttribute('tabindex'));
      await page.locator('#nested-scroll strong').click();
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight));
      const outerBefore = await page.evaluate(() => scrollY);
      await keys(page, ['3', 'j']);
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop >= 185);
      assert.equal(await page.evaluate(() => scrollY), outerBefore);
    });

    it('opens a hinted link in a background tab and copies its full URL', async () => {
      const page = await open();
      await page.keyboard.press('F');
      await chooseHint(page, 'second-link');
      const tabs = await page.evaluate(() => window.__gmTabs);
      assert.equal(tabs[0]?.url, 'https://destination.test/docs#intro');
      assert.equal(tabs[0]?.options?.active, false);
      await keys(page, ['y', 'f']);
      await chooseHint(page, 'second-link');
      await waitClipboard(page, 'https://destination.test/docs#intro');
    });

    it('supports multi-letter hints with a customized alphabet', async () => {
      const page = await open({ settings: { hintChars: 'as' } });
      await page.keyboard.press('f');
      const hint = page.locator(`${OVERLAYS} [data-hint][data-target-id="action"]`);
      await hint.waitFor({ state: 'visible' });
      const label = (await hint.getAttribute('data-hint')) || (await hint.textContent());
      assert.match(label, /^[as]{2,}$/);
      await keys(page, [...label]);
      assert.deepEqual(await page.evaluate(() => window.__actions), ['action']);
    });

    it('excludes hidden, disabled, covered and script-owned hint targets', async () => {
      const page = await open();
      await page.locator('#covered-wrap').scrollIntoViewIfNeeded();
      await page.keyboard.press('f');
      await mode(page, 'hints');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="visible-nearby"]`).count(), 1);
      for (const id of ['covered', 'disabled', 'hidden', 'transparent']) {
        assert.equal(
          await page.locator(`${OVERLAYS} [data-target-id="${id}"]`).count(),
          0,
          `${id} must not be hinted`
        );
      }
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
      assert.equal(await page.locator(`${OVERLAYS} [data-hint]`).count(), 0);
    });

    it('cancels stale hints instead of clicking a replaced target', async () => {
      const page = await open();
      await page.keyboard.press('f');
      const hint = page.locator(`${OVERLAYS} [data-hint][data-target-id="action"]`);
      await hint.waitFor();
      const label = (await hint.getAttribute('data-hint')) || (await hint.textContent());
      await page.evaluate(() => document.querySelector('#action').remove());
      await keys(page, [...label]);
      assert.deepEqual(await page.evaluate(() => window.__actions), []);
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
    });

    it('passes editable input, editor shortcuts and IME Escape through', async () => {
      const page = await open();
      for (const id of ['input', 'textarea', 'editor']) {
        await page.locator(`#${id}`).focus();
        await page.keyboard.type('jf/');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), id);
      }
      assert.equal(await page.locator('#input').inputValue(), 'jf/');
      assert.equal(await page.locator('#textarea').inputValue(), 'jf/');
      assert.match(await page.locator('#editor').textContent(), /jf\//);
      const composition = await page.evaluate(() => {
        document.activeElement.blur();
        document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
          isComposing: true,
        });
        document.dispatchEvent(event);
        document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        return event.defaultPrevented;
      });
      assert.equal(composition, false, 'IME Escape belongs to the input method');
      await mode(page, 'normal');
      assert.equal(await page.locator(`${OVERLAYS} [data-hint]`).count(), 0);
    });

    it('supports Insert and per-page pause, including SPA and reload lifetime', async () => {
      const page = await open();
      await page.keyboard.press('i');
      await mode(page, 'insert');
      await page.keyboard.press('j');
      assert.ok(await page.evaluate(() => window.__siteKeys.some(({ key }) => key === 'j')));
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
      await page.keyboard.press('Alt+Shift+V');
      await mode(page, 'paused');
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => window.__siteKeys.some(({ key }) => key === 'Escape')));
      await page.evaluate(() => history.pushState({}, '', '/spa-route'));
      await mode(page, 'paused');
      await page.reload();
      await mode(page, 'normal');
      await page.keyboard.press('Alt+Shift+V');
      await mode(page, 'paused');
      await page.keyboard.press('Alt+Shift+V');
      await mode(page, 'normal');
    });

    it('keeps origin defaults through reload but allows a temporary enable', async () => {
      const page = await open({ settings: { sites: { [ORIGIN]: { enabled: false } } } });
      await mode(page, 'paused');
      await page.keyboard.press('Alt+Shift+V');
      await mode(page, 'normal');
      await page.reload();
      await mode(page, 'paused');
      assert.ok((await page.evaluate(() => window.__gmMenus.length)) > 0, 'Recovery menu exists');
    });

    it('copies URL, Markdown URL, existing selection and code without losing whitespace', async () => {
      const page = await open();
      await keys(page, ['y', 'y']);
      await waitClipboard(page, PAGE_URL);
      await keys(page, ['y', 'm']);
      assert.equal(await clipboard(page), `[鍵盤漫遊 · 一份練習筆記](${PAGE_URL})`);
      await select(page, 'inline-text', 0, 19);
      const selected = await page.evaluate(() => getSelection().toString());
      await keys(page, ['y', 's']);
      await waitClipboard(page, selected);
      await page.locator('#code-block').scrollIntoViewIfNeeded();
      const code = await page.locator('#code-block').textContent();
      await keys(page, ['y', 'c']);
      await chooseHint(page, 'code-block');
      await waitClipboard(page, code);
    });

    it('extends across inline text, reverses endpoints and copies Visual selection', async () => {
      const page = await open();
      await select(page, 'inline-text', 0, 11);
      await page.keyboard.press('v');
      await mode(page, 'visual');
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
      await page.keyboard.press('o');
      const reversed = await page.evaluate(() => ({
        anchor: getSelection().anchorNode.parentElement.closest('#inline-text')?.id,
        text: getSelection().toString(),
      }));
      assert.equal(reversed.anchor, 'inline-text');
      assert.equal(reversed.text, 'Alpha bravo');
      await page.keyboard.press('y');
      await waitClipboard(page, 'Alpha bravo');
      await mode(page, 'normal');
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
    });

    it('moves words with counts and keeps grapheme clusters intact', async () => {
      const page = await open();
      await select(page, 'word-text', 0);
      await page.keyboard.press('v');
      await keys(page, ['2', 'w']);
      assert.equal(await page.evaluate(() => getSelection().toString()), 'alpha bravo ');
      await page.keyboard.press('Escape');
      const unicode = await page.evaluate(() => {
        const element = document.querySelector('#word-text');
        element.textContent = 'A👨‍👩‍👧‍👦e\u0301中文字';
        return element.textContent;
      });
      assert.ok(unicode.includes('👨‍👩‍👧‍👦'));
      await select(page, 'word-text', 1);
      await page.keyboard.press('v');
      assert.equal(await page.evaluate(() => getSelection().toString()), '👨‍👩‍👧‍👦');
      await page.keyboard.press('l');
      assert.equal(await page.evaluate(() => getSelection().toString()), '👨‍👩‍👧‍👦é');
      await page.keyboard.press('l');
      assert.equal(await page.evaluate(() => getSelection().toString()), '👨‍👩‍👧‍👦é中');
    });

    it('selects complete screen lines and exits when the selected node is removed', async () => {
      const page = await open();
      await select(page, 'word-text', 6);
      await page.keyboard.press('V');
      await mode(page, 'line');
      assert.equal(
        (await page.evaluate(() => getSelection().toString())).trim(),
        'alpha bravo charlie delta echo foxtrot'
      );
      await page.keyboard.press('y');
      assert.equal((await clipboard(page)).trim(), 'alpha bravo charlie delta echo foxtrot');
      await mode(page, 'normal');
      await select(page, 'word-text', 0, 5);
      await page.keyboard.press('v');
      await mode(page, 'visual');
      await page.evaluate(() => document.querySelector('#word-text').remove());
      await mode(page, 'normal');
    });

    it('leaves Visual active when clipboard fails and recovers after retry', async () => {
      const page = await open();
      await select(page, 'word-text', 0, 5);
      await page.keyboard.press('v');
      await page.evaluate(() => {
        window.__gmClipboardFailure = true;
      });
      await page.keyboard.press('y');
      await mode(page, 'visual');
      assert.equal(await clipboard(page), null);
      assert.equal(await page.evaluate(() => getSelection().toString()), 'alpha');
      await page.evaluate(() => {
        window.__gmClipboardFailure = false;
      });
      await page.keyboard.press('y');
      await waitClipboard(page, 'alpha');
      await mode(page, 'normal');
    });

    it('copies all intersected visual lines with Y rather than only the focus line', async () => {
      const page = await open();
      await page.locator('#word-text').evaluate((element) => {
        element.style.whiteSpace = 'pre';
        element.textContent = 'first line\nsecond line\nthird line';
      });
      await select(page, 'word-text', 0, 15);
      await page.keyboard.press('v');
      await page.keyboard.press('Y');
      await mode(page, 'normal');
      assert.equal((await clipboard(page)).trim(), 'first line\nsecond line');
    });

    it('finds cross-inline text, skips hidden text and connects search to Visual copy', async () => {
      const page = await open();
      await page.keyboard.press('/');
      const search = page.getByRole('searchbox', { name: '搜尋此頁文字' });
      await search.waitFor({ state: 'visible' });
      await search.fill('silver river');
      await page.waitForFunction(() => {
        const count = document
          .querySelector('#vim-navigation-ui')
          .shadowRoot.querySelector('.find-count');
        return count?.textContent === '1 / 2';
      });
      await page.keyboard.press('Enter');
      await mode(page, 'normal');
      await page.waitForFunction(() => getSelection().toString().toLowerCase() === 'silver river');
      assert.equal(
        await page.evaluate(
          () => getSelection().anchorNode.parentElement.closest('#search-text')?.id
        ),
        'search-text'
      );
      await page.keyboard.press('n');
      assert.equal(
        (await page.evaluate(() => getSelection().toString())).toLowerCase(),
        'silver river'
      );
      await page.keyboard.press('N');
      await page.keyboard.press('v');
      await mode(page, 'visual');
      await page.keyboard.press('y');
      assert.equal((await clipboard(page)).toLowerCase(), 'silver river');
    });

    it('cancels a large pending search and restores the original selection', async () => {
      const page = await open();
      await page.evaluate(() => {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 1000; index++) {
          const paragraph = document.createElement('p');
          paragraph.textContent = `Paragraph ${index}: ${'additional rendered text '.repeat(40)}`;
          fragment.append(paragraph);
        }
        document.querySelector('article').append(fragment);
      });
      await select(page, 'inline-text', 0, 11);
      await page.keyboard.press('/');
      await page.getByRole('searchbox', { name: '搜尋此頁文字' }).fill('rendered text');
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
      await page.waitForTimeout(80);
      await mode(page, 'normal');
      assert.equal(await page.getByRole('searchbox', { name: '搜尋此頁文字' }).isVisible(), false);
    });

    it('honors key overrides and declarative custom actions', async () => {
      const page = await open({
        settings: {
          bindings: {
            normal: { j: null, J: 'scrollDown', ',a': 'custom:mark', ',g': 'custom:end' },
            caret: {},
            visual: {},
            line: {},
          },
          customActions: [
            {
              id: 'custom:mark',
              label: '標記文章',
              action: 'click',
              selector: '#action',
              origin: ORIGIN,
            },
            {
              id: 'custom:end',
              label: '跳到頁尾正文',
              action: 'scroll',
              selector: '#page-end',
              origin: ORIGIN,
            },
          ],
        },
      });
      await page.locator('#nested-scroll').focus();
      await page.keyboard.press('j');
      assert.equal(
        await page.locator('#nested-scroll').evaluate((element) => element.scrollTop),
        0
      );
      await page.keyboard.press('J');
      await page.waitForFunction(() => document.querySelector('#nested-scroll').scrollTop >= 60);
      await keys(page, [',', 'a']);
      assert.deepEqual(await page.evaluate(() => window.__actions), ['action']);
      await page.keyboard.press('?');
      assert.ok(await page.getByRole('button', { name: '標記文章', exact: true }).isVisible());
      await page.keyboard.press('Escape');
      const before = await page.locator('#page-end').boundingBox();
      assert.ok(before.y > 1000, 'Unique custom target starts outside viewport');
      await keys(page, [',', 'g']);
      await page.waitForFunction(() => {
        const rect = document.querySelector('#page-end').getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      });
    });

    it('validates imported settings atomically and synchronizes updated keys', async () => {
      const page = await open();
      await page.getByRole('button', { name: '設定', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Vim Navigation 設定' });
      const json = dialog.getByRole('textbox', { name: '設定 JSON' });
      const baseline = JSON.parse(await json.inputValue());
      const storedBefore = await page.evaluate(() => JSON.stringify(window.__gmStore));
      const invalid = [
        '{broken json',
        JSON.stringify({ ...baseline, schemaVersion: 999 }),
        JSON.stringify({ ...baseline, hintDetection: 'unknown' }),
        JSON.stringify({
          ...baseline,
          sites: { [ORIGIN]: { enabled: true, hintDetection: 'unknown' } },
        }),
        JSON.stringify({
          ...baseline,
          bindings: { ...baseline.bindings, normal: { g: 'scrollDown' } },
        }),
        JSON.stringify({
          ...baseline,
          customActions: [{ id: 'custom:broken', label: 'Broken', action: 'click', selector: '[' }],
        }),
        JSON.stringify({
          ...baseline,
          bindings: { ...baseline.bindings, normal: { J: 'missingCommand' } },
        }),
      ];
      for (const payload of invalid) {
        await json.fill(payload);
        await dialog.getByRole('button', { name: '套用 JSON', exact: true }).click();
        assert.equal(await dialog.getByRole('status').getAttribute('data-error'), 'true');
        assert.equal(await page.evaluate(() => JSON.stringify(window.__gmStore)), storedBefore);
      }
      const updated = {
        ...baseline,
        theme: 'dark',
        bindings: { ...baseline.bindings, normal: { j: null, J: 'scrollDown' } },
      };
      await json.fill(JSON.stringify(updated));
      await dialog.getByRole('button', { name: '套用 JSON', exact: true }).click();
      await page.waitForFunction(() => window.__gmStore.vimNavigationConfig?.theme === 'dark');
      assert.equal(await page.locator(UI).getAttribute('data-theme'), 'dark');
      await dialog.getByRole('button', { name: '關閉設定' }).click();
      await page.keyboard.press('?');
      const help = page.getByRole('dialog', { name: '完整指令小抄' });
      await help.getByRole('searchbox', { name: '搜尋指令' }).fill('scrollDown');
      assert.match(await help.locator('.help-keys').innerText(), /J/);
      assert.doesNotMatch(await help.locator('.help-keys').innerText(), /j/);
    });

    it('preserves selection through dock controls and persists dragged position', async () => {
      const page = await open();
      await select(page, 'inline-text', 0, 11);
      await page.getByRole('button', { name: '收合小抄', exact: true }).click();
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
      await page.getByRole('button', { name: '展開小抄', exact: true }).click();
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
      const handle = page.locator(`${UI} .drag-handle`);
      const original = await handle.boundingBox();
      await page.mouse.move(original.x + 30, original.y + 12);
      await page.mouse.down();
      await page.mouse.move(original.x + 350, original.y - 150, { steps: 8 });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha bravo');
      await page.waitForFunction(() => window.__gmStore.vimNavigationConfig?.ui?.position !== null);
      const dragged = await page.locator(`${UI} .card`).boundingBox();
      await page.reload();
      await mode(page, 'normal');
      const restored = await page.locator(`${UI} .card`).boundingBox();
      assert.ok(Math.abs(dragged.x - restored.x) < 2);
      assert.ok(Math.abs(dragged.y - restored.y) < 2);
    });

    it('hints all 17 roving ARIA tree rows and preserves their secondary action', async () => {
      const page = await openInteraction({
        settings: { hintDetection: 'broad', ui: { collapsed: false, position: null } },
      });
      const beforeDock = await page.locator(`${UI} .card`).boundingBox();
      const finalRow = await page.locator('#tree-row-16').boundingBox();
      assert.ok(
        beforeDock.y < finalRow.y && beforeDock.x + beforeDock.width >= finalRow.x + finalRow.width,
        'Normal dock covers the last tree rows before Hints mode shrinks it'
      );
      await page.keyboard.press('f');
      await mode(page, 'hints');
      for (let index = 0; index < 17; index++) {
        assert.equal(
          await page.locator(`${OVERLAYS} [data-target-id="tree-row-${index}"]`).count(),
          1,
          `Tree row ${index} has exactly one semantic hint`
        );
        assert.equal(
          await page.locator(`${OVERLAYS} [data-target-id="tree-label-${index}"]`).count(),
          0,
          'Its label must not be duplicated'
        );
        assert.equal(
          await page.locator(`${OVERLAYS} [data-target-id="tree-wrapper-${index}"]`).count(),
          0,
          'A pointer wrapper must not duplicate the semantic tree hint'
        );
      }
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="tree-secondary"]`).count(), 1);
      assert.equal(
        await page.locator(`${OVERLAYS} [data-target-id="tree-chevron"]`).count(),
        1,
        'Explicit chevron handler remains independently hinted'
      );
      await page.screenshot({ path: join(OUT, `${engine}-aria-tree.png`), caret: 'initial' });
      await chooseHint(page, 'tree-row-16');
      assert.deepEqual(
        await page.evaluate(() => window.__actions),
        ['tree-16'],
        'Activates the label region, not an inert wrapper'
      );
      await page.keyboard.press('f');
      await chooseHint(page, 'tree-chevron');
      assert.deepEqual(await page.evaluate(() => window.__actions), ['tree-16', 'chevron']);
      await page.keyboard.press('f');
      await chooseHint(page, 'tree-row-0');
      assert.deepEqual(await page.evaluate(() => window.__actions), [
        'tree-16',
        'chevron',
        'tree-0',
      ]);
      await page.keyboard.press('f');
      await chooseHint(page, 'tree-secondary');
      assert.deepEqual(await page.evaluate(() => window.__actions), [
        'tree-16',
        'chevron',
        'tree-0',
        'secondary',
      ]);
    });

    it('applies precise, broad and aggressive detection plus a per-site override', async () => {
      for (const level of ['precise', 'broad', 'aggressive']) {
        const page = await openInteraction({ settings: { hintDetection: level } });
        await page.keyboard.press('f');
        await mode(page, 'hints');
        const hinted = (id) => page.locator(`${OVERLAYS} [data-target-id="${id}"]`).count();
        assert.equal(await hinted('native-link'), 1);
        assert.equal(await hinted('aria-tab'), 1);
        assert.equal(await hinted('explicit-click'), level === 'precise' ? 0 : 1);
        assert.equal(await hinted('cursor-only'), level === 'precise' ? 0 : 1);
        assert.equal(await hinted('weak-pair'), level === 'aggressive' ? 1 : 0);
        assert.equal(await hinted('weak-single'), 0, 'A lone negative tabindex is insufficient');
      }
      const page = await openInteraction({
        settings: {
          hintDetection: 'precise',
          sites: { [ORIGIN]: { enabled: true, hintDetection: 'aggressive' } },
        },
      });
      await page.keyboard.press('f');
      await mode(page, 'hints');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="weak-pair"]`).count(), 1);
    });

    it('finds opacity-zero heading permalinks while rejecting hidden ancestors', async () => {
      const page = await openInteraction({ settings: { hintDetection: 'precise' } });
      assert.equal(
        await page.locator('#heading-anchor').evaluate((el) => getComputedStyle(el).opacity),
        '0'
      );
      await page.keyboard.press('f');
      await mode(page, 'hints');
      assert.equal(
        await page.locator(`${OVERLAYS} [data-target-id="hidden-heading-anchor"]`).count(),
        0
      );
      assert.equal(
        await page.locator(`${OVERLAYS} [data-target-id="invisible-button"]`).count(),
        0
      );
      await chooseHint(page, 'heading-anchor');
      assert.deepEqual(await page.evaluate(() => window.__actions), ['heading-anchor']);
    });

    it('uses an unobstructed later rectangle of a wrapped link', async () => {
      const page = await openInteraction();
      const cover = await page.locator('#line-cover').boundingBox();
      assert.ok(await page.locator('#multi-link').evaluate((el) => el.getClientRects().length > 1));
      await page.keyboard.press('f');
      await mode(page, 'hints');
      const marker = page.locator(`${OVERLAYS} [data-target-id="multi-link"]`);
      assert.equal(await marker.count(), 1);
      const position = await marker.boundingBox();
      assert.ok(position.y >= cover.y + cover.height - 6, 'Label follows an uncovered line');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="covered-button"]`).count(), 0);
      await chooseHint(page, 'multi-link');
      assert.deepEqual(await page.evaluate(() => window.__actions), ['multi-link']);
    });

    it('places zv at the first readable character and chooses fine paragraph targets', async () => {
      const page = await openInteraction();
      await page.locator('#zv-leading').scrollIntoViewIfNeeded();
      await keys(page, ['z', 'v']);
      await mode(page, 'hints');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="zv-wrapper"]`).count(), 0);
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="empty-caret"]`).count(), 0);
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="zv-inner"]`).count(), 1);
      await chooseHint(page, 'zv-leading');
      await mode(page, 'caret');
      const caret = await page.evaluate(() => ({
        collapsed: getSelection().isCollapsed,
        text: getSelection().focusNode.data.slice(getSelection().focusOffset),
        paragraph: getSelection().focusNode.parentElement.closest('p')?.id,
      }));
      assert.equal(caret.collapsed, true);
      assert.equal(caret.paragraph, 'zv-leading');
      assert.ok(caret.text.startsWith('First meaningful text'));
      await page.keyboard.press('Escape');
      await page.locator('#zv-scroll').scrollIntoViewIfNeeded();
      await page.locator('#zv-scroll').evaluate((el) => {
        el.scrollTop = 80;
      });
      await keys(page, ['z', 'v']);
      await chooseHint(page, 'zv-long');
      await mode(page, 'caret');
      assert.equal(
        await page.evaluate(() => getSelection().focusNode.data.slice(getSelection().focusOffset)),
        'Paragraph start above the viewport.'
      );
      const visibleCaret = await page.evaluate(() => {
        const selection = getSelection();
        const range = selection.getRangeAt(0).cloneRange();
        range.setEnd(selection.focusNode, selection.focusOffset + 1);
        const rect = range.getBoundingClientRect();
        const container = document.querySelector('#zv-scroll').getBoundingClientRect();
        return rect.top >= container.top && rect.bottom <= container.bottom;
      });
      assert.equal(
        visibleCaret,
        true,
        'Explicit paragraph start is scrolled into the nested viewport'
      );
    });

    it('opens a JavaScript hover menu, then supports f and explicit Caret entry', async () => {
      const page = await openInteraction();
      const originalFocus = await page.evaluate(() => document.activeElement.tagName);
      await keys(page, ['z', 'h']);
      await chooseHint(page, 'js-hover');
      await mode(page, 'normal');
      assert.equal(await page.locator(UI).getAttribute('data-hover-active'), 'true');
      assert.equal(await page.locator('#js-menu').isVisible(), true);
      assert.equal(await page.locator(`${UI} .mode-description`).isVisible(), true);
      assert.match(
        await page.locator(`${UI} .mode-description`).innerText(),
        /Hover 保持中.*Esc 清除/
      );
      await page.screenshot({ path: join(OUT, `${engine}-hover-menu.png`), caret: 'initial' });
      const events = await page.evaluate(() => window.__hoverEvents);
      for (const type of [
        'pointerover',
        'pointerenter',
        'mouseover',
        'mouseenter',
        'pointermove',
        'mousemove',
      ])
        assert.ok(
          events.some((event) => event.type === type),
          type
        );
      assert.ok(events.every((event) => !event.trusted));
      assert.ok(
        !events.some((event) => ['click', 'pointerdown', 'mousedown', 'focus'].includes(event.type))
      );
      assert.equal(await page.evaluate(() => document.activeElement.tagName), originalFocus);
      await page.keyboard.press('f');
      await chooseHint(page, 'hover-menu-action');
      assert.deepEqual(await page.evaluate(() => window.__actions), ['hover-menu-action']);
      await keys(page, ['z', 'h']);
      await chooseHint(page, 'js-hover');
      await keys(page, ['z', 'v']);
      await chooseHint(page, 'hover-text');
      await mode(page, 'caret');
      assert.equal(
        await page.evaluate(() => getSelection().focusNode.data.slice(getSelection().focusOffset)),
        'Hover menu readable paragraph.'
      );
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
      assert.equal(
        await page.locator('#js-menu').isVisible(),
        true,
        'First Escape exits Caret while retaining hover'
      );
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#js-menu').isVisible(), false);
      assert.equal(await page.locator(UI).getAttribute('data-hover-active'), 'false');
      await page.evaluate(() => {
        window.__removeHoverText = true;
      });
      await keys(page, ['z', 'h']);
      await chooseHint(page, 'js-hover');
      await keys(page, ['z', 'v']);
      await chooseHint(page, 'hover-text');
      await keys(page, ['v', '4', 'l', 'y']);
      await waitClipboard(page, 'Hover');
      await mode(page, 'normal');
      await page.waitForFunction(() => !document.getElementById('hover-text'));
      assert.match(await page.locator(`${UI} .status`).innerText(), /已複製/);
      assert.doesNotMatch(await page.locator(`${UI} .status`).innerText(), /已變更/);
    });

    it('does not turn synthetic hover into CSS hover, click or focus', async () => {
      const page = await openInteraction();
      const originalFocus = await page.evaluate(() => document.activeElement.tagName);
      await keys(page, ['z', 'h']);
      await chooseHint(page, 'css-hover');
      assert.equal(await page.locator('#css-hover').evaluate((el) => el.matches(':hover')), false);
      assert.equal(await page.locator('#css-menu').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.__actions), []);
      assert.equal(await page.evaluate(() => document.activeElement.tagName), originalFocus);
      assert.match(await page.locator(`${UI} .hover-status`).innerText(), /hover/i);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator(UI).getAttribute('data-hover-active'), 'false');
    });

    it('supports declarative custom hover actions', async () => {
      const page = await openInteraction({
        settings: {
          bindings: { normal: { zx: 'custom:menu' }, caret: {}, visual: {}, line: {} },
          customActions: [
            {
              id: 'custom:menu',
              label: 'Hover the menu',
              action: 'hover',
              selector: '#js-hover',
              origin: ORIGIN,
            },
          ],
        },
      });
      await keys(page, ['z', 'x']);
      assert.equal(await page.locator('#js-menu').isVisible(), true);
      assert.equal(await page.locator(UI).getAttribute('data-hover-active'), 'true');
      assert.deepEqual(await page.evaluate(() => window.__actions), []);
    });

    it('owns actual find/help/settings typing and tail keyup against hostile page handlers', async () => {
      const page = await openInteraction();
      await page.evaluate(() => {
        window.__hostileKeys = true;
      });
      await page.keyboard.press('/');
      const find = page.getByRole('searchbox', { name: '搜尋此頁文字' });
      await page.keyboard.type('tree /?');
      assert.equal(await find.inputValue(), 'tree /?');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('replacement');
      assert.equal(await find.inputValue(), 'replacement');
      await page.keyboard.down('Escape');
      await mode(page, 'normal');
      await page.keyboard.up('Escape');
      assert.deepEqual(
        await page.evaluate(() =>
          window.__siteKeys.filter((event) => event.type.startsWith('key'))
        ),
        []
      );
      await page.keyboard.press('?');
      const help = page.getByRole('searchbox', { name: '搜尋指令' });
      await help.focus();
      await page.evaluate(() => {
        window.__siteKeys = [];
      });
      await page.keyboard.type('scrollDown /?');
      assert.equal(await help.inputValue(), 'scrollDown /?');
      await page.keyboard.down('Escape');
      await page.keyboard.up('Escape');
      assert.deepEqual(
        await page.evaluate(() =>
          window.__siteKeys.filter((event) => event.type.startsWith('key'))
        ),
        []
      );
      await page.getByRole('button', { name: '設定', exact: true }).click();
      const json = page.getByRole('textbox', { name: '設定 JSON' });
      await json.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('{"test":"/?zh"}');
      assert.equal(await json.inputValue(), '{"test":"/?zh"}');
      await page.keyboard.down('Escape');
      await page.keyboard.up('Escape');
      assert.deepEqual(
        await page.evaluate(() =>
          window.__siteKeys.filter((event) => event.type.startsWith('key'))
        ),
        []
      );
      await page.keyboard.press('q');
      assert.ok(
        await page.evaluate(() => window.__siteKeys.some((event) => event.key === 'q')),
        'Unbound page shortcut is still delivered outside owned UI'
      );
      await page.keyboard.press('Alt+Shift+V');
      await mode(page, 'paused');
      await page.evaluate(() => {
        window.__siteKeys = [];
      });
      await page.keyboard.press('j');
      assert.ok(
        await page.evaluate(() => window.__siteKeys.some((event) => event.key === 'j')),
        'Paused page owns normal navigation keys'
      );
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await page.evaluate(() => {
        window.__siteKeys = [];
      });
      await page.getByRole('textbox', { name: '設定 JSON' }).focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('{"paused":true}');
      assert.equal(
        await page.getByRole('textbox', { name: '設定 JSON' }).inputValue(),
        '{"paused":true}'
      );
      await page.keyboard.press('Escape');
      await mode(page, 'paused');
      assert.deepEqual(
        await page.evaluate(() =>
          window.__siteKeys.filter((event) => event.type.startsWith('key'))
        ),
        []
      );
    });

    it('does not activate a restored website button during a held UI Enter key cycle', async () => {
      const page = await openInteraction();
      await page.locator('#css-hover').focus();
      await page.keyboard.press('/');
      await page.keyboard.type('Native');
      await page.keyboard.down('Enter');
      await mode(page, 'normal');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'css-hover');
      await page.keyboard.down('Enter');
      await page.keyboard.up('Enter');
      assert.deepEqual(
        await page.evaluate(() => window.__actions),
        [],
        'A held UI key must not trigger the restored page control'
      );
      await page.keyboard.press('Enter');
      assert.deepEqual(
        await page.evaluate(() => window.__actions),
        ['css-click'],
        'A fresh website key cycle retains its native action'
      );
    });

    it('keeps IME editing uncancelled while shielding its keyboard events', async () => {
      const page = await openInteraction();
      await page.evaluate(() => {
        window.__hostileKeys = true;
      });
      await page.keyboard.press('/');
      const state = await page
        .getByRole('searchbox', { name: '搜尋此頁文字' })
        .evaluate((input) => {
          const prevented = [];
          for (const event of [
            new CompositionEvent('compositionstart', { bubbles: true, composed: true }),
            new CompositionEvent('compositionupdate', {
              bubbles: true,
              composed: true,
              data: '中文',
            }),
            new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              bubbles: true,
              composed: true,
              cancelable: true,
              isComposing: true,
            }),
            new InputEvent('beforeinput', {
              inputType: 'insertCompositionText',
              data: '中文',
              isComposing: true,
              bubbles: true,
              composed: true,
              cancelable: true,
            }),
          ]) {
            input.dispatchEvent(event);
            prevented.push(event.defaultPrevented);
          }
          input.value = '中文';
          input.dispatchEvent(
            new InputEvent('input', {
              inputType: 'insertCompositionText',
              data: '中文',
              isComposing: true,
              bubbles: true,
              composed: true,
            })
          );
          input.dispatchEvent(
            new CompositionEvent('compositionend', { bubbles: true, composed: true, data: '中文' })
          );
          return { prevented, value: input.value };
        });
      assert.ok(state.prevented.every((value) => value === false));
      assert.equal(state.value, '中文');
      await mode(page, 'find');
      assert.deepEqual(
        await page.evaluate(() =>
          window.__siteKeys.filter((event) => event.type.startsWith('key'))
        ),
        []
      );
      await page.keyboard.press('Escape');
      await mode(page, 'normal');
    });

    it('preserves legacy settings and custom zh prefixes when adding the hover command', async () => {
      for (const binding of ['zh', 'zha']) {
        const page = await openInteraction({
          legacy: true,
          settings: {
            bindings: { normal: { [binding]: 'copyUrl' }, caret: {}, visual: {}, line: {} },
            scrollStep: 96,
            theme: 'dark',
          },
        });
        await keys(page, [...binding]);
        await waitClipboard(page, PAGE_URL);
        await page.keyboard.press('f');
        await mode(page, 'hints');
        assert.equal(
          await page.locator(`${OVERLAYS} [data-target-id="explicit-click"]`).count(),
          1,
          'Old missing detection field defaults to broad'
        );
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '設定', exact: true }).click();
        const saved = JSON.parse(
          await page.getByRole('textbox', { name: '設定 JSON' }).inputValue()
        );
        assert.equal(saved.scrollStep, 96);
        assert.equal(saved.theme, 'dark');
        assert.equal(saved.bindings.normal[binding], 'copyUrl');
        assert.equal(
          await page.getByRole('combobox', { name: '全域提示偵測' }).inputValue(),
          'broad'
        );
      }
    });

    it('saves per-site detection and restores inheritance through settings', async () => {
      const page = await openInteraction();
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await page.getByRole('combobox', { name: '全域提示偵測' }).selectOption('precise');
      await page.getByRole('combobox', { name: '本站提示偵測' }).selectOption('aggressive');
      await page.getByRole('button', { name: '儲存偏好', exact: true }).click();
      await page.reload();
      await mode(page, 'normal');
      await page.keyboard.press('f');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="weak-pair"]`).count(), 1);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '設定', exact: true }).click();
      await page.getByRole('combobox', { name: '本站提示偵測' }).selectOption('');
      await page.getByRole('button', { name: '儲存偏好', exact: true }).click();
      await page.getByRole('button', { name: '關閉設定', exact: true }).click();
      await page.keyboard.press('f');
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="weak-pair"]`).count(), 0);
      assert.equal(await page.locator(`${OVERLAYS} [data-target-id="explicit-click"]`).count(), 0);
    });

    it('renders light/dark cheatsheets and keeps the dock inside a narrow viewport', async () => {
      for (const theme of ['light', 'dark']) {
        const page = await open({ settings: { theme }, colorScheme: theme });
        await mode(page, 'normal');
        await page.screenshot({ path: join(OUT, `${engine}-${theme}.png`) });
        await page.keyboard.press('?');
        await page.screenshot({ path: join(OUT, `${engine}-${theme}-help.png`) });
      }
      const page = await open({ width: 480 });
      await mode(page, 'normal');
      const bounds = await page.locator(`${UI} .card`).boundingBox();
      assert.ok(bounds, 'Visible dock');
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 481, 'Dock fits viewport');
      await page.screenshot({ path: join(OUT, `${engine}-narrow.png`) });
    });
  });
}
