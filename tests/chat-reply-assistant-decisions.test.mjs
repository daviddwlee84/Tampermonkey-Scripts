import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../userscripts/chat-reply-assistant/chat-reply-assistant.user.js', import.meta.url),
  'utf8'
);
const region = source.match(/\/\/ BEGIN DECISIONS([\s\S]*?)\/\/ END DECISIONS/)?.[1];
assert.ok(region, 'the delivered userscript must include its tested decision helpers');
const context = vm.createContext({ TextEncoder });
vm.runInContext(
  `${region}\nglobalThis.api = {deriveTargetTurn, buildContextDecision, parseContextDecision, replyDecisionBody, parseReplyDecision, decisionTranscript};`,
  context
);
const api = context.api;
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (messages) => Array.from(messages, (message) => message.uid);
const message = (uid, text, direction = 'other', extra = {}) => ({
  uid,
  id: `dom-${uid}`,
  sender: direction === 'self' ? 'You' : 'Alice',
  senderId: direction === 'self' ? 'self' : 'alice',
  direction,
  text,
  time: '',
  kind: 'text',
  attachments: [],
  ...extra,
});
const history = () => [
  message('old-a', '較早的具體事實'),
  message('old-self', '上一次回答', 'self'),
  message('old-b', '後來修正的事實'),
  message('self', '我剛問的問題', 'self'),
  message('latest', '對方最新答覆'),
];
const planFor = (messages, options = {}) =>
  api.buildContextDecision({ messages, model: 'jev-fixture', ...options });
const scored = (plan, scores = {}) => ({
  answers: Object.fromEntries(
    plan.candidates.map((message) => [
      message.uid,
      { type: 'noul', noul: scores[message.uid] ?? 0 },
    ])
  ),
});
const REPLIES = ['候選一', '候選二', '候選三'];
function ranked({ winner = 'reply_2', probability = 0.85, relevant = 0.95, factual = 0.96 } = {}) {
  const others = (1 - probability) / 3;
  const answers = {
    bestReply: {
      type: 'choice',
      choice: winner,
      probabilities: Object.fromEntries(
        ['reply_1', 'reply_2', 'reply_3', 'none'].map((id) => [
          id,
          id === winner ? probability : others,
        ])
      ),
      confidence: 0.01,
    },
  };
  for (let index = 1; index <= 3; index++) {
    const id = `reply_${index}`;
    answers[`${id}_relevant`] = { type: 'noul', noul: id === winner ? relevant : 0.9 };
    answers[`${id}_factual`] = { type: 'noul', noul: id === winner ? factual : 0.9 };
  }
  return { answers };
}

test('最新一輪保留連續群組來訊、前一輪本人訊息，略過系統事件', () => {
  const rows = [
    message('older', '較舊來訊'),
    message('self-1', '我的第一段', 'self'),
    message('self-2', '我的補充', 'self'),
    message('alice', 'Alice 回覆'),
    message('bob', 'Bob 補充', 'other', { sender: 'Bob', senderId: 'bob' }),
    message('event', '已讀', 'unknown', { kind: 'system' }),
  ];
  const before = JSON.stringify(rows);
  const turn = api.deriveTargetTurn(rows);
  assert.deepEqual(plain(ids(turn.messages)), ['alice', 'bob']);
  assert.deepEqual(plain(ids(turn.previousSelfTurn)), ['self-1', 'self-2']);
  assert.equal(turn.key, JSON.stringify(['alice', 'bob']));
  assert.equal(JSON.stringify(rows), before);
  assert.equal(api.deriveTargetTurn([...rows, message('mine', '我已回覆', 'self')]), null);
  assert.equal(api.deriveTargetTurn([...rows, message('unknown', '未知發話者', 'unknown')]), null);
  assert.equal(api.deriveTargetTurn([]), null);
  assert.deepEqual(
    plain(ids(api.deriveTargetTurn([message('first', '第一句')]).previousSelfTurn)),
    []
  );
});

test('送給 Jev 的 state 只含文字、已知身分與附件存在資訊', () => {
  const rows = history();
  rows[0].text = '使用者真的寫下 https://shared.example/path';
  rows[0].attachments = [
    {
      id: 'PRIVATE_ATTACHMENT_ID',
      kind: 'image',
      url: 'https://media.example/UNSENT_ATTACHMENT_URL?key=SECRET',
      alt: 'UNSENT_ATTACHMENT_ALT',
      selected: true,
      data: 'data:image/png;base64,UNSENT_BYTES',
    },
  ];
  rows[0].apiKey = 'UNSENT_EXTRA_FIELD';
  const plan = planFor(rows);
  const wire = JSON.stringify(plan.body);
  assert.match(wire, /https:\/\/shared\.example\/path/);
  assert.doesNotMatch(wire, /UNSENT_|PRIVATE_ATTACHMENT_ID/);
  assert.deepEqual(plain(plan.body.state.messages[0].attachments), [
    { kind: 'image', selected: true },
  ]);
  assert.deepEqual(Object.keys(plan.body.questions), ids(plan.candidates));
  for (const [index, candidate] of plan.candidates.entries()) {
    assert.equal(plan.body.questions[candidate.uid].type, 'noul');
    assert.match(
      plan.body.questions[candidate.uid].instructions,
      new RegExp(`messages\\[${index}\\]`)
    );
  }
});

