#!/usr/bin/env node
// Scaffold userscripts/<slug>/<slug>.user.js + README.md from the template.
// Usage: npm run new -- <slug> "<Name>" "<@match>" ["<description>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { USERSCRIPTS_DIR, rawUrlFor } from './lib/meta.mjs';
import { iconFor } from './lib/icon.mjs';

const [slug, name, match, description] = process.argv.slice(2);

if (!slug || !name || !match) {
  console.error('Usage: npm run new -- <slug> "<Name>" "<@match>" ["<description>"]');
  console.error('  e.g. npm run new -- github-pr-tools "GitHub PR Tools" "https://github.com/*"');
  process.exit(1);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error(`Invalid slug "${slug}" — use lowercase kebab-case, e.g. chatgpt-export.`);
  process.exit(1);
}

const dir = join(USERSCRIPTS_DIR, slug);
if (existsSync(dir)) {
  console.error(`userscripts/${slug}/ already exists.`);
  process.exit(1);
}

const desc = description || `TODO: 一句話說明 ${name} 做什麼`;
const template = readFileSync(join(USERSCRIPTS_DIR, '_template', 'template.user.js'), 'utf8');
const script = template
  .replaceAll('{{NAME}}', name)
  .replaceAll('{{SLUG}}', slug)
  .replaceAll('{{DESCRIPTION}}', desc)
  .replaceAll('{{MATCH}}', match)
  .replaceAll('{{ICON}}', iconFor(slug));

const readme = `# ${name}

${desc}

- **生效網站**：\`${match}\`
- **安裝**：[點這裡安裝](${rawUrlFor(slug)})（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[\`${slug}.user.js\`](./${slug}.user.js)

## 它做了什麼

TODO

## 使用方式

TODO

## 已知限制

TODO
`;

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${slug}.user.js`), script);
writeFileSync(join(dir, 'README.md'), readme);

console.log(`Created userscripts/${slug}/`);
console.log('Next: 實作腳本 → npm run check → npm run index');
