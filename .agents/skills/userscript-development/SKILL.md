---
name: userscript-development
description: 'Build and debug userscripts for Tampermonkey and Violentmonkey. Use when editing .user.js files, adding page tools or hotkeys, exporting Markdown, fixing SPA or GM API issues, testing with Chromium/Firefox fixtures or real managers, comparing reference extensions, or assessing Safari Userscripts support. Covers sandbox boundaries, UI isolation, browser setup, and evidence-based compatibility claims.'
---

# Userscript Development

Turn a page enhancement into a maintainable script and verify it at the layer
where it will run. The repo is the source of truth; a manager is an installation
and execution target. Use the workflow in any userscript project; read
[provenance](references/provenance.md) only when tracing its source evidence.

## Scope and defaults

- Use for `.user.js` development, review, troubleshooting, and browser testing.
- Default to Tampermonkey + Violentmonkey when no target is specified; record
  this assumption. Treat Safari Userscripts and Greasemonkey as separate targets.
- Preserve the project's build system and API style. For a small new project,
  start with a plain JavaScript IIFE and a directly installable `.user.js`.
  Adopt a bundler when dependencies or project requirements justify it.
- Use browser automation as a test driver here. A scheduled crawler or a
  browser extension's background/tab-management feature needs its own workflow.
- The bundled browser example requires Node 20+ and project-pinned Playwright;
  neither is a userscript runtime dependency. Real-manager tests also need the
  relevant official extension artifacts and an isolated browser profile.

## Installed-skill contract

- Resolve `US_SKILL_ROOT` from the directory containing the loaded `SKILL.md`,
  following its symlink if needed. References and assets are relative to that
  directory, regardless of which agent or project/global installation was used.
- Run project commands from the user's selected working project. Inspect its
  package scripts and layout first; no particular upstream checkout or sibling
  repository is required.
- Treat the installed skill as read-only. Copy examples into the working project
  before installing dependencies or running them; keep outputs there too.

## Workflow

- [ ] **1. Inspect the project and choose acceptance cases.** Read its agent
  instructions, metadata validator, scripts, fixtures, and recent validation
  records. Establish target URLs, manager/browser versions, frame scope, trigger,
  expected result, and how to undo the UI change. Infer routine choices from the
  repo; ask only about missing requirements that affect behavior.
  Use only commands that exist in the current project.
- [ ] **2. Establish metadata and the execution boundary.** Preserve script
  identity and existing URL scope. Map each required capability to a declared
  grant; distinguish DOM access from page-JavaScript access. Read
  [metadata and runtime](references/metadata-and-runtime.md) when adding APIs,
  changing timing, diagnosing injection, or adding a manager target.
- [ ] **3. Make the enhancement survive the page lifecycle.** Separate the
  persistent shell from route-specific state. Make reconciliation idempotent,
  bound observers, and invalidate stale asynchronous work. Read
  [DOM lifecycle and interaction](references/dom-lifecycle.md) for SPA changes,
  hotkeys, injected UI, focus, or cleanup.
- [ ] **4. Verify the actual output.** For a reader/exporter, read
  [content extraction](references/content-extraction.md): clone before cleaning,
  exclude owned UI, preserve a snapshot, and report partial results honestly.
- [ ] **5. Run focused automated tests.** Start with syntax and project checks;
  reproduce the relevant interaction in a local fixture. Read
  [browser testing](references/browser-testing.md) for browser installation,
  test pages, deterministic GM shims, screenshots, downloads, and test matrices.
  Fix failures and rerun the affected checks.
- [ ] **6. Exercise a real manager when that layer matters.** Read
  [manager and reference-extension testing](references/extension-testing.md)
  for persistent Chromium contexts, installing through manager UI, discovering
  extension IDs, Firefox limitations, and differential/coexistence tests.
  A shim pass does not complete this step. If the environment blocks it, finish
  independent checks and record the exact unverified cases.
- [ ] **7. Prepare the deliverable.** Bump an already distributed script's
  version for a changed release; regenerate indexes with repo tools; verify the
  raw install URL and dependency revisions. Report versions and evidence using
  the template below. Publishing follows the user's requested scope.

