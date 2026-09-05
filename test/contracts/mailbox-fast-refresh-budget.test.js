const test = require('node:test');
const assert = require('node:assert/strict');
const { runFastMailboxFolderSync } = require('../../server/services/mailbox-fast-refresh');

test('gedeelde refreshdeadline start geen nieuwe folderlezing of retry na uitputting', async () => {
  let now = 0;
  let calls = 0;
  const sync = async () => {
    calls += 1; now = 45_000;
    throw Object.assign(new Error('timeout'), { code: 'MAILBOX_IMAP_OPERATION_TIMEOUT', mailboxLeaseReleased: true });
  };
  await assert.rejects(runFastMailboxFolderSync(sync, { refreshDeadlineAtMs: 45_000 }, () => now),
    (error) => error.code === 'MAILBOX_FAST_REFRESH_TIMEOUT');
  assert.equal(calls, 1);
  await assert.rejects(runFastMailboxFolderSync(sync, { refreshDeadlineAtMs: 45_000 }, () => now),
    (error) => error.code === 'MAILBOX_FAST_REFRESH_TIMEOUT');
  assert.equal(calls, 1);
});

test('authenticatie- en opslagfouten worden nooit als een vluchtige IMAP-timeout herhaald', async () => {
  let calls = 0;
  const error = Object.assign(new Error('provider rejected'), { code: 'AUTH_FAILED', mailboxLeaseReleased: true });
  await assert.rejects(runFastMailboxFolderSync(async () => { calls += 1; throw error; },
    { refreshDeadlineAtMs: 45_000 }, () => 0), (actual) => actual === error);
  assert.equal(calls, 1);
});
