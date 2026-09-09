'use strict';

function requireMailboxEvidenceRows(rows, label) {
  if (Array.isArray(rows)) return rows;
  throw Object.assign(new Error(`Mailboxgeschiedenis kon niet volledig worden gecontroleerd (${label}).`), {
    code: 'MAILBOX_HISTORY_UNAVAILABLE', status: 503,
  });
}

async function readMailboxEvidenceBatches(items, read) {
  const results = [];
  for (let index = 0; index < items.length; index += 3) {
    results.push(...await Promise.all(items.slice(index, index + 3).map(read)));
  }
  return results;
}

module.exports = { requireMailboxEvidenceRows, readMailboxEvidenceBatches };
