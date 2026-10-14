const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OllamaClient } = require('../src/services/OllamaClient');
const { listen, fakeRes, readAll } = require('./helpers');

const clientFor = (port) => new OllamaClient({ config: { ollamaUrl: `http://127.0.0.1:${port}` } });

test('exposes the origin of the configured URL', () => {
  assert.equal(clientFor(11434).origin, 'http://127.0.0.1:11434');
});

test('get() returns parsed JSON', async () => {
  const s = await listen((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: req.url })); });
  try {
    assert.deepEqual(await clientFor(s.port).get('/api/tags'), { path: '/api/tags' });
  } finally { await s.close(); }
});

test('get() rejects on non-JSON bodies', async () => {
  const s = await listen((req, res) => res.end('not json'));
  try {
    await assert.rejects(clientFor(s.port).get('/x'));
  } finally { await s.close(); }
});

test('post() sends a JSON body with content-length and hands back the response', async () => {
  let seen;
  const s = await listen(async (req, res) => {
    seen = { method: req.method, url: req.url, type: req.headers['content-type'], body: await readAll(req) };
    res.end('{"ok":true}');
  });
  try {
    const body = await new Promise((resolve) => {
      clientFor(s.port).post('/api/generate', { model: 'm', prompt: 'p' }, (r) => readAll(r).then(resolve));
    });
    assert.equal(body, '{"ok":true}');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api/generate');
    assert.equal(seen.type, 'application/json');
    assert.deepEqual(JSON.parse(seen.body), { model: 'm', prompt: 'p' });
  } finally { await s.close(); }
});

test('post() accepts a pre-encoded Buffer', async () => {
  let seen;
  const s = await listen(async (req, res) => { seen = await readAll(req); res.end('x'); });
  try {
    await new Promise((resolve) => clientFor(s.port).post('/p', Buffer.from('{"a":1}'), (r) => readAll(r).then(resolve)));
    assert.equal(seen, '{"a":1}');
  } finally { await s.close(); }
});

test('proxy() forwards method, path and body, and relays status + payload', async () => {
  let seen;
  const s = await listen(async (req, res) => {
    seen = { method: req.method, url: req.url, body: await readAll(req) };
    res.writeHead(201, { 'content-type': 'text/plain' });
    res.end('deleted');
  });
  try {
    const res = fakeRes();
    const done = new Promise((r) => res.on('finish', r));
    clientFor(s.port).proxy({ method: 'DELETE' }, res, '/api/delete', Buffer.from('{"model":"m"}'));
    await done;
    assert.deepEqual(seen, { method: 'DELETE', url: '/api/delete', body: '{"model":"m"}' });
    assert.equal(res.status, 201);
    assert.equal(res.headers['content-type'], 'text/plain');
    assert.equal(res.text(), 'deleted');
  } finally { await s.close(); }
});

test('proxy() answers 502 when Ollama is unreachable', async () => {
  const dead = await listen(() => {});
  const { port } = dead;
  await dead.close();
  const res = fakeRes();
  const done = new Promise((r) => res.on('finish', r));
  clientFor(port).proxy({ method: 'GET' }, res, '/api/tags', Buffer.alloc(0));
  await done;
  assert.equal(res.status, 502);
  assert.match(res.json().error, /ollama unreachable/);
});

test('memorySample() sums VRAM and total size across loaded models', async () => {
  const s = await listen((req, res) => res.end(JSON.stringify({
    models: [{ size: 10e9, size_vram: 4e9 }, { size: 2e9, size_vram: 2e9 }],
  })));
  try {
    assert.deepEqual(await clientFor(s.port).memorySample(), { vram: 6e9, size: 12e9 });
  } finally { await s.close(); }
});

test('memorySample() is zero with no models and null when unreachable', async () => {
  const s = await listen((req, res) => res.end('{"models":[]}'));
  const port = s.port;
  assert.deepEqual(await clientFor(port).memorySample(), { vram: 0, size: 0 });
  await s.close();
  assert.equal(await clientFor(port).memorySample(), null);
});

test('isUp() reflects whether /api/tags answers', async () => {
  const s = await listen((req, res) => res.end('{"models":[]}'));
  const port = s.port;
  assert.equal(await clientFor(port).isUp(), true);
  await s.close();
  assert.equal(await clientFor(port).isUp(), false);
});
