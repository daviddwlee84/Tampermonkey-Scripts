# v1.4.0 validation — 2026-09-14

## Automated checks

| Layer                                | Result    | Coverage                                                                                                                                        |
| ------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:chatgpt-export`        | 24 passed | Existing quick exports, report snapshots, missing IDs, citations and raw JSON failures                                                          |
| `npm run test:chat-explorer`         | 32 passed | Archive v1, path selection, nested forks, late snapshots, orphan/cycle validation, mode isolation, UI and offline behavior                      |
| Chromium 151.0.7922.34 + GM shim     | Passed    | Import, single/range/path selection, exact preview/download agreement, full archive, fresh snapshots, URL-only navigation, mobile and dark mode |
| Firefox 153.0 + GM shim              | Passed    | Same scenarios, including `file://` and denied clipboard fallback                                                                               |
| 5,000-node fixture                   | Passed    | Full selected export, at most 100 tree rows and 60 initial reading cards; End/Enter reaches the final message                                   |
| Offline HTML                         | Passed    | No HTTP(S) requests during import/preview; HTML injection blocked; empty saved selection restored; invalid import retains the current archive   |
| `npm run build:chat-explorer`        | Passed    | Vendored checksums, inline scripts/styles and third-party license text                                                                          |
| Syntax / Prettier / `npm run verify` | Passed    | Script metadata, dependency files and generated index; existing unrelated dependency warnings remain                                            |

Desktop, narrow viewport and dark-mode screenshots were inspected in
`.preview/conversation-explorer-tests/`. The Markdown frontmatter is collapsed as export file
information, and branch references use visible M-number labels on exported messages.

## Real manager

Violentmonkey **2.49.0**, Manifest V3, Chromium **151.0.7922.34**:

- Installed through the manager's **Import from zip** UI in a fresh isolated profile.
- Used the existing official unpacked release artifact; source:
  `https://github.com/violentmonkey/violentmonkey/releases/download/v2.49.0/Violentmonkey-mv3-v2.49.0.zip`.
- Test copy changed only `@match` and `@require` URLs to a loopback HTTP fixture. No GM shim,
  direct script injection or private extension-storage writes were used.
- Verified actual dependency loading, `unsafeWindow` data access and the new explorer.
- Selecting only the second report downloaded one message. After closing the explorer, the original
  Download .md action still downloaded all four messages.
- Local evidence: `.preview/conversation-explorer-manager/report.json`, selected/full Markdown and screenshot.

Actual Tampermonkey, Firefox manager injection, Safari/iPad and native system clipboard delivery
were not verified in this change. GM shim success does not establish those capabilities.

## Named live sample

[PRL shared conversation](https://chatgpt.com/share/6aa7981a-5b34-83ee-b1cc-1b0b3fc0b91b),
opened in Chromium with explicit GM shims and the worktree dependencies:

- Explorer loaded from actual router state and initially selected four messages.
- Selecting only the second research report copied one message, without the first report or prompts.
- Closing the explorer and using the original Copy Markdown action restored the full four-message
  export, including the first report's 58 citation links.
- Converted the supplied source snapshot to archive v1 and verified a lossless graph/selection round trip.
- Local evidence and reusable example: `.preview/conversation-explorer-live/`.

Live authenticated `/c/` access remains unverified; its API and capture behavior are covered by
fixtures and the local real-manager smoke. A share snapshot can only expose branches included by
the source; neither this test nor the exporter reconstructs absent versions.
