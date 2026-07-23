(function () {
  var refs = {
    spend: document.getElementById('facebookAdsSpend'),
    liveCampaigns: document.getElementById('facebookAdsLiveCampaigns'),
    creativeCount: document.getElementById('facebookAdsCreativeCount'),
    readiness: document.getElementById('facebookAdsReadiness'),
    readinessNote: document.getElementById('facebookAdsReadinessNote'),
    readinessList: document.getElementById('facebookAdsReadinessList'),
    campaigns: document.getElementById('facebookAdsCampaigns'),
    exclusions: document.getElementById('facebookAdsExclusions'),
    dryRun: document.getElementById('facebookAdsDryRun'),
    machineResult: document.getElementById('facebookAdsMachineResult'),
    downloadPack: document.getElementById('facebookAdsDownloadPack'),
    packStatus: document.getElementById('facebookAdsPackStatus'),
    adAssets: document.getElementById('facebookAdsAdAssets'),
  };
  var launchPack = null;

  if (!refs.spend) return;

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
          if (!response.ok || !body.ok) throw new Error(body.error || 'Facebook Ads-status niet beschikbaar.');
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
    refs.readiness.textContent = status.readinessReady + ' / ' + status.readinessTotal;
    refs.readinessNote.textContent = status.readinessReady === status.readinessTotal
      ? 'Technisch gereed'
      : 'Nog ' + (status.readinessTotal - status.readinessReady) + ' blokkades';
    replaceChildren(refs.readinessList, (status.readiness || []).map(function (item) {
      var row = text('div', 'google-ads-check' + (item.ready ? ' is-ready' : ''), '');
      row.appendChild(text('i', '', item.ready ? '✓' : '–'));
      row.appendChild(text('span', '', item.label));
      return row;
    }));
    if (status.lastRun) renderMachine(status.lastRun);
  }

  function renderBlueprint(blueprint) {
    replaceChildren(refs.campaigns, (blueprint.campaigns || []).map(function (campaign) {
      var card = text('article', 'google-ads-campaign facebook-ads-campaign', '');
      card.appendChild(text('span', '', 'Concept · gepauzeerd'));
      card.appendChild(text('h3', '', campaign.name));
      card.appendChild(text('p', '', campaign.creativeBrief));
      card.appendChild(text('small', '', campaign.audience.strategy));
      card.appendChild(text('small', 'facebook-ads-placement-line', campaign.placements.join(' · ')));
      return card;
    }));
    replaceChildren(refs.exclusions, (blueprint.exclusions || []).map(function (value) {
      return text('span', '', '− ' + value);
    }));
  }

  function renderLaunchPack(pack) {
    launchPack = pack;
    var valid = pack.validation && pack.validation.valid;
    refs.downloadPack.disabled = !valid;
    refs.creativeCount.textContent = String((pack.validation && pack.validation.creativesChecked) || 0);
    refs.packStatus.className = 'google-ads-pack-status' + (valid ? '' : ' has-errors');
    refs.packStatus.textContent = valid
      ? pack.validation.campaignsChecked + ' campagnes en ' + pack.validation.creativesChecked + ' advertentievarianten volledig gevalideerd.'
      : 'Launch-pack geblokkeerd: ' + ((pack.validation && pack.validation.errors.length) || 0) + ' validatiefouten.';
    var cards = [];
    (pack.campaigns || []).forEach(function (campaign) {
      (campaign.ads || []).forEach(function (ad) {
        var card = text('article', 'google-ads-ad-asset facebook-ads-ad-asset', '');
        var header = text('div', 'google-ads-ad-asset-header', '');
        header.appendChild(text('h3', '', ad.name));
        header.appendChild(text('span', '', 'PAUSED'));
        var preview = text('div', 'facebook-ads-preview', '');
        preview.appendChild(text('small', '', campaign.name));
        preview.appendChild(text('p', '', ad.primaryText));
        preview.appendChild(text('strong', '', ad.headline));
        preview.appendChild(text('em', '', ad.description));
        card.appendChild(header);
        card.appendChild(text('div', 'google-ads-ad-url', campaign.finalUrl));
        card.appendChild(preview);
        card.appendChild(text('div', 'facebook-ads-format', ad.format + ' · ' + ad.callToAction));
        cards.push(card);
      });
    });
    replaceChildren(refs.adAssets, cards);
  }

  function downloadLaunchPack() {
    if (!launchPack || !launchPack.validation || !launchPack.validation.valid) return;
    var blob = new window.Blob([JSON.stringify(launchPack, null, 2)], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'softora-facebook-ads-launch-pack.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  function showError(error) {
    if (refs.readinessNote) refs.readinessNote.textContent = String(error.message || error);
  }

  refs.dryRun.addEventListener('click', function () {
    refs.dryRun.disabled = true;
    refs.dryRun.textContent = 'Controleren…';
    fetchJson('/api/facebook-ads/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (body) { renderMachine(body.result); return fetchJson('/api/facebook-ads/status'); })
      .then(renderStatus)
      .catch(showError)
      .finally(function () {
        refs.dryRun.disabled = false;
        refs.dryRun.textContent = 'Draai dry-run';
      });
  });
  refs.downloadPack.addEventListener('click', downloadLaunchPack);

  Promise.all([
    fetchJson('/api/facebook-ads/status'),
    fetchJson('/api/facebook-ads/blueprint'),
    fetchJson('/api/facebook-ads/launch-pack'),
  ])
    .then(function (results) {
      renderStatus(results[0]);
      renderBlueprint(results[1]);
      renderLaunchPack(results[2]);
    })
    .catch(showError);
})();
