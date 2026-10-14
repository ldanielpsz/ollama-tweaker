const crypto = require('node:crypto');
const { HttpError, json } = require('../core/http');
const { RunRecorder } = require('./RunRecorder');

// Builds the Ollama request from the injected request-parameter strategies, streams the answer
// back, and records metrics for the run.
class GenerateService {
  constructor({ ollama, runStore, presets, requestStrategies, serverSettings, config }) {
    Object.assign(this, { ollama, runStore, presets, requestStrategies, serverSettings, config });
  }

  buildPayload(b) {
    if (!b.prompt) throw new HttpError(400, 'prompt required');
    const model = b.model || (b.base && b.quant ? `${b.base}:${b.quant}` : b.base);
    if (!model) throw new HttpError(400, 'model or base required');

    const payload = { model, prompt: b.prompt, stream: true, options: this.presets.options(b.preset) };
    if (b.system) payload.system = String(b.system);
    try {
      for (const strategy of this.requestStrategies) {
        strategy.apply(payload, strategy.parse(b.params || {}));
      }
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    return payload;
  }

  handle(req, res, body) {
    let payload;
    try { payload = this.buildPayload(body); } catch (e) { return json(res, e.status || 500, { error: e.message }); }

    const id = crypto.randomUUID();
    const recorder = new RunRecorder({
      id, t0: Date.now(), model: payload.model, preset: body.preset || 'default',
      options: payload.options, server: this.serverSettings.snapshot(),
      prompt: payload.prompt, bucketMs: this.config.bucketMs,
    });

    let finished = false;
    const poll = async () => {
      const sample = await this.ollama.memorySample();
      if (!finished) recorder.memory(sample);
    };
    poll();
    const timer = setInterval(poll, this.config.bucketMs);

    const finish = async (aborted) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      recorder.memory(await this.ollama.memorySample());
      const run = recorder.build({ aborted });
      if (!run.error || recorder.tokens) this.runStore.add(run);
    };

    const up = this.ollama.post('/api/generate', payload, (r) => {
      if (r.statusCode !== 200) { // e.g. model not found: pass through, don't record
        finished = true;
        clearInterval(timer);
        res.writeHead(r.statusCode, { 'content-type': 'application/json' });
        return r.pipe(res);
      }
      res.writeHead(200, {
        'content-type': 'application/x-ndjson', 'x-run-id': id, 'access-control-expose-headers': 'x-run-id',
      });
      let buf = '';
      r.on('data', (c) => {
        res.write(c);
        buf += c;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try { recorder.chunk(JSON.parse(line)); } catch { /* partial line */ }
        }
      });
      r.on('end', () => { res.end(); finish(false); });
    });
    up.on('error', (e) => {
      recorder.error = e.message;
      if (!res.headersSent) json(res, 502, { error: `ollama unreachable: ${e.message}` });
      finished = true;
      clearInterval(timer);
    });
    res.on('close', () => { if (!finished) { up.destroy(); finish(true); } });
  }
}

module.exports = { GenerateService };
