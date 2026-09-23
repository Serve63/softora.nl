const { gzip } = require('node:zlib');
const { promisify } = require('node:util');

const gzipAsync = promisify(gzip);
const PAGE_LIMIT = 1000;
const PAGE_CONCURRENCY = 4;
const MAX_CUSTOMERS = 25000;
const MAX_ARCHIVE_BYTES = 3500000;

function createPremiumDatabaseCustomersArchiveResponder({ dataOpsStore, nowMs = Date.now, logger = console }) {
  let cachedArchive = null;
  let buildSequence = 0;

  async function readPage(offset, limit, metaOnly = false) {
    const page = await dataOpsStore.listCustomersPage({
      offset, limit, metaOnly,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: false,
    });
    if (!page) throw new Error('De officiële klantdatabase kon niet volledig worden gelezen.');
    return page;
  }

  async function buildArchive(startedAt) {
    const first = await readPage(0, PAGE_LIMIT);
    const total = Number(first.total);
    if (!Number.isInteger(total) || total < 0 || total > MAX_CUSTOMERS) {
      throw new Error('Klantdatabase heeft geen veilige volledige telling.');
    }
    const pages = new Map([[0, first.customers]]);
    const offsets = [];
    for (let offset = PAGE_LIMIT; offset < total; offset += PAGE_LIMIT) offsets.push(offset);
    let cursor = 0;
    async function worker() {
      while (cursor < offsets.length) {
        const offset = offsets[cursor++];
        const page = await readPage(offset, PAGE_LIMIT);
        pages.set(offset, page.customers);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
    const customers = [];
    const seen = new Set();
    for (let offset = 0; offset < total; offset += PAGE_LIMIT) {
      const rows = pages.get(offset);
      if (!Array.isArray(rows) || rows.length !== Math.min(PAGE_LIMIT, total - offset)) {
        throw new Error('Klantdatabase-archief bevat een onvolledige pagina.');
      }
      for (const customer of rows) {
        const id = String(customer && customer.id || '').trim();
        if (!id || seen.has(id)) throw new Error('Klantdatabase-archief bevat dubbele of ongeldige klanten.');
        seen.add(id);
        customers.push(customer);
      }
    }
    const finalMeta = await readPage(0, 1, true);
    const version = String(first.snapshotVersion || '').trim();
    if (!version || finalMeta.total !== total || String(finalMeta.snapshotVersion || '').trim() !== version) {
      throw new Error('Klantdatabase wijzigde tijdens het archiveren.');
    }
    const loadedAt = nowMs();
    const json = JSON.stringify({ ok: true, source: 'canonical-customers-archive', completeDataset: true,
      customers, total, snapshotVersion: version });
    const buffer = await gzipAsync(Buffer.from(json, 'utf8'), { level: 6 });
    if (buffer.length > MAX_ARCHIVE_BYTES) {
      const error = new Error('Klantdatabase-archief is te groot voor een enkele respons.');
      error.statusCode = 413;
      throw error;
    }
    const encodedAt = nowMs();
    return { buffer, total, version, loadMs: loadedAt - startedAt, encodeMs: encodedAt - loadedAt };
  }

  return async function sendCustomersArchiveResponse(_req, res) {
    if (!dataOpsStore || typeof dataOpsStore.listCustomersPage !== 'function') {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase is tijdelijk niet beschikbaar.' });
    }
    const startedAt = nowMs();
    try {
      let archive = cachedArchive;
      let cacheHit = false;
      if (archive) {
        const meta = await readPage(0, 1, true);
        cacheHit = Number(meta.total) === archive.total && String(meta.snapshotVersion || '').trim() === archive.version;
        if (!cacheHit) { cachedArchive = null; archive = null; }
      }
      if (!archive) {
        const buildId = ++buildSequence;
        archive = await buildArchive(startedAt);
        if (buildId === buildSequence) cachedArchive = archive;
      }
      const loadMs = cacheHit ? nowMs() - startedAt : archive.loadMs;
      const encodeMs = cacheHit ? 0 : archive.encodeMs;
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(archive.buffer.length));
      res.setHeader('Server-Timing', `customers;dur=${loadMs}, encode;dur=${encodeMs}, cache;desc=${cacheHit ? 'hit' : 'miss'}`);
      logger?.info?.(JSON.stringify({ event: 'premium-customers-archive', loadMs,
        encodeMs, compressedBytes: archive.buffer.length, total: archive.total, cacheHit }));
      return res.status(200).end(archive.buffer);
    } catch (error) {
      logger?.warn?.('[PremiumDatabaseCustomers][archive-response]', error?.message || error);
      return res.status(Number(error && error.statusCode) || 503).json({ ok: false,
        error: String(error?.message || 'Klantdatabase-archief kon niet laden.').trim().slice(0, 240) });
    }
  };
}

module.exports = { createPremiumDatabaseCustomersArchiveResponder, MAX_ARCHIVE_BYTES };
