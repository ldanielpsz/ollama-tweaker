const http = require('node:http');
const { json } = require('../core/http');

class OllamaClient {
  constructor({ config }) {
    const url = new URL(config.ollamaUrl);
    this.origin = url.origin;
    this.host = url.hostname;
    this.port = url.port;
  }

  get(path) {
    return new Promise((resolve, reject) => {
      http.get({ host: this.host, port: this.port, path }, (r) => {
        const chunks = [];
        r.on('data', (d) => chunks.push(d));
        r.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }

  // Low-level POST; the caller handles the response stream.
  post(path, body, onResponse) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: this.host, port: this.port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, onResponse);
    req.end(data);
    return req;
  }

  // Forward an incoming request to Ollama and stream the response straight back.
  proxy(req, res, pathname, body) {
    const up = http.request({
      host: this.host, port: this.port, path: pathname, method: req.method,
      headers: { 'content-type': 'application/json', 'content-length': body.length },
    }, (r) => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    });
    up.on('error', (e) => !res.headersSent && json(res, 502, { error: `ollama unreachable: ${e.message}` }));
    res.on('close', () => up.destroy());
    up.end(body);
  }

  // Loaded-model memory: bytes on GPU and total (weights + KV cache); the difference lives in system RAM.
  memorySample() {
    return this.get('/api/ps')
      .then((d) => (d.models || []).reduce(
        (s, m) => ({ vram: s.vram + (m.size_vram || 0), size: s.size + (m.size || 0) }), { vram: 0, size: 0 }))
      .catch(() => null);
  }

  isUp() {
    return this.get('/api/tags').then(() => true).catch(() => false);
  }
}

module.exports = { OllamaClient };
