// Thin client for the wrapper endpoints and the proxied Ollama API.
export class Api {
  async json(path, init) {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${path}: ${res.status}`);
    return body;
  }

  schema() { return this.json('/wrapper/schema'); }
  tags() { return this.json('/api/tags'); }
  ps() { return this.json('/api/ps'); }
  runs() { return this.json('/wrapper/runs'); }
  deleteRun(id) { return this.json(`/wrapper/runs/${id}`, { method: 'DELETE' }); }
  clearRuns() { return this.json('/wrapper/runs', { method: 'DELETE' }); }
  serverSettings() { return this.json('/wrapper/server-settings'); }

  applyServerSettings(values) {
    return this.json('/wrapper/server-settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values),
    });
  }

  // Raw responses for streaming endpoints.
  generate(body, signal) {
    return fetch('/wrapper/generate', {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  pull(model) {
    return fetch('/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  }

  logs(query, signal) { return fetch(`/wrapper/logs?${query}`, { signal }); }
}
