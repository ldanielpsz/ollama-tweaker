const stat = (a) => (a.length
  ? { min: Math.min(...a), max: Math.max(...a), avg: a.reduce((s, x) => s + x, 0) / a.length }
  : null);

// Accumulates streaming timings + memory samples for one generation and builds the run record.
class RunRecorder {
  constructor({ id, t0, model, preset, options, server, prompt, bucketMs }) {
    Object.assign(this, { id, t0, model, preset, options, server, prompt, bucketMs });
    this.tokenAt = [];   // ms offsets of every streamed chunk
    this.vram = [];      // [ms offset, bytes]
    this.lastMem = null; // last non-empty { vram, size } sample (the model may unload at the end)
    this.final = null;
    this.error = null;
    this.chars = 0;
  }

  chunk(d) {
    if (d.error) this.error = d.error;
    if (d.response) { this.tokenAt.push(Date.now() - this.t0); this.chars += d.response.length; }
    if (d.done) this.final = d;
  }

  memory(sample) {
    if (!sample) return;
    this.vram.push([Date.now() - this.t0, sample.vram]);
    if (sample.size > 0) this.lastMem = sample;
  }

  get tokens() { return this.final?.eval_count ?? this.tokenAt.length; }

  // Gen tok/s per full bucket: [[seconds since request, tok/s], ...]
  #genSeries() {
    const { tokenAt, bucketMs } = this;
    if (tokenAt.length < 2) return [];
    const first = tokenAt[0];
    const buckets = Math.floor((tokenAt[tokenAt.length - 1] - first) / bucketMs);
    const counts = new Array(buckets).fill(0);
    for (const t of tokenAt) {
      const i = Math.floor((t - first) / bucketMs);
      if (i < buckets) counts[i]++;
    }
    return counts.map((c, i) => [(first + (i + 0.5) * bucketMs) / 1000, c / (bucketMs / 1000)]);
  }

  build({ aborted }) {
    const { final, tokenAt, lastMem } = this;
    const genSeries = this.#genSeries();
    const nGen = this.tokens;
    const genAvg = final?.eval_duration
      ? final.eval_count / (final.eval_duration / 1e9)
      : (tokenAt.length > 1 ? (tokenAt.length - 1) / ((tokenAt[tokenAt.length - 1] - tokenAt[0]) / 1000) : null);
    const win = stat(genSeries.map((p) => p[1]));
    const promptTps = final?.prompt_eval_duration ? final.prompt_eval_count / (final.prompt_eval_duration / 1e9) : null;

    return {
      id: this.id,
      ts: new Date(this.t0).toISOString(),
      end: new Date().toISOString(),
      model: this.model,
      preset: this.preset,
      options: this.options,
      server: this.server,
      prompt: String(this.prompt).slice(0, 500),
      response_chars: this.chars,
      aborted: !!aborted,
      error: this.error,
      ttft_ms: tokenAt.length ? tokenAt[0] : null,
      load_s: final ? final.load_duration / 1e9 : null,
      total_s: final ? final.total_duration / 1e9 : (Date.now() - this.t0) / 1000,
      // Ollama reports prompt processing only as one aggregate, so min = max = avg per run.
      prompt_eval: { tokens: final?.prompt_eval_count ?? null, tps: promptTps },
      gen: { tokens: nGen, avg: genAvg, min: win ? win.min : genAvg, max: win ? win.max : genAvg },
      vram: stat(this.vram.map((p) => p[1])),
      // How much of the loaded model (weights + KV cache) sits in system RAM instead of VRAM.
      offload: lastMem && lastMem.size ? {
        total_bytes: lastMem.size,
        vram_bytes: lastMem.vram,
        ram_bytes: Math.max(0, lastMem.size - lastMem.vram),
        gpu_pct: Math.round((100 * lastMem.vram) / lastMem.size),
      } : null,
      series: { gen: genSeries, vram: this.vram.map(([t, v]) => [t / 1000, v]) },
    };
  }
}

module.exports = { RunRecorder };
