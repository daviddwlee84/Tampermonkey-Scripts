import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../userscripts/clean-share-helper/clean-share-helper.user.js', import.meta.url),
  'utf8'
);
const core = source.match(/\/\/ BEGIN CORE([\s\S]*?)\/\/ END CORE/)?.[1];
assert.ok(core, 'test the core from the delivered userscript');
const context = vm.createContext({ URL });
vm.runInContext(`${core}\nglobalThis.api = { cleanUrl, siteFor, contentLink };`, context);
const { cleanUrl, siteFor, contentLink } = context.api;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('removes global trackers without discarding unknown query fields or hash routes', () => {
  const result = cleanUrl(
    'https://example.test/path?utm_souce=wechat&utm_source=mail&FBCLID=foo&gclid=bar&item=17#section?utm_source=keep'
  );
  assert.equal(result.url, 'https://example.test/path?item=17#section?utm_source=keep');
  assert.deepEqual(plain(result.removed.map((item) => item.name)), [
    'utm_souce',
    'utm_source',
    'FBCLID',
    'gclid',
  ]);
  assert.equal(result.error, '');
});

test('site rules apply only to the real site and its subdomains', () => {
  const cases = [
    [
      'https://www.threads.com/@alice/post/ABC?xmt=X&foo=1',
      'https://www.threads.com/@alice/post/ABC?foo=1',
    ],
    ['https://threads.net/@alice/post/ABC?igsh=Y&xmt=X', 'https://threads.net/@alice/post/ABC'],
    [
      'https://www.instagram.com/reel/ABC/?igsh=Y&igshid=X&img_index=2',
      'https://www.instagram.com/reel/ABC/?img_index=2',
    ],
    [
      'https://www.facebook.com/permalink.php?story_fbid=123&id=45&mibextid=X&__cft__=Y&__tn__=Z',
      'https://www.facebook.com/permalink.php?story_fbid=123&id=45',
    ],
    [
      'https://www.youtube.com/watch?v=ABC&si=X&feature=shared&t=130&list=PL1&index=3',
      'https://www.youtube.com/watch?v=ABC&t=130&list=PL1&index=3',
    ],
    ['https://youtu.be/ABC?si=X&t=90', 'https://youtu.be/ABC?t=90'],
    [
      'https://example.test/?si=X&xmt=Y&igsh=Z&feature=keep&ref=keep',
      'https://example.test/?si=X&xmt=Y&igsh=Z&feature=keep&ref=keep',
    ],
    [
      'https://youtube.com.attacker.test/watch?v=ABC&si=X',
      'https://youtube.com.attacker.test/watch?v=ABC&si=X',
    ],
  ];
  for (const [raw, expected] of cases) assert.equal(cleanUrl(raw).url, expected, raw);
  assert.equal(siteFor('www.threads.net'), 'threads');
  assert.equal(siteFor('notinstagram.com'), null);
});

test('preserves WeChat article identity, access parameters, and fragments', () => {
  const raw =
    'https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&mid=123&idx=1&sn=xyz&chksm=abc&scene=27&pass_ticket=access&utm_medium=social#wechat_redirect';
  assert.equal(cleanUrl(raw).url, raw.replace('&utm_medium=social', ''));
});

test('retained query fields keep exact bytes, duplicate values, empty fields and malformed escapes', () => {
  const result = cleanUrl(
    'https://example.test/a?x=a%20b&x=c+d&&%75tm_source=mail&bare&empty=&raw=%ZZ&x=%2f#h'
  );
  assert.equal(result.url, 'https://example.test/a?x=a%20b&x=c+d&&bare&empty=&raw=%ZZ&x=%2f#h');
  assert.equal(cleanUrl('https://example.test/a?#h').url, 'https://example.test/a?#h');
  assert.equal(
    cleanUrl('https://example.test/a?utm_source=mail#h').url,
    'https://example.test/a#h'
  );
});

test('recognized signed URLs remain exactly unchanged even with global tracking fields', () => {
  for (const key of [
    'sig',
    'signature',
    'X-Amz-Signature',
    'X-Goog-Signature',
    'oauth_signature',
    'hmac',
  ]) {
    const raw = `https://cdn.test/a?utm_source=x&${key}=a%2Fb&x=1`;
    const result = cleanUrl(raw);
    assert.equal(result.url, raw);
    assert.equal(result.removed.length, 0);
    assert.match(result.warnings[0], /簽章/);
  }
});

