const { createHash } = require('crypto');

function normalizeString(value) {
  return String(value || '').trim();
}

function safeParseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeParseJsonArray(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function getChunkMetaKey(baseKey) {
  return `${normalizeString(baseKey)}_chunks_v1`;
}

function getChunkPrefix(baseKey) {
  return `${normalizeString(baseKey)}_chunk_`;
}

function readChunkedStateValue(values, baseKey) {
  const stateValues = values && typeof values === 'object' ? values : {};
  const normalizedKey = normalizeString(baseKey);
  const fallback = typeof stateValues[normalizedKey] === 'string' ? stateValues[normalizedKey] : '';
  const metaRaw = normalizeString(stateValues[getChunkMetaKey(normalizedKey)]);
  if (!metaRaw) return fallback;

  try {
    const meta = JSON.parse(metaRaw);
    const count = Math.max(0, Math.min(200, Number(meta && meta.count) || 0));
    if (!count) return fallback;
    const prefix = getChunkPrefix(normalizedKey);
    const chunks = [];
    for (let index = 0; index < count; index += 1) {
      const chunk = stateValues[prefix + index];
      if (typeof chunk !== 'string') return fallback;
      chunks.push(chunk);
    }
    return chunks.join('') || fallback;
  } catch (_error) {
    return fallback;
  }
}

function buildChunkedStatePatch(baseKey, rawValue, chunkSize = 120000) {
  const normalizedKey = normalizeString(baseKey);
  const serialized = String(rawValue || '');
  const safeChunkSize = Math.max(10000, Math.min(180000, Number(chunkSize) || 120000));
  const chunks = [];
  for (let index = 0; index < serialized.length; index += safeChunkSize) {
    chunks.push(serialized.slice(index, index + safeChunkSize));
  }
  if (!chunks.length) chunks.push('');

  const patch = {
    [normalizedKey]: serialized.length <= safeChunkSize ? serialized : '',
    [getChunkMetaKey(normalizedKey)]: JSON.stringify({
      count: chunks.length,
      updatedAt: new Date().toISOString(),
    }),
  };
  const prefix = getChunkPrefix(normalizedKey);
  chunks.forEach((chunk, index) => {
    patch[`${prefix}${index}`] = chunk;
  });
  return patch;
}

function normalizeIdentityPart(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildCustomerIdentityKey(customer = {}) {
  return [
    normalizeIdentityPart(customer.bedrijf || customer.company || customer.companyName),
    normalizeIdentityPart(customer.naam || customer.contact || customer.contactName),
    normalizeIdentityPart(customer.tel || customer.telefoon || customer.phone || customer.contactPhone),
  ].join('|');
}

function stableHash(value, length = 24) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function resolveRecordId(raw = {}, fallbackPrefix = 'record') {
  const explicit = normalizeString(raw.id || raw.customerId || raw.orderId);
  if (explicit) return explicit.slice(0, 160);
  const identity = buildCustomerIdentityKey(raw) || JSON.stringify(raw || {});
  return `${fallbackPrefix}_${stableHash(identity || Date.now())}`;
}

function parseImageDataUrl(value) {
  const raw = normalizeString(value).replace(/\s+/g, '');
  const match = raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  return {
    buffer,
    contentHash: stableHash(buffer.toString('base64'), 64),
    dataUrl: `data:${match[1].toLowerCase()};base64,${match[2]}`,
    mimeType: match[1].toLowerCase(),
  };
}

function extensionForMimeType(mimeType) {
  const normalized = normalizeString(mimeType).toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return 'jpg';
}

function sanitizeStorageSegment(value, fallback = 'item') {
  return (
    normalizeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}

module.exports = {
  buildChunkedStatePatch,
  buildCustomerIdentityKey,
  extensionForMimeType,
  getChunkMetaKey,
  getChunkPrefix,
  normalizeString,
  parseImageDataUrl,
  readChunkedStateValue,
  resolveRecordId,
  safeParseJsonArray,
  safeParseJsonObject,
  sanitizeStorageSegment,
  stableHash,
};
