import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const context = vm.createContext({});
for (const path of [
  'shared/chat-export.js',
  'shared/chatgpt-adapter.js',
  'shared/conversation-archive.js',
])
  vm.runInContext(await read(path), context);
const C = vm.runInContext('ConversationArchive', context);
const fixture = JSON.parse(await read('tests/fixtures/chatgpt-export/multiple-research.json'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const create = (raw = fixture) =>
  C.fromChatGPT(raw, { url: 'https://chatgpt.com/c/fixture', type: 'fixture' });
const blockId = (archive, nodeId, kind = 'message') =>
  archive.graph.nodes[nodeId].blockIds.find((id) => archive.graph.blocks[id].kind === kind);
const choose = (archive, ids) => C.withSelection(archive, ids);
const render = (archive) => C.renderSelection(archive, { exportedAt: '2026-09-14T00:00:00Z' });

describe('portable conversation archive', () => {
  it('keeps native topology and raw bytes, and defaults to the current path', () => {
    const before = JSON.stringify(fixture);
    const archive = create();
    assert.equal(archive.selection.blockIds.length, 4);
    assert.equal(JSON.stringify(fixture), before);
    assert.deepEqual(clone(archive.raw), fixture);
    assert.deepEqual(clone(archive.graph.nodes['tool-1'].children), ['user-2', 'alternate-user']);
    assert.equal(archive.graph.blocks[blockId(archive, 'tool-1', 'research')].nodeId, 'tool-1');
    assert.equal(
      archive.graph.blocks[blockId(archive, 'tool-1', 'research')].messageId,
      'report-1'
    );
    const md = render(archive);
    assert.match(md, /^messages: 4$/m);
    assert.match(md, /\[Source\]\(https:\/\/example.com\/first-report\)/);
    assert.doesNotMatch(md, /UNSELECTED|此處省略/);
    assert.ok(md.indexOf('# First report') < md.indexOf('Follow-up question'));
  });

  it('round-trips the graph, content, selection and options without re-parsing raw', () => {
    const archive = create();
    archive.raw.mapping['tool-1'].message.metadata.chatgpt_sdk.widget_state = '{broken';
    archive.selection.options.showTools = true;
    archive.selection.blockIds = [blockId(archive, 'tool-3', 'research')];
    const loaded = C.load(JSON.stringify(archive));
    assert.deepEqual(clone(loaded), clone(archive));
    assert.equal(render(loaded), render(archive));
    assert.deepEqual(clone(C.load(JSON.stringify(choose(archive, []))).selection.blockIds), []);
  });

  it('imports legacy raw JSON and data-wrapped JSON with deterministic IDs', () => {
    assert.deepEqual(
      clone(C.load(JSON.stringify(fixture)).graph),
      clone(C.load({ data: fixture }).graph)
    );
    const raw = clone(fixture);
    delete raw.linear_conversation;
    assert.deepEqual(clone(create(raw).graph), clone(create().graph));
  });

  it('exports exactly one answer without pulling in its question or ancestors', () => {
    const archive = create();
    const md = render(choose(archive, [blockId(archive, 'tool-2', 'research')]));
    assert.match(md, /^messages: 1$/m);
    assert.match(md, /此處省略未選取的前文/);
    assert.match(md, /Second report findings/);
    assert.doesNotMatch(md, /Initial research question|Follow-up question|First report evidence/);
  });

  it('does not merge disconnected same-role selections', () => {
    const archive = create();
    const md = render(choose(archive, [blockId(archive, 'user-1'), blockId(archive, 'user-2')]));
    assert.equal(md.match(/_\*\*User/g).length, 2);
    assert.match(md, /此處省略/);
    assert.doesNotMatch(md, /First report evidence/);
  });

  it('marks an omitted report when only its tool host and a later question are selected', () => {
    const archive = create();
    const md = render(choose(archive, [blockId(archive, 'tool-1'), blockId(archive, 'user-2')]));
    const tail = md.slice(md.indexOf('Research 1 started'));
    assert.match(tail, /此處省略未選取的前文/);
    assert.doesNotMatch(md, /First report evidence/);
  });

  it('labels nested forks independently while retaining the shared ancestor once', () => {
    const raw = clone(fixture);
    raw.mapping['tool-2'].children = ['nested-a', 'nested-b'];
    for (const id of ['nested-a', 'nested-b'])
      raw.mapping[id] = {
        id,
        parent: 'tool-2',
        children: [],
        message: { id, author: { role: 'user' }, content: { content_type: 'text', parts: [id] } },
      };
    raw.current_node = 'nested-a';
    const archive = create(raw);
    const ids = ['nested-a', 'nested-b', 'tool-3'].flatMap((id) =>
      C.pathBlocks(archive, id).map((b) => b.id)
    );
    const md = render(choose(archive, ids));
    for (const branch of ['1', '1.1', '1.2', '2']) assert.ok(md.includes(`## 分支 ${branch}\n`));
    assert.equal(md.split('First report evidence').length - 1, 1);
    assert.equal(md.split('Second report findings').length - 1, 1);
  });

  it('adds multiple paths as a union and emits shared context once', () => {
    const archive = create();
    const ids = [
      ...archive.selection.blockIds,
      ...C.pathBlocks(archive, 'tool-3').map((b) => b.id),
    ];
    const combined = choose(archive, ids);
    assert.equal(combined.selection.blockIds.length, 6);
    const md = render(combined);
    assert.equal(md.split('Initial research question').length - 1, 1);
    assert.equal(md.split('# First report').length - 1, 1);
    assert.match(md, /## 分支 1/);
    assert.match(md, /## 分支 2/);
    assert.match(md, /接續訊息 M2/);
    assert.match(md, /_\*\*Assistant[^\n]* · M2\*\*_/);
    assert.ok(md.indexOf('# Second report') < md.indexOf('UNSELECTED BRANCH'));
    assert.match(md, /UNSELECTED REPORT/);
  });

  it('does not deduplicate identical report IDs across alternative branches', () => {
    const raw = clone(fixture);
    const sdk = raw.mapping['tool-3'].message.metadata.chatgpt_sdk;
    const state = JSON.parse(sdk.widget_state);
    state.report_message.id = 'report-2';
    sdk.widget_state = JSON.stringify(state);
    const archive = create(raw);
    const md = render(
      choose(archive, [
        blockId(archive, 'tool-2', 'research'),
        blockId(archive, 'tool-3', 'research'),
      ])
    );
    assert.match(md, /^messages: 2$/m);
    assert.match(md, /Second report findings/);
    assert.match(md, /UNSELECTED REPORT/);
    assert.match(md, /## 分支 2/);
  });

  it('collapses late snapshots only within a path and preserves first report placement', () => {
    const raw = clone(fixture);
    const snapshot = clone(raw.mapping['tool-1']);
    snapshot.id = 'late';
    snapshot.message.id = 'late';
    snapshot.parent = 'tool-2';
    snapshot.children = [];
    const sdk = snapshot.message.metadata.chatgpt_sdk;
    const state = JSON.parse(sdk.widget_state);
    state.last_updated_at += 1000;
    state.report_message.content.parts[0] = '# Latest first report';
    sdk.widget_state = JSON.stringify(state);
    raw.mapping['tool-2'].children.push('late');
    raw.mapping.late = snapshot;
    raw.current_node = 'late';
    const archive = create(raw),
      md = render(archive);
    assert.equal(archive.selection.blockIds.length, 4);
    assert.ok(md.indexOf('# Latest first report') < md.indexOf('Follow-up question'));
    assert.doesNotMatch(md, /First report evidence/);
    assert.equal(
      C.pathBlocks(archive, 'tool-3').find((b) => b.kind === 'research').nodeId,
      'tool-1'
    );
  });

  it('marks orphan context and rejects cycles without silently dropping nodes', () => {
    const raw = clone(fixture);
    raw.mapping.root.parent = 'missing-root';
    const archive = create(raw);
    assert.equal(archive.graph.nodes.root.missingParentId, 'missing-root');
    assert.match(render(archive), /此處省略/);
    raw.mapping.root.parent = 'tool-2';
    raw.mapping['tool-2'].children.push('root');
    assert.throws(() => create(raw), /循環/);
  });

  it('preserves report placement inside one branch when another path is also selected', () => {
    const raw = clone(fixture);
    raw.mapping.followup = {
      id: 'followup',
      parent: 'tool-2',
      children: ['late'],
      message: {
        id: 'followup',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Later follow-up'] },
      },
    };
    raw.mapping['tool-2'].children = ['followup'];
    const late = clone(raw.mapping['tool-2']);
    late.id = 'late';
    late.message.id = 'late';
    late.parent = 'followup';
    late.children = [];
    const state = JSON.parse(late.message.metadata.chatgpt_sdk.widget_state);
    state.last_updated_at += 1000;
    state.report_message.content.parts = ['# Updated second report'];
    late.message.metadata.chatgpt_sdk.widget_state = JSON.stringify(state);
    raw.mapping.late = late;
    raw.current_node = 'late';
    const archive = create(raw);
    const md = render(
      choose(archive, [
        ...archive.selection.blockIds,
        ...C.pathBlocks(archive, 'tool-3').map((b) => b.id),
      ])
    );
    assert.ok(md.indexOf('# Updated second report') < md.indexOf('Later follow-up'));
    assert.doesNotMatch(md, /此處省略|Second report findings/);
    assert.equal(md.split('# Updated second report').length - 1, 1);
  });

  it('rejects broken archive versions, node relationships and block references', () => {
    const archive = create();
    for (const update of [
      (a) => {
        a.version = 42;
      },
      (a) => {
        a.graph.nodes.root.children = [];
      },
      (a) => {
        a.selection.blockIds = ['nonexistent'];
      },
      (a) => {
        a.graph.nodes['tool-2'].blockIds.push('fake');
      },
      (a) => {
        a.graph.blocks[a.selection.blockIds[0]].nodeId = 'wrong';
      },
    ]) {
      const broken = clone(archive);
      update(broken);
      assert.throws(() => C.load(broken));
    }
    assert.throws(() => render(choose(archive, [])), /請先選取/);
  });

  it('keeps broken research recoverable and blocks export only when its error is selected', () => {
    const raw = clone(fixture);
    raw.mapping['tool-3'].message.metadata.chatgpt_sdk.widget_state = '{broken';
    const archive = create(raw);
    assert.match(render(archive), /^messages: 4$/m);
    const error = blockId(archive, 'tool-3', 'error');
    assert.ok(error);
    assert.throws(() => render(choose(archive, [error])), /無法匯出所選訊息/);
    assert.deepEqual(clone(C.load(JSON.stringify(archive)).raw), raw);
  });

  it('keeps hidden selections included, and includes research details only on request', () => {
    const archive = create();
    const tool = blockId(archive, 'tool-1');
    const subset = choose(archive, [tool, blockId(archive, 'tool-1', 'research')]);
    assert.equal(C.visible(subset.graph.blocks[tool], subset.selection.options), false);
    assert.match(render(subset), /Research 1 started/);
    assert.doesNotMatch(render(subset), /Deep Research details/);
    subset.selection.options.includeResearchDetails = true;
    assert.match(render(subset), /Deep Research details/);
  });

  it('handles 5,000 nodes without recursive traversal or dropped messages', () => {
    const raw = { title: 'Long conversation', mapping: {}, current_node: 'n4999' };
    for (let i = 0; i < 5000; i++)
      raw.mapping[`n${i}`] = {
        id: `n${i}`,
        parent: i ? `n${i - 1}` : null,
        children: i < 4999 ? [`n${i + 1}`] : [],
        message: {
          id: `m${i}`,
          author: { role: i % 2 ? 'assistant' : 'user' },
          content: { content_type: 'text', parts: [`Unique message ${i}`] },
        },
      };
    const started = performance.now(),
      archive = create(raw);
    assert.equal(archive.selection.blockIds.length, 5000);
    assert.match(render(archive), /^messages: 5000$/m);
    assert.ok(
      performance.now() - started < 5000,
      'graph + selection export should stay bounded for a 5k-node chain'
    );
  });
});