## Choose the test layer deliberately

| Layer | What it establishes | What remains outside it |
|---|---|---|
| Syntax / metadata / pure functions | Parsing, declared capabilities, transformations | Browser behavior and installation |
| Chromium + Firefox fixture with GM shim | DOM, keyboard, routing, UI, output, modeled GM calls | Actual grants, sandbox, manager storage and updates |
| Real manager on local HTTP fixture | Installation, matching, execution, storage, manager integration | Arbitrary sites and other browser/manager versions |
| Reference extension alone / script alone / together | Native baseline, intended differences, keyboard and UI coexistence | Complete equivalence of all extension capabilities |
| Requested live-site smoke | The named interactions on that site's current DOM | All routes, accounts, or future site versions |

## Gotchas

- **A synchronous `applying` flag does not stop observer feedback.** Mutation
  callbacks arrive later. Compare the desired DOM value before writing; make a
  second reconciliation do nothing. A trailing debounce can also starve forever
  on a streaming page; use bounded scheduling where progress must continue.
- **A DOM observer is not a navigation observer.** URL-only route changes can
  have no DOM mutation. Recheck route identity on actions and use a route signal
  supported by the target environment.
- **Page context is not guaranteed by a successful Console experiment.** A new
  grant can change execution context. `document-start` is a requested timing,
  not proof that the script beat every site script or dependency load.
- **`@require` consumers own their dependencies' grants too.** Static regex
  scanners can miss calls in helpers and dynamic access; inspect dependencies.
  A local harness may substitute the worktree file while a manager uses a
  cached remote revision.
- **One init-script call preserves shim → dependency → script ordering.**
  Separate Playwright init-script registrations have no guaranteed relative
  order. Direct injection still does not reproduce the manager's timing.
- **Reference data is not a running extension.** A copied command table verifies
  a model; actual extension coexistence requires loading the extension too.
- **The first extension worker might belong to the reference extension.**
  Discover and identify each installed artifact; don't hard-code store IDs or
  assume every extension uses a Manifest V3 service worker.
- **Headless clipboard success is not a system-clipboard check.** Use a headed
  session when that behavior is required and record what was actually observed.
- **CSS isolation is not keyboard isolation.** Shadow DOM events can retarget to
  the host. Check `composedPath()`, editable ancestors, IME, and key sequences.
- **Two installed copies can look like a lifecycle bug.** Confirm script ID,
  version, manager, and whether both a URL install and local tracking copy run.
- **No API family is universally portable.** `GM_*` and `GM.*` can differ in
  availability, naming, return values, and timing. Awaiting an absent API is
  still a failure; don't advertise Safari support from desktop tests.

## Bundled assets

Copy these three files together into a project's test-example directory when
setting up its first browser harness. Read [browser testing](references/browser-testing.md)
before adapting them; they demonstrate a fixture contract, not a universal shim.

- `assets/fixture.html` — local SPA test page with an input and a replaceable main.
- `assets/fixture-tools.user.js` — small installable counter/menu demonstration.
- `assets/fixture.test.mjs` — Node test runner + Chromium/Firefox, explicit GM
  shim, route isolation, DOM and storage assertions, screenshots, cleanup.
- `assets/.gitignore` — keep the copied example's `.artifacts/` outputs out of Git.

## Handoff template

```text
Changed: <script/file; user-visible behavior; version before → after>
Targets: <manager + browser versions; URL/frame scope>
Permissions/dependencies: <added/changed capabilities and reason>
Checks:
  Static/pure: <command + result>
  Browser fixtures: <engines + cases + result>
  Real manager: <installation path + cases + result, or unverified reason>
  Reference comparison: <artifact/version + baseline/difference/coexistence>
  Live site: <specific routes/actions, or not run>
Evidence: <test page, report, screenshot, output paths>
Install/update: <artifact/raw URL; dependency and version considerations>
Remaining limits: <specific untested behavior; no inferred pass>
```
