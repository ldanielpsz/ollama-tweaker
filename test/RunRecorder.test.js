const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RunRecorder } = require('../src/services/RunRecorder');

let clock = 0;
const useClock = (t0 = 0) => { clock = t0; mock.method(Date, 'now', () => clock); };
afterEach(() => mock.restoreAll());

const make = (over = {}) => new RunRecorder({
  id: 'r1', t0: clock, model: 'm:q4_0', preset: 'default', options: { num_ctx: 1024 },
  server: { kv_cache_type: 'q8_0' }, prompt: 'hi', bucketMs: 500, ...over,
});

const tokenAt = (rec, ms) => { clock = ms; rec.chunk({ response: 'x' }); };

test('computes avg from Ollama durations, min/max over full 0.5 s windows, and TTFT', () => {
  useClock(0);
  const rec = make();
  for (let t = 0; t < 500; t += 50) tokenAt(rec, t);          // 10 tokens in window 0 -> 20 tok/s
  for (let t = 500; t < 1000; t += 100) tokenAt(rec, t);      //  5 tokens in window 1 -> 10 tok/s
  for (let i = 0; i < 15; i++) tokenAt(rec, 1000 + i * 33);   // 15 tokens in window 2 -> 30 tok/s
  tokenAt(rec, 1500);                                          // opens window 3, which never completes...
  tokenAt(rec, 1700);                                          // ...so it must be dropped from the timeline
  rec.chunk({ done: true, eval_count: 32, eval_duration: 2e9, prompt_eval_count: 20, prompt_eval_duration: 2e8, load_duration: 1e9, total_duration: 4e9 });

  const run = rec.build({ aborted: false });
  assert.equal(run.ttft_ms, 0);
  assert.equal(run.gen.tokens, 32);
  assert.equal(run.gen.avg, 16);
  assert.equal(run.gen.min, 10);
  assert.equal(run.gen.max, 30);
  assert.equal(run.series.gen.length, 3, 'only full windows are plotted');
  assert.deepEqual(run.series.gen.map((p) => p[1]), [20, 10, 30]);
  assert.equal(run.prompt_eval.tps, 100);
  assert.equal(run.load_s, 1);
  assert.equal(run.total_s, 4);
  assert.deepEqual(run.server, { kv_cache_type: 'q8_0' });
  assert.equal(run.aborted, false);
});

test('without a final chunk, avg falls back to the observed token rate', () => {
  useClock(0);
  const rec = make();
  for (let i = 0; i <= 10; i++) tokenAt(rec, 100 + i * 100); // 11 tokens over 1 s
  const run = rec.build({ aborted: true });
  assert.equal(run.aborted, true);
  assert.equal(run.gen.tokens, 11);
  assert.equal(run.gen.avg, 10);
  assert.equal(run.prompt_eval.tps, null);
  assert.equal(run.load_s, null);
});

test('with fewer than two tokens there is no timeline and min = max = avg', () => {
  useClock(0);
  const rec = make();
  rec.chunk({ done: true, eval_count: 1, eval_duration: 5e8 });
  const run = rec.build({ aborted: false });
  assert.deepEqual(run.series.gen, []);
  assert.equal(run.gen.avg, 2);
  assert.equal(run.gen.min, 2);
  assert.equal(run.gen.max, 2);
});

test('VRAM min/avg/max and offload use the last non-empty memory sample', () => {
  useClock(0);
  const rec = make();
  clock = 100; rec.memory({ vram: 0, size: 0 });
  clock = 600; rec.memory({ vram: 4e9, size: 16e9 });
  clock = 1100; rec.memory({ vram: 4e9, size: 16e9 });
  clock = 1600; rec.memory({ vram: 0, size: 0 }); // model unloaded at the end
  rec.memory(null);                                // failed sample is ignored
  const run = rec.build({ aborted: false });
  assert.deepEqual(run.vram, { min: 0, max: 4e9, avg: 2e9 });
  assert.deepEqual(run.offload, { total_bytes: 16e9, vram_bytes: 4e9, ram_bytes: 12e9, gpu_pct: 25 });
  assert.deepEqual(run.series.vram.map((p) => p[0]), [0.1, 0.6, 1.1, 1.6]);
});

test('offload and vram stats are null when nothing was sampled', () => {
  useClock(0);
  const run = make().build({ aborted: false });
  assert.equal(run.offload, null);
  assert.equal(run.vram, null);
});

test('records stream errors, character count and truncates the stored prompt', () => {
  useClock(0);
  const rec = make({ prompt: 'p'.repeat(900) });
  rec.chunk({ response: 'hello' });
  rec.chunk({ error: 'boom' });
  const run = rec.build({ aborted: false });
  assert.equal(run.error, 'boom');
  assert.equal(run.response_chars, 5);
  assert.equal(run.prompt.length, 500);
});

test('tokens getter prefers Ollama eval_count over streamed chunks', () => {
  useClock(0);
  const rec = make();
  tokenAt(rec, 1);
  assert.equal(rec.tokens, 1);
  rec.chunk({ done: true, eval_count: 7 });
  assert.equal(rec.tokens, 7);
});
