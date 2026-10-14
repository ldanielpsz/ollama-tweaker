const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ServerSettingsService } = require('../src/services/ServerSettingsService');
const { EnvParamStrategy } = require('../src/params/EnvParamStrategy');
const { KvCacheStrategy } = require('../src/params/KvCacheStrategy');
const defs = require('../src/params/definitions/server');

const strategies = () => Object.values(defs).map((definition) => (
  definition.id === 'kvcache' ? new KvCacheStrategy({ definition }) : new EnvParamStrategy({ definition })));

const inspectOf = (env) => ({
  Id: 'abc123def4567890abcdef',
  Config: { Image: 'ollama/ollama:latest', Env: env, Hostname: 'abc123def456', Labels: { a: 'b' } },
  HostConfig: { DeviceRequests: [{ Driver: 'nvidia' }], Binds: ['/m:/models:ro'] },
  NetworkSettings: { Networks: { stack_default: { Aliases: ['ollama', 'tweaker-ollama', 'abc123def456'], IPAMConfig: null } } },
  State: { Status: 'running', StartedAt: '2026-10-14T00:00:00Z' },
});

const BASE_ENV = ['PATH=/usr/bin', 'OLLAMA_HOST=0.0.0.0', 'OLLAMA_KV_CACHE_TYPE=q8_0', 'OLLAMA_FLASH_ATTENTION=1', 'OLLAMA_MAX_QUEUE=64', 'OLLAMA_KEEP_ALIVE=-1'];

function fakeDocker({ env = BASE_ENV, createStatus = 201, startStatus = 204, gate = null } = {}) {
  const calls = [];
  return {
    calls,
    mutating: () => calls.filter((c) => c.method !== 'GET'),
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && /\/json$/.test(path)) return { status: 200, json: inspectOf(env), text: '' };
      if (/\/rename/.test(path)) return { status: 204, json: null, text: '' };
      if (/\/containers\/create/.test(path)) {
        if (gate) await gate;
        return createStatus === 201
          ? { status: 201, json: { Id: 'newid' }, text: '' }
          : { status: 409, json: { message: 'name conflict' }, text: '' };
      }
      if (/\/stop/.test(path)) return { status: 204, json: null, text: '' };
      if (/\/start/.test(path)) return startStatus < 300
        ? { status: startStatus, json: null, text: '' }
        : { status: startStatus, json: { message: 'no gpu' }, text: '' };
      if (method === 'DELETE') return { status: 204, json: null, text: '' };
      return { status: 500, json: null, text: 'unexpected ' + method + ' ' + path };
    },
  };
}

const make = (docker, { up = true } = {}) => new ServerSettingsService({
  docker,
  ollama: { isUp: async () => up },
  config: { ollamaContainer: 'tweaker-ollama', readyAttempts: 3, readyPollMs: 1 },
  strategies: strategies(),
});

test('read(): maps container env to typed settings, with defaults for unset values', async () => {
  const svc = make(fakeDocker());
  const { settings } = await svc.read();
  assert.equal(settings.kv_cache_type, 'q8_0');
  assert.equal(settings.flash_attention, true);
  assert.equal(settings.max_queue, 64);          // int
  assert.equal(settings.keep_alive, '-1');       // duration stays a string
  assert.equal(settings.context_length, null);   // unset -> null (Ollama default)
  assert.equal(settings.debug, false);           // unset bool -> false
  assert.equal(settings.container_state, 'running');
});

test('read(): kv_cache_type defaults to f16 when the env var is absent', async () => {
  const { settings } = await make(fakeDocker({ env: ['PATH=/x'] })).read();
  assert.equal(settings.kv_cache_type, 'f16');
  assert.equal(settings.flash_attention, false);
});

test('read(): throws a useful error when the container cannot be inspected', async () => {
  const docker = { request: async () => ({ status: 404, json: { message: 'No such container' }, text: '' }) };
  await assert.rejects(make(docker).read(), /No such container/);
});

test('snapshot(): every field of every strategy, null when unset', async () => {
  const svc = make(fakeDocker());
  await svc.read();
  const snap = svc.snapshot();
  assert.equal(snap.kv_cache_type, 'q8_0');
  assert.equal(snap.max_queue, 64);
  assert.equal(snap.fit_target, null);
  const expectedKeys = strategies().flatMap((s) => [...s.fields.keys()]);
  assert.deepEqual(Object.keys(snap).sort(), expectedKeys.sort());
});

