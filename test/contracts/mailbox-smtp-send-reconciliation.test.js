const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

const {
  createMailboxPayloadFingerprint,
  createMailboxRecipientFingerprint,
} = require('../../server/services/mailbox-send-provenance-store');
const {
  findExactSmtpSentReconciliation,
  prepareSmtpSendReconciliation,
  reconcileSmtpSendIntents,
  smtpReconciliationHealth,
} = require('../../server/services/mailbox-smtp-send-reconciliation');
const { createMailboxSyncService } = require('../../server/services/mailbox-campaign-sync');

const intent = {
  intentId: 'send:planned', status: 'prepared', reconcileRequired: true,
  owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'klant@example.nl',
  mode: 'reply', conversationId: 'conversation:1', replyTargetMessageId: '<incoming@example.nl>',
  messageId: '<planned@softora.nl>', subject: 'Re: Vraag', body: 'Exact antwoord',
  cc: 'cc@example.nl', bcc: 'bcc@example.nl', createdAt: '2026-08-10T10:00:00.000Z',
  outboundGuardRequired: true, outboundGuardReconcileRequired: false,
};
intent.payloadFingerprint = createMailboxPayloadFingerprint(intent);

function sent(overrides = {}) {
  return {
    id: 'sent:101', uid: 101, folder: 'sent', accountEmail: intent.accountEmail,
    softoraSendIntentId: intent.intentId, messageId: intent.messageId,
    softoraRecipientFingerprint: createMailboxRecipientFingerprint({
      to: intent.recipientEmail, cc: intent.cc, bcc: intent.bcc,
    }),
    softoraPayloadFingerprint: intent.payloadFingerprint,
    softoraSendMode: intent.mode, softoraConversationId: intent.conversationId,
    softoraReplyTargetMessageId: intent.replyTargetMessageId, to: intent.recipientEmail,
    cc: intent.cc, bcc: '', subject: intent.subject, body: intent.body,
    date: '2026-08-10T10:01:00.000Z',
    ...overrides,
  };
}

test('SMTP Sent bewijs dedupliceert auto-save plus append, maar blokkeert een tweede logisch bericht', () => {
  const first = sent();
  const duplicateCopy = sent({ id: 'sent:102', uid: 102 });
  assert.equal(findExactSmtpSentReconciliation(intent, [first, duplicateCopy]).messageId, intent.messageId);
  assert.equal(findExactSmtpSentReconciliation(intent, [first, sent({
    id: 'sent:103', uid: 103, messageId: '<different@softora.nl>',
  })]), null);
  assert.equal(findExactSmtpSentReconciliation(intent, [sent({ body: 'Door parser opgeschoonde tekst' })]).messageId,
    intent.messageId);
  assert.equal(findExactSmtpSentReconciliation(intent, [sent({ softoraPayloadFingerprint: '' })]), null);
  assert.equal(findExactSmtpSentReconciliation(intent, []), null);
});

test('payload-header reconcilieert exact na echte MIME-roundtrip met opgeschoonde witregels', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await transport.sendMail({
    from: intent.accountEmail, to: intent.recipientEmail, cc: intent.cc,
    subject: intent.subject, messageId: intent.messageId,
    text: 'Eerste regel\n\n\n\nTweede regel\n\n',
    headers: {
      'X-Softora-Send-Intent-Id': intent.intentId,
      'X-Softora-Recipient-Fingerprint': createMailboxRecipientFingerprint({
        to: intent.recipientEmail, cc: intent.cc, bcc: intent.bcc,
      }),
      'X-Softora-Payload-Fingerprint': intent.payloadFingerprint,
      'X-Softora-Send-Mode': intent.mode,
      'X-Softora-Conversation-Id': intent.conversationId,
      'X-Softora-Reply-Target-Message-Id': intent.replyTargetMessageId,
    },
  });
  const parsed = await simpleParser(info.message);
  const candidate = sent({
    body: String(parsed.text || '').trim().replace(/\n{3,}/g, '\n\n'),
    messageId: parsed.messageId,
    softoraSendIntentId: parsed.headers.get('x-softora-send-intent-id'),
    softoraRecipientFingerprint: parsed.headers.get('x-softora-recipient-fingerprint'),
    softoraPayloadFingerprint: parsed.headers.get('x-softora-payload-fingerprint'),
    softoraSendMode: parsed.headers.get('x-softora-send-mode'),
    softoraConversationId: parsed.headers.get('x-softora-conversation-id'),
    softoraReplyTargetMessageId: parsed.headers.get('x-softora-reply-target-message-id'),
  });
  assert.equal(findExactSmtpSentReconciliation(intent, [candidate]).messageId, intent.messageId);
});

test('prepared SMTP intent wordt alleen na exact Sent bewijs en guard-confirm accepted', async () => {
  const accepted = [];
  const confirms = [];
  const state = { checked: true, degraded: false, intents: [{ ...intent }] };
  const result = await reconcileSmtpSendIntents({
    state, messages: [sent()],
    store: { accept: async (intentId, values) => accepted.push({ intentId, values }) },
    confirmOutboundGuard: async (reservationId, values) => confirms.push({ reservationId, values }),
    logger: { error() {} },
  });
  assert.equal(result.reconciled, 1);
  assert.equal(result.intents.length, 0);
  assert.equal(confirms[0].reservationId, intent.intentId);
  assert.equal(accepted[0].values.reconcileRequired, false);
  assert.equal(accepted[0].values.sentReconcileRequired, false);
  assert.deepEqual(smtpReconciliationHealth(result), {
    smtpReconciliationChecked: true,
    smtpReconciliationDegraded: false,
    remainingSmtpReconcileCount: 0,
  });
});

