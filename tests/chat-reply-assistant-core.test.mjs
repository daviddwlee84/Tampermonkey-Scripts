import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../userscripts/chat-reply-assistant/chat-reply-assistant.user.js', import.meta.url),
  'utf8'
);
const core = source.split('// BEGIN CORE')[1].split('// END CORE')[0];
const context = vm.createContext({ URL });
vm.runInContext(
  `${core}\nglobalThis.api = {validateEndpoint, mergeTimeline, buildContext, parseReplies, parseJev, jevQuestions};`,
  context
);
const api = context.api;
const adapterSource = source.match(/\/\/\s*BEGIN ADAPTERS\b([\s\S]*?)\/\/\s*END ADAPTERS\b/)?.[1];
assert.ok(adapterSource, 'the delivered userscript must include its Meta adapter');
const parseRoute = vm.runInContext(`${adapterSource}\ncreateMetaAdapter().route`, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const message = (id, text, direction = 'other') => ({
  id,
  senderId: 'alice',
  sender: 'Alice',
  direction,
  text,
  time: '',
  kind: 'text',
});

test('Instagram／Messenger／Facebook 路由 ID 保持字串並隔離來源', () => {
  const instagram = parseRoute(
    'https://www.instagram.com/direct/t/9007199254740993123/?tracking=1#x'
  );
  assert.equal(instagram.id, '9007199254740993123');
  assert.equal(
    instagram.key,
    parseRoute('https://www.instagram.com/direct/t/9007199254740993123/').key
  );
  const messenger = parseRoute('https://www.messenger.com/t/123');
  assert.equal(messenger.key, parseRoute('https://www.messenger.com/e2ee/t/123').key);
  const facebook = parseRoute('https://www.facebook.com/messages/t/123');
  assert.equal(facebook.key, parseRoute('https://www.facebook.com/messages/e2ee/t/123').key);
  assert.notEqual(messenger.key, facebook.key);
  for (const url of [
    'https://www.instagram.com/direct/inbox/',
    'https://www.facebook.com/',
    'https://evil.example/direct/t/1/',
    'https://www.instagram.com/direct/t/a%2Fb/',
  ])
    assert.equal(parseRoute(url), null);
});

test('合併向上載入的訊息且不誤觸發新訊息', () => {
  const first = api.mergeTimeline([], [message('2', '中間'), message('3', '最新')]);
  const next = api.mergeTimeline(
    first.messages,
    [message('1', '較舊'), message('2', '中間')],
    first.serial
  );
  assert.deepEqual(plain(next.messages.map((m) => m.id)), ['1', '2', '3']);
  assert.equal(next.appended.length, 0);
  assert.equal(next.ambiguous, false);
});

test('重複短訊保留 occurrence，無 ID 的模糊重疊不自動生成', () => {
  const first = api.mergeTimeline([], [message(null, '好')]);
  const next = api.mergeTimeline(
    first.messages,
    [message(null, '好'), message(null, '好')],
    first.serial
  );
  assert.equal(next.messages.length, 2);
  assert.equal(new Set(next.messages.map((m) => m.uid)).size, 2);
  assert.equal(next.ambiguous, true);
  assert.equal(next.appended.length, 0);
  const again = api.mergeTimeline(
    next.messages,
    [message(null, '好'), message(null, '好')],
    next.serial
  );
  assert.equal(again.messages.length, 2);
});

test('同文但不同 ID 的兩筆訊息可辨識為新訊息', () => {
  const first = api.mergeTimeline([], [message('1', '好')]);
  const next = api.mergeTimeline(
    first.messages,
    [message('1', '好'), message('2', '好')],
    first.serial
  );
  assert.equal(next.messages.length, 2);
  assert.deepEqual(plain(next.appended.map((m) => m.id)), ['2']);
});

test('同一 ID 更新內容且保留本機 uid', () => {
  const first = api.mergeTimeline([], [message('1', '初稿')]);
  const next = api.mergeTimeline(first.messages, [message('1', '修改')], first.serial);
  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].text, '修改');
  assert.equal(next.messages[0].uid, first.messages[0].uid);
  assert.equal(next.appended.length, 0);
});

test('沒有重疊的區段不能推定先後順序', () => {
  const first = api.mergeTimeline([], [message('1', '一')]);
  const next = api.mergeTimeline(first.messages, [message('9', '另一段')], first.serial);
  assert.equal(next.ambiguous, true);
  assert.equal(next.appended.length, 0);
});

test('記憶與輸出上限保留較近的訊息並標示截斷', () => {
  const all = Array.from({ length: 505 }, (_, i) => message(String(i), '內容'.repeat(10)));
  const merged = api.mergeTimeline([], all);
  assert.equal(merged.messages.length, 500);
  const bounded = api.buildContext(merged.messages, 50, 500);
  assert.ok(bounded.text.length <= 500);
  assert.ok(bounded.count < 50);
  assert.equal(bounded.truncated, true);
  assert.match(bounded.text, /Alice/);
});

test('完整 endpoint 保留路徑且拒絕遠端明文／URL 帳密', () => {
  assert.equal(
    api.validateEndpoint('http://localhost:4000/chat/completions'),
    'http://localhost:4000/chat/completions'
  );
  assert.equal(
    api.validateEndpoint('https://example.com/custom/v2/chat/completions'),
    'https://example.com/custom/v2/chat/completions'
  );
  for (const url of [
    'javascript:alert(1)',
    'http://example.com/v1/chat/completions',
    'https://key:secret@example.com/api',
    '/chat/completions',
  ])
    assert.throws(() => api.validateEndpoint(url));
});

test('輸出只接受三個非空、不同的字串，允許 JSON fence', () => {
  assert.deepEqual(plain(api.parseReplies('```json\n{"replies":["甲","乙","丙"]}\n```')), [
    '甲',
    '乙',
    '丙',
  ]);
  for (const body of [
    'oops',
    '{"replies":["甲","甲","丙"]}',
    '{"replies":["甲"," ","丙"]}',
    '{"replies":[{"text":"甲"},"乙","丙"]}',
    '{"replies":["甲"]}',
  ])
    assert.throws(() => api.parseReplies(body));
});

test('單一回覆策略只接受一個非空白字串，不悄悄取三候選的第一個', () => {
  assert.deepEqual(plain(api.parseReplies('{"replies":["單一回覆"]}', 1)), ['單一回覆']);
  assert.throws(() => api.parseReplies('{"replies":["一","二","三"]}', 1));
  assert.throws(() => api.parseReplies('{"replies":[""]}', 1));
});

test('Jev 只接受預先定義型別與分類，不把 confidence 當情緒事實', () => {
  const response = {
    answers: {
      tone: { type: 'choice', choice: 'anxious', confidence: 0.9 },
      intent: { type: 'choice', choice: 'question' },
      needsGentleResponse: { type: 'noul', noul: 0.6 },
    },
  };
  const parsed = api.parseJev(response);
  assert.equal(parsed.tone, 'anxious');
  assert.equal(parsed.needsGentleResponse, 0.6);
  assert.equal('confidence' in parsed, false);
  assert.throws(() =>
    api.parseJev({
      answers: { ...response.answers, tone: { type: 'choice', choice: '__proto__' } },
    })
  );
  assert.throws(() =>
    api.parseJev({
      answers: { ...response.answers, needsGentleResponse: { type: 'noul', noul: 2 } },
    })
  );
});
