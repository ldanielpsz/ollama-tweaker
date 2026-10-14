const http = require('node:http');

// Docker Engine API over the unix socket.
class DockerClient {
  constructor({ config }) {
    this.socketPath = config.dockerSock;
  }

  // Buffered request -> { status, json, text }
  request(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const r = http.request({
        socketPath: this.socketPath, method, path,
        headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
      }, (resp) => {
        const chunks = [];
        resp.on('data', (d) => chunks.push(d));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let j = null;
          try { j = JSON.parse(text); } catch { /* empty / plain text */ }
          resolve({ status: resp.statusCode, json: j, text });
        });
      });
      r.on('error', reject);
      r.end(data);
    });
  }

  // Streaming GET; the caller handles the response and owns the returned request.
  open(path, onResponse) {
    const req = http.request({ socketPath: this.socketPath, method: 'GET', path }, onResponse);
    req.end();
    return req;
  }
}

module.exports = { DockerClient };
