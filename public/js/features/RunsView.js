import { $, confirmButton } from '../core/dom.js';

const COLORS = ['#0969da', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#bf3989', '#0a7ea4', '#6e7781'];
const f1 = (x) => (x == null ? '–' : x.toFixed(1));
const gb = (x) => (x == null ? '–' : (x / 1e9).toFixed(2));

// Run history table, min/avg/max aggregate across selected runs, and the multi-run timeline chart.
export class RunsView {
  constructor({ api }) {
    this.api = api;
    this.runs = [];
    this.selected = new Set();
  }

  async init() {
    $('runs').addEventListener('click', async (e) => {
      const t = e.target;
      if (t.dataset.id) { t.checked ? this.selected.add(t.dataset.id) : this.selected.delete(t.dataset.id); this.render(); }
      if (t.dataset.del) {
        await this.api.deleteRun(t.dataset.del);
        this.selected.delete(t.dataset.del);
        await this.refresh();
      }
      if (t.dataset.logs) this.showRunLogs(this.runs.find((r) => r.id === t.dataset.logs));
    });
    $('metric').onchange = () => this.renderChart();
    $('selall').onclick = () => { this.runs.forEach((r) => this.selected.add(r.id)); this.render(); };
    $('selnone').onclick = () => { this.selected.clear(); this.render(); };
    confirmButton($('delall'), {
      armedLabel: 'Click again to confirm', ms: 3000,
      onConfirm: async () => { await this.api.clearRuns(); this.selected.clear(); this.runs = []; this.render(); },
    });
    $('export').onclick = () => {
      const w = window.open('', '_blank');
      if (w) { w.document.write('<pre>' + JSON.stringify(this.runs, null, 1).replace(/</g, '&lt;') + '</pre>'); w.document.close(); }
    };
    await this.refresh();
  }

  async refresh(selectId = null) {
    try { this.runs = await this.api.runs(); } catch { /* keep previous */ }
    if (selectId && this.runs.some((r) => r.id === selectId)) this.selected.add(selectId);
    this.render();
  }

  render() {
    $('runs').innerHTML = [...this.runs].reverse().map((r) => {
      const i = [...this.selected].indexOf(r.id);
      const sw = i >= 0 ? `<span class="sw" style="background:${COLORS[i % COLORS.length]}"></span>` : '';
      return `<tr class="${this.selected.has(r.id) ? 'sel' : ''}">
        <td><input type="checkbox" data-id="${r.id}" ${this.selected.has(r.id) ? 'checked' : ''}>${sw}</td>
        <td>${new Date(r.ts).toLocaleTimeString()}${r.aborted ? ' (aborted)' : ''}</td>
        <td>${r.model}</td><td>${r.preset}</td><td>${r.server?.kv_cache_type ?? '–'}</td>
        <td>${f1(r.gen.avg)}</td><td>${f1(r.gen.min)}</td><td>${f1(r.gen.max)}</td>
        <td>${f1(r.prompt_eval.tps)}</td><td>${r.ttft_ms ?? '–'}</td>
        <td>${gb(r.vram?.min)}</td><td>${gb(r.vram?.avg)}</td><td>${gb(r.vram?.max)}</td><td>${gb(r.offload?.ram_bytes)}</td><td>${r.offload ? r.offload.gpu_pct + '%' : '–'}</td>
        <td>${r.gen.tokens}</td>
        <td><button class="sec" data-logs="${r.id}">logs</button><button class="sec" data-del="${r.id}">✕</button></td>
      </tr>`;
    }).join('');
    this.renderAggregate();
    this.renderChart();
  }

  renderAggregate() {
    const sel = this.runs.filter((r) => this.selected.has(r.id));
    if (!sel.length) { $('agg').textContent = ''; return; }
    const vals = (fn) => sel.map(fn).filter((v) => v != null);
    const s = (a) => (a.length ? `${f1(Math.min(...a))} / ${f1(a.reduce((x, y) => x + y, 0) / a.length)} / ${f1(Math.max(...a))}` : '–');
    const peak = vals((r) => r.vram?.max).map((x) => x / 1e9);
    $('agg').textContent = `Across ${sel.length} selected run(s) — min / avg / max · `
      + `generation tok/s: ${s(vals((r) => r.gen.avg))} · prompt tok/s: ${s(vals((r) => r.prompt_eval.tps))} · `
      + `peak VRAM GB: ${s(peak)}`;
  }

  renderChart() {
    const svg = $('chart');
    const W = 1000, H = 260, m = { l: 48, r: 12, t: 10, b: 24 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const metric = $('metric').value;
    const div = metric === 'vram' ? 1e9 : 1;
    const sel = [...this.selected].map((id) => this.runs.find((r) => r.id === id)).filter(Boolean);
    const lines = sel.map((r, i) => ({ r, c: COLORS[i % COLORS.length], pts: r.series[metric].map(([t, v]) => [t, v / div]) }));
    const all = lines.flatMap((l) => l.pts);
    if (!all.length) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Select runs to plot</text>`;
      $('legend').innerHTML = '';
      return;
    }
    const xmax = Math.max(...all.map((p) => p[0])) || 1;
    const ymin = metric === 'vram' ? Math.min(...all.map((p) => p[1])) * 0.98 : 0;
    let ymax = Math.max(...all.map((p) => p[1])) * 1.08 || 1;
    if (ymax === ymin) ymax = ymin + 1;
    const X = (t) => m.l + (t / xmax) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = ymin + ((ymax - ymin) * i) / 4;
      const y = Y(v);
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${v.toFixed(metric === 'vram' ? 2 : 0)}</text>`;
      const t = (xmax * i) / 4;
      g += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${t.toFixed(1)}s</text>`;
    }
    const paths = lines.map((l) => `<polyline fill="none" stroke="${l.c}" stroke-width="2" vector-effect="non-scaling-stroke" points="${l.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
    svg.innerHTML = g + paths;
    $('legend').innerHTML = lines.map((l) => `<span><span class="sw" style="background:${l.c}"></span>${l.r.model} · ${l.r.preset} · ${new Date(l.r.ts).toLocaleTimeString()}</span>`).join('')
      + '<span>x = seconds since request (includes load + prompt processing)</span>';
  }

  async showRunLogs(r) {
    const el = $('runlogs');
    el.style.display = 'block';
    $('runlogstitle').textContent = `Logs for run ${new Date(r.ts).toLocaleTimeString()} · ${r.model}`;
    el.textContent = 'loading…';
    const since = Math.floor(new Date(r.ts) / 1000) - 1;
    const until = Math.ceil(new Date(r.end) / 1000) + 1;
    const res = await this.api.logs(`tail=all&since=${since}&until=${until}`);
    el.textContent = res.ok ? (await res.text()) || '(no log lines in this window)' : (await res.json()).error;
  }
}
