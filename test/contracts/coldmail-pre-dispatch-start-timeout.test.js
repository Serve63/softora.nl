'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createColdmailSendDurability,
} = require('../../server/services/coldmail-send-provenance');

test('coldmail aborts a committed start-response-timeout before SMTP and releases both guards', async () => {
  const calls = [];
  const claimIntent = {
    intentId: 'coldmail:reservation-start-timeout',
    idempotencyKey: 'coldmail:reservation-start-timeout',
    owner: 'serve',
    accountEmail: 'serve@softora.nl',
    recipientEmail: 'prospect@example.nl',
    status: 'prepared',
    dispatchState: 'reserved',
    transitionToken: 'claim-token',
    preDispatchClaimFingerprint: 'a'.repeat(64),
    preDispatchFinalizedAt: '',
  };
  const finalIntent = {
    ...claimIntent,
    transitionToken: 'final-token',
    preDispatchFinalizedAt: '2026-08-28T08:30:00.000Z',
  };
  const startedIntent = {
    ...finalIntent,
    dispatchState: 'started',
    transitionToken: 'started-token',
    dispatchStartedAt: '2026-08-28T08:30:01.000Z',
  };
  const startError = Object.assign(new Error('start committeerde maar response ging verloren'), {
    code: 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED',
    intent: startedIntent,
  });
  let providerCalls = 0;
  let failedHandle = null;
  const durability = createColdmailSendDurability({
    store: {
      claimPreDispatch: async () => ({
        created: true,
        intent: claimIntent,
        claimToken: claimIntent.transitionToken,
      }),
      finalizeClaim: async () => ({
        intent: finalIntent,
        finalToken: finalIntent.transitionToken,
      }),
      startDispatch: async () => {
        calls.push('provenance:start');
        throw startError;
      },
      failPreDispatch: async (handle) => {
        calls.push('provenance:abort-started');
        failedHandle = handle;
        return { ...handle.intent, status: 'failed', dispatchState: 'finished' };
      },
      fail: async () => { throw new Error('post-provider fail mag niet starten'); },
    },
    getOwner: () => 'serve',
    getSenderName: () => 'Servé Creusen',
    logger: { error() {} },
  });

  await assert.rejects(durability.dispatch({
    provenanceInput: {
      reservationId: 'reservation-start-timeout',
      accountEmail: 'serve@softora.nl',
      recipientEmail: 'prospect@example.nl',
      subject: 'Kleine vraag',
      body: 'Goedendag',
      attachments: [],
    },
    beforeStartDispatch: async () => {
      calls.push('guards:reserve');
    },
    sendProvider: async () => {
      providerCalls += 1;
      return { accepted: ['prospect@example.nl'], rejected: [] };
    },
    recipientEmail: 'prospect@example.nl',
    onSafeFailure: async () => {
      calls.push('guard:release:recipient');
      calls.push('guard:release:sender');
    },
  }), (error) => error === startError);

  assert.equal(providerCalls, 0);
  assert.equal(failedHandle.intent.transitionToken, 'started-token');
  assert.equal(failedHandle.finalToken, 'started-token');
  assert.deepEqual(calls, [
    'guards:reserve',
    'provenance:start',
    'provenance:abort-started',
    'guard:release:recipient',
    'guard:release:sender',
  ]);
});

test('coldmail met productieprovenance stopt vóór guards en provider wanneer de store ontbreekt', async () => {
  let guardCalls = 0;
  let providerCalls = 0;
  const durability = createColdmailSendDurability({ store: null });

  await assert.rejects(durability.dispatch({
    provenanceInput: {
      reservationId: 'reservation-no-store',
      accountEmail: 'serve@softora.nl',
      recipientEmail: 'prospect@example.nl',
      subject: 'Kleine vraag',
      body: 'Goedendag',
      attachments: [],
    },
    beforeStartDispatch: async () => { guardCalls += 1; },
    sendProvider: async () => { providerCalls += 1; },
    recipientEmail: 'prospect@example.nl',
  }), (error) => error.code === 'COLDMAIL_SEND_PROVENANCE_MISMATCH');

  assert.equal(guardCalls, 0);
  assert.equal(providerCalls, 0);
});

test('coldmail kent een onbekende afzender nooit stilzwijgend aan Serve toe', async () => {
  let claimCalls = 0;
  let guardCalls = 0;
  let providerCalls = 0;
  const durability = createColdmailSendDurability({
    store: {
      claimPreDispatch: async () => { claimCalls += 1; },
      finalizeClaim: async () => {},
      failPreDispatch: async () => {},
    },
  });

  await assert.rejects(durability.dispatch({
    provenanceInput: {
      reservationId: 'reservation-unknown-sender',
      accountEmail: 'vreemd@ander-domein.example',
      recipientEmail: 'prospect@example.nl',
      subject: 'Kleine vraag', body: 'Goedendag', attachments: [],
    },
    beforeStartDispatch: async () => { guardCalls += 1; },
    sendProvider: async () => { providerCalls += 1; },
    recipientEmail: 'prospect@example.nl',
  }), (error) => error.code === 'COLDMAIL_SEND_PROVENANCE_MISMATCH');

  assert.equal(claimCalls, 0);
  assert.equal(guardCalls, 0);
  assert.equal(providerCalls, 0);
});

test('coldmail houdt guards vast wanneer een definitieve providerfout niet durable failed raakt', async () => {
  const intentId = 'coldmail:reservation-unconfirmed-fail';
  const claimIntent = {
    intentId, idempotencyKey: intentId, owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl',
    status: 'prepared', dispatchState: 'reserved', transitionToken: 'claim-token',
  };
  const finalIntent = { ...claimIntent, transitionToken: 'final-token' };
  const startedIntent = {
    ...finalIntent, dispatchState: 'started', transitionToken: 'started-token',
  };
  let providerCalls = 0;
  let releaseCalls = 0;
  const durability = createColdmailSendDurability({
    store: {
      claimPreDispatch: async () => ({ created: true, intent: claimIntent, claimToken: 'claim-token' }),
      finalizeClaim: async () => ({ intent: finalIntent, finalToken: 'final-token' }),
      failPreDispatch: async () => { throw new Error('pre-provider fail mag niet starten'); },
      startDispatch: async () => startedIntent,
      fail: async () => null,
    },
    logger: { error() {} },
  });

  await assert.rejects(durability.dispatch({
    provenanceInput: {
      reservationId: 'reservation-unconfirmed-fail', accountEmail: 'serve@softora.nl',
      recipientEmail: 'prospect@example.nl', subject: 'Kleine vraag', body: 'Goedendag',
      attachments: [],
    },
    sendProvider: async () => {
      providerCalls += 1;
      throw Object.assign(new Error('550 mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 });
    },
    recipientEmail: 'prospect@example.nl',
    onSafeFailure: async () => { releaseCalls += 1; },
  }), (error) => error.code === 'MAILBOX_SEND_RECONCILE_REQUIRED'
    && error.cause?.code === 'COLDMAIL_SEND_PROVENANCE_MISMATCH');

  assert.equal(providerCalls, 1);
  assert.equal(releaseCalls, 0);
});
