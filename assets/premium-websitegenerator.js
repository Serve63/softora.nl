let websitePreviewLibraryRemoteEntries = null;
let websitePreviewLibraryUseRemote = false;
let websitePreviewBatchPollTimer = null;
let websitePreviewActiveBatchJobId = '';
const WEBSITE_PREVIEW_BATCH_MAX_STALLED_POLLS = 30;
const WEBSITE_PREVIEW_BATCH_POLL_INTERVAL_MS = 1400;
const WEBSITE_PREVIEW_BATCH_MAX_POLL_FAILURES = 12;
let websitePreviewBatchPollFailures = 0;
let websitePreviewBatchPollNoProgress = 0;
let websitePreviewBatchPollLastFingerprint = '';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeLibraryDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length < 12 * 1024 * 1024;
}

function appendWebsiteGeneratorTextElement(parent, tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = String(text || '');
  parent.appendChild(el);
  return el;
}

function loadLibraryEntries() {
  if (websitePreviewLibraryUseRemote && Array.isArray(websitePreviewLibraryRemoteEntries)) {
    return websitePreviewLibraryRemoteEntries.slice();
  }
  return [];
}

async function maybeHydrateWebsitePreviewLibraryFromServer() {
  if (!websiteGeneratorAuthState.authenticated) {
    websitePreviewLibraryRemoteEntries = [];
    websitePreviewLibraryUseRemote = true;
    return;
  }
  try {
    const response = await fetch('/api/website-preview-library', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data || data.ok === false) {
      throw new Error(String(data?.detail || data?.error || 'Bibliotheek laden mislukt'));
    }
    websitePreviewLibraryRemoteEntries = Array.isArray(data.entries) ? data.entries : [];
    websitePreviewLibraryUseRemote = true;
    if (Number(data.omittedLargeItems || 0) > 0) {
      showToast('Bibliotheek geladen; een paar te grote previews zijn overgeslagen');
    }
  } catch (error) {
    websitePreviewLibraryUseRemote = true;
    websitePreviewLibraryRemoteEntries = [];
    console.warn('Websitepreview-bibliotheek laden mislukt:', error);
  }
}

async function savePreviewToLibrary({ dataUrl, url, hostname, fileName, width, height }) {
  if (!dataUrl || !url) return;
  const baseEntry = {
    dataUrl,
    url,
    hostname: String(hostname || '').trim(),
    fileName: String(fileName || `${hostname || 'preview'}-preview.png`).trim(),
    width: Number(width) || WEBSITE_PREVIEW_IMAGE_WIDTH,
    height: Number(height) || WEBSITE_PREVIEW_IMAGE_HEIGHT,
    createdAt: new Date().toISOString(),
  };

  if (websiteGeneratorAuthState.authenticated) {
    try {
      const response = await fetch('/api/website-preview-library', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(baseEntry),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await loadWebsiteGeneratorAuthState(true);
      }
      if (response.ok && data && data.ok && data.entry && data.entry.id) {
        const entry = data.entry;
        const merged = [entry, ...(websitePreviewLibraryRemoteEntries || []).filter((x) => x.id !== entry.id)];
        websitePreviewLibraryRemoteEntries = merged;
        websitePreviewLibraryUseRemote = true;
        return;
      }
      showToast(String(data?.detail || data?.error || 'Preview opslaan mislukt'));
      return;
    } catch (_) {
      showToast('Preview opslaan mislukt — controleer je verbinding.');
      return;
    }
  }

  showToast('Log eerst in om previews centraal op te slaan.');
}

function createLibraryCardElement(entry) {
  const id = String(entry?.id || '').trim();
  const when = entry.createdAt
    ? new Date(entry.createdAt).toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const host = String(entry.hostname || '—');

  const card = document.createElement('div');
  card.className = 'library-card';
  card.dataset.libraryId = id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.addEventListener('click', () => openLibraryEntry(id));
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLibraryEntry(id);
  });

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'library-thumb-wrap';
  const thumbSrc = isSafeLibraryDataUrl(entry.dataUrl) ? entry.dataUrl : '';
  if (thumbSrc) {
    const img = document.createElement('img');
    img.src = thumbSrc;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 200;
    img.height = 300;
    thumbWrap.appendChild(img);
  } else {
    const invalidImage = appendWebsiteGeneratorTextElement(thumbWrap, 'span', '', 'Geen geldige afbeelding');
    invalidImage.style.fontSize = '11px';
    invalidImage.style.color = '#9aa3b5';
    invalidImage.style.padding = '12px';
    invalidImage.style.textAlign = 'center';
  }

  const meta = document.createElement('div');
  meta.className = 'library-card-meta';
  const hostEl = appendWebsiteGeneratorTextElement(meta, 'div', 'library-card-host', host);
  hostEl.title = host;
  appendWebsiteGeneratorTextElement(meta, 'div', 'library-card-date', when);

  const actions = document.createElement('div');
  actions.className = 'library-card-actions';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn outline';
  removeBtn.style.padding = '6px 12px';
  removeBtn.style.fontSize = '10px';
  removeBtn.textContent = 'Verwijderen';
  removeBtn.addEventListener('click', (event) => {
    void removeLibraryEntry(id, event);
  });
  actions.appendChild(removeBtn);
  meta.appendChild(actions);

  card.append(thumbWrap, meta);
  return card;
}

