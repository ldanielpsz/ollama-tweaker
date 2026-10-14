// Client composition root: builds the container from the published schemas and starts the features.
import { Container } from './core/container.js';
import { $ } from './core/dom.js';
import { Api } from './core/api.js';
import { fieldRenderers } from './params/fieldRenderers.js';
import { ParamSetView } from './params/ParamSetView.js';
import { ParamForm } from './params/ParamForm.js';
import { ModelPicker } from './features/ModelPicker.js';
import { PromptPanel } from './features/PromptPanel.js';
import { Generator } from './features/Generator.js';
import { RunsView } from './features/RunsView.js';
import { LogsView } from './features/LogsView.js';
import { ServerPanel } from './features/ServerPanel.js';

async function main() {
  const api = new Api();
  const schema = await api.schema();

  const c = new Container();
  c.value('api', api);
  c.value('schema', schema);
  c.value('renderers', fieldRenderers);

  // Each parameter definition is injected into its own view (a 12-column row that owns its layout).
  for (const scope of ['request', 'server']) {
    for (const def of schema[scope]) {
      c.value(`def.${scope}.${def.id}`, def);
      c.bind(`view.${scope}.${def.id}`, ParamSetView, { definition: `def.${scope}.${def.id}`, renderers: 'renderers' });
      c.tag(`view.${scope}`, [`view.${scope}.${def.id}`]);
    }
  }
  c.bind('requestForm', ParamForm, { views: '#view.request' });
  c.bind('serverForm', ParamForm, { views: '#view.server' });

  c.bind('picker', ModelPicker, { api: 'api', schema: 'schema', requestForm: 'requestForm' });
  c.bind('prompt', PromptPanel, { requestForm: 'requestForm' });
  c.bind('runsView', RunsView, { api: 'api' });
  c.bind('logsView', LogsView, { api: 'api' });
  c.bind('serverPanel', ServerPanel, { api: 'api', serverForm: 'serverForm', picker: 'picker' });
  c.bind('generator', Generator, {
    api: 'api', picker: 'picker', prompt: 'prompt', requestForm: 'requestForm', runsView: 'runsView',
  });

  c.resolve('requestForm').mount($('request-params'));
  c.resolve('serverForm').mount($('server-params'));

  c.resolve('picker').init();
  c.resolve('prompt').init();
  c.resolve('generator').init();
  await Promise.all([c.resolve('runsView').init(), c.resolve('serverPanel').init()]);
  c.resolve('logsView').init();
}

main().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#d1242f">UI failed to start: ${e.message}</pre>`);
  console.error(e);
});
