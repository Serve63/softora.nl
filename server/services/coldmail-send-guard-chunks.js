const crypto = require('node:crypto');

const STORAGE_FORMAT = 'softora-coldmail-send-guard-chunks-v1';
const CHUNK_KEY_PREFIX = 'softora_coldmail_send_guard_chunk_';
const DEFAULT_CHUNK_THRESHOLD = 900000;
const DEFAULT_CHUNK_SIZE = 180000;
const DEFAULT_MAX_CHUNKS = 100;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function isChunkKey(key) {
  return String(key || '').startsWith(CHUNK_KEY_PREFIX);
}

function withoutChunks(values) {
  return Object.fromEntries(
    Object.entries(values && typeof values === 'object' ? values : {})
      .filter(([key]) => !isChunkKey(key))
  );
}

function restoreColdmailSendGuardValues(values, guardKey, options = {}) {
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const raw = String(source[guardKey] || '');
  const manifest = parseObject(raw);
  if (!manifest || manifest.storageFormat !== STORAGE_FORMAT) {
    return { ok: true, values: { ...source }, raw, chunked: false };
  }

  const chunkKeys = Array.isArray(manifest.chunkKeys) ? manifest.chunkKeys.map(String) : [];
  const maxChunks = Number(options.maxChunks) || DEFAULT_MAX_CHUNKS;
  if (!chunkKeys.length || chunkKeys.length > maxChunks || chunkKeys.some((key) => !isChunkKey(key))) {
    return { ok: false, error: 'Coldmail send-guard manifest bevat een ongeldige chunklijst.' };
  }
  const missing = chunkKeys.filter((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (missing.length) {
    return { ok: false, error: `Coldmail send-guard mist ${missing.length} opslagchunk(s).` };
  }

  const restoredRaw = chunkKeys.map((key) => String(source[key] || '')).join('');
  if (Number(manifest.serializedLength) !== restoredRaw.length || String(manifest.sha256 || '') !== sha256(restoredRaw)) {
    return { ok: false, error: 'Coldmail send-guard chunkintegriteit klopt niet.' };
  }
  if (!parseObject(restoredRaw)) {
    return { ok: false, error: 'Coldmail send-guard chunks vormen geen geldige JSON-state.' };
  }

  return {
    ok: true,
    values: { ...withoutChunks(source), [guardKey]: restoredRaw },
    raw: restoredRaw,
    chunked: true,
  };
}

function persistColdmailSendGuardValues(values, guardKey, rawGuard, options = {}) {
  const raw = String(rawGuard || '');
  if (!parseObject(raw)) {
    return { ok: false, error: 'Coldmail send-guard is geen geldige JSON-state.' };
  }
  const base = withoutChunks(values);
  const threshold = Number(options.threshold) || DEFAULT_CHUNK_THRESHOLD;
  if (raw.length <= threshold) {
    return { ok: true, values: { ...base, [guardKey]: raw }, chunked: false };
  }

  const chunkSize = Number(options.chunkSize) || DEFAULT_CHUNK_SIZE;
  const chunks = [];
  for (let offset = 0; offset < raw.length; offset += chunkSize) {
    chunks.push(raw.slice(offset, offset + chunkSize));
  }
  const maxChunks = Number(options.maxChunks) || DEFAULT_MAX_CHUNKS;
  if (chunks.length > maxChunks) {
    return { ok: false, error: `Coldmail send-guard heeft ${chunks.length} chunks nodig; limiet is ${maxChunks}.` };
  }

  const chunkKeys = chunks.map((_, index) => `${CHUNK_KEY_PREFIX}${String(index + 1).padStart(4, '0')}`);
  const manifest = JSON.stringify({
    storageFormat: STORAGE_FORMAT,
    chunkKeys,
    serializedLength: raw.length,
    sha256: sha256(raw),
  });
  const persisted = { ...base, [guardKey]: manifest };
  chunkKeys.forEach((key, index) => {
    persisted[key] = chunks[index];
  });
  return { ok: true, values: persisted, chunked: true, chunkCount: chunks.length };
}

module.exports = {
  CHUNK_KEY_PREFIX,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_THRESHOLD,
  STORAGE_FORMAT,
  persistColdmailSendGuardValues,
  restoreColdmailSendGuardValues,
};
