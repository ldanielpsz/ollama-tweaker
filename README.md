# Ollama Tweaker

**A self-hosted KV cache & flash attention tweaker for local LLMs.**

Ollama Tweaker is a small web app that sits in front of an [Ollama](https://ollama.com) server and lets you
change the settings that decide how much memory a model uses and how fast it runs — **KV cache type, flash
attention, context size, parallel slots, GPU/CPU layer offload** — then measure the result: tokens per second,
time to first token, VRAM and RAM usage, per run, over a timeline.

It is built for people who run their own models and want to know *what a setting actually costs* on *their*
hardware, before they commit to it.

> Built first for my homelab and for a business application I work on that has some on-site (customer
> premises) deployments. Open source because it might be useful to others; contributions are welcome.

---

## What it does

- **Wraps Ollama's request parameters** (sampling, context, offload) in a single UI, each with a **?** bubble
  explaining the possible values and their impact on VRAM, speed and quality.
- **Changes server-wide settings** (KV cache type, flash attention, default context, parallel slots, GPU
  headroom, auto-fit, keep-alive…) and **restarts Ollama with the new environment** for you.
- **Records every run**: generation tok/s (avg / min / max), prompt-processing tok/s, time to first token,
  VRAM min / avg / max, how much of the model spilled to RAM — stored on disk and plotted as a timeline you
  can overlay across runs.
- **Streams Ollama's container logs** live, and shows the log window of any past run.
- **Handles prompts and system prompts from files** (attach or drag-and-drop).
- **Shares one model store** with other Ollama stacks through a Docker volume.
- **Runs offline**: no CDN assets, no npm dependencies, no telemetry. Suitable for air-gapped or on-site
  installs (models can be imported from local GGUF files).

## Architecture

### What gets deployed

```
                           your network / LAN
 ┌──────────────┐
 │   Browser    │
 └──────┬───────┘
        │ http :8080
 ┌──────▼───────────────────────────── docker host ─────────────────────────────────────┐
 │                                                                                       │
 │  ┌─────────────── tweaker (Node, no deps) ──────────────┐   ┌─── tweaker-ollama ────┐  │
 │  │  static UI   /wrapper/*  (schema, generate, runs…)   │   │  ollama/ollama        │  │
 │  │              /api/*      (proxy to Ollama)           │──►│  :11434 (internal)    │  │
 │  │                                                      │   │                       │  │
 │  │  run history ──► /data/runs.jsonl                    │   │  llama.cpp runner     │  │
 │  └───────┬─────────────────────────┬────────────────────┘   └───┬───────────┬──────┘  │
 │          │ docker.sock             │ tweaker-data               │           │ GPU     │
 │          │ (logs, recreate         ▼ (volume)                   ▼           ▼         │
 │          │  container with     ┌──────────┐             ┌────────────┐  ┌────────┐    │
 │          └─ new env)           │ run data │             │ model store│  │ NVIDIA │    │
 │                                └──────────┘             │ (volume)   │  │  GPU   │    │
 │                                                         └────────────┘  └────────┘    │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

- **`tweaker`** serves the UI, proxies the Ollama API, runs the instrumented generation, and stores run
  history. It is the only thing exposed (port `8080`).
- **`tweaker-ollama`** is a stock Ollama container. Ollama's port is not published to the host.
- **Docker socket**: used to stream the Ollama container's logs and to recreate it when you change a
  server-wide setting (environment variables cannot change on a running container). See
  [Security](#security).
- **Model store**: a Docker volume. Point other Ollama stacks at the same volume and they share models.

### How a request flows

```
 Browser form ──► POST /wrapper/generate { model, preset, prompt, system, params }
                       │
                       ▼
        GenerateService ── builds the Ollama payload from the request parameter sets
                       │                    ┌──────────────────────────────┐
                       ├──► Ollama /api/generate (streams NDJSON back to UI) │
                       │                    └──────────────────────────────┘
                       ├──► samples /api/ps every 0.5 s  → VRAM / RAM split
                       └──► RunRecorder → run record → RunStore (JSONL) → timeline in the UI
```

### Inside the app: strategies, injected definitions, 12-column rows

`server.js` is only a web server. Everything else is wired in one composition root (`src/bootstrap.js`)
through a tiny IoC container.

```
 definitions (data)                strategies (behaviour)              consumers
 ─────────────────                 ──────────────────────              ─────────
 request.js                        RequestParamStrategy ─────────────► GenerateService
   context, sampling,                parse → validate                    (payload.options /
   sampling_advanced, hardware       apply → Ollama payload               top-level payload)
                                                                       
 server.js                         EnvParamStrategy ─────────────────► ServerSettingsService
   kvcache, capacity,              KvCacheStrategy (adds a rule:        (container env →
   memory, lifecycle                quantized KV ⇒ flash attention)      recreate container)
                                                                       
        └────────────── published as JSON at /wrapper/schema ──────────► browser
                                                                          │
                                  ParamSetView renders each definition as a 12-column row;
                                  the definition's own `layout` [[field, span], …] places the fields
```

Adding a parameter means adding **one entry** to a definition file (key, type, help text, layout slot).
Validation, request/env mapping, form rendering, the **?** bubble and the per-run settings snapshot all
follow from it.

## Testing a model

The goal is to change **one thing at a time** and compare runs. Use the same prompt, and for comparable
output set a fixed `seed` and a low `temperature`.

### Request-level knobs (no restart)

| Parameter | What you learn |
|---|---|
| `num_ctx` | How KV cache memory grows with context; where the model starts spilling to RAM |
| `num_predict` | Throughput over different output lengths; how tok/s changes as the context fills |
| `num_gpu` | The speed cost of each layer moved from VRAM to system RAM |
| `num_batch`, `num_thread` | Prompt-processing speed and CPU-side throughput when offloading |
| sampling (`temperature`, `top_k`, `min_p`, `mirostat`, …) | Output behaviour; no VRAM effect |
| `use_mmap`, `use_mlock` | Load time and steadiness when weights live in RAM |

### Server-level knobs (applying restarts Ollama)

| Setting | What you learn |
|---|---|
| **KV cache type** `f16` / `q8_0` / `q4_0` | Cache VRAM saved vs. quality and speed impact |
| **Flash attention** | Peak memory and long-context speed (required for quantized KV) |
| Default context, parallel slots | How cache scales with `num_ctx × slots` |
| GPU headroom, auto-fit, fit margin | How aggressively layers are pushed to RAM |
| Keep-alive, load timeout, max loaded models | Cold-start cost and residency behaviour |

### Suggested experiments

1. **KV cache sweep** — fix model, prompt, `num_ctx`, `seed`. Run once per KV type (`f16`, `q8_0`, `q4_0`).
   Overlay the runs: VRAM max, tok/s, and compare the answers.
2. **Context scaling** — same settings, raise `num_ctx` step by step. Watch **VRAM max**, **RAM GB** and
   **GPU %**; note the point where the model starts spilling.
3. **Offload curve** — lower `num_gpu` in steps and plot generation tok/s against layers on GPU.
4. **Does a bigger context pay for itself?** — pair a quantized KV cache with a larger `num_ctx` and compare
   against `f16` with a smaller one at similar VRAM.

### What is measured

| Metric | Source |
|---|---|
| Generation tok/s (avg) | Ollama's `eval_count / eval_duration` |
| Generation tok/s (min / max) | Token stream bucketed into 0.5 s windows (full windows only) |
| Prompt tok/s | `prompt_eval_count / prompt_eval_duration` |
| Time to first token | First streamed chunk, includes model load |
| VRAM min / avg / max | Sampled from Ollama `/api/ps` every 0.5 s |
| RAM GB / GPU % | `size` vs. `size_vram` of the loaded model (weights + KV cache) |

**Limits worth knowing**

- Ollama reports prompt processing as a **single aggregate** per run, so per-run min/max for it equals the
  average. Min/avg/max appear in the aggregate line across selected runs.
- VRAM comes from what Ollama has **allocated** (weights + cache), not live driver usage, so within one run
  it is mostly flat. It differs clearly *between* runs and settings.
- Token timing is observed at the stream, so very short outputs have little timeline resolution.

## Quick start

Requirements: Docker with Compose; for GPU use, an NVIDIA GPU and the NVIDIA Container Toolkit.

```bash
git clone <this repo> && cd ollama-tweaker

# The compose file expects an external volume for the shared model store.
# Create it (or edit docker-compose.yml to use a normal named volume):
docker volume create ollama_data

docker compose up -d --build
# open http://localhost:8080
```

No GPU? Remove the `deploy:` block from the `ollama` service in `docker-compose.yml`.

Then: pick or pull a model, choose a preset, change a parameter, **Generate**, and select runs in the table
to overlay them on the timeline.

To import a local GGUF instead of pulling from a registry, mount its directory (see the `/models` mount in
the compose file) and use `Modelfile.example` as a starting point with `ollama create`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `OLLAMA_URL` | `http://ollama:11434` | Where the Ollama API is |
| `OLLAMA_CONTAINER` | `ollama` | Container to read logs from and recreate |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker Engine socket |
| `DATA_DIR` | `./data` | Run history (`runs.jsonl`) |

## Security

This tool is meant for **trusted networks** (a homelab, a customer's internal LAN):

- **No authentication.** Anyone who can reach port `8080` can run generations and change server settings.
  Put it behind a reverse proxy with auth, or bind it to localhost, if that is not acceptable.
- **The Docker socket is mounted** into the `tweaker` container. That is root-equivalent control of the
  host's Docker. It is needed only for the log panel and the "apply & restart" feature. If you do not need
  them, remove the mount — the rest of the app keeps working.
- Changes applied from the UI are **not written back** to `docker-compose.yml`; a later `docker compose up`
  recreates Ollama with the compose values.

## Project layout

```
server.js                   web server: routes + static files only
src/
  bootstrap.js              composition root (definitions → strategies → services)
  core/                     IoC container, HTTP helpers
  params/
    definitions/            parameter sets as data: fields, help text, layout
    *Strategy.js            request / env / KV-cache strategies, field types
  services/                 Ollama + Docker clients, generation, metrics, run store,
                            server settings, logs, schema
public/
  index.html, css/          UI skeleton, 12-column grid
  js/                       client composition root, parameter rows, feature panels
test/                       unit tests (node:test, no dependencies)
```

### HTTP API

| Route | Purpose |
|---|---|
| `GET /wrapper/schema` | Parameter sets (fields + layout), presets, quant tags |
| `POST /wrapper/generate` | Instrumented streaming generation; records a run |
| `GET /wrapper/server-settings` · `POST` | Read / apply server-wide settings (recreates the container) |
| `GET /wrapper/runs` · `DELETE /wrapper/runs[/:id]` | Run history |
| `GET /wrapper/logs?follow=1&tail=200` | Ollama container logs |
| `/api/*` | Pass-through to Ollama (tags, pull, ps, show, delete…) |

## Development

```bash
npm test          # unit tests, no dependencies; Node 20+
node server.js    # needs OLLAMA_URL reachable; log/settings features need the Docker socket
```

## Contributing

Contributions are welcome — bug reports, new parameters, new metrics, UI improvements, other backends.
Good first steps:

- **Add a parameter**: one entry in `src/params/definitions/*.js` (plus a test if it has a special rule).
- **Add a rule**: subclass `EnvParamStrategy` or `RequestParamStrategy`, like `KvCacheStrategy`.
- Keep it dependency-free where practical, and add or update tests (`npm test`).

Ideas that would be useful: auth, exporting runs to CSV, side-by-side prompt comparison, other
accelerators (AMD/Intel), a non-Docker deployment mode.

## License

[MIT](LICENSE) © Luis Ponce
