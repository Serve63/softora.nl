(function (global) {
  'use strict';

  const MONTHLY_COSTS_REMOTE_SCOPE = 'premium_monthly_costs';
  const CUSTOMER_COST_COVERAGE_KEY = 'customer_cost_coverage_v1';
  const CUSTOMER_DB_SCOPE = 'premium_customers_database';
  const CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
  const frequencyLabel = { maandelijks: 'Maandelijks', jaarlijks: 'Jaarlijks' };
  const termLabel = { maandelijks_opzegbaar: 'Maandelijks opzegbaar', jaarlijks: 'Jaarlijks' };
  const helpers = global.softoraMonthlyCostsHelpers || {};

  let records = [];
  let customers = [];
  let loaded = false;
  let loadPromise = null;
  let searchQuery = '';
  let focusedFromUrl = false;

  function normalizeString(value) {
    return helpers.normalizeString ? helpers.normalizeString(value) : String(value ?? '').trim();
  }

  function appendText(parent, tagName, className, text) {
    if (helpers.appendCostTextElement) {
      return helpers.appendCostTextElement(parent, tagName, className, text);
    }
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function fmtEur(value) {
    return helpers.fmtEur
      ? helpers.fmtEur(value)
      : '€' + (Number(value) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function showToast(message) {
    if (helpers.showToast) helpers.showToast(message);
  }

  function normalizeSearchText(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function parseAmount(value) {
    const normalized = normalizeString(value).replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  }

  function normalizeFrequency(value) {
    return frequencyLabel[value] ? value : 'maandelijks';
  }

  function normalizeTerm(value) {
    return termLabel[value] ? value : 'maandelijks_opzegbaar';
  }

  function customerKey(id, name, company) {
    const cleanId = normalizeString(id);
    return cleanId ? `id:${cleanId}` : `name:${normalizeSearchText(`${name || ''}|${company || ''}`)}`;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeoutId = global.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      global.clearTimeout(timeoutId);
    }
  }

  async function getUiState(scope) {
    if (helpers.fetchUiStateGetWithFallback) return helpers.fetchUiStateGetWithFallback(scope);
    const encodedScope = encodeURIComponent(String(scope || ''));
    const response = await fetchWithTimeout(`/api/ui-state-get?scope=${encodedScope}`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error(`UI state GET mislukt (${response.status})`);
    return await response.json().catch(() => ({}));
  }

  async function setUiState(scope, body) {
    if (helpers.fetchUiStateSetWithFallback) return helpers.fetchUiStateSetWithFallback(scope, body);
    const encodedScope = encodeURIComponent(String(scope || ''));
    const response = await fetchWithTimeout(`/api/ui-state-set?scope=${encodedScope}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(normalizeString(result && result.error) || `UI state POST mislukt (${response.status})`);
    return result;
  }

  function parseJsonArray(raw) {
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function readCustomerRows(remoteState) {
    const values = remoteState && remoteState.values ? remoteState.values : {};
    const importTools = global.SoftoraDatabaseImport || {};
    const raw = typeof importTools.readChunkedStateValue === 'function'
      ? importTools.readChunkedStateValue(values, CUSTOMER_DB_KEY)
      : normalizeString(values && values[CUSTOMER_DB_KEY]);
    return parseJsonArray(raw);
  }

  function normalizeCustomer(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = normalizeString(raw.naam || raw.name || raw.customerName || raw.contactName);
    const company = normalizeString(raw.bedrijf || raw.company || raw.businessName || raw.website);
    const displayName = name || company;
    if (!displayName) return null;
    const id = normalizeString(raw.id || raw.customerId || raw.rowId);
    return {
      customerId: id,
      customerKey: customerKey(id, displayName, company),
      customerName: displayName,
      company,
      revenueAmount: parseAmount(raw.onderhoudPerMaand ?? raw.recurringRevenue ?? raw.monthlyRevenue ?? raw.revenueAmount),
      websiteAmount: parseAmount(raw.websiteBedrag ?? raw.bedrag),
      marker: normalizeSearchText(`${raw.databaseStatus || ''} ${raw.status || ''} ${raw.type || ''} ${raw.service || ''}`),
    };
  }

  function parseCustomers(rawRows) {
    const normalized = (Array.isArray(rawRows) ? rawRows : []).map(normalizeCustomer).filter(Boolean);
    const likelyCustomers = normalized.filter((customer) => (
      customer.marker.includes('klant') ||
      customer.marker.includes('betaald') ||
      customer.marker.includes('onderhoud') ||
      customer.revenueAmount > 0 ||
      customer.websiteAmount > 0
    ));
    const sourceRows = likelyCustomers.length ? likelyCustomers : normalized;
    const seen = new Set();
    return sourceRows
      .filter((customer) => {
        if (seen.has(customer.customerKey)) return false;
        seen.add(customer.customerKey);
        return true;
      })
      .sort((left, right) => left.customerName.localeCompare(right.customerName, 'nl'));
  }

  function sanitizeRecord(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const name = normalizeString(raw.customerName || raw.naam || raw.name);
    const company = normalizeString(raw.company || raw.bedrijf);
    const id = normalizeString(raw.customerId || raw.id);
    const key = normalizeString(raw.customerKey) || customerKey(id, name, company);
    if (!key || (!name && !company)) return null;
    return {
      id: normalizeString(raw.id) || `coverage-${index + 1}`,
      customerKey: key,
      customerId: id,
      customerName: name || company,
      company,
      costDescription: normalizeString(raw.costDescription || raw.costs || raw.description).slice(0, 180),
      costAmount: parseAmount(raw.costAmount ?? raw.costsAmount ?? raw.cost),
      costFrequency: normalizeFrequency(raw.costFrequency),
      revenueAmount: parseAmount(raw.revenueAmount ?? raw.incomeAmount ?? raw.revenue),
      revenueFrequency: normalizeFrequency(raw.revenueFrequency),
      customerTerm: normalizeTerm(raw.customerTerm || raw.term),
      note: normalizeString(raw.note).slice(0, 180),
      updatedAt: normalizeString(raw.updatedAt),
    };
  }

  function sanitizeRecords(rawRecords) {
    return (Array.isArray(rawRecords) ? rawRecords : []).map(sanitizeRecord).filter(Boolean);
  }

  function amountToMonthly(amount, frequency) {
    const value = Math.max(0, Number(amount) || 0);
    return normalizeFrequency(frequency) === 'jaarlijks' ? value / 12 : value;
  }

  function statusFor(record) {
    if (!record || record.isPlaceholder) return { tone: 'todo', label: 'Nog invullen' };
    const costMonthly = amountToMonthly(record.costAmount, record.costFrequency);
    const revenueMonthly = amountToMonthly(record.revenueAmount, record.revenueFrequency);
    if (costMonthly <= 0) return { tone: 'todo', label: 'Geen kosten' };
    if (revenueMonthly <= 0) return { tone: 'warn', label: 'Geen inkomsten' };
    if (revenueMonthly + 0.004 < costMonthly) return { tone: 'warn', label: 'Tekort' };
    if (record.costFrequency === 'jaarlijks' && record.customerTerm === 'maandelijks_opzegbaar') {
      return { tone: 'warn', label: 'Jaarlast check' };
    }
    return { tone: 'ok', label: 'Gedekt' };
  }

  function monthlyMargin(record) {
    if (!record || record.isPlaceholder) return 0;
    return amountToMonthly(record.revenueAmount, record.revenueFrequency) -
      amountToMonthly(record.costAmount, record.costFrequency);
  }

  function rows() {
    const customerByKey = new Map(customers.map((customer) => [customer.customerKey, customer]));
    const savedRows = records.map((record) => {
      const customer = customerByKey.get(record.customerKey);
      return {
        ...record,
        customerName: customer ? customer.customerName : record.customerName,
        company: customer ? customer.company : record.company,
        isPlaceholder: false,
      };
    });
    const savedKeys = new Set(savedRows.map((record) => record.customerKey));
    customers.forEach((customer) => {
      if (savedKeys.has(customer.customerKey)) return;
      savedRows.push({
        id: '',
        customerKey: customer.customerKey,
        customerId: customer.customerId,
        customerName: customer.customerName,
        company: customer.company,
        costDescription: '',
        costAmount: 0,
        costFrequency: 'maandelijks',
        revenueAmount: customer.revenueAmount,
        revenueFrequency: 'maandelijks',
        customerTerm: 'maandelijks_opzegbaar',
        note: '',
        isPlaceholder: true,
      });
    });
    return savedRows.sort((left, right) => left.customerName.localeCompare(right.customerName, 'nl'));
  }

  function visibleRows() {
    const query = normalizeSearchText(searchQuery);
    if (!query) return rows();
    return rows().filter((row) => normalizeSearchText(
      `${row.customerName} ${row.company} ${row.costDescription} ${row.note}`
    ).includes(query));
  }

  function metric(label, value, tone) {
    const item = document.createElement('div');
    item.className = 'coverage-metric';
    appendText(item, 'div', 'coverage-label', label);
    appendText(item, 'div', `coverage-metric-value ${tone || ''}`.trim(), value);
    return item;
  }

  function renderMetrics(allRows) {
    const target = document.getElementById('coverage-metrics');
    if (!target) return;
    const savedRows = allRows.filter((row) => !row.isPlaceholder);
    const okRows = savedRows.filter((row) => statusFor(row).tone === 'ok');
    const checkRows = allRows.filter((row) => statusFor(row).tone !== 'ok');
    const margin = savedRows.reduce((sum, row) => sum + monthlyMargin(row), 0);
    target.replaceChildren(
      metric('Klantchecks', String(savedRows.length), ''),
      metric('Gedekt', String(okRows.length), 'ok'),
      metric('Checken', String(checkRows.length), checkRows.length ? 'warn' : 'ok'),
      metric('Saldo / mnd', fmtEur(margin), margin < 0 ? 'warn' : 'ok')
    );
  }

  function tableHead() {
    const row = document.createElement('div');
    row.className = 'coverage-row head';
    ['Klant', 'Kosten die wij betalen', 'Maandelijkse inkomsten', 'Contract', 'Status', 'Acties']
      .forEach((label) => appendText(row, 'span', '', label));
    return row;
  }

  function cell(mainText, noteText) {
    const node = document.createElement('div');
    appendText(node, 'div', 'coverage-cell-main', mainText);
    if (noteText) appendText(node, 'div', 'coverage-cell-note', noteText);
    return node;
  }

  function iconButton(action, key, title) {
    const button = document.createElement('button');
    button.className = action === 'delete' ? 'btn-del' : 'btn-edit';
    button.type = 'button';
    button.dataset.coverageAction = action;
    button.dataset.coverageKey = key;
    button.title = title;
    button.setAttribute('aria-label', title);
    if (helpers.createCostActionIcon) button.appendChild(helpers.createCostActionIcon(action));
    else button.textContent = action === 'delete' ? 'x' : '...';
    return button;
  }

  function tableRow(record) {
    const row = document.createElement('div');
    row.className = 'coverage-row';
    const status = statusFor(record);
    const margin = monthlyMargin(record);
    const customer = document.createElement('div');
    appendText(customer, 'div', 'coverage-name', record.customerName || 'Onbekende klant');
    appendText(customer, 'div', 'coverage-meta', record.company || 'Geen bedrijfsnaam');
    row.appendChild(customer);
    row.appendChild(cell(
      record.costDescription || 'Nog niet ingevuld',
      record.costAmount > 0 ? `${fmtEur(record.costAmount)} ${frequencyLabel[record.costFrequency].toLowerCase()}` : ''
    ));
    row.appendChild(cell(
      fmtEur(amountToMonthly(record.revenueAmount, record.revenueFrequency)),
      `${frequencyLabel[record.revenueFrequency].toLowerCase()} - ${fmtEur(margin)}/mnd verschil`
    ));
    row.appendChild(cell(termLabel[record.customerTerm] || 'Maandelijks opzegbaar', record.note || ''));
    const statusCell = document.createElement('div');
    appendText(statusCell, 'span', `coverage-status ${status.tone}`, status.label);
    row.appendChild(statusCell);
    const actions = document.createElement('div');
    actions.className = 'coverage-actions';
    actions.appendChild(iconButton('edit', record.customerKey, 'Klantkosten bewerken'));
    if (!record.isPlaceholder) actions.appendChild(iconButton('delete', record.customerKey, 'Klantkosten verwijderen'));
    row.appendChild(actions);
    return row;
  }

  function formNodes() {
    return {
      customer: document.getElementById('coverage-customer'),
      costDescription: document.getElementById('coverage-cost-description'),
      costAmount: document.getElementById('coverage-cost-amount'),
      costFrequency: document.getElementById('coverage-cost-frequency'),
      revenueAmount: document.getElementById('coverage-revenue-amount'),
      revenueFrequency: document.getElementById('coverage-revenue-frequency'),
      customerTerm: document.getElementById('coverage-term'),
      note: document.getElementById('coverage-note'),
    };
  }

  function findRow(key) {
    return rows().find((row) => row.customerKey === key) || null;
  }

  function populateSelect() {
    const nodes = formNodes();
    if (!nodes.customer) return;
    const selected = nodes.customer.value;
    const allRows = rows();
    nodes.customer.replaceChildren();
    if (!allRows.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Geen klanten geladen';
      nodes.customer.appendChild(option);
      return;
    }
    allRows.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.customerKey;
      option.textContent = row.company ? `${row.customerName} - ${row.company}` : row.customerName;
      nodes.customer.appendChild(option);
    });
    nodes.customer.value = allRows.some((row) => row.customerKey === selected) ? selected : allRows[0].customerKey;
  }

  function fillForm(record) {
    const nodes = formNodes();
    if (!nodes.customer || !record) return;
    nodes.customer.value = record.customerKey || '';
    nodes.costDescription.value = record.isPlaceholder ? '' : record.costDescription || '';
    nodes.costAmount.value = record.isPlaceholder || !record.costAmount ? '' : String(record.costAmount);
    nodes.costFrequency.value = record.costFrequency || 'maandelijks';
    nodes.revenueAmount.value = record.revenueAmount ? String(record.revenueAmount) : '0';
    nodes.revenueFrequency.value = record.revenueFrequency || 'maandelijks';
    nodes.customerTerm.value = record.customerTerm || 'maandelijks_opzegbaar';
    nodes.note.value = record.isPlaceholder ? '' : record.note || '';
  }

  function resetForm() {
    populateSelect();
    const nodes = formNodes();
    const record = findRow(nodes.customer && nodes.customer.value);
    if (record) fillForm(record);
  }

  function recordFromForm() {
    const nodes = formNodes();
    const row = findRow(nodes.customer && nodes.customer.value);
    if (!row) {
      showToast('Kies eerst een klant');
      return null;
    }
    const costDescription = normalizeString(nodes.costDescription.value);
    const costAmount = parseAmount(nodes.costAmount.value);
    const revenueAmount = parseAmount(nodes.revenueAmount.value);
    if (!costDescription && costAmount <= 0 && revenueAmount <= 0) {
      showToast('Vul kosten of inkomsten in');
      return null;
    }
    return {
      id: row.id || `coverage-${Date.now()}`,
      customerKey: row.customerKey,
      customerId: row.customerId || '',
      customerName: row.customerName,
      company: row.company || '',
      costDescription,
      costAmount,
      costFrequency: normalizeFrequency(nodes.costFrequency.value),
      revenueAmount,
      revenueFrequency: normalizeFrequency(nodes.revenueFrequency.value),
      customerTerm: normalizeTerm(nodes.customerTerm.value),
      note: normalizeString(nodes.note.value),
      updatedAt: new Date().toISOString(),
    };
  }

  function render() {
    const table = document.getElementById('coverage-table');
    if (!table) return;
    const allRows = rows();
    renderMetrics(allRows);
    table.replaceChildren(tableHead());
    if (!loaded) {
      appendText(table, 'div', 'coverage-empty', 'Klantkosten laden...');
      return;
    }
    const filteredRows = visibleRows();
    if (!filteredRows.length) {
      appendText(table, 'div', 'coverage-empty', 'Geen klanten gevonden.');
      return;
    }
    filteredRows.forEach((row) => table.appendChild(tableRow(row)));
    populateSelect();
  }

  async function persist(actor) {
    const result = await setUiState(MONTHLY_COSTS_REMOTE_SCOPE, {
      patch: {
        [CUSTOMER_COST_COVERAGE_KEY]: JSON.stringify(records),
        customer_cost_coverage_updated_at: new Date().toISOString(),
      },
      source: 'premium-customer-cost-coverage',
      actor: normalizeString(actor || 'browser'),
    });
    if (normalizeString(result && result.source) !== 'supabase') {
      throw new Error('Klantkosten-check is nog niet bevestigd in de database.');
    }
    return result;
  }

  async function save(event) {
    if (event) event.preventDefault();
    const nextRecord = recordFromForm();
    if (!nextRecord) return;
    const snapshot = records.map((item) => ({ ...item }));
    const index = records.findIndex((item) => item.customerKey === nextRecord.customerKey);
    if (index >= 0) records[index] = nextRecord;
    else records.push(nextRecord);
    render();
    try {
      await persist('browser_customer_coverage_save');
      showToast('✓ Klantkosten-check opgeslagen');
    } catch (error) {
      records = snapshot;
      render();
      showToast(normalizeString(error && error.message) || 'Opslaan mislukt; wijziging is teruggedraaid');
    }
  }

  async function remove(key) {
    const item = records.find((record) => record.customerKey === key);
    if (!item) return;
    const snapshot = records.map((record) => ({ ...record }));
    records = records.filter((record) => record.customerKey !== key);
    render();
    try {
      await persist('browser_customer_coverage_delete');
      showToast('✓ Klantkosten-check verwijderd');
    } catch (error) {
      records = snapshot;
      render();
      showToast(normalizeString(error && error.message) || 'Verwijderen mislukt; wijziging is teruggedraaid');
    }
  }

  async function ensureLoaded() {
    if (loaded) return true;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const [customerState, monthlyCostState] = await Promise.all([
          getUiState(CUSTOMER_DB_SCOPE),
          getUiState(MONTHLY_COSTS_REMOTE_SCOPE),
        ]);
        customers = parseCustomers(readCustomerRows(customerState));
        records = sanitizeRecords(parseJsonArray(
          monthlyCostState && monthlyCostState.values && monthlyCostState.values[CUSTOMER_COST_COVERAGE_KEY]
        ));
        loaded = true;
        render();
        resetForm();
        focusFromUrl();
        return true;
      } catch (error) {
        console.error('Klantkosten-check laden via Supabase mislukt:', error);
        loaded = true;
        render();
        return false;
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function focusFromUrl() {
    if (focusedFromUrl) return;
    const params = new URLSearchParams(global.location.search || '');
    const view = normalizeSearchText(params.get('view') || params.get('tab') || '');
    if (view !== 'klantdekking' && view !== 'klantkosten') return;
    const panel = document.getElementById('customer-cost-coverage');
    const search = document.getElementById('coverage-search');
    if (panel) panel.scrollIntoView({ block: 'start' });
    if (search) search.focus({ preventScroll: true });
    focusedFromUrl = true;
  }

  function bindEvents() {
    const searchInput = document.getElementById('coverage-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value || '';
        render();
      });
    }
    const form = document.getElementById('coverage-form');
    if (form) form.addEventListener('submit', save);
    const select = document.getElementById('coverage-customer');
    if (select) {
      select.addEventListener('change', () => {
        const record = findRow(select.value);
        if (record) fillForm(record);
      });
    }
    const reset = document.getElementById('coverage-reset');
    if (reset) reset.addEventListener('click', resetForm);
    const table = document.getElementById('coverage-table');
    if (table) {
      table.addEventListener('click', (event) => {
        const button = event.target.closest('[data-coverage-action]');
        if (!button) return;
        const key = normalizeString(button.dataset.coverageKey);
        if (!key) return;
        if (button.dataset.coverageAction === 'edit') {
          const record = findRow(key);
          if (record) fillForm(record);
          return;
        }
        if (button.dataset.coverageAction === 'delete') void remove(key);
      });
    }
  }

  function init() {
    bindEvents();
    render();
    void ensureLoaded();
  }

  global.SoftoraCustomerCostCoverage = {
    ensureLoaded,
    focusFromUrl,
    render,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
