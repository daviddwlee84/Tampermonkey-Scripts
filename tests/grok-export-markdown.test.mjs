import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SCRIPT, SHARED, UI, SHARE, DOM, PLACEHOLDERS] = await Promise.all([
  read('userscripts/grok-export-markdown/grok-export-markdown.user.js'),
  read('shared/chat-export.js'),
  read('shared/export-ui.js'),
  read('tests/fixtures/grok-export/share.json'),
  read('tests/fixtures/grok-export/conversation.html'),
  read('tests/fixtures/grok-export/placeholders.html'),
]);
const ORIGIN = 'https://grok.com';
const SHARE_ID = 'bGVnYWN5_fixture-id';
const SHARE_URL = `${ORIGIN}/share/${SHARE_ID}`;
const API_URL = `${ORIGIN}/rest/app-chat/share_links/${SHARE_ID}`;
const ROOT = '#grok-export-md-root';
const PANEL = '#grok-export-md-panel';
const EMPTY =
  '<!doctype html><html><head><title>Empty fixture</title><link rel="icon" href="data:,"></head><body><nav>OUTSIDE_CONVERSATION_SENTINEL</nav><main id="conversation"></main></body></html>';
const ACTIONS = ['Copy Markdown', 'Copy Agent Handoff', 'Download .md', 'Download .json'];
const ENGINES = { chromium, firefox };
const selected = (process.env.GROK_BROWSERS || 'chromium,firefox')
  .split(',')
  .map((name) => name.trim());
for (const name of selected) assert.ok(ENGINES[name], `Unknown GROK_BROWSERS engine: ${name}`);

function gmShim() {
  const storage = Object.create(null);
  window.__gmMenus = Object.create(null);
  window.__gmMenuNames = [];
  window.__gmInvocations = [];
  window.__gmClipboard = [];
  window.__gmWrites = [];
  window.__downloadBlobs = [];
  window.GM_getValue = (key, fallback) => (key in storage ? storage[key] : fallback);
  window.GM_setValue = (key, value) => {
    storage[key] = value;
    window.__gmWrites.push({ key, value });
  };
  window.GM_registerMenuCommand = (label, callback) => {
    window.__gmMenuNames.push(label);
    window.__gmMenus[label] = (...args) => {
      window.__gmInvocations.push(label);
      return callback(...args);
    };
  };
  window.GM_setClipboard = (text, type) => window.__gmClipboard.push({ text, type });
  // 只觀察 MIME／size；保留真正 Blob URL 與瀏覽器下載流程。
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__downloadBlobs.push({ type: blob.type, size: blob.size });
    return create(blob);
  };
}

function scope(markdown, exportScope, completeness) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'frontmatter must start the delivered Markdown');
  assert.match(match[1], /^source: grok$/m);
  assert.match(match[1], new RegExp(`^export_scope: ["']?${exportScope}["']?$`, 'm'));
  assert.match(match[1], new RegExp(`^completeness: ["']?${completeness}["']?$`, 'm'));
  const body = markdown.slice(match[0].length);
  if (exportScope === 'published-share-snapshot') {
    assert.match(
      body,
      /公開|published|public/i,
      'share limitation must be visible outside frontmatter'
    );
    assert.match(body, /快照|snapshot/i);
    assert.match(body, /不保證|不代表|not guarantee|not necessarily|private history/i);
  } else {
    assert.match(body, /已載入|loaded/i, 'DOM limitation must be visible outside frontmatter');
    assert.match(body, /缺漏|不完整|可能遺漏|未載入|partial|missing|incomplete/i);
  }
}

