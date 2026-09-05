'use strict';

// Measured slow Gmail sessions spend ~8s per post-auth command. Allow a
// useful pass with the shared connection instead of restarting every 10s.
const FAST_REFRESH_OPERATION_TIMEOUT_MS = 45_000;
const FAST_REFRESH_BUDGET_MS = 60_000;

async function runFastMailboxFolderSync(syncFolder, options, now = Date.now) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (now() >= options.refreshDeadlineAtMs) {
      const error = new Error('De snelle mailboxcontrole heeft zijn tijdslimiet bereikt.');
      error.code = 'MAILBOX_FAST_REFRESH_TIMEOUT';
      error.status = 504;
      throw error;
    }
    try {
      return await syncFolder(options);
    } catch (error) {
      // A new lease is required. Never retry an ambiguous commit, or call
      // our own unreleased lease a successful coalesced provider check.
      if (attempt > 0 || error?.code !== 'MAILBOX_IMAP_OPERATION_TIMEOUT' ||
          error.mailboxLeaseReleased !== true) throw error;
      const remainingMs = options.refreshDeadlineAtMs - now();
      if (remainingMs > 0 && remainingMs < FAST_REFRESH_OPERATION_TIMEOUT_MS) throw error;
    }
  }
}

module.exports = { FAST_REFRESH_OPERATION_TIMEOUT_MS, FAST_REFRESH_BUDGET_MS, runFastMailboxFolderSync };
