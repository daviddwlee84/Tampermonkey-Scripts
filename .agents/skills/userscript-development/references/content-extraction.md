# Content extraction and export

Read for Markdown exporters, article readers, selections, or attachment archives.

## Define the extraction contract first

State whether output covers selected content, currently loaded DOM, or a complete
document/history. Virtualized lists, pagination, collapsed regions and a late
capture can yield only partial content. Label fallback output accordingly.
Do not promote a partial cache merely because it contains some valid records.

Keep adapters for changing site selectors/data shapes separate from generic
conversion, clipboard/download delivery, and UI. Invalidate cached content on
route identity changes; don't reuse data from another article/conversation.

## Extract → snapshot → render

1. Capture source metadata and route identity before opening the reader.
2. Clone the source DOM. Preserve selected image URLs (`currentSrc`, applicable
   lazy-loading attributes) and resolve relative links against the source base
   while that context is still available.
3. Clean the clone: remove owned panels, menus, hints and known injected noise.
   Handle translation wrappers explicitly; do not delete the only surviving
   original text just because an extension hides it.
4. Extract semantic content. If a readability algorithm loses code blocks or
   structured documentation, use a checked semantic container or user selection.
5. Sanitize HTML before displaying it. Convert the preserved source snapshot to
   Markdown; don't re-extract from the reader after another extension translates
   or mutates it.
6. Preserve tables, code languages/fences, lists and links. Inspect the resulting
   text/file, not just the UI screenshot.

A useful regression inserts an unmistakable sentinel into owned UI and a
translation wrapper, then asserts it is absent from exported Markdown. Also
assert the source page's HTML/scroll/overflow survive opening and closing a reader.

## Downloads and partial failure

- Keep Markdown-only and attachment-archive operations separate: the former
  need not initiate every image/document request.
- Bound concurrency, per-file/total size, timeout, and cancellation. Report
  per-item failure without discarding successful content.
- Check response status, content type and recognizable error/login responses;
  a `.pdf` path alone does not establish that the downloaded bytes are a PDF.
- Deduplicate resources, sanitize output names and prevent filename collisions.
  Rewrite only successfully saved resources to local relative paths; leave
  failed links remote and report incomplete offline coverage.
- Register Playwright's download listener before clicking. Inspect saved bytes,
  archive members and rewritten links in addition to observing an event.
- A signed URL on another host (CDN/blob storage) usually answers
  `Access-Control-Allow-Origin: *`, which rejects `credentials: 'include'`. Send
  cookies only to same-origin URLs; a fixture should return `ACAO: *` so the
  browser enforces this. Treat query strings on asset pointers as API
  parameters, not as part of the file id.
- Detect binary data with `ArrayBuffer.isView` / `Object.prototype.toString`,
  not `instanceof Uint8Array`: buffers from page `fetch` can come from another
  realm (manager sandbox, iframe, `vm` test context).
- A hand-written ZIP with UTF-8 names needs general-purpose bit 11 and a
  Unix "version made by" host. With an MS-DOS host, Info-ZIP ignores the flag
  and decodes names as an OEM code page. Check with an independent reader:
  parse the central directory and verify the CRCs.

When an exporter replaces placeholders from site metadata (citation refs,
widgets), check that each replacement is readable text. A new ref type with a
`null`/empty `alt` can cover a whole code block. Keep the original text for
unknown or empty replacements, and look at the raw payload's new `metadata`
keys before you change the renderer.

Example evidence shape (adapt to the project):

```json
{
  "scope": "loaded-dom",
  "complete": false,
  "saved": 3,
  "failed": 1,
  "failures": [{ "url": "https://example.com/image.png", "reason": "timeout" }]
}
```

If another page/service receives extracted content, make the destination and
action visible. Preparing content and sending it are separate user actions;
test against a local receiver when verifying the contract.

## Source examples

- Reader snapshot, image handling, archive tests: [provenance](provenance.md).
- General browser fixtures and download assertions: [browser-testing.md](browser-testing.md).
