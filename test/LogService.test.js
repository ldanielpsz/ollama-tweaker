const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LogService } = require('../src/services/LogService');
const { fakeRes, fakeUpstream, waitFor } = require('./helpers');

// Docker's multiplexed log frame: [stream, 0, 0, 0, len(BE32)] + payload
const frame = (text, stream = 1) => {
  const payload = Buffer.from(text);
  const head = Buffer.from([stream, 0, 0, 0, 0, 0, 0, 0]);
  head.writeUInt32BE(payload.length, 4);
  return Buffer.concat([head, payload]);
};

function setup(upstream) {
  const seen = {};
  const req = new EventEmitter();
  req.destroyed = false;
  req.destroy = () => { req.destroyed = true; };
  const docker = {
    open(path, cb) {
      seen.path = path;
      if (upstream) queueMicrotask(() => cb(upstream));
      return req;
    },
  };
  const svc = new LogService({ docker, config: { ollamaContainer: 'my ollama' } });
  return { svc, seen, req };
}

test('requests stdout+stderr with timestamps, default tail and an encoded container name', () => {
  const { svc, seen } = setup(null);
  svc.stream(fakeRes(), new URLSearchParams());
  assert.match(seen.path, /^\/containers\/my%20ollama\/logs\?/);
  const q = new URLSearchParams(seen.path.split('?')[1]);
  assert.equal(q.get('stdout'), '1');
  assert.equal(q.get('stderr'), '1');
  assert.equal(q.get('timestamps'), '1');
  assert.equal(q.get('tail'), '200');
  assert.equal(q.get('follow'), null);
});

test('passes follow, tail, since and until through', () => {
  const { svc, seen } = setup(null);
  svc.stream(fakeRes(), new URLSearchParams('follow=1&tail=all&since=100&until=200'));
  const q = new URLSearchParams(seen.path.split('?')[1]);
  assert.deepEqual([q.get('follow'), q.get('tail'), q.get('since'), q.get('until')], ['1', 'all', '100', '200']);
});

test('demultiplexes frames, including a frame split across chunks', async () => {
  const up = fakeUpstream(200);
  const { svc } = setup(up);
  const res = fakeRes();
  svc.stream(res, new URLSearchParams());
  await waitFor(() => res.headersSent);
  const whole = Buffer.concat([frame('line one\n'), frame('line two\n', 2)]);
  up.write(whole.subarray(0, 13));      // cuts through the first frame's payload
  up.write(whole.subarray(13));
  up.end();
  await waitFor(() => res.text().includes('two'));
  assert.equal(res.status, 200);
  assert.equal(res.text(), 'line one\nline two\n');
});

test('passes non-multiplexed (TTY) output through untouched', async () => {
  const up = fakeUpstream(200);
  const { svc } = setup(up);
  const res = fakeRes();
  svc.stream(res, new URLSearchParams());
  await waitFor(() => res.headersSent);
  up.write('2026-10-14T00:00:00Z plain tty line\n'); // first byte '2' > 2 -> raw mode
  up.end();
  await waitFor(() => res.text().length > 0);
  assert.equal(res.text(), '2026-10-14T00:00:00Z plain tty line\n');
});

test('relays Docker errors (e.g. unknown container) with their status', async () => {
  const up = fakeUpstream(404);
  const { svc } = setup(up);
  const res = fakeRes();
  svc.stream(res, new URLSearchParams());
  await waitFor(() => res.headersSent === false); // still waiting for the body
  up.end('{"message":"No such container"}');
  await waitFor(() => res.status === 404);
  assert.match(res.json().error, /No such container/);
});

test('answers 502 when the Docker socket is unavailable', () => {
  const { svc, req } = setup(null);
  const res = fakeRes();
  svc.stream(res, new URLSearchParams());
  req.emit('error', new Error('connect ENOENT'));
  assert.equal(res.status, 502);
  assert.match(res.json().error, /docker socket unavailable/);
});

test('stops the Docker stream when the client disconnects', () => {
  const { svc, req } = setup(null);
  const res = fakeRes();
  svc.stream(res, new URLSearchParams());
  res.emit('close');
  assert.equal(req.destroyed, true);
});
