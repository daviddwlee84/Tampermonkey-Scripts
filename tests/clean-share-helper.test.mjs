import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox } from 'playwright';

const SOURCE = await readFile(
  new URL('../userscripts/clean-share-helper/clean-share-helper.user.js', import.meta.url),
  'utf8'
);
const OUT = new URL('../.preview/clean-share-helper-tests/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const fixtures = Object.fromEntries(
  await Promise.all(
    ['threads', 'instagram', 'facebook', 'youtube'].map(async (site) => [
      site,
      await readFile(
        new URL(`./fixtures/clean-share-helper/${site}.html`, import.meta.url),
        'utf8'
      ),
    ])
  )
);
const MENU = 'Clean Share：清理任意網址';
const UI = '#clean-share-helper-ui';

// Explicit GM contract model, not a real manager or a cross-origin permission test.
function gmShim() {
  window.__menus = {};
  window.__clipboard = null;
  window.__clipboardCalls = 0;
  window.__requests = [];
  window.__pending = [];
  window.__responses = [];
  window.__aborts = 0;
  window.GM_registerMenuCommand = (name, fn) => {
    window.__menus[name] = fn;
  };
  window.GM_setClipboard = (value) => {
    if (window.__clipboardError) throw new Error('clipboard denied');
    window.__clipboard = value;
    window.__clipboardCalls++;
  };
  window.GM_xmlhttpRequest = (options) => {
    if (window.__networkError) throw new Error('network denied');
    window.__requests.push({
      method: options.method,
      url: options.url,
      anonymous: options.anonymous,
    });
    window.__pending.push(options);
    const response = window.__responses.shift();
    let aborted = false;
    if (response)
      setTimeout(() => {
        if (aborted) return;
        if (response.error) options.onerror({});
        else if (response.timeout) options.ontimeout({});
        else options.onload(response);
      }, 20);
    return {
      abort() {
        aborted = true;
        window.__aborts++;
        options.onabort({});
      },
    };
  };
}

