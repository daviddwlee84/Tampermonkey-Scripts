import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { buildChatExplorer } from '../scripts/build-chat-explorer.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = await read('userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js');
const RAW_BASE = 'https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/';
const DEPS = await Promise.all(
  [...SOURCE.matchAll(/^\/\/ @require\s+(\S+)/gm)].map(async ([, url]) => {
    assert.ok(url.startsWith(RAW_BASE));
    return read(url.slice(RAW_BASE.length));
  })
);
const FIXTURE = JSON.parse(await read('tests/fixtures/chatgpt-export/multiple-research.json'));
const OUT = new URL('../.preview/conversation-explorer-tests/', import.meta.url);
await mkdir(OUT, { recursive: true });
const OFFLINE = new URL('conversation-explorer.html', OUT);
await buildChatExplorer(OFFLINE.pathname);
const clone = (value) => JSON.parse(JSON.stringify(value));
const first = 'report:tool-1:report-1',
  second = 'report:tool-2:report-2';

function shim(data) {
  window.__fixture = data;
  window.__gmClipboard = null;
  window.__gmStore = {};
  window.__menus = [];
  window.unsafeWindow = window;
  window.GM_getValue = (key, fallback) => window.__gmStore[key] ?? fallback;
  window.GM_setValue = (key, value) => {
    window.__gmStore[key] = value;
  };
  window.GM_setClipboard = (text) => {
    window.__gmClipboard = text;
  };
  window.GM_registerMenuCommand = (name, run) => window.__menus.push({ name, run });
  window.__reactRouterContext = { state: { loaderData: { conversation: data } } };
}

