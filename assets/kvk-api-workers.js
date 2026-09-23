(() => {
  const dialog = document.getElementById('kvk-api-workers-dialog');
  const opener = document.getElementById('kvk-api-workers-open');
  if (!dialog || !opener) return;
  const budgetLabel = document.getElementById('kvk-api-workers-budget');
  const message = document.getElementById('kvk-api-workers-message');
  const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const controls = {
    searcher: { button: document.getElementById('kvk-api-searcher-toggle'), status: document.getElementById('kvk-api-searcher-status') },
    controller: { button: document.getElementById('kvk-api-controller-toggle'), status: document.getElementById('kvk-api-controller-status') },
  };
  let state = null;
  let busy = false;

  function render() {
    if (!state) return;
    budgetLabel.textContent = `${euro.format(state.budget.spentEur + state.budget.reservedEur)} / ${euro.format(state.budget.limitEur)}`;
    for (const [role, control] of Object.entries(controls)) {
      const worker = state.workers[role];
      control.button.setAttribute('aria-pressed', String(worker.enabled));
      control.button.textContent = worker.enabled ? 'Uitzetten' : 'Aanzetten';
      control.button.disabled = busy || (!worker.enabled && (!state.apiKeyConfigured || state.budget.availableEur < 12));
      control.status.textContent = worker.active ? (worker.currentBatch || 'Actief') : worker.enabled ? (worker.message || 'Start aangevraagd') : 'Uit';
    }
    if (!state.apiKeyConfigured) message.textContent = 'De bestaande API-sleutel is niet beschikbaar op de server.';
    else if (state.budget.availableEur < 12) message.textContent = 'Gezamenlijke limiet bereikt; nieuwe aanvragen staan uit.';
  }

  async function load() {
    try {
      const response = await fetch('/api/kvk-database/api-workers', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Status niet beschikbaar.');
      state = payload.state;
      render();
    } catch (error) { message.textContent = error.message || 'Status niet beschikbaar.'; }
  }

  async function toggle(role) {
    if (!state || busy) return;
    busy = true;
    message.textContent = '';
    render();
    try {
      const desired = {
        searcherEnabled: state.workers.searcher.enabled,
        controllerEnabled: state.workers.controller.enabled,
      };
      desired[role === 'searcher' ? 'searcherEnabled' : 'controllerEnabled'] = !state.workers[role].enabled;
      const response = await fetch('/api/kvk-database/api-workers', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Softora-Requested-With': 'premium' },
        body: JSON.stringify(desired),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Instellen mislukt.');
      state = payload.state;
      message.textContent = `${role === 'searcher' ? 'Searcher' : 'Controleur'} ${state.workers[role].enabled ? 'aangezet' : 'uitgezet'}.`;
    } catch (error) { message.textContent = error.message || 'Instellen mislukt.'; }
    finally { busy = false; render(); }
  }

  opener.addEventListener('click', () => { dialog.showModal(); void load(); });
  document.getElementById('kvk-api-workers-close').addEventListener('click', () => dialog.close());
  for (const [role, control] of Object.entries(controls)) control.button.addEventListener('click', () => void toggle(role));
  setInterval(() => { if (dialog.open && !busy) void load(); }, 5000);
})();