function renderLibraryPanel() {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  if (!grid || !empty) return;
  const items = loadLibraryEntries();
  if (!items.length) {
    grid.style.display = 'none';
    grid.replaceChildren();
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.replaceChildren(...items.map((entry) => createLibraryCardElement(entry)));
}

async function removeLibraryEntry(id, ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (websiteGeneratorAuthState.authenticated && websitePreviewLibraryUseRemote) {
    try {
      const response = await fetch(`/api/website-preview-library/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await loadWebsiteGeneratorAuthState(true);
      }
      if (response.ok && data && data.ok) {
        if (Array.isArray(websitePreviewLibraryRemoteEntries)) {
          websitePreviewLibraryRemoteEntries = websitePreviewLibraryRemoteEntries.filter((x) => x.id !== id);
        }
        renderLibraryPanel();
        showToast('Verwijderd uit bibliotheek');
        return;
      }
      if (response.status === 404) {
        await maybeHydrateWebsitePreviewLibraryFromServer();
        renderLibraryPanel();
        showToast('Item bestond niet meer; bibliotheek vernieuwd.');
        return;
      }
      showToast(String(data?.detail || data?.error || 'Verwijderen mislukt'));
      return;
    } catch (_) {
      showToast('Verwijderen mislukt — controleer je verbinding.');
      return;
    }
  }
  renderLibraryPanel();
  showToast('Verwijderen kan alleen vanuit de centrale bibliotheek.');
}

async function fetchLibraryEntryById(id) {
  const entryId = String(id || '').trim();
  if (!entryId || !websiteGeneratorAuthState.authenticated) return null;
  try {
    const response = await fetch(`/api/website-preview-library/${encodeURIComponent(entryId)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok && data.entry?.id) {
      const entry = data.entry;
      const merged = [entry, ...(websitePreviewLibraryRemoteEntries || []).filter((x) => x.id !== entry.id)];
      websitePreviewLibraryRemoteEntries = merged;
      websitePreviewLibraryUseRemote = true;
      return entry;
    }
  } catch (_) {}
  return null;
}

function openLibraryEntry(id) {
  const entry = loadLibraryEntries().find((x) => x.id === id);
  if (!entry || !entry.dataUrl) {
    showToast('Item niet gevonden');
    return;
  }
  const scanTab = document.querySelector('.tab[data-tab="scan"]');
  switchTab('scan', scanTab);
  document.getElementById('scan-url').value = entry.url || '';
  const hostname = entry.hostname || (() => {
    try {
      return new URL(entry.url).hostname;
    } catch (_) {
      return 'preview';
    }
  })();
  const previewWidth = Number(entry.width) || WEBSITE_PREVIEW_IMAGE_WIDTH;
  const previewHeight = Number(entry.height) || WEBSITE_PREVIEW_IMAGE_HEIGHT;
  mountScanPreviewUI(entry.dataUrl, entry.url, hostname, entry.fileName, previewWidth, previewHeight);
  showToast('Preview geopend');
}

async function switchTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  const tabBtn = el || document.querySelector(`.tab[data-tab="${name}"]`);
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  if (tabBtn) tabBtn.classList.add('active');
  if (name === 'library') {
    await maybeHydrateWebsitePreviewLibraryFromServer();
    renderLibraryPanel();
  }
  try {
    const base = `${window.location.pathname || '/premium-websitegenerator'}${window.location.search || ''}`;
    if (name === 'library') {
      if (window.location.hash !== '#bibliotheek') {
        window.location.hash = 'bibliotheek';
      }
    } else if (window.location.hash) {
      window.history.replaceState(null, '', base);
      const refresh = window.SoftoraPersonnelTheme && window.SoftoraPersonnelTheme.refreshPremiumStaticSidebarActiveState;
      if (typeof refresh === 'function') refresh();
    }
  } catch (_) {}
}

let websiteGeneratorAuthState = {
  loaded: false,
  authenticated: false,
};
let websiteGeneratorAuthPromise = null;

function getWebsiteGeneratorLoginHref() {
  const nextPath = `${window.location.pathname || '/premium-websitegenerator'}${window.location.search || ''}`;
  return `/premium-personeel-login?next=${encodeURIComponent(nextPath)}`;
}

function applyWebsiteGeneratorAuthState() {
  const authCard = document.getElementById('websitegenerator-auth-card');
  const authMessageEl = document.getElementById('websitegenerator-auth-message');
  const loginLinkEl = document.getElementById('websitegenerator-login-link');
  const scanBtn = document.getElementById('scan-btn');
  const websiteLinkCreateEl = document.getElementById('website-link-create-btn');
  const websiteLinkStatusEl = document.getElementById('website-link-status');
  const authLoaded = Boolean(websiteGeneratorAuthState.loaded);
  const isAuthenticated = Boolean(authLoaded && websiteGeneratorAuthState.authenticated);

  if (loginLinkEl) {
    loginLinkEl.href = getWebsiteGeneratorLoginHref();
  }

  if (authMessageEl && authLoaded && !isAuthenticated) {
    authMessageEl.textContent = 'Log in met je premium account om scans te genereren en websitelinks te publiceren.';
  }

  if (authCard) {
    authCard.hidden = !authLoaded || isAuthenticated;
  }

  if (scanBtn) {
    scanBtn.disabled = !isAuthenticated;
  }

  if (websiteLinkCreateEl) {
    websiteLinkCreateEl.disabled = !isAuthenticated;
  }

  if (websiteLinkStatusEl) {
    if (isAuthenticated) {
      if (String(websiteLinkStatusEl.textContent || '').trim() === 'Log in om websitelinks aan te maken.') {
        websiteLinkStatusEl.textContent = '';
      }
      websiteLinkStatusEl.style.color = 'var(--text-mid)';
    } else if (authLoaded && !String(websiteLinkStatusEl.textContent || '').trim()) {
      websiteLinkStatusEl.textContent = 'Log in om websitelinks aan te maken.';
      websiteLinkStatusEl.style.color = '#c0392b';
    }
  }
}

async function loadWebsiteGeneratorAuthState(force = false) {
  if (websiteGeneratorAuthPromise && !force) return websiteGeneratorAuthPromise;

  websiteGeneratorAuthPromise = (async function () {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => ({}));
      websiteGeneratorAuthState = {
        loaded: true,
        authenticated: Boolean(response.ok && payload && payload.authenticated),
      };
    } catch (_) {
      websiteGeneratorAuthState = {
        loaded: true,
        authenticated: false,
      };
    }

    applyWebsiteGeneratorAuthState();
    if (websiteGeneratorAuthState.authenticated) {
      await maybeHydrateWebsitePreviewLibraryFromServer();
      const libPanel = document.getElementById('tab-library');
      if (libPanel && libPanel.classList.contains('active') && typeof renderLibraryPanel === 'function') {
        renderLibraryPanel();
      }
      await resumeWebsitePreviewBatchIfAny();
    } else {
      clearWebsitePreviewBatchPoll();
    }
    return websiteGeneratorAuthState;
  })();

  try {
    return await websiteGeneratorAuthPromise;
  } finally {
    websiteGeneratorAuthPromise = null;
  }
}

