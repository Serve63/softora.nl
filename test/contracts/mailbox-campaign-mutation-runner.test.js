const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_MUTATION_DEADLINE_MS,
  MAILBOX_CAMPAIGN_MUTATION_LEASE_SECONDS,
  createMailboxCampaignMutationRunner,
} = require('../../server/services/mailbox-campaign-mutation-runner');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('mailbox mutation deadline ligt hard vóór lease-expiry en completeert binnen dezelfde abortscope', async () => {
  const calls = [];
  const store = {
    isAvailable: () => true,
    beginMutation: async (input) => {
      calls.push(['begin', input]);
      return {
        mutationId: '11111111-1111-4111-8111-111111111111',
        status: 'pending',
        replayed: false,
      };
    },
    completeMutation: async (input) => {
      calls.push(['complete', input]);
      assert.equal(input.signal.aborted, false);
      return { status: 'completed' };
    },
  };
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: store,
  });
  const result = await runner.run({
    requestKey: 'imap-sync:one',
    kind: 'imap-sync',
    leaseSeconds: MAILBOX_CAMPAIGN_MUTATION_LEASE_SECONDS,
    deadlineMs: MAILBOX_CAMPAIGN_MUTATION_DEADLINE_MS,
  }, async (context) => {
    assert.ok(context.deadlineMs < context.leaseSeconds * 1000);
    context.assertActive();
    return { stored: 1 };
  });

  assert.deepEqual(result, { stored: 1 });
  assert.deepEqual(calls.map(([type]) => type), ['begin', 'complete']);
});

test('timeout annuleert de taak en een late IMAP-response kan geen write meer starten', async () => {
  const gate = deferred();
  const started = deferred();
  let deadlineCallback = null;
  let writes = 0;
  let completes = 0;
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '11111111-1111-4111-8111-111111111111',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => { completes += 1; },
    },
    setTimer(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimer() {},
  });

  const running = runner.run({
    requestKey: 'imap-sync:late',
    kind: 'imap-sync',
  }, async (context) => {
    started.resolve();
    await gate.promise;
    context.assertActive();
    writes += 1;
  });
  await started.promise;
  deadlineCallback();
  gate.resolve();

  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.equal(completes, 0);
});

test('de totale deadline start vóór beginMutation en begrenst ook een hangende begin-RPC', async () => {
  const beginStarted = deferred();
  const beginGate = deferred();
  let deadlineCallback = null;
  let beginSignal = null;
  let taskCalls = 0;
  let completes = 0;
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async (options) => {
        beginSignal = options.signal;
        beginStarted.resolve();
        return beginGate.promise;
      },
      completeMutation: async () => { completes += 1; },
    },
    setTimer(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimer() {},
  });

  const running = runner.run({
    requestKey: 'imap-sync:begin-hang',
    kind: 'imap-sync',
    deadlineMs: 20,
  }, async () => { taskCalls += 1; });
  await beginStarted.promise;
  assert.equal(beginSignal.aborted, false);
  deadlineCallback();

  await assert.rejects(running, { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  assert.equal(beginSignal.aborted, true);
  assert.equal(taskCalls, 0);
  assert.equal(completes, 0);

  beginGate.resolve({
    mutationId: '11111111-1111-4111-8111-111111111111',
    status: 'pending',
    replayed: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(taskCalls, 0);
  assert.equal(completes, 0);
});

test('een onzekere databasewrite blijft pending en wordt niet als failed voltooid', async () => {
  let completes = 0;
  const unknown = new Error('write-uitkomst onzeker');
  unknown.code = 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN';
  unknown.leaveMutationPending = true;
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '11111111-1111-4111-8111-111111111111',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => { completes += 1; },
    },
  });

  await assert.rejects(() => runner.run({
    requestKey: 'imap-sync:unknown-write',
    kind: 'imap-sync',
  }, async () => ({ ok: false, error: unknown })), {
    code: 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN',
  });
  assert.equal(completes, 0);
});

test('bovenliggende folderabort annuleert mutationtaak en kan nooit completed worden', async () => {
  const parent = new AbortController();
  let completes = 0;
  let taskSignal = null;
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => ({
        mutationId: '11111111-1111-4111-8111-111111111111',
        status: 'pending',
        replayed: false,
      }),
      completeMutation: async () => { completes += 1; },
    },
  });
  const running = runner.run({
    requestKey: 'imap-sync:parent-abort',
    kind: 'imap-sync',
    signal: parent.signal,
  }, ({ signal }) => {
    taskSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  const reason = Object.assign(new Error('folder timeout'), {
    code: 'MAILBOX_SYNC_FOLDER_TIMEOUT', timedOut: true,
  });
  parent.abort(reason);

  await assert.rejects(running, (error) => error === reason);
  assert.equal(taskSignal.aborted, true);
  assert.equal(taskSignal.reason, reason);
  assert.equal(completes, 0);
});

test('ongeldige deadline kan nooit tegen lease-expiry aanlopen', async () => {
  let began = false;
  const runner = createMailboxCampaignMutationRunner({
    mailboxCampaignConsistencyStore: {
      isAvailable: () => true,
      beginMutation: async () => { began = true; },
      completeMutation: async () => null,
    },
  });

  await assert.rejects(() => runner.run({
    requestKey: 'imap-sync:unsafe',
    kind: 'imap-sync',
    leaseSeconds: 120,
    deadlineMs: 119_000,
  }, async () => null), {
    code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE_INVALID',
  });
  assert.equal(began, false);
});
