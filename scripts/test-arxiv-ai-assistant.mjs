// Isolated browser regression tests: no requests reach arXiv, papers.cool, or an AI service.
// GM APIs are shims; real userscript-manager storage and permissions require manual QA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const source = readFileSync(
  new URL('../userscripts/arxiv-ai-assistant/arxiv-ai-assistant.user.js', import.meta.url),
  'utf8'
);
const youtubeSource = readFileSync(
  new URL('../userscripts/youtube-gemini-summary/youtube-gemini-summary.user.js', import.meta.url),
  'utf8'
);
const NS = 'arxiv-ai-assistant';
const KEY = `${NS}.pending.v1`;
const REQUEST_ID = 'd7d4464f-b06b-4cce-aebb-bd9f849d4830';
const ID = '2609.12303v1';
const TITLE = 'Testing A & B: "Byte" 模型';
const ABSTRACT = 'First paragraph: α < β & γ.\nSecond paragraph: 方法與結果。';
const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const arxivHTML = `<meta name="citation_title" content="${escape(TITLE)}">
  <meta name="citation_abstract" content="${escape(ABSTRACT)}">
  <meta name="citation_arxiv_id" content="2609.12303">
  <meta name="citation_pdf_url" content="https://arxiv.org/pdf/2609.12303">
  <h1 class="title"><span class="descriptor">Title:</span>Fallback title</h1>
  <blockquote class="abstract"><span class="descriptor">Abstract:</span>Fallback abstract</blockquote>
  <div class="extra-services"><div class="full-text"><h2>Access Paper:</h2>
  <ul><li><a href="/pdf/${ID}">View PDF</a></li><li><a href="#translation">Bilingual Version</a></li></ul>
  <div class="abs-license">view license</div></div></div>`;
const coolHTML = `<div id="2609.12303" class="panel paper">
  <h2 class="title"><a href="https://arxiv.org/abs/2609.12303">#1</a>
  <a id="kimi-2609.12303" class="title-kimi" onclick="window.__faqClicks++; this.dataset.clickable='false'">[Kimi]</a>
  </h2>
  <div id="kimi-container-2609.12303" style="display:none">FAQ</div></div>
  <div id="9999.00001" class="paper"><a id="kimi-9999.00001" onclick="throw new Error('wrong paper')">[Kimi]</a></div>
  <script>window.__faqClicks = 0;</script>`;
const geminiHTML = `<div class="messages"></div><fieldset class="input-area-container">
  <div class="text-input-field"><div class="ql-editor" role="textbox" contenteditable="true" style="min-height:80px"></div></div>
  <button type="button" data-test-id="send-button">Send</button></fieldset>
  <script>document.querySelector('button').onclick = () => {
    const editor = document.querySelector('.ql-editor');
    window.__sent.push({text:editor.innerText, hadPending: '${KEY}' in window.__gmStore});
    if (!window.__keepInput) editor.textContent = '';
  };</script>`;

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

function pending(overrides = {}) {
  const now = Date.now();
  return {
    requestId: REQUEST_ID,
    paper: { id: ID, title: TITLE, abstract: ABSTRACT },
    createdAt: now,
    expiresAt: now + 120_000,
    ...overrides,
  };
}

async function fixture(
  t,
  { url = `https://arxiv.org/abs/${ID}`, html = arxivHTML, store = {} } = {}
) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
  await page.addInitScript(
    ({ store }) => {
      window.__gmStore = store;
      window.__opened = [];
      window.__sent = [];
      window.GM_getValue = (key, fallback) => {
        if (window.__failStorage) throw new Error('storage unavailable');
        return key in window.__gmStore ? window.__gmStore[key] : fallback;
      };
      window.GM_setValue = (key, value) => {
        window.__gmStore[key] = value;
      };
      window.GM_deleteValue = (key) => {
        if (!window.__failDeletion) delete window.__gmStore[key];
      };
      window.GM_openInTab = (url, options) => {
        if (window.__failOpen) throw new Error('open failed');
        window.__opened.push({ url, options });
      };
      window.GM_setClipboard = (text) => {
        window.__clipboard = text;
      };
      window.GM_addStyle = (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      };
    },
    { store }
  );
  await page.goto(url, { waitUntil: 'load' });
  await page.clock.install();
  return page;
}

async function inject(page, script = source) {
  await page.addScriptTag({ content: script });
  await page.clock.runFor(500);
}

async function consumer(t, overrides = {}) {
  return fixture(t, {
    url: `https://gemini.google.com/app#${NS}=${REQUEST_ID}`,
    html: geminiHTML,
    store: { [KEY]: pending() },
    ...overrides,
  });
}

