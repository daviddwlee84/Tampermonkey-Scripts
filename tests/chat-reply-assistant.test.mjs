import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = await read('userscripts/chat-reply-assistant/chat-reply-assistant.user.js');
const FIXTURE = await read('tests/fixtures/chat-reply-assistant/chat.html');
const SEMANTIC_FIXTURES = {
  instagram: await read('tests/fixtures/chat-reply-assistant/instagram-semantic.html'),
  messenger: await read('tests/fixtures/chat-reply-assistant/messenger-semantic.html'),
};
const OUT = new URL('../.preview/chat-reply-assistant-tests/', import.meta.url);
await mkdir(OUT, { recursive: true });
const REPLIES = ['好啊 到時見', '可以 我晚點找你', '好 沒問題'];
const KEY = 'fixture-gemini-key-not-real';
const SETTINGS_KEY = 'chat-reply-assistant.settings.v1';
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

// 這是 fixture 專用的 manager 替身，不代表真實 extension grants。
// sessionStorage 僅供 harness 模擬重載；腳本的每次 GM 寫入與請求另外記錄。
function managerShim(replies, initialSettings, pixel) {
  const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  window.__gmStore = JSON.parse(sessionStorage.getItem('__cra_fixture_store') || '{}');
  if (initialSettings && !window.__gmStore['chat-reply-assistant.settings.v1'])
    window.__gmStore['chat-reply-assistant.settings.v1'] = copy(initialSettings);
  window.__gmWrites = [];
  window.__gmCalls = [];
  window.__gmPending = [];
  window.__gmClipboard = null;
  window.__gmMenus = [];
  window.__gmMode = 'success';
  window.__gmJevMode = 'success';
  window.__gmModelsMode = 'success';
  window.__gmImageMode = 'success';
  window.GM_getValue = (key, fallback) => copy(window.__gmStore[key] ?? fallback);
  window.GM_setValue = (key, value) => {
    window.__gmStore[key] = copy(value);
    window.__gmWrites.push({ key, value: copy(value) });
    sessionStorage.setItem('__cra_fixture_store', JSON.stringify(window.__gmStore));
  };
  window.GM_deleteValue = (key) => {
    delete window.__gmStore[key];
    window.__gmWrites.push({ key, deleted: true });
    sessionStorage.setItem('__cra_fixture_store', JSON.stringify(window.__gmStore));
  };
  window.GM_setClipboard = (text) => {
    window.__gmClipboard = text;
  };
  window.GM_registerMenuCommand = (name, callback) => window.__gmMenus.push({ name, callback });
  window.GM_unregisterMenuCommand = () => {};
  window.GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);
    return style;
  };
  window.__gmReply = (index, body, status = 200) => {
    const call = window.__gmCalls[index];
    const pending = window.__gmPending[index];
    call.completed = true;
    pending.onload?.({
      status,
      statusText: status === 200 ? 'OK' : 'Fixture failure',
      responseText: typeof body === 'string' ? body : JSON.stringify(body),
      response: typeof body === 'string' ? body : JSON.stringify(body),
      responseHeaders: 'content-type: application/json',
      finalUrl: call.url,
    });
  };
  window.GM_xmlhttpRequest = (options) => {
    const index = window.__gmCalls.length;
    const url = new URL(options.url);
    const isJev =
      url.hostname === 'api.typesafe.ai' ||
      (url.hostname === 'ai-gateway.vercel.sh' && url.pathname.includes('/systemone'));
    const isImage = options.responseType === 'blob' || options.responseType === 'arraybuffer';
    const isModels = options.method === 'GET' && !isImage;
    const call = {
      url: options.url,
      method: options.method,
      headers: copy(options.headers),
      data: options.data,
      anonymous: options.anonymous,
      aborted: false,
      completed: false,
      isJev,
      isImage,
      isModels,
      responseType: options.responseType,
    };
    window.__gmCalls.push(call);
    window.__gmPending.push(options);
    const mode = isImage
      ? window.__gmImageMode
      : isModels
        ? window.__gmModelsMode
        : isJev
          ? window.__gmJevMode
          : window.__gmMode;
    if (mode !== 'pending')
      queueMicrotask(() => {
        if (call.aborted) return;
        if (mode === 'error')
          return window.__gmReply(index, { error: { message: 'Fixture unavailable' } }, 503);
        if (/^http\d{3}$/.test(mode))
          return window.__gmReply(
            index,
            { error: { message: 'Fixture rejected' } },
            Number(mode.slice(4))
          );
        if (isModels)
          return window.__gmReply(index, {
            object: 'list',
            data: [
              { id: 'fixture-model', display_name: 'Fixture model', owned_by: 'fixture' },
              { id: 'fixture/vision-model', name: 'Vision fixture', owned_by: 'fixture' },
            ],
          });
        if (isImage) {
          const type = mode === 'invalid-mime' ? 'text/html' : 'image/png';
          const bytes = Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0));
          const blob = new Blob([mode === 'oversize' ? new Uint8Array(13 * 1024 * 1024) : bytes], {
            type,
          });
          call.completed = true;
          options.onprogress?.({ loaded: blob.size, total: blob.size, lengthComputable: true });
          if (!call.aborted)
            options.onload?.({
              status: 200,
              response: blob,
              responseHeaders: `content-type: ${type}`,
              finalUrl: call.url,
            });
          return;
        }
        if (mode === 'malformed')
          return window.__gmReply(index, {
            choices: [{ message: { content: 'This is not the requested JSON.' } }],
          });
        if (isJev)
          return window.__gmReply(index, {
            answers: {
              tone: { type: 'choice', choice: 'anxious' },
              intent: { type: 'choice', choice: 'question' },
              needsGentleResponse: { type: 'noul', noul: 0.6 },
            },
          });
        window.__gmReply(index, {
          choices: [{ message: { content: JSON.stringify({ replies }) } }],
        });
      });
    return {
      abort() {
        call.aborted = true;
        options.onabort?.({});
      },
    };
  };
  window.GM = {
    getValue: async (...args) => window.GM_getValue(...args),
    setValue: async (...args) => window.GM_setValue(...args),
    deleteValue: async (...args) => window.GM_deleteValue(...args),
    setClipboard: async (...args) => window.GM_setClipboard(...args),
    registerMenuCommand: window.GM_registerMenuCommand,
  };
}