test('apply(): recreates the container with updated env, in the right order', async () => {
  const docker = fakeDocker();
  const svc = make(docker);
  const result = await svc.apply({ max_queue: '128', gpu_overhead: '1073741824', debug: true, keep_alive: '' });

  const steps = docker.mutating().map((c) => `${c.method} ${c.path.split('?')[0].replace(/^\/containers\//, '')}`);
  assert.deepEqual(steps, [
    'POST tweaker-ollama/rename',
    'POST create',
    steps[2],                         // stop <old tmp name>
    'POST newid/start',
    steps[4],                         // delete <old tmp name>
  ]);
  assert.match(steps[2], /^POST tweaker-ollama-old-\d+\/stop$/);
  assert.match(steps[4], /^DELETE tweaker-ollama-old-\d+$/);

  const create = docker.calls.find((c) => /containers\/create/.test(c.path));
  assert.match(create.path, /name=tweaker-ollama$/);
  const env = create.body.Env;
  assert.ok(env.includes('PATH=/usr/bin') && env.includes('OLLAMA_HOST=0.0.0.0'), 'unrelated env preserved');
  assert.ok(env.includes('OLLAMA_MAX_QUEUE=128'));
  assert.ok(env.includes('OLLAMA_GPU_OVERHEAD=1073741824'));
  assert.ok(env.includes('OLLAMA_DEBUG=1'));
  assert.equal(env.filter((e) => e.startsWith('OLLAMA_KV_CACHE_TYPE=')).length, 1, 'no duplicate managed vars');
  assert.equal(env.some((e) => e.startsWith('OLLAMA_KEEP_ALIVE=')), false, 'empty value unsets the variable');
  assert.equal(create.body.Hostname, '');
  assert.deepEqual(create.body.HostConfig, inspectOf(BASE_ENV).HostConfig);
  assert.deepEqual(create.body.NetworkingConfig.EndpointsConfig.stack_default.Aliases, ['ollama', 'tweaker-ollama']);
  assert.equal(result.container_state, 'running');
});

test('apply(): quantized KV cache forces flash attention on', async () => {
  const docker = fakeDocker({ env: ['OLLAMA_KV_CACHE_TYPE=f16', 'OLLAMA_FLASH_ATTENTION=0'] });
  await make(docker).apply({ kv_cache_type: 'q4_0' });
  const env = docker.calls.find((c) => /containers\/create/.test(c.path)).body.Env;
  assert.ok(env.includes('OLLAMA_KV_CACHE_TYPE=q4_0'));
  assert.ok(env.includes('OLLAMA_FLASH_ATTENTION=1'));
});

test('apply(): omitted keys keep their current values', async () => {
  const docker = fakeDocker();
  await make(docker).apply({ debug: true });
  const env = docker.calls.find((c) => /containers\/create/.test(c.path)).body.Env;
  assert.ok(env.includes('OLLAMA_KV_CACHE_TYPE=q8_0'));
  assert.ok(env.includes('OLLAMA_MAX_QUEUE=64'));
  assert.ok(env.includes('OLLAMA_KEEP_ALIVE=-1'));
});

test('apply(): invalid input is rejected with 400 before anything is changed', async () => {
  const docker = fakeDocker();
  const svc = make(docker);
  await assert.rejects(svc.apply({ max_queue: '-5' }), { status: 400, message: /max_queue/ });
  await assert.rejects(svc.apply({ kv_cache_type: 'q3' }), { status: 400 });
  await assert.rejects(svc.apply({ load_timeout: 'soon' }), { status: 400, message: /load_timeout/ });
  assert.equal(docker.mutating().length, 0);
  assert.equal(svc.restarting, false);
});

test('apply(): rolls back when the new container cannot be created', async () => {
  const docker = fakeDocker({ createStatus: 409 });
  const svc = make(docker);
  await assert.rejects(svc.apply({ debug: true }), /create failed: name conflict.*rolled back/);
  const steps = docker.mutating().map((c) => c.method + ' ' + c.path.split('?')[0]);
  assert.match(steps[0], /\/tweaker-ollama\/rename$/);
  assert.match(steps.at(-2), /\/tweaker-ollama-old-\d+\/rename$/);   // old container renamed back
  assert.match(steps.at(-1), /\/tweaker-ollama\/start$/);            // and restarted
  assert.equal(steps.some((s) => s.startsWith('DELETE')), false, 'nothing to delete: new container never existed');
  assert.equal(svc.restarting, false);
});

test('apply(): rolls back and removes the new container when it fails to start', async () => {
  const docker = fakeDocker({ startStatus: 500 });
  await assert.rejects(make(docker).apply({ debug: true }), /start failed: no gpu.*rolled back/);
  const del = docker.mutating().find((c) => c.method === 'DELETE');
  assert.match(del.path, /^\/containers\/newid\?force=1$/);
});

test('apply(): rolls back when Ollama never becomes ready', async () => {
  const docker = fakeDocker();
  await assert.rejects(make(docker, { up: false }).apply({ debug: true }), /did not become ready.*rolled back/);
  assert.ok(docker.mutating().some((c) => c.method === 'DELETE' && /newid/.test(c.path)));
});

test('apply(): a second apply during a restart is refused with 409', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const svc = make(fakeDocker({ gate }));
  const first = svc.apply({ debug: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(svc.restarting, true);
  await assert.rejects(svc.apply({ debug: false }), { status: 409 });
  release();
  await first;
  assert.equal(svc.restarting, false);
});
