const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SchemaService } = require('../src/services/SchemaService');
const { PresetCatalog } = require('../src/services/PresetCatalog');
const { bootstrap } = require('../src/bootstrap');

test('describe() publishes every strategy definition plus presets and quants', () => {
  const req = { schema: () => ({ id: 'r1' }) };
  const srv = { schema: () => ({ id: 's1' }) };
  const presets = new PresetCatalog();
  const out = new SchemaService({ requestStrategies: [req], serverStrategies: [srv], presets }).describe();
  assert.deepEqual(out.request, [{ id: 'r1' }]);
  assert.deepEqual(out.server, [{ id: 's1' }]);
  assert.equal(out.presets, presets.presets);
  assert.equal(out.quants, presets.quants);
});

test('wired container publishes all parameter sets with valid layouts', () => {
  const c = bootstrap({ port: 0, ollamaUrl: 'http://127.0.0.1:1', ollamaContainer: 'x', dockerSock: '/none', dataDir: require('node:os').tmpdir(), publicDir: '.', bucketMs: 500 });
  const d = c.resolve('schemaService').describe();
  assert.deepEqual(d.request.map((s) => s.id), ['context', 'sampling', 'sampling_advanced', 'hardware']);
  assert.deepEqual(d.server.map((s) => s.id), ['kvcache', 'capacity', 'memory', 'lifecycle']);
  for (const set of [...d.request, ...d.server]) {
    const keys = new Set(set.fields.map((f) => f.key));
    for (const [key, span] of set.layout) {
      assert.ok(keys.has(key), `${set.id}: layout key ${key} has a field`);
      assert.ok(span >= 1 && span <= 12);
    }
    for (const f of set.fields) assert.ok(set.layout.some(([k]) => k === f.key), `${set.id}.${f.key} appears in layout`);
  }
});

test('request and server field keys never collide within their own scope', () => {
  const c = bootstrap({ port: 0, ollamaUrl: 'http://127.0.0.1:1', ollamaContainer: 'x', dockerSock: '/none', dataDir: require('node:os').tmpdir(), publicDir: '.', bucketMs: 500 });
  const d = c.resolve('schemaService').describe();
  for (const scope of ['request', 'server']) {
    const keys = d[scope].flatMap((s) => s.fields.map((f) => f.key));
    assert.equal(new Set(keys).size, keys.length, `${scope} keys are unique`);
  }
});
