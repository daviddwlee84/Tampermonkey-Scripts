import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SCRIPT, SHARED, UI] = await Promise.all([
  read('userscripts/gemini-export-markdown/gemini-export-markdown.user.js'),
  read('shared/chat-export.js'),
  read('shared/export-ui.js'),
]);

const ORIGIN = 'https://gemini.google.com';
const CONVO = 'fixture0convo01';
const SHARE_ID = 'fixtureshare1';
const ENGINES = { chromium, firefox };
const selected = (process.env.GEMINI_BROWSERS || 'chromium,firefox')
  .split(',')
  .map((name) => name.trim());
for (const name of selected) assert.ok(ENGINES[name], `Unknown GEMINI_BROWSERS engine: ${name}`);

// ------------------------------------------------------------ 合成 payload
// 形狀照實測的 batchexecute：每輪 `[[c_, r_], <parent>, <user>, <response>, [秒, 奈秒]]`，
// parent 是 `[c_, r_<上一輪>, rc_<上一輪草稿>]`，第一輪是 null。內容全是假資料。

const ROUNDS = [
  { id: 'r_0001', rc: 'rc_0001', at: 1794915518, q: 'FIRST QUESTION', a: 'FIRST ANSWER' },
  { id: 'r_0002', rc: 'rc_0002', at: 1794915547, q: 'SECOND QUESTION', a: 'SECOND ANSWER' },
  { id: 'r_0003', rc: 'rc_0003', at: 1794915565, q: 'THIRD QUESTION', a: 'THIRD ANSWER' },
];

function turn(index) {
  const round = ROUNDS[index];
  const prev = ROUNDS[index - 1];
  return [
    [`c_${CONVO}`, round.id],
    prev ? [`c_${CONVO}`, prev.id, prev.rc] : null,
    [[round.q, null, null, null, [[]]], 2, null, 1, 'abcdef0123456789'],
    [[[round.rc, [`${round.a}\n\nbody of ${round.id}`], null, null, 'zh']], null, '3 Flash'],
    [round.at, 123000000],
  ];
}

function batchBody(rpcid, payload) {
  const row = JSON.stringify([
    ['wrb.fr', rpcid, JSON.stringify(payload), null, null, null, 'generic'],
  ]);
  return `)]}'\n\n${row.length}\n${row}\n`;
}

// app 頁載歷史：最新在前。
const APP_HISTORY = batchBody('hNvQHb', [[turn(2), turn(1), turn(0)], null, null, []]);
// app 頁送出新訊息後的補抓：只帶最新一輪。
const APP_LATEST = batchBody('hNvQHb', [[turn(2)], null, null, []]);
// share 頁：由舊到新，帶 meta。
const SHARE = batchBody('ujx1Bf', [
  null,
  [turn(0), turn(1), turn(2)],
  [true, 'Fixture share title', null, null, null, null, null, [2, 'model-id', 'Flash'], true],
  SHARE_ID,
  [1794915500, 0],
]);

const pageHtml = (bodies) => `<!doctype html><html><head><title>Fixture chat - Gemini</title>
<link rel="icon" href="data:,"></head><body><main></main><script>
(async () => {
  for (const name of ${JSON.stringify(bodies)}) {
    await fetch('/_/BardChatUi/data/batchexecute?rpcids=fixture&name=' + name, { method: 'POST' });
  }
  window.__fixtureFetched = true;
})();
</script></body></html>`;

function gmShim() {
  const storage = Object.create(null);
  window.unsafeWindow = window;
  window.__gmMenus = Object.create(null);
  window.__gmClipboard = [];
  window.GM_getValue = (key, fallback) => (key in storage ? storage[key] : fallback);
  window.GM_setValue = (key, value) => {
    storage[key] = value;
  };
  window.GM_deleteValue = (key) => {
    delete storage[key];
  };
  window.GM_openInTab = () => {};
  window.GM_registerMenuCommand = (label, callback) => {
    window.__gmMenus[label] = callback;
  };
  window.GM_setClipboard = (text) => window.__gmClipboard.push(text);
}

function assertChronological(markdown, expectedTurns = 3) {
  const terms = ROUNDS.slice(0, expectedTurns).flatMap((round) => [round.q, round.a]);
  const positions = terms.map((text) => markdown.indexOf(text));
  positions.forEach((at, i) => {
    assert.ok(at >= 0, `missing ${terms[i]}`);
    if (i) assert.ok(at > positions[i - 1], `${terms[i]} must come after ${terms[i - 1]}`);
  });
  assert.match(markdown, new RegExp(`^messages: ${expectedTurns * 2}$`, 'm'));
  assert.equal((markdown.match(/_\*\*User\b/g) || []).length, expectedTurns);
  assert.equal((markdown.match(/_\*\*Assistant\b/g) || []).length, expectedTurns);
}

const stamp = (sec) => `${new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ')}Z`;

for (const engineName of selected) {
  describe(`${engineName} Gemini export ordering (GM shim)`, { timeout: 120000 }, () => {
    let browser;
    before(async () => {
      browser = await ENGINES[engineName].launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function exportMarkdown(path, responses) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/_/BardChatUi/data/batchexecute') {
          const name = url.searchParams.get('name');
          return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: responses[name] ?? ")]}'\n",
          });
        }
        if (url.origin === ORIGIN && url.pathname === path) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: pageHtml(Object.keys(responses)),
          });
        }
        return route.abort();
      });

      // document-start 注入，跟真的 manager 一樣在網站發請求之前換掉 fetch。
      await page.addInitScript({
        content: `(${gmShim.toString()})();\n${SHARED}\n${UI}\n${SCRIPT}`,
      });
      await page.goto(`${ORIGIN}${path}`);
      await page.waitForFunction(() => window.__fixtureFetched === true);
      await page.waitForTimeout(200); // capture 是 clone().text() 非同步讀的

      await page.evaluate(() => window.__gmMenus['Copy Markdown']());
      await page.waitForFunction(() => window.__gmClipboard.length > 0);
      const markdown = await page.evaluate(() => window.__gmClipboard.at(-1));
      assert.deepEqual(errors, []);
      await context.close();
      return markdown;
    }

    it('reorders newest-first app history into chronological order', async () => {
      const markdown = await exportMarkdown(`/app/${CONVO}`, { history: APP_HISTORY });
      assertChronological(markdown);
      assert.match(markdown, new RegExp(`^created_at: "?${stamp(ROUNDS[0].at)}"?$`, 'm'));
      assert.match(markdown, new RegExp(`^conversation_id: "?${CONVO}"?$`, 'm'));
    });

    it('keeps full history when a later capture only carries the latest turn', async () => {
      const markdown = await exportMarkdown(`/app/${CONVO}`, {
        history: APP_HISTORY,
        latest: APP_LATEST,
      });
      assertChronological(markdown);
    });

    it('leaves already-chronological share payloads in order', async () => {
      const markdown = await exportMarkdown(`/share/${SHARE_ID}`, { share: SHARE });
      assertChronological(markdown);
      assert.match(markdown, /Fixture share title/);
    });
  });
}
