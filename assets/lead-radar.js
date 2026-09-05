(function () {
  'use strict';

  const state = { offset: 0, limit: 50, total: 0, signals: [], status: null, scanning: false, scanError: '' };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
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
    const lastRun = state.status && state.status.lastRun;
    const providerBlocked = provider?.configured && lastRun?.status === 'provider_unavailable';
    const partialFailure = provider?.configured && lastRun?.status === 'completed_with_errors';
    const storageUnavailable = state.status?.storageConfigured === false;
    const scanButton = $('#scan-button');
    if (scanButton) {
      scanButton.disabled = state.scanning || storageUnavailable || !provider?.configured;
      scanButton.textContent = state.scanning ? 'Scannen…' : 'Scan starten';
      scanButton.title = storageUnavailable ? 'Lead Radar kan de resultaten momenteel niet opslaan.' : provider?.configured
        ? ''
        : 'Voeg minimaal één toegestane openbare scraperbron toe.';
    }
    if (!banner || !provider || (!storageUnavailable && provider.configured && !providerBlocked && !partialFailure)) { if (banner) banner.hidden = true; return; }
    banner.hidden = false;
    banner.innerHTML = storageUnavailable
      ? '<strong>Opslag tijdelijk niet beschikbaar</strong><span>De scan kan pas starten als resultaten weer kunnen worden opgeslagen.</span>'
      : providerBlocked
      ? `<strong>Scan mislukt</strong><span>${escapeHtml(lastRun.last_error || 'De openbare bronnen konden niet worden gelezen.')} Probeer de scan opnieuw.</span>`
      : partialFailure
        ? `<strong>Scan gedeeltelijk afgerond</strong><span>${Number(lastRun.error_count || 0)} broncontrole(s) mislukten; resultaten van werkende bronnen zijn verwerkt. ${escapeHtml(lastRun.last_error || '')}</span>`
        : `<strong>Geen openbare scraperbron beschikbaar</strong><span>${escapeHtml(provider.message || 'Voeg een toegestane openbare feed of bron toe.')} Websitecontrole van bestaande leads blijft beschikbaar.</span>`;
  }

  function renderScanSummary() {
    const element = $('#scan-summary');
    const run = state.status?.lastRun;
    if (!element) return;
    element.hidden = !run;
    if (!run) return;
    const running = run.status === 'running' || run.status === 'paused';
    const date = new Date(run.finished_at || run.started_at);
    const when = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(date) : '';
    const filtered = Number(run.filtered_count ?? (Number(run.rejected_count || 0) + Number(run.unverified_count || 0)));
    const checks = (run.source_checks || []).map((check) => {
      let source = check.platform || 'Openbare bron';
      try { source = new URL(check.source_url).hostname; } catch {}
      return `<li><span>${escapeHtml(source)}${check.platform === 'mastodon' ? ` · #${escapeHtml(check.term)}` : ''}</span><span>${check.status === 'error' ? escapeHtml(check.error || 'Niet beschikbaar') : `${Number(check.result_count || 0)} berichten gelezen`}</span></li>`;
    }).join('');
    element.innerHTML = `<strong>${running ? 'Scan nog niet afgerond' : 'Laatste scan'}${when ? ` · ${escapeHtml(when)}` : ''}</strong><p>${Number(run.result_count || 0)} berichten bekeken · ${Number(run.new_signal_count || 0)} nieuwe leads · ${filtered} niet geselecteerd</p><small>Alleen directe aanvragen van de laatste ${Number(run.max_age_days || 31)} dagen verschijnen in de inbox.</small>${checks ? `<details><summary>Bekijk broncontroles</summary><ul>${checks}</ul></details>` : ''}`;
  }

  function getLeadTitle(signal = {}) {
    const keywordGroup = String(signal.keyword_group || '').trim().toLowerCase();
    const message = `${signal.message_text || ''} ${signal.snippet || ''}`.toLowerCase();
    if (keywordGroup === 'webshop' || /\b(webshop|webwinkel|online shop)\b/.test(message)) return 'Webshop aanvraag';
    if (keywordGroup === 'software_automation' || /\b(software|webapp|applicatie|dashboard|systeem|crm|portaal|automatisering|koppeling|chatbot|ai[- ]?(?:agent|assistent))\b/.test(message)) return 'Software- of automatiseringsvraag';
    if (keywordGroup === 'renew_or_repair' || /\b(vernieuw|moderniseer|redesign|verbeter|aanpas|onderhoud|werkt niet|doet het niet)\b/.test(message)) return 'Website verbeteren';
    return 'Website aanvraag';
  }

  function formatPublishedDate(value) {
    const date = new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' }).format(date);
  }

  function renderMetrics() {
    const counts = state.status && state.status.counts || {};
    [['#metric-total', counts.total], ['#metric-new', counts.new]].forEach(([selector, value]) => { const element = $(selector); if (element) element.textContent = value == null ? '-' : Number(value).toLocaleString('nl-NL'); });
  }

  function isDirectPostUrl(value, platform) {
    try {
      const url = new URL(String(value || ''));
      const hostname = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();
      const isLinkedInHost = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
      const isFacebookHost = hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.com' || hostname.endsWith('.fb.com');
      if (platform === 'linkedin') return isLinkedInHost && (/^\/posts\//.test(path) || /^\/feed\/update\//.test(path));
      if (platform === 'facebook') return isFacebookHost && (/(?:\/posts?|\/videos?|\/reels?|\/share\/p|\/share\/r)\/[^/]+/.test(path) || url.searchParams.has('story_fbid'));
      if (platform === 'bluesky') return hostname === 'bsky.app' && /^\/profile\/[^/]+\/post\/[^/]+/.test(path);
      if (platform === 'mastodon') return /^\/@[^/]+\/\d+/.test(path) || /^\/users\/[^/]+\/statuses\/\d+/.test(path);
      return platform === 'web' && ['http:', 'https:'].includes(url.protocol);
    } catch { return false; }
  }

  function signalCard(signal) {
    const platform = escapeHtml(signal.platform || 'onbekend');
    const originalUrl = isDirectPostUrl(signal.post_url, signal.platform) ? signal.post_url : '';
    const websiteUrl = signal.website_url || '';
    const websiteCandidates = Array.isArray(signal.website_candidates) ? signal.website_candidates.filter((candidate) => candidate && candidate.url).slice(0, 3) : [];
    const leadTitle = getLeadTitle(signal);
    const leadSummary = String(signal.display_summary || '').trim();
    const publishedDate = formatPublishedDate(signal.published_at);
    const candidateLinks = websiteCandidates.map((candidate) => `<a class="website-candidate" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.title || candidate.url)}</a>`).join('');
    const originalPostLink = originalUrl ? `<a class="lead-source-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open originele post" title="Open originele post"><span class="lead-source-icon" aria-hidden="true">↗</span></a>` : '<span class="lead-link-warning">Directe postlink niet beschikbaar</span>';
    const websiteDetails = websiteUrl || websiteCandidates.length || signal.website_title || signal.website_http_status || signal.website_redirect_url;
    const websiteMarkup = websiteDetails ? `<div class="lead-website">${websiteUrl ? `<a class="website-url" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteUrl)}</a>` : websiteCandidates.length ? `<span class="website-url website-url--candidate">Mogelijke websites</span><div class="website-candidates">${candidateLinks}</div>` : ''}${signal.website_title ? `<small class="website-detail">Titel: ${escapeHtml(signal.website_title)}</small>` : ''}${signal.website_http_status ? `<small class="website-detail">HTTP: ${escapeHtml(signal.website_http_status)}</small>` : ''}${signal.website_redirect_url ? `<a class="website-detail" href="${escapeHtml(signal.website_redirect_url)}" target="_blank" rel="noopener noreferrer">Redirect bekijken</a>` : ''}</div>` : '';
    const publishedDateMarkup = publishedDate ? `<time class="lead-published-date" datetime="${escapeHtml(signal.published_at)}">Gepost op ${escapeHtml(publishedDate)}</time>` : '';
    return `<article class="lead-card" data-signal-id="${escapeHtml(signal.id)}">
      <div class="lead-meta"><span class="platform-label platform-label--${platform}">${platform}</span>${originalPostLink}</div>
      <div class="lead-copy"><h3 class="lead-title">${escapeHtml(leadTitle)}</h3>${leadSummary ? `<p class="lead-summary">${escapeHtml(leadSummary)}</p>` : ''}</div>
      ${publishedDateMarkup}
      <div class="lead-side"><div class="lead-location"><strong>Regio</strong>${escapeHtml(signal.region || 'Onbekend')}</div>${websiteMarkup}</div>
    </article>`;
  }

  function renderSignals() {
    const list = $('#lead-list');
    if (!list) return;
    if (!state.signals.length) { list.innerHTML = ''; setInboxState('Geen recente, directe aanvragen gevonden. De laatste scan laat zien wat er is gecontroleerd.', ''); }
    else { setInboxState('', ''); list.innerHTML = state.signals.map(signalCard).join(''); }
    $('#result-count').textContent = `${state.total.toLocaleString('nl-NL')} resultaten`;
    const pagination = $('#pagination');
    pagination.hidden = state.total <= state.limit && state.offset === 0;
    $('#page-label').textContent = `Pagina ${Math.floor(state.offset / state.limit) + 1}`;
    $('#previous-page-button').disabled = state.offset === 0;
    $('#next-page-button').disabled = state.offset + state.signals.length >= state.total;
  }

  function getSignalQuery() {
    const params = new URLSearchParams();
    params.set('limit', String(state.limit)); params.set('offset', String(state.offset));
    return params.toString();
  }

  async function loadStatus() { state.status = await api('/api/lead-radar/status'); renderProviderStatus(); renderMetrics(); renderScanSummary(); }
  async function loadSignals({ silent = false } = {}) {
    if (!silent) setInboxState('Leads laden...', '');
    try { const body = await api(`/api/lead-radar/signals?${getSignalQuery()}`); state.signals = body.signals || []; state.total = Number(body.total) || 0; renderSignals(); }
    catch (error) { setInboxState(`Leads konden niet worden bijgewerkt: ${error.message}`, 'error'); }
  }
  async function startScan() {
    if (state.scanning) return;
    state.scanning = true;
    state.scanError = '';
    const payload = {
      platforms: ['web', 'mastodon'],
      regionMode: 'nationwide',
      regions: [],
      maxAgeDays: 31,
      maxQueries: 50,
      websiteLookupLimit: 0,
      keywordGroups: ['direct_website', 'renew_or_repair', 'webshop', 'new_business', 'software_automation'],
    };
    renderProviderStatus();
    $('#scan-progress').hidden = false;
    $('#scan-progress').classList.remove('scan-progress--error');
    $('#scan-progress-label').textContent = 'Openbare bronnen worden gecontroleerd. Dit kan even duren.';
    try {
      let run;
      do {
        const body = await api('/api/lead-radar/scan', { method: 'POST', body: JSON.stringify(run ? { ...payload, runId: run.id } : payload) });
        const previousCursor = run?.query_cursor;
        run = body.run || {};
        if (run.status === 'paused' && (!run.id || Number(run.query_cursor) <= Number(previousCursor ?? -1))) throw new Error('De scan kon niet verdergaan. Probeer opnieuw.');
      } while (run.status === 'paused');
      state.offset = 0;
      await Promise.all([loadStatus(), loadSignals()]);
    }
    catch (error) {
      state.scanError = error.message;
      $('#scan-progress').classList.add('scan-progress--error');
      $('#scan-progress-label').textContent = `Scan niet afgerond: ${error.message}`;
    }
    finally {
      state.scanning = false;
      $('#scan-progress').hidden = !state.scanError;
      renderProviderStatus();
    }
  }

  $('#previous-page-button').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadSignals(); });
  $('#next-page-button').addEventListener('click', () => { if (state.offset + state.signals.length < state.total) { state.offset += state.limit; loadSignals(); } });
  $('#scan-button').addEventListener('click', () => startScan());

  window.setInterval(() => {
    if (document.hidden || state.scanning) return;
    Promise.all([loadStatus(), loadSignals({ silent: true })]).catch(() => {});
  }, 60_000);

  Promise.all([loadStatus(), loadSignals()]).catch((error) => setInboxState(error.message, 'error'));
})();
