const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GenerateService } = require('../src/services/GenerateService');
const { PresetCatalog } = require('../src/services/PresetCatalog');
const { RequestParamStrategy } = require('../src/params/RequestParamStrategy');
const definitions = require('../src/params/definitions/request');
const { fakeRes, fakeUpstream, waitFor } = require('./helpers');

function setup({ memory = { vram: 4e9, size: 16e9 }, serverSnapshot = { kv_cache_type: 'q8_0' } } = {}) {
  const added = [];
  const posts = [];
  const handle = { upstream: null, req: null, errorOnPost: null };
  const ollama = {
    memorySample: async () => memory,
    post(path, body, cb) {
      posts.push({ path, body });
      const req = new EventEmitter();
      req.destroyed = false;
      req.destroy = () => { req.destroyed = true; };
      handle.req = req;
      queueMicrotask(() => {
        if (handle.errorOnPost) req.emit('error', handle.errorOnPost);
        else cb(handle.upstream);
      });
      return req;
    },
  };
  const svc = new GenerateService({
    ollama,
    runStore: { add: (r) => added.push(r) },
    presets: new PresetCatalog(),
    requestStrategies: definitions.map((definition) => new RequestParamStrategy({ definition })),
    serverSettings: { snapshot: () => serverSnapshot },
    config: { bucketMs: 10 },
  });
  return { svc, added, posts, handle };
}

const ndjson = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const done = { done: true, eval_count: 2, eval_duration: 1e9, prompt_eval_count: 5, prompt_eval_duration: 1e8, load_duration: 5e8, total_duration: 2e9 };

// ---- buildPayload ----

test('buildPayload: preset options, request params and system prompt are merged', () => {
  const { svc } = setup();
  const p = svc.buildPayload({
    model: 'model-a:q4', prompt: 'hi', system: 'be terse', preset: 'memory_optimized',
    params: { num_ctx: '2048', top_k: '20', stop: '###, END', use_mmap: 'false', mirostat: '2', temperature: '' },
  });
  assert.equal(p.model, 'model-a:q4');
  assert.equal(p.stream, true);
  assert.equal(p.system, 'be terse');
  assert.deepEqual(p.options, {
    temperature: 0.7, top_p: 0.9, num_predict: 128, num_ctx: 2048, repeat_penalty: 1.1, // preset, num_ctx overridden
    top_k: 20, stop: ['###', 'END'], use_mmap: false, mirostat: 2,
  });
});

test('buildPayload: payload-targeted fields land at the top level, not in options', () => {
  const { svc } = setup();
  const p = svc.buildPayload({ model: 'm', prompt: 'p', params: { keep_alive: '-1', format: 'json' } });
  assert.equal(p.keep_alive, -1);          // number: Ollama rejects "-1" as a string
  assert.equal(p.format, 'json');
  assert.equal('keep_alive' in p.options, false);
});

test('buildPayload: empty params change nothing and text format is omitted', () => {
  const { svc } = setup();
  const p = svc.buildPayload({ model: 'm', prompt: 'p', params: { format: '', keep_alive: '' } });
  assert.deepEqual(p.options, new PresetCatalog().options('default'));
  assert.equal('format' in p, false);
  assert.equal('keep_alive' in p, false);
});

test('buildPayload: model can be composed from base + quant', () => {
  const { svc } = setup();
  assert.equal(svc.buildPayload({ base: 'model-a', quant: 'q4_0', prompt: 'p' }).model, 'model-a:q4_0');
  assert.equal(svc.buildPayload({ base: 'model-a', prompt: 'p' }).model, 'model-a');
});

test('buildPayload: validation failures are 400s', () => {
  const { svc } = setup();
  assert.throws(() => svc.buildPayload({ model: 'm' }), { status: 400, message: 'prompt required' });
  assert.throws(() => svc.buildPayload({ prompt: 'p' }), { status: 400, message: 'model or base required' });
  assert.throws(() => svc.buildPayload({ model: 'm', prompt: 'p', params: { top_p: '7' } }), { status: 400, message: /top_p/ });
  assert.throws(() => svc.buildPayload({ model: 'm', prompt: 'p', params: { num_ctx: 'abc' } }), { status: 400, message: /num_ctx/ });
});

// ---- handle ----

