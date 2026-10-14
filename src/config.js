const path = require('node:path');

function loadConfig(env = process.env) {
  const root = path.join(__dirname, '..');
  return {
    port: +env.PORT || 8080,
    ollamaUrl: env.OLLAMA_URL || 'http://ollama:11434',
    ollamaContainer: env.OLLAMA_CONTAINER || 'ollama',
    dockerSock: env.DOCKER_SOCK || '/var/run/docker.sock',
    dataDir: env.DATA_DIR || path.join(root, 'data'),
    publicDir: path.join(root, 'public'),
    bucketMs: 500, // timeline resolution for generation tok/s and VRAM sampling
  };
}

module.exports = { loadConfig };