async function ensureWebsiteGeneratorAuth(message) {
  const authState = websiteGeneratorAuthState.loaded
    ? websiteGeneratorAuthState
    : await loadWebsiteGeneratorAuthState();
  if (authState.authenticated) return true;

  applyWebsiteGeneratorAuthState();
  const authCard = document.getElementById('websitegenerator-auth-card');
  const authMessageEl = document.getElementById('websitegenerator-auth-message');
  if (authMessageEl && message) {
    authMessageEl.textContent = String(message);
  }
  if (authCard) {
    authCard.hidden = false;
    authCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (message) showToast(message);
  return false;
}

const SCAN_URL_BATCH_MAX = 1;

function tokenizeScanUrlInput(raw) {
  return String(raw || '')
    .split(/[\r\n;,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeScanUrlToken(chunk) {
  let u = String(chunk || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u.replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function buildScanUrlList(tokens) {
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    const u = normalizeScanUrlToken(t);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= SCAN_URL_BATCH_MAX) break;
  }
  return out;
}

function newPreviewBlockId() {
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDownloadIconElement() {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4');
  const polyline = document.createElementNS(svgNs, 'polyline');
  polyline.setAttribute('points', '7 10 12 15 17 10');
  const line = document.createElementNS(svgNs, 'line');
  line.setAttribute('x1', '12');
  line.setAttribute('y1', '15');
  line.setAttribute('x2', '12');
  line.setAttribute('y2', '3');

  svg.append(path, polyline, line);
  return svg;
}

function createPreviewZoneElement(blockId, hostname, previewWidth, useStablePreviewImageId) {
  const host = String(hostname || '');
  const frameW = Math.min(window.innerWidth - 100, previewWidth);

  const root = document.createElement('div');
  root.className = 'preview-zone';
  root.id = blockId;

  const label = document.createElement('div');
  label.className = 'preview-label';
  appendWebsiteGeneratorTextElement(label, 'span', '', `Preview - ${host}`);

  const actions = document.createElement('div');
  actions.className = 'preview-actions';
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn';
  downloadBtn.style.padding = '6px 14px';
  downloadBtn.style.fontSize = '11px';
  downloadBtn.append(createDownloadIconElement(), document.createTextNode(' Download PNG'));
  downloadBtn.addEventListener('click', () => downloadPreviewBlock(blockId));
  actions.appendChild(downloadBtn);
  label.appendChild(actions);

  const media = document.createElement('div');
  media.className = 'preview-media';
  media.style.maxWidth = `${frameW}px`;
  const img = document.createElement('img');
  if (useStablePreviewImageId) {
    img.id = 'preview-image';
  } else {
    img.className = 'preview-image-pixel';
  }
  img.alt = `Website preview ${host}`;
  img.style.width = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';
  media.appendChild(img);

  root.append(label, media);
  return root;
}

function wirePreviewBlock(blockId, previewDataUrl, url, hostname, fileName) {
  const root = document.getElementById(blockId);
  if (!root) return;
  const img = root.querySelector('img');
  if (img) img.src = previewDataUrl;
  window.__pvDownloads = window.__pvDownloads || {};
  const fn = String(fileName || `${hostname}-preview.png`).trim();
  window.__pvDownloads[blockId] = { dataUrl: previewDataUrl, fileName: fn };
  window._lastPreviewImageDataUrl = previewDataUrl;
  window._lastPreviewImageFileName = fn;
  window._lastPreviewUrl = url;
}

function downloadPreviewBlock(blockId) {
  const p = window.__pvDownloads && window.__pvDownloads[blockId];
  if (!p || !p.dataUrl) return;
  const a = document.createElement('a');
  a.href = p.dataUrl;
  a.download = p.fileName || 'website-preview.png';
  a.click();
  showToast('Preview gedownload');
}

function mountScanPreviewUI(previewDataUrl, url, hostname, fileName, previewWidth, previewHeight) {
  const blockId = newPreviewBlockId();
  const out = document.getElementById('scan-output');
  if (!out) return;
  const stack = document.createElement('div');
  stack.className = 'scan-previews-stack';
  stack.id = 'scan-previews-stack';
  stack.appendChild(createPreviewZoneElement(
    blockId,
    hostname,
    previewWidth,
    true
  ));
  out.replaceChildren(stack);
  wirePreviewBlock(blockId, previewDataUrl, url, hostname, fileName);
}

function clearWebsitePreviewBatchPoll() {
  if (websitePreviewBatchPollTimer) {
    clearInterval(websitePreviewBatchPollTimer);
    websitePreviewBatchPollTimer = null;
  }
  websitePreviewBatchPollFailures = 0;
  websitePreviewBatchPollNoProgress = 0;
  websitePreviewBatchPollLastFingerprint = '';
}

function getStoredWebsitePreviewBatchJobId() {
  const inMemory = String(websitePreviewActiveBatchJobId || '').trim();
  if (inMemory) return inMemory;
  return '';
}

function setStoredWebsitePreviewBatchJobId(jobId) {
  websitePreviewActiveBatchJobId = String(jobId || '').trim();
}

function clearStoredWebsitePreviewBatchJobId() {
  websitePreviewActiveBatchJobId = '';
}

function createBatchLoadingRow(hostname) {
  const ph = document.createElement('div');
  ph.className = 'preview-loading-row';

  const spinner = document.createElement('div');
  spinner.className = 'premium-boot-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  spinner.style.setProperty('--loader-size', '28px');
  ['softora-dossier-loader__orbit--outer', 'softora-dossier-loader__orbit--inner', 'softora-dossier-loader__dot']
    .forEach((className) => {
      const part = document.createElement('span');
      part.className = className;
      part.setAttribute('aria-hidden', 'true');
      spinner.appendChild(part);
    });

  const label = document.createElement('div');
  label.append(document.createTextNode('Bezig met '));
  appendWebsiteGeneratorTextElement(label, 'strong', '', hostname);
  label.append(document.createTextNode('…'));

  ph.append(spinner, label);
  return ph;
}

function mountScanBatchShell(container, message) {
  if (!container) return null;
  const bar = document.createElement('div');
  bar.className = 'scan-batch-bar';
  bar.id = 'scan-batch-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.textContent = message;

  const stack = document.createElement('div');
  stack.className = 'scan-previews-stack';
  stack.id = 'scan-previews-stack';
  container.replaceChildren(bar, stack);
  return stack;
}

function createPreviewMessageZone(hostname, message) {
  const row = document.createElement('div');
  row.className = 'preview-zone';

  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.style.padding = '20px';
  emptyState.style.margin = '0';
  emptyState.style.border = '1px solid var(--border)';
  emptyState.style.borderRadius = '8px';

  const text = document.createElement('p');
  appendWebsiteGeneratorTextElement(text, 'strong', '', hostname);
  text.appendChild(document.createElement('br'));
  const detail = appendWebsiteGeneratorTextElement(text, 'span', '', message);
  detail.style.color = 'var(--text-mid)';

  emptyState.appendChild(text);
  row.appendChild(emptyState);
  return row;
}

function renderScanOutputMessage(container, message) {
  if (!container) return;
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  appendWebsiteGeneratorTextElement(emptyState, 'p', '', message);
  container.replaceChildren(emptyState);
}

function scheduleWebsitePreviewBatchPoll() {
  clearWebsitePreviewBatchPoll();
  websitePreviewBatchPollTimer = setInterval(() => {
    void pollWebsitePreviewBatch();
  }, WEBSITE_PREVIEW_BATCH_POLL_INTERVAL_MS);
  void pollWebsitePreviewBatch();
}

function stopScanBatchPollWithMessage(message) {
  clearWebsitePreviewBatchPoll();
  clearStoredWebsitePreviewBatchJobId();
  const out = document.getElementById('scan-output');
  if (!out) return;
  renderScanOutputMessage(out, message);
}

function buildWebsitePreviewJobFingerprint(job) {
  const items = Array.isArray(job?.items) ? job.items : [];
  const itemState = items
    .map((item) => `${String(item?.status || '').trim()}:${String(item?.libraryEntryId || '').trim()}`)
    .join('|');
  return `${String(job?.status || '').trim()}|${Number(job?.currentIndex || 0)}|${itemState}`;
}

async function startBackgroundBatchScan(urls) {
  const out = document.getElementById('scan-output');
  if (out) mountScanBatchShell(out, 'Preview wordt gestart…');
  const response = await fetch('/api/website-preview/batch', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ urls }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await loadWebsiteGeneratorAuthState(true);
    throw new Error('Log eerst in om AI previews te genereren.');
  }
  if (!response.ok || !data || !data.ok || !data.jobId) {
    throw new Error(String(data?.detail || data?.error || 'Batch start mislukt'));
  }
  setStoredWebsitePreviewBatchJobId(data.jobId);
  scheduleWebsitePreviewBatchPoll();
}

async function pollWebsitePreviewBatch() {
  const jobId = getStoredWebsitePreviewBatchJobId();
  if (!jobId) {
    clearWebsitePreviewBatchPoll();
    return;
  }
  try {
    const res = await fetch(`/api/website-preview/batch/${encodeURIComponent(jobId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401) {
      stopScanBatchPollWithMessage('Sessie verlopen. Log opnieuw in en probeer de scan nogmaals.');
      return;
    }
    if (res.status === 403 || res.status === 404) {
      if (res.status === 403) {
        stopScanBatchPollWithMessage('Toegang verlopen. Log opnieuw in om de scanstatus te laden.');
      } else {
        clearStoredWebsitePreviewBatchJobId();
        clearWebsitePreviewBatchPoll();
        const out = document.getElementById('scan-output');
        if (out && payload?.detail) {
          renderScanOutputMessage(out, String(payload.detail));
        }
      }
      if (res.status === 403 && payload?.detail) {
        showToast(String(payload.detail));
      }
      return;
    }
    if (!res.ok || !payload || !payload.job) {
      websitePreviewBatchPollFailures += 1;
      if (websitePreviewBatchPollFailures >= WEBSITE_PREVIEW_BATCH_MAX_POLL_FAILURES) {
        stopScanBatchPollWithMessage(
          'Scanstatus kon niet worden opgehaald. De foto-generatie is mogelijk onstabiel. Probeer het opnieuw.'
        );
      }
      return;
    }
    websitePreviewBatchPollFailures = 0;
    const fingerprint = buildWebsitePreviewJobFingerprint(payload.job);
    if (fingerprint === websitePreviewBatchPollLastFingerprint) {
      websitePreviewBatchPollNoProgress += 1;
    } else {
      websitePreviewBatchPollNoProgress = 0;
      websitePreviewBatchPollLastFingerprint = fingerprint;
    }
    if (
      websitePreviewBatchPollNoProgress >= WEBSITE_PREVIEW_BATCH_MAX_STALLED_POLLS &&
      payload.job.status === 'running'
    ) {
      stopScanBatchPollWithMessage(
        'De scan loopt vast. Start de preview opnieuw of controleer de pagina later in de bibliotheek.'
      );
      return;
    }
    await renderBatchJobProgress(payload.job);
    if (payload.job.status === 'done' || payload.job.status === 'error') {
      clearStoredWebsitePreviewBatchJobId();
      clearWebsitePreviewBatchPoll();
      const n = Number(payload.job.total || 0) || 0;
      if (payload.job.status === 'done') {
        showToast(n === 1 ? 'URL verwerkt' : `${n} URL's verwerkt`);
      } else if (payload.job.error) {
        showToast(String(payload.job.error));
      }
      await maybeHydrateWebsitePreviewLibraryFromServer();
      if (typeof renderLibraryPanel === 'function') {
        renderLibraryPanel();
      }
    }
  } catch (_) {
    websitePreviewBatchPollFailures += 1;
    if (websitePreviewBatchPollFailures >= WEBSITE_PREVIEW_BATCH_MAX_POLL_FAILURES) {
      stopScanBatchPollWithMessage(
        'Scanstatus kon niet worden opgehaald. De foto-generatie is mogelijk onstabiel. Probeer het opnieuw.'
      );
    }
  }
}

async function renderBatchJobProgress(job) {
  const stack = document.getElementById('scan-previews-stack');
  const bar = document.getElementById('scan-batch-bar');
  if (!stack || !bar) return;

  const items = Array.isArray(job.items) ? job.items : [];
  const total = items.length || Number(job.total || 0) || 0;
  let runningIdx = -1;
  let runningHost = '';
  items.forEach((it, idx) => {
    if (it && it.status === 'running') {
      runningIdx = idx;
      runningHost = String(it.hostname || '').trim();
    }
  });

  if (job.status === 'error' && job.error) {
    bar.textContent = String(job.error);
  } else if (job.status === 'done') {
    bar.textContent = total === 1 ? 'Klaar — website verwerkt' : `Klaar — ${total} websites`;
  } else if (runningIdx >= 0) {
    bar.textContent = `Preview ${runningIdx + 1} van ${total} — ${runningHost || '…'}`;
  } else {
    bar.textContent = total ? `Preview bezig… (${total} URL)` : 'Preview bezig…';
  }

  if (websiteGeneratorAuthState.authenticated) {
    await maybeHydrateWebsitePreviewLibraryFromServer().catch(() => {});
  }
  const entries = loadLibraryEntries();

  stack.replaceChildren();
  for (let idx = 0; idx < items.length; idx += 1) {
    const it = items[idx];
    if (!it) continue;
    const st = String(it.status || '').trim();
    const host = String(it.hostname || '').trim() || 'site';
    if (st === 'pending') {
      const row = document.createElement('div');
      row.className = 'preview-pending-row';
      row.style.cssText = 'padding:12px 0;font-size:13px;color:var(--text-mid)';
      row.append(document.createTextNode('Wachtend — '));
      appendWebsiteGeneratorTextElement(row, 'strong', '', host);
      stack.appendChild(row);
    } else if (st === 'running') {
      stack.appendChild(createBatchLoadingRow(host));
    } else if (st === 'error') {
      stack.appendChild(createPreviewMessageZone(host, String(it.error || 'Onbekende fout')));
    } else if (st === 'done') {
      const entryId = String(it.libraryEntryId || '').trim();
      let entry = entryId ? entries.find((e) => String(e.id) === entryId) : null;
      if (entryId && (!entry || !isSafeLibraryDataUrl(entry.dataUrl))) {
        entry = await fetchLibraryEntryById(entryId);
      }
      if (entry && isSafeLibraryDataUrl(entry.dataUrl)) {
        const blockId = newPreviewBlockId();
        const w = Number(entry.width) || WEBSITE_PREVIEW_IMAGE_WIDTH;
        stack.appendChild(createPreviewZoneElement(blockId, entry.hostname || host, w, false));
        wirePreviewBlock(
          blockId,
          entry.dataUrl,
          entry.url || it.url || '',
          entry.hostname || host,
          entry.fileName || `${host}-preview.png`
        );
      } else {
        stack.appendChild(createPreviewMessageZone(
          host,
          'Preview is opgeslagen, maar kon niet direct worden geladen. Open hem via Bibliotheek.'
        ));
      }
    }
  }
  const last = stack.lastElementChild;
  if (last && job.status === 'running') {
    last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function resumeWebsitePreviewBatchIfAny() {
  const path = String(window.location.pathname || '');
  if (path.indexOf('premium-websitegenerator') === -1) return;
  const out = document.getElementById('scan-output');
  if (!out) return;

  let jobId = getStoredWebsitePreviewBatchJobId();
  let hasResumed = false;

  if (jobId) {
    try {
      const response = await fetch(`/api/website-preview/batch/${encodeURIComponent(jobId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload?.job?.id) {
          hasResumed = true;
        } else if (response.status === 404) {
          clearStoredWebsitePreviewBatchJobId();
          jobId = '';
        }
      } else if (response.status === 404 || response.status === 403) {
        clearStoredWebsitePreviewBatchJobId();
        jobId = '';
      }
    } catch (_) {
      hasResumed = false;
    }
  }

  if (!jobId || !hasResumed) {
    try {
      const response = await fetch('/api/website-preview/batch/current', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.job?.id) {
        jobId = String(payload.job.id);
        setStoredWebsitePreviewBatchJobId(jobId);
      } else {
        clearStoredWebsitePreviewBatchJobId();
        jobId = '';
      }
    } catch (_) {}
  }

  if (!hasResumed && !jobId) return;
  mountScanBatchShell(out, 'Preview hervatten…');
  scheduleWebsitePreviewBatchPoll();
}

async function startScan() {
  if (!(await ensureWebsiteGeneratorAuth('Log eerst in om AI previews te genereren.'))) return;
  const raw = document.getElementById('scan-url').value;
  const tokens = tokenizeScanUrlInput(raw);
  if (!tokens.length) {
    showToast('Voer minimaal één URL in');
    return;
  }
  if (tokens.length > SCAN_URL_BATCH_MAX) {
    showToast('Gebruik één URL per keer.');
    return;
  }
  const slice = tokens.slice(0, SCAN_URL_BATCH_MAX);
  const urls = buildScanUrlList(slice);
  if (!urls.length) {
    showToast('Geen geldige URL’s.');
    return;
  }

  const btn = document.getElementById('scan-btn');
  btn.disabled = true;
  clearWebsitePreviewBatchPoll();

  try {
    await startBackgroundBatchScan(urls);
  } catch (e) {
    showToast(String(e?.message || e || 'Batch mislukt'));
    const out = document.getElementById('scan-output');
    if (out) {
      renderScanOutputMessage(out, String(e?.message || e || 'Batch mislukt'));
    }
    clearStoredWebsitePreviewBatchJobId();
  } finally {
    btn.disabled = false;
    applyWebsiteGeneratorAuthState();
  }
}

function bindWebsiteGeneratorPageActions() {
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    if (button.dataset.websitegeneratorTabBound === '1') return;
    button.dataset.websitegeneratorTabBound = '1';
    button.addEventListener('click', () => {
      void switchTab(button.dataset.tab || 'scan', button);
    });
  });

  const scanButton = document.querySelector('[data-websitegenerator-action="scan"]');
  if (scanButton && scanButton.dataset.websitegeneratorScanBound !== '1') {
    scanButton.dataset.websitegeneratorScanBound = '1';
    scanButton.addEventListener('click', () => {
      void startScan();
    });
  }
}

function samplePreviewEdgeReference(pixels, width, height, side) {
  const stripWidth = Math.max(4, Math.round(width * 0.01));
  const startX = side === 'right' ? Math.max(0, width - stripWidth) : 0;
  const endX = side === 'right' ? width : Math.min(width, stripWidth);
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalA = 0;
  let count = 0;

  for (let x = startX; x < endX; x += 1) {
    for (let y = 0; y < height; y += 3) {
      const offset = (y * width + x) * 4;
      const alpha = Number(pixels[offset + 3]);
      if (alpha <= 10) continue;
      totalR += Number(pixels[offset]);
      totalG += Number(pixels[offset + 1]);
      totalB += Number(pixels[offset + 2]);
      totalA += alpha;
      count += 1;
    }
  }

  if (!count) return null;
  return {
    r: totalR / count,
    g: totalG / count,
    b: totalB / count,
    a: totalA / count,
  };
}

function isPreviewPixelCloseToReference(r, g, b, a, reference) {
  if (!reference) return false;
  if (Number(a) <= 10) return false;
  const diffR = Math.abs(Number(r) - reference.r);
  const diffG = Math.abs(Number(g) - reference.g);
  const diffB = Math.abs(Number(b) - reference.b);
  const totalDiff = diffR + diffG + diffB;
  const maxDiff = Math.max(diffR, diffG, diffB);
  return totalDiff <= 66 && maxDiff <= 28;
}

function getPreviewColumnActivity(pixels, width, height, x) {
  if (x < 0 || x >= width) return 0;
  let totalDiff = 0;
  let count = 0;
  for (let y = 3; y < height; y += 3) {
    const offset = (y * width + x) * 4;
    const topOffset = ((y - 3) * width + x) * 4;

    totalDiff +=
      Math.abs(Number(pixels[offset]) - Number(pixels[topOffset])) +
      Math.abs(Number(pixels[offset + 1]) - Number(pixels[topOffset + 1])) +
      Math.abs(Number(pixels[offset + 2]) - Number(pixels[topOffset + 2]));
    count += 3;

    if (x > 0) {
      const leftOffset = (y * width + (x - 1)) * 4;
      totalDiff +=
        Math.abs(Number(pixels[offset]) - Number(pixels[leftOffset])) +
        Math.abs(Number(pixels[offset + 1]) - Number(pixels[leftOffset + 1])) +
        Math.abs(Number(pixels[offset + 2]) - Number(pixels[leftOffset + 2]));
      count += 3;
    }
  }
  return count ? totalDiff / count : 0;
}

function getPreviewReferenceMatchRatio(pixels, width, height, x, reference) {
  if (!reference || x < 0 || x >= width) return 0;
  let matches = 0;
  let total = 0;

  for (let y = 0; y < height; y += 3) {
    const offset = (y * width + x) * 4;
    const alpha = Number(pixels[offset + 3]);
    if (alpha <= 10) continue;
    total += 1;
    if (
      isPreviewPixelCloseToReference(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
        reference
      )
    ) {
      matches += 1;
    }
  }

  return total ? matches / total : 0;
}

function measurePreviewRightGutterWidth(pixels, width, height, reference) {
  if (!reference) return 0;

  const maxCropWidth = Math.max(120, Math.round(width * 0.34));
  let gutterWidth = 0;

  while (gutterWidth < maxCropWidth) {
    const x = width - 1 - gutterWidth;
    if (x < 0 || x >= width) break;

    const matchRatio = getPreviewReferenceMatchRatio(pixels, width, height, x, reference);
    const activity = getPreviewColumnActivity(pixels, width, height, x);
    if (matchRatio < 0.78 || activity > 13) break;

    gutterWidth += 1;
  }

  if (gutterWidth < 70) return 0;

  let breakSignals = 0;
  const confirmDepth = 18;
  for (let i = 0; i < confirmDepth; i += 1) {
    const x = width - gutterWidth - 1 - i;
    if (x < 0 || x >= width) break;

    const matchRatio = getPreviewReferenceMatchRatio(pixels, width, height, x, reference);
    const activity = getPreviewColumnActivity(pixels, width, height, x);
    if (matchRatio < 0.66 || activity > 17) {
      breakSignals += 1;
    }
  }

  return breakSignals >= 6 ? gutterWidth : 0;
}

function loadPreviewImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Previewafbeelding kon niet worden geladen.'));
    image.src = dataUrl;
  });
}

const WEBSITE_PREVIEW_IMAGE_WIDTH = 1024;
const WEBSITE_PREVIEW_IMAGE_HEIGHT = 1536;

async function cropPreviewImageDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  if (!raw.startsWith('data:image/')) {
    return {
      dataUrl: raw,
      width: WEBSITE_PREVIEW_IMAGE_WIDTH,
      height: WEBSITE_PREVIEW_IMAGE_HEIGHT,
    };
  }

  const image = await loadPreviewImage(raw);
  const width = Number(image.naturalWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.height || 0);
  if (!width || !height) {
    return {
      dataUrl: raw,
      width: WEBSITE_PREVIEW_IMAGE_WIDTH,
      height: WEBSITE_PREVIEW_IMAGE_HEIGHT,
    };
  }
  if (height > width) {
    return { dataUrl: raw, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return { dataUrl: raw, width, height };
  }

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const rightReference = samplePreviewEdgeReference(pixels, width, height, 'right');
  const rightCrop = measurePreviewRightGutterWidth(pixels, width, height, rightReference);
  const croppedWidth = width - rightCrop;
  if (croppedWidth <= Math.round(width * 0.55)) {
    return { dataUrl: raw, width, height };
  }
  if (rightCrop < 70) {
    return { dataUrl: raw, width, height };
  }

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = croppedWidth;
  croppedCanvas.height = height;
  const croppedContext = croppedCanvas.getContext('2d');
  if (!croppedContext) {
    return { dataUrl: raw, width, height };
  }

  croppedContext.drawImage(
    canvas,
    0,
    0,
    croppedWidth,
    height,
    0,
    0,
    croppedWidth,
    height
  );

  return {
    dataUrl: croppedCanvas.toDataURL('image/png'),
    width: croppedWidth,
    height,
  };
}

function downloadPreview() {
  if (!window._lastPreviewImageDataUrl) return;
  const a = document.createElement('a');
  a.href = window._lastPreviewImageDataUrl;
  a.download = window._lastPreviewImageFileName || 'website-preview.png';
  a.click();
  showToast('Preview gedownload');
}

function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg;
  t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800);
}

applyWebsiteGeneratorAuthState();
loadWebsiteGeneratorAuthState();

(function () {
  const urlInput = document.getElementById('scan-url');
  const htmlInput = document.getElementById('html-code');
  const websiteLinkCreateEl = document.getElementById('website-link-create-btn');
  const websiteLinkStatusEl = document.getElementById('website-link-status');
  const websiteLinkCopyEl = document.getElementById('website-link-copy');
  const websiteLinkListEl = document.getElementById('website-link-list');
  if (!urlInput || !htmlInput || !websiteLinkCreateEl || !websiteLinkStatusEl || !websiteLinkCopyEl || !websiteLinkListEl) { return; }

  let latestWebsiteLinkUrl = '';

  function setWebsiteLinkStatus(message, isError = false) {
    websiteLinkStatusEl.textContent = String(message || '');
    websiteLinkStatusEl.style.color = isError ? '#c0392b' : 'var(--text-mid)';
  }

  function normalizeWebsiteLinkHref(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function renderWebsiteLinkEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '22px';
    appendWebsiteGeneratorTextElement(empty, 'p', '', message);
    websiteLinkListEl.replaceChildren(empty);
  }

  function createWebsiteLinkRow(link) {
    const title = String(link?.title || link?.slug || 'Softora pagina').trim() || 'Softora pagina';
    const urlLabel = String(link?.url || '').trim() || '—';
    const href = normalizeWebsiteLinkHref(urlLabel);

    const row = document.createElement('div');
    row.className = 'website-link-row';

    const main = document.createElement('div');
    main.className = 'website-link-row-main';
    const titleEl = appendWebsiteGeneratorTextElement(main, 'div', 'website-link-row-title', title);
    titleEl.title = title;

    if (href) {
      const urlLink = appendWebsiteGeneratorTextElement(main, 'a', 'website-link-row-url', urlLabel);
      urlLink.href = href;
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
    } else {
      appendWebsiteGeneratorTextElement(main, 'span', 'website-link-row-url', urlLabel);
    }

    const actions = document.createElement('div');
    actions.className = 'website-link-row-actions';
    if (href) {
      const liveLink = appendWebsiteGeneratorTextElement(actions, 'a', 'btn outline', 'Live pagina');
      liveLink.href = href;
      liveLink.target = '_blank';
      liveLink.rel = 'noopener noreferrer';
    } else {
      const unavailable = appendWebsiteGeneratorTextElement(actions, 'span', 'btn outline', 'Geen live URL');
      unavailable.setAttribute('aria-disabled', 'true');
    }

    row.append(main, actions);
    return row;
  }

  function renderWebsiteLinks(links) {
    const normalizedLinks = Array.isArray(links) ? links : [];
    if (!websiteGeneratorAuthState.authenticated) {
      renderWebsiteLinkEmptyState('Log in om opgeslagen websitelinks te bekijken.');
      return;
    }
    if (!normalizedLinks.length) {
      renderWebsiteLinkEmptyState('Nog geen websitelinks. Plak HTML-code en maak je eerste live pagina aan.');
      return;
    }
    websiteLinkListEl.replaceChildren(...normalizedLinks.map((link) => createWebsiteLinkRow(link)));
  }

  async function loadWebsiteLinks() {
    if (!websiteGeneratorAuthState.authenticated) {
      renderWebsiteLinks([]);
      return;
    }
    renderWebsiteLinkEmptyState('Websitelinks laden...');
    try {
      const response = await fetch('/api/website-links', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(String(payload?.detail || payload?.error || 'Websitelinks laden mislukt'));
      }
      renderWebsiteLinks(payload.links || []);
    } catch (error) {
      renderWebsiteLinkEmptyState(String(error?.message || 'Websitelinks laden mislukt'));
    }
  }

  websiteLinkCopyEl.addEventListener('click', async function () {
    if (!latestWebsiteLinkUrl) return;
    try {
      await navigator.clipboard.writeText(latestWebsiteLinkUrl);
      showToast('Websitelink gekopieerd');
    } catch (_) {
      showToast('Kopieren mislukt');
    }
  });

  websiteLinkCreateEl.addEventListener('click', async function () {
    const openedTab = window.open('about:blank', '_blank');
    if (openedTab) {
      openedTab.document.title = 'Websitelink wordt aangemaakt...';
      const loadingBody = openedTab.document.body || openedTab.document.createElement('body');
      if (!openedTab.document.body) {
        openedTab.document.documentElement.appendChild(loadingBody);
      }
      loadingBody.style.fontFamily = 'system-ui,sans-serif';
      loadingBody.style.padding = '32px';
      loadingBody.textContent = 'Websitelink wordt aangemaakt...';
      openedTab.opener = null;
    }
    if (!(await ensureWebsiteGeneratorAuth('Log eerst in om websitelinks aan te maken.'))) {
      if (openedTab && !openedTab.closed) openedTab.close();
      return;
    }
    const html = String(htmlInput.value || '').trim();
    if (!html) {
      setWebsiteLinkStatus('Plak eerst HTML code in.', true);
      htmlInput.focus();
      if (openedTab && !openedTab.closed) openedTab.close();
      return;
    }

    websiteLinkCreateEl.disabled = true;
    websiteLinkCopyEl.hidden = true;
    latestWebsiteLinkUrl = '';
    setWebsiteLinkStatus('Websitelink wordt aangemaakt...');

    try {
      const response = await fetch('/api/website-links/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          title: String(urlInput.value || '').trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await loadWebsiteGeneratorAuthState(true);
        throw new Error('Log eerst in om websitelinks aan te maken.');
      }
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(String(payload?.detail || payload?.error || 'Websitelink aanmaken mislukt'));
      }
      latestWebsiteLinkUrl = String(payload.url || '').trim();
      websiteLinkCopyEl.hidden = !latestWebsiteLinkUrl;
      setWebsiteLinkStatus(latestWebsiteLinkUrl || 'Websitelink aangemaakt.');
      if (latestWebsiteLinkUrl) {
        if (openedTab && !openedTab.closed) {
          openedTab.location.href = latestWebsiteLinkUrl;
        } else {
          window.open(latestWebsiteLinkUrl, '_blank', 'noopener');
        }
      }
      await loadWebsiteLinks();
    } catch (error) {
      if (openedTab && !openedTab.closed) openedTab.close();
      setWebsiteLinkStatus(String(error?.message || 'Websitelink aanmaken mislukt'), true);
    } finally {
      applyWebsiteGeneratorAuthState();
    }
  });

  void loadWebsiteGeneratorAuthState().then(() => loadWebsiteLinks());
})();

bindWebsiteGeneratorPageActions();

(function initWebsiteGeneratorLibraryHash() {
  function applyLibraryHash() {
    const raw = String(window.location.hash || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (raw !== "bibliotheek" && raw !== "library") return;
    const libBtn = document.querySelector('.tab[data-tab="library"]');
    void (async () => {
      if (libBtn) await switchTab("library", libBtn);
      else if (typeof renderLibraryPanel === "function") renderLibraryPanel();
    })();
  }
  window.addEventListener("hashchange", applyLibraryHash);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLibraryHash);
  } else {
    applyLibraryHash();
  }
})();
