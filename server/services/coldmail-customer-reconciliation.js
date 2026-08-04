const EXACT_LOOKUP_OPTIONS = Object.freeze({
  bypassReadCache: true,
  bypassReadFailureCooldown: true,
  suppressReadFailureCooldown: true,
  suppressTransientReadFailureLog: true,
  suppressStaleReadCacheLog: true,
});

async function resolveColdmailReconciliationCustomer(options = {}) {
  const {
    currentRows = [],
    evidence = {},
    dataOpsStore,
    normalizeString = (value) => String(value || '').trim(),
    normalizeEmail,
    getRowId,
    getRowEmail,
  } = options;
  const recipientEmail = normalizeEmail(evidence.recipientEmail);
  const customerId = normalizeString(evidence.customerId);
  const rowIndex = currentRows.findIndex((row, index) =>
    (customerId && getRowId(row, index) === customerId) ||
    (recipientEmail && getRowEmail(row) === recipientEmail));
  let row = rowIndex >= 0 ? currentRows[rowIndex] : evidence.customerRow;

  if (!row && customerId && dataOpsStore && typeof dataOpsStore.listCustomersByIds === 'function') {
    const exactCustomers = await dataOpsStore.listCustomersByIds({
      customerIds: [customerId],
      ...EXACT_LOOKUP_OPTIONS,
    });
    row = (Array.isArray(exactCustomers) ? exactCustomers : []).find((customer, index) =>
      getRowId(customer, index) === customerId) || null;
  }

  if (!row && recipientEmail && dataOpsStore && typeof dataOpsStore.listCustomersByEmails === 'function') {
    const exactCustomers = await dataOpsStore.listCustomersByEmails({
      emails: [recipientEmail],
      ...EXACT_LOOKUP_OPTIONS,
    });
    const emailMatches = (Array.isArray(exactCustomers) ? exactCustomers : [])
      .filter((customer) => getRowEmail(customer) === recipientEmail);
    row = emailMatches.length === 1 ? emailMatches[0] : null;
  }

  return { row, rowIndex, recipientEmail };
}

module.exports = { resolveColdmailReconciliationCustomer };
