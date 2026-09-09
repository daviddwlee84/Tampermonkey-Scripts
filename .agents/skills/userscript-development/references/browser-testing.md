# Automated browser tests and local test pages

Read when setting up Chromium/Firefox, adding regressions, debugging an interaction,
or adapting the bundled fixture harness. These tests directly inject source and
explicit GM shims. For actual installation, read [extension-testing.md](extension-testing.md).

## Install the browser binaries for the project's Playwright

Use Node 20+ for the bundled example. `playwright` works with `node:test`;
`@playwright/test` is not required just to drive a browser. Work from the user's
project root, not the skill installation directory.

For an existing npm project that already declares Playwright, use its lockfile:

```bash
npm ci
./node_modules/.bin/playwright install chromium firefox
```

For a new npm project, create `package.json` with `npm init -y` if absent, then
install the tested default as a development dependency:

```bash
npm install --save-dev --save-exact playwright@1.62.1
./node_modules/.bin/playwright install chromium firefox
```

Keep the resulting lockfile. For a project using another package manager, retain
that manager and resolve its locally installed Playwright CLI. Do not borrow
`node_modules` from a source repository or install dependencies into the skill.
On supported Linux CI hosts, the local CLI's
`install --with-deps chromium firefox` also installs OS dependencies and can
require elevated package-manager access.

If launch reports a missing executable, install the browsers for the current
dependency version; do not substitute an arbitrary system Chrome. Browser and
OS packages are separate dependencies. Report download/launch failures as setup
failures, never successful tests or silent skips.

## Runnable example

First locate the installed skill from the loaded `SKILL.md` and assign its actual
directory to `US_SKILL_ROOT`. Do not assume a fixed agent directory or look for the
author's checkout. Run the following from the working project after dependency
setup. The example destination must be new; preserve existing tests by choosing
another unused destination if necessary.

```bash
(
  set -eu
  : "${US_SKILL_ROOT:?Set US_SKILL_ROOT to the loaded skill directory}"
  US_FIXTURE_DIR="tests/userscript-fixture"
  if test -e "$US_FIXTURE_DIR"; then
    printf '%s\n' 'Example directory exists; choose an unused destination.' >&2
    exit 1
  fi
  mkdir -p "$US_FIXTURE_DIR"
  cp "$US_SKILL_ROOT/assets/fixture.html" \
     "$US_SKILL_ROOT/assets/fixture-tools.user.js" \
     "$US_SKILL_ROOT/assets/fixture.test.mjs" \
     "$US_SKILL_ROOT/assets/.gitignore" "$US_FIXTURE_DIR/"
  node --test "$US_FIXTURE_DIR/fixture.test.mjs"
)

# Subsequent single-engine runs, from the same project:
US_BROWSERS=chromium node --test tests/userscript-fixture/fixture.test.mjs
```

The example runs both engines by default. It tests a tiny counter userscript on
an entirely local page: initial mount, repeated DOM changes, SPA replacement,
menu reset, and simulated GM storage across reload. Screenshots go to the
example directory's `.artifacts/`; the copied `.gitignore` excludes those outputs.
They can also be published as CI artifacts. This is a working pattern, not a production suite:
replace its script, expected UI, GM contract and assertions with the real task.

## Build a useful fixture

Serve a small HTML file on loopback, or fulfill requests to an explicit synthetic
origin through Playwright routing. A stable HTTP(S) origin enables relative URLs,
History calls and storage that an `about:blank` page does not model well.
Allow only known fixture paths and abort unexpected network requests. If a test
needs images/API responses, define explicit fixtures for them instead of returning
HTML to every request. Keep real-manager install traffic out of these mocks.

Choose cases relevant to the change:

| Case | Fixture behavior / assertion |
|---|---|
| Mount race | Target absent initially, inserted later; exactly one tool appears |
| SPA | Replace main; also change URL without DOM changes; no stale state |
| DOM reuse | Remove owned UI but retain parent, then reconcile |
| Streaming | Repeated small changes; bounded updates, no starvation/feedback |
| Keyboard | Inputs, nested contenteditable, open shadow input, site capture listener, repeats and modifiers |
| Reader/export | Known paragraphs/code/table, relative/lazy images, owned UI and translation sentinels |
| Download | Success, error/login body, timeout, cancellation, duplicate names |
| Layout | Light/dark, narrow viewport, long labels, nested scroll containers |

Include stable element IDs and expected content. Inspect the resulting screenshot
and text artifacts; assertions alone cannot establish layout quality.

## Inject in a known order

Read the actual delivered userscript and resolved `@require` files from disk.
Provide shim, dependencies and source in **one** `context.addInitScript({content})`
call, in that order. Separate init-script registrations have unspecified ordering.
For a post-DOM mount test, explicitly inject at that phase; neither approach
proves that a manager honors the script's `@run-at` under real conditions.

Model only the APIs needed by this script and their real sync/async shape. Missing
APIs should fail visibly. Capture menu callbacks, clipboard values, requested tabs,
storage writes, downloads, and unexpected calls. Implement failure cases relevant
to the task; do not stub every API as a no-op and then infer compatibility.

localStorage can simulate reload persistence in a same-origin fixture. Label that
as a shim; GM storage can span origins and has different isolation/change semantics.

## Drive and observe the interaction

- Use Playwright `locator.click()`, keyboard, pointer and focus operations.
  Calling a callback directly is appropriate for a shim menu contract, but does
  not verify the manager menu's UI.
- Use keyboard typing for shortcut conflicts. Synthetic composition events can
  test a handler's guards, not OS IME end-to-end behavior.
- Register page errors and request failures before navigation. Save a screenshot
  and relevant state on failure as well as on success.
- Wait for state/locators/outputs with a bounded timeout. Fixed sleeps can conceal
  races; a longer sleep is not a correctness assertion.
- Start `waitForEvent('download')` before the triggering click, save and inspect
  the file. Wait for clipboard output before reading it.
- Use independent contexts per test unless persistence/coexistence is the case.
  Close browsers, contexts and local servers in finally/teardown paths.

For pure transformations, test exported modules or the exact pure-function region
from the delivered `.user.js`; do not maintain a test-only copy of the algorithm.
Fixtures derived from an external reference must retain version, source URL and
artifact hash. Agreement with such data is a model check, not a live comparison.

## Official references

- [Playwright browsers](https://playwright.dev/docs/browsers)
- [BrowserContext.addInitScript ordering](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)
- [Playwright downloads](https://playwright.dev/docs/downloads)
- [Node test runner](https://nodejs.org/api/test.html)

Reviewed 2026-09-09. Real-manager evidence is deliberately separate.
