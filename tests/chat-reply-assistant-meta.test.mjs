import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const published = await read('userscripts/chat-reply-assistant/chat-reply-assistant.user.js');
// 預設直接測發佈檔中的 adapter 區塊；環境變數僅供整合前的開發驗證。
const adapterSource = process.env.CRA_META_SOURCE
  ? await readFile(process.env.CRA_META_SOURCE, 'utf8')
  : published.match(/\/\/\s*BEGIN ADAPTERS\b([\s\S]*?)\/\/\s*END ADAPTERS\b/)?.[1];
assert.ok(adapterSource?.includes('function createMetaAdapter'), '發佈檔需包含 Meta adapter 區塊');
const fixtures = Object.fromEntries(
  await Promise.all(
    ['messenger-layout', 'messenger-semantic', 'instagram-semantic', 'chat'].map(async (name) => [
      name,
      await read(`tests/fixtures/chat-reply-assistant/${name}.html`),
    ])
  )
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUFAAAAAASUVORK5CYII=',
  'base64'
);
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
].filter(([name]) => !process.env.US_BROWSERS || process.env.US_BROWSERS.split(',').includes(name));
assert.ok(engines.length);

for (const [engineName, engine] of engines) {
  describe(`${engineName} Meta DOM adapter`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open(name = 'messenger-layout', platform = 'messenger') {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.route('**/*', (request) =>
        request.request().isNavigationRequest()
          ? request.fulfill({ contentType: 'text/html', body: fixtures[name] })
          : request.fulfill({ contentType: 'image/png', body: png })
      );
      await page.goto(
        `https://www.${platform}.com/${platform === 'instagram' ? 'direct/t/100/' : 't/100'}`
      );
      await page.addScriptTag({
        content: `${adapterSource}\nwindow.__meta = createMetaAdapter();`,
      });
      return page;
    }

    const snapshot = (page, selfSide = 'right') =>
      page.evaluate((side) => {
        const value = window.__meta.inspect(window.__meta.route(), { selfSide: side });
        return (
          value && {
            title: value.title,
            titleSource: value.titleSource,
            messages: value.messages,
            busy: value.busy,
            generationState: value.generationState,
            hasDraftAttachments: value.hasDraftAttachments,
            shell: value.composerShell.className,
            messageRootRole: value.messageRoot.getAttribute('role'),
          }
        );
      }, selfSide);

    it('依泡泡位置分辨匿名左右角色，保留方向證據；RTL 文字不反轉角色', async () => {
      const page = await open();
      try {
        const value = await snapshot(page);
        assert.equal(value.title, '目前對話');
        assert.equal(value.titleSource, 'fallback');
        assert.deepEqual(
          value.messages.slice(0, 5).map((m) => m.direction),
          ['other', 'self', 'other', 'self', 'other']
        );
        assert.ok(
          value.messages
            .slice(0, 5)
            .every(
              (m) =>
                m.directionConfidence === 'layout' &&
                m.senderSource === 'layout' &&
                !m.senderId &&
                !m.sender
            )
        );
        assert.deepEqual(
          value.messages.slice(0, 5).map((m) => m.layoutSide),
          ['left', 'right', 'left', 'right', 'left']
        );
        assert.equal(value.messages[5].kind, 'system');
        assert.equal(value.messages[5].direction, 'unknown');
        assert.equal(value.messages[6].direction, 'unknown', '近乎滿版的泡泡沒有可靠左右證據');
        const reverse = await snapshot(page, 'left');
        assert.deepEqual(
          reverse.messages.slice(0, 5).map((m) => m.direction),
          ['self', 'other', 'self', 'other', 'self']
        );
        assert.deepEqual(
          reverse.messages.map((m) => m.layoutSide),
          value.messages.map((m) => m.layoutSide)
        );
        await page.evaluate(() => {
          const row = window.__layoutFixture.add({ text: 'replace', side: 'left' });
          const emoji = document.createElement('img');
          emoji.alt = '👍';
          emoji.width = 20;
          emoji.height = 20;
          emoji.src = 'https://scontent.xx.fbcdn.net/fixtures/emoji.png';
          row.querySelector('span').replaceWith(emoji);
        });
        const emoji = (await snapshot(page)).messages.at(-1);
        assert.equal(emoji.text, '👍');
        assert.equal(emoji.direction, 'other');
        assert.deepEqual(emoji.attachments, []);
      } finally {
        await page.close();
      }
    });

    it('頭像與引用人像不是附件，實際肖像照片仍保留；引用文字未遺失', async () => {
      const page = await open();
      try {
        const value = await snapshot(page);
        assert.match(value.messages[2].text, /引用的文字\n這是目前的回覆/);
        const media = value.messages.flatMap((m) => m.attachments);
        assert.equal(media.length, 1);
        assert.match(media[0].url, /real-portrait\.png\?signature=one$/);
        assert.doesNotMatch(media[0].id, /signature/);
        assert.equal(media[0].kind, 'image');
      } finally {
        await page.close();
      }
    });

    it('空聊天室與尚未出現訊息窗時仍可定位原生輸入區', async () => {
      const page = await open();
      try {
        await page.evaluate(() => window.__layoutFixture.switchThread('200', { empty: true }));
        assert.equal((await snapshot(page)).messages.length, 0);
        assert.equal((await snapshot(page)).shell, 'composer-shell');
        await page.locator('[role="log"]').evaluate((node) => node.remove());
        assert.equal(
          await page.evaluate(
            () => window.__meta.locateSurface(window.__meta.route()).composerShell.className
          ),
          'composer-shell'
        );
        await page.locator('main').evaluate((node) => node.setAttribute('aria-busy', 'true'));
        const value = await snapshot(page);
        assert.equal(value.busy, true);
        assert.equal(value.generationState, 'unknown');
      } finally {
        await page.close();
      }
    });

    it('原本有強語義證據的 fixtures 保持角色與媒體擷取', async () => {
      for (const [fixture, platform, count, mediaCount] of [
        ['instagram-semantic', 'instagram', 5, 2],
        ['messenger-semantic', 'messenger', 6, 1],
        ['chat', 'instagram', 3, 0],
      ]) {
        const page = await open(fixture, platform);
        try {
          const value = await snapshot(page);
          assert.equal(value.messages.length, count);
          assert.ok(
            value.messages.every(
              (m) => m.direction !== 'unknown' && m.directionConfidence === 'strong'
            )
          );
          assert.equal(value.messages.flatMap((m) => m.attachments).length, mediaCount);
          assert.doesNotMatch(value.messages.map((m) => m.text).join('\n'), /SIDEBAR/);
        } finally {
          await page.close();
        }
      }
    });

    it('既有同文訊息不妨礙新回顯判定，只點擊一次且不用 Enter', async () => {
      const page = await open();
      try {
        const result = await page.evaluate(async () => {
          const expectedRoute = window.__meta.route();
          const before = window.__meta.inspect(expectedRoute);
          window.__meta.insert(before.composer, '好');
          const outcome = await window.__meta.send({ expectedRoute, expectedDraft: '好' });
          return {
            outcome,
            clicks: window.__fixtureSendClicks,
            enter: window.__fixtureEnter,
            draft: document.querySelector('[contenteditable]').innerText,
          };
        });
        assert.equal(result.outcome.status, 'submitted');
        assert.equal(result.clicks, 1);
        assert.equal(result.enter, 0);
        assert.equal(result.draft, '');
      } finally {
        await page.close();
      }
    });

    it('草稿、路由、原生按鈕或附件不符合前置條件時不點擊', async () => {
      const page = await open();
      try {
        const statuses = await page.evaluate(async () => {
          const route = window.__meta.route(),
            view = window.__meta.inspect(route),
            statuses = [];
          window.__meta.insert(view.composer, 'draft');
          statuses.push(
            (await window.__meta.send({ expectedRoute: route, expectedDraft: 'another' })).status
          );
          statuses.push(
            (
              await window.__meta.send({
                expectedRoute: { key: 'messenger:wrong:200' },
                expectedDraft: 'draft',
              })
            ).status
          );
          const button = document.querySelector('[aria-label="Send"]');
          button.disabled = true;
          statuses.push(
            (await window.__meta.send({ expectedRoute: route, expectedDraft: 'draft' })).status
          );
          button.disabled = false;
          const duplicate = button.cloneNode(true);
          button.after(duplicate);
          statuses.push(
            (await window.__meta.send({ expectedRoute: route, expectedDraft: 'draft' })).status
          );
          duplicate.remove();
          window.__layoutFixture.draftFile();
          const files = window.__meta.inspect(route).hasDraftAttachments;
          statuses.push(
            (await window.__meta.send({ expectedRoute: route, expectedDraft: 'draft' })).status
          );
          return { statuses, files, clicks: window.__fixtureSendClicks };
        });
        assert.deepEqual(statuses.statuses, [
          'blocked',
          'blocked',
          'blocked',
          'blocked',
          'blocked',
        ]);
        assert.equal(statuses.files, true);
        assert.equal(statuses.clicks, 0);
      } finally {
        await page.close();
      }
    });

    it('只清空或沒有回顯不算成功，八秒內結束而且不重試', async () => {
      const page = await open();
      try {
        await page.clock.install();
        const operation = page.evaluate(async () => {
          window.__layoutFixture.mode = 'clear-only';
          const route = window.__meta.route(),
            view = window.__meta.inspect(route);
          window.__meta.insert(view.composer, '好');
          const started = Date.now();
          const result = await window.__meta.send({ expectedRoute: route, expectedDraft: '好' });
          return {
            status: result.status,
            clicks: window.__fixtureSendClicks,
            enter: window.__fixtureEnter,
            elapsed: Date.now() - started,
          };
        });
        await page.waitForFunction(() => window.__fixtureSendClicks === 1);
        await page.clock.fastForward(8200);
        const result = await operation;
        assert.equal(result.status, 'unknown');
        assert.equal(result.clicks, 1);
        assert.equal(result.enter, 0);
        assert.ok(result.elapsed <= 8500);
      } finally {
        await page.close();
      }
    });

    it('送出中再次要求會被擋下；送出後取消／切換路由不重試', async () => {
      const page = await open();
      try {
        const result = await page.evaluate(async () => {
          window.__layoutFixture.mode = 'no-echo';
          const route = window.__meta.route(),
            view = window.__meta.inspect(route),
            controller = new AbortController();
          window.__meta.insert(view.composer, '一次');
          const first = window.__meta.send({
            expectedRoute: route,
            expectedDraft: '一次',
            signal: controller.signal,
          });
          const second = await window.__meta.send({ expectedRoute: route, expectedDraft: '一次' });
          controller.abort();
          return {
            first: (await first).status,
            second: second.status,
            clicks: window.__fixtureSendClicks,
          };
        });
        assert.deepEqual(result, { first: 'unknown', second: 'blocked', clicks: 1 });
      } finally {
        await page.close();
      }
    });

    it('原生送出後重建輸入框仍以回顯證明成功；路由變更則回報未知', async () => {
      for (const [mode, status] of [
        ['remount', 'submitted'],
        ['route-switch', 'unknown'],
      ]) {
        const page = await open();
        try {
          const result = await page.evaluate(
            async ({ mode }) => {
              window.__layoutFixture.mode = mode;
              const route = window.__meta.route(),
                view = window.__meta.inspect(route);
              window.__meta.insert(view.composer, 'original route');
              const outcome = await window.__meta.send({
                expectedRoute: route,
                expectedDraft: 'original route',
              });
              return {
                status: outcome.status,
                clicks: window.__fixtureSendClicks,
                enter: window.__fixtureEnter,
              };
            },
            { mode }
          );
          assert.deepEqual(result, { status, clicks: 1, enter: 0 });
        } finally {
          await page.close();
        }
      }
    });
  });
}
