function normalizeInstantlyQueueSelection(input = {}, normalizeString = (value) => String(value || '').trim()) {
  const sourceId = normalizeString(input.queueSourceId);
  const fileDigest = normalizeString(input.queueFileDigest).toLowerCase();
  return {
    sourceId,
    fileDigest,
    hasValidDigest: !fileDigest || /^[a-f0-9]{64}$/.test(fileDigest),
  };
}

function buildInstantlyQueueSelectionContext(
  context,
  input,
  normalizeString,
  createError
) {
  const queueSelection = normalizeInstantlyQueueSelection(input, normalizeString);
  if (!queueSelection.hasValidDigest) {
    throw createError(
      'De SHA-256 vingerafdruk van de geregistreerde sheetbron is ongeldig.',
      'INSTANTLY_QUEUE_DIGEST_INVALID',
      400
    );
  }
  return { ...context, queueSelection };
}

function isInstantlyQueueSelectionMatch(
  row,
  context = {},
  normalizeString = (value) => String(value || '').trim()
) {
  const selection = context.queueSelection || {};
  if (!selection.sourceId) return true;
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  const status = normalizeString(row && (row.instantlyQueueStatus || payload.instantlyQueueStatus)).toLowerCase();
  const sourceId = normalizeString(row && (row.instantlyQueueSource || payload.instantlyQueueSource));
  const fileDigest = normalizeString(
    row && (row.instantlyQueueFileDigest || payload.instantlyQueueFileDigest)
  ).toLowerCase();
  return (
    status === 'registered' &&
    sourceId === selection.sourceId &&
    (!selection.fileDigest || fileDigest === selection.fileDigest)
  );
}

module.exports = {
  buildInstantlyQueueSelectionContext,
  isInstantlyQueueSelectionMatch,
};
