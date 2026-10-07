const { buildCustomerIdentityKey } = require('./data-ops-serialization');
const { getIdentityKeyRows } = require('./outbound-recipient-guard-store');
const { legacyGuardEntriesToKeySet, COLDMAIL_SEND_GUARD_SCOPE, COLDMAIL_SEND_GUARD_KEY } = require('./premium-database-mail-ready-snapshot');
const { DIRECTORY_SELECT_COLUMNS, UNUSED_DIRECTORY_VIEW } = require('./kvk-company-directory');

function createKvkTransferInventory({ getClient, getUiStateValues, now = Date.now }) {
  let cached = null, pending = null, generation = 0;
  function invalidate() { generation++; cached = null; pending = null; }
  async function load(db = getClient()) {
    const state = await getUiStateValues(COLDMAIL_SEND_GUARD_SCOPE, { preferSupabaseRestRead: true, ignoreSupabaseRestFailureCooldown: true });
    if (!state?.values || typeof state.values !== 'object') throw new Error('Bestaande gebruiksgegevens niet beschikbaar.');
    const raw = state.values[COLDMAIL_SEND_GUARD_KEY];
    const guards = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
    if (!guards || Array.isArray(guards) || typeof guards !== 'object' ||
      ['entries', 'recipientEntries'].some(key => guards[key] !== undefined && !Array.isArray(guards[key]))) {
      throw new Error('Bestaande gebruiksgegevens zijn ongeldig.');
    }
    const blocked = legacyGuardEntriesToKeySet([...(guards.entries || []), ...(guards.recipientEntries || [])]);
    const websiteRows = [], withoutWebsiteRows = [], candidates = [];
    let after = 0, legacyBlocked = 0;
    for (;;) {
      const { data, error } = await db.from(UNUSED_DIRECTORY_VIEW)
        .select(`${DIRECTORY_SELECT_COLUMNS},search_text`)
        .gt('source_company_id', after).order('source_company_id', { ascending: true }).limit(1000);
      if (error || !Array.isArray(data)) throw new Error('Uploadvoorraad kon niet worden geladen.');
      if (!data.length) break;
      for (const row of data) {
        const sourceId = Number(row.source_company_id);
        if (!Number.isSafeInteger(sourceId) || sourceId <= after) throw new Error('Uploadvoorraad bevat een ongeldige paginavolgorde.');
        after = sourceId;
        if (['no_website', 'not_working'].includes(row.website_status)) { withoutWebsiteRows.push(row); continue; }
        if (row.website_status === null || !row.website) continue;
        websiteRows.push(row);
        const keys = getIdentityKeyRows({ recipientEmail: row.email, recipientDomain: row.website, recipientCompany: row.bedrijfsnaam }).map(item => item.guardKey);
        if (keys.some(key => blocked.has(key))) { legacyBlocked++; continue; }
        candidates.push({ source_company_id: sourceId,
          identity_key: buildCustomerIdentityKey({ bedrijf: row.bedrijfsnaam, naam: row.bedrijfsnaam, tel: row.telefoonnummer }), guard_keys: keys });
        if (candidates.length > 50000) throw new Error('De uploadvoorraad is te groot voor één upload.');
      }
      // Continue until an empty page: the Data API can cap a page below 1,000.
    }
    return { candidates, websiteRows, withoutWebsiteRows, legacyBlocked };
  }
  async function read({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.at < 10000) return cached.value;
    if (!fresh && pending) return pending;
    const current = generation;
    const operation = (async () => {
      const db = getClient();
      const source = await load(db);
      const { data, error } = await db.rpc('softora_kvk_upload_available_counted', {
        p_request_id: null, p_mode: 'with-website', p_dry_run: true, p_candidates: source.candidates, p_limit: null,
      });
      if (error || !Number.isSafeInteger(data?.count) || !Array.isArray(data?.sourceIds) || data.count !== data.sourceIds.length) {
        throw new Error('Veilige uploadvoorraad kon niet worden bevestigd.');
      }
      const ids = new Set(data.sourceIds.map(Number));
      const rows = source.websiteRows.filter(row => ids.has(Number(row.source_company_id)));
      if (ids.size !== data.count || rows.length !== data.count) throw new Error('Veilige uploadvoorraad is tijdens het lezen gewijzigd.');
      const value = { ...source, websiteRows: rows, count: data.count, sourceCount: source.websiteRows.length,
        excludedCount: source.websiteRows.length - data.count,
        exclusions: { ...data.exclusions, previouslyContacted: (data.exclusions?.previouslyContacted || 0) + source.legacyBlocked } };
      if (current === generation) cached = { at: now(), value };
      return value;
    })();
    if (!fresh) pending = operation;
    try { return await operation; } finally { if (pending === operation) pending = null; }
  }
  return { load, read, invalidate };
}
module.exports = { createKvkTransferInventory };
