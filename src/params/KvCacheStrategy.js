const { EnvParamStrategy } = require('./EnvParamStrategy');

// Quantized KV cache (q8_0 / q4_0) requires flash attention.
class KvCacheStrategy extends EnvParamStrategy {
  normalize(values) {
    if (values.kv_cache_type && values.kv_cache_type !== 'f16') return { ...values, flash_attention: true };
    return values;
  }
}

module.exports = { KvCacheStrategy };
