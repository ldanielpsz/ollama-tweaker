import { $, readNdjson } from '../core/dom.js';
import { attachHelp, STATIC_HELP } from '../ui/help.js';

// Model dropdown, quantization/preset selects, tag override, pull and the "loaded models" line.
export class ModelPicker {
  constructor({ api, schema, requestForm }) {
    Object.assign(this, { api, schema, requestForm });
  }

  init() {
    $('quant').innerHTML = '<option value="">as installed</option>'
      + this.schema.quants.map((q) => `<option>${q}</option>`).join('');
    $('preset').innerHTML = Object.keys(this.schema.presets).map((p) => `<option>${p}</option>`).join('');
    for (const [id, help] of Object.entries(STATIC_HELP)) {
      if ($(id) && id !== 'lbl_system') attachHelp($(id), help);
    }
    this.applyPreset();
    $('preset').onchange = () => this.applyPreset();
    for (const id of ['base', 'quant', 'override']) $(id).oninput = () => this.refresh();
    $('pull').onclick = () => this.pull();
    this.refresh();
    this.loadTags();
    this.loadPs();
  }

  // Override wins; otherwise the installed model, optionally swapped to another quant tag of the same family.
  model() {
    return $('override').value.trim()
      || ($('quant').value ? `${$('base').value.split(':')[0]}:${$('quant').value}` : $('base').value);
  }

  preset() { return $('preset').value; }

  refresh() { $('resolved').textContent = this.model(); }

  applyPreset() { this.requestForm.applyPreset(this.schema.presets, this.preset()); }

  async pull() {
    $('pull').disabled = true;
    try {
      const res = await this.api.pull(this.model());
      await readNdjson(res, (d) => {
        $('pullstat').textContent = d.error || (d.total ? `${d.status} ${(100 * d.completed / d.total).toFixed(0)}%` : d.status);
      });
    } catch (e) { $('pullstat').textContent = e.message; }
    $('pull').disabled = false;
    this.loadTags();
  }

  async loadTags() {
    try {
      const { models } = await this.api.tags();
      const cur = $('base').value;
      $('base').innerHTML = models.length
        ? models.map((m) => `<option value="${m.name}">${m.name} · ${m.details?.parameter_size || '?'} · ${m.details?.quantization_level || '?'} · ${(m.size / 1e9).toFixed(1)} GB</option>`).join('')
        : '<option value="">(no models — pull one below)</option>';
      if (models.some((m) => m.name === cur)) $('base').value = cur;
      this.refresh();
    } catch { /* ollama restarting */ }
  }

  async loadPs() {
    try {
      const { models } = await this.api.ps();
      $('ps').textContent = models.length
        ? 'Loaded: ' + models.map((m) => `${m.name} (${(m.size / 1e9).toFixed(1)} GB: VRAM ${(m.size_vram / 1e9).toFixed(1)} GB, RAM ${((m.size - m.size_vram) / 1e9).toFixed(1)} GB, ${Math.round(100 * m.size_vram / m.size)}% on GPU)`).join('; ')
        : 'No model loaded.';
    } catch { /* ollama restarting */ }
  }
}
