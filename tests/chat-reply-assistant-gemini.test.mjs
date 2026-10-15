import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('userscripts/chat-reply-assistant/chat-reply-assistant.user.js');
const adapter = source.match(/\/\/ BEGIN GEMINI ADAPTER([\s\S]*?)\/\/ END GEMINI ADAPTER/)?.[1];
assert.ok(adapter, 'delivered userscript must contain its Gemini adapter');
const fixture = await read('tests/fixtures/chat-reply-assistant/gemini-chat.html');

for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
].filter(
  ([name]) => !process.env.US_BROWSERS || process.env.US_BROWSERS.split(',').includes(name)
)) {
  describe(`${name} Gemini native DOM adapter`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open(path = '/app/fixture-thread') {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(5000);
      const errors = [],
        network = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        if (
          route.request().isNavigationRequest() &&
          route.request().url().startsWith('https://gemini.google.com/')
        )
          return route.fulfill({ contentType: 'text/html', body: fixture });
        network.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript({
        content: `${adapter}\nwindow.__adapter = createGeminiAdapter();`,
      });
      await page.clock.install({ time: new Date('2026-09-25T12:00:00Z') });
      await page.goto(`https://gemini.google.com${path}`);
      return { page, errors, network };
    }
    const snapshot = (page) =>
      page.evaluate(() => {
        const state = window.__adapter.inspect(window.__adapter.route());
        if (!state) return null;
        return {
          ...state,
          root: Boolean(state.root),
          composer: Boolean(state.composer),
          composerShell: Boolean(state.composerShell),
          messageRoot: Boolean(state.messageRoot),
        };
      });
    async function fill(page, text) {
      assert.equal(
        await page.evaluate(
          (text) =>
            window.__adapter.insert(
              window.__adapter.locateSurface(window.__adapter.route()).composer,
              text
            ),
          text
        ),
        true
      );
      assert.equal(
        await page.evaluate(() =>
          window.__adapter.readDraft(
            window.__adapter.locateSurface(window.__adapter.route()).composer
          )
        ),
        text
      );
    }
    async function beginSend(page, expectedDraft) {
      await page.evaluate((expectedDraft) => {
        window.__sendAbort = new AbortController();
        window.__sendResult = null;
        window.__sendPromise = window.__adapter
          .send({
            expectedRoute: window.__adapter.route(),
            expectedDraft,
            signal: window.__sendAbort.signal,
          })
          .then((result) => {
            window.__sendResult = result;
            return result;
          });
      }, expectedDraft);
    }
    async function assertClean({ errors, network }) {
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
    }

    it('reads native user/model turns without hidden labels, toolbar noise or sidebar content', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        const state = await snapshot(page);
        assert.equal(state.messages.length, 2);
        assert.equal(state.messages[0].direction, 'self');
        assert.equal(state.messages[1].direction, 'other');
        assert.equal(state.messages[0].text, '你今天想聊什麼');
        assert.equal(state.messages[1].text, '我們可以聊旅行\n\n或聊今天的小事');
        assert.doesNotMatch(JSON.stringify(state.messages), /HIDDEN|SIDEBAR|TOOLBAR|Copy/);
        assert.ok(
          state.messages.every(
            (message) =>
              message.senderSource === 'native-role' && message.directionConfidence === 'strong'
          )
        );
        assert.equal(state.generationState, 'idle');
        assert.equal(state.atLatest, true);
        assert.equal(state.identity, null, 'URL ID must not masquerade as verified DOM identity');
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('locates a fresh empty composer and treats share pages as capture-only', async () => {
      const harness = await open('/app'),
        { page } = harness;
      try {
        const state = await snapshot(page);
        assert.equal(state.messages.length, 0);
        assert.equal(state.composer, true);
        assert.equal(state.generationState, 'idle');
        assert.equal(await page.evaluate(() => window.__adapter.route().isNew), true);
        await page.goto('https://gemini.google.com/share/example-share');
        const share = await snapshot(page);
        assert.equal(share.messages.length, 2);
        assert.equal(share.composer, false);
        await page.evaluate(() => {
          const user = document.querySelector('main user-query');
          user.replaceWith(...user.childNodes);
        });
        const mixed = await snapshot(page);
        assert.equal(mixed.messages.length, 2);
        assert.equal(mixed.messages[0].direction, 'self');
        const result = await page.evaluate(() =>
          window.__adapter.send({
            expectedRoute: window.__adapter.route(),
            expectedDraft: 'blocked',
          })
        );
        assert.equal(result.status, 'blocked');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('does not infer completion from a quiet stream or absent stop button alone', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => window.__geminiFixture.beginStream('暫時沒有新字，但仍在生成'));
        await page.clock.runFor(10000);
        assert.equal((await snapshot(page)).generationState, 'streaming');
        await page.evaluate(() => {
          document.querySelector('#gemini-stop').hidden = true;
          document.querySelector('model-response').removeAttribute('aria-busy');
          document.querySelector('.send-button').hidden = false;
        });
        assert.equal((await snapshot(page)).generationState, 'unknown');
        await page.evaluate(() => window.__geminiFixture.complete());
        assert.equal((await snapshot(page)).generationState, 'idle');
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('keeps missing or ambiguous native composer surfaces unrecognized', async () => {
      const harness = await open('/app'),
        { page } = harness;
      try {
        await page.evaluate(() => document.querySelector('.send-button').remove());
        assert.equal((await snapshot(page)).generationState, 'unknown');
        await page.evaluate(() => {
          const extra = document.querySelector('input-area-v2').cloneNode(true);
          document.querySelector('main').append(extra);
        });
        assert.equal(await snapshot(page), null);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('inserts and submits one exact draft, observing its new user turn', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await fill(page, '我們聊旅行吧\n你最喜歡哪裡');
        await beginSend(page, '我們聊旅行吧\n你最喜歡哪裡');
        const result = await page.evaluate(() => window.__sendPromise);
        assert.equal(result.status, 'submitted');
        assert.equal(result.route.id, 'fixture-thread');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        assert.equal((await snapshot(page)).generationState, 'streaming');
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('waits briefly for native Send to become enabled after Quill insertion', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendReadyDelay = 400;
        });
        await fill(page, 'WAIT FOR NATIVE COMMIT');
        await beginSend(page, 'WAIT FOR NATIVE COMMIT');
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
        await page.clock.runFor(400);
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'submitted');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('stops waiting after 1.5 seconds if native Send remains disabled', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendReadyDelay = 3000;
        });
        await fill(page, 'DO NOT WAIT FOREVER');
        await beginSend(page, 'DO NOT WAIT FOREVER');
        await page.clock.runFor(1600);
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'blocked');
        await page.clock.runFor(1600);
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('cancels during native readiness waiting without clicking Send', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendReadyDelay = 800;
        });
        await fill(page, 'CANCEL BEFORE CLICK');
        await beginSend(page, 'CANCEL BEFORE CLICK');
        await page.clock.runFor(200);
        await page.evaluate(() => window.__sendAbort.abort());
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'blocked');
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    for (const change of ['edit', 'clear']) {
      it(`blocks when Quill draft is ${change === 'edit' ? 'edited' : 'cleared'} during readiness waiting`, async () => {
        const harness = await open(),
          { page } = harness;
        try {
          await page.evaluate(() => {
            window.__geminiFixture.sendReadyDelay = 800;
          });
          await fill(page, 'ORIGINAL WAITING DRAFT');
          await beginSend(page, 'ORIGINAL WAITING DRAFT');
          await page.clock.runFor(200);
          await page.evaluate((change) => {
            const editor = document.querySelector('.ql-editor');
            editor.textContent = change === 'edit' ? 'USER CHANGED THE DRAFT' : '';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }, change);
          await page.clock.runFor(1000);
          assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'blocked');
          assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
          await assertClean(harness);
        } finally {
          await page.close();
        }
      });
    }

    it('permits a new-chat route assignment only after the matching user turn appears', async () => {
      const harness = await open('/app'),
        { page } = harness;
      try {
        await fill(page, '開啟新對話');
        await beginSend(page, '開啟新對話');
        const result = await page.evaluate(() => window.__sendPromise);
        assert.equal(result.status, 'submitted');
        assert.equal(result.route.id, 'generated-thread');
        assert.equal(result.route.isNew, false);
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('blocks changed text, attachment drafts, streaming, and a mismatched expected route before clicking', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await fill(page, 'CURRENT DRAFT');
        const mismatch = await page.evaluate(() =>
          window.__adapter.send({
            expectedRoute: window.__adapter.route(),
            expectedDraft: 'OUTDATED DRAFT',
          })
        );
        assert.equal(mismatch.status, 'blocked');
        await page.evaluate(() => window.__geminiFixture.attachments(true));
        const files = await page.evaluate(() =>
          window.__adapter.send({
            expectedRoute: window.__adapter.route(),
            expectedDraft: 'CURRENT DRAFT',
          })
        );
        assert.equal(files.status, 'blocked');
        await page.evaluate(() => {
          window.__geminiFixture.attachments(false);
          window.__geminiFixture.beginStream();
        });
        const streaming = await page.evaluate(() =>
          window.__adapter.send({
            expectedRoute: window.__adapter.route(),
            expectedDraft: 'CURRENT DRAFT',
          })
        );
        assert.equal(streaming.status, 'blocked');
        await page.evaluate(() => window.__geminiFixture.complete());
        const wrongRoute = await page.evaluate(() =>
          window.__adapter.send({ expectedRoute: { key: 'wrong' }, expectedDraft: 'CURRENT DRAFT' })
        );
        assert.equal(wrongRoute.status, 'blocked');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 0);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('does not acknowledge only an empty composer or a prior matching user turn', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendMode = 'clearOnly';
        });
        await fill(page, '你今天想聊什麼');
        await beginSend(page, '你今天想聊什麼');
        await page.clock.runFor(8500);
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'unknown');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('rejects wrong text after new-chat navigation without retrying Send', async () => {
      const harness = await open('/app'),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendMode = 'wrongTurn';
        });
        await fill(page, 'EXPECTED NEW PROMPT');
        await beginSend(page, 'EXPECTED NEW PROMPT');
        await page.clock.runFor(8500);
        const result = await page.evaluate(() => window.__sendPromise);
        assert.equal(result.status, 'unknown');
        assert.equal(result.route.id, 'generated-thread');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('cancels after a click as unknown, and blocks a second concurrent send', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendMode = 'noop';
        });
        await fill(page, 'ONE CLICK ONLY');
        await beginSend(page, 'ONE CLICK ONLY');
        const second = await page.evaluate(() =>
          window.__adapter.send({
            expectedRoute: window.__adapter.route(),
            expectedDraft: 'ONE CLICK ONLY',
          })
        );
        assert.equal(second.status, 'blocked');
        await page.evaluate(() => window.__sendAbort.abort());
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'unknown');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 1);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });

    it('reacquires a replaced composer after submission and never accepts another existing conversation', async () => {
      const harness = await open(),
        { page } = harness;
      try {
        await page.evaluate(() => {
          window.__geminiFixture.sendMode = 'replaceComposer';
        });
        await fill(page, 'REPLACED COMPOSER');
        await beginSend(page, 'REPLACED COMPOSER');
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'submitted');
        await page.evaluate(() => {
          window.__geminiFixture.complete();
          window.__geminiFixture.sendMode = 'noop';
        });
        await fill(page, 'DO NOT FOLLOW ANOTHER CHAT');
        await beginSend(page, 'DO NOT FOLLOW ANOTHER CHAT');
        await page.evaluate(() => history.pushState({}, '', '/app/another-thread'));
        await page.clock.runFor(200);
        assert.equal((await page.evaluate(() => window.__sendPromise)).status, 'unknown');
        assert.equal(await page.evaluate(() => window.__geminiFixture.sentCount), 2);
        await assertClean(harness);
      } finally {
        await page.close();
      }
    });
  });
}
