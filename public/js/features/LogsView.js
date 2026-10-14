import { $ } from '../core/dom.js';

// Live Ollama container log follower with filter, pause and clear.
export class LogsView {
  constructor({ api }) {
    this.api = api;
    this.lines = [];
    this.paused = false;
    this.queued = false;
  }

  init() {
    $('logfilter').oninput = () => this.render();
    $('logclear').onclick = () => { this.lines = []; this.render(); };
    $('logfollow').onclick = () => {
      this.paused = !this.paused;
      $('logfollow').textContent = this.paused ? 'Resume' : 'Pause';
      if (!this.paused) this.render();
    };
    this.follow();
  }

  render() {
    this.queued = false;
    const q = $('logfilter').value.toLowerCase();
    const el = $('logs');
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.textContent = (q ? this.lines.filter((l) => l.toLowerCase().includes(q)) : this.lines).join('\n');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  #queue() {
    if (this.queued || this.paused) return;
    this.queued = true;
    requestAnimationFrame(() => this.render());
  }

  async follow() {
    for (;;) {
      try {
        const res = await this.api.logs('follow=1&tail=200');
        if (!res.ok) { this.lines.push('[log stream] ' + (await res.json()).error); this.#queue(); return; }
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop();
          if (parts.length) {
            this.lines.push(...parts);
            if (this.lines.length > 3000) this.lines = this.lines.slice(-2000);
            this.#queue();
          }
        }
      } catch { /* reconnect below */ }
      await new Promise((r) => setTimeout(r, 2000)); // e.g. ollama restarted
    }
  }
}
