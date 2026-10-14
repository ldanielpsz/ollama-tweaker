// Server-wide parameter sets: every field is an environment variable of the Ollama container.
// Applying them recreates the container. `scale` is a UI-only unit factor (shown = stored / scale).
const help = (title, what, values = [], impact = '') => ({ title, what, values, impact });

const kvcache = {
  id: 'kvcache',
  scope: 'server',
  title: 'KV cache',
  fields: [
    { key: 'kv_cache_type', label: 'KV cache type', type: 'select', env: 'OLLAMA_KV_CACHE_TYPE',
      default: 'f16', alwaysWrite: true,
      options: [{ value: 'f16', label: 'f16' }, { value: 'q8_0', label: 'q8_0' }, { value: 'q4_0', label: 'q4_0' }],
      help: help('KV cache type (server-wide)', 'Precision used to store the attention cache (K/V) during generation. Applies to every model after restart.',
        ['f16: full precision, default.', 'q8_0: about half the cache memory, usually near-identical quality.', 'q4_0: about a quarter of the memory, can hurt long-context accuracy.'],
        'Lower precision → much less cache VRAM, which lets you use a bigger num_ctx; slight quality risk. Needs flash attention.') },
    { key: 'flash_attention', label: 'flash attention', type: 'bool', env: 'OLLAMA_FLASH_ATTENTION',
      help: help('Flash attention', 'A memory-efficient attention kernel.',
        ['On: required for q8_0 / q4_0 KV cache; often faster at long context.', 'Off: only valid with f16 KV.'],
        'Lowers peak memory. A few models/GPUs fall back or ignore it.') },
  ],
  layout: [['kv_cache_type', 6], ['flash_attention', 6]],
};

const capacity = {
  id: 'capacity',
  scope: 'server',
  title: 'Capacity',
  fields: [
    { key: 'context_length', label: 'Default context', type: 'int', min: 0, step: 256, env: 'OLLAMA_CONTEXT_LENGTH', placeholder: 'auto',
      help: help('Default context (OLLAMA_CONTEXT_LENGTH)', 'num_ctx used when a request doesn’t set one. Empty = Ollama picks from VRAM (4k / 32k / 256k).',
        ['2048–8192: low memory.', '32768+: long documents.'],
        'Same linear KV-cache VRAM cost as num_ctx, multiplied by parallel slots.') },
    { key: 'num_parallel', label: 'Parallel slots', type: 'int', min: 0, env: 'OLLAMA_NUM_PARALLEL', placeholder: 'auto',
      help: help('Parallel slots (OLLAMA_NUM_PARALLEL)', 'Requests processed at the same time per model.',
        ['1: lowest latency for a single user.', '2–4: several users or agents.'],
        'Each slot gets its own context, so KV cache ≈ num_ctx × slots. More slots = more VRAM; per-request speed can fall under load.') },
    { key: 'max_loaded_models', label: 'Max loaded models', type: 'int', min: 0, env: 'OLLAMA_MAX_LOADED_MODELS', placeholder: 'auto',
      help: help('Max loaded models (OLLAMA_MAX_LOADED_MODELS)', 'How many different models may sit in memory at once. Empty = auto (3 × GPUs, or 1 on CPU).',
        ['1: swap models on demand.', '2+: keep several resident.'],
        'More models = more VRAM held, but no reload delay when switching.') },
    { key: 'max_queue', label: 'Max queue', type: 'int', min: 0, env: 'OLLAMA_MAX_QUEUE', placeholder: '512',
      help: help('Max queue (OLLAMA_MAX_QUEUE)', 'How many requests may wait before Ollama returns 503.',
        ['512: default.', 'Lower: fail fast under load.', 'Higher: absorb bursts.'],
        'Queued requests hold little memory; no VRAM effect.') },
  ],
  layout: [['context_length', 6], ['num_parallel', 6], ['max_loaded_models', 6], ['max_queue', 6]],
};

