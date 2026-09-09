# Real managers and reference extensions

Read when the requirement includes installing a userscript, validating sandbox or
GM behavior, matching a native extension, or checking coexistence. This workflow
was exercised in the source project; its versioned record is linked below.

## 1. Prepare isolated artifacts

Use official releases/store packages or a read-only copy of an already installed
official extension directory. Record origin, version, manifest version and hash.
Do not use a random repackaged download. Extension package files are sufficient;
do not clone a daily browser profile, cookies, or extension settings.

Create a new test profile. Keep the manager and optional reference-extension
directories separate. Preserve upstream code and the manifest; if an unpacked
artifact has a different ID, discover that ID rather than modifying keys to force
the store ID. A CRX is not the unpacked directory expected by Chromium's flags:
use a verified unpacked release/build or a format-aware extraction tool, retaining
the original artifact. An XPI is a Firefox artifact, not a Chromium extension.

## 2. Launch bundled Chromium with persistent context

The official Playwright extension workflow uses bundled Chromium and a persistent
context. Regular `browser.newContext()` is not the extension-loading workflow.
Chrome/Edge release channels may not accept the sideload flags. Start headed when
debugging permissions, installation UI or system clipboard behavior; the bundled
`chromium` channel also supports headless extension tests.

Setup fragment for a project-pinned Playwright runner. Set `US_MANAGER_DIR` and
optional `US_REFERENCE_DIR` to the user's unpacked artifacts; relative paths are
resolved from the working project. No particular browser profile directory or
author's machine is assumed:

```javascript
import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (!process.env.US_MANAGER_DIR) throw new Error('Set US_MANAGER_DIR to an unpacked manager');
const dirs = [process.env.US_MANAGER_DIR, process.env.US_REFERENCE_DIR]
  .filter(Boolean).map((path) => resolve(path));
for (const dir of dirs) {
  if (dir.includes(',')) throw new Error('Extension directories must not contain commas');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  console.log({ dir, version: manifest.version, manifestVersion: manifest.manifest_version });
}
const profile = await mkdtemp(join(tmpdir(), 'userscript-manager-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${dirs.join(',')}`,
    `--load-extension=${dirs.join(',')}`,
  ],
});
try {
  const page = await context.newPage();
  await page.goto('chrome://extensions/');
  // Identify loaded extensions, install through the manager UI, then run cases.
  // Keep this test free of GM shims and direct userscript injection.
} finally {
  await context.close();
}
```

This is launch setup, not an installation test on its own. Keep the temporary
profile only while diagnosing; remove that specific profile after closing the
browser when evidence is saved. Do not commit profiles or extension binaries.

## 3. Identify the installed manager and import the script

1. Inspect the extension list and loaded artifact version. For Manifest V3,
   enumerate service workers, identify each by its own manifest/name/version,
   and derive its ID from its `chrome-extension://` URL. With multiple extensions,
   the first worker is not necessarily the manager. Worker startup may be delayed
   or suspended. Manifest V2/background-page extensions need a different discovery
   path; an absent worker is not proof that loading failed.
2. Inspect the current browser's extension detail UI for required user-script
   injection and site-access controls. Names and locations change by version.
   Enable only the test manager's required permissions in the isolated profile.
3. Open its options/dashboard using the actual installed ID and the manifest's
   options page, or its visible extension UI. Do not hard-code a store ID or
   assume Tampermonkey and Violentmonkey share editor paths.
4. Use the manager's supported file import or raw `.user.js` install flow.
   For a file chooser, start `waitForEvent('filechooser')` **before** clicking
   import, then `chooser.setFiles(scriptPath)`. Confirm/save through the real UI.
   If a manager has only an editor, inspect that editor's supported interaction;
   do not write private extension databases as a shortcut.
5. Confirm installed name/version/enabled status. Reload a matching local test
   page. Assert a distinctive DOM effect, actual GM setting persistence across
   reload, and relevant menu/clipboard/download behavior.

Serve the fixture and optional raw script from a loopback HTTP server with the
correct content types. Bind to `127.0.0.1`, use an available port, avoid caching
stale scripts, and close it on every exit path. For a narrow production match,
record a temporary test-copy match change as described in
[metadata-and-runtime.md](metadata-and-runtime.md).

If nothing injects, inspect version, matching, grants, permission toggles and
extension errors. Do not add a GM shim to make this test pass: that changes what
the test measures. Headless clipboard results do not establish native clipboard
delivery; use a headed, deliberate clipboard case without logging prior content.

## 4. Compare a reference extension

Use the same HTML, viewport, focus/scroll starting point, settings and key sequence
in three configurations, preferably fresh profiles:

| Configuration | Question |
|---|---|
| Reference extension alone | What does this exact version actually do? |
| Userscript + manager | Does the intended subset behave as specified? |
| Reference + userscript + manager | Do focus, shortcuts and controls coexist? |

For Vimium-like tools, useful cases include native `j` scroll, `f` link hints,
help/Escape ownership, typing `scripts` into the userscript's search field, and
native hint activation of a userscript control. Inspect observable outcomes—scroll
position, selection text, focused element, hint visibility—not only key dispatch.
Use browser input rather than page-created KeyboardEvent objects for native actions.

Separate intended differences from regressions. A reference-only test proves
native behavior; a command catalog copied from an official artifact proves only
the static model. Keep reference settings unchanged when importing them into a
companion's preview. Do not assume a private extension bridge exists.

Record version/hash, fixture, initial state, action, expected/actual result and
screenshots. A practical report distinguishes `pass`, `fail`, and `unverified`.

## 5. Firefox and Safari boundaries

Playwright Firefox DOM tests work with explicit GM shims. Chromium's extension
flags and `chrome-extension://` dashboard URLs do not apply to Firefox.

For actual Firefox extension development, use Firefox's temporary-add-on workflow
or Mozilla's `web-ext` with a fresh profile and the correct official artifact:

```bash
npx --yes web-ext@10.6.0 run --source-dir "$US_MANAGER_DIR"
```

Use `web-ext --help`/current Mozilla documentation for binary/profile selection.
This launches a temporary add-on session; it is not a claim that Playwright can
automate that Firefox session. Multi-extension manager coexistence may need the
native browser UI or a separately validated automation driver. A loaded add-on
whose dashboard cannot be opened is **not** a successful userscript install.
Safari/iPad needs its own app, API and on-device validation path.

## Evidence and official references

- [Playwright extension guide](https://playwright.dev/docs/chrome-extensions)
- [Mozilla web-ext workflow](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
- [Source project's versioned real-manager record](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/userscripts/vimium-c-companion/VALIDATION.md)

Reviewed 2026-09-09. The source record reports Chromium + VM/TM + Vimium C
coexistence; it explicitly leaves actual Firefox manager coexistence unverified.
