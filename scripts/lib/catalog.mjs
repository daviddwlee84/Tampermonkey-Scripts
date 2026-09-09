// README 分類與桌面 ZIP 共用 scripts/catalog.json。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './meta.mjs';

export function loadCatalog(scripts) {
  const groups = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/catalog.json'), 'utf8'));
  const remaining = new Set(scripts.map((script) => script.slug));
  const ids = new Set();
  for (const group of groups) {
    if (
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(group.id) ||
      ids.has(group.id) ||
      !group.title ||
      !group.description ||
      typeof group.default !== 'boolean' ||
      !Array.isArray(group.scripts)
    ) {
      throw new Error(`Invalid catalog category: ${group.id}`);
    }
    ids.add(group.id);
    for (const slug of group.scripts) {
      if (!remaining.delete(slug)) throw new Error(`Unknown or duplicate catalog script: ${slug}`);
    }
  }
  if (remaining.size)
    throw new Error(`Add scripts to scripts/catalog.json: ${[...remaining].join(', ')}`);
  return groups;
}
