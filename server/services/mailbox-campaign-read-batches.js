'use strict';

// Keep independent reads concurrent without fanning out every account at once.
async function mapMailboxReads(items, read) {
  const results = [];
  for (let offset = 0; offset < items.length; offset += 3) {
    results.push(...await Promise.all(items.slice(offset, offset + 3).map(read)));
  }
  return results;
}

async function listMessagesAcrossFolders({
  mailboxIndexStore,
  method,
  folders = [],
  dedupeCampaignMessages,
  options = {},
} = {}) {
  if (!mailboxIndexStore || typeof mailboxIndexStore[method] !== 'function') return [];
  const batches = await Promise.all(
    folders.map((folder) => mailboxIndexStore[method]({
      ...options,
      folder,
    }))
  );
  if (batches.some((batch) => !Array.isArray(batch))) return null;
  return dedupeCampaignMessages(batches.flat());
}

module.exports = { mapMailboxReads, listMessagesAcrossFolders };
