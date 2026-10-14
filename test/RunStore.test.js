const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunStore } = require('../src/services/RunStore');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'runstore-'));

test('starts empty when no history file exists', () => {
  const store = new RunStore({ config: { dataDir: path.join(tmp(), 'nested', 'dir') } });
  assert.deepEqual(store.list(), []);
});

test('add() appends in memory and persists as JSONL', () => {
  const dir = tmp();
  const store = new RunStore({ config: { dataDir: dir } });
  store.add({ id: 'a', n: 1 });
  store.add({ id: 'b', n: 2 });
  assert.deepEqual(store.list().map((r) => r.id), ['a', 'b']);
  const lines = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), { id: 'b', n: 2 });
});

test('history survives a restart (reloaded from disk)', () => {
  const dir = tmp();
  new RunStore({ config: { dataDir: dir } }).add({ id: 'kept' });
  const reopened = new RunStore({ config: { dataDir: dir } });
  assert.deepEqual(reopened.list(), [{ id: 'kept' }]);
});

test('remove() drops one run and rewrites the file', () => {
  const dir = tmp();
  const store = new RunStore({ config: { dataDir: dir } });
  ['a', 'b', 'c'].forEach((id) => store.add({ id }));
  store.remove('b');
  assert.deepEqual(store.list().map((r) => r.id), ['a', 'c']);
  assert.deepEqual(new RunStore({ config: { dataDir: dir } }).list().map((r) => r.id), ['a', 'c']);
});

test('remove() of an unknown id is a no-op', () => {
  const store = new RunStore({ config: { dataDir: tmp() } });
  store.add({ id: 'a' });
  store.remove('zzz');
  assert.equal(store.list().length, 1);
});

test('clear() empties memory and disk', () => {
  const dir = tmp();
  const store = new RunStore({ config: { dataDir: dir } });
  store.add({ id: 'a' });
  store.clear();
  assert.deepEqual(store.list(), []);
  assert.equal(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8'), '');
  assert.deepEqual(new RunStore({ config: { dataDir: dir } }).list(), []);
});
