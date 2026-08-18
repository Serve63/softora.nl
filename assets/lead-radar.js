(function () {
  'use strict';

  const state = { offset: 0, limit: 50, total: 0, signals: [], selected: new Set(), status: null };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatDate = (value) => {
    if (!value) return 'Onbekend';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Onbekend' : new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  const statusLabels = {
    website_found: 'WEBSITE GEVONDEN', no_website_found: 'GEEN WEBSITE GEVONDEN',
    website_not_working: 'WEBSITE WERKT NIET', website_unverified: 'WEBSITE NIET BEVESTIGD',
    website_not_checked: 'NOG NIET GECONTROLEERD', provider_unavailable: 'CONTROLE NIET BESCHIKBAAR',
  };
  const leadLabels = { new: 'Nieuw', relevant: 'Relevant', not_relevant: 'Niet relevant', follow_up: 'Later opvolgen', archived: 'Gearchiveerd' };
  const publicationDateLabels = { provider_timestamp: 'Bron: DataForSEO-publicatietijd', provider_date: 'Bron: SERP-datumveld', serp_date: 'Bron: SERP-datum', serp_text: 'Bron: datum in zoekresultaattekst', manual: 'Bron: handmatig ingevoerd', unknown: 'Bron vermeldde geen publicatiedatum' };

  async function api(path, options) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options && options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function setInboxState(message, type) {
    const element = $('#inbox-state');
    if (!element) return;
    element.hidden = !message;
    element.className = `inbox-state${type === 'error' ? ' inbox-state--error' : ''}`;
    element.textContent = message || '';
  }

  function renderProviderStatus() {
    const banner = $('#provider-banner');
    const provider = state.status && state.status.provider;
    const scanButton = $('#scan-button');
    if (scanButton) {
      scanButton.disabled = !provider || !provider.configured;
      scanButton.title = provider && provider.configured
        ? ''
        : 'Configureer de DataForSEO-provider om scans te starten.';
    }
    if (!banner || !provider || provider.configured) { if (banner) banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = `<strong>Zoekprovider niet geconfigureerd</strong><span>${escapeHtml(provider.message || 'Voeg de server-side providercredentials toe om scans te starten.')} Websitecontrole van bestaande leads blijft beschikbaar.</span>`;
  }

  function renderMetrics() {
    const counts = state.status && state.status.counts || {};
    [['#metric-total', counts.total], ['#metric-new', counts.new]].forEach(([selector, value]) => { const element = $(selector); if (element) element.textContent = value == null ? '-' : Number(value).toLocaleString('nl-NL'); });
  }

  function websiteClass(status) {
    if (status === 'website_found') return 'website-state--found';
    if (status === 'no_website_found') return 'website-state--none';
    if (status === 'website_not_working') return 'website-state--broken';
    if (status === 'website_unverified') return 'website-state--unverified';
    return 'website-state--unknown';
  }

  function signalCard(signal) {
    const platform = escapeHtml(signal.platform || 'onbekend');
    const websiteStatus = signal.website_status || 'website_not_checked';
    const reasons = Array.isArray(signal.score_reasons) ? signal.score_reasons.slice(0, 4) : [];
    const score = Number(signal.relevance_score) || 0;
    const originalUrl = signal.post_url || signal.source_url || '';
    const profileUrl = signal.profile_url || '';
    const websiteUrl = signal.website_url || '';
    const websiteCandidates = Array.isArray(signal.website_candidates) ? signal.website_candidates.filter((candidate) => candidate && candidate.url).slice(0, 3) : [];
    const publicationDate = signal.published_at ? formatDate(signal.published_at) : 'Onbekend in openbare bron';
    const publicationSource = publicationDateLabels[signal.publication_date_source] || publicationDateLabels.unknown;
    const candidateLinks = websiteCandidates.map((candidate) => `<a class="website-candidate" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.title || candidate.url)}</a>`).join('');
    const selected = state.selected.has(signal.id);
    return `<article class="lead-card" data-signal-id="${escapeHtml(signal.id)}">
      <input class="lead-select" type="checkbox" data-select-signal="${escapeHtml(signal.id)}" ${selected ? 'checked' : ''} aria-label="Selecteer lead">
      <div class="lead-meta"><span class="platform-label platform-label--${platform}">${platform}</span><div class="lead-author">${escapeHtml(signal.author_name || 'Openbare pagina of profiel')}</div><div class="lead-date"><strong>Publicatiedatum:</strong> ${escapeHtml(publicationDate)}<small>${escapeHtml(publicationSource)}</small></div><div class="lead-source">Gevonden op: ${escapeHtml(formatDate(signal.found_at))}</div></div>
      <div class="lead-copy"><p class="lead-copy__text">${escapeHtml(signal.message_text || signal.snippet || 'Geen berichttekst beschikbaar.')}</p><div class="lead-copy__query">${escapeHtml(signal.query || 'Bron niet gespecificeerd')} ${signal.keyword_group ? `· ${escapeHtml(signal.keyword_group)}` : ''}</div><div class="lead-actions"><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">Open originele post</a>${profileUrl ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">Open profiel/pagina</a>` : ''}</div></div>
      <div class="lead-location"><strong>Regio</strong>${escapeHtml(signal.region || 'Onbekend')}<div class="lead-engagement"><strong>Engagement</strong>${signal.engagement_known ? `${signal.likes == null ? 'likes onbekend' : `${signal.likes} likes`} · ${signal.comments == null ? 'reacties onbekend' : `${signal.comments} reacties`}` : 'Onbekend'}</div></div>
      <div class="lead-score"><span class="score ${score >= 70 ? 'score--high' : ''}">${score}</span><ul class="score-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><span class="website-state ${websiteClass(websiteStatus)}">${escapeHtml(statusLabels[websiteStatus] || websiteStatus)}</span></div>
      <div class="lead-website lead-actions-cell">${websiteUrl ? `<a class="website-url" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteUrl)}</a>` : websiteCandidates.length ? `<span class="website-url website-url--candidate">Mogelijke websites</span><div class="website-candidates">${candidateLinks}</div>` : '<span class="website-url">Geen website-URL opgeslagen</span>'}<div class="lead-actions"><button type="button" data-action="website" data-id="${escapeHtml(signal.id)}">${websiteStatus === 'website_not_checked' ? 'Website zoeken' : 'Opnieuw controleren'}</button><button type="button" data-action="${escapeHtml(signal.lead_status === 'relevant' ? 'new' : 'relevant')}" data-id="${escapeHtml(signal.id)}">${signal.lead_status === 'relevant' ? 'Nieuw maken' : 'Relevant'}</button><button type="button" data-action="${escapeHtml(signal.lead_status === 'follow_up' ? 'new' : 'follow_up')}" data-id="${escapeHtml(signal.id)}">${signal.lead_status === 'follow_up' ? 'Opnieuw openen' : 'Later opvolgen'}</button><button type="button" data-action="not_relevant" data-id="${escapeHtml(signal.id)}">Niet relevant</button></div><textarea class="lead-notes" data-notes-id="${escapeHtml(signal.id)}" maxlength="5000" placeholder="Interne notitie...">${escapeHtml(signal.internal_notes || '')}</textarea><button class="button button-ghost" type="button" data-action="save-notes" data-id="${escapeHtml(signal.id)}">Notitie opslaan</button></div>
    </article>`;
  }

  function renderSignals() {
    const list = $('#lead-list');
    if (!list) return;
    if (!state.signals.length) { list.innerHTML = ''; setInboxState('Geen leads gevonden.', ''); }
    else { setInboxState('', ''); list.innerHTML = state.signals.map(signalCard).join(''); }
    $('#result-count').textContent = `${state.total.toLocaleString('nl-NL')} resultaten`;
    const pagination = $('#pagination');
    pagination.hidden = state.total <= state.limit && state.offset === 0;
    $('#page-label').textContent = `Pagina ${Math.floor(state.offset / state.limit) + 1}`;
    $('#previous-page-button').disabled = state.offset === 0;
    $('#next-page-button').disabled = state.offset + state.signals.length >= state.total;
    updateSelectionBar();
  }

  function getSignalQuery() {
    const params = new URLSearchParams();
    params.set('limit', String(state.limit)); params.set('offset', String(state.offset));
    return params.toString();
  }

  async function loadStatus() { state.status = await api('/api/lead-radar/status'); renderProviderStatus(); renderMetrics(); }
  async function loadSignals({ silent = false } = {}) {
    if (!silent) setInboxState('Leads laden...', '');
    try { const body = await api(`/api/lead-radar/signals?${getSignalQuery()}`); state.signals = body.signals || []; state.total = Number(body.total) || 0; renderSignals(); }
    catch (error) { state.signals = []; state.total = 0; renderSignals(); setInboxState(error.message, 'error'); }
  }
  function updateSelectionBar() { const bar = $('#bulk-bar'); bar.hidden = state.selected.size === 0; $('#selected-count').textContent = String(state.selected.size); }

  async function updateSignal(id, patch) { await api(`/api/lead-radar/signals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); await Promise.all([loadStatus(), loadSignals()]); }
  async function lookupWebsite(id, force) { await api(`/api/lead-radar/signals/${encodeURIComponent(id)}/website-lookup`, { method: 'POST', body: JSON.stringify({ force: Boolean(force) }) }); await Promise.all([loadStatus(), loadSignals()]); }

  async function startScan() {
    const platforms = ($('#scan-platforms').value || 'facebook,linkedin').split(',').filter(Boolean);
    const regionMode = $('#scan-region-mode').value;
    const payload = { platforms, regionMode, regions: [], maxAgeDays: Number($('#scan-max-age-days').value) || 30 };
    const button = $('#scan-button'); button.disabled = true; $('#scan-progress').hidden = false; $('#scan-progress-label').textContent = 'Scan bezig — resultaten worden na afloop bijgewerkt.';
    try { const body = await api('/api/lead-radar/scan', { method: 'POST', body: JSON.stringify(payload) }); $('#scan-progress-label').textContent = body.run?.status === 'provider_unavailable' ? 'Provider niet geconfigureerd.' : 'Scan afgerond.'; await Promise.all([loadStatus(), loadSignals()]); }
    catch (error) { $('#scan-progress-label').textContent = error.message; }
    finally {
      button.disabled = !state.status?.provider?.configured;
      setTimeout(() => { $('#scan-progress').hidden = true; }, 1200);
    }
  }

  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (action) {
      const id = action.dataset.id; const kind = action.dataset.action;
      try {
        if (kind === 'website') await lookupWebsite(id, true);
        else if (kind === 'save-notes') await updateSignal(id, { internal_notes: document.querySelector(`[data-notes-id="${CSS.escape(id)}"]`)?.value || '' });
        else await updateSignal(id, { lead_status: kind });
      } catch (error) { setInboxState(error.message, 'error'); }
    }
  });
  document.addEventListener('change', (event) => { const checkbox = event.target.closest('[data-select-signal]'); if (!checkbox) return; if (checkbox.checked) state.selected.add(checkbox.dataset.selectSignal); else state.selected.delete(checkbox.dataset.selectSignal); updateSelectionBar(); });
  $('#previous-page-button').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadSignals(); });
  $('#next-page-button').addEventListener('click', () => { if (state.offset + state.signals.length < state.total) { state.offset += state.limit; loadSignals(); } });
  $('#scan-button').addEventListener('click', () => startScan());
  $('#clear-selection-button').addEventListener('click', () => { state.selected.clear(); renderSignals(); });
  $('#bulk-website-button').addEventListener('click', async () => { try { await api('/api/lead-radar/website-lookup', { method: 'POST', body: JSON.stringify({ signalIds: Array.from(state.selected), force: true }) }); state.selected.clear(); await Promise.all([loadStatus(), loadSignals()]); } catch (error) { setInboxState(error.message, 'error'); } });

  window.setInterval(() => {
    if (document.hidden) return;
    Promise.all([loadStatus(), loadSignals({ silent: true })]).catch(() => {});
  }, 60_000);

  Promise.all([loadStatus(), loadSignals()]).catch((error) => setInboxState(error.message, 'error'));
})();
