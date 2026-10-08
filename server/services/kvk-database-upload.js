const { createKvkTransferInventory } = require('./kvk-transfer-inventory');
const RECEIPTS = 'softora_kvk_upload_receipts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createKvkDatabaseUploadService({ getSupabaseClient, getUiStateValues, refreshDestination = () => {}, logger = console } = {}) {
  function client() {
    const value = getSupabaseClient?.({ timeoutMs: 120000, ignoreFailureCooldown: true });
    if (!value) throw new Error('Database niet beschikbaar.');
    return value;
  }
  const inventory = createKvkTransferInventory({ getClient: client, getUiStateValues });
  async function finishCommittedUpload(res, result, replayed = false) {
    let snapshotReady = true;
    try { await refreshDestination(); }
    catch (error) {
      snapshotReady = false;
      logger.warn?.('[KvkUpload][destination-refresh]', error?.message || 'Refresh unavailable');
    }
    return res.json({ ok: true, ...result, replayed, snapshotReady });
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
        if (receipt.data) {
          if (receipt.data.result?.count !== amount) return res.status(409).json({ ok: false, error: 'Deze uploadcode hoort bij een ander aantal bedrijven.' });
          inventory.invalidate();
          return finishCommittedUpload(res, receipt.data.result, true);
        }
      }
      if (dryRun) {
        const stock = await inventory.read({ fresh: true });
        return res.json({ ok: true, count: stock.count, destination: 'available', requestId: null,
          withoutWebsiteCount: stock.withoutWebsiteRows.length,
          sourceCount: stock.sourceCount, excludedCount: stock.excludedCount, exclusions: stock.exclusions });
      }
      const { candidates: rows } = await inventory.load(db);
      const { data, error } = await db.rpc('softora_kvk_upload_available_counted', {
        p_request_id: requestId, p_mode: mode, p_dry_run: dryRun, p_candidates: rows, p_limit: amount,
      });
      if (error?.code === 'P0002') return res.status(409).json({ ok: false, error: 'Er zijn minder bedrijven beschikbaar dan het gekozen aantal. Open het venster opnieuw en kies een lager aantal.' });
      if (error?.code === 'P0003') return res.status(409).json({ ok: false, error: 'Deze uploadcode hoort bij een ander aantal bedrijven.' });
      if (error || !data || typeof data.count !== 'number') throw new Error('Upload kon niet worden bevestigd. Probeer opnieuw; dezelfde upload wordt niet dubbel uitgevoerd.');
      inventory.invalidate();
      return finishCommittedUpload(res, data);
    } catch (error) {
      return res.status(503).json({ ok: false, error: error.message || 'Upload tijdelijk niet beschikbaar.' });
    }
  }
  return { readInventory: inventory.read, preview: (req, res) => execute(req, res, true), upload: (req, res) => execute(req, res, false) };
}
module.exports = { createKvkDatabaseUploadService };
