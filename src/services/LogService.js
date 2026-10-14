const { json } = require('../core/http');

// Streams the Ollama container's logs via the Docker API, demultiplexing stdout/stderr frames.
class LogService {
  constructor({ docker, config }) {
    Object.assign(this, { docker, config });
  }

  stream(res, q) {
    const params = new URLSearchParams({ stdout: '1', stderr: '1', timestamps: '1' });
    params.set('tail', q.get('tail') || '200');
    if (q.get('follow') === '1') params.set('follow', '1');
    if (q.get('since')) params.set('since', q.get('since'));
    if (q.get('until')) params.set('until', q.get('until'));

    const path = `/containers/${encodeURIComponent(this.config.ollamaContainer)}/logs?${params}`;
    const up = this.docker.open(path, (r) => {
      if (r.statusCode !== 200) {
        const c = [];
        r.on('data', (d) => c.push(d));
        r.on('end', () => json(res, r.statusCode, { error: Buffer.concat(c).toString() }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
      // Docker multiplexes stdout/stderr: 8-byte header [type,0,0,0,len(BE32)] + payload.
      let pending = Buffer.alloc(0);
      let raw = null;
      r.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        if (raw === null) raw = pending.length > 0 && pending[0] > 2; // TTY containers are not multiplexed
        if (raw) { res.write(pending); pending = Buffer.alloc(0); return; }
        while (pending.length >= 8) {
          const len = pending.readUInt32BE(4);
          if (pending.length < 8 + len) break;
          res.write(pending.subarray(8, 8 + len));
          pending = pending.subarray(8 + len);
        }
      });
      r.on('end', () => res.end());
    });
    up.on('error', (e) => !res.headersSent && json(res, 502, { error: `docker socket unavailable: ${e.message}` }));
    res.on('close', () => up.destroy());
  }
}

module.exports = { LogService };
