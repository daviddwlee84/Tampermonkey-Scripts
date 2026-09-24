import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../userscripts/chat-reply-assistant/chat-reply-assistant.user.js', import.meta.url),
  'utf8'
);
const core = source.match(/\/\/ BEGIN CORE([\s\S]*?)\/\/ END CORE/)?.[1];
const providers = source.match(/\/\/ BEGIN PROVIDERS([\s\S]*?)\/\/ END PROVIDERS/)?.[1];
assert.ok(core, 'the delivered userscript must include its tested core');
assert.ok(providers, 'the delivered userscript must include its tested provider helpers');
const context = vm.createContext({ URL });
vm.runInContext(
  `${core}\n${providers}\nglobalThis.api = {CRA_PROVIDERS, CRA_JEV_PROVIDERS, providerDefaults, migrateSettings, deriveModelsUrl, parseModels, resolvedProfile, resolvedJev, effectiveKey};`,
  context
);
const api = context.api;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('provider defaults separate both Copilot servers and all credentials', () => {
  const defaults = api.providerDefaults();
  assert.equal(defaults.version, 2);
  assert.equal(defaults.provider, 'gemini');
  assert.equal(
    defaults.profiles['copilot-api'].endpoint,
    'http://localhost:4141/v1/chat/completions'
  );
  assert.equal(
    defaults.profiles['copilot-sdk'].endpoint,
    'http://localhost:3001/v1/chat/completions'
  );
  for (const profile of Object.values(defaults.profiles)) {
    assert.equal(profile.apiKey, '');
    assert.equal(profile.model, '');
    assert.equal(profile.vision, false);
  }
  defaults.profiles.gemini.apiKey = 'fixture-only';
  defaults.jev.profiles.typesafe.apiKey = 'different-fixture-key';
  assert.equal(api.providerDefaults().profiles.gemini.apiKey, '');
  assert.equal(api.providerDefaults().jev.profiles.typesafe.apiKey, '');
  assert.equal(defaults.jev.profiles.vercel.apiKey, '');
});

