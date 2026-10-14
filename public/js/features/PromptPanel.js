import { $ } from '../core/dom.js';
import { attachHelp, STATIC_HELP } from '../ui/help.js';

const MAX_FILE = 2 * 1024 * 1024;
const tokensOf = (s) => Math.ceil(s.length / 4); // rough: ~4 chars per token

// System prompt + prompt text areas with file attach (button or drag-and-drop) and a token estimate.
export class PromptPanel {
  constructor({ requestForm }) {
    this.requestForm = requestForm;
    this.target = null;
  }

  init() {
    attachHelp($('lbl_system'), STATIC_HELP.lbl_system);
    document.addEventListener('click', (e) => {
      const attach = e.target.dataset?.attach;
      const clear = e.target.dataset?.clear;
      if (attach) { this.target = attach; $('filepick').value = ''; $('filepick').click(); }
      if (clear) { $(clear).value = ''; this.updateInfo(clear); }
    });
    $('filepick').onchange = (e) => this.target && this.attach(this.target, [...e.target.files]);
    for (const id of ['prompt', 'system']) {
      const el = $(id);
      el.addEventListener('input', () => this.updateInfo(id));
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); this.attach(id, [...e.dataTransfer.files]); });
    }
    this.requestForm.onChange((key) => { if (key === 'num_ctx') { this.updateInfo('prompt'); this.updateInfo('system'); } });
    this.updateInfo('prompt');
    this.updateInfo('system');
  }

  system() { return $('system').value; }

  prompt() { return $('prompt').value; }

  updateInfo(id) {
    const t = $(id).value;
    const ctx = Number(this.requestForm.get('num_ctx')) || 0;
    const tok = tokensOf(t);
    let msg = t ? `${t.length.toLocaleString()} chars ≈ ${tok.toLocaleString()} tokens` : '';
    if (ctx && tok > ctx) msg += ` — exceeds num_ctx ${ctx}, the start will be cut off`;
    $(`${id}_info`).textContent = msg;
  }

  async attach(id, files) {
    const el = $(id);
    const notes = [];
    for (const f of files) {
      if (f.size > MAX_FILE) { notes.push(`${f.name}: too large (max 2 MB)`); continue; }
      const text = await f.text();
      if (text.includes('\u0000') || (text.match(/�/g) || []).length > 5) { notes.push(`${f.name}: looks binary, skipped`); continue; }
      el.value += `${files.length > 1 || el.value ? `\n\n--- ${f.name} ---\n` : ''}${text}`;
    }
    this.updateInfo(id);
    if (notes.length) $(`${id}_info`).textContent = `${notes.join(' · ')} · ${$(`${id}_info`).textContent}`;
  }
}
