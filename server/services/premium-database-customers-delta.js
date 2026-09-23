// Returns only the customers that changed after the browser's cursor. The
// browser keeps the last verified archive and merges this delta, so a normal
// opening reads a few rows instead of the full 20k-row archive.
const DELTA_LIMIT = 5000;
// updated_at comes from application clocks; the overlap re-sends recent rows so
// a write that committed slightly after its timestamp can never be skipped.
const CURSOR_OVERLAP_MS = 10 * 60 * 1000;
const MAX_CURSOR_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CURSOR_SKEW_MS = 5 * 60 * 1000;
const MAX_CUSTOMERS = 25000;
const READ_OPTIONS = Object.freeze({
  bypassReadFailureCooldown: true,
  suppressReadFailureCooldown: true,
  suppressTransientReadFailureLog: false,
});

function createPremiumDatabaseCustomersDeltaResponder({ dataOpsStore, nowMs = Date.now, logger = console }) {
  async function readMeta() {
    const page = await dataOpsStore.listCustomersPage({ offset: 0, limit: 1, metaOnly: true, ...READ_OPTIONS });
    const total = Number(page && page.total);
    const version = String(page && page.snapshotVersion || '').trim();
    if (!page || !Number.isInteger(total) || total < 0 || total > MAX_CUSTOMERS || !version) {
      throw new Error('Klantdatabase heeft geen veilige volledige telling.');
    }
    return { total, version };
  }

  function splitChanges(changes) {
    const upserts = [];
    const deletedIds = [];
    const seen = new Set();
    for (const change of changes) {
      const id = String(change && change.id || '').trim();
      if (!id || seen.has(id)) throw new Error('Klantdatabase-delta bevat dubbele of ongeldige klanten.');
      seen.add(id);
      if (change.deleted) deletedIds.push(id);
      else if (change.customer && String(change.customer.id || '').trim() === id) upserts.push(change.customer);
      else throw new Error('Klantdatabase-delta bevat een onvolledige klant.');
    }
    return { upserts, deletedIds };
  }

  return async function sendCustomersDeltaResponse(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vary', 'Cookie');
    if (!dataOpsStore || typeof dataOpsStore.listCustomersChangedSince !== 'function'
      || typeof dataOpsStore.listCustomersPage !== 'function') {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase is tijdelijk niet beschikbaar.' });
    }
    const startedAt = nowMs();
    const since = String(req?.query?.since || '').trim();
    const sinceMs = Date.parse(since);
    if (!since || since.length > 64 || !Number.isFinite(sinceMs) || sinceMs > startedAt + MAX_CURSOR_SKEW_MS) {
      return res.status(400).json({ ok: false, error: 'Ongeldige klantdatabase-versie.' });
    }
    if (startedAt - sinceMs > MAX_CURSOR_AGE_MS) {
      return res.status(200).json({ ok: true, resync: true, reason: 'cursor-expired' });
    }
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const before = await readMeta();
        const changes = await dataOpsStore.listCustomersChangedSince({
          since: new Date(sinceMs - CURSOR_OVERLAP_MS).toISOString(),
          limit: DELTA_LIMIT + 1,
          ...READ_OPTIONS,
        });
        if (!Array.isArray(changes)) throw new Error('Klantdatabase-wijzigingen konden niet worden gelezen.');
        if (changes.length > DELTA_LIMIT) {
          return res.status(200).json({ ok: true, resync: true, reason: 'too-many-changes' });
        }
        const after = await readMeta();
        if (before.total !== after.total || before.version !== after.version) continue;
        const { upserts, deletedIds } = splitChanges(changes);
        const loadMs = nowMs() - startedAt;
        res.setHeader('Server-Timing', `customers-delta;dur=${loadMs}`);
        logger?.info?.(JSON.stringify({ event: 'premium-customers-delta', loadMs,
          upserts: upserts.length, deletes: deletedIds.length, total: after.total, attempt }));
        return res.status(200).json({ ok: true, source: 'canonical-customers-delta', completeDelta: true,
          total: after.total, snapshotVersion: after.version, upserts, deletedIds });
      }
      throw new Error('Klantdatabase wijzigde tijdens het bijwerken.');
    } catch (error) {
      logger?.warn?.('[PremiumDatabaseCustomers][delta-response]', error?.message || error);
      return res.status(503).json({ ok: false,
        error: String(error?.message || 'Klantdatabase-wijzigingen konden niet laden.').trim().slice(0, 240) });
    }
  };
}

module.exports = { createPremiumDatabaseCustomersDeltaResponder, CURSOR_OVERLAP_MS, DELTA_LIMIT };