for (const engine of (process.env.CSH_BROWSERS || 'chromium,firefox').split(',')) {
  if (!{ chromium, firefox }[engine]) throw new Error(`Unknown engine ${engine}`);
  describe(`clean-share-helper / ${engine}`, { concurrency: false }, () => {
    let browser;
    let contexts = [];
    let servers = [];
    let errors = [];
    before(async () => {
      browser = await { chromium, firefox }[engine].launch();
    });
    after(async () => {
      await browser?.close();
    });
    afterEach(async () => {
      for (const context of contexts) await context.close();
      contexts = [];
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
      }
      servers = [];
      assert.deepEqual(errors.splice(0), [], 'no uncaught page errors');
    });
    async function open(
      url = 'https://example.test/',
      body = '<!doctype html><title>Generic page</title><main>Page content</main>',
      options = {}
    ) {
      const { localNetwork = false, ...browserOptions } = options;
      const context = await browser.newContext({
        viewport: { width: 1100, height: 900 },
        ...browserOptions,
      });
      contexts.push(context);
      await context.addInitScript(gmShim);
      if (!localNetwork)
        await context.route('**/*', async (route) => {
          if (
            route.request().isNavigationRequest() &&
            route.request().frame() === route.request().frame().page().mainFrame()
          )
            await route.fulfill({ contentType: 'text/html', body });
          else await route.abort();
        });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      // Model the declared document-idle phase, rather than running DOM code
      // before documentElement/body exist through an init-script registration.
      await page.addScriptTag({ content: SOURCE });
      return page;
    }
    async function panel(page, value) {
      await page.evaluate((name) => window.__menus[name](), MENU);
      const dialog = page.locator(UI).getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      if (value !== undefined) {
        await dialog.getByRole('textbox').fill(value);
        await dialog.getByRole('button', { name: '清理網址', exact: true }).click();
      }
      return dialog;
    }
    async function clipboard(page, expected) {
      await page.waitForFunction((value) => window.__clipboard === value, expected);
    }
    async function localServer(handler) {
      const server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html');
        handler(request, response);
      });
      servers.push(server);
      await new Promise((done, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', done);
      });
      return `http://127.0.0.1:${server.address().port}`;
    }

    it('uses menu-only entry points, cleans a batch locally, and preserves errors and order', async () => {
      const page = await open();
      assert.equal(await page.locator(UI).count(), 0);
      assert.equal(await page.locator('.clean-share-action').count(), 0);
      assert.equal(await page.evaluate(() => Object.keys(window.__menus).length), 2);
      const dialog = await panel(
        page,
        'https://youtu.be/ABC?si=x&t=90\ninvalid\nhttps://example.test/?id=3&utm_souce=wechat\nhttps://youtu.be/ABC?si=x&t=90'
      );
      assert.equal(await dialog.locator('.result').count(), 4);
      assert.equal(await dialog.locator('.result[data-status="error"]').count(), 1);
      await dialog.getByRole('button', { name: '複製全部成功結果' }).click();
      await clipboard(
        page,
        'https://youtu.be/ABC?t=90\nhttps://example.test/?id=3\nhttps://youtu.be/ABC?t=90'
      );
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
      await page.screenshot({ path: `${OUT}/${engine}-panel-light.png` });
    });

    it('current-page menu and button read the current URL and never rewrite the page location', async () => {
      const raw = 'https://example.test/article?id=1&utm_source=mail#part';
      const page = await open(raw);
      await page.evaluate(() => window.__menus['Clean Share：清理目前頁面網址']());
      const dialog = page.locator(UI).getByRole('dialog');
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, 'https://example.test/article?id=1#part');
      assert.equal(page.url(), raw);
      await page.evaluate(() => history.pushState({}, '', '/next?utm_medium=link&x=2'));
      await dialog.getByRole('button', { name: '目前頁面', exact: true }).click();
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, 'https://example.test/next?x=2');
    });

    for (const [site, origin, first, second] of [
      [
        'threads',
        'https://www.threads.com',
        'https://www.threads.com/@alice/post/ALICE',
        'https://www.threads.com/@bob/post/BOB',
      ],
      [
        'instagram',
        'https://www.instagram.com',
        'https://www.instagram.com/p/ALICE/?img_index=2',
        'https://www.instagram.com/reel/BOB/',
      ],
      [
        'facebook',
        'https://www.facebook.com',
        'https://www.facebook.com/permalink.php?story_fbid=ALICE&id=42',
        'https://www.facebook.com/bob/posts/BOB',
      ],
    ]) {
      it(`${site}: associates each action with its own permalink and keeps native clicks intact`, async () => {
        const page = await open(`${origin}/`, fixtures[site]);
        const firstAction = page.locator(
          '#post-a > .actions .clean-share-action,#post-a > section .clean-share-action'
        );
        await firstAction.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
        await clipboard(page, first);
        assert.equal(await page.evaluate(() => window.nativeClicks), 0);
        await page
          .locator('#post-b .clean-share-action')
          .getByRole('button', { name: '複製乾淨網址', exact: true })
          .click();
        await clipboard(page, second);
        assert.equal(await page.locator('#unlinked .clean-share-action').count(), 0);
        await page.locator('#like-a').click();
        assert.equal(await page.evaluate(() => window.nativeClicks), 1);
        assert.equal(await page.evaluate(() => window.__requests.length), 0);
        if (site === 'threads') {
          await page
            .locator('#quote .clean-share-action')
            .getByRole('button', { name: '複製乾淨網址', exact: true })
            .click();
          await clipboard(page, 'https://www.threads.com/@quoted/post/QUOTED');
        }
      });
    }

    it('hover/focus reveals local details; info pins the result in a keyboard-accessible dialog', async () => {
      const page = await open('https://www.threads.net/', fixtures.threads);
      const actions = page.locator('#post-b .clean-share-action');
      const action = actions.getByRole('button', { name: '複製乾淨網址', exact: true });
      await action.hover();
      const tip = page.locator(UI).getByRole('tooltip');
      await tip.waitFor({ state: 'visible' });
      assert.match(await tip.innerText(), /xmt=b/);
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
      await page.mouse.move(1, 1);
      await action.focus();
      await tip.waitFor({ state: 'visible' });
      await page.screenshot({ path: `${OUT}/${engine}-threads-tooltip.png` });
      await page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden' });
      await actions.getByRole('button', { name: '查看連結清理明細' }).click();
      const dialog = page.locator(UI).getByRole('dialog');
      assert.match(await dialog.innerText(), /移除的參數/);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(
        await actions
          .getByRole('button', { name: '查看連結清理明細' })
          .evaluate((node) => node.getRootNode().activeElement === node)
      );
      assert.equal(await page.evaluate(() => window.nativeClicks), 0);
    });

    it('reconciles new posts, reused DOM, removed helper UI, and duplicate script injection', async () => {
      const page = await open('https://www.threads.com/', fixtures.threads);
      await page.locator('#post-b .clean-share-action').waitFor();
      await page.evaluate(() => {
        const copy = document.querySelector('#post-b').cloneNode(true);
        copy.id = 'post-c';
        copy.querySelector('.clean-share-action')?.remove();
        copy.querySelector('a').href = '/@carol/post/CAROL?xmt=c';
        document.querySelector('main').append(copy);
        document.querySelector('#post-b .clean-share-action').remove();
        document.querySelector('#post-b a').href = '/@bob/post/NEW_BOB?xmt=new';
        const moved = document.createElement('section');
        document.querySelector('#post-b .actions').append(moved);
        moved.append(document.querySelector('#share-b'));
        history.pushState({}, '', '/@bob/post/NEW_BOB');
      });
      await page
        .locator('#post-c .clean-share-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true })
        .click();
      await clipboard(page, 'https://www.threads.com/@carol/post/CAROL');
      await page
        .locator('#post-b .clean-share-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true })
        .click();
      await clipboard(page, 'https://www.threads.com/@bob/post/NEW_BOB');
      await page.addScriptTag({ content: SOURCE });
      assert.equal(await page.locator('#post-b .clean-share-action').count(), 1);
      assert.equal(await page.evaluate(() => Object.keys(window.__menus).length), 2);
      await page.evaluate(() => document.querySelector('#post-c').remove());
      assert.equal(await page.locator('#post-c .clean-share-action').count(), 0);
    });

    it('YouTube watch and native share dialog preserve selected time and playlist', async () => {
      const page = await open(
        'https://www.youtube.com/watch?v=ALICE&si=page&t=20',
        fixtures.youtube
      );
      await page
        .locator('.clean-share-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true })
        .click();
      await clipboard(page, 'https://www.youtube.com/watch?v=ALICE&t=20');
      await page.evaluate(
        () => (document.querySelector('yt-unified-share-panel-renderer').hidden = false)
      );
      const action = page
        .locator('.clean-share-dialog-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true });
      await action.click();
      await clipboard(page, 'https://youtu.be/ALICE?t=83&list=PL1');
      await page.evaluate(
        () =>
          (document.querySelector('#share-url').value = 'https://youtu.be/ALICE?si=changed&t=150')
      );
      await action.click();
      await clipboard(page, 'https://youtu.be/ALICE?t=150');
      assert.equal(await page.locator('#native-copy').count(), 1);
    });

    it('YouTube URL-only navigation reads the new video at click time', async () => {
      const page = await open('https://www.youtube.com/watch?v=ALICE&si=page', fixtures.youtube);
      const action = page
        .locator('.clean-share-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true });
      await action.waitFor();
      await page.evaluate(() => history.pushState({}, '', '/watch?v=BOB&si=next&t=31'));
      await action.click();
      await clipboard(page, 'https://www.youtube.com/watch?v=BOB&t=31');
    });

    it('Shorts binds only the active renderer and follows a route/active-item switch', async () => {
      const body =
        '<!doctype html><style>ytd-reel-video-renderer{display:block;padding:30px}button{padding:10px}</style><ytd-reel-video-renderer id="a" is-active><a href="/shorts/ALICE">A</a><ytd-reel-player-overlay-renderer><button aria-label="Share">Share</button></ytd-reel-player-overlay-renderer></ytd-reel-video-renderer><ytd-reel-video-renderer id="b"><a href="/shorts/BOB">B</a><ytd-reel-player-overlay-renderer><button aria-label="Share">Share</button></ytd-reel-player-overlay-renderer></ytd-reel-video-renderer>';
      const page = await open('https://www.youtube.com/shorts/ALICE?si=x', body);
      await page.locator('#a .clean-share-action').waitFor();
      assert.equal(await page.locator('#b .clean-share-action').count(), 0);
      await page.evaluate(() => {
        document.querySelector('#a').removeAttribute('is-active');
        document.querySelector('#b').setAttribute('is-active', '');
        history.pushState({}, '', '/shorts/BOB?si=y');
      });
      await page
        .locator('#b .clean-share-action')
        .getByRole('button', { name: '複製乾淨網址', exact: true })
        .click();
      await clipboard(page, 'https://www.youtube.com/shorts/BOB');
      assert.equal(await page.locator('#a .clean-share-action').count(), 0);
    });

    it('fullscreen Instagram/Facebook Reels use the route only for a single visible share control', async () => {
      for (const site of ['instagram', 'facebook']) {
        const page = await open(
          `https://www.${site}.com/reel/ALICE/?utm_source=x`,
          '<!doctype html><section><h1>Active reel</h1><button aria-label="Share">Share</button></section>'
        );
        await page
          .locator('.clean-share-action')
          .getByRole('button', { name: '複製乾淨網址', exact: true })
          .click();
        await clipboard(page, `https://www.${site}.com/reel/ALICE/`);
      }
    });

    it('expansion is explicit, anonymous, preserves the original, and never copies automatically', async () => {
      const page = await open();
      const dialog = await panel(page, 'https://short.test/abc?utm_source=x');
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
      await page.evaluate(() =>
        window.__responses.push({
          status: 200,
          finalUrl: 'https://youtu.be/ALICE?si=expanded&t=45',
        })
      );
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog.getByText('已展開，請自行複製清理結果。', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__requests), [
        { method: 'HEAD', url: 'https://short.test/abc', anonymous: true },
      ]);
      assert.equal(await page.evaluate(() => window.__clipboard), null);
      assert.match(await dialog.innerText(), /https:\/\/short.test\/abc\?utm_source=x/);
      assert.match(await dialog.innerText(), /utm_source=x/);
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, 'https://youtu.be/ALICE?t=45');
    });

    it('HEAD rejection falls back to GET and locally unwraps known redirect wrappers', async () => {
      const page = await open();
      const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent('https://youtu.be/ALICE?si=wrapped&t=25')}`;
      const dialog = await panel(page, wrapped);
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, 'https://youtu.be/ALICE?t=25');
      await page.evaluate(() =>
        window.__responses.push(
          { status: 405 },
          { status: 200, finalUrl: 'https://www.youtube.com/watch?v=ALICE&si=x' }
        )
      );
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog.getByText('已展開，請自行複製清理結果。', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__requests.map((r) => r.method)), [
        'HEAD',
        'GET',
      ]);
    });

    it('Violentmonkey native fetch omits cookies on every hop, including a CORS-enabled destination', async () => {
      // Use actual loopback HTTP: mocked redirect fulfillment bypasses the
      // next route handler, and mocked responses do not establish CORS rules.
      const requests = [];
      const record = (request) =>
        requests.push({ method: request.method, cookie: request.headers.cookie || '' });
      const destination = await localServer((request, response) => {
        if (request.url.startsWith('/destination')) record(request);
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.end();
      });
      const source = await localServer((request, response) => {
        if (!request.url.startsWith('/short')) {
          response.end();
          return;
        }
        record(request);
        response.writeHead(302, {
          Location: `${destination}/destination?id=42&utm_source=redirect`,
          'Access-Control-Allow-Origin': '*',
        });
        response.end();
      });
      const page = await open(`${source}/fixture`, undefined, { localNetwork: true });
      const diagnostics = [];
      page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.push(message.text());
      });
      page.on('requestfailed', (request) =>
        diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`)
      );
      await page.evaluate(() => (window.GM_info = { scriptHandler: 'Violentmonkey' }));
      await page
        .context()
        .addCookies([{ url: source, name: 'fixture_cookie', value: 'must_not_send' }]);
      const dialog = await panel(page, `${source}/short#chapter`);
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog
        .getByText('已展開，請自行複製清理結果。', { exact: true })
        .waitFor()
        .catch(async (error) => {
          throw new Error(
            `${await dialog.innerText()}\n${JSON.stringify(requests)}\n${JSON.stringify(diagnostics)}\nGM=${await page.evaluate(() => JSON.stringify(window.__requests))}`,
            { cause: error }
          );
        });
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, `${destination}/destination?id=42#chapter`);
      assert.deepEqual(requests, [
        { method: 'HEAD', cookie: '' },
        { method: 'HEAD', cookie: '' },
      ]);
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
    });

    it('Violentmonkey CORS denial retains the clean URL without falling back to manager XHR', async () => {
      const source = await localServer((request, response) => response.end());
      const destination = await localServer((request, response) => response.end());
      const page = await open(`${source}/fixture`, undefined, { localNetwork: true });
      await page.evaluate(() => (window.GM_info = { scriptHandler: 'Violentmonkey' }));
      const dialog = await panel(page, `${destination}/short?utm_source=x`);
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog
        .getByText('展開失敗，目的地可能未允許跨站讀取，保留原結果。', { exact: true })
        .waitFor()
        .catch(async (error) => {
          throw new Error(await dialog.innerText(), { cause: error });
        });
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, `${destination}/short`);
      assert.equal(await page.evaluate(() => window.__requests.length), 0);
    });

    it('expansion permission errors, timeouts and invalid destinations retain a copyable result', async () => {
      const page = await open();
      const dialog = await panel(page, 'https://short.test/a?utm_source=x');
      for (const response of [
        { error: true },
        { timeout: true },
        { status: 403 },
        { status: 200, finalUrl: 'javascript:alert(1)' },
      ]) {
        await page.evaluate((value) => window.__responses.push(value), response);
        await dialog.getByRole('button', { name: '展開短連結' }).click();
        await page.waitForFunction(
          () =>
            !document
              .querySelector('#clean-share-helper-ui')
              .shadowRoot.querySelector('.result .actions button:last-child').disabled
        );
        await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
        await clipboard(page, 'https://short.test/a');
      }
      await page.evaluate(() => (window.__networkError = true));
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog.getByText('無法展開或網域權限遭拒，保留原結果。', { exact: true }).waitFor();
    });

    it('closing, editing the batch and route changes abort expansion and ignore stale callbacks', async () => {
      const page = await open('https://example.test/', '<!doctype html><main>empty</main>');
      let dialog = await panel(page, 'https://short.test/a');
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog.getByRole('button', { name: '關閉', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__aborts), 1);
      dialog = await panel(page, 'https://short.test/b');
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await dialog.getByRole('textbox').fill('https://example.test/new?utm_source=x');
      await dialog.getByRole('button', { name: '清理網址', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__aborts), 2);
      await page.evaluate(() =>
        window.__pending[1].onload({ status: 200, finalUrl: 'https://attacker.test/old' })
      );
      assert.doesNotMatch(await dialog.innerText(), /attacker/);
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await page.evaluate(() => history.pushState({}, '', '/next'));
      await dialog.getByText('已換頁，展開已取消。', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__aborts), 3);
    });

    it('keeps ambiguous post associations disabled and preserves the original on oversized responses', async () => {
      const page = await open(
        'https://www.threads.com/',
        '<!doctype html><main><div data-pressable-container><a href="/@a/post/A"><time>A</time></a><a href="/@b/post/B"><time>B</time></a><button aria-label="Share">Share</button></div></main>'
      );
      assert.equal(await page.locator('.clean-share-action').count(), 0);
      const dialog = await panel(page, 'https://short.test/a');
      await dialog.getByRole('button', { name: '展開短連結' }).click();
      await page.evaluate(() => window.__pending[0].onprogress({ loaded: 1024 * 1024 + 1 }));
      await dialog.getByText('回應內容過大，保留原結果。', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__aborts), 1);
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await clipboard(page, 'https://short.test/a');
    });

    it('reports clipboard denial, renders untrusted parameter values as text, and supports a narrow dark dialog', async () => {
      const page = await open('https://example.test/', undefined, {
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
      });
      const dialog = await panel(
        page,
        'https://example.test/?utm_source=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&item=3'
      );
      assert.equal(await dialog.locator('img').count(), 0);
      assert.match(await dialog.innerText(), /<img src=x onerror=alert\(1\)>/);
      await page.evaluate(() => (window.__clipboardError = true));
      await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
      await page
        .locator(UI)
        .getByText('複製失敗，請從詳細資訊手動選取網址。', { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__clipboardCalls), 0);
      assert.ok(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      await page.screenshot({ path: `${OUT}/${engine}-panel-dark-narrow.png` });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    });
  });
}
