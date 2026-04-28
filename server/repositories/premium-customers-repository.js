const DEFAULT_CUSTOMER_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_KEY = 'softora_customers_premium_v1';
const DEFAULT_CUSTOMER_LIST_LIMIT = 500;
const MAX_CUSTOMER_LIST_LIMIT = 1000;
const MAX_CUSTOMER_ROWS = 5000;
const MAX_CUSTOMER_FIELD_KEY_LENGTH = 80;
const MAX_CUSTOMER_FIELD_VALUE_LENGTH = 5000;
const CUSTOMER_SORT_FIELDS = Object.freeze({
  bedrijf: ['bedrijf', 'bedrijfsnaam', 'company', 'name'],
  status: ['databaseStatus', 'status'],
  email: ['email', 'mail', 'e-mail'],
  telefoon: ['telefoon', 'telefoonnummer', 'phone', 'phoneNumber'],
  website: ['website', 'websiteUrl', 'site'],
});
const DATABASE_STATUS_ALIASES = Object.freeze({
  afspraak: 'afspraak',
  appointment: 'afspraak',
  klant: 'klant',
  customer: 'klant',
  client: 'klant',
  gemaild: 'gemaild',
  emailed: 'gemaild',
  mail: 'gemaild',
  afgehaakt: 'afgehaakt',
  no_deal: 'afgehaakt',
  no_deal_na_afspraak: 'afgehaakt',
  rejected: 'afgehaakt',
});

function normalizeString(value) {
  return String(value || '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncateCustomerText(value, maxLength = MAX_CUSTOMER_FIELD_VALUE_LENGTH) {
  return String(value || '').slice(0, maxLength);
}

function sanitizeCustomerFieldValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value === 'string') return truncateCustomerText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;

  try {
    return truncateCustomerText(JSON.stringify(value));
  } catch (_error) {
    return '';
  }
}

function sanitizeCustomerHistoryValue(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isPlainObject)
    .map((entry) => {
      const normalized = {};
      for (const [rawKey, rawValue] of Object.entries(entry)) {
        const key = normalizeString(rawKey).slice(0, MAX_CUSTOMER_FIELD_KEY_LENGTH);
        if (!key) continue;
        const fieldValue = sanitizeCustomerFieldValue(rawValue);
        if (fieldValue === undefined) continue;
        normalized[key] = fieldValue;
      }
      return normalized;
    })
    .filter((entry) => Object.keys(entry).length > 0)
    .slice(-20);
}

function getCustomerStatusHistoryLabel(status) {
  const labels = {
    afspraak: 'Afspraak',
    afgehaakt: 'Afgehaakt',
    geblokkeerd: 'Geblokkeerd',
    gemaild: 'Gemaild',
    interesse: 'Interesse',
    klant: 'Klant',
    mailcampagne: 'Mailcampagne',
  };
  return labels[status] || 'Status bijgewerkt';
}

function buildCustomerStatusHistoryEntry(status, meta = {}) {
  const databaseStatus = normalizeCustomerDatabaseStatus(status);
  if (!databaseStatus) return null;

  const entry = {
    type: databaseStatus,
    label: normalizeString(meta.label) || getCustomerStatusHistoryLabel(databaseStatus),
    date: normalizeString(meta.date || meta.at || meta.updatedAt) || new Date().toISOString(),
  };
  const actor = normalizeString(meta.actor || meta.updatedBy || meta.user);
  const source = normalizeString(meta.source || meta.reason);
  if (actor) entry.actor = actor;
  if (source) entry.source = source;

  return sanitizeCustomerHistoryValue([entry])[0] || null;
}

function normalizeCustomerDatabaseStatus(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '');
  if (!normalized) return '';
  return DATABASE_STATUS_ALIASES[normalized] || normalized;
}

function normalizeCustomerEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeCustomerPhone(value) {
  const digits = normalizeString(value).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('0031')) return `0${digits.slice(4)}`;
  if (digits.startsWith('31') && digits.length > 9) return `0${digits.slice(2)}`;
  return digits;
}

function normalizeCustomerWebsite(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '');
}

function normalizeCustomerCompanyName(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' en ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCustomerListOptions(options = {}) {
  const safeOptions = isPlainObject(options) ? options : {};
  const hasLimit = Object.prototype.hasOwnProperty.call(safeOptions, 'limit');
  const rawLimit = Number.parseInt(String(safeOptions.limit || ''), 10);
  const rawOffset = Number.parseInt(String(safeOptions.offset || ''), 10);
  const sortBy = normalizeString(safeOptions.sortBy || safeOptions.sort || '');
  const normalizedSortBy = Object.prototype.hasOwnProperty.call(CUSTOMER_SORT_FIELDS, sortBy) ? sortBy : '';
  const sortDirection = normalizeString(safeOptions.sortDirection || safeOptions.direction || '').toLowerCase() === 'desc'
    ? 'desc'
    : 'asc';
  const limit = hasLimit
    ? Math.max(0, Math.min(MAX_CUSTOMER_LIST_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_CUSTOMER_LIST_LIMIT))
    : null;

  return {
    status: normalizeCustomerDatabaseStatus(safeOptions.status || safeOptions.databaseStatus),
    query: normalizeString(safeOptions.query || safeOptions.search),
    limit,
    offset: Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
    sortBy: normalizedSortBy,
    sortDirection,
  };
}

function getCustomerIdentityKey(row) {
  if (!isPlainObject(row)) return '';

  const phone = normalizeCustomerPhone(row.telefoon || row.telefoonnummer || row.phone || row.phoneNumber);
  if (phone) return `phone:${phone}`;

  const email = normalizeCustomerEmail(row.email || row.mail || row['e-mail']);
  if (email) return `email:${email}`;

  const website = normalizeCustomerWebsite(row.website || row.websiteUrl || row.site);
  if (website) return `website:${website}`;

  const company = normalizeCustomerCompanyName(row.bedrijf || row.bedrijfsnaam || row.company || row.name);
  return company ? `company:${company}` : '';
}

function cloneCustomerRow(row) {
  if (!isPlainObject(row)) return null;
  const cloned = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = normalizeString(rawKey).slice(0, MAX_CUSTOMER_FIELD_KEY_LENGTH);
    if (!key) continue;
    if ((key === 'hist' || key === 'history') && Array.isArray(rawValue)) {
      cloned[key] = sanitizeCustomerHistoryValue(rawValue);
      continue;
    }
    const value = sanitizeCustomerFieldValue(rawValue);
    if (value === undefined) continue;
    cloned[key] = value;
  }

  const databaseStatus = normalizeCustomerDatabaseStatus(cloned.databaseStatus || cloned.status);
  if (databaseStatus) cloned.databaseStatus = databaseStatus;
  return cloned;
}

function appendCustomerStatusHistory(row, status, meta = {}) {
  const cloned = cloneCustomerRow(row);
  if (!cloned) return null;

  const entry = isPlainObject(status)
    ? sanitizeCustomerHistoryValue([status])[0]
    : buildCustomerStatusHistoryEntry(status, meta);
  if (!entry) return cloned;

  const databaseStatus = normalizeCustomerDatabaseStatus(entry.type || status);
  if (databaseStatus) cloned.databaseStatus = databaseStatus;

  const existingHistory = Array.isArray(cloned.hist)
    ? cloned.hist
    : Array.isArray(cloned.history)
      ? cloned.history
      : [];
  cloned.hist = sanitizeCustomerHistoryValue(existingHistory.concat(entry));
  return cloned;
}

