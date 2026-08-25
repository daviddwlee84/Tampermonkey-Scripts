#!/usr/bin/env node
// Regenerate the script index table in README.md from the metadata blocks.
// `--check` fails instead of writing, so CI can catch a stale README.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, listUserscripts, first, rawUrlFor } from './lib/meta.mjs';

const BEGIN = '<!-- BEGIN SCRIPT INDEX -->';
const END = '<!-- END SCRIPT INDEX -->';
const README = join(REPO_ROOT, 'README.md');

const escapePipes = (s) => s.replace(/\|/g, '\\|');

function renderTable(scripts) {
  if (scripts.length === 0) {
    return '_目前還沒有 userscript。用 `npm run new -- <slug> "<Name>"` 建立第一個。_';
  }
  const rows = scripts.map((s) => {
    const name = first(s.meta, 'name') || s.slug;
    const desc = first(s.meta, 'description') || '';
    const version = first(s.meta, 'version') || '?';
    const sites = (s.meta?.match ?? s.meta?.include ?? [])
      .map((m) => `\`${escapePipes(m)}\``)
      .join('<br>');
    return `| [${escapePipes(name)}](userscripts/${s.slug}/) | ${escapePipes(desc)} | ${sites} | ${version} | [Install](${rawUrlFor(s.slug)}) |`;
  });
  return [
    '| Script | 用途 | 生效網站 | Version | 安裝 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

const scripts = listUserscripts().filter((s) => !s.missing && s.meta);
const table = renderTable(scripts);

const readme = readFileSync(README, 'utf8');
const start = readme.indexOf(BEGIN);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`README.md is missing the ${BEGIN} / ${END} markers.`);
  process.exit(1);
}

const next = `${readme.slice(0, start + BEGIN.length)}\n\n${table}\n\n${readme.slice(end)}`;

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md script index is out of date. Run: npm run index');
    process.exit(1);
  }
  console.log('README.md script index is up to date.');
} else {
  writeFileSync(README, next);
  console.log(`README.md script index updated (${scripts.length} script(s)).`);
}
