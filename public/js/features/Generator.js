import { $, readNdjson } from '../core/dom.js';

// Sends the prompt + request parameters and streams the answer into the output pane.
export class Generator {
  constructor({ api, picker, prompt, requestForm, runsView }) {
    Object.assign(this, { api, picker, prompt, requestForm, runsView });
    this.ctrl = null;
  }

  init() {
    $('go').onclick = () => this.run();
    $('stop').onclick = () => this.ctrl?.abort();
  }

  async run() {
    this.ctrl = new AbortController();
    $('go').disabled = true;
    $('stop').disabled = false;
    $('out').textContent = '';
    $('stats').textContent = '';
    let runId = null;
    try {
      const res = await this.api.generate({
        model: this.picker.model(),
        preset: this.picker.preset(),
        prompt: this.prompt.prompt(),
        system: this.prompt.system() || undefined,
        params: this.requestForm.values(),
      }, this.ctrl.signal);
      if (!res.ok) { $('out').textContent = (await res.json()).error; return; }
      runId = res.headers.get('x-run-id');
      await readNdjson(res, (d) => {
        if (d.error) $('out').textContent += `\n[error] ${d.error}`;
        if (d.response) $('out').textContent += d.response;
        if (d.done) {
          const tps = d.eval_count / (d.eval_duration / 1e9);
          $('stats').textContent = `${d.eval_count} tokens · ${tps.toFixed(1)} tok/s · load ${(d.load_duration / 1e9).toFixed(2)}s · total ${(d.total_duration / 1e9).toFixed(2)}s`;
        }
      });
    } catch (e) {
      if (e.name !== 'AbortError') $('out').textContent += `\n[error] ${e.message}`;
    } finally {
      $('go').disabled = false;
      $('stop').disabled = true;
      this.picker.loadPs();
      setTimeout(() => this.runsView.refresh(runId), 400); // server stores the run right after the stream ends
    }
  }
}
