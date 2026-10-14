// Small HTTP helpers shared by the web layer and services.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

module.exports = { HttpError, readBody, json };
