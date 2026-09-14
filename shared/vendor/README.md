# Conversation explorer dependencies

These are unmodified browser distributions from the official npm packages:

| Package | Version | Browser file | License |
| --- | --- | --- | --- |
| [Marked](https://marked.js.org/) | 18.0.13 | `marked-18.0.13.umd.js` | `marked-LICENSE` |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.15 | `dompurify-3.4.15.min.js` | `dompurify-LICENSE` |

`conversation-explorer-dependencies.json` records each tarball URL, verified npm SHA-512 integrity
and extracted browser file SHA-256. `build:chat-explorer` checks these files before embedding them,
removes source-map comments from the standalone output and includes the full license texts.
Vendor bytes are excluded from Prettier to preserve the recorded checksums.

To update, verify the official npm tarball integrity, replace the versioned browser file and license,
update the manifest, and update both the userscript `@require` URL and offline HTML script reference.
Run the archive, browser and offline tests before distributing the new dependency revision.
