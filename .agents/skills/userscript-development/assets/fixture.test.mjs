// Copy into a project with locked Playwright; see references/browser-testing.md.
// Example: node --test tests/userscript-fixture/fixture.test.mjs
// Optional: US_BROWSERS=chromium (default chromium,firefox).
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';

const script = await readFile(new URL('./fixture-tools.user.js', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixture.html', import.meta.url), 'utf8');
const output = new URL('./.artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const ORIGIN = 'https://userscript.test';
const BUTTON = '#fixture-tools-counter';
const engines = { chromium, firefox };
const requested = (process.env.US_BROWSERS || 'chromium,firefox').split(',').map((s) => s.trim());
for (const name of requested) {
  if (!Object.hasOwn(engines, name)) throw new Error(`Unknown US_BROWSERS engine: ${name}`);
}

// Explicit contract for this example only. The production script never uses
// localStorage directly; this test models reload persistence at one origin.
function installShim() {
  const storageKey = '__fixtureGM';
  const store = JSON.parse(localStorage.getItem(storageKey) || '{}');
  window.__fixtureMenus = [];
  window.GM_getValue = (key, fallback) => Object.hasOwn(store, key) ? store[key] : fallback;
  window.GM_setValue = (key, value) => {
    store[key] = value;
    localStorage.setItem(storageKey, JSON.stringify(store));
  };
  window.GM_registerMenuCommand = (label, callback) => {
    window.__fixtureMenus.push({ label, callback });
    return window.__fixtureMenus.length;
  };
}

for (const name of requested) {
  describe(`userscript fixture / ${name}`, { concurrency: false, timeout: 30000 }, () => {
    let browser;
    let context;
    let page;
    let errors;
    before(async () => { browser = await engines[name].launch(); });
    after(async () => { await browser?.close(); });
    afterEach(async (test) => {
      try {
        if (page && !page.isClosed()) {
          const slug = test.name.replace(/[^a-z0-9]+/gi, '-');
          await page.screenshot({ path: fileURLToPath(new URL(`${name}-${slug}.png`, output)) });
        }
      } finally {
        await context?.close();
        context = undefined;
        page = undefined;
      }
      assert.deepEqual(errors || [], [], 'Unexpected page errors or external requests');
    });

    async function open() {
      errors = [];
      context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      context.setDefaultTimeout(5000);
      // One registration guarantees shim then source, not manager timing.
      await context.addInitScript({ content: `(${installShim.toString()})();\n${script}` });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGIN && ['/one', '/two'].includes(url.pathname)) {
          await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
        } else {
          errors.push(`Unexpected request: ${url.origin}${url.pathname}`);
          await route.abort();
        }
      });
      page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${ORIGIN}/one`);
      await page.locator(BUTTON).waitFor();
    }

    async function count(value) {
      await page.waitForFunction(({ selector, label }) =>
        document.querySelector(selector)?.textContent === label,
      { selector: BUTTON, label: `Fixture count: ${value}` });
      assert.equal(await page.locator(BUTTON).count(), 1);
    }

    it('mounts once and does not duplicate handlers after DOM changes', async () => {
      await open();
      await page.evaluate(() => {
        for (let i = 0; i < 5; i++) document.body.append(document.createElement('span'));
      });
      await page.locator(BUTTON).click();
      await count(1);
      assert.equal(await page.evaluate(() => GM_getValue('fixtureCount')), 1);
    });

    it('remounts on SPA replacement and retains modeled storage across reload', async () => {
      await open();
      await page.locator(BUTTON).click();
      await page.locator('#replace-route').click();
      await page.waitForURL(`${ORIGIN}/two`);
      await count(1);
      await page.locator(BUTTON).click();
      await count(2);
      await page.reload();
      await count(2);
    });

    it('exposes an observable reset menu contract', async () => {
      await open();
      await page.locator(BUTTON).click();
      await count(1);
      await page.evaluate(async () => {
        const menu = window.__fixtureMenus.find((item) => item.label === 'Reset fixture count');
        if (!menu) throw new Error('Reset menu missing');
        await menu.callback();
      });
      await count(0);
    });
  });
}
