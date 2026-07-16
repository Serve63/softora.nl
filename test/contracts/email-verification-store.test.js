const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmailVerificationStore,
  getVerificationDecision,
} = require('../../server/services/email-verification-store');

const NOW = new Date('2026-07-16T12:00:00.000Z');

test('een verse geldige mailbox mag door', () => {
  assert.deepEqual(
    getVerificationDecision({
      status: 'valid',
      checked_at: '2026-07-16T11:00:00.000Z',
      valid_until: '2026-07-17T11:00:00.000Z',
    }, { now: NOW }),
    {
      allowed: true,
      status: 'valid',
      reason: 'mailbox_verified',
      shouldQueue: false,
      validUntil: '2026-07-17T11:00:00.000Z',
    }
  );
});

test('ontbrekende, verlopen en onbekende controles blijven dicht', () => {
  assert.equal(getVerificationDecision(null, { now: NOW }).shouldQueue, true);
  assert.equal(getVerificationDecision({
    status: 'valid',
    valid_until: '2026-07-16T11:59:59.000Z',
  }, { now: NOW }).allowed, false);
  assert.equal(getVerificationDecision({
    status: 'unknown',
    retry_after: '2026-07-17T12:00:00.000Z',
  }, { now: NOW }).shouldQueue, false);
  assert.equal(getVerificationDecision({
    status: 'invalid',
    reason: 'mailbox_does_not_exist',
  }, { now: NOW }).shouldQueue, false);
});

test('de verificatiestore faalt gesloten als Supabase niet beschikbaar is', async () => {
  const store = createEmailVerificationStore({
    isSupabaseConfigured: () => false,
    now: () => NOW,
  });
  const decision = await store.getDecision('info@example.com');
  assert.equal(decision.ok, false);
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 'unavailable');
});

test('een ontbrekende mailboxcontrole wordt eenmaal in de eigen wachtrij gezet', async () => {
  const writes = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      upsert: async (row, options) => {
        writes.push({ row, options });
        return { error: null };
      },
    }),
  };
  const store = createEmailVerificationStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => NOW,
  });
  const decision = await store.getDecision('INFO@Example.com', { customerId: 'prospect-1' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.queued, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.email, 'info@example.com');
  assert.equal(writes[0].row.payload.customerId, 'prospect-1');
  assert.deepEqual(writes[0].options, { onConflict: 'email', ignoreDuplicates: true });
});
