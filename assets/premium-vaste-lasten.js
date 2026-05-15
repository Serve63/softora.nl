let data = {
  'Totale kosten:': [
    { id:1, naam:'Coldcalling', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0.00, status:'active', highlighted:true },
    { id:2, naam:'Coldmailing', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0.00, status:'active', highlighted:true },
    { id:3, naam:'API kosten', note:'Variabele maandkosten', freq:'maandelijks', bedrag:0.00, status:'active', highlighted:true },
  ],
};
const MONTHLY_COSTS_REMOTE_SCOPE = 'premium_monthly_costs';
const MONTHLY_COSTS_REMOTE_KEY = 'monthly_cost_entries_v1';
const DEFAULT_MONTHLY_COSTS_CATEGORY = 'Totale kosten:';
const DEFAULT_MONTHLY_COSTS_HIGHLIGHTED_ITEMS = (data[DEFAULT_MONTHLY_COSTS_CATEGORY] || [])
  .filter((item) => item.highlighted)
  .map((item) => ({ ...item }));
let nextId = 4;
let editingContext = null;
let deletingContext = null;
let monthlyCostsLoaded = false;
let monthlyCostsLoadPromise = null;
let monthlyCostsBootstrapDone = false;
let monthlyCostsBootstrapPromise = null;
const MONTHLY_COSTS_BOOT_MIN_VISIBLE_MS = 1000;
let monthlyCostsBootVisibleSince = Date.now();
let monthlyCostsBootHideTimer = null;

const freqLabel = { maandelijks:'Maandelijks', jaarlijks:'Jaarlijks', kwartaal:'Per kwartaal' };

function normalizeString(value) {
  return String(value ?? '').trim();
}

function cloneCostItem(item) {
  return { ...(item || {}) };
}

function cloneDataState() {
  const snapshot = {};
  Object.entries(data).forEach(([cat, items]) => {
    snapshot[cat] = Array.isArray(items) ? items.map(cloneCostItem) : [];
  });
  return snapshot;
}

function replaceDataState(snapshot) {
  Object.keys(data).forEach((key) => {
    delete data[key];
  });
  Object.entries(snapshot || {}).forEach(([cat, items]) => {
    data[cat] = Array.isArray(items) ? items.map(cloneCostItem) : [];
  });
  syncNextId();
}

function syncNextId() {
  nextId = Object.values(data)
    .flat()
    .reduce((maxId, item) => Math.max(maxId, Number(item && item.id) || 0), 0) + 1;
}

function getEditableCostItems(cat = DEFAULT_MONTHLY_COSTS_CATEGORY) {
  return Array.isArray(data[cat]) ? data[cat].filter((item) => !item.highlighted).map(cloneCostItem) : [];
}

function getHighlightedCostItems(cat = DEFAULT_MONTHLY_COSTS_CATEGORY) {
  const highlightedItems = Array.isArray(data[cat])
    ? data[cat].filter((item) => item.highlighted).map(cloneCostItem)
    : [];
  return highlightedItems.length
    ? highlightedItems
    : DEFAULT_MONTHLY_COSTS_HIGHLIGHTED_ITEMS.map(cloneCostItem);
}

function sanitizeStoredCostItem(item, index) {
  const naam = normalizeString(item && item.naam).slice(0, 120);
  if (!naam) return null;

  const rawId = Math.round(Number(item && item.id));
  const freq = freqLabel[item && item.freq]
    ? item.freq
    : 'maandelijks';
  const amountRaw = Number(item && item.bedrag);
  const bedrag = Math.round(
    (
      (Number.isFinite(amountRaw) && amountRaw >= 0 ? amountRaw : 0) * 100
    )
  ) / 100;

  return {
    id: Math.max(1, Number.isFinite(rawId) && rawId > 0 ? rawId : index + 1),
    naam,
    note: normalizeString(item && item.note).slice(0, 200),
    freq,
    bedrag,
    status: normalizeString(item && item.status) || 'active',
  };
}

