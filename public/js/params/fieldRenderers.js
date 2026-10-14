import { h } from '../core/dom.js';

// Field-type renderer strategies. Each returns a control: { el, get(), set(v), onChange(cb) }.
const control = (el, get, set, event = 'input') => ({
  el, get, set, onChange: (cb) => el.addEventListener(event, cb),
});

const numeric = (f) => {
  const el = h('input', { type: 'number', step: f.step, min: f.min, max: f.max, placeholder: f.placeholder ?? '' });
  return control(el, () => el.value, (v) => { el.value = v ?? ''; });
};

const textual = (f) => {
  const el = h('input', { type: 'text', placeholder: f.placeholder ?? '' });
  return control(el, () => el.value.trim(), (v) => { el.value = Array.isArray(v) ? v.join(', ') : (v ?? ''); });
};

const selectOf = (options) => (f) => {
  const opts = f.options || options;
  const el = h('select', {}, opts.map((o) => h('option', { value: String(o.value) }, o.label)));
  return control(el, () => el.value, (v) => { el.value = v === null || v === undefined ? '' : String(v); }, 'change');
};

const checkbox = () => {
  const el = h('input', { type: 'checkbox' });
  return control(el, () => el.checked, (v) => { el.checked = !!v; }, 'change');
};

export const fieldRenderers = {
  int: numeric,
  number: numeric,
  text: textual,
  duration: textual,
  list: textual,
  select: selectOf([]),
  tribool: selectOf([{ value: '', label: 'default' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]),
  bool: checkbox,
};
