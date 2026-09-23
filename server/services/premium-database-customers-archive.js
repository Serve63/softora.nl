const { gzip } = require('node:zlib');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');

const gzipAsync = promisify(gzip);
const PAGE_LIMIT = 1000;
const CHUNK_LIMIT = 5000;
const PAGE_CONCURRENCY = 4;
const MAX_CUSTOMERS = 25000;
const MAX_ARCHIVE_BYTES = 3500000;
const ARCHIVE_CACHE_CONTROL = 'private, no-cache, max-age=0, must-revalidate';

function archiveEtag(total, version) {
  const digest = createHash('sha256').update(`${total}:${version}`).digest('hex').slice(0, 32);
  return `"softora-customers-v1-${digest}"`;
}

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

  function validatedTotal(page) {
    const total = Number(page.total);
    if (!Number.isInteger(total) || total < 0 || total > MAX_CUSTOMERS) {
      throw new Error('Klantdatabase heeft geen veilige volledige telling.');
    }
    return total;
  }

  function assemblePages(pages, total, pageLimit) {
    const customers = [];
    const seen = new Set();
    for (let offset = 0; offset < total; offset += pageLimit) {
      const rows = pages.get(offset);
      if (!Array.isArray(rows) || rows.length !== Math.min(pageLimit, total - offset)) {
        throw new Error('Klantdatabase-archief bevat een onvolledige pagina.');
      }
      for (const customer of rows) {
        const id = String(customer && customer.id || '').trim();
        if (!id || seen.has(id)) throw new Error('Klantdatabase-archief bevat dubbele of ongeldige klanten.');
        seen.add(id);
        customers.push(customer);
      }
    }
    return customers;
  }

  async function encodeArchive(customers, total, version, startedAt, method) {
    const finalMeta = await readPage(0, 1, true);
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
    return { buffer, total, version, method, loadMs: loadedAt - startedAt, encodeMs: encodedAt - loadedAt };
  }

  async function buildArchiveWithPages(startedAt) {
    const first = await readPage(0, PAGE_LIMIT);
    const total = validatedTotal(first);
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
    const version = String(first.snapshotVersion || '').trim();
    return encodeArchive(assemblePages(pages, total, PAGE_LIMIT), total, version, startedAt, 'pages');
  }

  async function buildArchiveWithChunks(startedAt) {
    const firstMeta = await readPage(0, 1, true);
    const total = validatedTotal(firstMeta);
    const version = String(firstMeta.snapshotVersion || '').trim();
    if (!version) throw new Error('Klantdatabase heeft geen veilige versie.');
    const readChunk = async (offset) => {
      const customers = await dataOpsStore.listCustomersArchiveChunk({
        offset, limit: CHUNK_LIMIT,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: false,
      });
      if (!Array.isArray(customers)) throw new Error('Klantdatabase-chunk kon niet worden gelezen.');
      return customers;
    };
    const pages = new Map();
    if (total) pages.set(0, await readChunk(0));
    const offsets = [];
    for (let offset = CHUNK_LIMIT; offset < total; offset += CHUNK_LIMIT) offsets.push(offset);
    let cursor = 0;
    async function worker() {
      while (cursor < offsets.length) {
        const offset = offsets[cursor++];
        pages.set(offset, await readChunk(offset));
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
    return encodeArchive(assemblePages(pages, total, CHUNK_LIMIT), total, version, startedAt, 'chunks');
  }

  async function buildArchive(startedAt) {
    if (typeof dataOpsStore.listCustomersArchiveChunk === 'function') {
      try {
        return await buildArchiveWithChunks(startedAt);
      } catch (error) {
        logger?.warn?.('[PremiumDatabaseCustomers][chunk-fallback]', error?.message || error);
      }
    }
    return buildArchiveWithPages(startedAt);
  }

  return async function sendCustomersArchiveResponse(req, res) {
    if (!dataOpsStore || typeof dataOpsStore.listCustomersPage !== 'function') {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase is tijdelijk niet beschikbaar.' });
    }
    const startedAt = nowMs();
    try {
      let archive = cachedArchive;
      let cacheHit = false;
      const requestedTag = String(req?.get?.('If-None-Match')
        || req?.headers?.['if-none-match'] || req?.headers?.['If-None-Match'] || '').trim();
      if (archive || requestedTag) {
        const meta = await readPage(0, 1, true);
        const total = validatedTotal(meta);
        const version = String(meta.snapshotVersion || '').trim();
        cacheHit = Boolean(archive && total === archive.total && version === archive.version);
        if (archive && !cacheHit) { cachedArchive = null; archive = null; }
        if (version && requestedTag.split(',').some((tag) => tag.trim() === archiveEtag(total, version))) {
          res.setHeader('Cache-Control', ARCHIVE_CACHE_CONTROL);
          res.setHeader('Vary', 'Cookie, Accept-Encoding');
          res.setHeader('ETag', archiveEtag(total, version));
          res.setHeader('Server-Timing', `customers;dur=${nowMs() - startedAt}, cache;desc=revalidated`);
          logger?.info?.(JSON.stringify({ event: 'premium-customers-archive-revalidated',
            total, loadMs: nowMs() - startedAt }));
          return res.status(304).end();
        }
      }
      if (!archive) {
        const buildId = ++buildSequence;
        archive = await buildArchive(startedAt);
        if (buildId === buildSequence) cachedArchive = archive;
      }
      const loadMs = cacheHit ? nowMs() - startedAt : archive.loadMs;
      const encodeMs = cacheHit ? 0 : archive.encodeMs;
      res.setHeader('Cache-Control', ARCHIVE_CACHE_CONTROL);
      res.setHeader('Vary', 'Cookie, Accept-Encoding');
      res.setHeader('ETag', archiveEtag(archive.total, archive.version));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(archive.buffer.length));
      res.setHeader('Server-Timing', `customers;dur=${loadMs}, encode;dur=${encodeMs}, cache;desc=${cacheHit ? 'hit' : 'miss'}`);
      logger?.info?.(JSON.stringify({ event: 'premium-customers-archive', loadMs,
        encodeMs, compressedBytes: archive.buffer.length, total: archive.total, cacheHit,
        method: archive.method, validatorReceived: Boolean(requestedTag),
        validatorMatchedFinal: Boolean(requestedTag && requestedTag.split(',')
          .some((tag) => tag.trim() === archiveEtag(archive.total, archive.version))) }));
      return res.status(200).end(archive.buffer);
    } catch (error) {
      logger?.warn?.('[PremiumDatabaseCustomers][archive-response]', error?.message || error);
      return res.status(Number(error && error.statusCode) || 503).json({ ok: false,
        error: String(error?.message || 'Klantdatabase-archief kon niet laden.').trim().slice(0, 240) });
    }
  };
}

module.exports = { createPremiumDatabaseCustomersArchiveResponder, MAX_ARCHIVE_BYTES };
