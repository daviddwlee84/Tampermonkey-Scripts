import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '.preview', 'media-helper-tests');
const SCRIPT = await readFile(join(ROOT, 'userscripts/media-helper/media-helper.user.js'), 'utf8');
const FIXTURE = await readFile(join(ROOT, 'tests/fixtures/media-helper/page.html'), 'utf8');
const VIDEO = await readFile(join(ROOT, 'tests/fixtures/media-helper/sample.webm'));
const ORIGIN = 'https://media.test';
const LARGE = `${ORIGIN}/assets/large.jpg?sig=x%2Fy&token=z`;
const SMALL = `${ORIGIN}/assets/small.jpg?sig=a%2Fb&v=1`;
const UI = '#media-helper-ui';
await mkdir(OUT, { recursive: true });

// 模擬 manager 契約及延遲回呼；不冒充真實 sandbox／跨域下載驗證。
function gmShim() {
  window.__store = JSON.parse(localStorage.getItem('__mediaTestPrefs') || '{}');
  window.__menus = {};
  window.__downloads = [];
  window.__tabs = [];
  window.__clipboard = null;
  window.GM_getValue = (key, fallback) => window.__store[key] ?? fallback;
  window.GM_setValue = (key, value) => {
    window.__store[key] = value;
    localStorage.setItem('__mediaTestPrefs', JSON.stringify(window.__store));
  };
  window.GM_registerMenuCommand = (name, callback) => {
    window.__menus[name] = callback;
  };
  window.GM_setClipboard = (text) => {
    window.__clipboard = text;
  };
  window.GM_openInTab = (url) => {
    window.__tabs.push(url);
  };
  window.GM_download = (options) => {
    const request = { ...options, aborted: false };
    window.__downloads.push(request);
    if (window.__throwDownload) throw new Error('test synchronous failure');
    return {
      abort() {
        request.aborted = true;
        options.onerror?.({ error: 'aborted' });
      },
    };
  };
}

