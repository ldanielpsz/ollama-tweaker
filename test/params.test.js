const { test } = require('node:test');
const assert = require('node:assert/strict');
const fieldTypes = require('../src/params/fieldTypes');
const { ParamStrategy } = require('../src/params/ParamStrategy');
const { RequestParamStrategy } = require('../src/params/RequestParamStrategy');
const { EnvParamStrategy } = require('../src/params/EnvParamStrategy');
const { KvCacheStrategy } = require('../src/params/KvCacheStrategy');
const { Container } = require('../src/core/Container');

const f = (over) => ({ key: 'k', ...over });

// ---- field types ----

test('int: empty -> undefined, enforces integer and bounds', () => {
  assert.equal(fieldTypes.int.parse('', f({})), undefined);
  assert.equal(fieldTypes.int.parse('42', f({})), 42);
  assert.equal(fieldTypes.int.parse('-1', f({ min: -1 })), -1);
  assert.throws(() => fieldTypes.int.parse('-1', f({})), /k must be an integer >= 0/);
  assert.throws(() => fieldTypes.int.parse('1.5', f({})), /integer/);
  assert.throws(() => fieldTypes.int.parse('abc', f({})), /integer/);
  assert.throws(() => fieldTypes.int.parse('9', f({ max: 5 })), /<= 5/);
});

test('number: allows decimals and checks range', () => {
  assert.equal(fieldTypes.number.parse('0.95', f({ min: 0, max: 1 })), 0.95);
  assert.throws(() => fieldTypes.number.parse('1.5', f({ max: 1 })), /<= 1/);
  assert.equal(fieldTypes.number.parse(undefined, f({})), undefined);
});

test('duration: validates Go-style durations; bare integers become numbers', () => {
  assert.equal(fieldTypes.duration.parse('5m', f({})), '5m');
  assert.equal(fieldTypes.duration.parse('1h30m', f({})), '1h30m');
  assert.equal(fieldTypes.duration.parse('-1', f({})), -1);
  assert.equal(fieldTypes.duration.parse('0', f({})), 0);
  assert.equal(fieldTypes.duration.parse('', f({})), undefined);
  assert.throws(() => fieldTypes.duration.parse('soon', f({})), /5m, 24h, 0 or -1/);
});

test('select: only declared options; cast=number converts', () => {
  const field = f({ options: [{ value: '' }, { value: 'on' }, { value: 'off' }] });
  assert.equal(fieldTypes.select.parse('on', field), 'on');
  assert.equal(fieldTypes.select.parse('', field), undefined);
  assert.throws(() => fieldTypes.select.parse('maybe', field), /one of: on, off/);
  assert.equal(fieldTypes.select.parse('2', f({ cast: 'number', options: [{ value: 0 }, { value: 2 }] })), 2);
});

test('tribool: default / true / false', () => {
  assert.equal(fieldTypes.tribool.parse('', f({})), undefined);
  assert.equal(fieldTypes.tribool.parse('true', f({})), true);
  assert.equal(fieldTypes.tribool.parse(false, f({})), false);
  assert.throws(() => fieldTypes.tribool.parse('yes', f({})), /true or false/);
});

test('bool: parse and env round-trip', () => {
  assert.equal(fieldTypes.bool.parse(true), true);
  assert.equal(fieldTypes.bool.parse('1'), true);
  assert.equal(fieldTypes.bool.parse(false), false);
  assert.equal(fieldTypes.bool.parse(undefined), undefined);
  assert.equal(fieldTypes.bool.toEnv(true), '1');
  assert.equal(fieldTypes.bool.fromEnv('0'), false);
  assert.equal(fieldTypes.bool.fromEnv('true'), true);
});

test('list: comma text or array -> trimmed non-empty strings', () => {
  assert.deepEqual(fieldTypes.list.parse(' ###, END ,, ', f({})), ['###', 'END']);
  assert.deepEqual(fieldTypes.list.parse(['a', ' ', 'b'], f({})), ['a', 'b']);
  assert.equal(fieldTypes.list.parse(' , ', f({})), undefined);
  assert.equal(fieldTypes.list.parse('', f({})), undefined);
});

// ---- strategies ----

const def = {
  id: 'demo', scope: 'request', title: 'Demo',
  fields: [
    { key: 'num_ctx', type: 'int' },
    { key: 'keep_alive', type: 'duration', target: 'payload' },
    { key: 'stop', type: 'list' },
  ],
  layout: [['num_ctx', 6], ['keep_alive', 6], ['stop', 12]],
};

test('ParamStrategy: rejects unknown field types, unknown layout keys and bad spans', () => {
  assert.throws(() => new ParamStrategy({ definition: { ...def, fields: [{ key: 'a', type: 'nope' }], layout: [['a', 6]] } }), /unknown field type/);
  assert.throws(() => new ParamStrategy({ definition: { ...def, layout: [['ghost', 6]] } }), /unknown field "ghost"/);
  assert.throws(() => new ParamStrategy({ definition: { ...def, layout: [['num_ctx', 13]] } }), /span must be 1-12/);
});