function shareContent(markdown, completeness = 'unknown') {
  scope(markdown, 'published-share-snapshot', completeness);
  assert.match(markdown, /^messages: 4$/m);
  const terms = ['FIRST QUESTION', 'FIRST ANSWER', 'FOLLOWUP QUESTION', 'FOLLOWUP ANSWER'];
  const positions = terms.map((text) => markdown.indexOf(text));
  assert.ok(
    positions.every((at, i) => at >= 0 && (!i || at > positions[i - 1])),
    'retain API order, not timestamps'
  );
  assert.equal((markdown.match(/_\*\*User\b/g) || []).length, 2);
  assert.equal((markdown.match(/_\*\*Assistant\b/g) || []).length, 2);
  assert.ok(markdown.includes('| Item | Value |\n| --- | --- |\n| A | 42 |'));
  assert.ok(markdown.includes('```js\nconst value = 42;\n```'));
  assert.ok(markdown.includes('$$x^2 + y^2$$'));
  assert.ok(markdown.includes('[Remote document](https://example.com/document)'));
  assert.ok(markdown.includes('[Cited reference](https://example.com/cited)'));
  assert.equal(markdown.split('https://example.com/cited').length - 1, 1);
  assert.doesNotMatch(
    markdown,
    /CONTROL_SENTINEL|TOOL_SENTINEL|THINKING_SENTINEL|UNKNOWN_ROLE_SENTINEL|CANDIDATE_ONLY|uncited-candidate|OUTSIDE_CONVERSATION_SENTINEL/
  );
}

