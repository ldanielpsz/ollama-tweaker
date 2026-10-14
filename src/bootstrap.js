// Composition root: the only place that knows which concrete classes and definitions exist.
const { Container } = require('./core/Container');
const { loadConfig } = require('./config');

const { RequestParamStrategy } = require('./params/RequestParamStrategy');
const { EnvParamStrategy } = require('./params/EnvParamStrategy');
const { KvCacheStrategy } = require('./params/KvCacheStrategy');
const requestDefinitions = require('./params/definitions/request');
const serverDefinitions = require('./params/definitions/server');

const { OllamaClient } = require('./services/OllamaClient');
const { DockerClient } = require('./services/DockerClient');
const { RunStore } = require('./services/RunStore');
const { PresetCatalog } = require('./services/PresetCatalog');
const { GenerateService } = require('./services/GenerateService');
const { ServerSettingsService } = require('./services/ServerSettingsService');
const { LogService } = require('./services/LogService');
const { SchemaService } = require('./services/SchemaService');

// Server parameter sets that need custom behaviour; everything else uses the generic EnvParamStrategy.
const SERVER_STRATEGY_OVERRIDES = { kvcache: KvCacheStrategy };

function bootstrap(config = loadConfig()) {
  const c = new Container();
  c.value('config', config);

  // Parameter sets: definition (data) is injected into a strategy (behaviour), then tagged by scope.
  for (const def of requestDefinitions) {
    c.value(`def.request.${def.id}`, def);
    c.bind(`param.request.${def.id}`, RequestParamStrategy, { definition: `def.request.${def.id}` });
    c.tag('param.request', [`param.request.${def.id}`]);
  }
  for (const def of Object.values(serverDefinitions)) {
    const Strategy = SERVER_STRATEGY_OVERRIDES[def.id] || EnvParamStrategy;
    c.value(`def.server.${def.id}`, def);
    c.bind(`param.server.${def.id}`, Strategy, { definition: `def.server.${def.id}` });
    c.tag('param.server', [`param.server.${def.id}`]);
  }

  c.bind('ollama', OllamaClient, { config: 'config' });
  c.bind('docker', DockerClient, { config: 'config' });
  c.bind('runStore', RunStore, { config: 'config' });
  c.bind('presets', PresetCatalog);
  c.bind('serverSettings', ServerSettingsService, {
    docker: 'docker', ollama: 'ollama', config: 'config', strategies: '#param.server',
  });
  c.bind('generateService', GenerateService, {
    ollama: 'ollama', runStore: 'runStore', presets: 'presets', serverSettings: 'serverSettings',
    config: 'config', requestStrategies: '#param.request',
  });
  c.bind('logService', LogService, { docker: 'docker', config: 'config' });
  c.bind('schemaService', SchemaService, {
    requestStrategies: '#param.request', serverStrategies: '#param.server', presets: 'presets',
  });
  return c;
}

module.exports = { bootstrap };
