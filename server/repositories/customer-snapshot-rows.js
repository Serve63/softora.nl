const { MAX_DATABASE_CUSTOMERS } = require('../config/premium-database-limits');

const SNAPSHOT_COLUMNS = 'customer_id,identity_key,company,contact_name,phone,email,website,database_status,lifecycle_status,responsible,payload,updated_at';

function createCustomerSnapshotRowsRepository({ run, cachedRead, tableName, readQueryTimeoutMs }) {
  async function listCustomerSnapshotRows(options = {}) {
    return cachedRead('customers-snapshot', async () => {
      const pageSize = Math.max(1, Math.min(1000, Number(options.pageSize) || 1000));
      const rows = [], seen = new Set();
      let total = null;
      do {
        const offset = rows.length;
        const result = await run(`list-customers-snapshot-${offset}`, (client) => client
          .from(tableName)
          .select(SNAPSHOT_COLUMNS, offset === 0 ? { count: 'exact' } : undefined)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .order('customer_id', { ascending: true })
          .range(offset, offset + pageSize - 1), {
          timeoutMs: Math.max(readQueryTimeoutMs, Math.min(30000, Number(options.timeoutMs) || readQueryTimeoutMs)),
          bypassReadFailureCooldown: options.bypassReadFailureCooldown,
          suppressReadFailureCooldown: options.suppressReadFailureCooldown,
          suppressTransientReadFailureLog: options.suppressTransientReadFailureLog,
        });
        if (!result.ok || !Array.isArray(result.data)) return null;
        if (total === null) {
          total = result.count === null || result.count === undefined ? NaN : Number(result.count);
          if (!Number.isInteger(total) || total < 0 || total > MAX_DATABASE_CUSTOMERS) return null;
        }
        const page = result.data;
        if (page.length > pageSize || rows.length + page.length > total || (!page.length && rows.length !== total)) return null;
        for (const row of page) {
          const id = String(row && row.customer_id || '').trim();
          if (!id || seen.has(id)) return null;
          seen.add(id); rows.push(row);
        }
        // PostgREST may return fewer rows than requested. Only the exact total
        // proves completion; continue from the number actually received.
      } while (rows.length < total);
      return rows;
    }, { bypassReadCache: options.bypassReadCache, suppressStaleReadCacheLog: options.suppressStaleReadCacheLog });
  }
  return { listCustomerSnapshotRows };
}

module.exports = { createCustomerSnapshotRowsRepository, SNAPSHOT_COLUMNS };