function sanitizeStoredCostItems(rawEntries) {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  if (rawEntries.length === 0) {
    return [];
  }

  const takenIds = new Set(
    getHighlightedCostItems(DEFAULT_MONTHLY_COSTS_CATEGORY)
      .map((item) => Math.round(Number(item && item.id)))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const sanitized = [];

  rawEntries.forEach((item, index) => {
    const normalizedItem = sanitizeStoredCostItem(item, index);
    if (!normalizedItem) return;

    let safeId = Math.max(1, Math.round(Number(normalizedItem.id) || 0));
    while (takenIds.has(safeId)) {
      safeId += 1;
    }
    takenIds.add(safeId);
    sanitized.push({
      ...normalizedItem,
      id: safeId,
    });
  });

  return sanitized;
}

function applyStoredMonthlyCostItems(rawEntries) {
  data[DEFAULT_MONTHLY_COSTS_CATEGORY] = getHighlightedCostItems(DEFAULT_MONTHLY_COSTS_CATEGORY)
    .concat(sanitizeStoredCostItems(rawEntries));
  syncNextId();
}

function catKey(cat) {
  return String(cat).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveCategoryName(categoryKey) {
  return Object.keys(data).find((name) => catKey(name) === String(categoryKey || '')) || '';
}

function getCostItem(cat, id) {
  return data[cat]?.find((item) => item.id === id) || null;
}

function toMonthly(item) {
  if (item.freq === 'jaarlijks') return item.bedrag;
  if (item.freq === 'kwartaal') return item.bedrag / 3;
  return item.bedrag;
}

function fmtEur(n) {
  return '€' + n.toLocaleString('nl-NL', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function setTotalsLoading() {
  document.getElementById('totaal-maand').textContent = '...';
  document.getElementById('totaal-jaar').textContent = '...';
  document.getElementById('totaal-posten').textContent = '...';
}

function setMonthlyCostsStageBooting(isBooting) {
  const shell = document.getElementById('monthly-costs-boot-shell');
  const loader = document.getElementById('monthly-costs-boot-loader');
  if (monthlyCostsBootHideTimer) {
    window.clearTimeout(monthlyCostsBootHideTimer);
    monthlyCostsBootHideTimer = null;
  }
  if (isBooting) {
    monthlyCostsBootVisibleSince = Date.now();
  } else {
    const elapsed = Date.now() - monthlyCostsBootVisibleSince;
    const remaining = Math.max(0, MONTHLY_COSTS_BOOT_MIN_VISIBLE_MS - elapsed);
    if (remaining > 0) {
      monthlyCostsBootHideTimer = window.setTimeout(() => {
        monthlyCostsBootHideTimer = null;
        setMonthlyCostsStageBooting(false);
      }, remaining);
      return;
    }
  }
  if (shell) {
    shell.classList.toggle('is-booting', Boolean(isBooting));
    shell.setAttribute('aria-busy', isBooting ? 'true' : 'false');
  }
  if (loader) {
    loader.classList.toggle('is-hidden', !isBooting);
  }
}

function appendCostTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function createCostSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
  return element;
}

function createCostActionIcon(kind) {
  const svg = createCostSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
  });
  if (kind === 'delete') {
    svg.append(
      createCostSvgElement('polyline', { points: '3 6 5 6 21 6' }),
      createCostSvgElement('path', { d: 'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2' })
    );
    return svg;
  }
  svg.append(
    createCostSvgElement('path', { d: 'M12 20h9' }),
    createCostSvgElement('path', { d: 'M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z' })
  );
  return svg;
}

function createCostActionButton(action, key, itemId, className, title) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.catKey = key;
  if (itemId) button.dataset.itemId = String(itemId);
  button.title = title;
  button.appendChild(createCostActionIcon(action));
  return button;
}

