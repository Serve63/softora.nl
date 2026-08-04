(function initializeKvkDatabaseLunaErrors(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  api.start({
    document: globalScope.document,
    window: globalScope.window || globalScope,
    getSnapshot() {
      try {
        if (typeof activeSnapshot === 'undefined') return null;
        return activeSnapshot && typeof activeSnapshot === 'object' ? activeSnapshot : null;
      } catch {
        return null;
      }
    },
  });
})(typeof globalThis === 'object' ? globalThis : this, function createKvkDatabaseLunaErrorsApi() {
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function relativeTimeLabel(value, now = Date.now()) {
    const raw = String(value || '').trim();
    if (!raw) return '--';
    const parsed = new Date(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (Number.isNaN(parsed.getTime())) return '--';
    const seconds = Math.max(0, Math.floor((now - parsed.getTime()) / 1000));
    if (seconds < 10) return 'net';
    if (seconds < 60) return `${seconds} sec geleden`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min geleden`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} uur geleden`;
    const days = Math.floor(hours / 24);
    return `${days} dag${days === 1 ? '' : 'en'} geleden`;
  }

  function tableHeaderHtml() {
    return `<tr>${[
      'Wanneer',
      'Bedrijfsnaam',
      'Fout van Luna Max',
      'Luna Max had',
      'Gecorrigeerd naar',
      'Gevonden door',
      'Locatie',
    ].map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr>`;
  }

  function findingRowHtml(finding) {
    const location = [finding.woonplaats, finding.provincie].filter(Boolean).join(', ');
    const fields = Array.isArray(finding.incorrect_fields)
      ? finding.incorrect_fields.join(', ')
      : '';
    return `
      <tr>
        <td>${escapeHtml(relativeTimeLabel(finding.detected_at))}</td>
        <td><span class="cell-stack"><strong>${escapeHtml(finding.bedrijfsnaam)}</strong><span>KVK ${escapeHtml(finding.kvk_nummer || '-')}</span></span></td>
        <td><span class="cell-stack"><strong>${escapeHtml(finding.error_label || 'Onjuiste gegevens')}</strong><span>${escapeHtml(fields || 'Gegevens')}</span></span></td>
        <td>${escapeHtml(finding.luna_value_summary || '-')}</td>
        <td>${escapeHtml(finding.corrected_value_summary || '-')}</td>
        <td><span class="cell-stack"><strong>${escapeHtml(finding.controller_role_label || 'Controleur')}</strong><span>${escapeHtml(finding.controller_model_label || 'Sol 5.6 xhigh')}</span></span></td>
        <td><strong>${escapeHtml(location || '-')}</strong></td>
      </tr>`;
  }

  function createController(deps = {}) {
    const documentRef = deps.document;
    const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : () => null;
    const head = documentRef.getElementById('latest-luna-errors-table-head');
    const body = documentRef.getElementById('latest-luna-errors-table-body');

    function render() {
      if (!head || !body) return;
      head.innerHTML = tableHeaderHtml();
      const snapshot = getSnapshot();
      const findings = Array.isArray(snapshot?.latestLunaErrors)
        ? snapshot.latestLunaErrors.slice(0, 10)
        : [];
      body.innerHTML = findings.length
        ? findings.map(findingRowHtml).join('')
        : '<tr class="empty-row"><td colspan="7">Geen fouten van Luna Max gevonden.</td></tr>';
    }

    return { render };
  }

  function start(deps = {}) {
    const controller = createController(deps);
    controller.render();
    deps.window.setInterval(controller.render, 1000);
    deps.window.addEventListener('focus', controller.render);
    deps.document.addEventListener('visibilitychange', () => {
      if (!deps.document.hidden) controller.render();
    });
    return controller;
  }

  return {
    createController,
    findingRowHtml,
    relativeTimeLabel,
    start,
  };
});
