#!/usr/bin/env node
// Validate every userscript's metadata block: required keys, semver-ish
// @version, canonical @updateURL/@downloadURL, and @grant vs. actual GM_* usage.
import { listUserscripts, first, rawUrlFor, stripCommentsAndStrings } from './lib/meta.mjs';

const REQUIRED = ['name', 'namespace', 'version', 'description', 'author', 'grant'];
const KNOWN_GM = /\bGM[._]([A-Za-z]\w*)/g;

const errors = [];
const warnings = [];

const scripts = listUserscripts();
if (scripts.length === 0) {
  console.log('No userscripts found under userscripts/ — nothing to check.');
  process.exit(0);
}

for (const s of scripts) {
  const at = (msg) => `${s.relPath}: ${msg}`;

  if (s.missing) {
    errors.push(at(`expected userscripts/${s.slug}/${s.slug}.user.js (filename must match folder)`));
    continue;
  }
  if (!s.meta) {
    errors.push(at('missing a // ==UserScript== ... // ==/UserScript== metadata block'));
    continue;
  }
  if (!s.hasReadme) warnings.push(at('no README.md next to the script'));

  for (const key of REQUIRED) {
    if (!first(s.meta, key)) errors.push(at(`missing @${key}`));
  }

  if (!s.meta.match && !s.meta.include) {
    errors.push(at('needs at least one @match (preferred) or @include'));
  }

  const version = first(s.meta, 'version');
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    warnings.push(at(`@version "${version}" is not X.Y.Z — Tampermonkey compares versions to decide updates`));
  }

  const expected = rawUrlFor(s.slug);
  for (const key of ['updateURL', 'downloadURL']) {
    const actual = first(s.meta, key);
    if (!actual) {
      errors.push(at(`missing @${key} (auto-update will not work) — expected ${expected}`));
    } else if (actual !== expected) {
      errors.push(at(`@${key} is "${actual}" but should be "${expected}"`));
    }
  }

  // GM API usage must be declared in @grant (unless @grant none is intentional).
  const grants = new Set(s.meta.grant ?? []);
  const body = stripCommentsAndStrings(s.source.slice(s.source.indexOf('==/UserScript==')));
  const used = new Set();
  for (const [full] of body.matchAll(KNOWN_GM)) {
    if (full === 'GM.info' || full === 'GM_info') continue;
    used.add(full.replace('GM.', 'GM_'));
  }
  for (const api of used) {
    const dotted = api.replace('GM_', 'GM.');
    if (!grants.has(api) && !grants.has(dotted)) {
      errors.push(at(`uses ${api} but does not declare "// @grant ${api}"`));
    }
  }
  if (grants.has('none') && used.size > 0) {
    errors.push(at(`declares "@grant none" but uses ${[...used].join(', ')}`));
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

console.log(
  `\nChecked ${scripts.length} userscript(s): ${errors.length} error(s), ${warnings.length} warning(s).`
);
process.exit(errors.length > 0 ? 1 : 0);
