(function () {
  'use strict';

  const state = { offset: 0, limit: 50, total: 0, signals: [], status: null };
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

  function getLeadTitle(signal = {}) {
    const keywordGroup = String(signal.keyword_group || '').trim().toLowerCase();
    const message = `${signal.message_text || ''} ${signal.snippet || ''}`.toLowerCase();
    if (keywordGroup === 'webshop' || /\b(webshop|webwinkel|online shop)\b/.test(message)) return 'Webshop aanvraag';
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
      return isFacebookHost && (/(?:\/posts?|\/videos?|\/reels?|\/share\/p|\/share\/r)\/[^/]+/.test(path) || url.searchParams.has('story_fbid'));
    } catch { return false; }
  }

  function signalCard(signal) {
    const platform = escapeHtml(signal.platform || 'onbekend');
    const originalUrl = isDirectPostUrl(signal.post_url, signal.platform) ? signal.post_url : '';
    const websiteUrl = signal.website_url || '';
    const websiteCandidates = Array.isArray(signal.website_candidates) ? signal.website_candidates.filter((candidate) => candidate && candidate.url).slice(0, 3) : [];
    const leadTitle = getLeadTitle(signal);
    const leadSummary = String(signal.message_text || signal.snippet || '').trim();
    const publishedDate = formatPublishedDate(signal.published_at);
    const candidateLinks = websiteCandidates.map((candidate) => `<a class="website-candidate" href="${escapeHtml(candidate.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.title || candidate.url)}</a>`).join('');
    const originalPostLink = originalUrl ? `<a class="lead-source-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open originele post" title="Open originele post"><span class="lead-source-icon" aria-hidden="true">↗</span></a>` : '<span class="lead-link-warning">Directe postlink niet beschikbaar</span>';
    const websiteDetails = websiteUrl || websiteCandidates.length || signal.website_title || signal.website_http_status || signal.website_redirect_url;
    const websiteMarkup = websiteDetails ? `<div class="lead-website">${websiteUrl ? `<a class="website-url" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteUrl)}</a>` : websiteCandidates.length ? `<span class="website-url website-url--candidate">Mogelijke websites</span><div class="website-candidates">${candidateLinks}</div>` : ''}${signal.website_title ? `<small class="website-detail">Titel: ${escapeHtml(signal.website_title)}</small>` : ''}${signal.website_http_status ? `<small class="website-detail">HTTP: ${escapeHtml(signal.website_http_status)}</small>` : ''}${signal.website_redirect_url ? `<a class="website-detail" href="${escapeHtml(signal.website_redirect_url)}" target="_blank" rel="noopener noreferrer">Redirect bekijken</a>` : ''}</div>` : '';
    const fullMessageMarkup = leadSummary ? `<details class="lead-full-message"><summary>Lees volledig</summary><p class="lead-full-message__text">${escapeHtml(leadSummary)}</p></details>` : '';
    const publishedDateMarkup = publishedDate ? `<time class="lead-published-date" datetime="${escapeHtml(signal.published_at)}">Gepost op ${escapeHtml(publishedDate)}</time>` : '';
    return `<article class="lead-card" data-signal-id="${escapeHtml(signal.id)}">
      <div class="lead-meta"><span class="platform-label platform-label--${platform}">${platform}</span>${originalPostLink}</div>
      <div class="lead-copy"><h3 class="lead-title">${escapeHtml(leadTitle)}</h3>${leadSummary ? `<p class="lead-summary">${escapeHtml(leadSummary)}</p>${fullMessageMarkup}` : ''}</div>
      ${publishedDateMarkup}
      <div class="lead-side"><div class="lead-location"><strong>Regio</strong>${escapeHtml(signal.region || 'Onbekend')}</div>${websiteMarkup}</div>
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
