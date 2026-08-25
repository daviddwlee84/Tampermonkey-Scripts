#!/usr/bin/env node
// Run a userscript against a real page in headless Chromium and screenshot it.
//
// This is a SMOKE TEST, not a userscript manager. It shims the GM_* APIs in
// plain page context, so it proves "the DOM logic runs and renders" — it does
// NOT prove sandbox behaviour, @match handling, cross-origin GM_xmlhttpRequest,
// or menu commands. Those only exist inside a real manager.
// See docs/13-playwright-vs-userscript.md.
//
// Usage: npm run preview -- <slug> [url] [--headed] [--out <file>]
//                          [--click <selector>] [--menu <caption>] [--wait <ms>]
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listUserscripts, first, REPO_ROOT } from './lib/meta.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const [slug, urlArg] = positional;
if (!slug) {
  console.error('Usage: npm run preview -- <slug> [url] [--headed] [--out <file>]');
  console.error('                          [--click <selector>] [--menu <caption>] [--wait <ms>]');
  process.exit(1);
}

const script = listUserscripts().find((s) => s.slug === slug);
if (!script || script.missing) {
  console.error(`No such userscript: ${slug}`);
  process.exit(1);
}

// Derive a concrete URL from the first @match when none is given.
const matchPattern = first(script.meta, 'match');
const url =
  urlArg ??
  matchPattern.replace(/^\*:\/\//, 'https://').replace(/\/\*$/, '/').replace('*.', '');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run: npm install');
  process.exit(1);
}

/** Minimal in-page GM_* shims. Storage is per-run, not persisted. */
const GM_SHIM = `
window.__gmStore = {};
window.__gmClipboard = null;
window.__gmMenu = [];
window.GM_setValue = (k, v) => { window.__gmStore[k] = v; };
window.GM_getValue = (k, d) => (k in window.__gmStore ? window.__gmStore[k] : d);
window.GM_deleteValue = (k) => { delete window.__gmStore[k]; };
window.GM_listValues = () => Object.keys(window.__gmStore);
window.GM_setClipboard = (text) => { window.__gmClipboard = text; };
window.GM_registerMenuCommand = (caption, fn) => {
  window.__gmMenu.push({ caption, fn });
  return caption;
};
window.GM_unregisterMenuCommand = (id) => {
  window.__gmMenu = window.__gmMenu.filter((m) => m.caption !== id);
};
window.GM_addStyle = (css) => {
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
  return el;
};
window.GM_info = { script: { version: 'preview' }, scriptHandler: 'preview-harness' };
window.unsafeWindow = window;
`;

const outDir = join(REPO_ROOT, '.preview');
mkdirSync(outDir, { recursive: true });
const outFile = value('--out') ?? join(outDir, `${slug}.png`);
const waitMs = Number(value('--wait') ?? 300);

const browser = await chromium.launch({ headless: !flag('--headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const logs = [];
page.on('console', (msg) => logs.push(`  [${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`  [pageerror] ${err.message}`));

console.log(`→ ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });

// @run-at document-idle roughly corresponds to after load + a beat.
await page.addScriptTag({ content: GM_SHIM });
await page.addScriptTag({ content: readFileSync(script.file, 'utf8') });
await page.waitForTimeout(600);

// Optionally drive the script the way a user would, then re-screenshot.
const clickSelector = value('--click');
if (clickSelector) {
  await page.click(clickSelector);
  await page.waitForTimeout(300);
  console.log(`clicked        : ${clickSelector}`);
}

const menuCaption = value('--menu');
if (menuCaption) {
  const ran = await page.evaluate((caption) => {
    const cmd = window.__gmMenu.find((m) => m.caption === caption);
    if (!cmd) return false;
    cmd.fn();
    return true;
  }, menuCaption);
  if (!ran) {
    console.error(`No menu command named "${menuCaption}"`);
    await browser.close();
    process.exit(1);
  }
  // A menu command may be async (e.g. it has to wait for the page's own data
  // before it has anything to export). Resolve as soon as the clipboard is
  // written, or after --wait ms for commands that never touch it.
  await page
    .waitForFunction(() => window.__gmClipboard !== null, null, { timeout: waitMs })
    .catch(() => {});
  console.log(`ran menu       : ${menuCaption}`);
}

const result = await page.evaluate(() => ({
  title: document.title,
  menu: window.__gmMenu.map((m) => m.caption),
  storage: window.__gmStore,
  clipboard: window.__gmClipboard,
}));

await page.screenshot({ path: outFile, fullPage: false });
await browser.close();

console.log(`\ndocument.title : ${result.title}`);
console.log(`menu commands  : ${result.menu.length ? result.menu.join(', ') : '(none)'}`);
console.log(`GM storage     : ${JSON.stringify(result.storage)}`);
if (result.clipboard) {
  console.log(`clipboard      :\n${result.clipboard.split('\n').map((l) => `  | ${l}`).join('\n')}`);
}
if (logs.length) console.log(`\nconsole:\n${logs.join('\n')}`);
console.log(`\nscreenshot     : ${outFile}`);
