import { h } from '../core/dom.js';

// Builds a "?" button and the box it toggles. Used for schema fields and for hand-coded controls.
export function helpBubble({ title, what, values = [], impact = '' }) {
  const box = h('div', { class: 'helpbox', hidden: true },
    h('b', {}, title), what,
    values.length ? h('ul', {}, values.map((v) => h('li', {}, v))) : '',
    impact ? h('div', { class: 'vram', style: 'margin-top:4px' }, `Impact: ${impact}`) : '');
  const button = h('button', {
    type: 'button', class: 'q', title: 'Click for values and impact',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); box.hidden = !box.hidden; },
  }, '?');
  return { button, box };
}

// Appends the "?" to `label` and places the box after `host` (defaults to the label itself).
export function attachHelp(label, help, host = label) {
  const { button, box } = helpBubble(help);
  label.append(button);
  host.after(box);
}

// Help for the controls that are not schema-driven (model selection and the prompt area).
export const STATIC_HELP = {
  lbl_base: {
    title: 'Model', what: 'Installed models read from the shared Ollama store.',
    values: ['Larger parameter count: better quality, more VRAM, slower tokens/s.', 'Model weights are the biggest VRAM item; KV cache comes on top.'],
    impact: 'Weights ≈ size shown in the list.',
  },
  lbl_quant: {
    title: 'Quantization (weights)', what: 'Precision of the model weights. Needs that tag to be pulled.',
    values: ['as installed: use the selected model unchanged.', 'q2_K / q3_K_M: smallest, noticeably worse quality.', 'q4_0 / q4_K_M: common sweet spot (~4.5 bits).',
      'q5_*: slightly better quality, ~20% bigger than q4.', 'q6_K / q8_0: near-lossless, ~2× q4 size.', 'fp16: full precision, largest and slowest.'],
    impact: 'Fewer bits → less VRAM and usually faster; more bits → better answers.',
  },
  lbl_preset: {
    title: 'Preset', what: 'Starting values for the sampling and context fields.',
    values: ['default: temp 0.7, top_p 0.9, 128 tokens.', 'memory_optimized: num_ctx 1024, repeat_penalty 1.1.', 'high_quality: num_ctx 2048, temp 0.8, top_p 0.95.'],
    impact: 'Presets with smaller num_ctx use less KV-cache VRAM.',
  },
  lbl_override: {
    title: 'Tag override / pull', what: 'Type any Ollama tag, e.g. name:7b-instruct-q4_K_M. It replaces the dropdown and is what “Pull” downloads.',
  },
  lbl_system: {
    title: 'System prompt (supports attach / drag-drop)', what: 'Instruction placed before the prompt, in the model’s system role.',
    values: ['Short and specific works best.'],
    impact: 'Counts toward num_ctx and prompt-processing time; no other VRAM effect. The model’s template must support a system role.',
  },
};
