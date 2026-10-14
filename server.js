// Web server only: routing + static files. All logic lives in src/ and is wired in src/bootstrap.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { bootstrap } = require('./src/bootstrap');
const { readBody, json } = require('./src/core/http');

const container = bootstrap();
const config = container.resolve('config');
const generate = container.resolve('generateService');
const serverSettings = container.resolve('serverSettings');
const runs = container.resolve('runStore');
const logs = container.resolve('logService');
const schema = container.resolve('schemaService');
const ollama = container.resolve('ollama');

const parseJson = async (req) => JSON.parse((await readBody(req)).toString() || '{}');

// [method, pattern, handler(req, res, ctx)]; ctx = { url, match }
const routes = [
  ['GET', /^\/wrapper\/schema$/, (req, res) => json(res, 200, schema.describe())],

  ['POST', /^\/wrapper\/generate$/, async (req, res) => generate.handle(req, res, await parseJson(req))],

  ['GET', /^\/wrapper\/server-settings$/, async (req, res) => {
    try { json(res, 200, { ...(await serverSettings.read()).settings, restarting: serverSettings.restarting }); }
    catch (e) { json(res, 502, { error: e.message }); }
  }],
  ['POST', /^\/wrapper\/server-settings$/, async (req, res) => {
    try { json(res, 200, await serverSettings.apply(await parseJson(req))); }
    catch (e) { json(res, e.status || 500, { error: e.message }); }
  }],

  ['GET', /^\/wrapper\/logs$/, (req, res, { url }) => logs.stream(res, url.searchParams)],

  ['GET', /^\/wrapper\/runs$/, (req, res) => json(res, 200, runs.list())],
  ['DELETE', /^\/wrapper\/runs$/, (req, res) => { runs.clear(); json(res, 200, { ok: true }); }],
  ['DELETE', /^\/wrapper\/runs\/([\w-]+)$/, (req, res, { match }) => { runs.remove(match[1]); json(res, 200, { ok: true }); }],

  // Plain passthrough (tags, pull, ps, show, delete...) so the UI can manage models.
  [null, /^\/api\//, async (req, res, { url }) => ollama.proxy(req, res, url.pathname, await readBody(req))],
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  const root = config.publicDir;
  const full = path.join(root, pathname === '/' ? 'index.html' : path.normalize(pathname));
  if (!full.startsWith(root + path.sep) && full !== root) return json(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(url.pathname);
      if (match && (method === null || method === req.method)) return await handler(req, res, { url, match });
    }
    serveStatic(res, url.pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
}).listen(config.port, () => console.log(`ollama-tweaker on :${config.port} -> ${ollama.origin} (logs: ${config.ollamaContainer})`));