const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
].filter(([name]) => !process.env.US_BROWSERS || process.env.US_BROWSERS.split(',').includes(name));
assert.ok(engines.length, 'US_BROWSERS must include chromium or firefox');

for (const [engineName, engine] of engines) {
  describe(`${engineName} chat reply assistant delivered userscript`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open({
      platform = 'instagram',
      group = false,
      clock = false,
      initialSettings,
      fixture = FIXTURE,
      expectedText = '喝咖啡',
    } = {}) {
      const page = await browser.newPage({
        viewport: { width: 1360, height: 950 },
        colorScheme: 'light',
      });
      page.setDefaultTimeout(5000);
      const errors = [],
        logs = [],
        network = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => logs.push(message.text()));
      await page.route('**/*', (route) => {
        const request = route.request();
        if (
          request.isNavigationRequest() &&
          /^https:\/\/www\.(instagram|messenger)\.com\//.test(request.url())
        )
          return route.fulfill({ contentType: 'text/html', body: fixture });
        if (request.resourceType() === 'image' && /\/fixtures?\//.test(request.url()))
          return route.fulfill({ contentType: 'image/png', body: Buffer.from(PIXEL, 'base64') });
        network.push(request.url());
        return route.abort();
      });
      // 同一個 init script 保證 shim → 發佈腳本的順序。
      await page.addInitScript({
        content: `(${managerShim})(${JSON.stringify(REPLIES)},${JSON.stringify(initialSettings)},${JSON.stringify(PIXEL)});\ndocument.addEventListener("DOMContentLoaded", () => {\n${SOURCE}\n}, { once: true });`,
      });
      if (clock) await page.clock.install({ time: new Date('2026-09-24T12:10:00Z') });
      const url =
        platform === 'instagram'
          ? 'https://www.instagram.com/direct/t/100/'
          : 'https://www.messenger.com/t/100';
      await page.goto(`${url}${group ? '?group=1' : ''}`);
      const root = page.locator('#chat-reply-assistant');
      await root.waitFor();
      if (!(await root.locator('#panel').isVisible())) await root.locator('#toggle-panel').click();
      await page.waitForFunction(
        (text) =>
          document
            .querySelector('#chat-reply-assistant')
            ?.shadowRoot?.querySelector('#context')
            ?.value.includes(text),
        expectedText
      );
      return { page, root, errors, logs, network };
    }

    async function settings(root, values = {}) {
      if (!(await root.locator('#settings').isVisible()))
        await root.locator('#settings-toggle').click();
      await root.locator('#model').fill('fixture-model');
      await root.locator('#api-key').fill(KEY);
      for (const [id, value] of Object.entries(values)) {
        const input = root.locator(`#${id}`);
        if (typeof value === 'boolean') await input.setChecked(value);
        else if ((await input.evaluate((node) => node.tagName)) === 'SELECT')
          await input.selectOption(String(value));
        else await input.fill(String(value));
      }
      await root.locator('#save-settings').click();
    }
    async function showSettings(root) {
      if (!(await root.locator('#settings').isVisible()))
        await root.locator('#settings-toggle').click();
    }
    async function showSelection(root) {
      if (!(await root.locator('#selection-view').isVisible()))
        await root.locator('#selection-toggle').click();
    }
    async function selectionAction(root, selector) {
      await showSelection(root);
      await root.locator(selector).click();
      await root.locator('#selection-done').click();
    }
    function userData(request) {
      const message = JSON.parse(request.data).messages.find((item) => item.role === 'user');
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content.find((part) => part.type === 'text').text;
      return JSON.parse(text);
    }
    async function calls(page) {
      return page.evaluate(() => window.__gmCalls);
    }
    async function waitCalls(page, number) {
      try {
        await page.waitForFunction((n) => window.__gmCalls.length >= n, number);
      } catch {
        const state = await page.evaluate(() => {
          const root = document.querySelector('#chat-reply-assistant').shadowRoot;
          const log = document.querySelector('[role="log"], .message-scroller');
          return {
            calls: window.__gmCalls.length,
            status: root.querySelector('#status').textContent,
            capture: root.querySelector('#capture-status').textContent,
            context: root.querySelector('#context').value,
            auto: root.querySelector('#auto').checked,
            scroll: log ? [log.scrollTop, log.scrollHeight, log.clientHeight] : null,
            now: Date.now(),
          };
        });
        assert.fail(`Expected ${number} API calls; ${JSON.stringify(state)}`);
      }
    }
    async function generated(root) {
      await root.locator('#generate').click();
      await root.locator('#replies [data-reply]').nth(2).waitFor();
    }
    async function advance(page, ms) {
      await page.clock.runFor(ms);
    }
    async function checkClean({ errors, logs, network }) {
      assert.deepEqual(errors, []);
      assert.deepEqual(network, [], 'no real API/network request may escape the fixture');
      assert.doesNotMatch(logs.join('\n'), /fixture-gemini-key-not-real|週六有空嗎|一起去喝咖啡吧/);
    }
    async function addPhotos(page, count = 1) {
      await page.evaluate((count) => {
        for (let i = 0; i < count; i++) {
          const id = `photo-${i}`;
          window.__chatFixture.add({ id, text: `PHOTO CAPTION ${i}`, sender: 'Alice' });
          const row = document.querySelector(`[data-message-id="${id}"]`);
          const open = document.createElement('button');
          open.setAttribute('aria-label', 'Open photo');
          const image = document.createElement('img');
          image.alt = `Shared photo ${i}`;
          image.src = `https://scontent.cdninstagram.com/fixture/photo-${i}.png`;
          open.append(image);
          row.append(open);
        }
      }, count);
      await page.waitForFunction(() =>
        document
          .querySelector('#chat-reply-assistant')
          .shadowRoot.querySelector('#context')
          .value.includes('PHOTO CAPTION')
      );
    }

    for (const platform of ['instagram', 'messenger']) {
      it(`${platform}: previews visible messages, generates three suggestions and never sends`, async () => {
        const harness = await open({ platform });
        const { page, root } = harness;
        try {
          const context = await root.locator('#context').inputValue();
          assert.match(context, /Alice/);
          assert.match(context, /週六有空嗎/);
          assert.match(context, /有啊 想去哪/);
          assert.doesNotMatch(context, /SIDEBAR SENTINEL/);
          assert.equal((await calls(page)).length, 0);
          await settings(root, { 'system-prompt': '用繁體中文 不使用標點符號' });
          await generated(root);
          assert.equal(await root.locator('#replies [data-reply]').count(), 3);
          const request = (await calls(page))[0];
          assert.equal(
            request.url,
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
          );
          assert.equal(request.headers.Authorization, `Bearer ${KEY}`);
          assert.equal(JSON.parse(request.data).model, 'fixture-model');
          assert.match(request.data, /不使用標點符號/);
          assert.match(request.data, /喝咖啡/);
          await root.locator('[data-copy]').first().click();
          assert.equal(await page.evaluate(() => window.__gmClipboard), REPLIES[0]);
          await root.locator('[data-insert]').first().click();
          assert.equal(await page.locator('[data-lexical-editor]').innerText(), REPLIES[0]);
          assert.equal(await page.evaluate(() => window.__fixtureSent), 0);
          const store = await page.evaluate(() => window.__gmStore);
          assert.ok(store[SETTINGS_KEY]);
          assert.doesNotMatch(
            JSON.stringify(store),
            /週六有空嗎|有啊 想去哪|一起去喝咖啡吧|好啊 到時見/
          );
          await checkClean(harness);
          if (platform === 'instagram') {
            await root.locator('#panel').evaluate((panel) => {
              panel.scrollTop = 0;
            });
            await page.screenshot({ path: new URL(`${engineName}-reply-panel.png`, OUT).pathname });
            await page.setViewportSize({ width: 375, height: 812 });
            const bounds = await root.locator('#panel').boundingBox();
            assert.ok(
              bounds.x >= 0 && bounds.x + bounds.width <= 375,
              'panel must fit a narrow viewport'
            );
            await page.screenshot({
              path: new URL(`${engineName}-reply-panel-mobile.png`, OUT).pathname,
            });
          }
        } finally {
          await page.close();
        }
      });
    }

    it('keeps Instagram message boundaries when payloads, timestamps and action groups are flat siblings', async () => {
      const harness = await open({ fixture: SEMANTIC_FIXTURES.instagram });
      const { page, root } = harness;
      try {
        await page.evaluate(() => {
          for (const envelope of document.querySelectorAll('.message-envelope'))
            envelope.replaceWith(...envelope.childNodes);
        });
        await selectionAction(root, '#clear-context');
        await showSelection(root);
        assert.equal(await root.locator('.message-card').count(), 5);
        assert.equal(await root.locator('[data-select-image]').count(), 2);
        const texts = await root
          .locator('[data-edit-text]')
          .evaluateAll((nodes) => nodes.map((node) => node.value));
        assert.deepEqual(texts, ['週六有空嗎', '有啊 想去哪', '', '一起去喝咖啡吧', 'Sat 4:05 PM']);
        const context = await root.locator('#context').inputValue();
        assert.match(context, /peer_handle[^\n]*週六有空嗎/);
        assert.match(context, /我[^\n]*有啊 想去哪/);
        assert.doesNotMatch(context, /SIDEBAR SENTINEL|Message actions|Open photo/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('preserves existing drafts, offers explicit append, and keeps per-message edits in memory', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root);
        await root.locator('#auto').check();
        assert.equal(await root.locator('#context').getAttribute('readonly'), '');
        await showSelection(root);
        await root
          .locator('.message-card [data-edit-text]')
          .first()
          .fill('EDITED CONTEXT SENTINEL');
        await root.locator('#selection-done').click();
        await page.evaluate(() => document.querySelector('#chat-reply-assistant').remove());
        await page.waitForFunction(() =>
          document
            .querySelector('#chat-reply-assistant')
            ?.shadowRoot?.querySelector('#context')
            ?.value.includes('EDITED CONTEXT SENTINEL')
        );
        assert.equal(await root.locator('#panel').isVisible(), true);
        assert.equal(await root.locator('#auto').isChecked(), true);
        assert.equal(await root.count(), 1);
        await page.locator('[data-lexical-editor]').fill('EXISTING DRAFT');
        await generated(root);
        assert.match((await calls(page))[0].data, /EDITED CONTEXT SENTINEL/);
        assert.equal(await root.locator('[data-insert]').first().isDisabled(), true);
        await root.locator('[data-append]').first().click();
        const draft = await page.locator('[data-lexical-editor]').innerText();
        assert.ok(draft.startsWith('EXISTING DRAFT'));
        assert.ok(draft.includes(REPLIES[0]));
        assert.equal(await page.evaluate(() => window.__fixtureSent), 0);
        assert.doesNotMatch(
          await page.evaluate(() => JSON.stringify(window.__gmStore)),
          /EDITED CONTEXT SENTINEL|EXISTING DRAFT/
        );
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('reloads provider and thread preferences without storing or replaying generated content', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root, {
          'system-prompt': 'GLOBAL STYLE SENTINEL',
          'thread-prompt': 'THREAD STYLE SENTINEL',
        });
        await generated(root);
        const payload = JSON.parse((await calls(page))[0].data);
        assert.match(JSON.stringify(payload.messages), /THREAD STYLE SENTINEL/);
        await root.locator('#auto').check();
        await page.reload();
        if (!(await root.locator('#panel').isVisible()))
          await root.locator('#toggle-panel').click();
        if (!(await root.locator('#settings').isVisible()))
          await root.locator('#settings-toggle').click();
        assert.equal(await root.locator('#model').inputValue(), 'fixture-model');
        assert.equal(await root.locator('#system-prompt').inputValue(), 'GLOBAL STYLE SENTINEL');
        assert.equal(await root.locator('#thread-prompt').inputValue(), 'THREAD STYLE SENTINEL');
        assert.equal(await root.locator('#auto').isChecked(), true);
        assert.equal(
          await root.locator('#api-key').inputValue(),
          '',
          'saved key must not be refilled into DOM'
        );
        assert.equal(await root.locator('#replies [data-reply]').count(), 0);
        assert.equal((await calls(page)).length, 0);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('places its bar before the native composer and does not cover the page with a floating shell', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        const placement = await root.evaluate((host) => {
          const composer = document.querySelector('[data-lexical-editor]');
          return {
            insideThread: document.querySelector('main > section').contains(host),
            precedesComposer: Boolean(
              host.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
            position: getComputedStyle(host).position,
          };
        });
        assert.equal(placement.insideThread, true);
        assert.equal(placement.precedesComposer, true);
        assert.notEqual(placement.position, 'fixed');
        assert.equal(await root.locator('#details').isVisible(), false);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('freezes the selection editor, preserves exclusions and edits, then includes new text after closing', async () => {
      const harness = await open({ clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await advance(page, 6000);
        await root.locator('#auto').check();
        await advance(page, 6000);
        await showSelection(root);
        assert.equal(await root.locator('.message-card').count(), 3);
        const first = root.locator('.message-card').nth(0);
        const last = root.locator('.message-card').nth(2);
        await first.locator('[data-select-message]').uncheck();
        await last.locator('[data-edit-sender]').fill('Carla');
        await last.locator('[data-edit-direction]').selectOption('other');
        await last.locator('[data-edit-text]').fill('USER CURATED CONTEXT');
        assert.equal(await root.getByRole('option', { name: 'Carla', exact: true }).count(), 1);
        await page.evaluate(() => window.__chatFixture.add({ text: 'NEW WHILE EDITOR OPEN' }));
        await advance(page, 6000);
        assert.equal(await root.locator('.message-card').count(), 3);
        assert.match(await root.locator('#selection-pending').textContent(), /1/);
        assert.doesNotMatch(await root.locator('#context').inputValue(), /NEW WHILE EDITOR OPEN/);
        assert.equal((await calls(page)).length, 0, 'selection editing pauses automatic requests');
        await root.locator('#selection-done').click();
        assert.equal(await root.locator('#details').isVisible(), false);
        const context = await root.locator('#context').inputValue();
        assert.match(context, /NEW WHILE EDITOR OPEN/);
        assert.match(context, /Carla[^\n]*USER CURATED CONTEXT/);
        assert.doesNotMatch(context, /週六有空嗎|一起去喝咖啡吧/);
        await root.locator('#auto').uncheck();
        await generated(root);
        const data = userData((await calls(page))[0]);
        assert.equal(data.transcript, context);
        assert.doesNotMatch(
          await page.evaluate(() => JSON.stringify(window.__gmStore)),
          /USER CURATED|NEW WHILE EDITOR/
        );
        await showSelection(root);
        assert.equal(
          await root.locator('.message-card').first().locator('[data-select-message]').isChecked(),
          false
        );
        await root.locator('#messages-none').click();
        await root.locator('#selection-done').click();
        await root.locator('#generate').click();
        assert.equal((await calls(page)).length, 1, 'empty selection never sends a model request');
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('lists models and diagnoses unsaved provider fields without reading chat or invoking Jev', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await showSettings(root);
        await root.locator('#provider-preset').selectOption('custom');
        await root.locator('#endpoint').fill('http://127.0.0.1:4567/custom/chat/completions');
        await root.locator('#models-url').fill('http://127.0.0.1:4567/catalog/models?fixture=1');
        await root.locator('#model').fill('');
        await root.locator('#api-key').fill('fixture-diagnostic-key');
        await root.locator('#jev-enabled').check();
        await root.locator('#fetch-models').click();
        await waitCalls(page, 1);
        const list = (await calls(page))[0];
        assert.equal(list.method, 'GET');
        assert.equal(list.url, 'http://127.0.0.1:4567/catalog/models?fixture=1');
        assert.equal(list.headers.Authorization, 'Bearer fixture-diagnostic-key');
        await page.waitForFunction(
          () =>
            document
              .querySelector('#chat-reply-assistant')
              .shadowRoot.querySelector('#model-options').children.length === 2
        );
        assert.deepEqual(
          await root
            .locator('#model-options option')
            .evaluateAll((nodes) => nodes.map((node) => node.value)),
          ['fixture-model', 'fixture/vision-model']
        );
        await root.locator('#model').fill('fixture/vision-model');
        await root.locator('#test-model').click();
        await waitCalls(page, 2);
        const diagnosis = (await calls(page))[1];
        assert.equal(diagnosis.url, 'http://127.0.0.1:4567/custom/chat/completions');
        assert.equal(JSON.parse(diagnosis.data).model, 'fixture/vision-model');
        assert.match(diagnosis.data, /Reply with OK/);
        assert.doesNotMatch(diagnosis.data, /週六|喝咖啡|Alice|transcript|optionalTextSignals/);
        assert.equal(
          (await calls(page)).some((call) => call.isJev),
          false
        );
        assert.equal(await root.locator('#replies [data-reply]').count(), 0);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('keeps separate provider credentials and shows correct Gemini/Copilot help and ports', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root);
        await showSettings(root);
        assert.equal(
          await root.locator('#key-help').getAttribute('href'),
          'https://aistudio.google.com/apikey'
        );
        await root.locator('#provider-preset').selectOption('copilot-api');
        assert.equal(
          await root.locator('#endpoint').inputValue(),
          'http://localhost:4141/v1/chat/completions'
        );
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await root.locator('#provider-preset').selectOption('copilot-sdk');
        assert.equal(
          await root.locator('#endpoint').inputValue(),
          'http://localhost:3001/v1/chat/completions'
        );
        await root.locator('#model').fill('sdk-local-model');
        await root.locator('#api-key').fill('fixture-local-proxy-key');
        await root.locator('#save-settings').click();
        await showSettings(root);
        await root.locator('#provider-preset').selectOption('gemini');
        assert.equal(await root.locator('#model').inputValue(), 'fixture-model');
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await root.locator('#save-settings').click();
        await generated(root);
        assert.equal((await calls(page))[0].headers.Authorization, `Bearer ${KEY}`);
        const stored = await page.evaluate((key) => window.__gmStore[key], SETTINGS_KEY);
        assert.equal(stored.version, 2);
        assert.equal(stored.profiles.gemini.apiKey, KEY);
        assert.equal(stored.profiles['copilot-sdk'].apiKey, 'fixture-local-proxy-key');
        assert.equal(stored.profiles['copilot-sdk'].model, 'sdk-local-model');
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('migrates legacy Copilot and TypeSafe settings without reusing their keys for other providers', async () => {
      const harness = await open({
        initialSettings: {
          version: 1,
          preset: 'copilot',
          endpoint: 'http://localhost:3001/v1/chat/completions',
          model: 'legacy-proxy-model',
          apiKey: 'fixture-legacy-proxy-key',
          systemPrompt: 'LEGACY STYLE',
          maxMessages: 25,
          maxChars: 10000,
          jev: { enabled: false, apiKey: 'fixture-legacy-typesafe-key', model: 'jev-latest' },
          threads: {
            'instagram:www.instagram.com:100': { prompt: 'LEGACY THREAD STYLE', auto: true },
          },
        },
      });
      const { page, root } = harness;
      try {
        await showSettings(root);
        assert.equal(await root.locator('#provider-preset').inputValue(), 'copilot-sdk');
        assert.equal(await root.locator('#model').inputValue(), 'legacy-proxy-model');
        assert.equal(await root.locator('#api-key').inputValue(), '');
        assert.equal(await root.locator('#thread-prompt').inputValue(), 'LEGACY THREAD STYLE');
        assert.equal(await root.locator('#auto').isChecked(), true);
        assert.equal(await root.locator('#jev-provider').inputValue(), 'typesafe');
        await root.locator('#jev-provider').selectOption('vercel');
        assert.equal(await root.locator('#jev-model').inputValue(), 'typesafe-ai/jev');
        assert.equal(await root.locator('#jev-key').inputValue(), '');
        await root.locator('#save-settings').click();
        const stored = await page.evaluate((key) => window.__gmStore[key], SETTINGS_KEY);
        assert.equal(stored.version, 2);
        assert.equal(stored.profiles['copilot-sdk'].apiKey, 'fixture-legacy-proxy-key');
        assert.equal(stored.profiles.gemini.apiKey, '');
        assert.equal(stored.jev.profiles.typesafe.apiKey, 'fixture-legacy-typesafe-key');
        assert.equal(stored.jev.profiles.vercel.apiKey, '');
        assert.equal(stored.threads['instagram:www.instagram.com:100'], undefined);
        assert.equal(
          stored.threads['instagram:www.instagram.com:100:account:fixture-self'].prompt,
          'LEGACY THREAD STYLE'
        );
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('clears an unsaved key when its endpoint origin changes and requires deliberate re-entry', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root);
        await showSettings(root);
        await root.locator('#api-key').fill('fixture-unsaved-gemini-key');
        await root.locator('#endpoint').fill('http://127.0.0.1:4567/v1/chat/completions');
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await root.locator('#save-settings').click();
        await generated(root);
        assert.equal((await calls(page))[0].headers.Authorization, undefined);
        assert.doesNotMatch((await calls(page))[0].data, /fixture-unsaved-gemini-key/);
        await showSettings(root);
        await root.locator('#api-key').fill('fixture-intentional-local-key');
        await root.locator('#save-settings').click();
        await generated(root);
        assert.equal(
          (await calls(page))[1].headers.Authorization,
          'Bearer fixture-intentional-local-key'
        );
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('uses the Vercel Jev compatibility endpoint and retains the separate TypeSafe key', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root, { 'jev-key': 'fixture-typesafe-only-key' });
        await settings(root, {
          'jev-provider': 'vercel',
          'jev-enabled': true,
          'jev-key': 'fixture-vercel-only-key',
          'jev-model': 'typesafe-ai/jev',
        });
        await generated(root);
        const requests = await calls(page);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
        assert.equal(requests[0].headers.Authorization, 'Bearer fixture-vercel-only-key');
        assert.equal(JSON.parse(requests[0].data).model, 'typesafe-ai/jev');
        assert.equal(JSON.parse(requests[0].data).questions.needsGentleResponse.type, 'noul');
        assert.equal(userData(requests[1]).optionalTextSignals.tone, 'anxious');
        const stored = await page.evaluate((key) => window.__gmStore[key], SETTINGS_KEY);
        assert.equal(stored.jev.profiles.typesafe.apiKey, 'fixture-typesafe-only-key');
        assert.equal(stored.jev.profiles.vercel.apiKey, 'fixture-vercel-only-key');
        await showSettings(root);
        assert.match(
          await root.locator('#jev-key-help').getAttribute('href'),
          /^https:\/\/vercel\.com\//
        );
        await root.locator('#jev-provider').selectOption('typesafe');
        assert.equal(
          await root.locator('#jev-key-help').getAttribute('href'),
          'https://console.typesafe.ai/keys'
        );
        assert.equal(await root.locator('#jev-key').inputValue(), '');
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const platform of ['instagram', 'messenger']) {
      it(`${platform}: reads semantic markup without artificial sender ids and keeps photos distinct from timestamps and avatars`, async () => {
        const harness = await open({ platform, fixture: SEMANTIC_FIXTURES[platform] });
        const { page, root } = harness;
        try {
          assert.equal(
            await page
              .locator('main [data-message-id], main [data-sender-id], [data-self-id]')
              .count(),
            0
          );
          const context = await root.locator('#context').inputValue();
          assert.match(context, platform === 'instagram' ? /peer_handle/ : /Alice/);
          assert.match(context, /我[^\n]*有啊 想去哪/);
          assert.doesNotMatch(
            context,
            /SIDEBAR SENTINEL|Open photo|Message actions|Sat 4:00 PM|未辨識發言者/
          );
          assert.equal(
            await root.evaluate(
              (host) => host.nextElementSibling === document.querySelector('.composer-shell')
            ),
            true
          );
          await showSelection(root);
          assert.equal(
            await root.locator('.message-card').count(),
            platform === 'instagram' ? 5 : 6
          );
          const texts = await root
            .locator('[data-edit-text]')
            .evaluateAll((nodes) => nodes.map((node) => node.value));
          assert.equal(
            texts.filter((text) => text === 'Sat 4:05 PM').length,
            1,
            'real timestamp-looking message must remain a message'
          );
          assert.equal(
            texts.filter((text) => text === '').length,
            1,
            'image-only message has no invented caption'
          );
          const photos = root.locator('[data-select-image]');
          assert.equal(await photos.count(), platform === 'instagram' ? 2 : 1);
          assert.deepEqual(
            await photos.evaluateAll((nodes) => nodes.map((node) => node.checked)),
            platform === 'instagram' ? [false, false] : [false]
          );
          await page.screenshot({
            path: new URL(`${engineName}-${platform}-semantic-selection.png`, OUT).pathname,
          });
          await root.locator('#selection-done').click();
          await page.evaluate(() => window.__semanticFixture.remountComposer());
          await page.waitForFunction(
            () =>
              document.querySelector('#chat-reply-assistant')?.nextElementSibling ===
              document.querySelector('.composer-shell')
          );
          assert.equal(await root.count(), 1);
          await settings(root);
          await generated(root);
          assert.equal((await calls(page)).length, 1);
          assert.equal((await calls(page))[0].isImage, false);
          await root.locator('[data-insert]').first().click();
          assert.equal(await page.locator('[contenteditable]').innerText(), REPLIES[0]);
          assert.equal(await page.evaluate(() => window.__fixtureSent), 0);
          await checkClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('sends only opted-in photos after vision confirmation and keeps all image bytes out of Jev and storage', async () => {
      const harness = await open({ fixture: SEMANTIC_FIXTURES.instagram });
      const { page, root } = harness;
      try {
        await settings(root);
        await showSelection(root);
        await root.locator('[data-select-image]').first().check();
        await root.locator('#selection-done').click();
        await root.locator('#generate').click();
        assert.equal((await calls(page)).length, 0, 'vision confirmation precedes image fetching');
        assert.match(await root.locator('#status').textContent(), /圖片|影像|視覺|vision/i);
        await settings(root, {
          'vision-enabled': true,
          'jev-enabled': true,
          'jev-key': 'fixture-jev-image-key',
        });
        await generated(root);
        const requests = await calls(page);
        assert.equal(requests.length, 3);
        assert.equal(requests[0].isImage, true);
        assert.equal(requests[0].method, 'GET');
        assert.match(requests[0].url, /photo-one\.png/);
        assert.equal(requests[0].headers?.Authorization, undefined);
        assert.equal(requests[0].anonymous, true);
        assert.equal(requests[1].isJev, true);
        assert.doesNotMatch(requests[1].data, /data:image|base64|scontent\./);
        const llm = JSON.parse(requests[2].data);
        const parts = llm.messages.find((message) => message.role === 'user').content;
        assert.equal(Array.isArray(parts), true);
        const imageParts = parts.filter((part) => part.type === 'image_url');
        assert.equal(imageParts.length, 1);
        assert.match(imageParts[0].image_url.url, /^data:image\/jpeg;base64,/);
        assert.match(parts.find((part) => part.type === 'text').text, /喝咖啡/);
        assert.doesNotMatch(
          await page.evaluate(() => JSON.stringify(window.__gmStore)),
          /data:image|scontent\.|週六有空嗎/
        );
        await showSelection(root);
        await root.locator('#images-all').click();
        assert.deepEqual(
          await root
            .locator('[data-select-image]')
            .evaluateAll((nodes) => nodes.map((node) => node.checked)),
          [true, true]
        );
        await root.locator('#images-none').click();
        assert.deepEqual(
          await root
            .locator('[data-select-image]')
            .evaluateAll((nodes) => nodes.map((node) => node.checked)),
          [false, false]
        );
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('leaves newly arriving photos unselected while selected text follows the recent window', async () => {
      const harness = await open({ fixture: SEMANTIC_FIXTURES.instagram, clock: true });
      const { page, root } = harness;
      try {
        await settings(root, { 'vision-enabled': true });
        await showSelection(root);
        await root.locator('[data-select-image]').first().check();
        await page.evaluate(() =>
          window.__semanticFixture.add({
            text: 'NEW PHOTO CAPTION',
            photo: 'https://scontent.cdninstagram.com/fixtures/new-photo.png',
          })
        );
        await advance(page, 2000);
        assert.equal(await root.locator('[data-select-image]').count(), 2);
        await root.locator('#selection-done').click();
        assert.match(await root.locator('#context').inputValue(), /NEW PHOTO CAPTION/);
        await showSelection(root);
        const checked = await root
          .locator('[data-select-image]')
          .evaluateAll((nodes) => nodes.map((node) => node.checked));
        assert.deepEqual(checked, [true, false, false]);
        await root.locator('#selection-done').click();
        await generated(root);
        assert.equal((await calls(page)).filter((call) => call.isImage).length, 1);
        assert.doesNotMatch((await calls(page)).find((call) => call.isImage).url, /new-photo/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('rejects more than four selected images before fetching any image or calling a model', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root, { 'vision-enabled': true });
        await addPhotos(page, 5);
        await showSelection(root);
        assert.equal(await root.locator('[data-select-image]').count(), 5);
        await root.locator('#images-all').click();
        await root.locator('#selection-done').click();
        await root.locator('#generate').click();
        assert.equal((await calls(page)).length, 0);
        assert.match(await root.locator('#status').textContent(), /4|四/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const mode of ['invalid-mime', 'oversize']) {
      it(`stops image ${mode} before Jev or the reply model`, async () => {
        const harness = await open({ fixture: SEMANTIC_FIXTURES.instagram });
        const { page, root } = harness;
        try {
          await settings(root, {
            'vision-enabled': true,
            'jev-enabled': true,
            'jev-key': 'fixture-jev-image-key',
          });
          await showSelection(root);
          await root.locator('[data-select-image]').first().check();
          await root.locator('#selection-done').click();
          await page.evaluate((mode) => {
            window.__gmImageMode = mode;
          }, mode);
          await root.locator('#generate').click();
          await waitCalls(page, 1);
          await page.waitForFunction(
            () =>
              document.querySelector('#chat-reply-assistant').shadowRoot.querySelector('#status')
                .dataset.error === 'true'
          );
          assert.equal((await calls(page)).length, 1);
          assert.equal((await calls(page))[0].isImage, true);
          assert.equal(await root.locator('#replies [data-reply]').count(), 0);
          assert.equal(await page.evaluate(() => window.__fixtureSent), 0);
          await checkClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('aborts pending image downloads when generation is cancelled and never starts Jev or LLM afterwards', async () => {
      const harness = await open({ fixture: SEMANTIC_FIXTURES.instagram });
      const { page, root } = harness;
      try {
        await settings(root, {
          'vision-enabled': true,
          'jev-enabled': true,
          'jev-key': 'fixture-jev-image-key',
        });
        await showSelection(root);
        await root.locator('[data-select-image]').first().check();
        await root.locator('#selection-done').click();
        await page.evaluate(() => {
          window.__gmImageMode = 'pending';
        });
        await root.locator('#generate').click();
        await waitCalls(page, 1);
        await root.locator('#cancel').click();
        assert.equal((await calls(page))[0].isImage, true);
        assert.equal((await calls(page))[0].aborted, true);
        assert.equal((await calls(page)).length, 1);
        assert.match(await root.locator('#status').textContent(), /取消/);
        assert.equal(await root.locator('#replies [data-reply]').count(), 0);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('keeps group speakers and page-loaded history when rows are virtualized away', async () => {
      const harness = await open({ platform: 'messenger', group: true });
      const { page, root } = harness;
      try {
        const initial = await root.locator('#context').inputValue();
        assert.match(initial, /Alice/);
        assert.match(initial, /Bob/);
        await page.evaluate(() => {
          window.__chatFixture.add({ text: 'OLDER HISTORY SENTINEL', prepend: true });
          window.__chatFixture.remove('m1');
        });
        await selectionAction(root, '#refresh-context');
        const accumulated = await root.locator('#context').inputValue();
        assert.match(accumulated, /OLDER HISTORY SENTINEL/);
        assert.match(accumulated, /週六有空嗎/);
        assert.ok(accumulated.indexOf('OLDER HISTORY SENTINEL') < accumulated.indexOf('喝咖啡'));
        await selectionAction(root, '#clear-context');
        await selectionAction(root, '#refresh-context');
        const refreshed = await root.locator('#context').inputValue();
        assert.doesNotMatch(refreshed, /週六有空嗎/);
        assert.match(refreshed, /OLDER HISTORY SENTINEL|喝咖啡/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('uses the exact custom endpoint and does not reuse a key saved for another origin', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root);
        await showSettings(root);
        await root.locator('#provider-preset').selectOption('custom');
        const endpoint = 'http://127.0.0.1:4141/v1/chat/completions?fixture=1';
        await root.locator('#endpoint').fill(endpoint);
        await root.locator('#model').fill('fixture-model');
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await root.locator('#save-settings').click();
        await generated(root);
        const request = (await calls(page))[0];
        assert.equal(request.url, endpoint);
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(request.anonymous, true);
        await showSettings(root);
        await root.locator('#endpoint').fill('http://example.com/v1/chat/completions');
        await root.locator('#save-settings').click();
        assert.match(await root.locator('#diagnostic-status').textContent(), /HTTPS|loopback|本機/);
        assert.equal((await calls(page)).length, 1);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('recognizes a nested message scroller, preserves multiline text, and distinguishes a peer named You', async () => {
      const harness = await open({ platform: 'messenger', clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await page.evaluate(() => {
          const log = document.querySelector('[role="log"]');
          log.style.overflowY = 'visible';
          log.style.height = 'auto';
          const scroll = document.createElement('div');
          scroll.id = 'nested-message-scroll';
          scroll.style.cssText = 'height:260px;overflow-y:auto';
          scroll.append(...log.children);
          log.append(scroll);
          const row = document.querySelector('[data-message-id="m3"]');
          row.dataset.senderId = 'peer-named-you';
          row.dataset.senderName = 'You';
          row.querySelector('h4').textContent = 'You';
          row.querySelector('[data-message-text]').innerHTML =
            '第一行<div>第二行 <span>包含行內文字</span></div><p>第三行</p>';
          scroll.scrollTop = scroll.scrollHeight;
        });
        await selectionAction(root, '#refresh-context');
        const context = await root.locator('#context').inputValue();
        assert.match(context, /You[^\n]*第一行\n第二行 包含行內文字\n第三行/);
        assert.equal(
          await root.locator('#reply-target option[value="peer-named-you"]').textContent(),
          'You'
        );
        await advance(page, 6000);
        await root.locator('#auto').check();
        await advance(page, 6000);
        await page.evaluate(() => {
          window.__chatFixture.add({
            id: 'nested-new',
            sender: 'Alice',
            text: 'NESTED SCROLLER INCOMING',
          });
          const scroll = document.querySelector('#nested-message-scroll');
          scroll.append(document.querySelector('[data-message-id="nested-new"]'));
          scroll.scrollTop = scroll.scrollHeight;
        });
        await advance(page, 6000);
        assert.equal((await calls(page)).length, 1);
        assert.match((await calls(page))[0].data, /NESTED SCROLLER INCOMING/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('keeps unidentified cached speakers visible and suppresses auto even after their DOM row disappears', async () => {
      const harness = await open({ platform: 'messenger', group: true, clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await advance(page, 6000);
        await root.locator('#auto').check();
        await advance(page, 6000);
        await page.evaluate(() =>
          window.__chatFixture.add({
            id: 'unknown',
            sender: null,
            text: 'UNIDENTIFIED SPEAKER SENTINEL',
          })
        );
        await advance(page, 1500);
        assert.match(await root.locator('#capture-status').textContent(), /發言者|發話者|辨識/);
        await page.evaluate(() => {
          window.__chatFixture.remove('unknown');
          window.__chatFixture.add({ text: 'KNOWN SPEAKER AFTER UNKNOWN' });
        });
        await advance(page, 10000);
        assert.equal((await calls(page)).length, 0);
        assert.match(await root.locator('#context').inputValue(), /UNIDENTIFIED SPEAKER SENTINEL/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('waits for fresh content when a URL changes while an unlabelled old conversation is cloned', async () => {
      const harness = await open({ clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await page.evaluate(() =>
          document.querySelector('section').removeAttribute('data-thread-id')
        );
        await advance(page, 1500);
        await page.evaluate(() => {
          history.pushState({}, '', '/direct/t/200/');
          const previous = document.querySelector('main > section');
          previous.replaceWith(previous.cloneNode(true));
        });
        await advance(page, 2000);
        assert.equal(
          await root.count(),
          1,
          'cloning native thread markup must not leave an inert duplicate host'
        );
        assert.equal(await root.locator('#context').inputValue(), '');
        assert.equal(
          (await root.locator('#generate').isDisabled()) ||
            !(await root.locator('#generate').isVisible()),
          true,
          'stale conversation must have no actionable generation control'
        );
        assert.equal((await calls(page)).length, 0);
        await page.evaluate(() => {
          document.querySelector('main h2').textContent = 'Charlie';
          document.querySelector('[role="log"]').replaceChildren();
          window.__chatFixture.add({
            id: 'charlie-new',
            sender: 'Charlie',
            text: 'FRESH NEW CONVERSATION SENTINEL',
          });
        });
        await advance(page, 2000);
        assert.match(
          await root.locator('#context').inputValue(),
          /FRESH NEW CONVERSATION SENTINEL/
        );
        assert.doesNotMatch(await root.locator('#context').inputValue(), /喝咖啡/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('does not replay the baseline, prepended history, own messages, or reactions in auto mode', async () => {
      const harness = await open({ clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await advance(page, 6000);
        await root.locator('#auto').check();
        await advance(page, 6000);
        assert.equal((await calls(page)).length, 0, 'enabling auto must establish a baseline');
        await page.evaluate(() => {
          window.__chatFixture.add({ text: 'OLD PAGE SENTINEL', prepend: true });
          window.__chatFixture.add({ text: 'SELF MESSAGE SENTINEL', sender: 'You', self: true });
          window.__chatFixture.react();
        });
        await advance(page, 6000);
        assert.equal((await calls(page)).length, 0);
        await page.evaluate(() => {
          window.__chatFixture.add({ id: 'new-1', text: 'NEW INCOMING ONE' });
          window.__chatFixture.add({ id: 'new-2', text: 'NEW INCOMING TWO' });
        });
        await advance(page, 2500);
        assert.equal((await calls(page)).length, 0, 'incoming messages must debounce');
        await advance(page, 3000);
        await waitCalls(page, 1);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() => window.__chatFixture.add({ text: 'COALESCED LATEST SENTINEL' }));
        await advance(page, 6000);
        assert.equal(
          (await calls(page)).length,
          1,
          'cooldown prevents an immediate second request'
        );
        await advance(page, 30000);
        assert.equal((await calls(page)).length, 2);
        assert.match((await calls(page))[1].data, /COALESCED LATEST SENTINEL/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('discards a late request after switching conversations and does not transfer auto preferences', async () => {
      const harness = await open({ clock: true });
      const { page, root } = harness;
      try {
        await settings(root);
        await advance(page, 6000);
        await root.locator('#auto').check();
        await page.evaluate(() => {
          window.__gmMode = 'pending';
        });
        await root.locator('#generate').click();
        await waitCalls(page, 1);
        await page.evaluate(() => window.__chatFixture.switchThread());
        await advance(page, 2000);
        await page.evaluate(
          (replies) =>
            window.__gmReply(0, {
              choices: [{ message: { content: JSON.stringify({ replies }) } }],
            }),
          REPLIES
        );
        await advance(page, 1000);
        assert.equal(await root.locator('#replies [data-reply]').count(), 0);
        assert.equal(await root.locator('#auto').isChecked(), false);
        assert.equal((await calls(page))[0].aborted, true);
        assert.doesNotMatch(await root.locator('#context').inputValue(), /週六有空嗎/);
        assert.match(await root.locator('#context').inputValue(), /OTHER THREAD SENTINEL/);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('continues ordinary generation after optional Jev failure and displays invalid model output as an error', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root, {
          'jev-enabled': true,
          'jev-key': 'fixture-jev-key-not-real',
          'jev-model': 'fixture-jev-model',
        });
        await page.evaluate(() => {
          window.__gmJevMode = 'error';
        });
        await generated(root);
        const requests = await calls(page);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].isJev, true);
        assert.equal(requests[1].isJev, false);
        assert.match(await root.locator('#analysis').textContent(), /Jev|TypeSafe|情緒|分析/i);
        await settings(root, { 'jev-enabled': false });
        await page.evaluate(() => {
          window.__gmMode = 'malformed';
        });
        await root.locator('#generate').click();
        await page.waitForFunction(() =>
          /回覆格式|三個|失敗/.test(
            document.querySelector('#chat-reply-assistant').shadowRoot.querySelector('#status')
              .textContent
          )
        );
        assert.equal(await root.locator('#replies').getAttribute('data-stale'), 'true');
        assert.equal(await root.locator('[data-insert]').first().isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__fixtureSent), 0);
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    it('passes validated Jev signals and the same group snapshot to the reply model', async () => {
      const harness = await open({ platform: 'messenger', group: true });
      const { page, root } = harness;
      try {
        await settings(root, {
          'jev-enabled': true,
          'jev-key': 'fixture-jev-key-not-real',
          'jev-model': 'fixture-jev-model',
        });
        await generated(root);
        const requests = await calls(page);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, 'https://api.typesafe.ai/v1/systemone');
        const jev = JSON.parse(requests[0].data);
        const llm = userData(requests[1]);
        assert.equal(jev.model, 'fixture-jev-model');
        assert.equal(jev.state.transcript, llm.transcript);
        assert.equal(jev.state.target, llm.replyTarget);
        assert.match(llm.replyTarget, /discussion/);
        assert.equal(llm.optionalTextSignals.tone, 'anxious');
        assert.equal(llm.optionalTextSignals.intent, 'question');
        assert.equal(llm.optionalTextSignals.needsGentleResponse, 0.6);
        assert.match(await root.locator('#analysis').textContent(), /Jev|TypeSafe/);
        assert.doesNotMatch(
          await page.evaluate(() => JSON.stringify(window.__gmStore)),
          /optionalTextSignals|needsGentleResponse|週六有空嗎/
        );
        await checkClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const status of [401, 429]) {
      it(`pauses auto after HTTP ${status} and does not retry on subsequent messages`, async () => {
        const harness = await open({ clock: true });
        const { page, root } = harness;
        try {
          await settings(root);
          await advance(page, 6000);
          await root.locator('#auto').check();
          await advance(page, 6000);
          await page.evaluate((status) => {
            window.__gmMode = `http${status}`;
            window.__chatFixture.add({ text: 'TRIGGER REJECTED REQUEST' });
          }, status);
          await advance(page, 6000);
          assert.equal((await calls(page)).length, 1);
          assert.match(await root.locator('#status').textContent(), new RegExp(String(status)));
          assert.match(await root.locator('#status').textContent(), /暫停/);
          await page.evaluate(() =>
            window.__chatFixture.add({ text: 'MUST NOT RETRY THIS MESSAGE' })
          );
          await advance(page, 60000);
          assert.equal((await calls(page)).length, 1);
          assert.equal(await root.locator('#replies [data-reply]').count(), 0);
          await checkClean(harness);
        } finally {
          await page.close();
        }
      });
    }
  });
}