function domContent(markdown) {
  scope(markdown, 'loaded-dom', 'partial');
  assert.match(markdown, /^messages: 2$/m);
  assert.ok(markdown.indexOf('DOM QUESTION') < markdown.indexOf('DOM ANSWER'));
  for (const text of [
    '## DOM ANSWER',
    '**Bold value**',
    '*emphasis*',
    '> Quoted value',
    'Nested item',
  ]) {
    assert.ok(markdown.includes(text), `missing DOM semantic content: ${text}`);
  }
  assert.match(markdown, /1\. First item/);
  assert.match(markdown, /2\. Second item/);
  assert.match(markdown, /\|\s*Item\s*\|\s*Value\s*\|/);
  assert.match(markdown, /\|\s*Alpha\s*\|\s*42\s*\|/);
  assert.ok(markdown.includes('[Relative document](https://grok.com/docs/fixture)'));
  assert.ok(markdown.includes('![Synthetic diagram](https://grok.com/assets/fixture.svg)'));
  assert.ok(markdown.includes('$x + 1$'));
  const code = markdown.match(/(`{4,}|~{3,})js\n([\s\S]*?)\n\1/);
  assert.ok(code, 'embedded triple backticks need a longer or alternate code fence');
  assert.ok(code[2].includes("const ticks = '```';\n  console.log(ticks);"));
  assert.doesNotMatch(
    markdown,
    /SENTINEL|Copy Markdown|Copy Agent Handoff|Download \.md|Download \.json/
  );
}

function envelope(text, url) {
  const data = JSON.parse(text);
  assert.equal(data.source, 'grok');
  assert.equal(data.schema, 'grok-loaded-dom-v1');
  assert.equal(data.url, url);
  assert.equal(data.export_scope, 'loaded-dom');
  assert.equal(data.completeness, 'partial');
  assert.ok(data.title);
  assert.ok(Number.isFinite(Date.parse(data.capturedAt)), 'capture timestamp must be parseable');
  assert.equal(data.messages.length, 2);
  assert.equal(new Set(data.messages.map((message) => message.id)).size, 2);
  assert.deepEqual(
    data.messages.map((message) => message.role.toLowerCase()),
    ['user', 'assistant']
  );
  for (const message of data.messages) {
    assert.ok(message.id);
    assert.ok(message.parts.length);
    for (const part of message.parts) {
      assert.ok(['markdown', 'html'].includes(part.format));
      assert.equal(typeof part.content, 'string');
      // DOM JSON 保留 KaTeX HTML 與 annotation；數學去重由 Markdown assertion 驗證。
      assert.doesNotMatch(
        part.content,
        /(?:OUTSIDE_CONVERSATION|ROLE_LABEL|THINKING_DOM|COPY_TABLE|DOWNLOAD_TABLE|SOURCES_BUTTON|ROLE_BUTTON|NO_COPY|NESTED_THINKING|OWN_UI|SCRIPT|STYLE|FOOTER|RAW_DUPLICATE)_SENTINEL|Copy Markdown|Download \.json/
      );
    }
  }
  return data;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bubble(id, text, role = 'user') {
  return `<section id="response-${id}"><div data-testid="${role}-message"><div class="response-content-markdown"><p>${text}</p></div></div></section>`;
}

for (const engineName of selected) {
  describe(`${engineName} Grok black-box exports (GM shim)`, { timeout: 120000 }, () => {
    let browser;
    before(async () => {
      browser = await ENGINES[engineName].launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open(t, { url = SHARE_URL, html = EMPTY, data = JSON.parse(SHARE), api } = {}) {
      const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      const consoleMessages = [];
      const unexpected = [];
      const requests = [];
      const failures = [];
      const downloads = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) =>
        consoleMessages.push({ type: message.type(), text: message.text() })
      );
      page.on('requestfailed', (request) =>
        failures.push({ url: request.url(), error: request.failure()?.errorText })
      );
      page.on('download', (download) => downloads.push(download));
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (
          request.url() === url &&
          request.resourceType() === 'document' &&
          request.method() === 'GET'
        ) {
          return route.fulfill({ contentType: 'text/html', body: html });
        }
        if (request.url() === API_URL && request.method() === 'GET') {
          requests.push(request.url());
          return api ? api(route) : route.fulfill({ json: data });
        }
        if (
          request.url() === `${ORIGIN}/assets/fixture.svg` &&
          request.resourceType() === 'image'
        ) {
          return route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
          });
        }
        unexpected.push(`${request.method()} ${request.url()}`);
        return route.abort();
      });
      // 單一 init bundle 固定 shim → dependencies → script；DOM ready 近似 document-idle，
      // 不替換 adapter、renderer、UI 或下載函式，也不宣稱驗證真正 manager 的 run-at。
      await context.addInitScript({
        content: `(${gmShim})();\ndocument.addEventListener('DOMContentLoaded', () => {\n${SHARED}\n${UI}\n${SCRIPT}\n}, { once: true });`,
      });
      t.after(async () => {
        await context.close();
        assert.deepEqual(errors, [], JSON.stringify(consoleMessages));
        assert.deepEqual(unexpected, [], 'fixture must not access any other network route');
      });
      await page.goto(url);
      await page.waitForFunction(() => window.__gmMenuNames.length === 5);
      assert.deepEqual(
        await page.evaluate(() => [...window.__gmMenuNames].sort()),
        [...ACTIONS, 'Reset button position'].sort()
      );

      const menu = (label) =>
        page.evaluate(async (name) => {
          const run = window.__gmMenus[name];
          if (!run) throw new Error(`Missing GM menu: ${name}`);
          await run();
        }, label);
      async function action(label, transport = 'menu') {
        if (transport === 'menu') return menu(label);
        if (!(await page.locator(PANEL).isVisible()))
          await page.locator(`${ROOT} > button`).click();
        await page.locator(PANEL).getByRole('button', { name: label, exact: true }).click();
      }
      async function copy(label = 'Copy Markdown', transport = 'menu') {
        const count = await page.evaluate(() => window.__gmClipboard.length);
        await action(label, transport);
        await page.waitForFunction((previous) => window.__gmClipboard.length > previous, count);
        return page.evaluate(() => window.__gmClipboard.at(-1).text);
      }
      async function download(extension, transport = 'menu') {
        const ready = page.waitForEvent('download');
        await action(`Download .${extension}`, transport);
        const file = await ready;
        assert.equal(await file.failure(), null);
        assert.match(file.suggestedFilename(), new RegExp(`^grok-.+\\.${extension}$`));
        const chunks = [];
        for await (const chunk of await file.createReadStream()) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        assert.ok(bytes.length);
        const blob = await page.evaluate(() => window.__downloadBlobs.at(-1));
        assert.equal(blob.size, bytes.length);
        assert.equal(
          blob.type,
          extension === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
        );
        return bytes.toString('utf8');
      }
      return { page, menu, copy, download, requests, failures, downloads, consoleMessages };
    }

    for (const transport of ['menu', 'panel']) {
      it(`executes all four ${transport} actions with exact underscore share ID and scope notices`, async (t) => {
        const data = JSON.parse(SHARE);
        // 正常快照驗 unknown；未知角色／工具另由 partial 案例覆蓋。
        data.responses = data.responses.filter((message) =>
          ['human', 'assistant'].includes(message.sender)
        );
        const original = JSON.stringify(data);
        const app = await open(t, { data });
        const markdown = await app.copy('Copy Markdown', transport);
        shareContent(markdown);
        assert.doesNotMatch(markdown, /# Prior Grok Context/);
        const handoff = await app.copy('Copy Agent Handoff', transport);
        shareContent(handoff);
        assert.match(handoff, /# Prior Grok Context/);
        shareContent(await app.download('md', transport));
        assert.deepEqual(JSON.parse(await app.download('json', transport)), data);
        assert.equal(JSON.stringify(data), original);
        assert.ok(app.requests.length > 0);
        assert.ok(app.requests.every((url) => url === API_URL));
        assert.equal(await app.page.locator(ROOT).count(), 1);
        await app.menu('Reset button position');
        const reset = await app.page.evaluate(() => ({
          value: window.__gmWrites.at(-1)?.value,
          style: document.querySelector('#grok-export-md-root').style.cssText,
        }));
        assert.equal(reset.value, null);
        assert.match(reset.style, /right: 16px/);
        assert.match(reset.style, /bottom: 16px/);
      });
    }

    it('marks partial responses without exporting controls, steps, unknown roles or search candidates', async (t) => {
      const data = JSON.parse(SHARE);
      data.responses[1].partial = true;
      const app = await open(t, { data });
      shareContent(await app.copy(), 'partial');
      assert.deepEqual(JSON.parse(await app.download('json')), data);
    });

    it('retains the first conflicting response ID and labels omitted data while raw JSON keeps both', async (t) => {
      const data = JSON.parse(SHARE);
      data.responses.push({ ...data.responses[1], message: 'CONFLICTING_VERSION_SENTINEL' });
      const app = await open(t, { data });
      const markdown = await app.copy();
      shareContent(markdown, 'partial');
      assert.doesNotMatch(markdown, /CONFLICTING_VERSION_SENTINEL/);
      assert.match(markdown, /衝突|重複|conflict|duplicate/i);
      assert.deepEqual(JSON.parse(await app.download('json')), data);
    });

    it('recovers unchanged raw JSON when an unsupported message object cannot render', async (t) => {
      const data = JSON.parse(SHARE);
      data.responses = [
        {
          responseId: 'unsupported',
          sender: 'assistant',
          message: { futureFormat: ['OPAQUE_SENTINEL'] },
        },
      ];
      const app = await open(t, { data });
      await app.menu('Copy Markdown');
      assert.deepEqual(await app.page.evaluate(() => window.__gmClipboard), []);
      const diagnostics = await app.page.locator(PANEL).textContent();
      assert.match(
        `${diagnostics}\n${app.consoleMessages.map((entry) => entry.text).join('\n')}`,
        /不支援|無法|沒有可匯出|未知|unsupported|unknown|render/i
      );
      assert.deepEqual(JSON.parse(await app.download('json')), data);
      assert.equal(app.downloads.length, 1);
    });

    for (const failure of ['http', 'json']) {
      it(`falls back to same-share DOM after ${failure} failure, with honest JSON and Markdown scope`, async (t) => {
        const app = await open(t, {
          html: DOM,
          api: (route) =>
            route.fulfill(
              failure === 'http'
                ? { status: 503, json: { error: 'fixture unavailable' } }
                : { contentType: 'application/json', body: '{invalid-json' }
            ),
        });
        domContent(await app.copy());
        scope(await app.copy('Copy Agent Handoff'), 'loaded-dom', 'partial');
        envelope(await app.download('json'), SHARE_URL);
        assert.ok(app.requests.length > 0);
      });
    }

    it('exports DOM-only semantics and cleaned snapshots without changing the source or requesting private APIs', async (t) => {
      const url = `${ORIGIN}/c/fixture`;
      const app = await open(t, { url, html: DOM });
      const original = await app.page.locator('#conversation').innerHTML();
      domContent(await app.copy());
      const handoff = await app.copy('Copy Agent Handoff');
      domContent(handoff);
      assert.match(handoff, /# Prior Grok Context/);
      domContent(await app.download('md', 'panel'));
      const json = envelope(await app.download('json', 'panel'), url);
      assert.ok(json.messages[0].id.endsWith('dom-user'));
      assert.ok(json.messages[1].id.endsWith('dom-assistant'));
      assert.ok(
        json.messages[1].parts.some(
          (part) => part.format === 'html' && part.content.includes('<table')
        )
      );
      assert.equal(
        await app.page.locator('#conversation').innerHTML(),
        original,
        'cleanup must affect clones only'
      );
      assert.equal(
        await app.page.getByRole('button', { name: 'COPY_TABLE_SENTINEL', exact: true }).count(),
        1
      );
      assert.deepEqual(app.requests, []);
    });

    it('keeps every fenced code line inside its nested list or blockquote', async (t) => {
      const app = await open(t, { url: `${ORIGIN}/c/fixture`, html: DOM });
      const markdown = await app.copy();
      const nested = markdown.match(/^([ ]+)(`{3,}|~{3,})python\n([\s\S]*?)^\1\2$/m);
      assert.ok(nested, 'nested code fence must have matching indentation on both ends');
      const indent = nested[1];
      assert.ok(
        indent.length >= 5,
        'code belongs beneath an unordered item inside an ordered item'
      );
      assert.equal(nested[3], `${indent}for i in range(2):\n${indent}    print(i)\n`);
      assert.match(markdown, /^> (`{3,}|~{3,})text\n> alpha\n>   beta\n> \1$/m);
      assert.doesNotMatch(
        markdown,
        /^for i in range\(2\):|^alpha$|^  beta$/m,
        'code must not escape its container'
      );
      assert.deepEqual(app.requests, []);
    });

    it('keeps sole raw placeholders and prefers rendered content without duplicate conversion', async (t) => {
      const url = `${ORIGIN}/c/fixture`;
      const app = await open(t, { url, html: PLACEHOLDERS });
      const original = await app.page.locator('#conversation').innerHTML();
      const markdown = await app.copy();
      scope(markdown, 'loaded-dom', 'partial');
      assert.ok(markdown.includes('```md\n# This is code, not a heading\n```'));
      assert.ok(markdown.includes('- raw list value'));
      assert.equal(markdown.split('RENDERED ANSWER').length - 1, 1);
      assert.ok(markdown.includes('**RENDERED ANSWER**'));
      assert.doesNotMatch(markdown, /RAW_DUPLICATE_SENTINEL/);
      const json = envelope(await app.download('json'), url);
      assert.equal(json.messages[0].parts[0].format, 'markdown');
      assert.ok(json.messages[0].parts[0].content.includes('```md'));
      assert.equal(json.messages[1].parts[0].format, 'html');
      assert.equal(await app.page.locator('#conversation').innerHTML(), original);
      assert.deepEqual(app.requests, []);
    });

    it('waits for delayed message mount instead of scraping the whole body', async (t) => {
      const app = await open(t, { url: `${ORIGIN}/c/fixture` });
      const pending = app.copy();
      await app.page.waitForFunction(() => window.__gmInvocations.includes('Copy Markdown'));
      assert.deepEqual(await app.page.evaluate(() => window.__gmClipboard), []);
      await app.page.evaluate(
        (html) => {
          document.querySelector('#conversation').innerHTML = html;
        },
        bubble('delayed', 'DELAYED MOUNT CONTENT')
      );
      const markdown = await pending;
      scope(markdown, 'loaded-dom', 'partial');
      assert.ok(markdown.includes('DELAYED MOUNT CONTENT'));
      assert.doesNotMatch(markdown, /OUTSIDE_CONVERSATION_SENTINEL/);
      assert.equal(await app.page.locator(ROOT).count(), 1);
      assert.deepEqual(app.requests, []);
    });

    it(
      'bounds an empty DOM wait without exporting unrelated page text',
      { timeout: 10000 },
      async (t) => {
        const app = await open(t, { url: `${ORIGIN}/c/fixture` });
        await app.menu('Copy Markdown');
        assert.deepEqual(await app.page.evaluate(() => window.__gmClipboard), []);
        assert.equal(app.downloads.length, 0);
        assert.match(
          await app.page.locator(PANEL).textContent(),
          /找不到|重新載入|no .*messages|reload/i
        );
        assert.deepEqual(app.requests, []);
      }
    );

    it('mounts once on home-to-conversation SPA navigation and refuses unsupported routes', async (t) => {
      const app = await open(t, { url: `${ORIGIN}/` });
      assert.equal(await app.page.locator(ROOT).isVisible(), false);
      await app.page.evaluate(
        (html) => {
          history.pushState({}, '', '/c/fixture');
          document.querySelector('#conversation').innerHTML = html;
        },
        bubble('spa-user', 'SPA MOUNT CONTENT')
      );
      await app.page.locator(ROOT).waitFor({ state: 'visible' });
      assert.ok((await app.copy()).includes('SPA MOUNT CONTENT'));
      await app.page.evaluate(() => {
        for (let i = 0; i < 5; i++)
          document.querySelector('#conversation').append(document.createElement('span'));
      });
      assert.equal(await app.page.locator(ROOT).count(), 1);
      await app.page.evaluate(() => history.pushState({}, '', '/settings'));
      await app.page.locator(ROOT).waitFor({ state: 'hidden' });
      const copies = await app.page.evaluate(() => window.__gmClipboard.length);
      await app.menu('Copy Markdown');
      assert.equal(await app.page.evaluate(() => window.__gmClipboard.length), copies);
      assert.equal(app.downloads.length, 0);
      assert.deepEqual(app.requests, []);
    });

    it('rejects old bubbles on URL-only navigation, including mixed old/new DOM, then accepts replacement', async (t) => {
      const app = await open(t, { url: `${ORIGIN}/c/fixture`, html: DOM });
      await app.page.locator(ROOT).waitFor({ state: 'visible' });
      await app.page.evaluate(() => history.pushState({}, '', '/c/replacement'));
      const pending = app.copy();
      // 負向時窗跨越兩次 250ms route tick，確認舊泡泡不會被立即交付。
      await app.page.waitForTimeout(550);
      assert.deepEqual(await app.page.evaluate(() => window.__gmClipboard), []);
      await app.page.evaluate(
        (html) => {
          document.querySelector('#conversation').insertAdjacentHTML('beforeend', html);
        },
        bubble('new-route-user', 'REPLACEMENT CONTENT')
      );
      await app.page.waitForTimeout(550);
      assert.deepEqual(
        await app.page.evaluate(() => window.__gmClipboard),
        [],
        'new IDs do not make retained old nodes safe'
      );
      await app.page.evaluate(() => {
        document.querySelector('#response-dom-user').remove();
        document.querySelector('#response-dom-assistant').remove();
      });
      const markdown = await pending;
      assert.ok(markdown.includes('REPLACEMENT CONTENT'));
      assert.doesNotMatch(markdown, /DOM QUESTION|DOM ANSWER|SENTINEL/);
      assert.match(markdown, /^url:.*\/c\/replacement/m);
      assert.deepEqual(app.requests, []);
    });

    it('keeps old response identities across rapid A-to-B-to-C navigation until A nodes disappear', async (t) => {
      const app = await open(t, { url: `${ORIGIN}/c/fixture`, html: DOM });
      await app.page.locator(ROOT).waitFor({ state: 'visible' });
      await app.page.evaluate(() => history.pushState({}, '', '/c/intermediate'));
      const intermediate = app.menu('Copy Markdown');
      await app.page.waitForFunction(() => window.__gmInvocations.length === 1);
      await app.page.evaluate(() => history.pushState({}, '', '/c/final'));
      const pending = app.copy();
      await app.page.waitForFunction(() => window.__gmInvocations.length === 2);
      await intermediate;
      await app.page.waitForTimeout(350);
      assert.deepEqual(
        await app.page.evaluate(() => window.__gmClipboard),
        [],
        'second URL change must not forget stale A identities'
      );
      await app.page.evaluate(
        (html) => {
          document.querySelector('#conversation').innerHTML = html;
        },
        bubble('final-route-user', 'FINAL ROUTE CONTENT')
      );
      const markdown = await pending;
      assert.ok(markdown.includes('FINAL ROUTE CONTENT'));
      assert.match(markdown, /^url:.*\/c\/final/m);
      assert.doesNotMatch(markdown, /DOM QUESTION|DOM ANSWER|SENTINEL/);
      assert.deepEqual(app.requests, []);
    });

    for (const label of ['Copy Markdown', 'Download .json']) {
      it(`cancels pending share ${label} on navigation without stale output`, async (t) => {
        const entered = deferred();
        const release = deferred();
        t.after(() => release.resolve());
        const app = await open(t, {
          api: async (route) => {
            entered.resolve();
            await release.promise;
            await route.fulfill({ json: JSON.parse(SHARE) });
          },
        });
        const pending = app.menu(label);
        await entered.promise;
        const aborted = app.page.waitForEvent('requestfailed', {
          predicate: (request) => request.url() === API_URL,
        });
        await app.page.evaluate(
          (html) => {
            history.pushState({}, '', '/c/replacement');
            document.querySelector('#conversation').innerHTML = html;
          },
          bubble('after-request', 'CURRENT ROUTE CONTENT')
        );
        await aborted;
        await pending;
        assert.deepEqual(await app.page.evaluate(() => window.__gmClipboard), []);
        assert.equal(app.downloads.length, 0);
        const current = await app.copy();
        assert.ok(current.includes('CURRENT ROUTE CONTENT'));
        release.resolve();
        await app.page.waitForTimeout(300);
        assert.equal(await app.page.evaluate(() => window.__gmClipboard.length), 1);
        assert.equal(app.downloads.length, 0);
        assert.doesNotMatch(
          await app.page.evaluate(() => window.__gmClipboard.at(-1).text),
          /FIRST ANSWER|FIRST QUESTION/
        );
      });
    }

    it('bounds a hanging share fetch and uses loaded-DOM fallback after timeout', async (t) => {
      const release = deferred();
      t.after(() => release.resolve());
      const app = await open(t, {
        html: DOM,
        api: async (route) => {
          await release.promise;
          await route.fulfill({ json: JSON.parse(SHARE) });
        },
      });
      app.page.setDefaultTimeout(20000);
      const markdown = await app.copy();
      domContent(markdown);
      assert.ok(
        app.failures.some((failure) => failure.url === API_URL),
        'timeout aborts the underlying request'
      );
      assert.equal(await app.page.evaluate(() => window.__gmClipboard.length), 1);
      release.resolve();
    });
  });
}