test('arXiv adds one accessible group beside original links; preserves version and encodes context', async (t) => {
  const page = await fixture(t);
  await inject(page);
  await inject(page);
  assert.equal(await page.locator(`#${NS}-panel`).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Bilingual Version' }).count(), 1);
  assert.equal(
    await page.locator('.full-text > ul > li:last-child').getAttribute('id'),
    `${NS}-panel`
  );
  assert.equal(
    await page.getByRole('link', { name: 'papers.cool', exact: true }).getAttribute('href'),
    `https://papers.cool/arxiv/${ID}#${NS}=faq`
  );
  const kimi = new URL(await page.getByRole('link', { name: 'Kimi 摘要' }).getAttribute('href'));
  assert.equal(kimi.origin, 'https://www.kimi.com');
  assert.equal(kimi.pathname, '/_prefill_chat');
  assert.equal(kimi.searchParams.get('send_immediately'), 'true');
  const prompt = kimi.searchParams.get('prefill_prompt');
  for (const text of [
    TITLE,
    ABSTRACT,
    `https://arxiv.org/pdf/${ID}`,
    '繁體中文',
    '限制',
    '可能不是指定版本',
    'paper=2609.12303',
  ])
    assert.ok(prompt.includes(text), text);
  await page.getByRole('link', { name: 'papers.cool', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__opened.map((x) => x.options)), [
    { active: true },
  ]);
  // Native modifier navigation remains available through href and target.
  assert.equal(
    await page.getByRole('link', { name: 'Kimi 摘要' }).getAttribute('target'),
    '_blank'
  );
});

test('unversioned, four-digit, and legacy IDs retain the correct PDF and FAQ mapping', async (t) => {
  for (const id of ['2609.12303', '0704.0001v2', 'hep-th/9901001v3', 'math.GT/0309136']) {
    const page = await fixture(t, { url: `https://arxiv.org/abs/${id}?context=cs#abstract` });
    await inject(page);
    const href = await page.getByRole('link', { name: 'Kimi 摘要' }).getAttribute('href');
    const prompt = new URL(href).searchParams.get('prefill_prompt');
    assert.ok(prompt.includes(`https://arxiv.org/pdf/${id}`));
    assert.ok(prompt.includes(`paper=${encodeURIComponent(id.replace(/v\d+$/, ''))}`));
  }
});

test('invalid routes do not inject; metadata fallback removes descriptor labels', async (t) => {
  for (const path of ['/abs/not-a-paper', '/abs/2609.12303v0', '/abs/%E0%A4', '/list/cs/new']) {
    const page = await fixture(t, { url: `https://arxiv.org${path}` });
    await inject(page);
    assert.equal(await page.locator(`#${NS}-panel`).count(), 0);
  }
  const page = await fixture(t, { html: arxivHTML.replace(/<meta[^>]+>/g, '') });
  await inject(page);
  const prompt = new URL(
    await page.getByRole('link', { name: 'Kimi 摘要' }).getAttribute('href')
  ).searchParams.get('prefill_prompt');
  assert.ok(prompt.includes('論文題名：Fallback title'));
  assert.ok(prompt.endsWith('Fallback abstract'));
});

test('narrow sidebar wraps buttons inside the group', async (t) => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addStyleTag({ content: '.full-text { width: 190px }' });
  await inject(page);
  const boxes = await page.locator(`#${NS}-panel`).evaluate((panel) => ({
    panel: panel.getBoundingClientRect().toJSON(),
    buttons: [...panel.querySelectorAll('a,button')].map((el) =>
      el.getBoundingClientRect().toJSON()
    ),
  }));
  assert.ok(
    boxes.buttons.every((box) => box.left >= boxes.panel.left && box.right <= boxes.panel.right)
  );
  assert.ok(boxes.buttons[2].top > boxes.buttons[0].top);
});

test('FAQ consumes only its marker and clicks the matching unversioned button once', async (t) => {
  const page = await fixture(t, {
    url: `https://papers.cool/arxiv/${ID}?show=1#${NS}=faq&keep=yes`,
    html: coolHTML,
  });
  await inject(page);
  await inject(page);
  assert.equal(await page.evaluate(() => window.__faqClicks), 1);
  assert.equal(await page.getByRole('link', { name: '↗ arXiv', exact: true }).count(), 1);
  assert.equal(new URL(page.url()).hash, '#keep=yes');
  assert.equal(new URL(page.url()).search, '?show=1');
  await page.reload();
  await inject(page);
  assert.equal(await page.evaluate(() => window.__faqClicks), 0);
});

