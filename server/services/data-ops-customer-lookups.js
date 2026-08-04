const CUSTOMER_COLUMNS = 'customer_id,company,email,database_status,lifecycle_status,payload,updated_at';

function createDataOpsCustomerLookups(deps = {}) {
  const {
    cachedRead,
    run,
    tableName,
    normalizeString = (value) => String(value || '').trim(),
    readQueryTimeoutMs,
  } = deps;

  function normalizeValues(values, lowercase = false) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map((value) => lowercase ? normalizeString(value).toLowerCase() : normalizeString(value))
      .filter(Boolean))).sort();
  }

  function normalizeCustomerRow(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      ...payload,
      id: normalizeString(payload.id || row.customer_id),
      bedrijf: normalizeString(payload.bedrijf || payload.company || payload.companyName || row.company),
      email: normalizeString(payload.email || payload.contactEmail || row.email),
      databaseStatus: normalizeString(payload.databaseStatus || row.database_status || row.lifecycle_status),
    };
  }

  function createListByField({ inputKey, column, cachePrefix, operation, lowercase = false }) {
    return async function listCustomersByExactField(options = {}) {
      const values = normalizeValues(options[inputKey], lowercase);
      if (!values.length) return [];
      return cachedRead(`${cachePrefix}:${values.join(',')}`, async () => {
        const rows = [];
        for (let index = 0; index < values.length; index += 100) {
          const valueChunk = values.slice(index, index + 100);
          const result = await run(operation, (client) => client
            .from(tableName)
            .select(CUSTOMER_COLUMNS)
            .is('deleted_at', null)
            .in(column, valueChunk)
            .limit(1000), {
            timeoutMs: readQueryTimeoutMs,
            bypassReadFailureCooldown: options.bypassReadFailureCooldown,
            suppressReadFailureCooldown: options.suppressReadFailureCooldown,
            suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
          });
          if (!result.ok) return null;
          rows.push(...(result.data || []));
        }
        const seen = new Set();
        return rows.filter((row) => {
          const key = normalizeString(row && row.customer_id);
          if (key && seen.has(key)) return false;
          if (key) seen.add(key);
          return true;
        }).map(normalizeCustomerRow);
      }, {
        bypassReadCache: options.bypassReadCache,
        suppressStaleReadCacheLog: options.suppressStaleReadCacheLog,
      });
    };
  }

  async function listCustomersPage(options = {}) {
    const metaOnly = options.metaOnly === true;
    const offset = Math.max(0, Math.min(25000, Number.parseInt(String(options.offset || 0), 10) || 0));
    const limit = Math.max(1, Math.min(1000, Number.parseInt(String(options.limit || 750), 10) || 750));
    const includeExactCount = metaOnly || offset === 0;
    const result = await run(`list-customers-page-${metaOnly ? 'meta' : `${offset}-${offset + limit - 1}`}`, (client) => {
      let query = client
        .from(tableName)
        .select(
          metaOnly ? 'customer_id,updated_at' : 'customer_id,payload,updated_at',
          includeExactCount ? { count: 'exact' } : undefined
        )
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .order('customer_id', { ascending: true });
      if (metaOnly && typeof query.limit === 'function') return query.limit(1);
      if (typeof query.range === 'function') return query.range(offset, offset + limit - 1);
      if (typeof query.limit === 'function') return query.limit(limit);
      return query;
    }, {
      timeoutMs: readQueryTimeoutMs,
      bypassReadFailureCooldown: options.bypassReadFailureCooldown,
      suppressReadFailureCooldown: options.suppressReadFailureCooldown,
      suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
    });
    if (!result.ok) return null;
    const rows = Array.isArray(result.data) ? result.data : [];
    const exactTotal = result.count === null || result.count === undefined ? Number.NaN : Number(result.count);
    const total = Number.isFinite(exactTotal)
      ? Math.max(0, exactTotal)
      : Math.max(offset + rows.length, rows.length === limit ? offset + limit + 1 : 0);
    const customers = metaOnly ? [] : rows.map(normalizeCustomerRow);
    return {
      customers,
      total,
      offset,
      limit,
      hasMore: !metaOnly && offset + customers.length < total,
      snapshotVersion: `${total}:${normalizeString(rows[0] && rows[0].updated_at)}`,
    };
  }

  return {
    listCustomersPage,
    listCustomersByEmails: createListByField({
      inputKey: 'emails', column: 'email', cachePrefix: 'customers-by-email',
      operation: 'list-customers-by-emails', lowercase: true,
    }),
    listCustomersByIds: createListByField({
      inputKey: 'customerIds', column: 'customer_id', cachePrefix: 'customers-by-id',
      operation: 'list-customers-by-ids',
    }),
  };
}

module.exports = { createDataOpsCustomerLookups };
