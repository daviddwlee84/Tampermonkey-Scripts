# v1.5.1 validation — 2026-10-12

## Fixes

| Symptom (v1.5.0)                                  | Cause                                                                                                                                           | Fix                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 失敗：ZipStore is not defined                     | The manager ran the script without the new `@require` (`shared/zip-store.js`); its first fetch happened before the file was reachable on GitHub | Version bump makes the manager fetch every `@require` again; the ZIP action now reports the missing dependency instead of throwing |
| Share page: 0/2 images, `files/download HTTP 403` | Share pointers are `sediment://file_…?shared_conversation_id=…`; the query became part of the file id (`{"error": "Invalid URL"}`)              | `imageAssets` splits the pointer into `fileId` + `params`; `fetchAsset` forwards the params                                        |
| Signed URL fetch: `Failed to fetch`               | `download_url` is on `*.oaiusercontent.com` with `Access-Control-Allow-Origin: *`; `credentials: 'include'` is rejected by CORS                 | Cross-origin signed URLs are fetched with `credentials: 'omit'`                                                                    |

## Checks

| Layer                                                   | Result    | Coverage                                                                                                                                              |
| ------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:chatgpt-export`                           | 30 passed | Adds a share pointer and a cross-origin `ACAO: *` signed URL to the ZIP action test; reverting the `credentials` fix fails it in Chromium and Firefox |
| `npm run test:chat-explorer`                            | 33 passed | Unchanged                                                                                                                                             |
| Real share page (`npm run preview`, Chromium, no login) | Passed    | `已下載 ZIP（2/2 張圖片；來源：router-state）` on a public share of the Intelligent UI conversation                                                   |

Still not verified: logged-in `/c/` pages in a real manager (the `conversation_id` path), and image-generation output.

## Automated checks

| Layer                            | Result    | Coverage                                                                                                                                                                                                                |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:chatgpt-export`    | 30 passed | Previous cases, plus Intelligent UI fallback and sentinels, code-block widgets, image asset listing, ZIP structure/CRC, and ZIP action with one failed image (Chromium 151 + Firefox 153 GM shim)                       |
| `npm run test:chat-explorer`     | 33 passed | Previous cases, plus archive blocks built from `fallbackMarkdown` while `raw` keeps the DIL payload                                                                                                                     |
| Full source payload              | Passed    | Rendering the unminimized 2026-10-12 conversation JSON restores all 5 code fences (`jsx`, `bash` ×2, `json`, `text`) that v1.4.0 dropped; 0 DIL tags outside code, 0 private-use characters, 22 resolved citation links |
| ZIP readers                      | Passed    | `bsdtar`, `ditto -x -k`, Python `zipfile` and `unzip -t` accept a CJK-named archive. Info-ZIP's listing renders the UTF-8 name incorrectly, but extraction by name works                                                |
| `npm run preview` on chatgpt.com | Passed    | Workspace `@require` (incl. `shared/zip-store.js`) loads and the new menu is registered; without a session it reports 「抓不到對話資料」 instead of throwing                                                            |

## Not yet verified

- `/backend-api/files/download/<id>` response shape and whether `download_url` is same-origin
  were tested only against mocked endpoints. They need a logged-in session in a real manager.
- Image-generation output (tool messages) has no sample payload.

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