function updateCustomerStatusWithHistoryInRows(rows, identityOrRow, status, meta = {}) {
  const normalizedRows = normalizeCustomerRows(rows);
  const databaseStatus = normalizeCustomerDatabaseStatus(status);
  if (!databaseStatus) {
    return {
      rows: normalizedRows,
      updated: false,
      status: '',
      index: -1,
      customer: null,
    };
  }

  const index = findCustomerIndexByIdentity(normalizedRows, identityOrRow);
  if (index < 0) {
    return {
      rows: normalizedRows,
      updated: false,
      status: databaseStatus,
      index: -1,
      customer: null,
    };
  }

  const nextRows = normalizedRows.slice();
  const customer = appendCustomerStatusHistory(nextRows[index], databaseStatus, meta);
  nextRows[index] = customer;

  return {
    rows: nextRows,
    updated: true,
    status: databaseStatus,
    index,
    customer,
  };
}

function normalizeCustomerRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_CUSTOMER_ROWS).map(cloneCustomerRow).filter(Boolean);
}

function customerRowMatchesQuery(row, query) {
  const needle = normalizeString(query).toLowerCase();
  if (!needle) return true;

  const searchableValues = [
    row.id,
    row.bedrijf,
    row.bedrijfsnaam,
    row.company,
    row.name,
    row.contact,
    row.contactpersoon,
    row.email,
    row.mail,
    row['e-mail'],
    row.telefoon,
    row.telefoonnummer,
    row.phone,
    row.phoneNumber,
    row.website,
    row.websiteUrl,
    row.databaseStatus,
    row.status,
  ];

  if (
    searchableValues.some((value) =>
      normalizeString(value)
        .toLowerCase()
        .includes(needle)
    )
  ) {
    return true;
  }

  const phoneNeedle = normalizeCustomerPhone(needle);
  if (phoneNeedle) {
    const phoneKey = getCustomerIdentityKey({
      telefoon: row.telefoon || row.telefoonnummer || row.phone || row.phoneNumber,
    });
    if (phoneKey.includes(phoneNeedle)) return true;
  }

  return false;
}

function filterCustomerRows(rows, options = {}) {
  const normalizedRows = normalizeCustomerRows(rows);
  const listOptions = parseCustomerListOptions(options);

  return normalizedRows.filter((row) => {
    if (listOptions.status && normalizeCustomerDatabaseStatus(row.databaseStatus || row.status) !== listOptions.status) {
      return false;
    }
    return customerRowMatchesQuery(row, listOptions.query);
  });
}

function getCustomerSortValue(row, sortBy) {
  const fields = CUSTOMER_SORT_FIELDS[sortBy] || [];
  for (const field of fields) {
    const value = row[field];
    if (normalizeString(value)) {
      if (sortBy === 'status') return normalizeCustomerDatabaseStatus(value);
      if (sortBy === 'telefoon') return normalizeCustomerPhone(value);
      if (sortBy === 'website') return normalizeCustomerWebsite(value);
      return normalizeString(value).toLowerCase();
    }
  }
  return '';
}

