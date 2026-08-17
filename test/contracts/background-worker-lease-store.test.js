const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackgroundWorkerLeaseStore } = require('../../server/services/background-worker-lease-store');

test('background worker lease store claims and token-fences release through Supabase RPC', async () => {
  const calls = [];
  const clientOptions = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'softora_claim_background_worker_lock') {
        return {
          data: [{
            acquired: true,
            claimed_lock_token: args.p_lock_token,
            lock_expires_at: '2026-08-17T13:00:00.000Z',
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  const store = createBackgroundWorkerLeaseStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: (options) => {
      clientOptions.push(options);
      return client;
    },
    logger: { error() {} },
  });

  const claim = await store.claimBackgroundWorkerLease({
    lockKey: 'PREMIUM-WEBDESIGN-BULK-WORKER',
    lockToken: 'worker-token',
    ttlSeconds: 900,
  });
  const release = await store.releaseBackgroundWorkerLease({
    lockKey: 'premium-webdesign-bulk-worker',
    lockToken: 'worker-token',
  });

  assert.deepEqual(claim, {
    ok: true,
    acquired: true,
    lockToken: 'worker-token',
    lockExpiresAt: '2026-08-17T13:00:00.000Z',
  });
  assert.deepEqual(release, { ok: true, released: true });
  assert.deepEqual(calls, [
    ['softora_claim_background_worker_lock', {
      p_lock_key: 'premium-webdesign-bulk-worker',
      p_lock_token: 'worker-token',
      p_lock_ttl_seconds: 900,
    }],
    ['softora_release_background_worker_lock', {
      p_lock_key: 'premium-webdesign-bulk-worker',
      p_lock_token: 'worker-token',
    }],
  ]);
  assert.deepEqual(clientOptions, [
    { timeoutMs: 10000, ignoreFailureCooldown: true, suppressFailureCooldown: true },
    { timeoutMs: 10000, ignoreFailureCooldown: true, suppressFailureCooldown: true },
  ]);
});

test('background worker lease store reports active contention without changing tokens', async () => {
  const store = createBackgroundWorkerLeaseStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() {
        return {
          data: [{ acquired: false, claimed_lock_token: null, lock_expires_at: '2026-08-17T13:00:00.000Z' }],
          error: null,
        };
      },
    }),
    logger: { error() {} },
  });

  const claim = await store.claimBackgroundWorkerLease({
    lockKey: 'premium-webdesign-bulk-worker',
    lockToken: 'second-worker-token',
  });

  assert.equal(claim.ok, true);
  assert.equal(claim.acquired, false);
  assert.equal(claim.lockToken, '');
  assert.equal(claim.lockExpiresAt, '2026-08-17T13:00:00.000Z');
});

test('background worker lease store fails closed when Supabase is unavailable', async () => {
  const store = createBackgroundWorkerLeaseStore({ isSupabaseConfigured: () => false });

  const claim = await store.claimBackgroundWorkerLease({
    lockKey: 'premium-webdesign-bulk-worker',
    lockToken: 'worker-token',
  });

  assert.equal(claim.ok, false);
  assert.equal(claim.unavailable, true);
  assert.equal(claim.error.code, 'BACKGROUND_WORKER_LEASE_UNAVAILABLE');
});
