(() => {
  const dialog = document.getElementById('kvk-api-workers-dialog');
  const opener = document.getElementById('kvk-api-workers-open');
  if (!dialog || !opener) return;
  const budgetLabel = document.getElementById('kvk-api-workers-budget');
  const message = document.getElementById('kvk-api-workers-message');
  const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
  const controls = {
    searcher: { count: document.getElementById('kvk-api-searcher-count'), button: document.getElementById('kvk-api-searcher-toggle'), status: document.getElementById('kvk-api-searcher-status') },
    controller: { count: document.getElementById('kvk-api-controller-count'), button: document.getElementById('kvk-api-controller-toggle'), status: document.getElementById('kvk-api-controller-status') },
  };
  controls.robot = { button: document.getElementById('kvk-api-robot-toggle'), status: document.getElementById('kvk-api-robot-status') };
  let state = null;
  let busy = false;
  let revision = 0;

  function render() {
    if (!state) return;
    budgetLabel.textContent = `${euro.format(state.budget.spentEur)} / ${euro.format(state.budget.limitEur)}`;
    for (const [role, control] of Object.entries(controls)) {
      const worker = state.workers[role];
      if (control.count) {
      if (document.activeElement !== control.count || busy) control.count.value = String(worker.count || 1);
      control.count.disabled = busy;
      }
      control.button.setAttribute('aria-pressed', String(worker.enabled));
      control.button.textContent = worker.enabled ? 'Uitzetten' : 'Aanzetten';
      control.button.disabled = busy || (role !== 'robot' && !worker.enabled && (!state.apiKeyConfigured || state.budget.availableEur < (state.budget.reservationEur || 12)));
      control.status.textContent = worker.enabled ? 'Aan' : 'Uit';
    }
    if (!state.apiKeyConfigured) message.textContent = 'De bestaande API-sleutel is niet beschikbaar op de server.';
    else if (state.budget.availableEur < (state.budget.reservationEur || 12)) message.textContent = 'Budgetruimte is tijdelijk gereserveerd of onvoldoende voor een nieuwe aanvraag.';
  }

  async function load() {
    const requestedRevision = revision;
    try {
      const response = await fetch('/api/kvk-database/api-workers', { cache: 'no-store', credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Status niet beschikbaar.');
      if (busy || requestedRevision !== revision) return;
      state = payload.state;
      render();
    } catch (error) { message.textContent = error.message || 'Status niet beschikbaar.'; }
  }

  async function update(role, changes) {
    if (!state || busy) return;
    revision += 1;
    busy = true;
    message.textContent = '';
    render();
    try {
      const response = await fetch('/api/kvk-database/api-workers', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Softora-Requested-With': 'premium' },
        body: JSON.stringify({ role, ...changes }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Instellen mislukt.');
      state = payload.state;
      message.textContent = '';
    } catch (error) { message.textContent = error.message || 'Instellen mislukt.'; }
    finally { busy = false; render(); }
  }

  opener.addEventListener('click', () => { dialog.showModal(); void load(); });
  document.getElementById('kvk-api-workers-close').addEventListener('click', () => dialog.close());
  for (const [role, control] of Object.entries(controls)) {
    control.button.addEventListener('click', () => { if (state) void update(role, { enabled: !state.workers[role].enabled }); });
    if (!control.count) continue;
    control.count.addEventListener('change', () => {
      const value = control.count.value.trim();
      if (!/^(?:[1-9]|10)$/.test(value)) {
        message.textContent = 'Vul een heel aantal van 1 tot 10 in.';
        control.count.value = String(state?.workers[role].count || 1);
        return;
      }
      void update(role, { count: Number(value) });
    });
    control.count.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); control.count.blur(); }
    });
  }
  setInterval(() => { if (dialog.open && !busy) void load(); }, 5000);
})();
