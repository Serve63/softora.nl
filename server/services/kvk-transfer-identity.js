const normalizeString = value => String(value || '').trim();
const getRowPayload = row => row && row.payload && typeof row.payload === 'object' ? row.payload : {};

function isKvkTransferRow(row = {}) {
  const payload = getRowPayload(row);
  if (normalizeString(payload.bronDatabase).toLowerCase() === 'softora bedrijven scraper') return true;
  if (/^kvk-transfer-/i.test(normalizeString(payload.premiumTransferRunId))) return true;
  const history = Array.isArray(payload.hist) ? payload.hist : [];
  return history.some((entry) => /^kvk-transfer:/i.test(normalizeString(entry && entry.messageKey)));
}

module.exports = { isKvkTransferRow };