for (const engine of (process.env.MH_BROWSERS || 'chromium,firefox').split(',')) {
  if (!{ chromium, firefox }[engine]) throw new Error(`Unknown MH_BROWSERS engine: ${engine}`);
  describe(`media-helper / ${engine}`, { concurrency: false }, () => {
    let browser;
    let contexts = [];
    let errors = [];
    before(async () => {
      browser = await { chromium, firefox }[engine].launch();
    });
    after(async () => browser?.close());
    afterEach(async () => {
      for (const context of contexts) await context.close();
      contexts = [];
      assert.deepEqual(errors.splice(0), [], 'No uncaught page errors');
    });

    async function open({ colorScheme = 'light', width = 1280, body = FIXTURE } = {}) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        reducedMotion: 'reduce',
      });
      contexts.push(context);
      await context.addInitScript({ content: `(${gmShim.toString()})();\n${SCRIPT}` });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/practice' || url.pathname === '/next')
          return route.fulfill({ contentType: 'text/html', body });
        if (url.pathname.endsWith('.webm'))
          return route.fulfill({ contentType: 'video/webm', body: VIDEO });
        if (/\.(m3u8|mpd|ts|m4s|mp4)$/.test(url.pathname) || url.pathname === '/manifest')
          return route.fulfill({
            contentType: 'application/octet-stream',
            body: '#EXTM3U\n#EXT-X-ENDLIST',
          });
        const large = /large|original|portrait/.test(url.pathname);
        // 故意讓原頁圖片跨過 helper 重建縮圖的時機才完成，驗證自身請求排除不會誤傷原頁。
        if (url.pathname === '/assets/new-page.png')
          await new Promise((resolve) => setTimeout(resolve, 450));
        const w = large ? 1280 : 320;
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w / 1.6}"><rect width="100%" height="100%" fill="#aecae3"/><circle cx="${w * 0.7}" cy="${w * 0.2}" r="${w * 0.1}" fill="#f9e6af"/><path d="M0 ${w * 0.6}L${w * 0.4} ${w * 0.25}L${w} ${w * 0.6}" fill="#628993"/></svg>`,
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(30000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${ORIGIN}/practice`);
      await page.locator(UI).waitFor({ state: 'attached' });
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      return page;
    }
    async function panel(page) {
      await page.locator(UI).getByRole('button', { name: '開啟媒體面板', exact: true }).click();
      await page.locator(`${UI} .panel`).waitFor({ state: 'visible' });
    }
    function card(page, title) {
      return page.locator(`${UI} .card`).filter({ has: page.getByText(title, { exact: true }) });
    }
    const source = (row) => row.locator('input[readonly]').inputValue();
    async function taskState(page, seq, state) {
      await page.waitForFunction(
        ({ id, seq, state }) =>
          document.querySelector(id).shadowRoot.querySelector(`[data-task="${seq}"]`)?.dataset
            .state === state,
        { id: UI, seq, state }
      );
    }

    it('finds the largest matching image variants, preserves signed URLs, and finds stylesheet backgrounds', async () => {
      const page = await open();
      await panel(page);
      assert.equal(await source(card(page, '海邊照片')), LARGE);
      assert.equal(await source(card(page, '橫幅構圖')), `${ORIGIN}/assets/wide-large.png`);
      assert.equal(
        await card(page, '橫幅構圖').locator('option').filter({ hasText: '2400w' }).count(),
        0
      );
      assert.equal(
        await source(card(page, '延遲照片')),
        `${ORIGIN}/assets/original.png?auth=keep%2Bme`
      );
      assert.equal(await source(card(page, '背景圖片')), `${ORIGIN}/assets/background.webp`);
      assert.equal(await page.evaluate(() => window.__downloads.length), 0);
      await page.screenshot({ path: join(OUT, `${engine}-gallery.png`) });
    });

    it('allows choosing the displayed version and opening/copying the exact source', async () => {
      const page = await open();
      await panel(page);
      const row = card(page, '海邊照片');
      await row.getByRole('combobox').selectOption(SMALL);
      await row.getByRole('button', { name: '複製網址', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__clipboard), SMALL);
      await row.getByRole('button', { name: '開啟來源', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__tabs), [SMALL]);
      await row.getByRole('button', { name: '下載', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__downloads[0].url), SMALL);
    });

    it('handles density srcset and commas inside a signed URL without mixing candidates', async () => {
      const page = await open();
      await page.evaluate(() => {
        const image = document.createElement('img');
        image.alt = '密度照片';
        image.srcset =
          '/assets/density.png?token=one,two 1x, /assets/density-large.png?token=three,four 2x';
        document.querySelector('main').prepend(image);
      });
      await panel(page);
      assert.equal(
        await source(card(page, '密度照片')),
        `${ORIGIN}/assets/density-large.png?token=three,four`
      );
    });

    it('shows hover controls over a transparent overlay without intercepting original clicks or keys', async () => {
      const page = await open();
      await page.locator('#overlay').hover({ position: { x: 60, y: 110 } });
      await page.locator(`${UI} .toolbar`).waitFor({ state: 'visible' });
      await page
        .locator(`${UI} .toolbar`)
        .getByRole('button', { name: '複製網址', exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__clipboard), LARGE);
      await page.locator('#overlay').click({ position: { x: 40, y: 130 } });
      assert.equal(await page.evaluate(() => window.originalClicks), 1);
      await page.locator('#editor').fill('hello');
      await page.locator('#editor').press('Escape');
      assert.ok((await page.evaluate(() => window.originalKeys)).includes('Escape'));
      assert.equal(await page.locator('#editor').inputValue(), 'hello');
      await page.locator('#overlay').hover({ position: { x: 60, y: 110 } });
      await page.locator(`${UI} .toolbar`).getByRole('button', { name: '查看其他版本' }).click();
      assert.equal(await page.locator(`${UI} .panel`).isVisible(), true);
    });

    it('updates carousel and lazy media and does not duplicate an identical image', async () => {
      const page = await open();
      await panel(page);
      await page.evaluate(() => {
        const image = document.querySelector('#responsive');
        image.parentElement.append(image.cloneNode(true));
      });
      await page.waitForTimeout(350);
      assert.equal(await card(page, '海邊照片').count(), 1);
      await page.evaluate(() => {
        document.querySelectorAll('#responsive').forEach((image) => {
          image.removeAttribute('srcset');
          image.src = '/assets/slide2.jpg?signature=keep';
        });
        document.querySelector('#lazy').dataset.original = '/assets/new-original.png';
      });
      await page.waitForFunction(
        (id) =>
          [...document.querySelector(id).shadowRoot.querySelectorAll('.card input[readonly]')].some(
            (input) => input.value.includes('slide2.jpg')
          ),
        UI
      );
      assert.equal(
        await source(card(page, '海邊照片')),
        `${ORIGIN}/assets/slide2.jpg?signature=keep`
      );
      assert.equal(await source(card(page, '延遲照片')), `${ORIGIN}/assets/new-original.png`);
    });

    it('does not select a background image through an unrelated modal or accept executable source URLs', async () => {
      const page = await open();
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.id = 'unrelated';
        overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:1000';
        document.body.append(overlay);
        const image = document.createElement('img');
        image.alt = '<b>頁面文字</b>';
        image.setAttribute('src', '/assets/safe.png');
        image.setAttribute('data-original', 'javascript:alert(1)');
        document.querySelector('main').append(image);
        const video = document.createElement('video');
        video.preload = 'none';
        video.setAttribute('aria-label', '格式未知影片');
        video.src = '/unknown-video?id=5';
        document.querySelector('main').append(video);
      });
      await page.mouse.move(150, 350);
      await page.waitForTimeout(300);
      assert.equal(await page.locator(`${UI} .toolbar`).isHidden(), true);
      await page.evaluate(() => document.querySelector('#unrelated').remove());
      await panel(page);
      const row = card(page, '<b>頁面文字</b>');
      assert.equal(await row.locator('b').count(), 0);
      assert.equal(await source(row), `${ORIGIN}/assets/safe.png`);
      assert.equal(await card(page, '格式未知影片').getAttribute('data-capability'), 'candidate');
    });

    it('classifies direct video, manifests, byte ranges, blobs, missing sources and posters', async () => {
      const page = await open();
      await panel(page);
      assert.equal(await card(page, '直接影片').getAttribute('data-capability'), 'direct');
      for (const name of ['HLS 影片', 'DASH 影片', '無副檔名串流']) {
        assert.equal(await card(page, name).getAttribute('data-capability'), 'stream');
        assert.equal(
          await card(page, name).getByRole('button', { name: '下載', exact: true }).isDisabled(),
          true
        );
      }
      assert.equal(await card(page, '分段影片').getAttribute('data-capability'), 'segment');
      for (const name of ['暫存影片', '播放器尚未提供來源'])
        assert.equal(await card(page, name).getAttribute('data-capability'), 'local');
      assert.equal(await card(page, '影片封面').getAttribute('data-kind'), 'image');
      await page.locator(UI).getByRole('combobox', { name: '媒體類型' }).selectOption('video');
      await page.locator(UI).getByRole('button', { name: '全選可下載項目' }).click();
      assert.equal(await page.locator(`${UI} .card input[type=checkbox]:checked`).count(), 1);
    });

    it('loads a gallery video only on request and leaves the original player alone', async () => {
      const page = await open();
      let videoRequests = 0;
      page.on('request', (request) => {
        if (request.url().endsWith('sample.webm')) videoRequests++;
      });
      await panel(page);
      assert.equal(await page.locator(`${UI} video`).count(), 0);
      assert.equal(videoRequests, 0);
      await card(page, '直接影片').getByRole('button', { name: '預覽影片' }).click();
      const player = card(page, '直接影片').locator('video');
      await page.waitForFunction(
        (id) => document.querySelector(id).shadowRoot.querySelector('video')?.readyState >= 1,
        UI
      );
      assert.equal(await player.evaluate((video) => video.paused), true);
      assert.equal(await page.locator('#direct').evaluate((video) => video.paused), true);
      await player.evaluate((video) => video.play());
      await page.locator(UI).getByRole('button', { name: '重新掃描', exact: true }).click();
      assert.equal(
        await player.evaluate((video) => video.paused),
        false,
        'unchanged card preserves playback'
      );
      await page.locator(UI).getByRole('button', { name: '關閉', exact: true }).click();
      assert.equal(await page.locator(`${UI} video`).count(), 0);
      assert.equal(await page.locator('#direct').getAttribute('controls'), '');
    });

    it('deduplicates queued URLs, limits concurrency, reports progress and continues after partial failure', async () => {
      const page = await open();
      await panel(page);
      for (const title of ['海邊照片', '橫幅構圖', '延遲照片'])
        await card(page, title).getByRole('checkbox').check();
      await page.locator(UI).getByRole('button', { name: '下載已選（3）', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__downloads.length), 2);
      await card(page, '海邊照片').getByRole('button', { name: '下載', exact: true }).click();
      assert.equal(await page.locator(`${UI} [data-task]`).count(), 3);
      const names = await page.evaluate(() => window.__downloads.map((entry) => entry.name));
      assert.ok(names.every((name) => !/[\x00-\x1f/\\:*?"<>|]/.test(name)));
      assert.ok(names[0].endsWith('.jpg'));
      await page.evaluate(() => window.__downloads[0].onprogress({ loaded: 512, total: 1024 }));
      assert.equal(
        await page.locator(`${UI} [data-task="1"] progress`).getAttribute('value'),
        '512'
      );
      await page.evaluate(() => window.__downloads[0].onerror({ error: 'not_permitted' }));
      await taskState(page, 1, 'failed');
      await page.waitForFunction(() => window.__downloads.length === 3);
      await page.evaluate(() => {
        window.__downloads[1].onload();
        window.__downloads[2].onload();
      });
      await taskState(page, 2, 'done');
      await taskState(page, 3, 'done');
      await page
        .locator(`${UI} [data-task="1"]`)
        .getByRole('button', { name: '重試', exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__downloads[3].url), LARGE);
    });

    it('cancels active and queued downloads and ignores stale callbacks after retry', async () => {
      const page = await open();
      await panel(page);
      await page.locator(UI).getByRole('button', { name: '全選可下載項目' }).click();
      await page
        .locator(UI)
        .getByRole('button', { name: /^下載已選/ })
        .click();
      await page.locator(UI).getByRole('button', { name: '取消所有待完成下載' }).click();
      assert.equal(
        await page.evaluate(() => window.__downloads.every((entry) => entry.aborted)),
        true
      );
      assert.equal(
        await page.locator(`${UI} [data-state="queued"],${UI} [data-state="downloading"]`).count(),
        0
      );
      await page
        .locator(`${UI} [data-task="1"]`)
        .getByRole('button', { name: '重試', exact: true })
        .click();
      await page.evaluate(() => window.__downloads[0].onload());
      await taskState(page, 1, 'downloading');
      await page.evaluate(() => window.__downloads.at(-1).onload());
      await taskState(page, 1, 'done');
    });

    it('handles synchronous errors and download timeout without leaving a stuck slot', async () => {
      const page = await open();
      await panel(page);
      await page.evaluate(() => {
        window.__throwDownload = true;
      });
      await card(page, '海邊照片').getByRole('button', { name: '下載', exact: true }).click();
      await taskState(page, 1, 'failed');
      await page.evaluate(() => {
        window.__throwDownload = false;
      });
      await page
        .locator(`${UI} [data-task="1"]`)
        .getByRole('button', { name: '重試', exact: true })
        .click();
      await page.evaluate(() => window.__downloads.at(-1).ontimeout());
      await taskState(page, 1, 'failed');
      assert.equal(await page.evaluate(() => window.__downloads.at(-1).aborted), true);
    });

    it('keeps resource-only videos as candidates and excludes requests generated by helper previews', async () => {
      const page = await open();
      await page.evaluate(async () => {
        await fetch('/assets/resource-only.mp4');
        await fetch('/assets/resource-playlist.m3u8');
        await fetch('/assets/resource-segment.m4s');
        const div = document.createElement('div');
        div.id = 'own-bg';
        div.style.backgroundImage = 'url(/assets/only-helper.png)';
        div.hidden = true;
        document.querySelector('main').append(div);
      });
      await panel(page);
      // 強制讓面板縮圖載入一個原頁 hidden 節點不曾請求的圖片。
      const ownCard = page
        .locator(`${UI} .card`)
        .filter({ has: page.locator('input[readonly][aria-label="來源網址"]') });
      await page.evaluate((id) => {
        const root = document.querySelector(id).shadowRoot;
        [...root.querySelectorAll('.card')]
          .find((node) => node.querySelector('input[readonly]')?.value.endsWith('only-helper.png'))
          ?.querySelector('img')
          ?.setAttribute('loading', 'eager');
      }, UI);
      await page.waitForTimeout(400);
      await page.locator(UI).getByRole('combobox', { name: '檢視範圍' }).selectOption('resources');
      assert.ok(await ownCard.count());
      const values = await page
        .locator(`${UI} .card input[readonly]`)
        .evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.ok(values.includes(`${ORIGIN}/assets/resource-only.mp4`));
      assert.ok(!values.includes(`${ORIGIN}/assets/only-helper.png`));
      for (const [ending, state] of [
        ['resource-only.mp4', 'candidate'],
        ['resource-playlist.m3u8', 'stream'],
        ['resource-segment.m4s', 'segment'],
      ]) {
        const actual = await page
          .locator(`${UI} .card`)
          .evaluateAll(
            (nodes, ending) =>
              nodes.find((node) => node.querySelector('input[readonly]').value.endsWith(ending))
                ?.dataset.capability,
            ending
          );
        assert.equal(actual, state);
      }
    });

    it('resets media on SPA navigation but preserves the queued URL snapshot', async () => {
      const page = await open();
      await panel(page);
      await card(page, '海邊照片').getByRole('button', { name: '下載', exact: true }).click();
      await page.evaluate(() => {
        history.pushState({}, '', '/next');
        document.querySelector('main').innerHTML =
          '<img alt="新頁照片" src="/assets/new-page.png" width="320" height="200">';
      });
      await card(page, '新頁照片').waitFor();
      await page.waitForTimeout(700);
      assert.equal(await card(page, '海邊照片').count(), 0);
      assert.equal(await page.evaluate(() => window.__downloads[0].url), LARGE);
      await page.locator(UI).getByRole('combobox', { name: '檢視範圍' }).selectOption('resources');
      await page.waitForFunction(
        (id) =>
          [...document.querySelector(id).shadowRoot.querySelectorAll('.card input[readonly]')].some(
            (input) => input.value.endsWith('new-page.png')
          ),
        UI
      );
      const values = await page
        .locator(`${UI} .card input[readonly]`)
        .evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.ok(!values.includes(SMALL));
      assert.ok(
        values.includes(`${ORIGIN}/assets/new-page.png`),
        'new route resources survive the URL polling boundary'
      );
      await page.evaluate(() => window.__downloads[0].onload());
      await taskState(page, 1, 'done');
    });

    it('persists site hiding and drag position, restores via menu and mounts only once in the top frame', async () => {
      const page = await open();
      const grip = page.locator(UI).getByRole('button', { name: '拖曳媒體按鈕' });
      const box = await grip.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(100, 160);
      await page.mouse.up();
      assert.ok(
        await page.evaluate(() => window.__store.mediaHelperConfig.sites[location.origin].position)
      );
      await page.addScriptTag({ content: SCRIPT });
      assert.equal(await page.locator(UI).count(), 1);
      await panel(page);
      await page.locator(UI).getByRole('button', { name: '隱藏本站工具' }).click();
      await page.reload();
      assert.equal(await page.locator(`${UI} .dock`).isHidden(), true);
      await page.evaluate(() => window.__menus['Media Helper：顯示本站工具']());
      assert.equal(await page.locator(`${UI} .dock`).isVisible(), true);
      assert.ok((await page.locator(`${UI} .dock`).boundingBox()).x < 200);
      await page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.src = '/next';
        document.body.append(frame);
      });
      await page.waitForFunction(
        () => document.querySelector('iframe')?.contentDocument?.readyState === 'complete'
      );
      assert.equal(await page.frames()[1].locator(UI).count(), 0);
    });

    it('fits a narrow dark viewport and uses the matching portrait source', async () => {
      const page = await open({ colorScheme: 'dark', width: 560 });
      await panel(page);
      assert.equal(await source(card(page, '橫幅構圖')), `${ORIGIN}/assets/portrait.png`);
      const box = await page.locator(`${UI} .panel`).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 560);
      assert.equal(
        await page.locator(`${UI} h2`).evaluate((node) => getComputedStyle(node).color),
        'rgb(226, 234, 246)'
      );
      await page.screenshot({ path: join(OUT, `${engine}-dark-narrow.png`) });
    });
  });
}