function sortCustomerRows(rows, options = {}) {
  const normalizedRows = normalizeCustomerRows(rows);
  const listOptions = parseCustomerListOptions(options);
  if (!listOptions.sortBy) return normalizedRows;

  const direction = listOptions.sortDirection === 'desc' ? -1 : 1;
  return normalizedRows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = getCustomerSortValue(left.row, listOptions.sortBy);
      const rightValue = getCustomerSortValue(right.row, listOptions.sortBy);
      const valueCompare = leftValue.localeCompare(rightValue, 'nl', {
        numeric: true,
        sensitivity: 'base',
      });
      if (valueCompare) return valueCompare * direction;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

function selectCustomerRows(rows, options = {}) {
  const listOptions = parseCustomerListOptions(options);
  const filteredRows = filterCustomerRows(rows, listOptions);
  const sortedRows = sortCustomerRows(filteredRows, listOptions);
  const selectedRows =
    listOptions.limit === null
      ? sortedRows
      : sortedRows.slice(listOptions.offset, listOptions.offset + listOptions.limit);

  return {
    rows: selectedRows,
    count: selectedRows.length,
    total: sortedRows.length,
    limit: listOptions.limit,
    offset: listOptions.offset,
  };
}

function mergeCustomerRows(existingRows, incomingRows) {
  const mergedRows = [];
  const indexByIdentityKey = new Map();

  function appendOrMerge(row, preferIncoming = false) {
    const cloned = cloneCustomerRow(row);
    if (!cloned) return;

    const identityKey = getCustomerIdentityKey(cloned);
    if (!identityKey) {
      mergedRows.push(cloned);
      return;
    }

    const existingIndex = indexByIdentityKey.get(identityKey);
    if (existingIndex === undefined) {
      indexByIdentityKey.set(identityKey, mergedRows.length);
      mergedRows.push(cloned);
      return;
    }

    mergedRows[existingIndex] = preferIncoming
      ? { ...mergedRows[existingIndex], ...cloned }
      : { ...cloned, ...mergedRows[existingIndex] };
  }

  if (Array.isArray(existingRows)) {
    existingRows.forEach((row) => appendOrMerge(row, false));
  }
  if (Array.isArray(incomingRows)) {
    incomingRows.forEach((row) => appendOrMerge(row, true));
  }

  return mergedRows;
}

function bulkUpsertCustomerRows(existingRows, incomingRows) {
  const nextRows = normalizeCustomerRows(existingRows);
  const sanitizedIncomingRows = normalizeCustomerRows(incomingRows);
  const changes = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  sanitizedIncomingRows.forEach((row) => {
    const identityKey = getCustomerIdentityKey(row);
    const existingIndex = identityKey ? findCustomerIndexByIdentity(nextRows, identityKey) : -1;

    if (existingIndex >= 0) {
      nextRows[existingIndex] = {
        ...nextRows[existingIndex],
        ...row,
      };
      updated += 1;
      changes.push({
        type: 'updated',
        identityKey,
        row: cloneCustomerRow(nextRows[existingIndex]),
      });
      return;
    }

    if (nextRows.length >= MAX_CUSTOMER_ROWS) {
      skipped += 1;
      changes.push({
        type: 'skipped',
        identityKey,
        row: cloneCustomerRow(row),
        reason: 'max_rows_reached',
      });
      return;
    }

    nextRows.push(row);
    added += 1;
    changes.push({
      type: 'added',
      identityKey,
      row: cloneCustomerRow(row),
    });
  });

  return {
    rows: nextRows,
    added,
    updated,
    skipped,
    total: nextRows.length,
    changes,
  };
}

function findCustomerIndexByIdentity(rows, identityOrRow) {
  const identityKey =
    typeof identityOrRow === 'string' ? normalizeString(identityOrRow) : getCustomerIdentityKey(identityOrRow);
  if (!identityKey || !Array.isArray(rows)) return -1;
  return rows.findIndex((row) => getCustomerIdentityKey(row) === identityKey);
}

function findCustomerByIdentity(rows, identityOrRow) {
  const index = findCustomerIndexByIdentity(rows, identityOrRow);
  return index >= 0 ? cloneCustomerRow(rows[index]) : null;
}

function updateCustomerStatusInRows(rows, identityOrRow, status) {
  const nextRows = normalizeCustomerRows(rows);
  const databaseStatus = normalizeCustomerDatabaseStatus(status);
  const identityKey =
    typeof identityOrRow === 'string' ? normalizeString(identityOrRow) : getCustomerIdentityKey(identityOrRow);

  if (!databaseStatus || !identityKey) {
    return {
      rows: nextRows,
      updated: false,
      row: null,
      identityKey,
      databaseStatus,
    };
  }

  const index = findCustomerIndexByIdentity(nextRows, identityKey);
  if (index < 0) {
    return {
      rows: nextRows,
      updated: false,
      row: null,
      identityKey,
      databaseStatus,
    };
  }

  nextRows[index] = {
    ...nextRows[index],
    databaseStatus,
  };

  return {
    rows: nextRows,
    updated: true,
    row: cloneCustomerRow(nextRows[index]),
    identityKey,
    databaseStatus,
  };
}

function removeCustomerFromRows(rows, identityOrRow) {
  const nextRows = normalizeCustomerRows(rows);
  const identityKey =
    typeof identityOrRow === 'string' ? normalizeString(identityOrRow) : getCustomerIdentityKey(identityOrRow);

  if (!identityKey) {
    return {
      rows: nextRows,
      removed: false,
      row: null,
      identityKey,
    };
  }

  const index = findCustomerIndexByIdentity(nextRows, identityKey);
  if (index < 0) {
    return {
      rows: nextRows,
      removed: false,
      row: null,
      identityKey,
    };
  }

  const [removedRow] = nextRows.splice(index, 1);
  return {
    rows: nextRows,
    removed: true,
    row: cloneCustomerRow(removedRow),
    identityKey,
  };
}

function summarizeCustomerRows(rows) {
  const normalizedRows = normalizeCustomerRows(rows);
  const statusCounts = {};
  let withIdentity = 0;
  let withoutIdentity = 0;

  normalizedRows.forEach((row) => {
    const databaseStatus = normalizeCustomerDatabaseStatus(row.databaseStatus || row.status) || 'onbekend';
    statusCounts[databaseStatus] = (statusCounts[databaseStatus] || 0) + 1;

    if (getCustomerIdentityKey(row)) {
      withIdentity += 1;
    } else {
      withoutIdentity += 1;
    }
  });

  return {
    total: normalizedRows.length,
    statusCounts,
    withIdentity,
    withoutIdentity,
  };
}

function parseCustomerRows(value, logger = console) {
  if (Array.isArray(value)) {
    return normalizeCustomerRows(value);
  }

  const raw = normalizeString(value);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCustomerRows(parsed);
  } catch (error) {
    logger.error('[PremiumCustomersRepository][ParseError]', error?.message || error);
    return [];
  }
}