test('return links preserve the paper version without triggering FAQ on ordinary pages or lists', async (t) => {
  for (const path of [`/arxiv/${ID}`, '/arxiv/2609.12303', `/arxiv/cs.CL#${NS}=faq`]) {
    const page = await fixture(t, { url: `https://papers.cool${path}`, html: coolHTML });
    await inject(page);
    await inject(page);
    assert.equal(await page.evaluate(() => window.__faqClicks), 0);
    const link = page.getByRole('link', { name: '↗ arXiv', exact: true });
    if (path.includes('cs.CL')) {
      assert.equal(await link.count(), 0);
    } else {
      assert.equal(await link.count(), 1);
      const href = `https://arxiv.org/abs/${path.split('/').at(-1)}`;
      assert.equal(await link.getAttribute('href'), href);
      await link.click();
      assert.deepEqual(await page.evaluate(() => window.__opened), [
        { url: href, options: { active: true } },
      ]);
    }
  }
  for (const state of ['visible', 'loading']) {
    const page = await fixture(t, {
      url: `https://papers.cool/arxiv/${ID}#${NS}=faq`,
      html: coolHTML,
    });
    await page.evaluate((state) => {
      if (state === 'visible')
        document.getElementById('kimi-container-2609.12303').style.display = 'block';
      else document.getElementById('kimi-2609.12303').dataset.clickable = 'false';
    }, state);
    await inject(page);
    assert.equal(await page.evaluate(() => window.__faqClicks), 0);
    assert.equal(new URL(page.url()).hash, '');
  }
});

test('missing or changed FAQ controls report failure without retrying', async (t) => {
  for (const missing of [true, false]) {
    const page = await fixture(t, {
      url: `https://papers.cool/arxiv/${ID}#${NS}=faq`,
      html: missing ? '<p>Not found</p>' : coolHTML,
    });
    if (!missing)
      await page.evaluate(
        () => (document.getElementById('kimi-2609.12303').onclick = () => window.__faqClicks++)
      );
    await inject(page);
    await page.clock.runFor(21_000);
    assert.ok((await page.locator(`#${NS}-notice`).innerText()).includes('手動'));
    assert.equal(await page.evaluate(() => window.__faqClicks || 0), missing ? 0 : 1);
  }
});

test('producer hands context to only its Gemini tab, then consumes before sending once', async (t) => {
  const producer = await fixture(t);
  await inject(producer);
  await producer.getByRole('button', { name: 'Gemini 摘要' }).click();
  const { store, opened } = await producer.evaluate(() => ({
    store: window.__gmStore,
    opened: window.__opened,
  }));
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0].url).search, '');
  assert.equal(new URL(opened[0].url).hash, `#${NS}=${store[KEY].requestId}`);
  assert.equal(store[KEY].paper.id, ID);
  assert.equal(store[KEY].expiresAt - store[KEY].createdAt, 120_000);
  const page = await consumer(t, { url: opened[0].url, store });
  await inject(page);
  await inject(page);
  const result = await page.evaluate(() => ({ sent: window.__sent, store: window.__gmStore }));
  assert.equal(
    result.sent.length,
    1,
    JSON.stringify(
      await page.evaluate(() => ({
        notice: document.getElementById('arxiv-ai-assistant-notice')?.innerText,
        text: document.querySelector('.ql-editor')?.innerText,
        content: document.querySelector('.ql-editor')?.textContent,
      }))
    )
  );
  assert.equal(result.sent[0].hadPending, false);
  assert.ok(result.sent[0].text.includes(TITLE));
  assert.ok(result.sent[0].text.includes(ABSTRACT));
  assert.equal(result.store[KEY], undefined);
  assert.equal(new URL(page.url()).hash, '');
  await page.reload();
  await inject(page);
  assert.deepEqual(await page.evaluate(() => window.__sent), []);
});

test('a pending request prevents a second launch; failed launch offers the full prompt', async (t) => {
  const busy = await fixture(t, { store: { [KEY]: pending() } });
  await inject(busy);
  await busy.getByRole('button', { name: 'Gemini 摘要' }).click();
  assert.equal(await busy.evaluate(() => window.__opened.length), 0);
  assert.ok((await busy.locator(`#${NS}-notice`).innerText()).includes('上一個'));
  const page = await fixture(t);
  await inject(page);
  await page.evaluate(() => (window.__failOpen = true));
  await page.getByRole('button', { name: 'Gemini 摘要' }).click();
  assert.ok((await page.locator(`#${NS}-notice textarea`).inputValue()).includes(TITLE));
  assert.equal(await page.evaluate((key) => window.__gmStore[key], KEY), undefined);
});

