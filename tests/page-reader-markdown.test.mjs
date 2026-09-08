import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '.preview', 'page-reader-tests');
const SCRIPT = await readFile(
  join(ROOT, 'userscripts/page-reader-markdown/page-reader-markdown.user.js'),
  'utf8'
);
const DOCK = '#page-reader-markdown-dock';
const READER = '#page-reader-markdown-reader';
const CONTENT = '#page-reader-markdown-content';
await mkdir(OUT, { recursive: true });

// 固定版本的 @require 依 URL hash 快取，不需新增 runtime npm dependency。
const dependencies = await Promise.all(
  [...SCRIPT.matchAll(/^\/\/ @require\s+(\S+)/gm)].map(async ([, url]) => {
    const filename = `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.js`;
    const path = join(OUT, filename);
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    assert.equal(response.status, 200, url);
    const source = await response.text();
    await writeFile(path, source);
    return source;
  })
);

const fixtures = Object.fromEntries(
  await Promise.all(
    ['article', 'wechat', 'short', 'empty', 'docs'].map(async (name) => [
      name,
      await readFile(join(ROOT, `tests/fixtures/page-reader/${name}.html`), 'utf8'),
    ])
  )
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

// 此 shim 僅驗證 GM 回呼契約；不代表真實 manager 的權限或 sandbox。
function gmShim({ storage, scenario }) {
  window.__gmStore = storage;
  window.__gmMenu = [];
  window.__gmClipboard = null;
  window.__gmRequests = [];
  window.__gmActive = 0;
  window.__gmMaxActive = 0;
  window.__gmScenario = scenario;
  window.GM_getValue = (key, fallback) =>
    key in window.__gmStore ? window.__gmStore[key] : fallback;
  window.GM_setValue = (key, value) => {
    window.__gmStore[key] = value;
  };
  window.GM_setClipboard = (text) => {
    window.__gmClipboard = text;
  };
  window.GM_registerMenuCommand = (label, fn) => {
    window.__gmMenu.push({ label, fn });
  };
  window.GM_xmlhttpRequest = (details) => {
    const controller = new AbortController();
    let ended = false;
    window.__gmRequests.push(details.url);
    window.__gmActive++;
    window.__gmMaxActive = Math.max(window.__gmMaxActive, window.__gmActive);
    const finish = (callback, result) => {
      if (ended) return;
      ended = true;
      window.__gmActive--;
      callback?.(result);
    };
    const handle = {
      abort() {
        controller.abort();
        finish(details.onabort);
      },
    };
    if (window.__gmScenario === 'hang') return handle;
    if (window.__gmScenario === 'timeout') {
      setTimeout(() => finish(details.ontimeout), 10);
      return handle;
    }
    if (window.__gmScenario === 'oversize') {
      setTimeout(() => details.onprogress?.({ loaded: 0, total: 51 * 1024 * 1024 }), 10);
      return handle;
    }
    fetch(details.url, { signal: controller.signal })
      .then(async (response) => {
        const bytes = await response.arrayBuffer();
        finish(details.onload, {
          status: response.status,
          response: bytes,
          responseHeaders: [...response.headers]
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n'),
        });
      })
      .catch(() => finish(controller.signal.aborted ? details.onabort : details.onerror));
    return handle;
  };
}

const engines = (process.env.PRM_BROWSERS || 'chromium,firefox').split(',');
for (const engine of engines) {
  describe(`page-reader-markdown / ${engine}`, { concurrency: false }, () => {
    let browser;
    let contexts = [];
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
      const actual = errors;
      errors = [];
      assert.deepEqual(actual, [], 'no uncaught page errors');
    });

    async function open(name = 'article', { storage = {}, scenario = '' } = {}) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        bypassCSP: true,
      });
      contexts.push(context);
      await context.addInitScript(gmShim, { storage, scenario });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const headers = { 'access-control-allow-origin': '*' };
        if (request.isNavigationRequest())
          return route.fulfill({ contentType: 'text/html', body: fixtures[name] });
        if (url.pathname.endsWith('.png'))
          return route.fulfill({ contentType: 'image/png', body: png, headers });
        if (url.pathname.endsWith('protected.pdf'))
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body>Please log in</body></html>',
            headers,
          });
        if (url.pathname.endsWith('missing.pdf'))
          return route.fulfill({ status: 404, body: 'Not found', headers });
        if (url.pathname.endsWith('.pdf'))
          return route.fulfill({
            contentType: 'application/pdf',
            body: '%PDF-1.7\nfixture document\n%%EOF',
            headers,
          });
        if (url.pathname === '/download')
          return route.fulfill({
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            body: 'PK\u0003\u0004office-fixture',
            headers: {
              ...headers,
              'content-disposition': "attachment; filename*=UTF-8''%E5%A0%B1%E5%91%8A.docx",
            },
          });
        return route.fulfill({ contentType: 'text/plain', body: '', headers });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(
        name === 'wechat'
          ? 'https://mp.weixin.qq.com/s?__biz=keep&mid=123'
          : 'https://example.test/article?document=keep'
      );
      for (const content of dependencies) await page.addScriptTag({ content });
      await page.addScriptTag({ content: SCRIPT });
      return page;
    }

    async function menu(page, label) {
      await page.evaluate(async (caption) => {
        const command = window.__gmMenu.find((item) => item.label === caption);
        if (!command) throw new Error(`Missing menu: ${caption}`);
        await command.fn();
      }, label);
    }

    async function clipboard(page) {
      return page.evaluate(() => window.__gmClipboard);
    }

    async function zip(page, name) {
      const event = page.waitForEvent('download');
      await menu(page, '完整本機匯出 · ZIP');
      const download = await event;
      const path = join(OUT, `${engine}-${name}.zip`);
      await download.saveAs(path);
      execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
      const buffer = await readFile(path);
      const entries = await page.evaluate(async (base64) => {
        const archive = await JSZip.loadAsync(
          Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        );
        const result = {};
        for (const [path, entry] of Object.entries(archive.files)) {
          if (!entry.dir)
            result[path] = /\.(md|json)$/.test(path)
              ? await entry.async('string')
              : (await entry.async('uint8array')).length;
        }
        return result;
      }, buffer.toString('base64'));
      const root = Object.keys(entries)[0].split('/')[0];
      return {
        entries,
        root,
        markdown: entries[`${root}/article.md`],
        report: JSON.parse(entries[`${root}/export-report.json`]),
      };
    }

    it('extracts readable Markdown with metadata, code, tables and normalized URLs without fetching the article', async () => {
      const page = await open();
      await menu(page, '複製 Markdown');
      const output = await clipboard(page);
      assert.match(output, /^---\ntitle: "把網頁留在自己的工作流程"/);
      assert.match(output, /author: "測試作者"/);
      assert.match(output, /published_at: "2026-09-08T09:00:00\+08:00"/);
      assert.match(output, /url: "https:\/\/example.test\/article\?document=keep"/);
      assert.match(output, /https:\/\/example.test\/reference\?q=/);
      assert.match(output, /https:\/\/assets.test\/lazy.png/);
      assert.match(output, /photo.png\?signature=keep/);
      assert.match(output, /````js\nconst example = "```";/);
      assert.equal((output.match(/^#+ 把網頁留在自己的工作流程$/gm) || []).length, 1);
      assert.match(output, /\| 模式 \| 用途 \|/);
      assert.doesNotMatch(output, /SENTINEL|PAGE READER|完整本機匯出|fixtureScriptRan/);
      assert.deepEqual(await page.evaluate(() => window.__gmRequests), []);
      await writeFile(join(OUT, `${engine}-article.md`), output);
    });

    it('body-only keeps Markdown structure and text links while removing metadata and image references', async () => {
      const page = await open();
      await menu(page, '複製僅正文');
      const output = await clipboard(page);
      assert.match(output, /^# 把網頁留在自己的工作流程/);
      assert.match(output, /\[背景文件\]\(https:/);
      assert.match(output, /\| Reader \| 閱讀 \|/);
      assert.doesNotMatch(output, /captured_at:|!\[|photo.png|lazy.png/);
    });

    it('downloads a UTF-8 Markdown file with exactly the Reader snapshot contents', async () => {
      const page = await open();
      await menu(page, '切換專注閱讀');
      await menu(page, '複製 Markdown');
      const expected = await clipboard(page);
      const event = page.waitForEvent('download');
      await menu(page, '下載 Markdown');
      const download = await event;
      const path = join(OUT, `${engine}-download.md`);
      await download.saveAs(path);
      assert.match(download.suggestedFilename(), /\.md$/);
      assert.equal(await readFile(path, 'utf8'), expected);
    });

    it('preserves technical examples, structured metadata, complex tables and picture sources', async () => {
      const page = await open('docs');
      await menu(page, '複製 Markdown');
      const output = await clipboard(page);
      assert.match(output, /author: "Ada, Lin"/);
      assert.match(output, /```python\nprint\("first example"\)/);
      assert.match(output, /```sh\necho second-example/);
      assert.match(output, /<th colspan="2">Combined heading<\/th>/);
      assert.match(output, /https:\/\/docs.test\/reference.pdf/);
      assert.match(output, /https:\/\/assets.test\/selected.png/);
      assert.doesNotMatch(output, /DOC_NAV_SENTINEL|data-prm-asset|fallback.png/);
      await page.locator('picture').evaluate((node) => {
        const range = document.createRange();
        range.selectNode(node);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await menu(page, '以目前圈選開啟 Reader');
      await menu(page, '複製 Markdown');
      assert.match(await clipboard(page), /scope: "selection"/);
      assert.match(await clipboard(page), /https:\/\/assets.test\/selected.png/);
      assert.doesNotMatch(await clipboard(page), /fallback.png/);
    });

    it('archives embedded and blob images locally and keeps long Unicode filenames extractable', async () => {
      const page = await open('short');
      await page.evaluate(async (data) => {
        document.title = '測試中文標題'.repeat(30);
        document.querySelector('h1').textContent = document.title;
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        for (const [src, alt] of [
          [`data:image/png;base64,${data}`, 'embedded'],
          [blobUrl, 'blob'],
        ]) {
          const image = document.createElement('img');
          image.src = src;
          image.alt = alt;
          document.querySelector('main').append(image);
        }
      }, png.toString('base64'));
      const result = await zip(page, 'local-images');
      assert.equal(result.report.saved, 2);
      assert.equal(result.report.failed, 0);
      assert.ok(Buffer.byteLength(result.root, 'utf8') < 255);
      assert.match(result.markdown, /!\[embedded\]\(attachments\//);
      assert.match(result.markdown, /!\[blob\]\(attachments\//);
      assert.doesNotMatch(result.markdown, /\]\(data:|\]\(blob:/);
      assert.deepEqual(await page.evaluate(() => window.__gmRequests), []);
    });

    it('preserves a selection while interacting with the hover panel and supports selection Reader', async () => {
      const page = await open();
      await page.locator('#selection-paragraph').evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.locator(`${DOCK} .main`).hover();
      await page.locator(`${DOCK} select[aria-label="擷取範圍"]`).selectOption('selection');
      await page.locator(`${DOCK} [data-action="copy"]`).click();
      const output = await clipboard(page);
      assert.match(output, /scope: "selection"/);
      assert.match(output, /\*\*保留重要的語意\*\*/);
      assert.doesNotMatch(output, /讓閱讀與匯出各自|photo.png/);
      await page.locator(`${DOCK} .main`).click();
      assert.match(await page.locator(CONTENT).innerText(), /這一段可以單獨圈選/);
      assert.equal(await page.locator(`${DOCK} select[aria-label="擷取範圍"]`).isDisabled(), true);
    });

    it('Reader uses a snapshot, survives translation, and restores the source page and scroll', async () => {
      const page = await open();
      await page.evaluate(() => {
        document.body.style.overflow = 'scroll';
        window.scrollTo(0, 350);
      });
      const before = await page.evaluate(() => ({
        html: document.querySelector('main').innerHTML,
        y: scrollY,
      }));
      await page.locator(`${DOCK} .main`).click();
      await page.waitForSelector(READER);
      await menu(page, '複製 Markdown');
      const original = await clipboard(page);
      await page.locator(CONTENT).evaluate((node) => {
        const translation = document.createElement('p');
        translation.className = 'immersive-translate-target-wrapper';
        translation.textContent = 'TRANSLATION_SENTINEL';
        node.append(translation);
        node.querySelector('p').textContent = 'MODIFIED_READER_PARAGRAPH';
      });
      await menu(page, '複製 Markdown');
      assert.equal(await clipboard(page), original);
      assert.doesNotMatch(original, /TRANSLATION_SENTINEL|MODIFIED_READER/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator(READER).count(), 0);
      const after = await page.evaluate(() => ({
        html: document.querySelector('main').innerHTML,
        y: scrollY,
        overflow: document.body.style.overflow,
      }));
      assert.equal(after.html, before.html);
      assert.equal(after.y, before.y);
      assert.equal(after.overflow, 'scroll');
    });

    it('removes existing translation wrappers while restoring hidden source text', async () => {
      const page = await open();
      await page
        .locator('article > p')
        .first()
        .evaluate((node) => {
          node.className = 'immersive-translate-source-hidden';
          node.style.display = 'none';
          const translation = document.createElement('p');
          translation.className = 'immersive-translate-target-wrapper';
          translation.textContent = 'TRANSLATION_SENTINEL';
          node.after(translation);
        });
      await menu(page, '複製 Markdown');
      assert.match(await clipboard(page), /瀏覽器已經載入的文章/);
      assert.doesNotMatch(await clipboard(page), /TRANSLATION_SENTINEL/);
      assert.equal(
        await page
          .locator('.immersive-translate-source-hidden')
          .evaluate((node) => node.style.display),
        'none'
      );
    });

    it('extracts WeChat content and metadata without losing URL parameters or lazy images', async () => {
      const page = await open('wechat');
      await menu(page, '複製 Markdown');
      const output = await clipboard(page);
      assert.match(output, /title: "微信文章標題"/);
      assert.match(output, /site: "公眾號名稱"/);
      assert.match(output, /author: "微信作者"/);
      assert.match(output, /published_at: "2026年9月8日"/);
      assert.match(output, /extraction: "wechat"/);
      assert.match(output, /__biz=keep&mid=123/);
      assert.match(output, /wechat.png\?wx_fmt=png/);
      assert.doesNotMatch(output, /SENTINEL/);
      assert.deepEqual(await page.evaluate(() => window.__gmRequests), []);
    });

    it('supports short semantic articles and reports pages with no article instead of copying navigation', async () => {
      const short = await open('short');
      await menu(short, '複製 Markdown');
      assert.match(await clipboard(short), /A short article still contains useful information/);
      const empty = await open('empty');
      await menu(empty, '複製 Markdown');
      assert.equal(await clipboard(empty), null);
      assert.match(await empty.locator(`${DOCK} .status`).textContent(), /沒有找到正文/);
    });

    it('exports deduplicated image/document files, rewrites local links and reports partial failures', async () => {
      const page = await open();
      const result = await zip(page, 'attachments');
      assert.equal(result.report.saved, 5);
      assert.equal(result.report.failed, 2);
      assert.equal(result.report.complete, false);
      assert.equal(result.report.assets.length, 7);
      assert.match(result.markdown, /attachments\/[^)]+\.pdf#page=2/);
      assert.match(result.markdown, /attachments\/[^)]+\.docx/);
      assert.match(result.markdown, /https:\/\/assets.test\/protected.pdf/);
      assert.match(result.markdown, /https:\/\/assets.test\/missing.pdf/);
      assert.match(
        result.report.assets.find((asset) => asset.source.endsWith('protected.pdf')).error,
        /HTML/
      );
      const requests = await page.evaluate(() => window.__gmRequests);
      assert.equal(requests.filter((url) => url.includes('photo.png')).length, 1);
      assert.equal(requests.length, 7);
      assert.equal(
        requests.some((url) => /movie.mp4|read-more|example.test/.test(url)),
        false
      );
      assert.ok(await page.evaluate(() => window.__gmMaxActive <= 3));
      for (const asset of result.report.assets.filter((asset) => asset.status === 'saved')) {
        assert.ok(result.entries[`${result.root}/${asset.path}`] > 0);
        assert.ok(!asset.path.includes('..'));
      }
      const localRefs = [...result.markdown.matchAll(/\]\((attachments\/[^)]+)\)/g)].map(
        ([, path]) => decodeURIComponent(path.split('#')[0])
      );
      for (const path of localRefs)
        assert.ok(`${result.root}/${path}` in result.entries, `exists offline: ${path}`);
      assert.equal(result.report.assets.filter((asset) => asset.path?.endsWith('.pdf')).length, 2);
    });

    for (const scenario of ['timeout', 'oversize']) {
      it(`reports ${scenario} failures without abandoning the Markdown archive`, async () => {
        const page = await open('article', { scenario });
        const result = await zip(page, scenario);
        assert.equal(result.report.saved, 0);
        assert.equal(result.report.failed, 7);
        assert.match(result.report.assets[0].error, scenario === 'timeout' ? /逾時/ : /50 MiB/);
        assert.match(result.markdown, /https:\/\/assets.test\/photo.png/);
      });
    }

    it('cancels active requests without producing an archive', async () => {
      const page = await open('article', { scenario: 'hang' });
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.evaluate(() => {
        window.__gmMenu.find((item) => item.label === '完整本機匯出 · ZIP').fn();
      });
      await page.waitForFunction(() => window.__gmActive === 3);
      await menu(page, '取消本機匯出');
      await page.waitForFunction(() => window.__gmActive === 0);
      await page.waitForFunction(
        () =>
          document
            .querySelector('#page-reader-markdown-dock')
            .shadowRoot.querySelector('[data-action="cancel"]').hidden
      );
      assert.equal(downloads, 0);
      assert.match(await page.locator(`${DOCK} .status`).textContent(), /已取消/);
    });

    it('cancels a pending archive on SPA navigation', async () => {
      const page = await open('article', { scenario: 'hang' });
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.evaluate(() => {
        window.__gmMenu.find((item) => item.label === '完整本機匯出 · ZIP').fn();
      });
      await page.waitForFunction(() => window.__gmActive === 3);
      await page.evaluate(() => history.pushState({}, '', '/different-article'));
      await page.waitForFunction(() => window.__gmActive === 0);
      assert.equal(downloads, 0);
    });

    it('handles URL changes with no DOM mutation, drops old snapshots and mounts only once', async () => {
      const page = await open();
      await menu(page, '切換專注閱讀');
      await page.evaluate(() => history.pushState({}, '', '/next?keep=yes'));
      await page.waitForSelector(READER, { state: 'detached' });
      await page.evaluate(() => {
        document.title = '第二篇文章';
        document.querySelector('main').innerHTML =
          '<article><h1>第二篇文章</h1><p>這是新的文章內容，切換網址以後必須重新擷取，不可以繼續使用上一篇文章的原文快照。</p></article>';
      });
      await menu(page, '複製 Markdown');
      assert.match(await clipboard(page), /新的文章內容/);
      assert.match(await clipboard(page), /next\?keep=yes/);
      assert.doesNotMatch(await clipboard(page), /瀏覽器已經載入的文章/);
      const menuCount = await page.evaluate(() => window.__gmMenu.length);
      await page.addScriptTag({ content: SCRIPT });
      assert.equal(await page.locator(DOCK).count(), 1);
      assert.equal(await page.evaluate(() => window.__gmMenu.length), menuCount);
    });

    it('supports drag without toggling Reader, per-site hiding, appearance settings and a bounded panel', async () => {
      const page = await open();
      const main = page.locator(`${DOCK} .main`);
      const rect = await main.boundingBox();
      await page.mouse.move(rect.x + 24, rect.y + 24);
      await page.mouse.down();
      await page.mouse.move(800, 600, { steps: 12 });
      await page.mouse.up();
      assert.equal(await page.locator(READER).count(), 0);
      assert.ok(await page.evaluate(() => window.__gmStore.buttonPosition.left < 1000));
      await page.mouse.move(0, 0);
      await page.locator(`${DOCK} .main`).hover();
      assert.equal(await page.locator(`${DOCK} .panel`).isVisible(), true);
      assert.match(
        await page.locator(`${DOCK} .panel`).evaluate((node) => getComputedStyle(node).fontFamily),
        /system-ui/
      );
      await page.screenshot({ path: join(OUT, `${engine}-panel.png`) });
      await menu(page, '重設按鈕位置');
      await main.click();
      await page.waitForSelector(READER);
      await page.screenshot({ path: join(OUT, `${engine}-reader.png`) });
      await page.locator(`${READER} button`).filter({ hasText: '匯出與設定' }).click();
      await page.locator(`${DOCK} summary`).click();
      await page.locator(`${DOCK} select[aria-label="閱讀主題"]`).selectOption('dark');
      assert.equal(await page.locator(READER).getAttribute('data-theme'), 'dark');
      await page.keyboard.press('Escape');
      await menu(page, '隱藏本站按鈕');
      assert.equal(await page.locator(DOCK).isVisible(), false);
      await menu(page, '複製 Markdown');
      assert.match(await clipboard(page), /captured_at:/);
      await menu(page, '顯示本站按鈕');
      await page.setViewportSize({ width: 360, height: 600 });
      await page.locator(`${DOCK} .main`).hover();
      const panel = await page.locator(`${DOCK} .panel`).boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= 360);
      assert.ok(panel.y >= 0 && panel.y + panel.height <= 601);
      const start = await main.boundingBox();
      await page.mouse.move(start.x + 24, start.y + 24);
      await page.mouse.down();
      await page.mouse.move(170, 320, { steps: 10 });
      await page.mouse.up();
      await page.mouse.move(0, 0);
      await main.hover();
      const middle = await page.locator(`${DOCK} .panel`).boundingBox();
      assert.ok(middle.x >= 0 && middle.x + middle.width <= 360);
      assert.ok(middle.y >= 0 && middle.y + middle.height <= 601);
      await main.click();
      assert.equal(await page.locator(READER).count(), 1);
    });
  });
}