test('handle: streams NDJSON to the client and records a run with metrics', async () => {
  const { svc, added, posts, handle } = setup();
  handle.upstream = fakeUpstream(200);
  const res = fakeRes();
  svc.handle({}, res, { model: 'm:q4_0', prompt: 'hi', preset: 'high_quality', params: { num_ctx: '4096' } });

  await waitFor(() => handle.upstream && res.headersSent);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/x-ndjson');
  assert.match(res.headers['x-run-id'], /^[0-9a-f-]{36}$/);

  handle.upstream.write(ndjson({ response: 'he' }, { response: 'llo' }));
  handle.upstream.write(JSON.stringify(done).slice(0, 10));     // split across chunks
  handle.upstream.end(JSON.stringify(done).slice(10) + '\n');
  await waitFor(() => added.length === 1);

  assert.equal(posts[0].path, '/api/generate');
  assert.equal(posts[0].body.options.num_ctx, 4096);
  assert.equal(posts[0].body.options.top_p, 0.95); // high_quality preset
  assert.equal(res.text(), ndjson({ response: 'he' }, { response: 'llo' }) + JSON.stringify(done) + '\n');

  const run = added[0];
  assert.equal(run.id, res.headers['x-run-id']);
  assert.equal(run.model, 'm:q4_0');
  assert.equal(run.preset, 'high_quality');
  assert.deepEqual(run.server, { kv_cache_type: 'q8_0' });
  assert.equal(run.gen.tokens, 2);
  assert.equal(run.gen.avg, 2);
  assert.equal(run.prompt_eval.tps, 50);
  assert.equal(run.response_chars, 5);
  assert.equal(run.aborted, false);
  assert.deepEqual(run.offload, { total_bytes: 16e9, vram_bytes: 4e9, ram_bytes: 12e9, gpu_pct: 25 });
});

test('handle: bad requests are answered with JSON errors and nothing is sent upstream', () => {
  const { svc, posts } = setup();
  const res = fakeRes();
  svc.handle({}, res, { model: 'm' });
  assert.equal(res.status, 400);
  assert.equal(res.json().error, 'prompt required');
  assert.equal(posts.length, 0);
});

test('handle: non-200 upstream (e.g. unknown model) is passed through and not recorded', async () => {
  const { svc, added, handle } = setup();
  handle.upstream = fakeUpstream(404);
  const res = fakeRes();
  svc.handle({}, res, { model: 'ghost', prompt: 'p' });
  await waitFor(() => res.status === 404);
  handle.upstream.end('{"error":"model \'ghost\' not found"}');
  await waitFor(() => res.text().length > 0);
  assert.match(res.json().error, /not found/);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(added.length, 0);
});

test('handle: a client disconnect aborts upstream and records the partial run as aborted', async () => {
  const { svc, added, handle } = setup();
  handle.upstream = fakeUpstream(200);
  const res = fakeRes();
  svc.handle({}, res, { model: 'm', prompt: 'p' });
  await waitFor(() => res.headersSent);
  handle.upstream.write(ndjson({ response: 'part' }));
  await waitFor(() => res.text().length > 0);

  res.emit('close');
  await waitFor(() => added.length === 1);
  assert.equal(handle.req.destroyed, true);
  assert.equal(added[0].aborted, true);
  assert.equal(added[0].gen.tokens, 1);
});

test('handle: a stream error with no tokens is not recorded; with tokens it is', async () => {
  const a = setup();
  a.handle.upstream = fakeUpstream(200);
  const resA = fakeRes();
  a.svc.handle({}, resA, { model: 'm', prompt: 'p' });
  await waitFor(() => resA.headersSent);
  a.handle.upstream.end(ndjson({ error: 'load failed' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.added.length, 0);

  const b = setup();
  b.handle.upstream = fakeUpstream(200);
  const resB = fakeRes();
  b.svc.handle({}, resB, { model: 'm', prompt: 'p' });
  await waitFor(() => resB.headersSent);
  b.handle.upstream.end(ndjson({ response: 'x' }, { error: 'oom mid-stream' }));
  await waitFor(() => b.added.length === 1);
  assert.equal(b.added[0].error, 'oom mid-stream');
});

test('handle: an unreachable Ollama yields 502 and no run', async () => {
  const { svc, added, handle } = setup();
  handle.errorOnPost = new Error('ECONNREFUSED');
  const res = fakeRes();
  svc.handle({}, res, { model: 'm', prompt: 'p' });
  await waitFor(() => res.status === 502);
  assert.match(res.json().error, /ollama unreachable: ECONNREFUSED/);
  assert.equal(added.length, 0);
});
