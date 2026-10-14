// Shared test utilities: fake HTTP/unix servers, a writable fake response, and fake upstream streams.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable, PassThrough } = require('node:stream');

const closer = (server) => () => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, close: closer(server) });
    });
  });
}

function listenUnix(handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tweaker-'));
  const socketPath = path.join(dir, 's.sock');
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(socketPath, () => {
      resolve({
        server, socketPath,
        close: async () => { await closer(server)(); fs.rmSync(dir, { recursive: true, force: true }); },
      });
    });
  });
}

// A response double: collects status/headers/body and can emit 'close' like a dropped client.
function fakeRes() {
  const chunks = [];
  const res = new Writable({ write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  res.headersSent = false;
  res.status = null;
  res.headers = null;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers || {}; res.headersSent = true; };
  res.text = () => Buffer.concat(chunks).toString();
  res.json = () => JSON.parse(res.text());
  return res;
}

// An upstream (IncomingMessage-like) stream with a status code.
function fakeUpstream(statusCode = 200, headers = {}) {
  const s = new PassThrough();
  s.statusCode = statusCode;
  s.headers = headers;
  return s;
}

async function waitFor(predicate, timeoutMs = 2000, stepMs = 5) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const readAll = (req) => new Promise((resolve) => {
  const c = [];
  req.on('data', (d) => c.push(d));
  req.on('end', () => resolve(Buffer.concat(c).toString()));
});

module.exports = { listen, listenUnix, fakeRes, fakeUpstream, waitFor, readAll };
