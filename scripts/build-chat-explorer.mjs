#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function buildChatExplorer(output = resolve(ROOT, 'dist/conversation-explorer.html')) {
  const manifest = JSON.parse(
    await readFile(resolve(ROOT, 'shared/vendor/conversation-explorer-dependencies.json'), 'utf8')
  );
  for (const dependency of Object.values(manifest)) {
    const bytes = await readFile(resolve(ROOT, 'shared/vendor', dependency.file));
    if (createHash('sha256').update(bytes).digest('hex') !== dependency.sha256)
      throw new Error(`Vendor checksum mismatch: ${dependency.file}`);
  }
  const source = resolve(ROOT, 'playgrounds/chat-explorer/index.html');
  let html = await readFile(source, 'utf8');
  for (const [tag, path] of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]) {
    const file = resolve(dirname(source), path);
    if (!file.startsWith(resolve(ROOT, 'shared') + '/'))
      throw new Error('Unexpected explorer dependency');
    const code = (await readFile(file, 'utf8'))
      .replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '')
      .replace(/<\/script/gi, '<\\/script');
    html = html.replace(tag, () => `<script>\n${code}\n</script>`);
  }
  const licenses = await Promise.all(
    Object.keys(manifest).map(
      async (name) =>
        `${name}\n${await readFile(resolve(ROOT, 'shared/vendor', `${name}-LICENSE`), 'utf8')}`
    )
  );
  const licenseText = licenses
    .join('\n\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // A vendored parser may contain the literal </body> inside its JavaScript.
  // Insert at the document's final closing tag, never inside embedded source.
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error('Offline template is missing its closing body');
  html =
    html.slice(0, bodyEnd) +
    `<template id="third-party-licenses"><pre>${licenseText}</pre></template>\n` +
    html.slice(bodyEnd);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await buildChatExplorer());
}
