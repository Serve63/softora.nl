'use strict';

// Pure helper om te bepalen welk (updatedAt, updatedAtMs)-paar een call-update moet krijgen
// bij insert/merge. De regel: gebruik alleen échte call-tijdstempels (updatedAtMs, updatedAt,
// endedAt of startedAt uit de binnenkomende update). Val NIET stilzwijgend terug op
// `Date.now()` bij een passieve hydrate/sync, anders ziet het lead-filtersysteem elke
// refresh als "nieuwere activiteit" en komen eerder verwijderde leads ten onrechte terug.
//
// Contract:
//   - Nieuwe call (geen existing) met echte timestamp → die timestamp wordt overgenomen.
//   - Nieuwe call zonder enige timestamp → val terug op `nowMs()` zodat de volgorde stabiel blijft.
//   - Bestaande call + incoming mét echte timestamp → neem `max(incoming, existing)`.
//   - Bestaande call + incoming zonder echte timestamp → behoud `existing` ongewijzigd.

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function parseIsoToMs(value) {
  const text = normalizeString(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveCallUpdateTimestamp(incoming = {}, existing = null, options = {}) {
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : () => Date.now();

  const incomingUpdatedAtMsRaw = Number(incoming?.updatedAtMs || 0);
  const incomingUpdatedAt = normalizeString(incoming?.updatedAt || '');
  const incomingEndedAt = normalizeString(incoming?.endedAt || '');
  const incomingStartedAt = normalizeString(incoming?.startedAt || '');

  const incomingUpdatedAtMs =
    Number.isFinite(incomingUpdatedAtMsRaw) && incomingUpdatedAtMsRaw > 0
      ? incomingUpdatedAtMsRaw
      : parseIsoToMs(incomingUpdatedAt) ||
        parseIsoToMs(incomingEndedAt) ||
        parseIsoToMs(incomingStartedAt);

  const incomingUpdatedAtIso =
    incomingUpdatedAt ||
    incomingEndedAt ||
    incomingStartedAt ||
    (incomingUpdatedAtMs > 0 ? new Date(incomingUpdatedAtMs).toISOString() : '');

  const existingUpdatedAtMs = Number(existing?.updatedAtMs || 0);
  const existingUpdatedAt = normalizeString(existing?.updatedAt || '');
  const hasExistingTimestamp = Number.isFinite(existingUpdatedAtMs) && existingUpdatedAtMs > 0;

  let resolvedUpdatedAtMs;
  let resolvedUpdatedAt;

  if (incomingUpdatedAtMs > 0) {
    if (hasExistingTimestamp && existingUpdatedAtMs > incomingUpdatedAtMs) {
      resolvedUpdatedAtMs = existingUpdatedAtMs;
      resolvedUpdatedAt = existingUpdatedAt || incomingUpdatedAtIso || new Date(existingUpdatedAtMs).toISOString();
    } else {
      resolvedUpdatedAtMs = incomingUpdatedAtMs;
      resolvedUpdatedAt = incomingUpdatedAtIso || new Date(incomingUpdatedAtMs).toISOString();
    }
  } else if (hasExistingTimestamp) {
    resolvedUpdatedAtMs = existingUpdatedAtMs;
    resolvedUpdatedAt = existingUpdatedAt || new Date(existingUpdatedAtMs).toISOString();
  } else {
    resolvedUpdatedAtMs = nowMs();
    resolvedUpdatedAt = new Date(resolvedUpdatedAtMs).toISOString();
  }

  return {
    updatedAt: resolvedUpdatedAt,
    updatedAtMs: resolvedUpdatedAtMs,
  };
}

module.exports = {
  resolveCallUpdateTimestamp,
};
