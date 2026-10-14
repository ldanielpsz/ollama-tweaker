const { HttpError } = require('../core/http');

const envOf = (env, name) => {
  const hit = env.find((e) => e.startsWith(name + '='));
  return hit ? (hit.slice(name.length + 1) || null) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads the Ollama container's env through the injected server-parameter strategies, and applies
// changes by recreating the container (env cannot change on a running one), with rollback.
class ServerSettingsService {
  constructor({ docker, ollama, config, strategies }) {
    Object.assign(this, { docker, ollama, config, strategies });
    this.current = {};
    this.restarting = false;
    this.read().catch(() => {});
  }

  get #name() { return encodeURIComponent(this.config.ollamaContainer); }

  async read() {
    const r = await this.docker.request('GET', `/containers/${this.#name}/json`);
    if (r.status !== 200) throw new Error(r.json?.message || `docker inspect failed (${r.status})`);
    const env = r.json.Config.Env || [];
    const lookup = (n) => envOf(env, n);
    const settings = { container_state: r.json.State.Status, started_at: r.json.State.StartedAt };
    for (const s of this.strategies) Object.assign(settings, s.fromEnv(lookup));
    this.current = settings;
    return { info: r.json, settings };
  }

  // Server values stored with each run: every strategy field, null when unset.
  snapshot() {
    const out = {};
    for (const s of this.strategies) for (const key of s.fields.keys()) out[key] = this.current[key] ?? null;
    return out;
  }

  async apply(incoming) {
    if (this.restarting) throw new HttpError(409, 'a restart is already in progress');
    this.restarting = true;
    try {
      return await this.#apply(incoming);
    } finally {
      this.restarting = false;
    }
  }

  async #apply(incoming) {
    const { info: old, settings: cur } = await this.read();

    let next = { ...cur };
    try {
      for (const s of this.strategies) Object.assign(next, s.parsePartial(incoming));
      for (const s of this.strategies) next = s.normalize(next);
    } catch (e) {
      throw new HttpError(400, e.message);
    }

    const managed = new Set(this.strategies.flatMap((s) => s.envNames()));
    const Env = (old.Config.Env || []).filter((e) => !managed.has(e.slice(0, e.indexOf('='))));
    for (const s of this.strategies) for (const [name, value] of s.toEnv(next)) Env.push(`${name}=${value}`);

    const shortId = old.Id.slice(0, 12);
    const EndpointsConfig = {};
    for (const [net, n] of Object.entries(old.NetworkSettings.Networks || {})) {
      EndpointsConfig[net] = { Aliases: (n.Aliases || []).filter((a) => a !== shortId), IPAMConfig: n.IPAMConfig || undefined };
    }
    const body = {
      ...old.Config, Hostname: '', Env,
      HostConfig: old.HostConfig,
      NetworkingConfig: { EndpointsConfig },
    };

    const enc = encodeURIComponent;
    const name = this.config.ollamaContainer;
    const tmpName = `${name}-old-${Date.now()}`;
    let r = await this.docker.request('POST', `/containers/${enc(name)}/rename?name=${enc(tmpName)}`);
    if (r.status >= 300) throw new Error('rename failed: ' + (r.json?.message || r.text));

    const rollback = async (newId) => {
      if (newId) await this.docker.request('DELETE', `/containers/${newId}?force=1`).catch(() => {});
      await this.docker.request('POST', `/containers/${enc(tmpName)}/rename?name=${enc(name)}`).catch(() => {});
      await this.docker.request('POST', `/containers/${enc(name)}/start`).catch(() => {});
    };

    let newId = null;
    try {
      r = await this.docker.request('POST', `/containers/create?name=${enc(name)}`, body);
      if (r.status !== 201) throw new Error('create failed: ' + (r.json?.message || r.text));
      newId = r.json.Id;
      await this.docker.request('POST', `/containers/${enc(tmpName)}/stop?t=15`);
      r = await this.docker.request('POST', `/containers/${newId}/start`);
      if (r.status >= 300) throw new Error('start failed: ' + (r.json?.message || r.text));
      const attempts = this.config.readyAttempts ?? 60;
      const pollMs = this.config.readyPollMs ?? 1000;
      let up = false;
      for (let i = 0; i < attempts && !up; i++) {
        up = await this.ollama.isUp();
        if (!up) await sleep(pollMs);
      }
      if (!up) throw new Error(`ollama did not become ready within ${Math.round((attempts * pollMs) / 1000)}s`);
    } catch (e) {
      await rollback(newId);
      throw new Error(e.message + ' (rolled back to the previous container)');
    }
    await this.docker.request('DELETE', `/containers/${enc(tmpName)}?force=1`).catch(() => {});
    return (await this.read()).settings;
  }
}

module.exports = { ServerSettingsService };
