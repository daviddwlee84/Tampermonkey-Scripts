import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCRIPT_URL = new URL(
  '../userscripts/vimium-c-companion/vimium-c-companion.user.js',
  import.meta.url
);
const source = await readFile(SCRIPT_URL, 'utf8');
const body = source.split('/* REFERENCE MODEL START */')[1]?.split('/* REFERENCE MODEL END */')[0];
assert.ok(body, '最終 userscript 必須包含可獨立測試的參考模型標記');
// 僅從交付的單檔擷取純函式。context 未提供 DOM、GM 或 Node API。
const model = vm.runInNewContext(`${body}\ncreateReferenceModel()`, Object.create(null), {
  timeout: 2000,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const resolved = (text) => plain(model.resolve(model.parseImport(text)));
const entry = (rows, id) => {
  const row = rows.find((item) => item.id === id);
  assert.ok(row, `缺少參考項目 ${id}`);
  return row;
};
const native = JSON.parse(
  await readFile(new URL('./fixtures/vimium-c-companion/native-reference.json', import.meta.url))
);
const fixture = (name) =>
  readFile(new URL(`./fixtures/vimium-c-companion/${name}`, import.meta.url), 'utf8');

describe('Vimium C Companion：固定版本原生總表', () => {
  it('含全部 181 個公開 command ID、原生別名及 77 個預設 Normal 鍵位', () => {
    assert.equal(model.source.version, '2.12.2');
    assert.equal(model.source.commit, native.commit);
    assert.equal(model.source.artifactHash, native.keyMappingsSha256);
    assert.equal(native.commandIds.length, 181);
    assert.equal(native.defaultBindings.length, 77);
    const catalog = plain(model.catalog);
    assert.deepEqual(
      catalog
        .filter((row) => row.mode === 'normal')
        .map((row) => row.id)
        .sort(),
      [...native.commandIds].sort()
    );
    for (const { id, key } of native.defaultBindings) {
      assert.ok(entry(catalog, id).keys.includes(key), `${key} → ${id}`);
    }
    assert.equal(
      entry(catalog, 'LinkHints.activateModeToHover').canonical,
      'LinkHints.activateHover'
    );
    assert.equal(entry(catalog, 'wait').canonical, 'blank');
    assert.deepEqual(entry(catalog, 'LinkHints.activateSelect').keys, ['yv']);
    assert.ok(
      catalog.every((row) => row.title && row.description && row.url.includes(native.commit))
    );
  });

  it('Visual、Vomnibar、Browser 與 Normal 分開，不互相搶用 y / j / Enter', () => {
    const rows = plain(model.resolve());
    assert.deepEqual(entry(rows, 'visual:yank').keys, ['y']);
    assert.deepEqual(entry(rows, 'visual:wordNext').keys, ['w', 'W']);
    assert.equal(entry(rows, 'visual:yank').mode, 'visual');
    assert.deepEqual(entry(rows, 'vomnibar:confirm').keys, ['<enter>']);
    assert.equal(entry(rows, 'vomnibar:next').mode, 'vomnibar');
    assert.deepEqual(entry(rows, 'browser:userCustomized1').keys, []);
    assert.ok(entry(rows, 'scrollDown').keys.includes('j'));
    assert.equal(rows.filter((row) => row.kind === 'browser').length, 2);
  });

  it('呼叫者修改 catalog、profile、resolve 結果不會污染下一次的總表', () => {
    const profile = plain(model.parseImport('map z scrollDown'));
    const before = JSON.stringify(profile);
    const first = model.resolve(profile);
    first.find((row) => row.id === 'scrollDown').keys.push('not-real');
    assert.equal(JSON.stringify(profile), before);
    assert.ok(!entry(plain(model.resolve(profile)), 'scrollDown').keys.includes('not-real'));
    model.catalog.find((row) => row.id === 'scrollDown').keys.push('also-not-real');
    assert.ok(!entry(plain(model.resolve()), 'scrollDown').keys.includes('also-not-real'));
  });
});

describe('Vimium C Companion：原生匯入形狀與原文', () => {
  it('接受 flat export、陣列 mappings、版本差異、排除規則與未指定欄位', async () => {
    const text = await fixture('native-export.json');
    const profile = plain(model.parseImport(text));
    assert.equal(profile.raw, text);
    assert.equal(profile.format, 'native-json');
    assert.equal(profile.version, '2.12.3');
    assert.equal(profile.versionMatch, 'family');
    assert.equal(profile.completeness, 'complete');
    assert.equal(profile.environment.platform, 'mac');
    assert.equal(profile.exclusionRules[0].passKeys, 'j k ');
    assert.equal(profile.exclusionOnlyFirstMatch, false);
    assert.equal(profile.exclusionListenHash, true);
    const rows = plain(model.resolve(profile));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('j'));
    assert.ok(entry(rows, 'scrollDown').keys.includes('z'));
    assert.equal(
      entry(rows, 'scrollDown').bindings.find((binding) => binding.key === 'z').options,
      '$count=2'
    );
  });

  it('partial export 缺少 keyMappings 使用預設，缺少 exclusionRules 不冒充空清單', () => {
    const profile = plain(model.parseImport('{"name":"Vimium C"}'));
    assert.equal(profile.omitted.keyMappings, true);
    assert.equal(profile.omitted.exclusionRules, true);
    assert.equal(profile.exclusionRules, null);
    assert.equal(profile.versionMatch, 'unspecified');
    assert.ok(entry(plain(model.resolve(profile)), 'scrollDown').keys.includes('j'));
    assert.deepEqual(
      entry(resolved('{"name":"Vimium C","keyMappings":"unmapAll"}'), 'scrollDown').keys,
      []
    );
  });

  it('接受 BOM、CRLF、逐行 UTF-8 base64 與續行，保留原始文字行號', () => {
    const encoded = Buffer.from('map zz openUrl url="https://example.com/中文"').toString('base64');
    const text = `\ufeff${JSON.stringify({ name: 'Vimium C', keyMappings: [`$base64:${encoded}`, 'map z scrollDown \\\r\n  $count=3', ''] })}`;
    const profile = plain(model.parseImport(text));
    assert.equal(profile.completeness, 'complete');
    assert.equal(profile.directives[0].options, 'url="https://example.com/中文"');
    assert.equal(profile.directives[1].line, 2);
    assert.equal(profile.directives[1].endLine, 3);
    assert.match(profile.directives[1].raw, /\\\n/);
    assert.equal(profile.directives[1].options, '$count=3');
    assert.equal(
      entry(plain(model.resolve(profile)), 'openUrl').bindings[0].options,
      'url="https://example.com/中文"'
    );
  });

  it('結構無效才拋錯：JSON root、名稱、欄位型別；未知 mappings 只產生診斷', () => {
    for (const text of [
      '{',
      '[]',
      '{}',
      '{"name":"Vimium"}',
      '{"name":"Vimium C","keyMappings":[1]}',
      '{"name":"Vimium C","environment":[]}',
      '{"name":"Vimium C","exclusionRules":[{}]}',
    ]) {
      assert.throws(() => model.parseImport(text), undefined, text);
    }
    const profile = plain(model.parseImport('notACommand something\nmap z Missing.command'));
    assert.equal(profile.completeness, 'partial');
    assert.equal(profile.directives.length, 2);
    assert.equal(profile.diagnostics.length, 2);
  });

  it('不能解碼的 base64 保留完整原文並撤下不確定的有效鍵位', () => {
    const profile = plain(model.parseImport('{"name":"Vimium C","keyMappings":["$base64:!!!"]}'));
    assert.equal(profile.completeness, 'partial');
    assert.equal(profile.directives[0].raw, '$base64:!!!');
    assert.deepEqual(entry(plain(model.resolve(profile)), 'scrollDown').keys, []);
  });

  it('keyMappings 明確為 null 屬結構無效；空字串／空陣列仍是有效預設', () => {
    assert.throws(
      () => model.parseImport('{"name":"Vimium C","keyMappings":null}'),
      /keyMappings.*null/
    );
    for (const keyMappings of ['', []]) {
      const profile = model.parseImport(JSON.stringify({ name: 'Vimium C', keyMappings }));
      assert.equal(profile.completeness, 'complete');
      assert.equal(profile.omitted.keyMappings, false);
      assert.ok(entry(plain(model.resolve(profile)), 'scrollDown').keys.includes('j'));
    }
  });

  it('預覽採用與儲存相同的 1,000,000 字元上限，含原始 JSON 與註解', () => {
    const boundary = '#' + 'x'.repeat(999_999);
    const profile = model.parseImport(boundary);
    assert.equal(profile.raw.length, 1_000_000);
    assert.equal(profile.completeness, 'complete');
    assert.throws(() => model.parseImport(boundary + 'x'), /1,000,000/);
    const oversizedJSON = JSON.stringify({ name: 'Vimium C', keyMappings: '', note: boundary });
    assert.throws(() => model.parseImport(oversizedJSON), /1,000,000/);
  });
});

describe('Vimium C Companion：可確認的映射與作用範圍', () => {
  it('map 覆寫預設，unmap 移除指定鍵，unmapAll 清除 Normal 而保留原生模式內動作', () => {
    let rows = resolved('map j scrollUp\nunmap <c-e>');
    assert.ok(entry(rows, 'scrollUp').keys.includes('j'));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('j'));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('<c-e>'));
    rows = resolved('map z scrollUp\nunmapAll\nmap j scrollDown');
    assert.deepEqual(entry(rows, 'scrollDown').keys, ['j']);
    assert.deepEqual(entry(rows, 'scrollUp').keys, []);
    assert.deepEqual(entry(rows, 'visual:down').keys, ['j']);
    assert.deepEqual(entry(rows, 'vomnibar:confirm').keys, ['<enter>']);
  });

  it('map! 同時映射 Normal／Insert，而 :i 僅在 Insert', () => {
    const rows = resolved('unmapAll\nmap! <c-j> scrollDown\nmap <c-k:i> scrollUp');
    assert.deepEqual(entry(rows, 'scrollDown').keys, ['<c-j>', '<c-j:i>']);
    assert.deepEqual(
      entry(rows, 'scrollDown').bindings.map((binding) => binding.mode),
      ['normal', 'insert']
    );
    assert.deepEqual(entry(rows, 'scrollUp').keys, ['<c-k:i>']);
    assert.equal(entry(rows, 'scrollUp').bindings[0].mode, 'insert');
  });

  it('unmap 單獨刪 Normal；unmap! 同時刪 Normal／Insert', () => {
    const normalOnly = resolved('map! <c-j> scrollDown\nunmap <c-j>');
    assert.ok(entry(normalOnly, 'scrollDown').keys.includes('<c-j:i>'));
    assert.ok(!entry(normalOnly, 'scrollDown').keys.includes('<c-j>'));
    const both = resolved('map! <c-j> scrollDown\nunmap! <c-j>');
    assert.ok(!entry(both, 'scrollDown').keys.some((key) => key.startsWith('<c-j')));
  });

  it('map! 檢查的是 Normal 來源；可覆寫之前獨立定義的 Insert 配對', () => {
    const profile = plain(
      model.parseImport('unmapAll\nmap <c-j:i> scrollUp\nmap! <c-j> scrollDown')
    );
    assert.equal(profile.completeness, 'complete');
    const rows = plain(model.resolve(profile));
    assert.deepEqual(entry(rows, 'scrollDown').keys, ['<c-j:i>', '<c-j>']);
    assert.deepEqual(entry(rows, 'scrollUp').keys, []);
  });

  it('重複自訂 map 在檢查模式保留先前定義，#!no-check 則允許覆寫', () => {
    let profile = plain(model.parseImport('map z scrollDown\nmap z scrollUp'));
    assert.equal(profile.directives[1].status, 'rejected');
    let rows = plain(model.resolve(profile));
    assert.ok(entry(rows, 'scrollDown').keys.includes('z'));
    assert.ok(!entry(rows, 'scrollUp').keys.includes('z'));
    rows = resolved('#!no-check\nmap z scrollDown\nmap z scrollUp');
    assert.ok(entry(rows, 'scrollUp').keys.includes('z'));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('z'));
    rows = resolved('map z scrollDown\nunmap z\nmap z scrollUp');
    assert.ok(entry(rows, 'scrollUp').keys.includes('z'));
  });

  it('短前綴命令遮蔽長序列，不將無法觸發的 gg 顯示為有效', () => {
    const rows = resolved('map g scrollDown');
    assert.ok(entry(rows, 'scrollDown').keys.includes('g'));
    assert.deepEqual(entry(rows, 'scrollToTop').keys, []);
    assert.equal(entry(rows, 'scrollToTop').bindings[0].status, 'shadowed');
  });

  it('保留原始 options 與引號，不執行 JavaScript、HTML 或命令 URL', () => {
    const raw = 'map z openUrl url="javascript:globalThis.pwned=true" $desc="<img src=x>" # 註解';
    const profile = plain(model.parseImport(raw));
    assert.equal(profile.raw, raw);
    assert.equal(profile.directives[0].raw, raw);
    assert.equal(
      profile.directives[0].options,
      'url="javascript:globalThis.pwned=true" $desc="<img src=x>"'
    );
    assert.ok(entry(plain(model.resolve(profile)), 'openUrl').keys.includes('z'));
    assert.equal(Object.hasOwn(globalThis, 'pwned'), false);
  });
});

