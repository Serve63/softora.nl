const { gzip } = require('node:zlib');
const { promisify } = require('node:util');

const gzipAsync = promisify(gzip);
const MAX_ARCHIVE_BYTES = 3_500_000;

async function encodePremiumDatabaseSnapshotArchive(payload, maxBytes = MAX_ARCHIVE_BYTES) {
  const json = JSON.stringify(payload);
  const buffer = await gzipAsync(Buffer.from(json, 'utf8'), { level: 6 });
  if (buffer.length > maxBytes) {
    const error = new Error('Mailklare snapshot is te groot voor een enkele respons.');
    error.statusCode = 413;
    throw error;
  }
  return { buffer, uncompressedBytes: Buffer.byteLength(json), compressedBytes: buffer.length };
}

function createPremiumDatabaseSnapshotArchiveResponder({ buildSnapshot, nowMs, logger, source }) {
  return async function sendMailReadySnapshotArchiveResponse(_req, res) {
    const startedAt = nowMs();
    try {
      const payload = await buildSnapshot({
        allRows: true,
        includeFoundSnapshot: true,
        allowStaleWhileRefreshing: true,
      });
      const loadedAt = nowMs();
      const archive = await encodePremiumDatabaseSnapshotArchive(payload);
      const encodedAt = nowMs();
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(archive.compressedBytes));
      res.setHeader('Server-Timing', `snapshot;dur=${loadedAt - startedAt}, encode;dur=${encodedAt - loadedAt}`);
      logger?.info?.(JSON.stringify({ event: 'premium-snapshot-archive', loadMs: loadedAt - startedAt,
        encodeMs: encodedAt - loadedAt, compressedBytes: archive.compressedBytes,
        uncompressedBytes: archive.uncompressedBytes }));
      return res.status(200).end(archive.buffer);
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500;
      logger?.warn?.('[PremiumDatabaseMailReadySnapshot][archive-response]', error?.message || error);
      return res.status(statusCode).json({ ok: false, source,
        error: String(error?.message || 'Mailklare snapshot kon niet laden.').trim().slice(0, 240) });
    }
  };
}

module.exports = { encodePremiumDatabaseSnapshotArchive, createPremiumDatabaseSnapshotArchiveResponder, MAX_ARCHIVE_BYTES };