function createCostFrequencySelect(id) {
  const select = document.createElement('select');
  select.id = id;
  Object.entries(freqLabel).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  return select;
}

function createMonthlyCostInput(type, placeholder, id) {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.id = id;
  if (type === 'number') {
    input.step = '0.01';
    input.min = '0';
  }
  return input;
}

function createCategoryHeader(cat, catTotal) {
  const header = document.createElement('div');
  header.className = 'category-header';
  appendCostTextElement(header, 'div', 'category-title', cat);
  const total = appendCostTextElement(header, 'div', 'category-total', fmtEur(catTotal));
  const suffix = appendCostTextElement(total, 'span', '', '/mnd');
  suffix.style.fontSize = '11px';
  suffix.style.fontWeight = '400';
  suffix.style.color = 'var(--text-light)';
  suffix.style.marginLeft = '4px';
  return header;
}

function createCostRowsHead() {
  const row = document.createElement('div');
  row.className = 'cost-row head';
  appendCostTextElement(row, 'span', '', 'Post');
  appendCostTextElement(row, 'span', '', 'Frequentie');
  const amountLabel = appendCostTextElement(row, 'span', '', 'Bedrag');
  amountLabel.style.textAlign = 'right';
  return row;
}

function createLoadingCostRow() {
  const row = document.createElement('div');
  row.className = 'cost-row';
  const content = document.createElement('div');
  appendCostTextElement(content, 'div', 'cost-name', 'Kosten laden...');
  appendCostTextElement(
    content,
    'div',
    'cost-note',
    'Je opgeslagen databasegegevens en actuele verbruikskosten worden opgehaald'
  );
  row.appendChild(content);
  appendCostTextElement(row, 'div', 'cost-freq', '...');
  const amountWrap = document.createElement('div');
  amountWrap.className = 'cost-amount-wrap is-static';
  appendCostTextElement(amountWrap, 'div', 'cost-amount', '...');
  row.appendChild(amountWrap);
  return row;
}

function createCostItemRow(item, key) {
  const row = document.createElement('div');
  row.className = item.highlighted ? 'cost-row cost-row-accent' : 'cost-row';
  row.id = `item-${item.id}`;

  const content = document.createElement('div');
  appendCostTextElement(content, 'div', 'cost-name', item.naam);
  appendCostTextElement(content, 'div', 'cost-note', item.note || '');
  row.appendChild(content);

  const displayFreqLabel = item.highlighted && item.freq === 'maandelijks'
    ? 'Deze maand'
    : freqLabel[item.freq] || item.freq || '-';
  appendCostTextElement(row, 'div', 'cost-freq', displayFreqLabel);

  const amountWrap = document.createElement('div');
  amountWrap.className = item.highlighted ? 'cost-amount-wrap is-static' : 'cost-amount-wrap';
  appendCostTextElement(amountWrap, 'div', 'cost-amount', fmtEur(item.bedrag));

  if (!item.highlighted) {
    const rowActions = document.createElement('div');
    rowActions.className = 'row-actions';
    rowActions.append(
      createCostActionButton('edit', key, item.id, 'btn-edit', 'Bewerken'),
      createCostActionButton('delete', key, item.id, 'btn-del', 'Verwijderen')
    );
    amountWrap.appendChild(rowActions);
  }

  row.appendChild(amountWrap);
  return row;
}

