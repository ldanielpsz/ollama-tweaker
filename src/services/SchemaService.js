// Publishes every injected parameter set (fields + layout) so the UI can render them generically.
class SchemaService {
  constructor({ requestStrategies, serverStrategies, presets }) {
    Object.assign(this, { requestStrategies, serverStrategies, presets });
  }

  describe() {
    return {
      request: this.requestStrategies.map((s) => s.schema()),
      server: this.serverStrategies.map((s) => s.schema()),
      presets: this.presets.presets,
      quants: this.presets.quants,
    };
  }
}

module.exports = { SchemaService };