function stringifyCustomerRows(rows) {
  return JSON.stringify(normalizeCustomerRows(rows));
}

function getCustomerChunkMetaKey(baseKey) {
  return `${normalizeString(baseKey)}_chunks_v1`;
}

function getCustomerChunkPrefix(baseKey) {
  return `${normalizeString(baseKey)}_chunk_`;
}

function readChunkedCustomerRowsValue(values, baseKey) {
  const stateValues = isPlainObject(values) ? values : {};
  const normalizedKey = normalizeString(baseKey);
  const metaRaw = normalizeString(stateValues[getCustomerChunkMetaKey(normalizedKey)]);
  if (!metaRaw) return '';

  try {
    const meta = JSON.parse(metaRaw);
    const count = Math.max(0, Math.min(100, Number(meta && meta.count) || 0));
    if (!count) return '';

    const prefix = getCustomerChunkPrefix(normalizedKey);
    const chunks = [];
    for (let index = 0; index < count; index += 1) {
      const chunk = stateValues[prefix + index];
      if (typeof chunk !== 'string') return '';
      chunks.push(chunk);
    }

    return chunks.join('');
  } catch (_error) {
    return '';
  }
}

function parseCustomerRowsFromStateValues(values, key = DEFAULT_CUSTOMER_KEY, logger = console) {
  const stateValues = isPlainObject(values) ? values : {};
  const normalizedKey = normalizeString(key) || DEFAULT_CUSTOMER_KEY;
  const rawRows = parseCustomerRows(stateValues[normalizedKey], logger);
  const chunkedRaw = readChunkedCustomerRowsValue(stateValues, normalizedKey);
  if (!chunkedRaw) return rawRows;

  const chunkedRows = parseCustomerRows(chunkedRaw, logger);
  return chunkedRows.length > rawRows.length ? chunkedRows : rawRows;
}

