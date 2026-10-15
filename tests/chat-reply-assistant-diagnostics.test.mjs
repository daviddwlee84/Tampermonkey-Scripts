import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const source = await readFile(
  new URL('../userscripts/chat-reply-assistant/chat-reply-assistant.user.js', import.meta.url),
  'utf8'
);
const diagnostics = source.match(
  /\/\/\s*BEGIN DIAGNOSTICS\b([\s\S]*?)\/\/\s*END DIAGNOSTICS\b/
)?.[1];
assert.ok(
  diagnostics?.includes('function createDiagnosticSnapshot'),
  '測試需直接讀取發佈檔中的診斷區塊'
);
const forbidden = /PRIVATE_|private\.invalid|private-identity/;
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
].filter(([name]) => !process.env.US_BROWSERS || process.env.US_BROWSERS.split(',').includes(name));
assert.ok(engines.length);

for (const [name, engine] of engines) {
  describe(`${name} private local DOM diagnostics`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open() {
      const page = await browser.newPage({
        acceptDownloads: true,
        viewport: { width: 1100, height: 850 },
      });
      await page.route('**/*', (request) => request.abort());
      await page.setContent(`
        <main id="PRIVATE_ID" class="PRIVATE_CLASS" style="font-family:PRIVATE_FONT;display:flex;flex-direction:column">
          <div role="log" style="height:300px;overflow:auto;border-radius:17px">
            <div role="row"><span>PRIVATE_CHAT</span><img src="https://private.invalid/PRIVATE_IMAGE" alt="PRIVATE_ACTOR"></div>
          </div>
          <section id="PRIVATE_SHELL"><div contenteditable="true" role="textbox" aria-label="Reply to PRIVATE_ACTOR">PRIVATE_DRAFT</div><input value="PRIVATE_API_KEY"><textarea>PRIVATE_INITIAL_TEXTAREA</textarea><button aria-label="Send">Send</button></section>
          <a href="https://private.invalid/PRIVATE_HREF" aria-labelledby="PRIVATE_ID">PRIVATE_LINK_TEXT</a>
          <private-identity role="PRIVATE_INVALID_ROLE">PRIVATE_CUSTOM_CONTENT</private-identity>
          <div data-cra-owned><meter>PRIVATE_OWNED_UI</meter></div>
        </main>`);
      await page.addScriptTag({ content: diagnostics });
      await page.evaluate(() => {
        document.querySelector('textarea').value = 'PRIVATE_CHANGED_TEXTAREA';
        window.view = {
          root: document.querySelector('main'),
          messageRoot: document.querySelector('[role="log"]'),
          composerShell: document.querySelector('section'),
          composer: document.querySelector('[contenteditable]'),
          title: 'PRIVATE_THREAD_TITLE',
          titleSource: 'native',
          identity: 'PRIVATE_THREAD_ID',
          accountId: 'PRIVATE_ACCOUNT',
          messages: [
            {
              id: 'PRIVATE_MESSAGE_ID',
              sender: 'PRIVATE_ACTOR',
              senderId: 'PRIVATE_SENDER_ID',
              direction: 'self',
              text: 'PRIVATE_MESSAGE_BODY',
              attachments: [
                { kind: 'image', url: 'https://private.invalid/PRIVATE_ATTACHMENT_URL' },
              ],
            },
          ],
          settings: { apiKey: 'PRIVATE_SETTINGS_KEY' },
        };
        window.candidateView = null;
        window.route = {
          platform: 'messenger',
          id: 'PRIVATE_ROUTE_ID',
          url: 'https://private.invalid/PRIVATE_ROUTE',
        };
        window.adapter = {};
        window.replyPreferences = () => ({
          openingGoal: 'PRIVATE_OPENING_GOAL',
          apiKey: 'PRIVATE_PREFERENCE_KEY',
        });
        window.element = (tag, attributes) => {
          const node = document.createElement(tag);
          for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
          return node;
        };
      });
      return page;
    }

    it('只輸出結構與長度，訊息、身分、網址、DOM 識別碼、輸入值與設定均不外洩', async () => {
      const page = await open();
      try {
        const result = await page.evaluate(() =>
          createDiagnosticSnapshot(window.view, 'messenger')
        );
        assert.doesNotMatch(JSON.stringify(result), forbidden);
        assert.equal(result.platform, 'messenger');
        assert.equal(result.messageSummary.count, 1);
        assert.equal(result.messageSummary.self, 1);
        assert.equal(result.messageSummary.image, 1);
        assert.equal(result.messageSummary.textCharacters, 'PRIVATE_MESSAGE_BODY'.length);
        const nodes = result.samples.flatMap((sample) => sample.nodes);
        assert.ok(nodes.some((node) => node.role === 'log' && node.style.overflowY === 'auto'));
        assert.ok(nodes.some((node) => node.tag === 'custom-element'));
        assert.ok(
          nodes.every((node) => node.tag !== 'meter'),
          '自己的 UI 不應混入診斷樣本'
        );
        assert.ok(
          nodes
            .filter((node) => node.editable || ['input', 'textarea'].includes(node.tag))
            .every((node) => node.directTextLength === 0)
        );
        const visit = (value) => {
          if (!value || typeof value !== 'object') return;
          for (const [key, child] of Object.entries(value)) {
            assert.ok(
              ![
                'id',
                'class',
                'href',
                'src',
                'value',
                'sender',
                'senderId',
                'accountId',
                'settings',
              ].includes(key),
              `不得匯出敏感欄位 ${key}`
            );
            visit(child);
          }
        };
        visit(result);
      } finally {
        await page.close();
      }
    });

    it('大量與深層 DOM 仍限制 800 節點／8 層，並保留輸入區配額', async () => {
      const page = await open();
      try {
        await page.evaluate(() => {
          const log = document.querySelector('[role="log"]');
          for (let index = 0; index < 1200; index++) {
            const row = document.createElement('div');
            row.setAttribute('role', 'row');
            row.textContent = `PRIVATE_MESSAGE_${index}`;
            log.append(row);
          }
          let branch = document.createElement('section');
          document.querySelector('main').append(branch);
          for (let depth = 0; depth < 20; depth++) {
            const child = document.createElement('div');
            branch.append(child);
            branch = child;
          }
        });
        const result = await page.evaluate(() =>
          createDiagnosticSnapshot(window.view, 'messenger')
        );
        const nodes = result.samples.flatMap((sample) => sample.nodes);
        assert.ok(result.truncated);
        assert.ok(result.nodeCount <= 800);
        assert.equal(result.nodeCount, nodes.length);
        assert.ok(nodes.every((node) => node.depth <= 8));
        assert.ok(
          result.samples.some(
            (sample) => sample.region === 'composer' && sample.nodes.some((node) => node.editable)
          )
        );
        assert.doesNotMatch(JSON.stringify(result), forbidden);
      } finally {
        await page.close();
      }
    });

    it('使用候選畫面匯出真正的本機 Blob JSON，無須 GM 或網路', async () => {
      const page = await open();
      try {
        await page.evaluate(() => {
          window.candidateView = {
            snapshot: {
              ...window.view,
              messages: [
                { text: 'PRIVATE_CANDIDATE_ONE', direction: 'other', attachments: [] },
                { text: 'PRIVATE_CANDIDATE_TWO', direction: 'other', attachments: [] },
              ],
            },
          };
        });
        let network = 0;
        page.on('request', () => network++);
        const pending = page.waitForEvent('download');
        await page.evaluate(() => exportDiagnostics());
        const download = await pending;
        const text = await readFile(await download.path(), 'utf8');
        assert.doesNotMatch(text, forbidden);
        const result = JSON.parse(text);
        assert.equal(result.messageSummary.count, 2);
        assert.equal(result.messageSummary.other, 2);
        assert.equal(result.format, 'chat-reply-assistant-dom-diagnostic/1');
        assert.match(
          download.suggestedFilename(),
          /^chat-reply-assistant-diagnostic-messenger-\d{4}-\d{2}-\d{2}\.json$/
        );
        assert.equal(network, 0, '診斷匯出不可發出網路請求');
      } finally {
        await page.close();
      }
    });

    it('沒有畫面或定位失敗時匯出安全空結果，不把錯誤或任意平台字串寫入檔案', async () => {
      const page = await open();
      try {
        const empty = await page.evaluate(() => createDiagnosticSnapshot(null, 'PRIVATE_PLATFORM'));
        assert.equal(empty.platform, 'unknown');
        assert.equal(empty.surface.available, false);
        assert.equal(empty.nodeCount, 0);
        await page.evaluate(() => {
          window.view = null;
          window.candidateView = null;
          window.route.platform = 'PRIVATE_PLATFORM';
          window.adapter.locateSurface = () => {
            throw new Error('PRIVATE_EXCEPTION_WITH_URL');
          };
        });
        const pending = page.waitForEvent('download');
        await page.evaluate(() => exportDiagnostics());
        const download = await pending,
          text = await readFile(await download.path(), 'utf8');
        assert.doesNotMatch(text, forbidden);
        assert.equal(JSON.parse(text).surface.available, false);
        assert.match(download.suggestedFilename(), /^chat-reply-assistant-diagnostic-unknown-/);
      } finally {
        await page.close();
      }
    });
  });
}