function createAddCostRow(key) {
  const row = document.createElement('div');
  row.className = 'add-row';
  const inputs = document.createElement('div');
  inputs.className = 'add-inputs';
  inputs.append(
    createMonthlyCostInput('text', 'Naam', `new-naam-${key}`),
    createCostFrequencySelect(`new-freq-${key}`),
    createMonthlyCostInput('number', 'Bedrag', `new-bedrag-${key}`)
  );
  row.appendChild(inputs);
  const button = document.createElement('button');
  button.className = 'btn-add';
  button.type = 'button';
  button.dataset.action = 'add';
  button.dataset.catKey = key;
  button.textContent = '+ Toevoegen';
  row.appendChild(button);
  return row;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchUiStateGetWithFallback(scope) {
  const encodedScope = encodeURIComponent(String(scope || ''));
  const urls = [`/api/ui-state-get?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          cache: 'no-store',
        },
        12000
      );
      if (!response.ok) {
        throw new Error(`UI state GET mislukt (${response.status})`);
      }
      return await response.json().catch(() => ({}));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('UI state GET mislukt');
}

async function fetchUiStateSetWithFallback(scope, body) {
  const encodedScope = encodeURIComponent(String(scope || ''));
  const urls = [`/api/ui-state-set?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body || {}),
        },
        12000
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(normalizeString(result && result.error) || `UI state POST mislukt (${response.status})`);
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('UI state POST mislukt');
}

async function persistMonthlyCostEntries(actor = 'browser') {
  const editableItems = getEditableCostItems(DEFAULT_MONTHLY_COSTS_CATEGORY).map((item) => ({
    ...item,
    highlighted: false,
  }));
  const result = await fetchUiStateSetWithFallback(MONTHLY_COSTS_REMOTE_SCOPE, {
    patch: {
      [MONTHLY_COSTS_REMOTE_KEY]: JSON.stringify(editableItems),
      updated_at: new Date().toISOString(),
      updated_by: normalizeString(actor || 'browser'),
    },
    source: 'premium-vaste-lasten',
    actor: normalizeString(actor || 'browser'),
  });
  if (normalizeString(result && result.source) !== 'supabase') {
    throw new Error('Terugkerende kosten zijn nog niet bevestigd in de database.');
  }
  return result;
}

async function ensureMonthlyCostEntriesLoaded() {
  if (monthlyCostsLoaded) return data[DEFAULT_MONTHLY_COSTS_CATEGORY] || [];
  if (monthlyCostsLoadPromise) return monthlyCostsLoadPromise;

  monthlyCostsLoadPromise = (async () => {
    try {
      const result = await fetchUiStateGetWithFallback(MONTHLY_COSTS_REMOTE_SCOPE);
      const serializedEntries = normalizeString(
        result && result.values && result.values[MONTHLY_COSTS_REMOTE_KEY]
      );

      if (serializedEntries) {
        let remoteEntries = null;
        try {
          const parsedEntries = JSON.parse(serializedEntries);
          if (Array.isArray(parsedEntries)) {
            remoteEntries = parsedEntries;
          }
        } catch (_) {
          remoteEntries = null;
        }

        if (remoteEntries) {
          applyStoredMonthlyCostItems(remoteEntries);
          render();
        }
      }

      monthlyCostsLoaded = true;
      return data[DEFAULT_MONTHLY_COSTS_CATEGORY] || [];
    } catch (error) {
      console.error('Terugkerende kosten laden via Supabase mislukt:', error);
      monthlyCostsLoaded = true;
      return data[DEFAULT_MONTHLY_COSTS_CATEGORY] || [];
    } finally {
      monthlyCostsLoadPromise = null;
    }
  })();

  return monthlyCostsLoadPromise;
}

function updateTotals() {
  if (!monthlyCostsBootstrapDone) {
    setTotalsLoading();
    return;
  }
  let total = 0;
  let count = 0;
  Object.values(data).flat().forEach((item) => {
    total += toMonthly(item);
    count++;
  });
  document.getElementById('totaal-maand').textContent = fmtEur(total);
  document.getElementById('totaal-jaar').textContent = fmtEur(total * 12);
  document.getElementById('totaal-posten').textContent = count;
}