function createPremiumCustomersRepository(deps = {}) {
  const {
    customerScope = DEFAULT_CUSTOMER_SCOPE,
    customerKey = DEFAULT_CUSTOMER_KEY,
    getUiStateValues = null,
    setUiStateValues = null,
    logger = console,
  } = deps;

  const normalizedScope = normalizeString(customerScope) || DEFAULT_CUSTOMER_SCOPE;
  const normalizedKey = normalizeString(customerKey) || DEFAULT_CUSTOMER_KEY;

  async function listCustomers(options = {}) {
    if (typeof getUiStateValues !== 'function') {
      return {
        rows: [],
        count: 0,
        total: 0,
        scope: normalizedScope,
        key: normalizedKey,
        source: 'unavailable',
        updatedAt: null,
      };
    }

    const state = await getUiStateValues(normalizedScope);
    const values = state && isPlainObject(state.values) ? state.values : {};
    const rows = parseCustomerRowsFromStateValues(values, normalizedKey, logger);
    const selection = selectCustomerRows(rows, options);

    return {
      rows: selection.rows,
      count: selection.count,
      total: selection.total,
      limit: selection.limit,
      offset: selection.offset,
      scope: normalizedScope,
      key: normalizedKey,
      source: normalizeString(state?.source || '') || 'empty',
      updatedAt: normalizeString(state?.updatedAt || '') || null,
    };
  }

  async function saveCustomers(rows, meta = {}) {
    if (typeof setUiStateValues !== 'function') {
      return {
        ok: false,
        rows: [],
        count: 0,
        scope: normalizedScope,
        key: normalizedKey,
        source: 'unavailable',
        updatedAt: null,
      };
    }

    const sanitizedRows = normalizeCustomerRows(rows);
    const result = await setUiStateValues(
      normalizedScope,
      {
        [normalizedKey]: stringifyCustomerRows(sanitizedRows),
        [getCustomerChunkMetaKey(normalizedKey)]: '',
      },
      {
        ...meta,
        source: normalizeString(meta.source || '') || 'premium-customers-repository',
      }
    );

    if (!result) {
      return {
        ok: false,
        rows: sanitizedRows,
        count: sanitizedRows.length,
        scope: normalizedScope,
        key: normalizedKey,
        source: 'unavailable',
        updatedAt: null,
      };
    }

    return {
      ok: true,
      rows: sanitizedRows,
      count: sanitizedRows.length,
      scope: normalizedScope,
      key: normalizedKey,
      source: normalizeString(result.source || '') || 'supabase',
      updatedAt: normalizeString(result.updatedAt || '') || null,
    };
  }

  async function mergeCustomers(rows, meta = {}) {
    const current = await listCustomers();
    const mergedRows = mergeCustomerRows(current.rows, rows);
    return saveCustomers(mergedRows, meta);
  }

  async function bulkUpsertCustomers(rows, meta = {}) {
    const current = await listCustomers();
    const bulk = bulkUpsertCustomerRows(current.rows, rows);
    const saved = await saveCustomers(bulk.rows, meta);
    return {
      ...saved,
      added: bulk.added,
      updated: bulk.updated,
      skipped: bulk.skipped,
      changes: bulk.changes,
    };
  }

  async function upsertCustomer(row, meta = {}) {
    const sanitizedRow = cloneCustomerRow(row);
    if (!sanitizedRow) {
      return {
        ok: false,
        row: null,
        matched: false,
        identityKey: '',
        rows: [],
        count: 0,
        scope: normalizedScope,
        key: normalizedKey,
        source: 'invalid',
        updatedAt: null,
      };
    }

    const current = await listCustomers();
    const nextRows = current.rows.slice();
    const identityKey = getCustomerIdentityKey(sanitizedRow);
    const existingIndex = findCustomerIndexByIdentity(nextRows, identityKey);
    const matched = existingIndex >= 0;

    if (matched) {
      nextRows[existingIndex] = {
        ...nextRows[existingIndex],
        ...sanitizedRow,
      };
    } else {
      nextRows.push(sanitizedRow);
    }

    const saved = await saveCustomers(nextRows, meta);
    return {
      ...saved,
      row: sanitizedRow,
      matched,
      identityKey,
    };
  }

  async function updateCustomerStatus(identityOrRow, status, meta = {}) {
    const current = await listCustomers();
    const update = updateCustomerStatusInRows(current.rows, identityOrRow, status);

    if (!update.updated) {
      return {
        ok: false,
        row: null,
        matched: false,
        identityKey: update.identityKey,
        databaseStatus: update.databaseStatus,
        rows: current.rows,
        count: current.count,
        scope: normalizedScope,
        key: normalizedKey,
        source: current.source,
        updatedAt: current.updatedAt,
      };
    }

    const saved = await saveCustomers(update.rows, meta);
    return {
      ...saved,
      row: update.row,
      matched: true,
      identityKey: update.identityKey,
      databaseStatus: update.databaseStatus,
    };
  }

  async function removeCustomer(identityOrRow, meta = {}) {
    const current = await listCustomers();
    const removal = removeCustomerFromRows(current.rows, identityOrRow);

    if (!removal.removed) {
      return {
        ok: false,
        row: null,
        removed: false,
        identityKey: removal.identityKey,
        rows: current.rows,
        count: current.count,
        scope: normalizedScope,
        key: normalizedKey,
        source: current.source,
        updatedAt: current.updatedAt,
      };
    }

    const saved = await saveCustomers(removal.rows, meta);
    return {
      ...saved,
      row: removal.row,
      removed: true,
      identityKey: removal.identityKey,
    };
  }

  async function summarizeCustomers() {
    const current = await listCustomers();
    return {
      ...summarizeCustomerRows(current.rows),
      scope: normalizedScope,
      key: normalizedKey,
      source: current.source,
      updatedAt: current.updatedAt,
    };
  }

  return {
    bulkUpsertCustomers,
    customerKey: normalizedKey,
    customerScope: normalizedScope,
    findCustomerByIdentity: async (identityOrRow) => {
      const current = await listCustomers();
      return findCustomerByIdentity(current.rows, identityOrRow);
    },
    listCustomers,
    mergeCustomers,
    removeCustomer,
    saveCustomers,
    summarizeCustomers,
    updateCustomerStatus,
    upsertCustomer,
  };
}

