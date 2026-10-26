// Real Violentmonkey smoke: official unpacked artifact, isolated Chromium
// profile, supported install/menu UI, and no GM shims or script injection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

if (!process.env.CSH_VM_DIR)
  throw new Error('Set CSH_VM_DIR to an official unpacked Violentmonkey extension directory.');
const extension = resolve(process.env.CSH_VM_DIR);
if (extension.includes(',')) throw new Error('The extension directory cannot contain a comma.');
const manifestBytes = await readFile(join(extension, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(
  manifest.homepage_url,
  'https://violentmonkey.github.io/',
  'use a Violentmonkey artifact'
);
const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '.preview/clean-share-helper-tests');
const source = await readFile(
  join(root, 'userscripts/clean-share-helper/clean-share-helper.user.js')
);
const headless = process.env.CSH_HEADLESS === '1';
const requests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture.test').pathname;
  if (['/short', '/destination'].includes(path))
    requests.push({ path, method: request.method, cookie: request.headers.cookie || '' });
  if (path === '/short') {
    response.writeHead(302, { Location: '/destination?id=42&utm_source=actual' });
    response.end();
  } else if (path === '/clean-share-helper.user.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end(source);
  } else {
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'fixture_cookie=must_not_send; SameSite=Lax',
    });
    response.end(
      '<!doctype html><title>Clean Share manager fixture</title><p>Clean Share manager fixture</p>'
    );
  }
});
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'clean-share-vm-'));
let context;
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto('chrome://extensions/');
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), manifest.version);
  await page.goto(`chrome://extensions/?id=${id}`);
  await page.locator('#allow-user-scripts cr-toggle').click();
  await page.goto(`chrome-extension://${id}/options/index.html#scripts`);
  await page.getByText('Install from URL', { exact: true }).click();
  await page.locator('input[type="text"]').fill(`${origin}/clean-share-helper.user.js`);
  await page.getByText('OK', { exact: true }).click();
  await page.waitForURL(/\/confirm\/index.html/);
  await page.bringToFront();
  await page.getByRole('button', { name: /^Install/ }).click();

  const fixture = await context.newPage();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await fixture.goto(`${origin}/fixture?utm_source=page`);
  await fixture.locator('html[data-clean-share-helper-running]').waitFor();
  const popup = await context.newPage();
  await fixture.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.getByText('Clean Share：清理任意網址', { exact: true }).click();
  const dialog = fixture.locator('#clean-share-helper-ui').getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await fixture.bringToFront();
  for (const fragment of ['', '#chapter']) {
    await dialog.getByRole('textbox').fill(`${origin}/short?utm_source=source${fragment}`);
    await dialog.getByRole('button', { name: '清理網址', exact: true }).click();
    await dialog.getByRole('button', { name: '展開短連結', exact: true }).click();
    await dialog.getByText('已展開，請自行複製清理結果。', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '複製乾淨網址', exact: true }).click();
    // Read only after our deliberate write; never inspect the prior clipboard.
    await fixture.waitForFunction(
      async (expected) => (await navigator.clipboard.readText()) === expected,
      `${origin}/destination?id=42${fragment}`
    );
  }
  assert.deepEqual(
    requests,
    Array.from({ length: 2 }, () => [
      { path: '/short', method: 'HEAD', cookie: '' },
      { path: '/destination', method: 'HEAD', cookie: '' },
    ]).flat(),
    'both redirect hops must omit the existing fixture cookie'
  );
  await fixture.screenshot({ path: join(out, 'manager-violentmonkey.png') });
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const report = {
    manager: `Violentmonkey ${manifest.version}`,
    browser: context.browser().version(),
    headless,
    install: true,
    menu: true,
    clipboard: true,
    anonymousRedirect: true,
    fragmentRestored: true,
    requests,
    manifestSha256: hash(manifestBytes),
    scriptSha256: hash(source),
  };
  await writeFile(join(out, 'manager-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  if (server.listening) await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true });
}