function render() {
  const wrap = document.getElementById('categories-wrap');
  wrap.replaceChildren();

  Object.entries(data).forEach(([cat, items]) => {
    const visibleItems = monthlyCostsBootstrapDone ? items : [];
    const catTotal = visibleItems.reduce((s, i) => s + toMonthly(i), 0);
    const key = catKey(cat);
    const block = document.createElement('div');
    block.className = 'category';
    if (cat !== 'Totale kosten:') {
      block.appendChild(createCategoryHeader(cat, catTotal));
    }
    block.appendChild(createCostRowsHead());

    const rows = document.createElement('div');
    rows.id = `rows-${key}`;
    if (!monthlyCostsBootstrapDone) {
      rows.appendChild(createLoadingCostRow());
    } else {
      visibleItems.forEach((item) => {
        rows.appendChild(createCostItemRow(item, key));
      });
    }
    block.appendChild(rows);

    if (monthlyCostsBootstrapDone) {
      block.appendChild(createAddCostRow(key));
    }
    wrap.appendChild(block);
  });

  updateTotals();
}

async function bootstrapMonthlyCostsPage() {
  if (monthlyCostsBootstrapPromise) return monthlyCostsBootstrapPromise;

  monthlyCostsBootstrapPromise = (async () => {
    try {
      setMonthlyCostsStageBooting(true);
      setTotalsLoading();
      render();
      await ensureMonthlyCostEntriesLoaded();
      if (typeof window.refreshMonthlyColdcallingCosts === 'function') {
        await window.refreshMonthlyColdcallingCosts();
      }
      monthlyCostsBootstrapDone = true;
      render();
      return true;
    } catch (error) {
      console.error('Terugkerende kosten bootstrap mislukt:', error);
      monthlyCostsBootstrapDone = true;
      render();
      return false;
    } finally {
      setMonthlyCostsStageBooting(false);
    }
  })();

  return monthlyCostsBootstrapPromise;
}

function addItem(cat) {
  const key = catKey(cat);
  const naam = document.getElementById(`new-naam-${key}`).value.trim();
  const freq = document.getElementById(`new-freq-${key}`).value;
  const bedrag = parseFloat(document.getElementById(`new-bedrag-${key}`).value);
  if (!naam || isNaN(bedrag) || bedrag <= 0) return showToast('Vul naam en bedrag in');
  const snapshot = cloneDataState();
  data[cat].push({ id: nextId++, naam, note: '', freq, bedrag: Math.round(bedrag * 100) / 100, status: 'active' });
  render();
  return persistMonthlyCostEntries('browser_add')
    .then(() => {
      showToast('✓ ' + naam + ' toegevoegd');
    })
    .catch((error) => {
      replaceDataState(snapshot);
      render();
      showToast(normalizeString(error && error.message) || 'Opslaan mislukt; wijziging is teruggedraaid');
    });
}

function deleteItem(cat, id) {
  const item = getCostItem(cat, id);
  if (!item) return;
  deletingContext = { cat, id };
  const overlay = document.getElementById('delete-modal-overlay');
  document.getElementById('delete-modal-text').textContent =
    `Weet je zeker dat je "${item.naam}" wilt verwijderen?`;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.getElementById('delete-modal-confirm').focus();
}

