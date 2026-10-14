// Named starting values for request parameters, plus the known quantization tags.
// Mirrors generateMemoryOptimized / generateHighQuality from the original C++ wrappers.
class PresetCatalog {
  constructor() {
    this.presets = {
      default: { temperature: 0.7, top_p: 0.9, num_predict: 128 },
      memory_optimized: { temperature: 0.7, top_p: 0.9, num_predict: 128, num_ctx: 1024, repeat_penalty: 1.1 },
      high_quality: { temperature: 0.8, top_p: 0.95, num_predict: 128, num_ctx: 2048, repeat_penalty: 1.0 },
    };
    this.quants = ['q2_K', 'q3_K_M', 'q4_0', 'q4_1', 'q4_K_M', 'q5_0', 'q5_1', 'q5_K_M', 'q6_K', 'q8_0', 'fp16'];
  }

  options(name) {
    return { ...(this.presets[name] || this.presets.default) };
  }
}

module.exports = { PresetCatalog };
