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
      'Status',
      'Gevonden door',
      'Telefoonnummer',
      'Mailadres',
      'Website',
      'Locatie',
    ].map((label) => `<th>${escapeHtml(label)}</th>`).join('')}</tr>`;
  }

  function activityStatus(activity) {
    if (activity.unusable_reason === 'identity_unconfirmed') return 'Identiteit controleren';
    const findingLabels = {
      incorrect_approval: 'Onterecht goedgekeurd',
      missed_usable: 'Onterecht afgekeurd',
      incorrect_data: 'Gegevens gecorrigeerd',
    };
    if (findingLabels[activity.review_finding]) return findingLabels[activity.review_finding];
    if (activity.lead_status === 'usable') return 'Bruikbaar';
    const reasonLabels = {
      missing_phone: 'Geen telefoon',
      missing_email: 'Geen mail',
      missing_phone_and_email: 'Geen contact',
      stopped: 'Gestopt',
      operational_unclear: 'Ter controle',
      non_specific_entity: 'Geen specifiek bedrijf',
      weak_source_quality: 'Zwakke bron',
      no_own_contact: 'Geen eigen contact',
      wrong_entity: 'Verkeerd bedrijf',
      chain_branch: 'Keten/formule',
    };
    return reasonLabels[activity.unusable_reason] || 'Onbruikbaar';
  }

  function fieldValue(value) {
    const text = String(value || '').trim();
    return text || 'Niet gevonden';
  }

  function websiteHtml(value) {
    const text = String(value || '').trim();
    if (!text) return 'Niet gevonden';
    const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const label = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return `<a class="website-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function activityRowHtml(activity) {
    const uncertain = activity.unusable_reason === 'identity_unconfirmed';
    const matches = uncertain && Array.isArray(activity.research_dossier?.possible_matches)
      ? activity.research_dossier.possible_matches.slice(0, 5) : [];
    function candidateField(field) {
      const values = [...new Set(matches.map((item) => String(item?.[field] || '').trim()).filter(Boolean))];
      return values.length ? values.map((value) => `<span class="cell-stack"><strong>${escapeHtml(value)}</strong><span>Mogelijke match</span></span>`).join('')
        : '<span class="pending-value">Nog niet bevestigd</span>';
    }
    const explanation = matches.map((item) => {
      let source = '';
      try { const url = new URL(item.bron_url); if (['http:', 'https:'].includes(url.protocol)) source = url.href; } catch { /* Invalid sources are not clickable. */ }
      return `<p>${escapeHtml([item.bedrijfsnaam, item.adres, item.onzekerheid].filter(Boolean).join(' · '))}${source ? ` <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Bron</a>` : ''}</p>`;
    }).join('');
    const details = uncertain ? `<details><summary>Mogelijke match — identiteit nog niet bevestigd</summary>${explanation || escapeHtml(activity.contact_research_note || 'De Controleur beoordeelt de koppeling met dit bedrijf.')}</details>` : '';
    const isRobot = String(activity.found_by_role_label || '').trim().toLowerCase() === 'robot';
    const modelHtml = isRobot ? '' : `<span>${escapeHtml(activity.found_by_model_label || '-')}</span>`;
    const location = [activity.woonplaats, activity.provincie].filter(Boolean).join(', ');
    const statusExplanation = activity.unusable_reason === 'operational_unclear'
      ? 'Bedrijfsactiviteit nog niet bevestigd. Staat in de controlelijst; contactgegevens blijven bewaard.'
      : '';
    const statusClass = activity.lead_status === 'usable' && !activity.review_finding
      ? ' is-usable'
      : ' is-unusable';
    return `
      <tr>
        <td>${escapeHtml(relativeTimeLabel(activity.contact_checked_at))}</td>
        <td><span class="cell-stack"><strong>${escapeHtml(activity.bedrijfsnaam)}</strong><span>KVK ${escapeHtml(activity.kvk_nummer || '-')}</span></span></td>
        <td><span class="company-status${statusClass}"${statusExplanation ? ` title="${escapeHtml(statusExplanation)}"` : ''}>${escapeHtml(activityStatus(activity))}</span>${details}</td>
        <td><span class="cell-stack"><strong>${escapeHtml(activity.found_by_role_label || '-')}</strong>${modelHtml}</span></td>
        <td>${uncertain ? candidateField('telefoonnummer') : escapeHtml(fieldValue(activity.telefoonnummer))}</td>
        <td>${uncertain ? candidateField('email') : escapeHtml(fieldValue(activity.email))}</td>
        <td class="link-like">${uncertain ? candidateField('website') : websiteHtml(activity.website)}</td>
        <td><strong>${escapeHtml(location || '-')}</strong></td>
      </tr>`;
  }

  function createController(deps = {}) {
    const documentRef = deps.document;
    const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : () => null;
    const head = documentRef.getElementById('latest-luna-errors-table-head');
    const body = documentRef.getElementById('latest-luna-errors-table-body');

    let renderedHead = null;
    let renderedBody = null;

    function render() {
      if (!head || !body) return;
      const snapshot = getSnapshot();
      const activities = Array.isArray(snapshot?.latestTreated)
        ? snapshot.latestTreated.slice(0, 10)
        : [];
      const headHtml = tableHeaderHtml();
      const bodyHtml = activities.length
        ? activities.map(activityRowHtml).join('')
        : '<tr class="empty-row"><td colspan="8">Nog geen nieuwe onderzoeksresultaten of Controleur-correcties.</td></tr>';
      // Rewriting unchanged rows every second would clear any text the user is selecting.
      if (headHtml !== renderedHead) head.innerHTML = renderedHead = headHtml;
      if (bodyHtml !== renderedBody) body.innerHTML = renderedBody = bodyHtml;
    }

    return { render };
  }

  function start(deps = {}) {
    const controller = createController(deps);
    controller.render();
    deps.window.setInterval(() => { if (!deps.window.SoftoraKvkSelectionPause?.isSelecting()) controller.render(); }, 1000);
    deps.window.addEventListener('focus', controller.render);
    deps.document.addEventListener('visibilitychange', () => {
      if (!deps.document.hidden) controller.render();
    });
    return controller;
  }

  return {
    createController,
    activityRowHtml,
    activityStatus,
    relativeTimeLabel,
    start,
  };
});
