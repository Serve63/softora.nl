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

  return {
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
