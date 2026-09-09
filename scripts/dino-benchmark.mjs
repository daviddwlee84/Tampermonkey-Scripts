import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startDinoServer } from './dino-server.mjs';

const source = await readFile(
  new URL('../userscripts/dino-ai-lab/dino-ai-lab.user.js', import.meta.url),
  'utf8'
);
const out = new URL('../.preview/dino-ai-lab/', import.meta.url);
await mkdir(out, { recursive: true });
const server = await startDinoServer({ port: 0 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // This runner measures algorithms and the delivered UI, not manager integration.
  await page.addInitScript(() => {
    window.GM_getValue = (key, fallback) =>
      JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
    window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    window.GM_registerMenuCommand = () => {};
    window.unsafeWindow = window;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/dino/`);
  await page.waitForFunction(() => window.Runner?.instance_?.tRex);
  await page.addScriptTag({ content: source });
  await page.locator('#toggle').click();
  await page.locator('[data-tab=experiment]').click();
  await page.locator('#batch-rate').selectOption('20');
  await page.locator('#batch-start').click();
  const started = Date.now();
  let completed = -1;
  while (Date.now() - started < 600_000) {
    const status = await page.locator('#batch-status').textContent();
    const count = await page.evaluate(
      () => JSON.parse(localStorage.getItem('dinoAiLab.records.v1') || '[]').length
    );
    if (count !== completed) {
      console.log(status);
      completed = count;
    }
    if (status.startsWith('已完成')) break;
    if (errors.length) throw new Error(errors.join('\n'));
    await page.waitForTimeout(1000);
  }
  if (!(await page.locator('#batch-status').textContent()).startsWith('已完成'))
    throw new Error('Benchmark exceeded ten wall-clock minutes');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#batch-json').click(),
  ]);
  const report = JSON.parse(await readFile(await download.path(), 'utf8'));
  report.validation = {
    browser: browser.version(),
    layer: 'Chromium with explicit GM shim',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    wallSeconds: (Date.now() - started) / 1000,
  };
  await writeFile(new URL('benchmark.json', out), JSON.stringify(report, null, 2) + '\n');
  await page.screenshot({ path: new URL('benchmark.png', out).pathname });
  console.log(JSON.stringify(report.validation));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
