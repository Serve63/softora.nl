(function () {
function singleWebsitePreviewRequest(run, keyFor = () => '') {
  const pending = new Map();
  return (...args) => {
    const key = keyFor(...args);
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve().then(() => run(...args)).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

function mergeWebsitePreviewLibrary(incoming, current) {
  const cached = new Map((current || []).map((entry) => [entry.id, entry]));
  return incoming.map((entry) => ({ ...entry, dataUrl: entry.dataUrl || cached.get(entry.id)?.dataUrl || '' }));
}

function reconcileWebsitePreviewCards(grid, entries, createCard) {
  const existing = new Map(Array.from(grid.children, (card) => [card.dataset.libraryId, card]));
  const wanted = new Set(entries.map((entry) => String(entry.id)));
  for (const card of Array.from(grid.children)) {
    if (!wanted.has(card.dataset.libraryId)) card.remove();
  }
  entries.forEach((entry, index) => {
    const key = JSON.stringify([entry.hostname, entry.createdAt, entry.url]);
    let card = existing.get(String(entry.id));
    if (card && card.dataset.entryKey !== key) { card.remove(); card = null; }
    if (!card) { card = createCard(entry); card.dataset.entryKey = key; }
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
  });
}

function createWebsitePreviewNavigation({ window, document, loadLibrary, renderLibrary }) {
  let revision = 0;
  async function switchTab(name, el) {
    const ticket = ++revision;
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    const base = `${window.location.pathname}${window.location.search || ''}`;
    // Update the URL synchronously without a hashchange that starts another load.
    window.history.replaceState(null, '', base + (name === 'library' ? '#bibliotheek' : ''));
    window.SoftoraPersonnelTheme?.refreshPremiumStaticSidebarActiveState?.();
    if (name !== 'library') return;
    renderLibrary();
    await loadLibrary();
    if (ticket === revision) renderLibrary();
  }
  function init() {
    const applyHash = () => {
      const hash = String(window.location.hash || '').toLowerCase();
      void switchTab(hash === '#bibliotheek' || hash === '#library' ? 'library' : 'scan');
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();
  }
  function beginOpen() {
    const ticket = ++revision;
    return () => ticket === revision;
  }
  return { switchTab, init, beginOpen };
}

const websitePreviewUiState = { singleWebsitePreviewRequest, mergeWebsitePreviewLibrary, reconcileWebsitePreviewCards, createWebsitePreviewNavigation };
if (typeof module === 'object' && module.exports) module.exports = websitePreviewUiState;
if (typeof window !== 'undefined') window.SoftoraWebsitePreviewUiState = websitePreviewUiState;
})();
