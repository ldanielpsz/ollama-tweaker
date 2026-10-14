// Base class for parameter-set strategies. A strategy owns *behaviour* (validate, map to the
// Ollama request or to container env); its parameter *definition* (fields + layout) is injected.
const fieldTypes = require('./fieldTypes');

class ParamStrategy {
  constructor({ definition }) {
    this.definition = definition;
    this.fields = new Map(definition.fields.map((f) => {
      if (!fieldTypes[f.type]) throw new Error(`${definition.id}.${f.key}: unknown field type "${f.type}"`);
      return [f.key, f];
    }));
    for (const [key, span] of definition.layout) {
      if (!this.fields.has(key)) throw new Error(`${definition.id}: layout references unknown field "${key}"`);
      if (!(span >= 1 && span <= 12)) throw new Error(`${definition.id}.${key}: column span must be 1-12`);
    }
  }

  get id() { return this.definition.id; }

  get scope() { return this.definition.scope; }

  // Plain JSON the UI renders into a 12-column row.
  schema() { return this.definition; }

  parseValue(key, raw) {
    const field = this.fields.get(key);
    return fieldTypes[field.type].parse(raw, field);
  }
}

module.exports = { ParamStrategy };
