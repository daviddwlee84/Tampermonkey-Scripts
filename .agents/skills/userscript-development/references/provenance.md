# Provenance and validated lessons

Read when checking the origin of a recommendation. These public references
provide attribution and historical evidence; using this skill does not require
cloning the source project or accessing the original development environment.

## Published source evidence

Reviewed 2026-09-09 against committed source `d7525d2`. Links pin the versions
that informed the skill, not a claim of testing every current platform release.

| Source | Reusable experience |
|---|---|
| [CLAUDE.md](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/CLAUDE.md) | Repo as source of truth, version bump, generated index, declared grants |
| [SPA guide](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/docs/05-spa-and-timing.md) | Timing, repeated mount, observer scope; see corrections below |
| [Preview guide](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/docs/13-playwright-vs-userscript.md) | Clipboard inspection revealed injected UI contaminating Markdown |
| [Reader implementation](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/userscripts/page-reader-markdown/page-reader-markdown.user.js) and [tests](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/tests/page-reader-markdown.test.mjs) | Clone/snapshot, translation noise, code preservation, partial archives |
| [Keyboard tests](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/tests/vim-navigation.test.mjs) | Chromium/Firefox fixtures, shadow inputs, keyboard isolation and failure cases |
| [Companion tests](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/tests/vimium-c-companion.test.mjs) | GM shim reload/cross-tab model, UI interactions, intentional native-key pass-through |
| [Native reference fixture](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/tests/fixtures/vimium-c-companion/native-reference.json) | Official artifact version, commit, hash, command IDs and mappings |
| [Companion validation](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/userscripts/vimium-c-companion/VALIDATION.md) | Real Chromium + VM/TM + Vimium C, installed through manager UI, no shim |
| [Keyboard validation](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/userscripts/vim-navigation/README.md) | Native clipboard/headed limits, unpacked ID differences, Firefox dashboard timeout |
| [iOS assessment](https://github.com/daviddwlee84/Tampermonkey-Scripts/blob/d7525d2/docs/14-ios-userscripts.md) | Release-specific API audit distinguished from actual device testing |

## Lessons checked during authoring

- The SPA guide's synchronous applying-flag example alone cannot stop observer
  feedback; the actual title script also checks the prefix. A local Chromium
  fixture reproduced three prefixes with a capped flag-only observer versus
  one prefix with a state guard.
- Its DOM-driven URL watcher misses URL-only navigation. A fixture changed
  `/one` to `/two` with `pushState` and observed zero body mutation callbacks.
- Shared DOM helpers must query within their supplied observer root; global
  queries can select unrelated nodes.
- Broad statements about manager CSP immunity or universally shared page globals
  are not portability guarantees. Use official context-specific documentation.
- The project's GM allowlist/regex is a useful local check, not an authoritative
  compatibility specification for every manager/API version.

These small browser probes establish the stated DOM behavior. They do not
establish userscript-manager compatibility; the linked native-validation record
identifies which manager combinations were actually exercised.
