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
    ['registered', 'design_pending'].includes(status) &&
    sourceId === selection.sourceId &&
    (!selection.fileDigest || fileDigest === selection.fileDigest)
  );
}

function buildInstantlyInsufficientUploadResult({ available, requested, failed, campaignId, finishedAt }) {
  return {
    ok: true,
    skipped: true,
    reason: available > 0 ? 'insufficient_eligible_leads' : 'no_eligible_leads',
    message: `Zet eerst genoeg mail-ready leads klaar. Gevraagd: ${requested}, veilig klaar: ${available}.`,
    prepared: 0,
    available,
    requested,
    failed,
    campaignId,
    finishedAt,
  };
}

module.exports = {
  buildInstantlyInsufficientUploadResult,
  buildInstantlyQueueSelectionContext,
  isInstantlyQueueSelectionMatch,
};
