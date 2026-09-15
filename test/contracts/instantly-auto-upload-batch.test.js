const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_AUTO_UPLOAD_BATCH_SIZE,
  MAX_AUTO_UPLOAD_BATCH_SIZE,
  resolveAutoUploadBatchLimit,
  runInstantlyAutoUploadBatch,
} = require('../../server/services/instantly-auto-upload-batch');

test('automatic Instantly batch uses a practical default instead of one lead per cron', () => {
  assert.equal(DEFAULT_AUTO_UPLOAD_BATCH_SIZE, 25);
  assert.equal(MAX_AUTO_UPLOAD_BATCH_SIZE, 50);
  assert.equal(resolveAutoUploadBatchLimit({}, { batchSize: 10 }), 25);
  assert.equal(resolveAutoUploadBatchLimit({}, { batchSize: 40 }), 40);
  assert.equal(resolveAutoUploadBatchLimit({ limit: 7 }, { batchSize: 40 }), 7);
  assert.equal(resolveAutoUploadBatchLimit({ limit: 999 }, { batchSize: 10 }), 50);
});

test('automatic Instantly batch drains multiple ready leads in one scheduler run', async () => {
  const sequence = [
    { ok: true, uploaded: 1, owner: 'serve', campaignId: 'serve-campaign' },
    { ok: true, uploaded: 1, owner: 'martijn', campaignId: 'martijn-campaign' },
    { ok: true, uploaded: 1, owner: 'serve', campaignId: 'serve-campaign' },
    { ok: true, skipped: true, reason: 'no_mailready_instantly_leads' },
  ];
  let calls = 0;
  const result = await runInstantlyAutoUploadBatch({
    config: { batchSize: 10 },
    now: () => new Date('2026-09-15T21:00:00Z'),
    runOne: async () => sequence[calls++],
  });

  assert.equal(calls, 4);
  assert.equal(result.ok, true);
  assert.equal(result.uploaded, 3);
  assert.equal(result.batchLimit, 25);
  assert.deepEqual(result.owners, { serve: 2, martijn: 1 });
  assert.deepEqual(result.campaigns, { 'serve-campaign': 2, 'martijn-campaign': 1 });
  assert.equal(result.reason, 'mailready_batch_synced');
});

test('guarded provider ambiguity cannot block later mail-ready leads', async () => {
  const sequence = [
    Object.assign(new Error('provider response ambiguous'), { code: 'INSTANTLY_AUTO_PROVIDER_PARTIAL_UPLOAD' }),
    { ok: true, uploaded: 1, owner: 'serve', campaignId: 'serve-campaign' },
    Object.assign(new Error('local link failed'), { code: 'INSTANTLY_AUTO_LOCAL_LINK_FAILED' }),
    { ok: true, uploaded: 1, owner: 'martijn', campaignId: 'martijn-campaign' },
    { ok: true, skipped: true, reason: 'no_mailready_instantly_leads' },
  ];
  let calls = 0;
  const result = await runInstantlyAutoUploadBatch({
    input: { limit: 10 },
    runOne: async () => {
      const value = sequence[calls++];
      if (value instanceof Error) throw value;
      return value;
    },
  });

  assert.equal(result.uploaded, 2);
  assert.equal(result.partial, true);
  assert.deepEqual(result.warnings, [
    'INSTANTLY_AUTO_PROVIDER_PARTIAL_UPLOAD',
    'INSTANTLY_AUTO_LOCAL_LINK_FAILED',
  ]);
  assert.deepEqual(result.owners, { serve: 1, martijn: 1 });
});

test('unsafe automatic upload errors still stop the batch immediately', async () => {
  await assert.rejects(
    () => runInstantlyAutoUploadBatch({
      input: { limit: 10 },
      runOne: async () => {
        throw Object.assign(new Error('sender conflict'), { code: 'INSTANTLY_AUTO_DESIGN_SENDER_UNRESOLVED' });
      },
    }),
    { code: 'INSTANTLY_AUTO_DESIGN_SENDER_UNRESOLVED' }
  );
});
