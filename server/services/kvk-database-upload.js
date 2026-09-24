const { buildCustomerIdentityKey } = require('./data-ops-serialization');
const { getIdentityKeyRows } = require('./outbound-recipient-guard-store');
const { legacyGuardEntriesToKeySet, COLDMAIL_SEND_GUARD_SCOPE, COLDMAIL_SEND_GUARD_KEY } = require('./premium-database-mail-ready-snapshot');
const RECEIPTS = 'softora_kvk_upload_receipts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createKvkDatabaseUploadService({ getSupabaseClient, getUiStateValues, refreshDestination = () => {} } = {}) {
  function client() {
    const value = getSupabaseClient?.({ timeoutMs: 120000, ignoreFailureCooldown: true });
    if (!value) throw new Error('Database niet beschikbaar.');
    return value;
  }
  async function candidates(db) {
    const state = await getUiStateValues(COLDMAIL_SEND_GUARD_SCOPE, { preferSupabaseRestRead: true, ignoreSupabaseRestFailureCooldown: true });
    if (!state?.values || typeof state.values !== 'object') throw new Error('Bestaande gebruiksgegevens niet beschikbaar.');
    const raw = state.values[COLDMAIL_SEND_GUARD_KEY];
    const guards = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
    const blocked = legacyGuardEntriesToKeySet([...(guards.entries || []), ...(guards.recipientEntries || [])]);
    const result = [];
    let after = 0;
    for (;;) {
      const { data, error } = await db.from('softora_kvk_unused_company_directory')
        .select('source_company_id,kvk_nummer,bedrijfsnaam,telefoonnummer,email,website')
        .neq('website_status', 'no_website').neq('website_status', 'not_working').neq('website', '')
        .gt('source_company_id', after).order('source_company_id', { ascending: true }).limit(1000);
      if (error || !Array.isArray(data)) throw new Error('Uploadvoorraad kon niet worden geladen.');
      for (const row of data) {
        const keys = getIdentityKeyRows({ recipientEmail: row.email, recipientDomain: row.website, recipientCompany: row.bedrijfsnaam }).map(item => item.guardKey);
        if (!keys.some(key => blocked.has(key))) result.push({ source_company_id: row.source_company_id,
          identity_key: buildCustomerIdentityKey({ bedrijf: row.bedrijfsnaam, naam: row.bedrijfsnaam, tel: row.telefoonnummer }), guard_keys: keys });
      }
      if (data.length < 1000) return result;
      after = Number(data[data.length - 1].source_company_id);
      if (result.length > 50000) throw new Error('De uploadvoorraad is te groot voor één upload.');
    }
  }
  async function execute(req, res, dryRun) {
    res.setHeader?.('Cache-Control', 'no-store');
    const mode = dryRun ? 'with-website' : req.body?.mode;
    const requestId = dryRun ? null : req.body?.requestId;
    if (mode !== 'with-website' || (!dryRun && !UUID.test(String(requestId || '')))) {
      return res.status(400).json({ ok: false, error: 'Alleen uploaden met website is beschikbaar. Een geldige uploadcode is vereist.' });
    }
    const amount = dryRun ? null : req.body?.count;
    if (!dryRun && (!Number.isInteger(amount) || amount < 1 || amount > 50000)) {
      return res.status(400).json({ ok: false, error: 'Vul een heel aantal van 1 tot 50.000 in.' });
    }
    try {
      const db = client();
      if (!dryRun) {
        const receipt = await db.from(RECEIPTS).select('result').eq('request_id', requestId).maybeSingle();
        if (receipt.error) throw new Error('Uploadstatus kon niet worden gecontroleerd.');
        if (receipt.data) { await refreshDestination(); return res.json({ ok: true, ...receipt.data.result, replayed: true }); }
      }
      const rows = await candidates(db);
      const { data, error } = await db.rpc('softora_kvk_upload_available_counted', {
        p_request_id: requestId, p_mode: mode, p_dry_run: dryRun, p_candidates: rows, p_limit: amount,
      });
      if (error?.code === 'P0002') return res.status(409).json({ ok: false, error: 'Er zijn minder bedrijven beschikbaar dan het gekozen aantal. Open het venster opnieuw en kies een lager aantal.' });
      if (error || !data || typeof data.count !== 'number') throw new Error('Upload kon niet worden bevestigd. Probeer opnieuw; dezelfde upload wordt niet dubbel uitgevoerd.');
      if (!dryRun) await refreshDestination();
      return res.json({ ok: true, ...data });
    } catch (error) {
      return res.status(503).json({ ok: false, error: error.message || 'Upload tijdelijk niet beschikbaar.' });
    }
  }
  return { preview: (req, res) => execute(req, res, true), upload: (req, res) => execute(req, res, false) };
}
module.exports = { createKvkDatabaseUploadService };
