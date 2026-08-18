(function () {
  'use strict';

  const state = { offset: 0, limit: 50, total: 0, signals: [], status: null };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatDate = (value) => {
    if (!value) return 'Onbekend';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Onbekend' : new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };
  const publicationDateLabels = { provider_timestamp: 'Bron: DataForSEO-publicatietijd', provider_date: 'Bron: SERP-datumveld', serp_date: 'Bron: SERP-datum', serp_text: 'Bron: datum in zoekresultaattekst', post_meta: 'Bron: openbare post-metadata', post_jsonld: 'Bron: openbare post-JSON-LD', post_time: 'Bron: openbare posttijd', manual: 'Bron: handmatig ingevoerd', unknown: 'Bron vermeldde geen publicatiedatum' };
  const businessMatchLabels = { matched: 'BEDRIJF BEVESTIGD', ambiguous: 'BEDRIJF NIET ZEKER', not_found: 'BEDRIJF NIET GEVONDEN', agency_detected: 'MOGELIJK MARKETINGBUREAU', not_checked: 'BEDRIJF NOG NIET GECONTROLEERD', provider_unavailable: 'BEDRIJFSCONTROLE NIET BESCHIKBAAR', provider_error: 'BEDRIJFSCONTROLE MISLUKT' };

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

  function isDirectPostUrl(value, platform) {
    try {
      const url = new URL(String(value || ''));
      const path = url.pathname.toLowerCase();
      if (platform === 'linkedin') return url.hostname.endsWith('linkedin.com') && (/^\/posts\//.test(path) || /^\/feed\/update\//.test(path));
      return (url.hostname.endsWith('facebook.com') || url.hostname.endsWith('fb.com')) && (/(?:\/posts?|\/videos?|\/reels?|\/share\/p|\/share\/r)\/[^/]+/.test(path) || url.searchParams.has('story_fbid'));
    } catch { return false; }
  }

  function signalCard(signal) {
    const platform = escapeHtml(signal.platform || 'onbekend');
    const originalUrl = isDirectPostUrl(signal.post_url, signal.platform) ? signal.post_url : '';
    const websiteUrl = signal.website_url || '';
    const websiteCandidates = Array.isArray(signal.website_candidates) ? signal.website_candidates.filter((candidate) => candidate && candidate.url).slice(0, 3) : [];
    const leadTitle = signal.message_text || signal.snippet || 'Geen berichttekst beschikbaar.';
    const publicationDate = signal.published_at ? formatDate(signal.published_at) : (signal.publication_date_raw || 'Nog niet beschikbaar via openbare bron');
    const publicationSource = publicationDateLabels[signal.publication_date_source] || publicationDateLabels.unknown;
    const candidateLinks = websiteCandidates.map((candidate) => `<a class="website-candidate" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.title || candidate.url)}</a>`).join('');
    const businessStatus = signal.business_match_status || 'not_checked';
    const businessCandidates = Array.isArray(signal.business_candidates) ? signal.business_candidates.slice(0, 3).filter((candidate) => candidate && (candidate.business_domain || candidate.business_website_url)) : [];
    const businessCandidateLinks = businessCandidates.map((candidate) => { const url = candidate.business_website_url || (candidate.business_domain ? `https://${candidate.business_domain}` : ''); return url ? `<a class="website-candidate" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.business_name || candidate.business_domain)}</a>` : ''; }).join('');
    const originalPostLink = originalUrl ? `<a class="lead-source-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">Open originele post</a>` : '<span class="lead-link-warning">Directe postlink niet beschikbaar</span>';
    return `<article class="lead-card" data-signal-id="${escapeHtml(signal.id)}">
      <div class="lead-meta"><span class="platform-label platform-label--${platform}">${platform}</span><div class="lead-author">${escapeHtml(signal.author_name || 'Openbare pagina of profiel')}</div><div class="lead-date"><strong>Publicatiedatum:</strong> ${escapeHtml(publicationDate)}<small>${escapeHtml(publicationSource)}</small></div><div class="lead-source">Gevonden op: ${escapeHtml(formatDate(signal.found_at))}</div></div>
       <div class="lead-copy"><h3 class="lead-title">${escapeHtml(leadTitle)}</h3>${originalPostLink}</div>
      <div class="lead-location"><strong>Regio</strong>${escapeHtml(signal.region || 'Onbekend')}<div class="lead-business"><strong>Bedrijfscontrole</strong><span class="business-match business-match--${escapeHtml(businessStatus)}">${escapeHtml(businessMatchLabels[businessStatus] || businessStatus)}</span>${signal.business_name ? `<span>${escapeHtml(signal.business_name)}</span>` : ''}${signal.business_city ? `<span>${escapeHtml(signal.business_city)}</span>` : ''}${signal.business_phone ? `<a href="tel:${escapeHtml(signal.business_phone)}">${escapeHtml(signal.business_phone)}</a>` : ''}${signal.business_domain ? `<a href="https://${escapeHtml(signal.business_domain)}" target="_blank" rel="noopener noreferrer">${escapeHtml(signal.business_domain)}</a>` : businessCandidateLinks ? `<div class="website-candidates">${businessCandidateLinks}</div>` : ''}</div><div class="lead-engagement"><strong>Engagement</strong>${signal.engagement_known ? `${signal.likes == null ? 'likes onbekend' : `${signal.likes} likes`} · ${signal.comments == null ? 'reacties onbekend' : `${signal.comments} reacties`}` : 'Onbekend'}</div></div>
      <div class="lead-website">${websiteUrl ? `<a class="website-url" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteUrl)}</a>` : websiteCandidates.length ? `<span class="website-url website-url--candidate">Mogelijke websites</span><div class="website-candidates">${candidateLinks}</div>` : ''}${signal.website_title ? `<small class="website-detail">Titel: ${escapeHtml(signal.website_title)}</small>` : ''}${signal.website_http_status ? `<small class="website-detail">HTTP: ${escapeHtml(signal.website_http_status)}</small>` : ''}${signal.website_redirect_url ? `<a class="website-detail" href="${escapeHtml(signal.website_redirect_url)}" target="_blank" rel="noopener noreferrer">Redirect bekijken</a>` : ''}</div>
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
  async function startScan() {
    const platforms = ($('#scan-platforms').dataset.value || 'facebook,linkedin').split(',').filter(Boolean);
    const regionMode = $('#scan-region-mode').dataset.value || 'nationwide';
    const maxAgeDays = Number($('#scan-max-age-days').dataset.value) || 30;
    const payload = { platforms, regionMode, regions: [], maxAgeDays };
    const button = $('#scan-button'); button.disabled = true; $('#scan-progress').hidden = false; $('#scan-progress-label').textContent = 'Scan bezig — resultaten worden na afloop bijgewerkt.';
    try { const body = await api('/api/lead-radar/scan', { method: 'POST', body: JSON.stringify(payload) }); $('#scan-progress-label').textContent = body.run?.status === 'provider_unavailable' ? 'Provider niet geconfigureerd.' : 'Scan afgerond.'; await Promise.all([loadStatus(), loadSignals()]); }
    catch (error) { $('#scan-progress-label').textContent = error.message; }
    finally {
      button.disabled = !state.status?.provider?.configured;
      setTimeout(() => { $('#scan-progress').hidden = true; }, 1200);
    }
  }

  const customSelects = Array.from(document.querySelectorAll('.custom-select'));
  const customSelectOptions = (select) => Array.from(select.querySelectorAll('[data-custom-select-option]'));
  function setCustomDropdownOpen(select, isOpen) {
    const trigger = select.querySelector('[data-custom-select-trigger]');
    const menu = select.querySelector('[role="listbox"]');
    if (!trigger || !menu) return;
    if (isOpen) customSelects.forEach((candidate) => { if (candidate !== select) setCustomDropdownOpen(candidate, false); });
    select.classList.toggle('is-open', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
    menu.hidden = !isOpen;
  }
  function selectCustomOption(select, option) {
    if (!option) return;
    select.dataset.value = option.dataset.value || '';
    const value = select.querySelector('.custom-select__value');
    if (value) value.textContent = option.textContent.trim();
    customSelectOptions(select).forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === option)));
    setCustomDropdownOpen(select, false);
    select.querySelector('[data-custom-select-trigger]')?.focus();
  }
  customSelects.forEach((select) => {
    const trigger = select.querySelector('[data-custom-select-trigger]');
    const menu = select.querySelector('[role="listbox"]');
    const options = () => customSelectOptions(select);
    trigger?.addEventListener('click', () => setCustomDropdownOpen(select, !select.classList.contains('is-open')));
    trigger?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setCustomDropdownOpen(select, true);
        (options().find((option) => option.getAttribute('aria-selected') === 'true') || options()[0])?.focus();
      }
    });
    menu?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-custom-select-option]');
      if (option) selectCustomOption(select, option);
    });
    menu?.addEventListener('keydown', (event) => {
      const availableOptions = options();
      if (!availableOptions.length) return;
      const currentIndex = availableOptions.indexOf(event.target.closest('[data-custom-select-option]'));
      if (event.key === 'Escape') { event.preventDefault(); setCustomDropdownOpen(select, false); trigger?.focus(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); availableOptions[(currentIndex + 1) % availableOptions.length]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); availableOptions[(currentIndex - 1 + availableOptions.length) % availableOptions.length]?.focus(); }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCustomOption(select, event.target.closest('[data-custom-select-option]')); }
    });
  });
  document.addEventListener('click', (event) => { customSelects.forEach((select) => { if (!select.contains(event.target)) setCustomDropdownOpen(select, false); }); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    customSelects.forEach((select) => {
      if (select.classList.contains('is-open')) { setCustomDropdownOpen(select, false); select.querySelector('[data-custom-select-trigger]')?.focus(); }
    });
  });
  $('#previous-page-button').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadSignals(); });
  $('#next-page-button').addEventListener('click', () => { if (state.offset + state.signals.length < state.total) { state.offset += state.limit; loadSignals(); } });
  $('#scan-button').addEventListener('click', () => startScan());

  window.setInterval(() => {
    if (document.hidden) return;
    Promise.all([loadStatus(), loadSignals({ silent: true })]).catch(() => {});
  }, 60_000);

  Promise.all([loadStatus(), loadSignals()]).catch((error) => setInboxState(error.message, 'error'));
})();