for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  describe(`${name} optional browsing mode and offline viewer`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open({ data = FIXTURE, width = 1280, height = 860 } = {}) {
      const page = await browser.newPage({
        viewport: { width, height },
        colorScheme: 'light',
        acceptDownloads: true,
      });
      let live = clone(data);
      const errors = [],
        requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        if (path === '/c/fixture-conversation')
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body><main><textarea aria-label="Original composer">Original page</textarea></main></body></html>',
          });
        if (path === '/api/auth/session') return route.fulfill({ json: {} });
        if (path === '/backend-api/conversation/fixture-conversation')
          return route.fulfill({ json: live });
        errors.push(`Unexpected request: ${route.request().url()}`);
        return route.abort();
      });
      await page.addInitScript({
        content: `(${shim})(${JSON.stringify(data)});\n${DEPS.join('\n')}\n${SOURCE}`,
      });
      await page.goto('https://chatgpt.com/c/fixture-conversation');
      await page.getByRole('button', { name: '⇩ Export MD', exact: true }).click();
      await page.getByRole('button', { name: '瀏覽／選取…', exact: true }).click();
      const root = page.locator('#conversation-explorer');
      await root
        .getByText(
          `已選 ${(data === FIXTURE ? 4 : data.__expectedCount || 4).toLocaleString()} 則`,
          { exact: true }
        )
        .waitFor();
      return {
        page,
        root,
        errors,
        requests,
        setSource: (next) => {
          live = next;
        },
      };
    }
    async function copied(page, root, label = '複製所選 Markdown') {
      await page.evaluate(() => {
        window.__gmClipboard = null;
      });
      await root.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(() => window.__gmClipboard !== null);
      return page.evaluate(() => window.__gmClipboard);
    }
    async function fileExport(root, label, filename) {
      const pending = root.page().waitForEvent('download');
      await root.getByRole('button', { name: label, exact: true }).click();
      const download = await pending;
      const path = new URL(`${name}-${filename}`, OUT);
      await download.saveAs(path.pathname);
      return { text: await readFile(path, 'utf8'), filename: download.suggestedFilename(), path };
    }

    it('keeps original one-click exports independent after single selection and archive import', async () => {
      const { page, root, errors } = await open();
      try {
        await root
          .locator(`.message[data-block-id="${second}"]`)
          .getByRole('button', { name: '只選這則' })
          .click();
        const selected = await copied(page, root);
        assert.match(selected, /^messages: 1$/m);
        assert.match(selected, /Second report findings/);
        assert.doesNotMatch(
          selected,
          /Initial research question|Follow-up question|First report evidence/
        );
        const imported = clone(FIXTURE);
        imported.title = 'Imported other conversation';
        imported.conversation_id = 'other';
        await root.locator('input[type=file]').setInputFiles({
          name: 'other.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(imported)),
        });
        await root.getByRole('heading', { name: 'Imported other conversation' }).waitFor();
        await root.getByRole('button', { name: '關閉瀏覽模式' }).click();
        await page.evaluate(() => {
          window.__gmClipboard = null;
        });
        await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
        await page.waitForFunction(() => window.__gmClipboard !== null);
        const quick = await page.evaluate(() => window.__gmClipboard);
        assert.match(quick, /^messages: 4$/m);
        assert.match(quick, /Initial research question/);
        assert.match(quick, /First report evidence/);
        assert.doesNotMatch(quick, /Imported other conversation/);
        assert.deepEqual(await page.evaluate(() => window.__gmStore), {});
        assert.equal(
          await page.getByRole('textbox', { name: 'Original composer' }).inputValue(),
          'Original page'
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('adds another path, previews branches, and exports the exact preview and full archive', async () => {
      const { page, root, errors } = await open();
      try {
        await root
          .getByRole('button', { name: '加入到 Unselected report 的 path', exact: true })
          .click();
        await root.getByText('已選 6 則', { exact: true }).waitFor();
        await root.getByRole('tab', { name: '匯出預覽', exact: true }).click();
        await root.getByRole('heading', { name: '分支 1', exact: true }).waitFor();
        const md = await copied(page, root);
        assert.match(md, /^messages: 6$/m);
        assert.equal(md.split('First report evidence').length - 1, 1);
        assert.match(md, /## 分支 2/);
        assert.match(md, /UNSELECTED REPORT/);
        const downloaded = await fileExport(root, '下載所選 Markdown', 'selection.md');
        assert.equal(downloaded.text, md);
        const handoff = await copied(page, root, '複製所選 Handoff');
        assert.match(handoff, /# Prior ChatGPT Context/);
        assert.equal(handoff.split('First report evidence').length - 1, 1);
        const saved = await fileExport(root, '儲存完整對話＋選取', 'archive.json');
        assert.ok(saved.filename.endsWith('.chat-archive.json'));
        const archive = JSON.parse(saved.text);
        assert.equal(archive.format, 'chat-export-archive');
        assert.equal(archive.selection.blockIds.length, 6);
        assert.deepEqual(archive.raw, FIXTURE);
        await page.screenshot({ path: new URL(`${name}-desktop.png`, OUT).pathname });
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('keeps collapsed and filtered selections and supports keyboard and range selection', async () => {
      const { page, root } = await open();
      try {
        await root.getByRole('button', { name: '清除選取', exact: true }).click();
        const cards = root.locator('.message input[type=checkbox]');
        await cards.nth(0).click();
        await cards.nth(2).click({ modifiers: ['Shift'] });
        await root.getByText('已選 3 則', { exact: true }).waitFor();
        const row = root.locator(`.treeitem[data-block-id="${first}"]`);
        await row.focus();
        await page.keyboard.press('Control+Space');
        assert.match(await root.locator('.count').textContent(), /^已選 3 則/);
        await page.keyboard.press(' ');
        await root.getByText('已選 2 則', { exact: true }).waitFor();
        await page.keyboard.press(' ');
        await row.getByRole('button', { name: '展開或收合分支' }).click();
        assert.match(await root.locator('.count').textContent(), /已選 3 則.*目前隱藏/);
        const md = await copied(page, root);
        assert.match(md, /^messages: 3$/m);
        assert.match(md, /Follow-up question/);
        await root.getByLabel('顯示工具', { exact: true }).check();
        const tool = root.locator('.treeitem[data-block-id="message:tool-1"] input[type=checkbox]');
        await tool.check();
        await root.getByLabel('顯示工具', { exact: true }).uncheck();
        assert.match(await root.locator('.count').textContent(), /已選 4 則.*目前隱藏/);
        assert.match(await copied(page, root), /Research 1 started/);
      } finally {
        await page.close();
      }
    });

    it('refreshes explicitly without adding new messages and tears down on URL-only navigation', async () => {
      const { page, root, setSource } = await open();
      try {
        const data = clone(FIXTURE);
        data.mapping.new = {
          id: 'new',
          parent: 'tool-2',
          children: [],
          message: {
            id: 'new',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Fresh unselected message'] },
          },
        };
        data.mapping['tool-2'].children.push('new');
        data.current_node = 'new';
        setSource(data);
        await root.getByRole('button', { name: '重新讀取網頁' }).click();
        await root.getByText(/新訊息未自動加入/).waitFor();
        assert.match(await root.locator('.count').textContent(), /^已選 4 則/);
        assert.doesNotMatch(await copied(page, root), /Fresh unselected message/);
        await page.evaluate(() => history.pushState({}, '', '/c/another-conversation'));
        await root.waitFor({ state: 'detached' });
      } finally {
        await page.close();
      }
    });

    it('uses mobile navigation without overflowing the viewport', async () => {
      const { page, root, errors } = await open({ width: 390, height: 844 });
      try {
        await root.locator('[data-mobile-tab=tree]').click();
        await root
          .getByRole('button', { name: '加入到 Unselected report 的 path', exact: true })
          .click();
        await root.locator('[data-mobile-tab=preview]').click();
        await root.getByRole('heading', { name: '分支 2', exact: true }).waitFor();
        const rect = await root.locator('.shell').boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
        await page.screenshot({ path: new URL(`${name}-mobile.png`, OUT).pathname });
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('blocks a selected broken report but still saves the complete archive', async () => {
      const data = clone(FIXTURE);
      data.mapping['tool-3'].message.metadata.chatgpt_sdk.widget_state = '{broken';
      const { page, root, errors } = await open({ data });
      try {
        await root.locator('.treeitem[data-block-id="error:tool-3"] input').check();
        await page.evaluate(() => {
          window.__gmClipboard = null;
        });
        await root.getByRole('button', { name: '複製所選 Markdown', exact: true }).click();
        await root.getByText(/^無法匯出所選訊息/).waitFor();
        assert.equal(await page.evaluate(() => window.__gmClipboard), null);
        const saved = await fileExport(root, '儲存完整對話＋選取', 'broken-archive.json');
        const archive = JSON.parse(saved.text);
        assert.deepEqual(archive.raw, data);
        assert.ok(archive.selection.blockIds.includes('error:tool-3'));
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('renders a 5,000-node tree and reading path on demand while exporting every selection', async () => {
      const data = {
        title: 'Long conversation',
        conversation_id: 'fixture-conversation',
        __expectedCount: 5000,
        mapping: {},
        current_node: 'n4999',
      };
      for (let i = 0; i < 5000; i++)
        data.mapping[`n${i}`] = {
          id: `n${i}`,
          parent: i ? `n${i - 1}` : null,
          children: i < 4999 ? [`n${i + 1}`] : [],
          message: {
            id: `m${i}`,
            author: { role: i % 2 ? 'assistant' : 'user' },
            content: { content_type: 'text', parts: [`Unique message ${i}`] },
          },
        };
      const { page, root, errors } = await open({ data });
      try {
        assert.ok((await root.locator('.treeitem').count()) <= 100);
        assert.ok((await root.locator('.message').count()) <= 60);
        await root.locator('.treeitem').first().focus();
        await page.keyboard.press('End');
        await root.locator('.treeitem[data-block-id="message:n4999"]').waitFor();
        await page.keyboard.press('Enter');
        await root.locator('.message[data-block-id="message:n4999"]').waitFor();
        const md = await copied(page, root);
        assert.match(md, /^messages: 5000$/m);
        assert.match(md, /Unique message 4999/);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.screenshot({ path: new URL(`${name}-dark-long.png`, OUT).pathname });
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('opens a self-contained offline file, imports archives, and falls back from clipboard failure', async () => {
      const page = await browser.newPage({ acceptDownloads: true });
      const remote = [],
        errors = [];
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) remote.push(request.url());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async () => {
              throw new Error('fixture denied');
            },
          },
          configurable: true,
        });
      });
      try {
        await page.goto(OFFLINE.href);
        const root = page.locator('#conversation-explorer');
        await root.getByRole('button', { name: '開啟 JSON 存檔' }).waitFor();
        const raw = clone(FIXTURE);
        raw.mapping['user-1'].message.content.parts[0] =
          '![remote](https://example.invalid/image.png)\n<img src="https://example.invalid/pixel" onerror="window.__injected=1"><script>window.__injected=2</script>\nOffline first question';
        // fromChatGPT reads mapping as the tree authority, not the duplicated linear array.
        await root.locator('input[type=file]').setInputFiles({
          name: 'legacy.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(raw)),
        });
        await root.getByText('已選 4 則', { exact: true }).waitFor();
        await root.getByRole('button', { name: '複製所選 Markdown', exact: true }).click();
        await root.getByRole('textbox', { name: '手動複製所選內容' }).waitFor();
        const text = await root.getByRole('textbox', { name: '手動複製所選內容' }).inputValue();
        assert.match(text, /^messages: 4$/m);
        assert.equal(await page.evaluate(() => window.__injected), undefined);
        const saved = await fileExport(root, '儲存完整對話＋選取', 'offline-archive.json');
        const archive = JSON.parse(saved.text);
        archive.selection.blockIds = [];
        await root.locator('input[type=file]').setInputFiles({
          name: 'empty-selection.chat-archive.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(archive)),
        });
        await root.getByText('已選 0 則', { exact: true }).waitFor();
        assert.equal(
          await root.getByRole('button', { name: '複製所選 Markdown', exact: true }).isEnabled(),
          false
        );
        await root.locator('input[type=file]').setInputFiles({
          name: 'bad.json',
          mimeType: 'application/json',
          buffer: Buffer.from('{broken'),
        });
        await root.getByText(/匯入失敗/).waitFor();
        assert.match(await root.locator('.count').textContent(), /已選 0 則/);
        assert.deepEqual(remote, []);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  });
}
