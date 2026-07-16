(function () {
  var refs = {
    spend: document.getElementById('googleAdsSpend'),
    liveCampaigns: document.getElementById('googleAdsLiveCampaigns'),
    conversions: document.getElementById('googleAdsConversions'),
    readiness: document.getElementById('googleAdsReadiness'),
    readinessNote: document.getElementById('googleAdsReadinessNote'),
    readinessList: document.getElementById('googleAdsReadinessList'),
    campaigns: document.getElementById('googleAdsCampaigns'),
    negatives: document.getElementById('googleAdsNegatives'),
    dryRun: document.getElementById('googleAdsDryRun'),
    machineResult: document.getElementById('googleAdsMachineResult'),
  };

  function replaceChildren(parent, children) {
    if (!parent) return;
    parent.replaceChildren.apply(parent, children);
  }

  function text(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value || '');
    return node;
  }

  function fetchJson(url, options) {
    return window.fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}))
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body.ok) throw new Error(body.error || 'Google Ads-status niet beschikbaar.');
          return body;
        });
      });
  }

  function renderMachine(result) {
    if (!result || !refs.machineResult) return;
    replaceChildren(refs.machineResult, [
      text('span', '', result.outcome === 'launch-ready-awaiting-budget-approval' ? 'Technisch gereed' : 'Veilige blokkade'),
      text('strong', '', result.selectedAction),
      text('p', '', result.reason + ' Uitgaven: € 0,00 · mutaties: 0.'),
    ]);
  }

  function renderStatus(status) {
    refs.spend.textContent = '€ ' + ((Number(status.spendCents) || 0) / 100).toFixed(2).replace('.', ',');
    refs.liveCampaigns.textContent = String(Number(status.liveCampaigns) || 0);
    refs.conversions.textContent = String(Number(status.conversionCount) || 0);
    refs.readiness.textContent = status.readinessReady + ' / ' + status.readinessTotal;
    refs.readinessNote.textContent = status.readinessReady === status.readinessTotal ? 'Technisch gereed' : 'Nog ' + (status.readinessTotal - status.readinessReady) + ' blokkades';
    var items = (status.readiness || []).map(function (item) {
      var row = text('div', 'google-ads-check' + (item.ready ? ' is-ready' : ''), '');
      row.appendChild(text('i', '', item.ready ? '✓' : '–'));
      row.appendChild(text('span', '', item.label));
      return row;
    });
    replaceChildren(refs.readinessList, items);
    if (status.lastRun) renderMachine(status.lastRun);
  }

  function renderBlueprint(blueprint) {
    var campaigns = (blueprint.campaigns || []).map(function (campaign) {
      var card = text('article', 'google-ads-campaign', '');
      card.appendChild(text('span', '', 'Concept · gepauzeerd'));
      card.appendChild(text('h3', '', campaign.name));
      card.appendChild(text('p', '', campaign.intent));
      card.appendChild(text('small', '', campaign.themes.join(' · ')));
      return card;
    });
    replaceChildren(refs.campaigns, campaigns);
    replaceChildren(refs.negatives, (blueprint.sharedNegativeKeywords || []).map(function (keyword) {
      return text('span', '', '− ' + keyword);
    }));
  }

  function showError(error) {
    if (refs.readinessNote) refs.readinessNote.textContent = String(error.message || error);
  }

  if (refs.dryRun) {
    refs.dryRun.addEventListener('click', function () {
      refs.dryRun.disabled = true;
      refs.dryRun.textContent = 'Controleren…';
      fetchJson('/api/google-ads/dry-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (body) { renderMachine(body.result); return fetchJson('/api/google-ads/status'); })
        .then(renderStatus)
        .catch(showError)
        .finally(function () { refs.dryRun.disabled = false; refs.dryRun.textContent = 'Draai dry-run'; });
    });
  }

  Promise.all([fetchJson('/api/google-ads/status'), fetchJson('/api/google-ads/blueprint')])
    .then(function (results) { renderStatus(results[0]); renderBlueprint(results[1]); })
    .catch(showError);
})();