test('ontbrekend of ambigu Sent bewijs en falende guard blijven eerlijk geblokkeerd', async () => {
  const missing = await reconcileSmtpSendIntents({
    state: { checked: true, degraded: false, intents: [{ ...intent }] }, messages: [],
    store: { accept: async () => assert.fail('zonder bewijs mag accept niet lopen') },
    logger: { error() {} },
  });
  assert.equal(missing.intents.length, 1);
  assert.equal(smtpReconciliationHealth(missing).smtpReconciliationDegraded, true);

  const accepted = [];
  const guardFailure = await reconcileSmtpSendIntents({
    state: { checked: true, degraded: false, intents: [{ ...intent }] }, messages: [sent()],
    store: { accept: async (_id, values) => accepted.push(values) },
    confirmOutboundGuard: async () => { throw new Error('guard down'); },
    logger: { error() {} },
  });
  assert.equal(guardFailure.intents.length, 1);
  assert.equal(accepted[0].outboundGuardReconcileRequired, true);
  assert.equal(accepted[0].sentReconcileRequired, false);
  assert.equal(smtpReconciliationHealth(guardFailure).smtpReconciliationDegraded, true);
});

test('SMTP reconcile-list fout rapporteert degraded zonder acceptatie te verzinnen', async () => {
  const state = await prepareSmtpSendReconciliation({
    store: { listReconcileRequired: async () => { throw new Error('database down'); } },
    accountEmail: intent.accountEmail, logger: { error() {} },
  });
  assert.equal(state.checked, false);
  assert.equal(state.degraded, true);
  assert.equal(smtpReconciliationHealth(state).remainingSmtpReconcileCount, null);
});

test('sync-sweep abandont verlopen pre-provider intent vóór het vrijgeven van de guard', async () => {
  const events = [];
  const state = await prepareSmtpSendReconciliation({
    store: {
      listExpiredUndispatched: async () => [{
        ...intent, intentId: 'send:expired-before-provider', outboundGuardRequired: true,
      }],
      abandonUndispatched: async (intentId) => {
        events.push(`abandon:${intentId}`);
        return { abandoned: true };
      },
      listReconcileRequired: async () => [],
    },
    accountEmail: intent.accountEmail,
    releaseOutboundGuard: async (intentId) => events.push(`release:${intentId}`),
    logger: { error() {} },
  });
  assert.deepEqual(events, [
    'abandon:send:expired-before-provider',
    'release:send:expired-before-provider',
  ]);
  assert.equal(state.reapedUndispatched, 1);
  assert.equal(smtpReconciliationHealth(state).reapedUndispatchedSendCount, 1);
});

test('inbox-sync meldt pending eerlijk; scheduled Sent-sync accepteert pas na durable upsert', async () => {
  let pending = [{ ...intent, outboundGuardRequired: false }];
  const events = [];
  const fetches = [];
  const store = {
    listReconcileRequired: async () => pending,
    accept: async (intentId) => {
      events.push(`accept:${intentId}`);
      pending = pending.filter((item) => item.intentId !== intentId);
    },
  };
  const service = createMailboxSyncService({
    mailboxSendProvenanceStore: store,
    mailboxIndexStore: {
      acquireSyncLock: async ({ folder }) => ({ ok: true, lockToken: `lock:${folder}` }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      upsertMessages: async ({ folder, messages }) => {
        events.push(`upsert:${folder}:${messages.length}`);
        return { ok: true, upserted: messages.length };
      },
      finishSync: async () => ({ ok: true }),
    },
    assertReadableAccount: (accountEmail) => ({ email: accountEmail, imapConfigured: true }),
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (options) => {
      fetches.push(options);
      const messages = options.folder === 'sent' ? [sent()] : [];
      Object.defineProperty(messages, 'syncReadHealth', {
        value: Object.freeze({ uidValidity: 777 }),
      });
      return messages;
    },
    getSafeLimit: (limit) => limit,
    getAccounts: () => [],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });
  const inbox = await service.syncMailboxFolder({ accountEmail: intent.accountEmail, folder: 'inbox' });
  assert.equal(inbox.partial, true);
  assert.equal(inbox.degraded, true);
  assert.equal(inbox.remainingSmtpReconcileCount, 1);
  assert.deepEqual(fetches[0].reconcileIntentIds, []);
  assert.equal(events.some((event) => event.startsWith('accept:')), false);

  const scheduledSent = await service.syncMailboxFolder({ accountEmail: intent.accountEmail, folder: 'sent' });
  assert.deepEqual(fetches[1].reconcileIntentIds, [intent.intentId]);
  assert.deepEqual(events.slice(-2), ['upsert:sent:1', `accept:${intent.intentId}`]);
  assert.equal(scheduledSent.reconciledSmtpSends, 1);
  assert.equal(scheduledSent.remainingSmtpReconcileCount, 0);
  assert.equal(scheduledSent.partial, false);
});