module.exports = {
  DEFAULT_CUSTOMER_KEY,
  DEFAULT_CUSTOMER_LIST_LIMIT,
  DEFAULT_CUSTOMER_SCOPE,
  CUSTOMER_SORT_FIELDS,
  MAX_CUSTOMER_LIST_LIMIT,
  MAX_CUSTOMER_FIELD_KEY_LENGTH,
  MAX_CUSTOMER_FIELD_VALUE_LENGTH,
  MAX_CUSTOMER_ROWS,
  appendCustomerStatusHistory,
  bulkUpsertCustomerRows,
  buildCustomerStatusHistoryEntry,
  createPremiumCustomersRepository,
  customerRowMatchesQuery,
  filterCustomerRows,
  findCustomerByIdentity,
  findCustomerIndexByIdentity,
  getCustomerIdentityKey,
  mergeCustomerRows,
  normalizeCustomerDatabaseStatus,
  normalizeCustomerCompanyName,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerRows,
  normalizeCustomerWebsite,
  parseCustomerRows,
  parseCustomerListOptions,
  removeCustomerFromRows,
  sanitizeCustomerFieldValue,
  sanitizeCustomerHistoryValue,
  selectCustomerRows,
  sortCustomerRows,
  summarizeCustomerRows,
  stringifyCustomerRows,
  updateCustomerStatusInRows,
  updateCustomerStatusWithHistoryInRows,
};