describe('Vimium C Companion：不確定內容保留、不冒充有效鍵位', () => {
  it('mapKey 以獨立轉譯列呈現，不杜撰反向鍵位；受影響的原鍵退出 keys', () => {
    const profile = plain(model.parseImport('mapKey j k'));
    const rows = plain(model.resolve(profile));
    const down = entry(rows, 'scrollDown');
    assert.ok(!down.keys.includes('j'));
    assert.equal(down.bindings.find((binding) => binding.key === 'j').status, 'translated');
    assert.ok(!entry(rows, 'scrollUp').keys.includes('j'));
    assert.ok(entry(rows, 'scrollUp').keys.includes('k'));
    assert.deepEqual(entry(rows, 'visual:down').keys, []);
    assert.equal(entry(rows, 'import:1').status, 'translation');
    assert.equal(profile.summary.translations, 1);
    assert.equal(profile.completeness, 'partial');
    assert.ok(!entry(rows, 'previousTab').keys.includes('J'));
    assert.ok(!entry(rows, 'vomnibar:next').keys.includes('<c-j>'));
  });

  it('mode-specific mapKey 只影響對應情境，unmapAll 清掉之前的轉譯', () => {
    let rows = resolved('mapKey <j:v> k');
    assert.deepEqual(entry(rows, 'visual:down').keys, []);
    assert.ok(entry(rows, 'scrollDown').keys.includes('j'));
    rows = resolved('map! <c-j> scrollDown\nmapKey <c-j:i> <c-k>');
    assert.ok(entry(rows, 'scrollDown').keys.includes('<c-j>'));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('<c-j:i>'));
    rows = resolved('mapKey j k\nunmapAll\nmap j scrollDown');
    assert.deepEqual(entry(rows, 'scrollDown').keys, ['j']);
    assert.deepEqual(entry(rows, 'visual:down').keys, ['j']);
  });

  it('條件分支只污染可能改變的鍵；原文含條件／env／workflow／unknown 不遺失', async () => {
    const raw = await fixture('conditional-workflows.txt');
    const profile = plain(model.parseImport(raw));
    assert.equal(profile.raw, raw);
    assert.equal(profile.completeness, 'partial');
    const rows = plain(model.resolve(profile));
    assert.ok(!entry(rows, 'scrollDown').keys.includes('j'));
    assert.ok(entry(rows, 'scrollDown').keys.includes('z'));
    assert.ok(entry(rows, 'scrollUp').keys.includes('k'));
    assert.ok(!entry(rows, 'scrollUp').keys.includes('j'));
    for (const directive of profile.directives.filter((line) =>
      ['workflow', 'environment', 'browser', 'unknown'].includes(line.kind)
    )) {
      assert.equal(entry(rows, `import:${directive.line}`).raw, directive.raw);
    }
    const workflow = profile.directives.find((line) => line.kind === 'workflow');
    assert.equal(entry(rows, `import:${workflow.line}`).bindings[0].status, 'shadowed');
    assert.deepEqual(entry(rows, `import:${workflow.line}`).keys, []);
  });

  it('可辨識的 runKey 保留為自訂流程，不假裝是它呼叫的某一個動作', () => {
    const rows = resolved('map zz runKey keys="j+f"\nrun zx j+f');
    assert.deepEqual(entry(rows, 'import:1').keys, ['zz']);
    assert.deepEqual(entry(rows, 'import:2').keys, ['zx']);
    assert.equal(entry(rows, 'import:1').status, 'workflow');
    assert.ok(!entry(rows, 'scrollDown').keys.includes('zz'));
    assert.match(entry(rows, 'import:2').description, /run zx j\+f/);
  });

  it('條件式 unmapAll 影響全域；明確 reset 後的新定義可重新確認', () => {
    let rows = resolved('map z scrollDown\n#if {"sys":"mac"}\nunmapAll\n#endif');
    assert.deepEqual(entry(rows, 'scrollDown').keys, []);
    rows = resolved('#if {"sys":"mac"}\nunmapAll\n#endif\nunmapAll\nmap z scrollDown');
    assert.deepEqual(entry(rows, 'scrollDown').keys, ['z']);
  });

  it('沒有閉合的 #if、行內 $if 與未知 native 命令均不產生假定的有效鍵', () => {
    let profile = plain(model.parseImport('#if mac\nmap j scrollUp'));
    assert.ok(profile.diagnostics.some((item) => item.message.includes('#endif')));
    assert.deepEqual(entry(plain(model.resolve(profile)), 'scrollDown').keys, []);
    let rows = resolved('map j scrollUp $if=mac');
    assert.ok(!entry(rows, 'scrollDown').keys.includes('j'));
    assert.ok(!entry(rows, 'scrollUp').keys.includes('j'));
    rows = resolved('map j Future.command');
    assert.ok(!entry(rows, 'scrollDown').keys.includes('j'));
    assert.deepEqual(entry(rows, 'import:1').keys, []);
  });

  it('版本、瀏覽器覆寫與自訂鍵盤布局不明時保留設定並標示限制', () => {
    for (const extra of [
      { environment: { extension: '99.0.0' } },
      { chrome: { keyMappings: 'unmapAll' } },
      { keyLayout: 0 },
    ]) {
      const profile = plain(model.parseImport(JSON.stringify({ name: 'Vimium C', ...extra })));
      assert.equal(profile.completeness, 'partial');
      assert.equal(profile.globalUncertainty, true);
      assert.deepEqual(entry(plain(model.resolve(profile)), 'scrollDown').keys, []);
    }
  });

  it('數字、Escape 特殊 unmap 與不支援 mode 保留診斷而非編造支援', () => {
    const profile = plain(
      model.parseImport('unmap 2\nmap 2 scrollDown\nunmap <esc>\nmap <j:v> scrollUp')
    );
    assert.equal(profile.completeness, 'partial');
    assert.equal(profile.directives.length, 4);
    assert.ok(profile.directives.every((line) => line.status === 'unresolved'));
    assert.ok(!entry(plain(model.resolve(profile)), 'scrollDown').keys.includes('2'));
  });
});
