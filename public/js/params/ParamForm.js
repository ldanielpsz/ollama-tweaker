// A group of parameter-set rows for one scope (request or server).
export class ParamForm {
  constructor({ views }) {
    this.views = views;
  }

  mount(host) {
    for (const view of this.views) host.append(view.render());
  }

  values() {
    return Object.assign({}, ...this.views.map((v) => v.values()));
  }

  get(key) {
    return this.views.find((v) => v.has(key))?.values()[key];
  }

  set(values) {
    for (const view of this.views) view.set(values);
  }

  onChange(cb) {
    for (const view of this.views) view.onChange(cb);
  }

  // Clears every field some preset controls, then applies the chosen preset's values.
  applyPreset(presets, name) {
    const controlled = new Set(Object.values(presets).flatMap((p) => Object.keys(p)));
    const cleared = Object.fromEntries([...controlled].map((k) => [k, '']));
    this.set({ ...cleared, ...(presets[name] || {}) });
  }

  // "label: value" pairs for a settings object; scaled fields are shown in UI units.
  summary(settings) {
    return this.views.flatMap((view) => [...view.fields.values()].map((f) => {
      const v = settings[f.key];
      const shown = v === null || v === undefined ? 'auto'
        : f.type === 'bool' ? (v ? 'on' : 'off')
          : (f.scale ? `${Math.round(v / f.scale)}` : v);
      return `${f.label ?? f.key} ${shown}`;
    }));
  }
}
