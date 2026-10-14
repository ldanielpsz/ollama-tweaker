const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DockerClient } = require('../src/services/DockerClient');
const { listenUnix, readAll } = require('./helpers');

test('request() parses JSON responses and reports the status', async () => {
  const s = await listenUnix((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
  try {
    const r = await new DockerClient({ config: { dockerSock: s.socketPath } }).request('GET', '/containers/x/json');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { url: '/containers/x/json' });
  } finally { await s.close(); }
});

test('request() sends a JSON body and keeps plain-text replies in .text', async () => {
  let seen;
  const s = await listenUnix(async (req, res) => {
    seen = { method: req.method, type: req.headers['content-type'], body: await readAll(req) };
    res.writeHead(409);
    res.end('conflict');
  });
  try {
    const r = await new DockerClient({ config: { dockerSock: s.socketPath } })
      .request('POST', '/containers/create?name=n', { Image: 'ollama' });
    assert.deepEqual(seen, { method: 'POST', type: 'application/json', body: '{"Image":"ollama"}' });
    assert.equal(r.status, 409);
    assert.equal(r.json, null);
    assert.equal(r.text, 'conflict');
  } finally { await s.close(); }
});

test('request() rejects when the socket does not exist', async () => {
  const docker = new DockerClient({ config: { dockerSock: '/nonexistent/docker.sock' } });
  await assert.rejects(docker.request('GET', '/_ping'));
});

test('open() streams the response so callers can consume it incrementally', async () => {
  const s = await listenUnix((req, res) => {
    res.writeHead(200);
    res.write('first;');
    setTimeout(() => res.end('second'), 10);
  });
  try {
    const body = await new Promise((resolve) => {
      new DockerClient({ config: { dockerSock: s.socketPath } }).open('/logs', (r) => readAll(r).then(resolve));
    });
    assert.equal(body, 'first;second');
  } finally { await s.close(); }
});
