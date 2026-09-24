import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = await read('userscripts/chat-reply-assistant/chat-reply-assistant.user.js');
const FIXTURE = await read('tests/fixtures/chat-reply-assistant/chat.html');
const OUT = new URL('../.preview/chat-reply-assistant-tests/', import.meta.url);
await mkdir(OUT, { recursive: true });
const REPLIES = ['好啊 到時見', '可以 我晚點找你', '好 沒問題'];
const KEY = 'fixture-gemini-key-not-real';
const SETTINGS_KEY = 'chat-reply-assistant.settings.v1';

// This is a fixture-only manager model, not evidence of real extension grants.
// Its sessionStorage persistence deliberately belongs to the harness; all writes
// made through the userscript's GM API are separately observable.
function managerShim(replies) {
  const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  window.__gmStore = JSON.parse(sessionStorage.getItem('__cra_fixture_store') || '{}');
  window.__gmWrites = [];
  window.__gmCalls = [];
  window.__gmPending = [];
  window.__gmClipboard = null;
  window.__gmMenus = [];
  window.__gmMode = 'success';
  window.__gmJevMode = 'success';
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
    const isJev = new URL(options.url).hostname === 'api.typesafe.ai';
    const call = {
      url: options.url,
      method: options.method,
      headers: copy(options.headers),
      data: options.data,
      anonymous: options.anonymous,
      aborted: false,
      completed: false,
      isJev,
    };
    window.__gmCalls.push(call);
    window.__gmPending.push(options);
    const mode = isJev ? window.__gmJevMode : window.__gmMode;
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

    async function open({ platform = 'instagram', group = false, clock = false } = {}) {
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
          return route.fulfill({ contentType: 'text/html', body: FIXTURE });
        network.push(request.url());
        return route.abort();
      });
      // One init script guarantees shim → delivered script ordering.
      await page.addInitScript({
        content: `(${managerShim})(${JSON.stringify(REPLIES)});\ndocument.addEventListener("DOMContentLoaded", () => {\n${SOURCE}\n}, { once: true });`,
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
      await page.waitForFunction(() =>
        document
          .querySelector('#chat-reply-assistant')
          ?.shadowRoot?.querySelector('#context')
          ?.value.includes('喝咖啡')
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
        else await input.fill(String(value));
      }
      await root.locator('#save-settings').click();
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
          const log = document.querySelector('[role="log"]');
          return {
            calls: window.__gmCalls.length,
            status: root.querySelector('#status').textContent,
            capture: root.querySelector('#capture-status').textContent,
            context: root.querySelector('#context').value,
            auto: root.querySelector('#auto').checked,
            scroll: [log.scrollTop, log.scrollHeight, log.clientHeight],
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

    it('preserves existing drafts, offers explicit append, and keeps transcript edits in memory', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await settings(root);
        await root.locator('#auto').check();
        await root.locator('#context').fill('Alice: EDITED CONTEXT SENTINEL');
        await page.evaluate(() => document.querySelector('#chat-reply-assistant').remove());
        await page.waitForFunction(
          () =>
            document.querySelector('#chat-reply-assistant')?.shadowRoot?.querySelector('#context')
              ?.value === 'Alice: EDITED CONTEXT SENTINEL'
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
        await root.locator('#refresh-context').click();
        const accumulated = await root.locator('#context').inputValue();
        assert.match(accumulated, /OLDER HISTORY SENTINEL/);
        assert.match(accumulated, /週六有空嗎/);
        assert.ok(accumulated.indexOf('OLDER HISTORY SENTINEL') < accumulated.indexOf('喝咖啡'));
        await root.locator('#clear-context').click();
        await root.locator('#refresh-context').click();
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
        await root.locator('#provider-preset').selectOption('custom');
        const endpoint = 'http://127.0.0.1:4141/v1/chat/completions?fixture=1';
        await root.locator('#endpoint').fill(endpoint);
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await root.locator('#save-settings').click();
        await generated(root);
        const request = (await calls(page))[0];
        assert.equal(request.url, endpoint);
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(request.anonymous, true);
        await root.locator('#endpoint').fill('http://example.com/v1/chat/completions');
        await root.locator('#save-settings').click();
        assert.match(await root.locator('#status').textContent(), /HTTPS|loopback|本機/);
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
        await root.locator('#refresh-context').click();
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
        assert.equal(await root.locator('#context').inputValue(), '');
        assert.equal(await root.locator('#generate').isDisabled(), true);
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
        assert.match(await root.locator('#analysis').textContent(), /Jev|情緒|分析/i);
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
        const llm = JSON.parse(
          JSON.parse(requests[1].data).messages.find((message) => message.role === 'user').content
        );
        assert.equal(jev.model, 'fixture-jev-model');
        assert.equal(jev.state.transcript, llm.transcript);
        assert.equal(jev.state.target, llm.replyTarget);
        assert.match(llm.replyTarget, /discussion/);
        assert.equal(llm.optionalTextSignals.tone, 'anxious');
        assert.equal(llm.optionalTextSignals.intent, 'question');
        assert.equal(llm.optionalTextSignals.needsGentleResponse, 0.6);
        assert.match(await root.locator('#analysis').textContent(), /Jev/);
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