test('RequestParamStrategy: parse keeps only provided, non-empty values', () => {
  const s = new RequestParamStrategy({ definition: def });
  assert.deepEqual(s.parse({ num_ctx: '2048', keep_alive: '', stop: 'a,b', other: 'ignored' }), { num_ctx: 2048, stop: ['a', 'b'] });
  assert.deepEqual(s.parse(), {});
});

test('RequestParamStrategy: apply routes by field target', () => {
  const s = new RequestParamStrategy({ definition: def });
  const payload = s.apply({ options: { temperature: 0.7 } }, { num_ctx: 512, keep_alive: -1 });
  assert.deepEqual(payload, { options: { temperature: 0.7, num_ctx: 512 }, keep_alive: -1 });
});

const envDef = {
  id: 'env', scope: 'server', title: 'Env',
  fields: [
    { key: 'kv_cache_type', type: 'select', env: 'OLLAMA_KV_CACHE_TYPE', default: 'f16', alwaysWrite: true,
      options: [{ value: 'f16' }, { value: 'q8_0' }, { value: 'q4_0' }] },
    { key: 'flash_attention', type: 'bool', env: 'OLLAMA_FLASH_ATTENTION' },
    { key: 'max_queue', type: 'int', env: 'OLLAMA_MAX_QUEUE' },
  ],
  layout: [['kv_cache_type', 6], ['flash_attention', 6], ['max_queue', 6]],
};

test('EnvParamStrategy: fromEnv applies defaults and types', () => {
  const s = new EnvParamStrategy({ definition: envDef });
  const env = { OLLAMA_MAX_QUEUE: '10', OLLAMA_FLASH_ATTENTION: '1' };
  assert.deepEqual(s.fromEnv((n) => env[n] ?? null), { kv_cache_type: 'f16', flash_attention: true, max_queue: 10 });
  assert.deepEqual(s.fromEnv(() => null), { kv_cache_type: 'f16', flash_attention: false, max_queue: null });
});

test('EnvParamStrategy: parsePartial only touches provided keys; empty means null', () => {
  const s = new EnvParamStrategy({ definition: envDef });
  assert.deepEqual(s.parsePartial({ max_queue: '', flash_attention: true }), { max_queue: null, flash_attention: true });
  assert.deepEqual(s.parsePartial({}), {});
  assert.throws(() => s.parsePartial({ max_queue: 'x' }), /max_queue/);
});

test('EnvParamStrategy: toEnv writes bools always, alwaysWrite defaults, and skips nulls', () => {
  const s = new EnvParamStrategy({ definition: envDef });
  assert.deepEqual(s.toEnv({ kv_cache_type: null, flash_attention: false, max_queue: null }),
    [['OLLAMA_KV_CACHE_TYPE', 'f16'], ['OLLAMA_FLASH_ATTENTION', '0']]);
  assert.deepEqual(s.toEnv({ kv_cache_type: 'q8_0', flash_attention: true, max_queue: 3 }),
    [['OLLAMA_KV_CACHE_TYPE', 'q8_0'], ['OLLAMA_FLASH_ATTENTION', '1'], ['OLLAMA_MAX_QUEUE', '3']]);
  assert.deepEqual(s.envNames(), ['OLLAMA_KV_CACHE_TYPE', 'OLLAMA_FLASH_ATTENTION', 'OLLAMA_MAX_QUEUE']);
});

test('KvCacheStrategy: only quantized types force flash attention', () => {
  const s = new KvCacheStrategy({ definition: envDef });
  assert.equal(s.normalize({ kv_cache_type: 'q4_0', flash_attention: false }).flash_attention, true);
  assert.equal(s.normalize({ kv_cache_type: 'q8_0', flash_attention: false }).flash_attention, true);
  assert.equal(s.normalize({ kv_cache_type: 'f16', flash_attention: false }).flash_attention, false);
  assert.equal(s.normalize({ kv_cache_type: 'f16', flash_attention: true }).flash_attention, true);
});

// ---- container ----

test('Container: values, class bindings with named deps, singletons and tags', () => {
  class A { constructor({ cfg }) { this.cfg = cfg; } }
  class B { constructor({ a, items }) { this.a = a; this.items = items; } }
  const c = new Container();
  c.value('cfg', { x: 1 }).value('i1', 'one').value('i2', 'two');
  c.bind('a', A, { cfg: 'cfg' }).bind('b', B, { a: 'a', items: '#items' });
  c.tag('items', ['i1']).tag('items', ['i2']);
  const b = c.resolve('b');
  assert.equal(b.a.cfg.x, 1);
  assert.deepEqual(b.items, ['one', 'two']);
  assert.equal(c.resolve('a'), c.resolve('a'), 'singleton');
});

test('Container: unknown tokens and circular dependencies fail loudly', () => {
  class X { constructor() {} }
  const c = new Container();
  assert.throws(() => c.resolve('missing'), /nothing bound for "missing"/);
  c.bind('p', X, { q: 'q' }).bind('q', X, { p: 'p' });
  assert.throws(() => c.resolve('p'), /circular dependency/);
  assert.deepEqual(c.resolveTagged('none'), []);
});