test('人工排除先於序列化，必要目標被排除時拒絕自動覆寫', () => {
  const rows = history();
  rows[0].text = 'EXCLUDED CONTENT MUST NEVER LEAVE';
  const plan = planFor(rows, { excludedUids: ['old-a'], selectedUids: ['old-a', 'old-b'] });
  assert.doesNotMatch(JSON.stringify(plan.body), /EXCLUDED CONTENT|old-a/);
  assert.deepEqual(plain(plan.selectedIds), ['old-b']);
  assert.throws(() => planFor(rows, { excludedUids: ['latest'] }), /手動排除/);
  assert.throws(() => planFor(rows, { excludedUids: ['self'] }), /手動排除/);
  assert.throws(
    () => planFor(rows, { excludedUids: ['old-a'], pinnedUids: ['old-a'] }),
    /手動排除/
  );
});

test('必要集合包含手動釘選、已選圖片與最新輪的已載入引用鏈', () => {
  const rows = [
    message('quoted', '被引用的原文'),
    message('image', '', 'self', {
      kind: 'media',
      attachments: [{ kind: 'image', selected: true }],
    }),
    message('middle', '引用前文', 'other', { replyToId: 'dom-quoted' }),
    message('self', '我的追問', 'self'),
    message('latest', '回答追問', 'other', { replyToId: 'dom-middle' }),
  ];
  const plan = planFor(rows, { selectedImageMessageUids: ['image'], pinnedUids: ['middle'] });
  assert.deepEqual(plain(plan.requiredIds), ['quoted', 'image', 'middle', 'self', 'latest']);
  const selected = api.parseContextDecision(scored(plan), plan);
  assert.deepEqual(plain(ids(selected.messages)), ids(rows));
  assert.equal(selected.scores.latest, 0, '必要訊息不因低分而消失');
  assert.throws(() => planFor(rows, { excludedUids: ['quoted'] }), /手動排除/);
});

test('候選上限與完整請求 byte 上限保留必要訊息且不裁切單則原文', () => {
  const rows = Array.from({ length: 140 }, (_, index) =>
    message(`m${index}`, `完整原文-${index} ${'內容'.repeat(30)}`, index % 2 ? 'other' : 'self')
  );
  const before = JSON.stringify(rows);
  const plan = planFor(rows, { pinnedUids: ['m0'], maxCandidates: 500, maxBytes: 999999 });
  assert.ok(plan.candidates.length <= 100);
  assert.ok(new TextEncoder().encode(JSON.stringify(plan.body)).byteLength <= 28 * 1024);
  for (const id of ['m0', 'm138', 'm139']) assert.ok(plan.requiredIds.includes(id));
  for (const item of plan.body.state.messages)
    assert.equal(item.text, rows.find((message) => message.uid === item.id).text);
  assert.equal(JSON.stringify(rows), before);
  assert.throws(() => planFor(rows, { maxCandidates: 1 }), /必要.*數量上限/);
  assert.throws(() => planFor([message('huge', '字'.repeat(15000))]), /必要.*請求上限/);
});

test('候選子集可補回必要訊息及引用來源，原本 selectedUids 不強迫保留', () => {
  const rows = history();
  rows[2].replyToId = 'dom-old-a';
  const plan = planFor(rows, { candidates: ['old-b'], selectedUids: ['old-self'] });
  assert.deepEqual(plain(ids(plan.candidates)), ['old-a', 'old-b', 'self', 'latest']);
  assert.deepEqual(plain(plan.requiredIds), ['self', 'latest']);
  assert.deepEqual(plain(plan.selectedIds), []);
  const selected = api.parseContextDecision(scored(plan, { 'old-b': 0.95, 'old-a': 0.01 }), plan, {
    maxMessages: 4,
  });
  assert.deepEqual(plain(ids(selected.messages)), ['old-a', 'old-b', 'self', 'latest']);
  const tooSmall = api.parseContextDecision(scored(plan, { 'old-b': 0.95 }), plan, {
    maxMessages: 3,
  });
  assert.deepEqual(
    plain(ids(tooSmall.messages)),
    ['self', 'latest'],
    '不留下缺少已知引用來源的片段'
  );
  const excludedParent = planFor(rows, { excludedUids: ['old-a'] });
  assert.equal(ids(excludedParent.candidates).includes('old-b'), false);
});

