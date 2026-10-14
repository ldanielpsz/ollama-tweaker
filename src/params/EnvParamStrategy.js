const { ParamStrategy } = require('./ParamStrategy');
const fieldTypes = require('./fieldTypes');

// Server-wide parameters: each field maps to an environment variable of the Ollama container.
class EnvParamStrategy extends ParamStrategy {
  envNames() {
    return [...this.fields.values()].map((f) => f.env);
  }

  // envOf(name) -> string | null. Returns { key: value } using the field default when unset.
  fromEnv(envOf) {
    const out = {};
    for (const f of this.fields.values()) {
      const raw = envOf(f.env);
      if (raw === null) out[f.key] = f.type === 'bool' ? false : (f.default ?? null);
      else out[f.key] = fieldTypes[f.type].fromEnv(raw);
    }
    return out;
  }

  // Only keys present in `raw` are parsed; an empty value means "unset" (null).
  parsePartial(raw = {}) {
    const out = {};
    for (const key of this.fields.keys()) {
      if (!(key in raw)) continue;
      const v = this.parseValue(key, raw[key]);
      out[key] = v === undefined ? null : v;
    }
    return out;
  }

  // Cross-field rules; receives and returns the full merged settings object.
  normalize(values) {
    return values;
  }

  // -> [[ENV_NAME, 'value'], ...] for every field that should be set on the container.
  toEnv(values) {
    const pairs = [];
    for (const f of this.fields.values()) {
      const v = values[f.key];
      if (f.type === 'bool') pairs.push([f.env, fieldTypes.bool.toEnv(v)]);
      else if (v !== null && v !== undefined) pairs.push([f.env, fieldTypes[f.type].toEnv(v)]);
      else if (f.alwaysWrite && f.default !== undefined) pairs.push([f.env, String(f.default)]);
    }
    return pairs;
  }
}

module.exports = { EnvParamStrategy };
