const fs = require('node:fs');
const path = require('node:path');

// Run history: JSONL on disk, mirrored in memory.
class RunStore {
  constructor({ config }) {
    this.file = path.join(config.dataDir, 'runs.jsonl');
    this.runs = [];
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      this.runs = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* first start */ }
  }

  list() { return this.runs; }

  add(run) {
    this.runs.push(run);
    try { fs.appendFileSync(this.file, JSON.stringify(run) + '\n'); } catch (e) { console.error(e.message); }
  }

  remove(id) {
    this.runs = this.runs.filter((r) => r.id !== id);
    this.#rewrite();
  }

  clear() {
    this.runs = [];
    this.#rewrite();
  }

  #rewrite() {
    try {
      fs.writeFileSync(this.file, this.runs.map((r) => JSON.stringify(r)).join('\n') + (this.runs.length ? '\n' : ''));
    } catch (e) { console.error(e.message); }
  }
}

module.exports = { RunStore };