test('沒有載入或識別不唯一的引用不被猜測成其他訊息', () => {
  const rows = history();
  rows[0].id = 'duplicated';
  rows[1].id = 'duplicated';
  rows.at(-1).replyToId = 'duplicated';
  const duplicate = planFor(rows);
  assert.deepEqual(plain(duplicate.requiredIds), ['self', 'latest']);
  rows.at(-1).replyToId = 'unloaded-parent';
  const missing = planFor(rows);
  assert.deepEqual(plain(missing.requiredIds), ['self', 'latest']);
  assert.equal(missing.body.state.targetTurn[0].replyTo, undefined);
});

test('失效 target、未知 pinned UID 與重複 UID 不能產生判斷請求', () => {
  const rows = history();
  assert.throws(() => planFor(rows, { targetTurn: { key: 'old', messages: [] } }), /已變更/);
  assert.throws(() => planFor(rows, { pinnedUids: ['missing'] }), /不在分頁記憶/);
  assert.throws(() => planFor(rows, { candidates: ['missing'] }), /未知訊息/);
  assert.throws(() => planFor([...rows, message('latest', '另一則')]), /重複/);
  assert.throws(() => planFor([message('self', '尚未收到回覆', 'self')]), /最新對方訊息/);
});

test('依相關分數選取但輸出仍維持時間順序，同分優先較近訊息', () => {
  const plan = planFor(history());
  const result = api.parseContextDecision(
    scored(plan, { 'old-a': 0.8, 'old-b': 0.9, 'old-self': 0.7 }),
    plan,
    { maxMessages: 3 }
  );
  assert.deepEqual(plain(ids(result.messages)), ['old-b', 'self', 'latest']);
  assert.equal(result.analyzedCount, plan.candidates.length);
  const tied = api.parseContextDecision(scored(plan, { 'old-a': 0.8, 'old-b': 0.8 }), plan, {
    maxMessages: 3,
  });
  assert.deepEqual(plain(ids(tied.messages)), ['old-b', 'self', 'latest']);
  const threshold = api.parseContextDecision(scored(plan, { 'old-a': 0.5, 'old-b': 0.499 }), plan);
  assert.deepEqual(plain(ids(threshold.messages)), ['old-a', 'self', 'latest']);
});

test('字元上限不切割訊息，略過裝不下的高分長文後仍可保留短文', () => {
  const rows = history();
  rows[0].text = '長'.repeat(300);
  rows[2].text = '短';
  const plan = planFor(rows);
  const budget = api.decisionTranscript(
    rows.filter((message) => ['old-b', 'self', 'latest'].includes(message.uid))
  ).length;
  const result = api.parseContextDecision(scored(plan, { 'old-a': 0.99, 'old-b': 0.8 }), plan, {
    maxMessages: 3,
    maxChars: budget,
  });
  assert.deepEqual(plain(ids(result.messages)), ['old-b', 'self', 'latest']);
  assert.equal(api.decisionTranscript(result.messages).length, budget);
  assert.throws(
    () => api.parseContextDecision(scored(plan), plan, { maxMessages: 1 }),
    /必要.*上限/
  );
  assert.throws(() => api.parseContextDecision(scored(plan), plan, { maxChars: 1 }), /必要.*上限/);
});

test('上下文回覆缺值、額外 ID、錯誤型別及超出範圍都交回人工處理', () => {
  const plan = planFor(history());
  const missing = scored(plan);
  delete missing.answers.latest;
  assert.throws(() => api.parseContextDecision(missing, plan), /缺少/);
  const extra = scored(plan);
  extra.answers.injected = { type: 'noul', noul: 1 };
  assert.throws(() => api.parseContextDecision(extra, plan), /未知/);
  for (const invalid of [NaN, Infinity, -0.1, 1.1, '0.9']) {
    const response = scored(plan);
    response.answers.latest.noul = invalid;
    assert.throws(() => api.parseContextDecision(response, plan), /機率/);
  }
  const wrongType = scored(plan);
  wrongType.answers.latest = { type: 'boolean', probability: 0.9 };
  assert.throws(() => api.parseContextDecision(wrongType, plan), /機率/);
});

test('實際文字預覽保留附件勾選標記與未知身分，但不帶附件 URL', () => {
  const rows = [
    message('photo', '', 'unknown', {
      sender: '',
      senderId: '',
      time: '2026-09-25T12:00:00Z',
      attachments: [{ kind: 'image', selected: true, url: 'PRIVATE URL' }, { kind: 'audio' }],
    }),
  ];
  const text = api.decisionTranscript(rows);
  assert.match(text, /未辨識發言者 \[身分待確認\]/);
  assert.match(text, /圖片 1：已選取，僅主模型可分析/);
  assert.match(text, /語音 2/);
  assert.doesNotMatch(text, /PRIVATE URL/);
});

