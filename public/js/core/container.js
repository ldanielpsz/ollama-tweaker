// Same minimal IoC container as the server side (named deps, '#tag' injects tagged bindings as an array).
export class Container {
  #defs = new Map();
  #cache = new Map();
  #tags = new Map();

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
    const instance = factory();
    this.#cache.set(token, instance);
    return instance;
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
