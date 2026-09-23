// Reads the per-table change counters maintained by database triggers
// (supabase/migrations/*_platform_table_versions.sql). Every insert, update,
// delete or truncate bumps the counter, whichever code or SQL made the change,
// so a read model can prove in one small query that its sources are unchanged.
const TABLE_VERSIONS_TABLE = 'softora_table_versions';
const MAX_TABLES = 20;

function createTableVersionRepository({ run, readQueryTimeoutMs } = {}) {
  async function readTableVersions(tableNames = []) {
    const names = Array.from(new Set((Array.isArray(tableNames) ? tableNames : [])
      .map((name) => String(name || '').trim())
      .filter((name) => /^[a-z0-9_]{1,63}$/.test(name)))).sort();
    if (!names.length || names.length > MAX_TABLES || typeof run !== 'function') return null;
    const result = await run('read-table-versions', (client) => client
      .from(TABLE_VERSIONS_TABLE)
      .select('table_name,version')
      .in('table_name', names), {
      timeoutMs: readQueryTimeoutMs,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
    });
    if (!result.ok || !Array.isArray(result.data)) return null;
    const versions = {};
    for (const row of result.data) {
      const version = String(row ? row.version ?? '' : '').trim();
      if (!/^\d+$/.test(version)) return null;
      versions[String(row.table_name)] = version;
    }
    // A missing counter means the trigger is not installed: never claim a version.
    return names.every((name) => versions[name]) ? versions : null;
  }

  return { readTableVersions };
}

module.exports = { TABLE_VERSIONS_TABLE, createTableVersionRepository };