test('回覆選擇是一題含 none 的 Choice，加三組彼此獨立的相關性與事實性 Noul', () => {
  const body = api.replyDecisionBody({
    messages: history(),
    target: 'Alice',
    replies: REPLIES,
    style: '不用標點',
    model: 'typesafe-ai/jev',
  });
  assert.equal(body.model, 'typesafe-ai/jev');
  assert.equal(body.state.target, 'Alice');
  assert.equal(body.state.style, '不用標點');
  assert.equal(body.state.transcript, api.decisionTranscript(history()));
  assert.equal(Object.keys(body.questions).length, 7);
  assert.deepEqual(Object.keys(body.questions.bestReply.criteria), [
    'reply_1',
    'reply_2',
    'reply_3',
    'none',
  ]);
  for (let index = 1; index <= 3; index++) {
    assert.equal(body.state.replies[`reply_${index}`], REPLIES[index - 1]);
    assert.equal(body.questions[`reply_${index}_relevant`].type, 'noul');
    assert.equal(body.questions[`reply_${index}_factual`].type, 'noul');
  }
  assert.throws(
    () => api.replyDecisionBody({ transcript: '內容', replies: ['單一候選'], model: 'jev' }),
    /三個/
  );
  assert.throws(
    () => api.replyDecisionBody({ transcript: '內容', replies: ['一', '一', '二'], model: 'jev' }),
    /三個/
  );
});

test('只有首選機率與兩個獨立品質門檻全部通過才回傳候選索引', () => {
  const selected = api.parseReplyDecision(ranked(), REPLIES);
  assert.equal(selected.index, 1);
  const boundary = api.parseReplyDecision(
    ranked({ winner: 'reply_3', probability: 0.8, relevant: 0.8, factual: 0.8 }),
    REPLIES
  );
  assert.equal(boundary.index, 2);
  assert.equal(api.parseReplyDecision(ranked({ winner: 'none' }), REPLIES).index, null);
  const uncertain = ranked({ probability: 0.79 });
  uncertain.answers.bestReply.confidence = 1;
  assert.equal(
    api.parseReplyDecision(uncertain, REPLIES).index,
    null,
    'confidence 不能取代首選機率'
  );
  assert.match(api.parseReplyDecision(ranked({ relevant: 0.79 }), REPLIES).reason, /相關性/);
  assert.match(api.parseReplyDecision(ranked({ factual: 0.79 }), REPLIES).reason, /事實/);
});

test('空白對話開場以明確 goal 判斷三候選，不虛構既有聊天上下文', () => {
  const body = api.replyDecisionBody({
    transcript: '',
    openingGoal: '用輕鬆問題開始聊旅行',
    replies: REPLIES,
    style: '不用標點',
    model: 'jev-fixture',
  });
  assert.equal(body.state.transcript, '');
  assert.equal(body.state.openingGoal, '用輕鬆問題開始聊旅行');
  assert.match(body.questions.bestReply.instructions, /openingGoal/);
  assert.match(body.questions.reply_1_relevant.instructions, /openingGoal/);
  assert.equal(Object.keys(body.questions).length, 7);
  assert.equal(api.parseReplyDecision(ranked(), REPLIES).index, 1);
  assert.throws(
    () =>
      api.replyDecisionBody({ transcript: '', openingGoal: ' ', replies: REPLIES, model: 'jev' }),
    /缺少上下文/
  );
});

test('錯誤或不完整的回覆判斷不會默默選第一個候選', () => {
  const malformed = ranked();
  malformed.answers.bestReply.choice = '__proto__';
  assert.throws(() => api.parseReplyDecision(malformed, REPLIES), /格式錯誤/);
  const missing = ranked();
  delete missing.answers.reply_1_factual;
  assert.throws(() => api.parseReplyDecision(missing, REPLIES), /缺少/);
  const inconsistent = ranked();
  inconsistent.answers.bestReply.choice = 'reply_1';
  assert.throws(() => api.parseReplyDecision(inconsistent, REPLIES), /不一致/);
  const badSum = ranked();
  badSum.answers.bestReply.probabilities.none = 1;
  assert.throws(() => api.parseReplyDecision(badSum, REPLIES), /不一致/);
  const badNoul = ranked();
  badNoul.answers.reply_2_relevant.noul = 2;
  assert.throws(() => api.parseReplyDecision(badNoul, REPLIES), /機率/);
});
