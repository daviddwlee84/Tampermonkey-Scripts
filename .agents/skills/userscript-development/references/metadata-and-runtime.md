# Metadata and runtime boundaries

Read when changing metadata, APIs, execution timing, sandbox behavior, or manager
support. Recheck the official references for the user's installed versions.

## Header contract

Put the metadata block at the file's beginning. Keep explanations outside it:
trailing `// comments` can become part of a metadata value. Preserve
`@name` + `@namespace` identity during routine edits.

| Decision | Default / verification |
|---|---|
| Timing | Explicit `document-idle` for ordinary DOM tools; verify the requested lifecycle if earlier execution is necessary |
| Frames | Top-level only for a single toolbar; declare `@noframes` when appropriate, preserve intentional frame support |
| APIs | Declare exact grant spellings for used APIs, including required helper code; do not combine privileged APIs with `@grant none` |
| URL scope | Required origins/paths; test allowed and excluded URLs in a manager |
| Network | Limit `@connect` to required hosts; handle permission rejection and redirects |
| Dependencies | Pin a release/commit URL; inspect code and grants introduced by `@require` |
| Icon | An embedded icon avoids an optional favicon service becoming an installation failure |
| Updates | Increase `@version` for a new distributed version; verify settings and actual update/download endpoints |

Do not widen a production `@match` to make a local test pass. For a site-specific
script, use a clearly labeled temporary test copy with an additional loopback
match. Record that difference and test original matching separately. A general
page tool may already match loopback without modification.

Use the project's actual identity and URLs. Add update/download metadata when a
real distribution location exists; don't invent a reachable release URL.

## Diagnose context without changing it blindly

1. Confirm manager installation, enabled state, browser injection permission,
   URL matching, and the loaded script version.
2. Distinguish missing DOM, missing GM APIs, and unavailable page globals.
   DOM visibility does not imply shared JavaScript globals.
3. Prefer semantic DOM or a documented data surface for page features.
   `unsafeWindow` and manager-specific injection modes are explicit dependencies,
   not routine fixes for a selector that runs too early.
4. Check the sandbox/browser mode against official documentation. CSP and
   Trusted Types depend on context and operation. A harness using `bypassCSP`
   supplies no evidence about these restrictions.
5. Test in the manager; retain the Console experiment as diagnostic evidence
   about the page realm only.

Ordinary fetch still follows browser rules. Manager request APIs need appropriate
grants and hosts; they do not confer access to data the user is not authorized
to access. Keep secrets out of distributed scripts. Use `textContent` for plain
text and sanitize extracted HTML before rendering it into an interactive reader.

## API compatibility is a matrix

Retain a project's synchronous `GM_getValue` convention when it targets the
corresponding desktop managers. For an async-only target, use an explicit adapter,
await initialization, and verify missing capabilities individually. Mechanically
changing `GM_` to `GM.` is not a port: names, availability and semantics vary.

Storage is per manager/script and may be per device. File sync, userscript update,
and GM value sync are separate operations. A localStorage-backed test shim models
only its documented contract; it is not the manager's storage backend.

For Safari Userscripts, inspect a released tag matching the installed app. A
development README or beta API does not establish stable-version support.
Provide an in-page alternative when a required menu API is unavailable.

## Dependency and release checks

- Validate the delivered `.user.js`, not only TypeScript source or an editor copy.
- Distinguish an installable raw URL from an HTML source-view URL.
- Exercise `@require` resolution locally and as distributed. Local substitution
  can hide a missing, cached, or obsolete published dependency.
- A shared helper edit does not automatically raise consumer versions. Update
  relevant consumer/dependency revisions as part of a release.
- Follow repo version conventions; SemVer is a useful default, not a universal
  manager parser specification.

## Official references

- [Tampermonkey documentation](https://www.tampermonkey.net/documentation.php)
- [Violentmonkey metadata](https://violentmonkey.github.io/api/metadata-block/)
- [Violentmonkey GM APIs](https://violentmonkey.github.io/api/gm/)
- [Safari Userscripts released README, v4.8.6](https://github.com/quoid/userscripts/blob/v4.8.6/README.md)

Reviewed 2026-09-09; these are reference points, not a claim of runtime testing.
