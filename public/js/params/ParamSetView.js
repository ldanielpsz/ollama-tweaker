import { h } from '../core/dom.js';
import { attachHelp } from '../ui/help.js';

// Renders one injected parameter definition as a Bootstrap-style 12-column row.
// The definition's own `layout` ([key, span] pairs) decides each field's column and order.
export class ParamSetView {
  constructor({ definition, renderers }) {
    this.definition = definition;
    this.renderers = renderers;
    this.fields = new Map(definition.fields.map((f) => [f.key, f]));
    this.controls = new Map();
  }

  has(key) { return this.fields.has(key); }

  render() {
    const def = this.definition;
    const root = h(def.collapsed ? 'details' : 'div', { class: 'pset', 'data-set': def.id },
      h(def.collapsed ? 'summary' : 'h3', {}, def.title));
    const row = h('div', { class: 'b-row' });
    for (const [key, span] of def.layout) row.append(this.#cell(this.fields.get(key), span));
    root.append(row);
    return root;
  }

  #cell(field, span) {
    const render = this.renderers[field.type];
    if (!render) throw new Error(`no renderer for field type "${field.type}"`);
    const control = render(field);
    this.controls.set(field.key, control);

    const col = h('div', { class: `b-col-${span}` });
    const isBool = field.type === 'bool';
    const label = h('label', { class: isBool ? 'inline' : '' }, isBool ? [control.el, field.label ?? field.key] : (field.label ?? field.key));
    col.append(label);
    if (!isBool) col.append(control.el);
    if (field.help) attachHelp(label, field.help, col.lastElementChild);
    return col;
  }

  // Values are returned in the unit the server stores; `scale` converts to/from the unit shown in the UI.
  values() {
    const out = {};
    for (const [key, control] of this.controls) {
      const f = this.fields.get(key);
      const raw = control.get();
      out[key] = f.scale && raw !== '' && typeof raw === 'string' ? String(Math.round(Number(raw) * f.scale)) : raw;
    }
    return out;
  }

  set(values) {
    for (const [key, v] of Object.entries(values)) {
      const control = this.controls.get(key);
      if (!control) continue;
      const f = this.fields.get(key);
      control.set(f.scale && v !== null && v !== '' && v !== undefined ? Math.round(v / f.scale) : v);
    }
  }

  onChange(cb) {
    for (const [key, control] of this.controls) control.onChange(() => cb(key, control.get()));
  }
}
