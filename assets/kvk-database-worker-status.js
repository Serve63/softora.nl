(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraKvkWorkerStatus = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';
  const lanes = { searchers: ['vuller'], controllers: ['controle', 'goedgekeurd'] };
  let configuration = {};
  let control = null;

  function modelLabel(model, effort) {
    const match = String(model || '').match(/^gpt-(?:\d+(?:\.\d+)?-)?(luna|sol|terra|astra)$/i);
    const name = match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : String(model || '').slice(0, 80);
    return [name, effort === 'max' ? 'Max' : String(effort || '').slice(0, 20)].filter(Boolean).join(' ');
  }

  function summarize(value, config = {}, now = Date.now()) {
    return Object.entries(lanes).map(([kind, keys]) => {
      let active = 0;
      const models = new Set();
      const unavailable = !value || value.unavailable || typeof value.enabled !== 'boolean';
      for (const key of keys) {
        const worker = value?.workers?.[key];
        const beat = Date.parse(worker?.workerHeartbeatAt || '');
        const request = Date.parse(value?.requestedAt || '');
        const running = !unavailable && value.enabled && worker?.workerState === 'running'
          && !worker.stale && !worker.stalled && worker.queuePending !== false
          && Number.isFinite(beat) && now - beat >= -5000 && now - beat <= 150000
          && (!Number.isFinite(request) || beat >= request);
        if (running) active++;
        const source = worker?.model ? worker : config[key];
        const label = modelLabel(source?.model, source?.reasoningEffort);
        if (label) models.add(label);
      }
      return { kind, active: unavailable ? null : active, models: [...models] };
    });
  }

  function render() {
    const host = root?.document.getElementById('kvk-worker-status');
    if (!host) return;
    const groups = summarize(control, configuration);
    const children = groups.map(group => {
      const item = root.document.createElement('div');
      item.className = 'kvk-worker-status__group';
      const count = root.document.createElement('strong');
      const label = group.kind === 'searchers' ? 'Searchers' : 'Controleurs';
      count.textContent = `${label}: ${group.active === null ? '—' : group.active} actief`;
      const model = root.document.createElement('span');
      model.textContent = group.models.join(' · ') || 'Model onbekend';
      item.title = group.active === null ? 'Workerstatus tijdelijk niet beschikbaar.' : 'Actief bij een recente running-heartbeat. Model en denkniveau volgens de workerconfiguratie.';
      item.append(count, model);
      return item;
    });
    // Keep live regions quiet when a poll returns the same visible information.
    if (host.textContent !== children.map(item => item.textContent).join('')) host.replaceChildren(...children);
  }

  function update(value) { control = value; render(); }
  function configure(value) { configuration = value && typeof value === 'object' ? value : {}; render(); }
  if (root) { root.setInterval(render, 5000); render(); }
  return { summarize, modelLabel, update, configure };
});
