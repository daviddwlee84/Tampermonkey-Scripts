import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../userscripts/chat-reply-assistant/chat-reply-assistant.user.js', import.meta.url),
  'utf8'
);
const core = source.match(/\/\/\s*BEGIN CORE\b([\s\S]*?)\/\/\s*END CORE\b/)?.[1];
assert.ok(core);
function region(first, next) {
  const start = source.indexOf(`  function ${first}(`);
  const end = source.indexOf(`  function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, `找不到發佈檔的 ${first} → ${next} 區塊`);
  return source.slice(start, end);
}
// 僅抽出真實發佈函式，提供最少的 controller 狀態；不維護第二份合併實作。
const controller = [
  region('entry', 'selectedMessages'),
  region('historySignature', 'effectiveMessages'),
  region('resetBaseline', 'changeRoute'),
  region('nativeContentSignature', 'confirmCurrentThread'),
  region('mergeCaptured', 'scan'),
].join('\n');
const message = (id, text = id) => ({
  id,
  senderId: 'peer',
  sender: 'Peer',
  direction: 'other',
  text,
  time: '',
  kind: 'text',
  attachments: [],
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const context = vm.createContext({
    URL,
    structuredClone,
    settings: { maxMessages: 50 },
    editorSnapshot: null,
    route: { id: 'new-thread' },
    retiredView: null,
    baselineReady: true,
    enteredAt: 0,
    changedAt: 0,
    pendingAuto: true,
    lastSignature: 'old-signature',
  });
  vm.runInContext(`${core}\n${controller}\ncurrent = entry('history-fixture');`, context);
  return {
    context,
    get current() {
      return context.current;
    },
    merge(messages) {
      context.incoming = structuredClone(messages);
      return vm.runInContext('mergeCaptured({ messages: incoming })', context);
    },
    evidence(previous, incoming) {
      context.retiredView = structuredClone(previous);
      context.candidate = structuredClone(incoming);
      return vm.runInContext('snapshotEvidence(candidate)', context);
    },
  };
}

describe('published controller history merging', () => {
  it('完整 500 則可信視窗不保留隱藏且無上限的舊 archive', () => {
    const h = harness();
    for (let batch = 0; batch < 4; batch++) {
      h.merge(Array.from({ length: 500 }, (_, index) => message(`batch-${batch}-${index}`)));
      assert.equal(h.current.messages.length, 500);
      assert.equal(h.current.uncertain.length, 0);
      assert.equal(new Set(h.current.messages.map((m) => m.uid)).size, 500);
    }
    assert.equal(h.current.trimmed, true);
  });

  it('舊視窗重新出現時重用原 UID，保留人工排除、編輯及圖片選取且不重複', () => {
    const h = harness();
    const original = [
      message('a'),
      {
        ...message('b'),
        attachments: [{ id: 'picture', kind: 'image', url: 'https://example.test/fixture.png' }],
      },
    ];
    h.merge(original);
    const [a, b] = h.current.messages;
    h.current.excluded.add(a.uid);
    h.current.edits.set(b.uid, { text: '人工修訂內容' });
    h.current.images.add(`${b.uid}::picture`);
    h.merge([message('older-c'), message('older-d')]);
    assert.equal(h.current.uncertain.length, 2);
    h.merge(original);
    const restoredA = h.current.messages.find((m) => m.id === 'a'),
      restoredB = h.current.messages.find((m) => m.id === 'b');
    assert.equal(restoredA.uid, a.uid);
    assert.equal(restoredB.uid, b.uid);
    assert.equal(h.current.messages.filter((m) => m.id === 'a').length, 1);
    assert.equal(h.current.messages.filter((m) => m.id === 'b').length, 1);
    assert.equal(
      h.current.uncertain.some((m) => m.id === 'a' || m.id === 'b'),
      false
    );
    assert.equal(h.current.excluded.has(restoredA.uid), true);
    assert.equal(
      vm.runInContext('isSelected(current.messages.find(m => m.id === "a"))', h.context),
      false
    );
    assert.deepEqual(plain(h.current.edits.get(restoredB.uid)), { text: '人工修訂內容' });
    assert.equal(h.current.images.has(`${restoredB.uid}::picture`), true);
    assert.equal(new Set(h.current.messages.map((m) => m.uid)).size, h.current.messages.length);
  });

  it('有重疊的可信視窗重新接到 archived 原生 ID 時也保留 UID', () => {
    const h = harness();
    h.merge([message('later-a'), message('later-b')]);
    const uid = h.current.messages[0].uid;
    h.current.excluded.add(uid);
    h.merge([message('older-c'), message('older-d')]);
    const merged = h.merge([message('older-d'), message('later-a')]);
    assert.equal(merged.ambiguous, false);
    const recovered = h.current.messages.find((m) => m.id === 'later-a');
    assert.equal(recovered.uid, uid);
    assert.equal(h.current.excluded.has(recovered.uid), true);
    assert.equal(h.current.messages.filter((m) => m.id === 'later-a').length, 1);
    assert.equal(
      h.current.uncertain.some((m) => m.id === 'later-a'),
      false
    );
  });

  it('可信視窗優先，剩餘 archive 配額與總訊息數都受 500 限制', () => {
    const h = harness();
    h.merge(Array.from({ length: 500 }, (_, index) => message(`first-${index}`)));
    h.merge(Array.from({ length: 450 }, (_, index) => message(`second-${index}`)));
    assert.equal(h.current.messages.length, 500);
    assert.equal(h.current.uncertain.length, 50);
    assert.equal(h.current.messages.filter((m) => !m.orderUncertain).length, 450);
    assert.deepEqual(
      plain(h.current.uncertain.map((m) => m.id)),
      Array.from({ length: 50 }, (_, index) => `first-${index + 450}`)
    );
  });

  it('只改標題仍是舊畫面；相同 fallback 標題與少量共同訊息不阻擋真的新視窗', () => {
    const h = harness();
    const previous = {
      title: 'Old title',
      titleSource: 'native',
      messages: [message('shared', '好'), message('old-only')],
    };
    assert.equal(h.evidence(previous, { ...previous, title: 'New title' }), false);
    assert.equal(
      h.evidence(
        { ...previous, title: '目前對話', titleSource: 'fallback' },
        {
          title: '目前對話',
          titleSource: 'fallback',
          messages: [message('shared', '好'), message('new-only')],
        }
      ),
      true
    );
    assert.equal(
      h.evidence(previous, { title: '目前對話', titleSource: 'fallback', messages: [] }),
      false
    );
    assert.equal(h.evidence(previous, { identity: 'new-thread', messages: [] }), true);
  });

  it('派生左右角色與作者／URL metadata 更新不是路由切換證據，但會更新 view signature', () => {
    const h = harness();
    const initial = {
      ...message(null, 'same body'),
      sender: '',
      senderId: null,
      senderSource: 'layout',
      directionConfidence: 'layout',
      layoutSide: 'left',
      attachments: [
        { id: 'photo-path', kind: 'image', url: 'https://example.test/photo?token=old' },
      ],
    };
    const refreshed = {
      ...initial,
      sender: 'Known person',
      senderId: 'person-id',
      senderSource: 'explicit-id',
      directionConfidence: 'strong',
      direction: 'self',
      attachments: [{ ...initial.attachments[0], url: 'https://example.test/photo?token=new' }],
    };
    const previous = { title: '目前對話', titleSource: 'fallback', messages: [initial] },
      next = { title: 'New native title', titleSource: 'native', messages: [refreshed] };
    assert.equal(h.evidence(previous, next), false);
    h.context.previousSnapshot = previous;
    h.context.nextSnapshot = next;
    assert.equal(
      vm.runInContext(
        'nativeContentSignature(previousSnapshot.messages) === nativeContentSignature(nextSnapshot.messages)',
        h.context
      ),
      true
    );
    assert.equal(
      vm.runInContext('viewSignature(previousSnapshot) === viewSignature(nextSnapshot)', h.context),
      false
    );
  });

  it('相同原生內容刷新 metadata 時保持 UID 與選取，且不是新 appended 訊息', () => {
    const h = harness();
    const original = {
      ...message(null, 'same body'),
      sender: '',
      senderId: null,
      senderSource: 'layout',
      directionConfidence: 'layout',
      layoutSide: 'left',
      attachments: [
        { id: 'photo-path', kind: 'image', url: 'https://example.test/photo?token=old' },
      ],
    };
    h.merge([original]);
    const uid = h.current.messages[0].uid,
      serial = h.current.serial;
    h.current.excluded.add(uid);
    h.current.images.add(`${uid}::photo-path`);
    const result = h.merge([
      {
        ...original,
        sender: 'Known person',
        senderId: 'person-id',
        direction: 'self',
        senderSource: 'explicit-id',
        directionConfidence: 'strong',
        attachments: [{ ...original.attachments[0], url: 'https://example.test/photo?token=new' }],
      },
    ]);
    const refreshed = h.current.messages[0];
    assert.equal(refreshed.uid, uid);
    assert.equal(h.current.serial, serial);
    assert.equal(h.current.messages.length, 1);
    assert.equal(refreshed.sender, 'Known person');
    assert.equal(refreshed.directionConfidence, 'strong');
    assert.match(refreshed.attachments[0].url, /token=new$/);
    assert.equal(h.current.excluded.has(uid), true);
    assert.equal(h.current.images.has(`${uid}::photo-path`), true);
    assert.deepEqual(plain(result.appended), []);
    assert.equal(result.ambiguous, false);
    assert.equal(h.current.uncertain.length, 0);
  });

  it('左右設定只重分 layout 角色，不丟歷史、UID、人工資料或強語義角色，並重建 baseline', () => {
    const h = harness();
    h.merge([
      {
        ...message('left'),
        direction: 'other',
        senderSource: 'layout',
        directionConfidence: 'layout',
        layoutSide: 'left',
      },
      {
        ...message('right'),
        direction: 'self',
        senderSource: 'layout',
        directionConfidence: 'layout',
        layoutSide: 'right',
      },
      {
        ...message('strong'),
        direction: 'self',
        senderSource: 'explicit-id',
        directionConfidence: 'strong',
        layoutSide: null,
      },
    ]);
    const before = h.current.messages.map((m) => m.uid);
    h.current.excluded.add(before[0]);
    h.current.edits.set(before[1], { text: '人工保留' });
    h.current.aiMask = new Set(before);
    const archived = {
      ...message('archived'),
      uid: 'archived-uid',
      direction: 'other',
      senderSource: 'layout',
      directionConfidence: 'layout',
      layoutSide: 'left',
      orderUncertain: true,
    };
    h.current.uncertain.push(archived);
    h.current.messages.unshift(archived);
    vm.runInContext('reclassifyLayoutMessages("left")', h.context);
    assert.deepEqual(plain(h.current.messages.map((m) => m.uid)), ['archived-uid', ...before]);
    assert.deepEqual(plain(h.current.messages.map((m) => m.direction)), [
      'self',
      'self',
      'other',
      'self',
    ]);
    assert.equal(h.current.uncertain[0].direction, 'self');
    assert.equal(h.current.edits.get(before[1]).text, '人工保留');
    assert.equal(h.current.excluded.has(before[0]), true);
    assert.equal(h.current.aiMask, null);
    assert.equal(h.context.baselineReady, false);
    assert.equal(h.context.pendingAuto, false);
    assert.equal(h.context.lastSignature, '');
  });

  it('選取 metadata 只保留目前與凍結編輯快照的聯集，關閉編輯後移除失效 pins', () => {
    const h = harness();
    h.merge([message('live')]);
    const liveUid = h.current.messages[0].uid;
    h.context.editorSnapshot = [{ ...message('frozen'), uid: 'frozen-uid' }];
    for (const uid of [liveUid, 'frozen-uid', 'expired-uid']) {
      h.current.included.add(uid);
      h.current.excluded.add(uid);
      h.current.edits.set(uid, { text: uid });
      h.current.images.add(`${uid}::picture`);
    }
    vm.runInContext('pruneSelectionMemory()', h.context);
    for (const set of [h.current.included, h.current.excluded])
      assert.deepEqual([...set].sort(), [liveUid, 'frozen-uid'].sort());
    assert.deepEqual([...h.current.edits.keys()].sort(), [liveUid, 'frozen-uid'].sort());
    assert.deepEqual(
      [...h.current.images].sort(),
      [`${liveUid}::picture`, 'frozen-uid::picture'].sort()
    );
    h.context.editorSnapshot = null;
    vm.runInContext('pruneSelectionMemory()', h.context);
    assert.deepEqual([...h.current.included], [liveUid]);
    assert.deepEqual([...h.current.excluded], [liveUid]);
    assert.deepEqual([...h.current.edits.keys()], [liveUid]);
    assert.deepEqual([...h.current.images], [`${liveUid}::picture`]);
  });
});
