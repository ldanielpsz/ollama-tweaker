// Minimal IoC container: values, class bindings with named dependencies, and tags (injected as arrays).
//   c.value('config', {...})
//   c.bind('runStore', RunStore, { config: 'config' })        -> new RunStore({ config })
//   c.tag('param.request', ['def.a', 'def.b'])
//   c.bind('svc', Svc, { strategies: '#param.request' })        -> '#tag' injects every tagged binding as an array
class Container {
  #defs = new Map();
  #cache = new Map();
  #tags = new Map();
  #resolving = new Set();

  value(token, v) {
    this.#defs.set(token, () => v);
    return this;
  }

  bind(token, Class, deps = {}) {
    this.#defs.set(token, () => new Class(this.#inject(deps)));
    return this;
  }

  tag(tag, tokens) {
    this.#tags.set(tag, [...(this.#tags.get(tag) || []), ...tokens]);
    return this;
  }

  resolve(token) {
    if (this.#cache.has(token)) return this.#cache.get(token);
    const factory = this.#defs.get(token);
    if (!factory) throw new Error(`container: nothing bound for "${token}"`);
    if (this.#resolving.has(token)) throw new Error(`container: circular dependency at "${token}"`);
    this.#resolving.add(token);
    try {
      const instance = factory();
      this.#cache.set(token, instance);
      return instance;
    } finally {
      this.#resolving.delete(token);
    }
  }

  resolveTagged(tag) {
    return (this.#tags.get(tag) || []).map((t) => this.resolve(t));
  }

  #inject(deps) {
    return Object.fromEntries(Object.entries(deps).map(([name, token]) => [
      name,
      token.startsWith('#') ? this.resolveTagged(token.slice(1)) : this.resolve(token),
    ]));
  }
}

module.exports = { Container };
