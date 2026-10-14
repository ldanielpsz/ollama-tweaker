import { $, confirmButton } from '../core/dom.js';

// Server-wide settings form (env vars of the Ollama container) + the "apply & restart" action.
export class ServerPanel {
  constructor({ api, serverForm, picker }) {
    Object.assign(this, { api, serverForm, picker });
  }

  async init() {
    // Quantized KV cache needs flash attention: reflect that immediately in the form.
    this.serverForm.onChange((key, value) => {
      if (key === 'kv_cache_type' && value !== 'f16') this.serverForm.set({ flash_attention: true });
    });
    confirmButton($('kvapply'), {
      armedLabel: 'Click again: this interrupts running generations',
      onConfirm: () => this.apply(),
    });
    await this.load();
  }

  async load() {
    try {
      const s = await this.api.serverSettings();
      this.serverForm.set(s);
      $('kvstat').textContent = `Running: ${this.serverForm.summary(s).join(', ')} (${s.container_state})`;
    } catch (e) { $('kvstat').textContent = e.message; }
  }

  async apply() {
    const btn = $('kvapply');
    btn.disabled = true;
    btn.textContent = 'Restarting…';
    $('kvstat').textContent = 'Recreating the Ollama container…';
    try {
      await this.api.applyServerSettings(this.serverForm.values());
      await this.load();
      this.picker.loadTags();
      this.picker.loadPs();
    } catch (e) { $('kvstat').textContent = 'Failed: ' + e.message; }
    btn.disabled = false;
    btn.textContent = 'Apply & restart Ollama';
  }
}