test('fresh Gemini tabs without our marker ignore pending state, including YouTube requests', async (t) => {
  const youtubeKey = 'youtube-gemini-summary.pending.v1';
  const store = { [KEY]: pending(), [youtubeKey]: { unrelated: true } };
  for (const url of [
    'https://gemini.google.com/app',
    'https://gemini.google.com/app#ytgs=other-request-12345',
  ]) {
    const page = await consumer(t, { url, store });
    await inject(page);
    assert.deepEqual(await page.evaluate(() => window.__sent), []);
    assert.deepEqual(await page.evaluate(() => window.__gmStore), store);
  }
  const page = await consumer(t, { store });
  await inject(page, youtubeSource);
  await inject(page);
  assert.equal(await page.evaluate(() => window.__sent.length), 1);
  assert.deepEqual(await page.evaluate((key) => window.__gmStore[key], youtubeKey), {
    unrelated: true,
  });
});

test('mismatched, malformed, missing, expired, and non-fresh requests never submit', async (t) => {
  const cases = [
    { store: { [KEY]: pending({ requestId: 'a-different-request-12345' }) }, keep: true },
    { store: { [KEY]: { invalid: true } } },
    { store: {} },
    {
      store: {
        [KEY]: pending({ createdAt: Date.now() - 130_000, expiresAt: Date.now() - 10_000 }),
      },
    },
    { url: `https://gemini.google.com/app/existing-chat#${NS}=${REQUEST_ID}` },
  ];
  for (const { keep, ...options } of cases) {
    const page = await consumer(t, options);
    await inject(page);
    assert.deepEqual(await page.evaluate(() => window.__sent), []);
    assert.equal(await page.getByRole('textbox').first().innerText(), '');
    assert.equal(await page.locator(`#${NS}-notice`).count(), 1);
    if (keep)
      assert.equal(
        await page.evaluate((key) => window.__gmStore[key].requestId, KEY),
        'a-different-request-12345'
      );
  }
});

test('text and attachment drafts are preserved without a send', async (t) => {
  for (const kind of ['text', 'attachment']) {
    const page = await consumer(t);
    await page.evaluate((kind) => {
      if (kind === 'text') document.querySelector('.ql-editor').textContent = 'Existing draft';
      else {
        const attachment = document.createElement('div');
        attachment.dataset.testId = 'file-preview';
        attachment.textContent = 'existing.pdf';
        document.querySelector('.text-input-field').append(attachment);
      }
    }, kind);
    await inject(page);
    assert.deepEqual(await page.evaluate(() => window.__sent), []);
    assert.equal(
      await page.locator('.ql-editor').innerText(),
      kind === 'text' ? 'Existing draft' : ''
    );
    assert.ok((await page.locator(`#${NS}-notice`).innerText()).includes('草稿'));
    assert.ok((await page.evaluate(() => window.__clipboard)).includes(TITLE));
  }
});

test('missing editor or Send and unconfirmed submission retain actionable fallback', async (t) => {
  for (const kind of ['editor', 'send', 'unconfirmed']) {
    const page = await consumer(t);
    await page.evaluate((kind) => {
      if (kind === 'editor') document.querySelector('.ql-editor').remove();
      if (kind === 'send') document.querySelector('button').remove();
      if (kind === 'unconfirmed') window.__keepInput = true;
    }, kind);
    await inject(page);
    await page.clock.runFor(21_000);
    assert.equal(await page.evaluate(() => window.__sent.length), kind === 'unconfirmed' ? 1 : 0);
    assert.ok((await page.locator(`#${NS}-notice textarea`).inputValue()).includes(TITLE));
    assert.equal(await page.evaluate((key) => window.__gmStore[key], KEY), undefined);
  }
});

test('request expiring, input changing, route changing, or deletion failing before Send prevents submission', async (t) => {
  for (const kind of ['expire', 'input', 'route', 'deletion']) {
    const page = await consumer(t);
    await page.evaluate(
      ({ kind, key }) => {
        if (kind === 'deletion') window.__failDeletion = true;
        const button = document.querySelector('button');
        button.disabled = true;
        setTimeout(() => {
          // Expiry is set on the record before consumption below.
          if (kind === 'input')
            document.querySelector('.ql-editor').textContent = 'Changed by user';
          if (kind === 'route') history.pushState({}, '', '/app/another-chat' + location.hash);
          button.disabled = false;
        }, 700);
      },
      { kind, key: KEY }
    );
    // Expiration must affect the consumer's parsed record too, so use a short-lived request.
    if (kind === 'expire')
      await page.evaluate((key) => (window.__gmStore[key].expiresAt = Date.now() + 600), KEY);
    await inject(page);
    await page.clock.runFor(1500);
    assert.deepEqual(await page.evaluate(() => window.__sent), []);
    assert.equal(await page.locator(`#${NS}-notice textarea`).count(), 1);
    if (kind === 'input')
      assert.equal(await page.locator('.ql-editor').innerText(), 'Changed by user');
  }
});
