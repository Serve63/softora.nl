'use strict';

function hasNewCampaignRelevantMail({ messages, folder, lastSyncedUid } = {}) {
  const normalizedFolder = String(folder || '').trim().toLowerCase();
  if (!['inbox', 'sent'].includes(normalizedFolder)) return false;
  const frontier = Math.max(0, Number(lastSyncedUid) || 0);
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const uid = Number(message?.uid);
    if (!Number.isSafeInteger(uid) || uid <= frontier) return false;
    if (normalizedFolder === 'inbox') return true;
    return Boolean(String(message?.inReplyTo || message?.references || '').trim()
      || String(message?.softoraSendMode || '').trim().toLowerCase() === 'reply');
  });
}

module.exports = { hasNewCampaignRelevantMail };
