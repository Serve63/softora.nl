function defaultNormalizeString(value) {
  return String(value || '').trim();
}

async function removeAcceptedCustomerFromMailReadySnapshot(
  customerId,
  snapshotService,
  logger = console,
  normalizeString = defaultNormalizeString
) {
  const id = normalizeString(customerId);
  if (!id || !snapshotService) return;
  let removed = false;
  try {
    if (typeof snapshotService.removeCustomers === 'function') {
      removed = (await snapshotService.removeCustomers([id])) !== false;
    }
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[Coldmail][mail-ready-snapshot-remove]', {
        customerId: id,
        error: error && error.message ? error.message : error,
      });
    }
  }
  if (removed || typeof snapshotService.invalidate !== 'function') return;
  try {
    snapshotService.invalidate();
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[Coldmail][mail-ready-snapshot-invalidate]', {
        customerId: id,
        error: error && error.message ? error.message : error,
      });
    }
  }
}

module.exports = { removeAcceptedCustomerFromMailReadySnapshot };
