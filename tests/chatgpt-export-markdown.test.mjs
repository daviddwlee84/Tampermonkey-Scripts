import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { chromium, firefox } from 'playwright';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SCRIPT, SHARED, UI, FIXTURE] = await Promise.all([
  read('userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js'),
  read('shared/chat-export.js'),
  read('shared/export-ui.js'),
  read('tests/fixtures/chatgpt-export/multiple-research.json'),
]);
const OUT = new URL('../.preview/chatgpt-export-tests/', import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(linear = true) {
  const data = JSON.parse(FIXTURE);
  if (linear) {
    data.linear_conversation = data.linear_conversation.map((node) => data.mapping[node.id]);
  } else {
    delete data.linear_conversation;
  }
  return data;
}

function sdk(data, id = 'tool-1') {
  return data.mapping[id].message.metadata.chatgpt_sdk;
}

function updateState(data, id, update) {
  const meta = sdk(data, id);
  const state = JSON.parse(meta.widget_state);
  update(state);
  meta.widget_state = JSON.stringify(state);
}

function insertAfter(data, parentId, message) {
  const parent = data.mapping[parentId];
  const node = { id: message.id, message, parent: parentId, children: [...parent.children] };
  for (const id of node.children) data.mapping[id].parent = node.id;
  parent.children = [node.id];
  data.mapping[node.id] = node;
  if (data.current_node === parentId) data.current_node = node.id;
  if (data.linear_conversation) {
    const index = data.linear_conversation.findIndex((item) => item.id === parentId);
    data.linear_conversation.splice(index + 1, 0, node);
  }
}

// Run the delivered script and shared renderer. Only the UI shell / GM delivery
// are modeled here; browser tests below exercise the real shell and downloads.
function harness(data, settings = {}) {
  const result = { clipboard: null, downloads: [], statuses: [] };
  let panel;
  const context = vm.createContext({
    console: { log() {} },
    location: {
      origin: 'https://chatgpt.com',
      pathname: '/share/fixture',
      href: 'https://chatgpt.com/share/fixture',
    },
    document: { readyState: 'loading', addEventListener() {} },
    __reactRouterContext: { state: { loaderData: { conversation: data } } },
    GM_getValue: (key, fallback) => settings[key] ?? fallback,
    GM_setValue: (key, value) => {
      settings[key] = value;
    },
    GM_setClipboard: (text) => {
      result.clipboard = text;
    },
    GM_registerMenuCommand() {},
    createExportPanel: (config) => {
      panel = config;
      return { setStatus: (text) => result.statuses.push(text) };
    },
  });
  context.window = context;
  vm.runInContext(SHARED, context);
  context.downloadText = (filename, text, mime) => result.downloads.push({ filename, text, mime });
  vm.runInContext(SCRIPT, context);
  result.run = async (label = 'Copy Markdown') => {
    await panel.actions.find((action) => action.label === label).run();
    return result.clipboard;
  };
  return result;
}

function assertComplete(markdown) {
  assert.match(markdown, /^messages: 4$/m);
  const order = [
    'Initial research question',
    '# First report',
    'Follow-up question',
    '# Second report',
  ];
  const positions = order.map((text) => markdown.indexOf(text));
  assert.ok(positions.every((at, i) => at >= 0 && (i === 0 || at > positions[i - 1])));
  for (const title of ['# First report', '# Second report'])
    assert.equal(markdown.split(title).length - 1, 1);
  assert.match(markdown, /\[Source\]\(https:\/\/example.com\/first-report\)/);
  assert.ok(markdown.includes('| GPU | W |\n| --- | --- |\n| 3090 | 320 |'));
  assert.ok(markdown.includes('```js\nconst reward = 42;\n```'));
  assert.doesNotMatch(markdown, /UNSELECTED|Hidden system content|\uE200/);
}

describe('ChatGPT export transformations', () => {
  for (const linear of [true, false]) {
    it(`keeps two reports sharing a plan, in order (${linear ? 'linear' : 'mapping'} source)`, async () => {
      const data = fixture(linear);
      const before = JSON.stringify(data);
      assertComplete(await harness(data).run());
      assert.equal(JSON.stringify(data), before, 'export must not mutate the source graph');
    });
  }

  it('keeps distinct reports even when a widget session is reused', async () => {
    const data = fixture();
    sdk(data, 'tool-2').widget_session_id = sdk(data).widget_session_id;
    assertComplete(await harness(data).run());
  });

  it('chooses the latest completed snapshot without moving the first reply past the follow-up', async () => {
    const data = fixture();
    const initial = JSON.parse(sdk(data).widget_state);
    updateState(data, 'tool-1', (state) => {
      state.report_message.content.parts = ['OLD REPORT'];
    });
    for (const [id, status, offset, body] of [
      ['new-completed', 'completed', 10, initial.report_message.content.parts[0]],
      ['stale-completed', 'completed', -10, 'STALE REPORT'],
      ['new-pending', 'in_progress', 20, 'INCOMPLETE REPORT'],
    ]) {
      const message = clone(data.mapping['tool-1'].message);
      message.id = id;
      const state = clone(initial);
      state.status = status;
      state.last_updated_at += offset;
      state.plan.plan_id = `changed-plan-${id}`;
      state.report_message.content.parts = [body];
      message.metadata.chatgpt_sdk.widget_state = JSON.stringify(state);
      insertAfter(data, data.current_node, message);
    }
    const markdown = await harness(data).run();
    assertComplete(markdown);
    assert.doesNotMatch(markdown, /OLD REPORT|STALE REPORT|INCOMPLETE REPORT/);
  });

  it('does not insert an embedded report already present as a top-level message', async () => {
    const data = fixture();
    insertAfter(data, 'tool-1', JSON.parse(sdk(data).widget_state).report_message);
    const markdown = await harness(data, { includeResearchDetails: true }).run();
    assertComplete(markdown);
    assert.equal(markdown.split('> **Deep Research details**').length - 1, 2);
  });

  for (const identity of ['session', 'response-session', 'invocation', 'host', 'index']) {
    it(`does not merge different reports missing IDs (${identity} fallback)`, async () => {
      const data = fixture();
      for (const id of ['tool-1', 'tool-2']) {
        updateState(data, id, (state) => {
          delete state.report_message.id;
        });
        const meta = sdk(data, id);
        if (identity !== 'session') delete meta.widget_session_id;
        if (!['session', 'response-session'].includes(identity))
          delete meta.tool_response_metadata['openai/widgetSessionId'];
        if (['host', 'index'].includes(identity)) delete meta.invocation_uuid;
        if (identity === 'index') delete data.mapping[id].message.id;
      }
      assertComplete(await harness(data).run());
    });
  }

  it('exports independent pending plans only when details are enabled', async () => {
    const data = fixture();
    for (const id of ['tool-1', 'tool-2']) {
      updateState(data, id, (state) => {
        delete state.report_message;
        state.status = 'in_progress';
      });
    }
    const plain = await harness(data).run();
    assert.doesNotMatch(plain, /Deep Research details|# First report|# Second report/);
    const detailed = await harness(data, { includeResearchDetails: true }).run();
    assert.match(detailed, /^messages: 4$/m);
    assert.equal(detailed.split('> **Deep Research details**').length - 1, 2);
    assert.match(detailed, /Research 1/);
    assert.match(detailed, /Research 2/);
  });

  it('suppresses older pending states of a research instance once its report is available', async () => {
    const data = fixture();
    const pending = clone(data.mapping['tool-1'].message);
    pending.id = 'pending-host';
    const state = JSON.parse(pending.metadata.chatgpt_sdk.widget_state);
    state.status = 'in_progress';
    delete state.report_message;
    pending.metadata.chatgpt_sdk.widget_state = JSON.stringify(state);
    insertAfter(data, 'user-1', pending);
    const markdown = await harness(data, { includeResearchDetails: true }).run();
    assertComplete(markdown);
    assert.doesNotMatch(markdown, /in_progress/);
    assert.equal(markdown.split('> **Deep Research details**').length - 1, 2);
  });

  for (const includeTools of [false, true]) {
    for (const includeResearchDetails of [false, true]) {
      it(`keeps both reports with tools=${includeTools}, details=${includeResearchDetails}`, async () => {
        const markdown = await harness(fixture(), { includeTools, includeResearchDetails }).run();
        for (const title of ['# First report', '# Second report'])
          assert.equal(markdown.split(title).length - 1, 1);
        assert.equal(markdown.includes('Tool (api_tool.call_tool)'), includeTools);
        assert.equal(markdown.includes('> **Deep Research details**'), includeResearchDetails);
      });
    }
  }

  for (const broken of ['malformed', 'completed-without-report']) {
    it(`keeps raw JSON and every branch downloadable when widget is ${broken}`, async () => {
      const data = fixture();
      if (broken === 'malformed') sdk(data).widget_state = '{broken JSON';
      else
        updateState(data, 'tool-1', (state) => {
          delete state.report_message;
        });
      const app = harness(data);
      assert.equal(await app.run(), null);
      assert.match(app.statuses.at(-1), /^失敗：Deep Research/);
      await app.run('Download .json');
      assert.equal(app.downloads.length, 1);
      assert.deepEqual(JSON.parse(app.downloads[0].text), data);
      assert.match(
        app.downloads[0].filename,
        /^chatgpt-Multiple-Deep-Research-regression-\d{8}-\d{4}\.json$/
      );
      assert.equal(app.downloads[0].mime, 'application/json;charset=utf-8');
      assert.match(app.statuses.at(-1), /^已下載/);
    });
  }
});

function gmShim({ data, transport }) {
  window.__gmClipboard = null;
  window.__gmStore = {};
  window.__gmMenu = [];
  window.unsafeWindow = window;
  window.GM_getValue = (key, fallback) => window.__gmStore[key] ?? fallback;
  window.GM_setValue = (key, value) => {
    window.__gmStore[key] = value;
  };
  window.GM_setClipboard = (text) => {
    window.__gmClipboard = text;
  };
  window.GM_registerMenuCommand = (label, run) => window.__gmMenu.push({ label, run });
  if (transport === 'router')
    window.__reactRouterContext = { state: { loaderData: { conversation: data } } };
}

for (const [engineName, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  describe(`${engineName} GM shim export actions`, () => {
    let browser;
    before(async () => {
      await mkdir(OUT, { recursive: true });
      browser = await engine.launch({ headless: true });
    });
    after(async () => {
      await browser?.close();
    });

    async function open(data, transport) {
      const page = await browser.newPage({ acceptDownloads: true });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const captured = new Promise((resolve) => {
        page.on('console', (message) => {
          if (message.text().includes('captured conversation payload:')) resolve();
        });
      });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/backend-api/conversation/fixture-conversation') {
          return route.fulfill({ json: data });
        }
        if (url.pathname === '/share/fixture' || url.pathname === '/c/fixture-conversation') {
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body><main>Fixture UI sentinel</main></body></html>',
          });
        }
        errors.push(`Unexpected request: ${url}`);
        return route.abort();
      });
      await page.addInitScript({
        content: `(${gmShim})(${JSON.stringify({ data, transport })});\n${SHARED}\n${UI}\n${SCRIPT}`,
      });
      await page.goto(
        `https://chatgpt.com/${transport === 'router' ? 'share/fixture' : 'c/fixture-conversation'}`
      );
      if (transport === 'capture') {
        await page.evaluate(() =>
          fetch('/backend-api/conversation/fixture-conversation').then((response) =>
            response.json()
          )
        );
        await Promise.race([
          captured,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Network capture did not complete')),
              5000
            );
            timer.unref();
            captured.then(() => clearTimeout(timer));
          }),
        ]);
      }
      await page.getByRole('button', { name: '⇩ Export MD', exact: true }).click();
      return { page, errors };
    }

    for (const transport of ['router', 'capture']) {
      it(`copies and downloads complete Markdown, handoff, and raw JSON via ${transport}`, async () => {
        const data = fixture(transport === 'router');
        const { page, errors } = await open(data, transport);
        try {
          for (const label of ['Copy Markdown', 'Copy Agent Handoff']) {
            await page.evaluate(() => {
              window.__gmClipboard = null;
            });
            await page.getByRole('button', { name: label, exact: true }).click();
            await page.waitForFunction(() => window.__gmClipboard !== null);
            const markdown = await page.evaluate(() => window.__gmClipboard);
            assertComplete(markdown);
            assert.equal(
              markdown.includes('# Prior ChatGPT Context'),
              label === 'Copy Agent Handoff'
            );
            assert.doesNotMatch(markdown, /Fixture UI sentinel/);
          }
          for (const extension of ['md', 'json']) {
            const downloaded = page.waitForEvent('download');
            await page.getByRole('button', { name: `Download .${extension}`, exact: true }).click();
            const download = await downloaded;
            const path = new URL(`${engineName}-${transport}.${extension}`, OUT);
            await download.saveAs(path.pathname);
            const text = await readFile(path, 'utf8');
            assert.ok(download.suggestedFilename().endsWith(`.${extension}`));
            if (extension === 'json') assert.deepEqual(JSON.parse(text), data);
            else assertComplete(text);
          }
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }

    it('downloads unchanged raw JSON after a visible Markdown parsing failure', async () => {
      const data = fixture();
      sdk(data).widget_state = '{broken JSON';
      const { page, errors } = await open(data, 'router');
      try {
        await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
        await page.getByText(/^失敗：Deep Research widget state 無法解析/).waitFor();
        assert.equal(await page.evaluate(() => window.__gmClipboard), null);
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download .json', exact: true }).click();
        const download = await downloaded;
        const path = new URL(`${engineName}-broken.json`, OUT);
        await download.saveAs(path.pathname);
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), data);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  });
}
