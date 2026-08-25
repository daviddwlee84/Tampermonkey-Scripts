// Zero-dependency helpers for reading the repo's userscripts and their
// `// ==UserScript== ... // ==/UserScript==` metadata blocks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USERSCRIPTS_DIR = join(REPO_ROOT, 'userscripts');

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));

/** e.g. https://github.com/daviddwlee84/Tampermonkey-Scripts */
export const REPO_URL = pkg.repository.url.replace(/\.git$/, '');
export const BRANCH = 'main';
/** Base for @updateURL / @downloadURL. */
export const RAW_BASE = REPO_URL.replace(
  'https://github.com/',
  'https://raw.githubusercontent.com/'
)
  .concat('/', BRANCH);

const META_START = '// ==UserScript==';
const META_END = '// ==/UserScript==';

/**
 * Parse a metadata block into { key: [values...] }. Keys can repeat
 * (@match, @grant, @require ...), so every value is stored in an array.
 */
export function parseMeta(source) {
  const start = source.indexOf(META_START);
  const end = source.indexOf(META_END);
  if (start === -1 || end === -1 || end < start) return null;

  const meta = {};
  const body = source.slice(start + META_START.length, end);
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*\/\/\s*@([\w:-]+)\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    (meta[key] ??= []).push(rawValue.trim());
  }
  return meta;
}

/** First value of a metadata key, or '' when absent. */
export function first(meta, key) {
  return meta?.[key]?.[0] ?? '';
}

/**
 * Every userscript in the repo, as
 * { slug, file, relPath, source, meta, readme }.
 * Convention: userscripts/<slug>/<slug>.user.js
 * Directories starting with `_` (e.g. _template) are skipped.
 */
export function listUserscripts() {
  let entries;
  try {
    entries = readdirSync(USERSCRIPTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
    .flatMap((slug) => {
      const dir = join(USERSCRIPTS_DIR, slug);
      const file = join(dir, `${slug}.user.js`);
      try {
        statSync(file);
      } catch {
        return [{ slug, dir, file, relPath: `userscripts/${slug}/${slug}.user.js`, missing: true }];
      }
      const source = readFileSync(file, 'utf8');
      return [
        {
          slug,
          dir,
          file,
          relPath: `userscripts/${slug}/${slug}.user.js`,
          source,
          meta: parseMeta(source),
          hasReadme: readdirSync(dir).includes('README.md'),
        },
      ];
    });
}

/** Canonical raw URL used for @updateURL / @downloadURL and install links. */
export function rawUrlFor(slug) {
  return `${RAW_BASE}/userscripts/${slug}/${slug}.user.js`;
}

/**
 * Blank out comments and string literals so lint passes can scan real code
 * without tripping over prose. Regex literals are not tracked — a regex
 * containing a quote character can confuse it, which is acceptable for a
 * best-effort repo lint.
 */
export function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