function closeDeleteModal() {
  deletingContext = null;
  const overlay = document.getElementById('delete-modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function confirmDeleteModal() {
  if (!deletingContext) return;
  const { cat, id } = deletingContext;
  const item = getCostItem(cat, id);
  if (!item) return closeDeleteModal();
  const snapshot = cloneDataState();
  data[cat] = data[cat].filter((i) => i.id !== id);
  closeDeleteModal();
  render();
  try {
    await persistMonthlyCostEntries('browser_delete');
    showToast('✓ Post verwijderd');
  } catch (error) {
    replaceDataState(snapshot);
    render();
    showToast(normalizeString(error && error.message) || 'Opslaan mislukt; wijziging is teruggedraaid');
  }
}

function editItem(cat, id) {
  const item = getCostItem(cat, id);
  if (!item) return;
  editingContext = { cat, id };
  document.getElementById('edit-naam').value = item.naam || '';
  document.getElementById('edit-note').value = item.note || '';
  document.getElementById('edit-freq').value = item.freq || 'maandelijks';
  document.getElementById('edit-bedrag').value = String(item.bedrag ?? '');
  const overlay = document.getElementById('edit-modal-overlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.getElementById('edit-naam').focus();
}

function closeEditModal() {
  editingContext = null;
  const overlay = document.getElementById('edit-modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function saveEditModal() {
  if (!editingContext) return;
  const { cat, id } = editingContext;
  const item = getCostItem(cat, id);
  if (!item) return closeEditModal();

  const nieuweNaam = document.getElementById('edit-naam').value.trim();
  const nieuweNote = document.getElementById('edit-note').value.trim();
  const nieuweFreq = document.getElementById('edit-freq').value;
  const nieuweBedrag = parseFloat(document.getElementById('edit-bedrag').value);

  if (!nieuweNaam) return showToast('Naam is verplicht');
  if (!freqLabel[nieuweFreq]) return showToast('Kies een geldige frequentie');
  if (!Number.isFinite(nieuweBedrag) || nieuweBedrag <= 0) return showToast('Vul een geldig bedrag in');

  const snapshot = cloneDataState();
  item.naam = nieuweNaam;
  item.note = nieuweNote;
  item.freq = nieuweFreq;
  item.bedrag = Math.round(nieuweBedrag * 100) / 100;
  closeEditModal();
  render();
  try {
    await persistMonthlyCostEntries('browser_edit');
    showToast('✓ Post bijgewerkt');
  } catch (error) {
    replaceDataState(snapshot);
    render();
    showToast(normalizeString(error && error.message) || 'Opslaan mislukt; wijziging is teruggedraaid');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

const now = new Date();
document.getElementById('last-updated').textContent =
  'Bijgewerkt: ' + now.toLocaleDateString('nl-NL', { day:'numeric', month:'long', year:'numeric' });

document.getElementById('edit-modal-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'edit-modal-overlay') closeEditModal();
});

document.getElementById('delete-modal-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'delete-modal-overlay') closeDeleteModal();
});

document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
document.getElementById('edit-modal-save').addEventListener('click', () => {
  void saveEditModal();
});
document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
document.getElementById('delete-modal-confirm').addEventListener('click', () => {
  void confirmDeleteModal();
});

document.getElementById('categories-wrap').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = String(button.dataset.action || '').trim();
  const cat = resolveCategoryName(button.dataset.catKey);
  const id = Number(button.dataset.itemId || 0) || 0;
  if (!cat) return;
  if (action === 'add') {
    void addItem(cat);
    return;
  }
  if (action === 'edit' && id > 0) {
    editItem(cat, id);
    return;
  }
  if (action === 'delete' && id > 0) {
    void deleteItem(cat, id);
  }
});

document.addEventListener('keydown', (event) => {
  const editOverlay = document.getElementById('edit-modal-overlay');
  const deleteOverlay = document.getElementById('delete-modal-overlay');
  if (event.key === 'Escape') {
    if (deleteOverlay.classList.contains('open')) closeDeleteModal();
    if (editOverlay.classList.contains('open')) closeEditModal();
    return;
  }
  if (event.key !== 'Enter') return;
  if (deleteOverlay.classList.contains('open')) {
    void confirmDeleteModal();
    return;
  }
  if (editOverlay.classList.contains('open')) {
    void saveEditModal();
  }
});

window.softoraMonthlyCostsData = data;
window.softoraMonthlyCostsRender = render;
window.softoraMonthlyCostsHelpers = {
  appendCostTextElement,
  createCostActionIcon,
  fetchUiStateGetWithFallback,
  fetchUiStateSetWithFallback,
  fmtEur,
  normalizeString,
  showToast,
};

syncNextId();
setMonthlyCostsStageBooting(true);
setTotalsLoading();
render();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrapMonthlyCostsPage();
  }, { once: true });
} else {
  void bootstrapMonthlyCostsPage();
}
