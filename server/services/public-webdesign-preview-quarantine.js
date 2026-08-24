function normalizeString(value) {
  return String(value || '').trim();
}

function findPermanentSentPreviewGuard(contexts, customerId) {
  const normalizedCustomerId = normalizeString(customerId).toLowerCase();
  if (!normalizedCustomerId) return null;
  return (Array.isArray(contexts) ? contexts : []).find((context) =>
    normalizeString(context && context.status).toLowerCase() === 'sent' &&
      context && context.permanent === true &&
      Boolean(normalizeString(context.sender_email || context.senderEmail)) &&
      normalizeString(context.recipient_id || context.recipientId).toLowerCase() === normalizedCustomerId
  ) || null;
}

async function listSentQuarantinedPreviewEntries(options = {}) {
  const customerId = normalizeString(options.customerId);
  const dataOpsStore = options.dataOpsStore;
  if (
    !findPermanentSentPreviewGuard(options.outboundContexts, customerId) ||
    !dataOpsStore ||
    typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function'
  ) {
    return [];
  }
  return dataOpsStore.listDesignPhotosWithSignedUrls({
    ...(options.readOptions && typeof options.readOptions === 'object' ? options.readOptions : {}),
    expiresInSeconds: options.expiresInSeconds,
    identifiers: [customerId],
    maxMatches: options.maxMatches,
    includeIncidentQuarantined: true,
  });
}

module.exports = {
  findPermanentSentPreviewGuard,
  listSentQuarantinedPreviewEntries,
};