test('v1 Gemini migration preserves exact saved values and independent thread preferences', () => {
  const raw = {
    version: 1,
    preset: 'gemini',
    endpoint: api.CRA_PROVIDERS.gemini.endpoint,
    model: 'fixture-model',
    apiKey: 'fixture-api-key',
    systemPrompt: '',
    maxMessages: 80,
    maxChars: 15000,
    threads: { 'instagram:thread': { prompt: 'No punctuation', auto: true } },
    jev: { enabled: true, apiKey: 'fixture-jev-key', model: 'jev-fixture' },
  };
  const before = JSON.stringify(raw);
  const settings = api.migrateSettings(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(settings.profiles.gemini.apiKey, 'fixture-api-key');
  assert.equal(settings.profiles.gemini.model, 'fixture-model');
  assert.equal(settings.profiles.gemini.endpoint, raw.endpoint);
  assert.equal(settings.systemPrompt, '');
  assert.equal(settings.maxMessages, 80);
  assert.equal(settings.maxChars, 15000);
  assert.deepEqual(plain(settings.threads), raw.threads);
  settings.threads['instagram:thread'].auto = false;
  assert.equal(raw.threads['instagram:thread'].auto, true);
  assert.equal(settings.jev.enabled, true);
  assert.equal(settings.jev.provider, 'typesafe');
  assert.equal(settings.jev.profiles.typesafe.apiKey, 'fixture-jev-key');
  assert.equal(settings.jev.profiles.typesafe.model, 'jev-fixture');
  assert.equal(settings.jev.profiles.vercel.apiKey, '');
});

test('v1 Copilot migration recognizes loopback 4141 and 3001 without replacing custom paths', () => {
  const cases = [
    ['http://localhost:4141/v1/chat/completions', 'copilot-api'],
    ['http://127.0.0.1:4141/chat/completions/?tenant=example', 'copilot-api'],
    ['http://[::1]:3001/v1/chat/completions/', 'copilot-sdk'],
    ['https://private.example/gateway/v1/chat/completions', 'custom'],
    ['http://localhost:4141/team-a/v1/chat/completions', 'custom'],
    ['http://localhost:9876/v1/chat/completions', 'custom'],
  ];
  for (const [endpoint, provider] of cases) {
    const settings = api.migrateSettings({
      version: 1,
      preset: 'copilot',
      endpoint,
      apiKey: 'fixture',
      model: '',
    });
    assert.equal(settings.provider, provider);
    assert.equal(settings.profiles[provider].endpoint, endpoint);
    assert.equal(settings.profiles[provider].apiKey, 'fixture');
    assert.equal(settings.profiles[provider].model, '');
    assert.equal(settings.profiles.gemini.apiKey, '');
  }
});

test('v2 settings survive repeated normalization without sharing or transferring profile keys', () => {
  const original = api.providerDefaults();
  original.provider = 'custom';
  Object.assign(original.profiles.custom, {
    endpoint: 'https://proxy.example/team-a/chat/completions',
    modelsUrl: 'https://proxy.example/catalog',
    model: 'custom/model',
    apiKey: 'custom-key',
    vision: true,
  });
  original.profiles.gemini.apiKey = 'gemini-key';
  original.jev.provider = 'vercel';
  original.jev.profiles.vercel.apiKey = 'vercel-key';
  const normalized = api.migrateSettings(original);
  assert.deepEqual(plain(normalized), plain(original));
  assert.deepEqual(plain(api.migrateSettings(normalized)), plain(normalized));
  normalized.profiles.gemini.apiKey = 'replacement';
  assert.equal(original.profiles.gemini.apiKey, 'gemini-key');
  assert.equal(normalized.profiles.custom.apiKey, 'custom-key');
  assert.equal(normalized.jev.profiles.typesafe.apiKey, '');
});

test('malformed settings fall back safely while retaining editable incomplete configurations', () => {
  for (const raw of [null, [], 'wrong', { version: 99 }])
    assert.deepEqual(plain(api.migrateSettings(raw)), plain(api.providerDefaults()));
  const normalized = api.migrateSettings({
    version: 2,
    provider: '__proto__',
    profiles: { gemini: { model: '', vision: 'yes' } },
    maxMessages: 999,
    maxChars: -1,
    threads: [],
    jev: { provider: 'constructor', enabled: 'true' },
  });
  assert.equal(normalized.provider, 'gemini');
  assert.equal(normalized.profiles.gemini.model, '');
  assert.equal(normalized.profiles.gemini.vision, false);
  assert.equal(normalized.maxMessages, 200);
  assert.equal(normalized.maxChars, 500);
  assert.deepEqual(plain(normalized.threads), {});
  assert.equal(normalized.jev.provider, 'typesafe');
  assert.equal(normalized.jev.enabled, false);
});

test('model-list URLs preserve deployment prefixes, queries, and loopback endpoints', () => {
  const cases = [
    [api.CRA_PROVIDERS.gemini.endpoint, api.CRA_PROVIDERS.gemini.modelsUrl],
    ['http://localhost:4141/v1/chat/completions', 'http://localhost:4141/v1/models'],
    ['http://localhost:4000/chat/completions/', 'http://localhost:4000/models'],
    ['http://[::1]:3001/v1/chat/completions', 'http://[::1]:3001/v1/models'],
    [
      'https://gateway.example/team-a/v2/chat/completions/?version=demo',
      'https://gateway.example/team-a/v2/models?version=demo',
    ],
  ];
  for (const [endpoint, expected] of cases) assert.equal(api.deriveModelsUrl(endpoint), expected);
  assert.equal(
    api.deriveModelsUrl(
      'https://gateway.example/generate',
      'https://gateway.example/catalog?team=a'
    ),
    'https://gateway.example/catalog?team=a'
  );
});

test('model diagnostics reject guessed routes, remote HTTP, and cross-origin credential forwarding', () => {
  const endpoint = 'https://gateway.example/team/chat/completions';
  assert.throws(() => api.deriveModelsUrl('https://gateway.example/generate'), /模型清單 URL/);
  assert.throws(() => api.deriveModelsUrl(endpoint, 'https://other.example/models'), /同源/);
  assert.throws(() => api.deriveModelsUrl(endpoint, 'https://gateway.example:9443/models'), /同源/);
  assert.throws(() => api.deriveModelsUrl('http://remote.example/chat/completions'), /HTTPS/);
  assert.throws(() => api.deriveModelsUrl(endpoint, '/models'), /完整/);
  assert.throws(
    () => api.deriveModelsUrl('https://user:password@gateway.example/chat/completions'),
    /帳密/
  );
  assert.throws(
    () => api.deriveModelsUrl(endpoint, 'https://gateway.example/models#fragment'),
    /HTTPS/
  );
});

test('effective keys are scoped to origin and API base path, with explicit replacement supported', () => {
  const profile = {
    endpoint: 'https://gateway.example/team-a/v1/chat/completions',
    apiKey: 'saved-fixture-key',
  };
  assert.equal(api.effectiveKey(profile, `${profile.endpoint}/?version=next`), 'saved-fixture-key');
  assert.equal(
    api.effectiveKey(profile, 'https://gateway.example:443/team-a/v1/chat/completions'),
    'saved-fixture-key'
  );
  for (const endpoint of [
    'https://other.example/team-a/v1/chat/completions',
    'https://gateway.example/team-b/v1/chat/completions',
    'https://gateway.example/team-a/v2/chat/completions',
    'https://gateway.example:8443/team-a/v1/chat/completions',
  ])
    assert.equal(api.effectiveKey(profile, endpoint, '  '), '');
  assert.equal(
    api.effectiveKey(profile, 'https://other.example/v1/chat/completions', ' new-key '),
    'new-key'
  );
  assert.equal(api.effectiveKey({ endpoint: 'bad', apiKey: 'old' }, profile.endpoint), '');
  assert.throws(
    () => api.effectiveKey(profile, 'http://remote.example/chat/completions', 'new-key'),
    /HTTPS/
  );
});

test('profiles resolve fixed provider metadata without exposing another provider key', () => {
  const settings = api.providerDefaults();
  settings.profiles.gemini.apiKey = 'gemini-fixture';
  settings.profiles['copilot-api'].model = 'copilot-fixture';
  const copilot = api.resolvedProfile(settings, 'copilot-api');
  assert.equal(copilot.endpoint, api.CRA_PROVIDERS['copilot-api'].endpoint);
  assert.equal(copilot.model, 'copilot-fixture');
  assert.equal(copilot.apiKey, '');
  assert.equal(
    copilot.modelsUrl,
    '',
    'blank override is derived only when a diagnostic is requested'
  );
  settings.jev.provider = 'vercel';
  settings.jev.profiles.typesafe.apiKey = 'typesafe-only';
  settings.jev.profiles.vercel.apiKey = 'gateway-only';
  const jev = api.resolvedJev(settings);
  assert.equal(jev.endpoint, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  assert.equal(jev.modelsUrl, 'https://ai-gateway.vercel.sh/typesafe/v1/models');
  assert.equal(jev.model, 'typesafe-ai/jev');
  assert.equal(jev.apiKey, 'gateway-only');
  assert.equal(api.resolvedProfile(settings, 'constructor').id, 'gemini');
});

test('model parsing uses official IDs and display labels without inferring vision support', () => {
  const result = api.parseModels({
    object: 'list',
    data: [
      { id: 'vendor/model', display_name: 'Friendly name', capabilities: { vision: true } },
      { id: 'vendor/model', display_name: 'Duplicate' },
      { id: 'other', name: 'Other name' },
      { id: 'raw-id' },
      { id: '' },
      { id: 123 },
      null,
    ],
  });
  assert.deepEqual(plain(result), [
    { id: 'vendor/model', label: 'Friendly name' },
    { id: 'other', label: 'Other name' },
    { id: 'raw-id', label: 'raw-id' },
  ]);
  assert.deepEqual(plain(api.parseModels({ models: ['jev-latest', { id: 'typesafe-ai/jev' }] })), [
    { id: 'jev-latest', label: 'jev-latest' },
    { id: 'typesafe-ai/jev', label: 'typesafe-ai/jev' },
  ]);
  assert.deepEqual(
    plain(
      api.parseModels({
        models: [{ name: 'models/gemini-fixture', displayName: 'Fixture Gemini' }],
      })
    ),
    [{ id: 'models/gemini-fixture', label: 'Fixture Gemini' }]
  );
});

test('empty and malformed model catalogs are distinguished, unsafe-looking labels remain data', () => {
  assert.deepEqual(plain(api.parseModels({ data: [] })), []);
  assert.throws(() => api.parseModels({ data: {} }), /格式錯誤/);
  assert.throws(() => api.parseModels({ error: 'unauthorized' }), /格式錯誤/);
  assert.throws(() => api.parseModels({ data: [{ id: ' ' }, { id: '\n' }] }), /有效/);
  assert.deepEqual(
    plain(api.parseModels([{ id: 'valid', display_name: '<img src=x onerror=alert(1)>' }])),
    [{ id: 'valid', label: '<img src=x onerror=alert(1)>' }]
  );
});