const memory = {
  id: 'memory',
  scope: 'server',
  title: 'Memory & offload',
  fields: [
    { key: 'gpu_overhead', label: 'GPU headroom (MB)', type: 'int', min: 0, scale: 1048576, step: 256, env: 'OLLAMA_GPU_OVERHEAD', placeholder: '0',
      help: help('GPU headroom (OLLAMA_GPU_OVERHEAD)', 'VRAM per GPU that Ollama leaves free and will not use for the model.',
        ['0: use everything available.', '512–1024 MB: room for the desktop or other apps.', 'Larger: more layers pushed to RAM.'],
        'More headroom = less VRAM used, more layers in RAM, slower but more stable. Helps avoid out-of-memory when something else shares the GPU.') },
    { key: 'fit', label: 'Auto-fit', type: 'select', env: 'LLAMA_ARG_FIT',
      options: [{ value: '', label: 'default (on)' }, { value: 'on', label: 'on' }, { value: 'off', label: 'off' }],
      help: help('Auto-fit (LLAMA_ARG_FIT)', 'llama.cpp automatically fits memory options (like layers on GPU or context) to available VRAM when you haven’t set them.',
        ['default / on: automatic.', 'off: only your explicit values are used; may fail to load if they don’t fit.'],
        'On = fewer load failures, but it may quietly move layers to RAM. Off gives exact control with num_gpu.') },
    { key: 'fit_target', label: 'Fit margin (MiB)', type: 'int', min: 0, step: 128, env: 'LLAMA_ARG_FIT_TARGET', placeholder: 'auto',
      help: help('Fit margin (LLAMA_ARG_FIT_TARGET)', 'VRAM in MiB that auto-fit keeps free per GPU.',
        ['empty: llama.cpp default.', '512–1024: safe margin for desktop use.', 'Larger: more layers go to RAM.'],
        'Similar to GPU headroom, but applied by the fit step. Bigger margin = less VRAM used, slower, more stable.') },
  ],
  layout: [['gpu_overhead', 6], ['fit', 6], ['fit_target', 6]],
};

const lifecycle = {
  id: 'lifecycle',
  scope: 'server',
  title: 'Lifecycle & logging',
  fields: [
    { key: 'keep_alive', label: 'Keep alive', type: 'duration', env: 'OLLAMA_KEEP_ALIVE', placeholder: '5m, 24h, -1',
      help: help('Keep alive (OLLAMA_KEEP_ALIVE)', 'Server default for how long idle models stay loaded.',
        ['5m: default.', '30m / 24h: stay warm.', '-1: never unload.', '0: unload right away.'],
        'Longer = VRAM stays occupied while idle; shorter = a cold load before the next request.') },
    { key: 'load_timeout', label: 'Load timeout', type: 'duration', env: 'OLLAMA_LOAD_TIMEOUT', placeholder: '5m',
      help: help('Load timeout (OLLAMA_LOAD_TIMEOUT)', 'How long a model load may stall before Ollama gives up.',
        ['5m: default.', '15m–30m: large models offloaded to slow disk or RAM.', '1m: fail fast.'],
        'No VRAM effect. Raise it for very large or slow-storage models.') },
    { key: 'sched_spread', label: 'spread across GPUs', type: 'bool', env: 'OLLAMA_SCHED_SPREAD',
      help: help('Spread across GPUs (OLLAMA_SCHED_SPREAD)', 'Always split a model over all GPUs instead of packing onto as few as possible.',
        ['off: use the fewest GPUs that fit.', 'on: use every GPU.'],
        'Only matters with 2+ GPUs; more VRAM used in total but can balance load. No effect with a single GPU.') },
    { key: 'debug', label: 'debug logs', type: 'bool', env: 'OLLAMA_DEBUG',
      help: help('Debug logs (OLLAMA_DEBUG)', 'Verbose server and runner logging.',
        ['on: shows layer placement, memory estimates and timings in the log panel.', 'off: quieter.'],
        'No VRAM effect; larger logs.') },
  ],
  layout: [['keep_alive', 6], ['load_timeout', 6], ['sched_spread', 6], ['debug', 6]],
};

module.exports = { kvcache, capacity, memory, lifecycle };
