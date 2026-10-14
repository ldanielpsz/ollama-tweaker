const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PresetCatalog } = require('../src/services/PresetCatalog');

test('exposes the three original wrapper presets and the quant tags', () => {
  const c = new PresetCatalog();
  assert.deepEqual(Object.keys(c.presets), ['default', 'memory_optimized', 'high_quality']);
  assert.ok(c.quants.includes('q4_0') && c.quants.includes('fp16'));
});

test('memory_optimized shrinks context and raises repeat penalty (generateMemoryOptimized)', () => {
  const o = new PresetCatalog().options('memory_optimized');
  assert.equal(o.num_ctx, 1024);
  assert.equal(o.repeat_penalty, 1.1);
});

test('high_quality widens context and sampling (generateHighQuality)', () => {
  const o = new PresetCatalog().options('high_quality');
  assert.equal(o.num_ctx, 2048);
  assert.equal(o.top_p, 0.95);
});

test('unknown or missing preset falls back to default', () => {
  const c = new PresetCatalog();
  assert.deepEqual(c.options('nope'), c.presets.default);
  assert.deepEqual(c.options(undefined), c.presets.default);
});

test('options() returns a copy, so callers cannot mutate the catalog', () => {
  const c = new PresetCatalog();
  const o = c.options('default');
  o.temperature = 99;
  assert.equal(c.presets.default.temperature, 0.7);
});
