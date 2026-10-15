import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = await read('userscripts/chat-reply-assistant/chat-reply-assistant.user.js');
const FIXTURES = {
  messenger: await read('tests/fixtures/chat-reply-assistant/messenger-layout.html'),
  gemini: await read('tests/fixtures/chat-reply-assistant/gemini-chat.html'),
};
const OUT = new URL('../.preview/chat-reply-assistant-automation-tests/', import.meta.url);
await mkdir(OUT, { recursive: true });
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64'
);
const SETTINGS_KEY = 'chat-reply-assistant.settings.v1';

// 模型輸出與 GM API 全部是測試替身；只有 fixture 的原生送出按鈕會被點擊。
function modelShim() {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  window.__gmStore = JSON.parse(sessionStorage.getItem('__cra_auto_store') || '{}');
  window.__calls = [];
  window.__pending = [];
  window.__modes = { llm: 'success', context: 'success', rank: 'success', tone: 'success' };
  window.__llmSequence = 0;
  window.GM_getValue = (key, fallback) => copy(window.__gmStore[key] ?? fallback);
  window.GM_setValue = (key, value) => {
    window.__gmStore[key] = copy(value);
    sessionStorage.setItem('__cra_auto_store', JSON.stringify(window.__gmStore));
  };
  window.GM_setClipboard = (text) => {
    window.__copied = text;
  };
  window.GM_registerMenuCommand = () => {};
  window.__reply = (index, value, status = 200) => {
    const call = window.__calls[index];
    call.completed = true;
    window.__pending[index].onload?.({
      status,
      responseText: JSON.stringify(value),
      finalUrl: call.url,
      responseHeaders: 'content-type: application/json',
    });
  };
  window.GM_xmlhttpRequest = (options) => {
    const body = options.data ? JSON.parse(options.data) : null;
    const kind = body?.questions?.bestReply
      ? 'rank'
      : body?.questions?.tone
        ? 'tone'
        : body?.questions
          ? 'context'
          : 'llm';
    const index = window.__calls.length;
    const call = {
      kind,
      url: options.url,
      method: options.method,
      headers: copy(options.headers || {}),
      body,
      aborted: false,
      completed: false,
    };
    window.__calls.push(call);
    window.__pending.push(options);
    const mode = window.__modes[kind];
    if (mode !== 'pending')
      queueMicrotask(() => {
        if (call.aborted) return;
        if (mode === 'error')
          return window.__reply(
            index,
            { error: { message: 'Synthetic provider unavailable' } },
            503
          );
        if (kind === 'context') {
          const answers = Object.fromEntries(
            Object.keys(body.questions).map((id) => {
              const source = body.state.messages.find((message) => message.id === id);
              const probability =
                mode === 'prune' ? (source?.text.includes('KEEP CONTEXT') ? 0.95 : 0.1) : 0.9;
              return [id, { type: 'noul', noul: probability }];
            })
          );
          return window.__reply(index, { answers });
        }
        if (kind === 'rank') {
          const choice = mode === 'none' ? 'none' : 'reply_2';
          const p = mode === 'uncertain' ? 0.55 : 0.9;
          const answers = {
            bestReply: {
              type: 'choice',
              choice,
              probabilities: Object.fromEntries(
                ['reply_1', 'reply_2', 'reply_3', 'none'].map((id) => [
                  id,
                  id === choice ? p : (1 - p) / 3,
                ])
              ),
            },
          };
          for (let candidate = 1; candidate <= 3; candidate++) {
            answers[`reply_${candidate}_relevant`] = { type: 'noul', noul: 0.95 };
            answers[`reply_${candidate}_factual`] = { type: 'noul', noul: 0.96 };
          }
          return window.__reply(index, { answers });
        }
        if (kind === 'tone')
          return window.__reply(index, {
            answers: {
              tone: { type: 'choice', choice: 'neutral' },
              intent: { type: 'choice', choice: 'question' },
              needsGentleResponse: { type: 'noul', noul: 0.1 },
            },
          });
        const system = body?.messages?.find((message) => message.role === 'system')?.content || '';
        const count = Number(system.match(/exactly (\d+)/)?.[1] || 3);
        const sequence = ++window.__llmSequence;
        const replies = Array.from(
          { length: count },
          (_, candidate) => `MODEL REPLY ${sequence} ${String.fromCharCode(65 + candidate)}`
        );
        call.replies = replies;
        return window.__reply(index, {
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
}

const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
].filter(([name]) => !process.env.US_BROWSERS || process.env.US_BROWSERS.split(',').includes(name));
assert.ok(engines.length);

for (const [name, engine] of engines) {
  describe(`${name} Chat Reply Assistant 自動化控制器`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open({ kind = 'messenger', path, layout = 'simple' } = {}) {
      const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
      page.setDefaultTimeout(5000);
      const errors = [],
        network = [],
        logs = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => logs.push(message.text()));
      await page.route('**/*', (route) => {
        const request = route.request();
        if (
          request.isNavigationRequest() &&
          /^https:\/\/(www\.messenger\.com|gemini\.google\.com)\//.test(request.url())
        )
          return route.fulfill({ contentType: 'text/html', body: FIXTURES[kind] });
        if (request.resourceType() === 'image' && request.url().includes('/fixtures/'))
          return route.fulfill({ contentType: 'image/png', body: PIXEL });
        network.push(request.url());
        return route.abort();
      });
      await page.addInitScript({
        content: `(${modelShim})();
        document.addEventListener('DOMContentLoaded', () => {
          if (${JSON.stringify(kind)} === 'messenger' && ${JSON.stringify(layout)} !== 'full') {
            document.querySelector('[role="log"]').replaceChildren();
            if (${JSON.stringify(layout)} === 'history') {
              window.__layoutFixture.add({text:'PRIVATE EXCLUDED HISTORY',side:'left'});
              window.__layoutFixture.add({text:'OLDER SELF ANSWER',side:'right'});
              window.__layoutFixture.add({text:'KEEP CONTEXT concrete fact',side:'left'});
            }
            window.__layoutFixture.add({text:'SELF QUESTION',side:'right'});
            window.__layoutFixture.add({text:'LATEST INCOMING',side:'left'});
          }
          ${SOURCE}
        }, {once:true});`,
      });
      await page.clock.install({ time: new Date('2026-09-25T12:00:00Z') });
      await page.goto(
        kind === 'gemini'
          ? `https://gemini.google.com${path || '/app/fixture-thread'}`
          : `https://www.messenger.com${path || '/t/100'}`
      );
      const root = page.locator('#chat-reply-assistant');
      await page.clock.runFor(2500);
      await root.waitFor();
      if (!(await root.locator('#panel').isVisible())) await root.locator('#toggle-panel').click();
      await page.clock.runFor(1500);
      return { page, root, errors, network, logs, kind };
    }
    const calls = (page) => page.evaluate(() => window.__calls);
    const tick = (page, ms = 6000) => page.clock.runFor(ms);
    const sent = (page) =>
      page.evaluate(() =>
        window.__layoutFixture ? window.__fixtureSendClicks : window.__geminiFixture.sentCount
      );
    async function configure(root, values = {}) {
      if (!(await root.locator('#settings').isVisible()))
        await root.locator('#settings-toggle').click();
      await root.locator('#model').fill('fixture-local-model');
      for (const [id, value] of Object.entries(values)) {
        const control = root.locator(`#${id}`);
        if (typeof value === 'boolean') await control.setChecked(value);
        else if ((await control.evaluate((node) => node.tagName)) === 'SELECT')
          await control.selectOption(String(value));
        else await control.fill(String(value));
      }
      await root.locator('#save-settings').click();
      assert.equal(await root.locator('#details').isVisible(), false);
    }
    async function assertClean(harness) {
      assert.deepEqual(harness.errors, []);
      assert.deepEqual(harness.network, []);
      assert.doesNotMatch(
        harness.logs.join('\n'),
        /fixture-jev-key|PRIVATE EXCLUDED HISTORY|LATEST INCOMING/
      );
    }
    async function state(page) {
      return page.evaluate(() => {
        const root = document.querySelector('#chat-reply-assistant')?.shadowRoot;
        return {
          calls: window.__calls.map((call) => call.kind),
          status: root?.querySelector('#status')?.textContent,
          auto: root?.querySelector('#auto-reply-status')?.textContent,
          capture: root?.querySelector('#capture-status')?.textContent,
        };
      });
    }
    async function countdown(page, root) {
      await tick(page);
      assert.equal(
        await root.locator('#send-now').isVisible(),
        true,
        JSON.stringify(await state(page))
      );
      assert.match(await root.locator('#auto-reply-status').textContent(), /秒後送出/);
    }

    it('預設使用本機 4141，可免 Key 手動產生且沒有自動送出', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await root.locator('#settings-toggle').click();
        assert.equal(await root.locator('#provider-preset').inputValue(), 'copilot-api');
        assert.equal(
          await root.locator('#endpoint').inputValue(),
          'http://localhost:4141/v1/chat/completions'
        );
        assert.equal(await root.locator('#api-key').inputValue(), '');
        await configure(root);
        await root.locator('#generate').click();
        await tick(page, 1000);
        const request = (await calls(page))[0];
        assert.equal(request.url, 'http://localhost:4141/v1/chat/completions');
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(await root.locator('[data-reply]').count(), 3);
        assert.equal(await sent(page), 0);
        assert.equal(await root.locator('#auto').isChecked(), false);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('相同 fallback 標題換聊天室時保留工具列，等新 DOM 穩定後才綁定', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root);
        await page.evaluate(() => window.__layoutFixture.switchThread('200', { keepDOM: true }));
        await tick(page, 3000);
        assert.equal(await root.locator('#toggle-panel').isVisible(), true);
        assert.equal(await root.count(), 1);
        assert.equal(await root.locator('#context').inputValue(), '');
        assert.equal(await root.locator('#generate').isDisabled(), true);
        assert.equal(await root.locator('#confirm-thread').isVisible(), true);
        assert.equal((await calls(page)).length, 0);
        await page.evaluate(() => window.__layoutFixture.switchThread('200'));
        await tick(page, 3000);
        assert.match(await root.locator('#context').inputValue(), /NEW THREAD CONTENT/);
        assert.doesNotMatch(
          await root.locator('#context').inputValue(),
          /LATEST INCOMING|SELF QUESTION/
        );
        assert.equal(await root.locator('#toggle-panel').isVisible(), true);
        assert.equal(await root.locator('#confirm-thread').isVisible(), false);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('位置方向顯示為自己／其他人，頭像與引用頭像不變成可選照片', async () => {
      const harness = await open({ layout: 'full' });
      const { page, root } = harness;
      try {
        const text = await root.locator('#context').inputValue();
        assert.match(text, /其他人[^\n]*好/);
        assert.match(text, /我[^\n]*好/);
        assert.doesNotMatch(text, /發言者[AB]|SIDEBAR/);
        await root.locator('#selection-toggle').click();
        assert.equal(await root.locator('[data-select-image]').count(), 1);
        const image = await root.locator('.attachment img').getAttribute('src');
        assert.match(image, /real-portrait/);
        assert.doesNotMatch(image, /avatar|quote-face/);
        const roles = await root.locator('.message-card').evaluateAll((cards) =>
          cards.map((card) => ({
            text: card.querySelector('[data-edit-text]').value,
            role: card.querySelector('[data-edit-direction]').value,
          }))
        );
        assert.deepEqual(
          roles.filter((row) => row.text === '好').map((row) => row.role),
          ['other', 'self']
        );
        assert.equal(roles.find((row) => row.text.includes('POSITION AMBIGUOUS')).role, 'unknown');
        await page.screenshot({ path: new URL(`${name}-layout-selection.png`, OUT).pathname });
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('生成模式進入來訊時產生一次，自己的新訊息不觸發續說', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root);
        await root.locator('#auto').check();
        await tick(page);
        assert.equal((await calls(page)).length, 1, JSON.stringify(await state(page)));
        await tick(page, 20000);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'MY NEXT MESSAGE', side: 'right' })
        );
        await tick(page);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'NEW PEER RESPONSE', side: 'left' })
        );
        await tick(page);
        assert.equal((await calls(page)).length, 2);
        assert.equal(await sent(page), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('單一回覆倒數可以取消，重新開始後立即送出只點一次原生按鈕', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root, { 'auto-strategy': 'single', 'send-delay': 10, 'reply-limit': 10 });
        await root.locator('#auto-start').click();
        await countdown(page, root);
        assert.equal(await sent(page), 0);
        assert.equal(await root.locator('[data-reply]').count(), 1);
        assert.match((await calls(page))[0].body.messages[0].content, /exactly 1\b/);
        await root.locator('#auto-stop').click();
        await tick(page, 20000);
        assert.equal(await sent(page), 0);
        await root.locator('#auto-start').click();
        await countdown(page, root);
        const expected = await root.locator('#pending-reply').textContent();
        await root.locator('#send-now').click();
        await tick(page, 1500);
        assert.equal(await sent(page), 1);
        assert.equal(await page.evaluate(() => window.__fixtureEnter), 0);
        assert.equal(await page.locator('[contenteditable]').innerText(), '');
        assert.match(await page.locator('[role="log"]').innerText(), new RegExp(expected));
        await tick(page, 20000);
        assert.equal((await calls(page)).length, 2, '腳本自己的送出回音不可觸發新請求');
        await root.locator('#auto-stop').click();
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('單一回覆上限一則完成後停止，新來訊不重啟已結束的 session', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root, { 'auto-strategy': 'single', 'send-delay': 0, 'reply-limit': 1 });
        await root.locator('#auto-start').click();
        await tick(page, 8000);
        assert.equal(await sent(page), 1, JSON.stringify(await state(page)));
        assert.equal(await root.locator('#auto-start').isVisible(), true);
        assert.match(await root.locator('#auto-reply-status').textContent(), /上限|完成/);
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'AFTER LIMIT', side: 'left' })
        );
        await tick(page, 20000);
        assert.equal(await sent(page), 1);
        assert.equal((await calls(page)).length, 1);
        assert.equal(
          (await calls(page)).some((call) => call.kind !== 'llm'),
          false
        );
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('明確開啟不限輪數後可繼續下一輪，停止後不再回覆', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root, {
          'auto-strategy': 'single',
          'send-delay': 0,
          'reply-limit': 1,
          'reply-unlimited': true,
        });
        await root.locator('#auto-start').click();
        await tick(page, 8000);
        assert.equal(await sent(page), 1);
        assert.equal(await root.locator('#auto-stop').isVisible(), true);
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'NEXT UNLIMITED ROUND', side: 'left' })
        );
        await tick(page, 8000);
        assert.equal(await sent(page), 2);
        assert.match(await root.locator('#auto-reply-status').textContent(), /不限/);
        await root.locator('#auto-stop').click();
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'AFTER EXPLICIT STOP', side: 'left' })
        );
        await tick(page, 12000);
        assert.equal(await sent(page), 2);
        assert.equal((await calls(page)).length, 2);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('倒數途中收到新訊息會丟棄舊候選，舊 deadline 不會送出', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root, { 'auto-strategy': 'single', 'send-delay': 10 });
        await root.locator('#auto-start').click();
        await countdown(page, root);
        const oldReply = await root.locator('#pending-reply').textContent();
        const remaining = Number(
          (await root.locator('#auto-reply-status').textContent()).match(/(\d+) 秒後送出/)[1]
        );
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'NEW COUNTDOWN INFORMATION', side: 'left' })
        );
        await tick(page, 2500);
        assert.equal((await calls(page)).length, 2, JSON.stringify(await state(page)));
        const latestReply = await root.locator('#pending-reply').textContent();
        assert.notEqual(latestReply, oldReply);
        assert.match(JSON.stringify((await calls(page))[1].body), /NEW COUNTDOWN INFORMATION/);
        await tick(page, Math.max(0, remaining * 1000 - 2500 + 300));
        assert.equal(await sent(page), 0);
        await root.locator('#send-now').click();
        await tick(page, 1500);
        assert.equal(await sent(page), 1);
        const log = await page.locator('[role="log"]').innerText();
        assert.ok(log.includes(latestReply));
        assert.equal(log.includes(oldReply), false);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const strategy of ['single', 'jev']) {
      it(`Gemini 空白對話可用 ${strategy} 策略開場，轉成正式路由後仍遵守一則上限`, async () => {
        const harness = await open({ kind: 'gemini', path: '/app' });
        const { page, root } = harness;
        try {
          await configure(root, {
            'auto-strategy': strategy,
            'send-delay': 0,
            'reply-limit': 1,
            'opening-goal': 'OPENING GOAL SENTINEL 聊旅行',
            'jev-key': 'fixture-jev-key',
          });
          await root.locator('#auto-start').click();
          await tick(page, 8000);
          assert.equal(await sent(page), 1, JSON.stringify(await state(page)));
          assert.equal(new URL(page.url()).pathname, '/app/generated-thread');
          const requests = await calls(page);
          assert.match(
            JSON.stringify(requests.find((call) => call.kind === 'llm').body),
            /OPENING GOAL SENTINEL/
          );
          assert.equal(
            requests.filter((call) => call.kind === 'rank').length,
            strategy === 'jev' ? 1 : 0
          );
          assert.match(
            await page.locator('#gemini-history').innerText(),
            new RegExp(`MODEL REPLY 1 ${strategy === 'jev' ? 'B' : 'A'}`)
          );
          assert.equal(await root.locator('#auto-start').isVisible(), true);
          await page.evaluate(() => window.__geminiFixture.complete('開場後的 Gemini 回覆'));
          await tick(page, 12000);
          assert.equal(await sent(page), 1);
          assert.equal((await calls(page)).filter((call) => call.kind === 'llm').length, 1);
          await assertClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('Gemini 串流中不回覆，完成後才對最新輸出生成且不回覆自己的新 prompt', async () => {
      const harness = await open({ kind: 'gemini' });
      const { page, root } = harness;
      try {
        await configure(root);
        await root.locator('#auto').check();
        await tick(page);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() => window.__geminiFixture.appendUser('MY SECOND PROMPT'));
        await tick(page);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() => window.__geminiFixture.beginStream('PARTIAL RESPONSE'));
        await tick(page, 10000);
        assert.equal((await calls(page)).length, 1);
        await page.evaluate(() => window.__geminiFixture.complete('COMPLETED UNIQUE RESPONSE'));
        await tick(page);
        assert.equal((await calls(page)).length, 2);
        assert.match(JSON.stringify((await calls(page))[1].body), /COMPLETED UNIQUE RESPONSE/);
        assert.equal(await sent(page), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('Jev 上下文挑選失敗仍生成候選，但不進入倒數或自動送出', async () => {
      const harness = await open({ layout: 'history' });
      const { page, root } = harness;
      try {
        await configure(root, {
          'context-filter': true,
          'auto-strategy': 'jev',
          'send-delay': 0,
          'jev-key': 'fixture-jev-key',
        });
        await page.evaluate(() => {
          window.__modes.context = 'error';
        });
        await root.locator('#auto-start').click();
        await tick(page, 8000);
        assert.equal((await calls(page)).filter((call) => call.kind === 'context').length, 1);
        assert.equal((await calls(page)).filter((call) => call.kind === 'llm').length, 1);
        assert.equal(await root.locator('[data-reply]').count(), 3);
        assert.equal(await root.locator('#send-now').isVisible(), false);
        await tick(page, 20000);
        assert.equal(await sent(page), 0);
        assert.equal(await page.locator('[contenteditable]').innerText(), '');
        assert.match(await root.locator('#status').textContent(), /失敗|不會自動送出|手動/);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('人工排除的歷史不送給 Jev，AI mask 與人工排除保持分離', async () => {
      const harness = await open({ layout: 'history' });
      const { page, root } = harness;
      try {
        await configure(root, { 'context-filter': true, 'jev-key': 'fixture-jev-key' });
        await root.locator('#selection-toggle').click();
        await root.locator('.message-card').first().locator('[data-select-message]').uncheck();
        await root.locator('#selection-done').click();
        await page.evaluate(() => {
          window.__modes.context = 'prune';
        });
        await root.locator('#generate').click();
        await tick(page, 1500);
        const requests = await calls(page);
        assert.equal(requests[0].kind, 'context');
        assert.doesNotMatch(JSON.stringify(requests), /PRIVATE EXCLUDED HISTORY/);
        const model = requests.find((call) => call.kind === 'llm');
        assert.match(JSON.stringify(model.body), /KEEP CONTEXT|LATEST INCOMING/);
        assert.doesNotMatch(JSON.stringify(model.body), /OLDER SELF ANSWER/);
        await root.locator('#selection-toggle').click();
        assert.equal(
          await root.locator('.message-card').first().locator('[data-select-message]').isChecked(),
          false
        );
        assert.equal(await sent(page), 0);
        const stored = await page.evaluate((key) => window.__gmStore[key], SETTINGS_KEY);
        assert.doesNotMatch(
          JSON.stringify(stored),
          /PRIVATE EXCLUDED HISTORY|KEEP CONTEXT|aiMask|MODEL REPLY/
        );
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const mode of ['none', 'uncertain', 'error']) {
      it(`Jev 回覆選擇 ${mode} 保留三候選供手動處理，不默選第一個`, async () => {
        const harness = await open();
        const { page, root } = harness;
        try {
          await configure(root, {
            'auto-strategy': 'jev',
            'send-delay': 0,
            'jev-key': 'fixture-jev-key',
          });
          await page.evaluate((mode) => {
            window.__modes.rank = mode;
          }, mode);
          await root.locator('#auto-start').click();
          await tick(page, 8000);
          assert.deepEqual(
            (await calls(page)).map((call) => call.kind),
            ['llm', 'rank']
          );
          assert.equal(await root.locator('[data-reply]').count(), 3);
          assert.equal(await root.locator('#send-now').isVisible(), false);
          assert.equal(await root.locator('#auto-start').isVisible(), true);
          await tick(page, 20000);
          assert.equal(await sent(page), 0);
          await assertClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('倒數中手動重新生成會停止自動 session，新的三候選不會被舊 timer 送出', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root, { 'auto-strategy': 'single', 'send-delay': 10 });
        await root.locator('#auto-start').click();
        await countdown(page, root);
        await root.locator('#generate').click();
        await tick(page, 1500);
        assert.equal(await root.locator('[data-reply]').count(), 3);
        assert.equal(await root.locator('#auto-start').isVisible(), true);
        assert.equal(await root.locator('#send-now').isVisible(), false);
        await tick(page, 20000);
        assert.equal(await sent(page), 0);
        assert.equal((await calls(page)).length, 2);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const guard of ['typing', 'ime', 'visibility', 'blur', 'route', 'provider', 'context']) {
      it(`倒數遇到 ${guard} 會停止，跨過舊 deadline 也不送出`, async () => {
        const harness = await open();
        const { page, root } = harness;
        try {
          await configure(root, { 'auto-strategy': 'single', 'send-delay': 30 });
          await root.locator('#auto-start').click();
          await countdown(page, root);
          if (guard === 'typing') {
            await page.locator('[contenteditable]').fill('MY UNSENT DRAFT');
          } else if (guard === 'ime') {
            await page.evaluate(() =>
              document
                .querySelector('[contenteditable]')
                .dispatchEvent(
                  new CompositionEvent('compositionstart', { bubbles: true, data: '測' })
                )
            );
          } else if (guard === 'visibility') {
            // 在隔離 fixture 模擬 visibility API；不宣稱測到作業系統的視窗焦點。
            await page.evaluate(() => {
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden',
              });
              document.dispatchEvent(new Event('visibilitychange'));
            });
          } else if (guard === 'blur') {
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
          } else if (guard === 'route') {
            await page.evaluate(() => window.__layoutFixture.switchThread('200'));
          } else if (guard === 'provider') {
            await root.locator('#settings-toggle').click();
            await root.locator('#provider-preset').selectOption('copilot-sdk');
            await root.locator('#model').fill('different-local-model');
            await root.locator('#save-settings').click();
          } else {
            await root.locator('#selection-toggle').click();
            await root.locator('[data-edit-text]').last().fill('MANUALLY CHANGED TARGET');
            await root.locator('#selection-done').click();
          }
          await tick(page, 40000);
          assert.equal(await sent(page), 0, JSON.stringify(await state(page)));
          assert.equal((await calls(page)).length, 1);
          assert.equal(await root.locator('#send-now').isVisible(), false);
          assert.equal(await root.locator('#auto-start').isVisible(), true);
          if (guard === 'typing')
            assert.equal(await page.locator('[contenteditable]').innerText(), 'MY UNSENT DRAFT');
          await assertClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    for (const mode of ['no-echo', 'clear-only']) {
      it(`原生送出 ${mode} 無法確認時停止，後續來訊與計時器不重試`, async () => {
        const harness = await open();
        const { page, root } = harness;
        try {
          await configure(root, { 'auto-strategy': 'single', 'send-delay': 0 });
          await page.evaluate((mode) => {
            window.__layoutFixture.mode = mode;
          }, mode);
          await root.locator('#auto-start').click();
          // 生成先等穩定視窗，點擊後 adapter 另有八秒的有限確認等待。
          await tick(page, 16000);
          assert.equal(await sent(page), 1);
          assert.equal(
            await root.locator('#auto-start').isVisible(),
            true,
            JSON.stringify(await state(page))
          );
          assert.match(
            `${await root.locator('#status').textContent()} ${await root.locator('#auto-reply-status').textContent()}`,
            /未確認|無法確認|不會.*重試/
          );
          await page.evaluate(() =>
            window.__layoutFixture.add({ text: 'NEW AFTER UNKNOWN SEND', side: 'left' })
          );
          await tick(page, 30000);
          assert.equal(await sent(page), 1);
          assert.equal((await calls(page)).length, 1);
          assert.equal(await page.evaluate(() => window.__fixtureEnter), 0);
          await assertClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('關閉人工選取後切換可見性，不會重播同一個尚未生成的 target', async () => {
      const harness = await open();
      const { page, root } = harness;
      try {
        await configure(root);
        await root.locator('#auto').check();
        await root.locator('#selection-toggle').click();
        await tick(page);
        assert.equal((await calls(page)).length, 0);
        await root.locator('#selection-done').click();
        await tick(page);
        assert.equal((await calls(page)).length, 0);
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await tick(page, 2000);
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
          });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await tick(page);
        assert.equal((await calls(page)).length, 0, JSON.stringify(await state(page)));
        await page.evaluate(() =>
          window.__layoutFixture.add({ text: 'NEW AFTER MANUAL EDIT', side: 'left' })
        );
        await tick(page);
        assert.equal((await calls(page)).length, 1);
        assert.equal(await sent(page), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });
  });
}
