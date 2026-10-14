const { ParamStrategy } = require('./ParamStrategy');

// Per-request parameters: contributes to the body sent to Ollama's /api/generate.
// A field's `target` decides where it lands: 'options' (default) or top-level 'payload'.
class RequestParamStrategy extends ParamStrategy {
  parse(raw = {}) {
    const out = {};
    for (const key of this.fields.keys()) {
      if (!(key in raw)) continue;
      const v = this.parseValue(key, raw[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  apply(payload, values) {
    for (const [key, v] of Object.entries(values)) {
      const target = this.fields.get(key).target || 'options';
      if (target === 'payload') payload[key] = v;
      else payload.options[key] = v;
    }
    return payload;
  }
}

module.exports = { RequestParamStrategy };
