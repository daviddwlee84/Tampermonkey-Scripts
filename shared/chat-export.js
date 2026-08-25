/* eslint-env browser */
/**
 * 對話匯出的共用轉換層，給 chatgpt / claude / copilot 三支 exporter 用 `@require` 引入：
 *
 *   // @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/chat-export.js
 *
 * 這不是 ES module —— `@require` 進來的檔案會直接在腳本的 scope 執行，
 * 所以這裡用的是全域函式宣告。
 *
 * 這一層只做「正規化過的 doc → Markdown」：不碰 DOM、不呼叫任何 GM API。
 * 各站專屬的「怎麼拿到對話 JSON」與「欄位怎麼對應」留在各自的腳本裡。
 *
 * doc 的形狀（各腳本的 adapter 負責產出，這是三支腳本之間唯一的介面）：
 *
 *   {
 *     source: 'chatgpt',            // frontmatter 的 source，也用在檔名前綴
 *     sourceLabel: 'ChatGPT',       // 給人看的名字（Agent Handoff 的抬頭用）
 *     title: '…',
 *     url: 'https://…',
 *     ids: { conversation_id: '…', share_id: '…' },  // 有什麼寫什麼，原樣進 frontmatter
 *     model: '',                    // 沒有就空字串
 *     createdAt: 1756100000 | '2026-08-23T12:34:14Z',
 *     sections: [{ role, model, time, body }],
 *   }
 */

/** fence 要比內文裡最長的一串 backtick 還長，否則 code block 會被自己的內容截斷。 */
function fence(body, lang = '') {
  const text = String(body ?? '');
  const longest = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text.replace(/\n$/, '')}\n${ticks}`;
}

/** 任何東西包成 JSON code block。未知型態一律走這裡，不要靜默丟掉。 */
function jsonFence(value) {
  try {
    return fence(JSON.stringify(value, null, 2), 'json');
  } catch {
    return fence(String(value), 'text');
  }
}

function pad(n) {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

/** epoch 秒 / epoch 毫秒 / ISO 字串都吃，認不得就回 null。 */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // ChatGPT 給的是 epoch 秒（小數），其他兩家給 ISO 字串。
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 對齊 .specstory/history/ 的寫法：UTC 的 `YYYY-MM-DD HH:mm:ssZ`。 */
function formatUtc(value) {
  const d = toDate(value);
  if (!d) return '';
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/** 本地時區的 ISO（給 exported_at 用）。 */
function localIso(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** JSON 字串剛好是合法的 YAML double-quoted scalar，拿來當跳脫最省事。 */
function yaml(value) {
  return JSON.stringify(String(value ?? ''));
}

/**
 * 連續同 role 的訊息要合併成一段。一輪 assistant 常被拆成
 * 「開場白 → 搜尋 → 正文」好幾則，不合併的話 transcript 會出現一堆只有一行的區塊。
 */
function mergeSections(sections) {
  const merged = [];
  for (const section of sections) {
    const body = String(section.body ?? '').trim();
    if (!body) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.role === section.role) {
      previous.body += `\n\n${body}`;
      if (!previous.model) previous.model = section.model || '';
      continue;
    }
    merged.push({
      role: section.role,
      model: section.model || '',
      time: section.time,
      body,
    });
  }
  return merged;
}

/** 去重後的來源清單。Claude / Copilot 的 citation 都是「有 url 有 title」的物件。 */
function sourcesBlock(citations) {
  const seen = new Set();
  const lines = [];
  for (const citation of citations || []) {
    const url = citation?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    lines.push(`- [${citation.title || url}](${url})`);
  }
  return lines.length ? `**Sources**\n\n${lines.join('\n')}` : '';
}

function handoffHeader(label) {
  return [
    `# Prior ${label} Context`,
    '',
    `The following is a prior discussion between the user and ${label}.`,
    '',
    '## Instructions for the coding agent',
    '',
    '- Treat established decisions as existing project decisions.',
    '- Do not reopen settled design questions unless implementation reveals a conflict.',
    "- Preserve the user's stated constraints.",
    '- Consult the original conversation below when necessary.',
    '',
    '---',
    '',
    '## Conversation',
  ].join('\n');
}

/**
 * 正規化的 doc → SpecStory 風格的 Markdown。
 * opts: { handoff, includeThinking, includeTools, exporter }
 */
function renderTranscript(doc, opts = {}) {
  const sections = mergeSections(doc.sections || []);
  if (sections.length === 0) throw new Error('這個對話沒有可匯出的訊息。');

  const title = doc.title || `${doc.sourceLabel || doc.source} conversation`;
  const idLines = Object.entries(doc.ids || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${yaml(value)}`);

  const frontMatter = [
    '---',
    `source: ${doc.source}`,
    `title: ${yaml(title)}`,
    `url: ${yaml(doc.url)}`,
    ...idLines,
    `model: ${yaml(doc.model || '')}`,
    `created_at: ${yaml(formatUtc(doc.createdAt))}`,
    `exported_at: ${yaml(localIso())}`,
    `messages: ${sections.length}`,
    `include_thinking: ${opts.includeThinking === true}`,
    `include_tools: ${opts.includeTools === true}`,
    `exporter: ${yaml(opts.exporter || '')}`,
    '---',
  ].join('\n');

  const body = sections
    .map((section) => {
      const label = [section.model, formatUtc(section.time)].filter(Boolean).join(', ');
      return `_**${section.role}${label ? ` (${label})` : ''}**_\n\n${section.body}`;
    })
    .join('\n\n---\n\n');

  const heading = opts.handoff ? handoffHeader(doc.sourceLabel || doc.source) : `# ${title}`;

  return `${frontMatter}\n\n${heading}\n\n<!-- Generated by ${opts.exporter} -->\n\n${body}\n`;
}

/** `<source>-<標題>-<YYYYMMDD-HHmm>.<ext>`，檔名不合法的字元一律拿掉。 */
function filenameFor(doc, extension) {
  const slug =
    String(doc.title || 'conversation')
      .replace(/[\\/:*?"<>|]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'conversation';
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${doc.source}-${slug}-${stamp}.${extension}`;
}

/** 不需要任何 @grant 的檔案下載（同 shared/dom.js 的 downloadText）。 */
function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