test('unwraps known nested redirect wrappers locally and cleans the actual destination', () => {
  const target = 'https://youtu.be/ABC?si=tracking&t=45#chapter';
  const ig = `https://l.instagram.com/?u=${encodeURIComponent(target)}&fbclid=x`;
  const raw = `https://l.facebook.com/l.php?u=${encodeURIComponent(ig)}&utm_source=foo`;
  const result = cleanUrl(raw);
  assert.equal(result.original, raw);
  assert.equal(result.url, 'https://youtu.be/ABC?t=45#chapter');
  assert.equal(result.unwrapped.length, 2);
  assert.deepEqual(plain(result.removed.map((item) => item.name)), ['utm_source', 'fbclid', 'si']);
});

test('does not unwrap unrelated parameters, invalid destinations or signed wrappers', () => {
  const cases = [
    'https://example.test/?u=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3DABC',
    'https://l.facebook.com/l.php?u=javascript%3Aalert(1)',
    'https://l.instagram.com/?u=https%3A%2F%2Fuser%3Apassword%40example.test%2F',
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.test%2F&sig=keep',
  ];
  for (const raw of cases) assert.equal(cleanUrl(raw).url, raw);
});

test('rejects non-HTTP, relative, multiline and invalid URLs without producing a destination', () => {
  for (const raw of [
    '',
    'words',
    '/watch?v=ABC',
    'ftp://example.test/',
    'javascript:alert(1)',
    'https://a.test/\nhttps://b.test/',
    'https://',
  ]) {
    assert.ok(cleanUrl(raw).error, raw);
  }
  assert.equal(cleanUrl('  https://example.test/?utm_source=x  ').url, 'https://example.test/');
});

test('cleaning is idempotent and clean links are unchanged', () => {
  for (const raw of [
    'https://www.youtube.com/watch?v=ABC&si=x&t=45',
    'https://www.threads.net/@a/post/ABC?xmt=x#replies',
    'https://example.test/?a=%20&a=+&empty=#hash',
    'https://example.test/path?',
    'https://example.test/?sig=x&utm_source=keep',
  ]) {
    const once = cleanUrl(raw).url;
    assert.equal(cleanUrl(once).url, once);
    assert.equal(cleanUrl(once).removed.length, 0);
  }
});

test('cleans eight nested wrappers, but retains the original for excessive chains', () => {
  let raw = 'https://youtu.be/ABC?si=x&t=25';
  for (let i = 0; i < 8; i++) raw = `https://l.instagram.com/?u=${encodeURIComponent(raw)}`;
  assert.equal(cleanUrl(raw).url, 'https://youtu.be/ABC?t=25');
  raw = `https://l.instagram.com/?u=${encodeURIComponent(raw)}&utm_source=x`;
  const result = cleanUrl(raw);
  assert.equal(result.url, raw);
  assert.equal(result.removed.length, 0);
  assert.equal(result.unwrapped.length, 0);
  assert.match(result.warnings[0], /八層/);
  assert.equal(cleanUrl(result.url).url, raw);
});

test('contentLink recognizes actual post routes and rejects other sites, profiles and directories', () => {
  const cases = [
    ['https://www.threads.com/@alice/post/ABC?xmt=x', 'threads', 'threads:alice/ABC'],
    ['https://www.instagram.com/reel/ABC/?igsh=x', 'instagram', 'instagram:ABC'],
    ['https://www.instagram.com/p/ABC/', 'instagram', 'instagram:ABC'],
    ['https://www.instagram.com/instagram/reel/ABC/', 'instagram', 'instagram:ABC'],
    ['https://www.facebook.com/user/posts/pfbidABC?fbclid=x', 'facebook', 'facebook:pfbidABC'],
    ['https://www.facebook.com/permalink.php?story_fbid=123&id=45', 'facebook', 'facebook:123'],
    ['https://www.facebook.com/reel/123/', 'facebook', 'facebook:123'],
    ['https://www.facebook.com/watch/?v=123', 'facebook', 'facebook:123'],
    ['https://www.youtube.com/watch?v=ABC&t=10', 'youtube', 'youtube:ABC'],
    ['https://www.youtube.com/shorts/ABC', 'youtube', 'youtube:ABC'],
    ['https://youtu.be/ABC?si=x', 'youtube', 'youtube:ABC'],
  ];
  for (const [raw, site, key] of cases) assert.equal(contentLink(raw, site)?.key, key, raw);
  assert.equal(
    contentLink('/@alice/post/ABC', 'threads', 'https://www.threads.com/').key,
    'threads:alice/ABC'
  );
  for (const [raw, site] of [
    ['https://www.threads.com/@alice', 'threads'],
    ['https://www.instagram.com/reels/', 'instagram'],
    ['https://www.facebook.com/user', 'facebook'],
    ['https://www.youtube.com/watch?si=x', 'youtube'],
    ['https://youtube.com.attacker.test/watch?v=ABC', 'youtube'],
    ['https://www.instagram.com/p/ABC/', 'threads'],
  ])
    assert.equal(contentLink(raw, site), null, raw);
});
