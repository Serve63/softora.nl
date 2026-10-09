const { createHash } = require('node:crypto');

const PART_BYTES = 750000;
const MAX_BYTES = 32000000;
const MAX_AGE_MS = 120000;

function describeArchive(buffer, nowMs) {
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('Klantdatabase-archief overschrijdt de veilige overdrachtsgrens.'), { statusCode: 413 });
  return { version: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length,
    count: Math.ceil(buffer.length / PART_BYTES), createdAt: nowMs };
}

function sendArchivePart(req, res, archive, nowMs) {
  const part = Number(req.query.part);
  const descriptor = archive.parts;
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!/^(0|[1-9]\d*)$/.test(String(req.query.part)) || !Number.isSafeInteger(part) || part >= descriptor.count) {
    return res.status(400).json({ ok: false, error: 'Ongeldig archiefdeel.' });
  }
  if (String(req.query.version || '') !== descriptor.version || nowMs - descriptor.createdAt > MAX_AGE_MS) {
    return res.status(409).json({ ok: false, error: 'Archiefversie verlopen; laad de volledige database opnieuw.' });
  }
  return res.status(200).json({ ok: true, archivePart: { ...descriptor, index: part,
    data: archive.buffer.subarray(part * PART_BYTES, (part + 1) * PART_BYTES).toString('base64') } });
}

module.exports = { describeArchive, sendArchivePart, PART_BYTES, MAX_BYTES };
