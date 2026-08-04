const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createColdmailPostSmtpReconciliation,
  matchesSentEvidence,
} = require('../../server/services/coldmail-post-smtp-reconciliation');

const NEVA_GROUP = {
  reservation_id: 'softora-coldmail-pre-send-mseqo9m6-6qm002gf',
  recipient_id: 'neva-beauty-clinic',
  recipient_email: 'info@nevabeautyclinic.com',
  recipient_company: 'Neva Beauty Clinic',
  sender_email: 'martijnven123@gmail.com',
  provider: 'softora',
  channel: 'coldmail',
  source: 'softora-coldmail-pre-send',
  status: 'reserved',
  permanent: true,
  created_at: '2026-08-04T14:13:30.000Z',
  updated_at: '2026-08-04T14:13:30.000Z',
  payload: {
    customerId: 'neva-beauty-clinic',
    bedrijf: 'Neva Beauty Clinic',
    expectedSubject: 'Kleine vraag over jullie website',
    reference: 'SF-NEVA-20260804',
    durationDays: 14,
    specialAction: 'webdesign',
    actor: 'Coldmail Autopilot',
  },
};

const NEVA_SENT = {
  account_email: 'martijnven123@gmail.com',
  folder: 'sent',
  recipients_text: 'Neva Beauty Clinic <info@nevabeautyclinic.com>',
  subject: 'Kleine vraag over jullie website',
  body_text: 'Goedendag,\n\n<!-- Softora referentie SF-NEVA-20260804 -->',
  date: '2026-08-04T14:14:05.000Z',
  message_id: '<8e160293-f3f3-1ed4-3f89-185d5ca4bf45@gmail.com>',
  provider_id: 'sent:682',
};

test('post-SMTP reconciliation restores one exact Neva-like Sent match without sending again', async () => {
  const confirmations = [];
  const finalized = [];
  let mailboxReads = 0;
  const service = createColdmailPostSmtpReconciliation({
    now: () => new Date('2026-08-04T15:30:00.000Z'),
    getSenderEmails: () => ['martijnven123@gmail.com', 'serve@softora.nl'],
    outboundRecipientGuardStore: {
      async listReservedRecipientGroups(options) {
        assert.equal(options.provider, 'softora');
        assert.equal(options.channel, 'coldmail');
        assert.equal(options.keyType, 'email');
        assert.match(options.updatedSince, /^2026-07-28/);
        return [NEVA_GROUP];
      },
      async listSentRecipientGroups() {
        return [];
      },
      async confirmReservation(reservationId, options) {
        confirmations.push({ reservationId, options });
        return { ok: true, count: 4 };
      },
    },
    dataOpsStore: {
      async listMailboxMessages(options) {
        mailboxReads += 1;
        assert.deepEqual(options.folders, ['sent']);
        assert.equal(options.maxRows, 1000);
        assert.equal(options.bypassReadCache, true);
        return [NEVA_SENT];
      },
    },
    finalizeEvidence: async (evidence) => {
      finalized.push(evidence);
    },
  });

  const result = await service.reconcilePending({ maxRows: 100 });

  assert.deepEqual(result, { ok: true, checked: 1, reconciled: 1, unresolved: 0, errors: [] });
  assert.equal(mailboxReads, 1);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].recipientEmail, 'info@nevabeautyclinic.com');
  assert.equal(finalized[0].messageId, NEVA_SENT.message_id);
  assert.equal(finalized[0].providerId, 'sent:682');
  assert.equal(finalized[0].sentAt, '2026-08-04T14:14:05.000Z');
  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[0].options.payload.postSmtpReconciled, false);
  assert.equal(confirmations[1].options.payload.postSmtpReconciled, true);
  assert.equal(confirmations[1].options.at, '2026-08-04T14:14:05.000Z');
});

test('post-SMTP reconciliation resumes a sent-but-unfinalized guard idempotently', async () => {
  const confirmations = [];
  const finalized = [];
  const sentPending = {
    ...NEVA_GROUP,
    status: 'sent',
    payload: {
      ...NEVA_GROUP.payload,
      recipientEmail: 'info@nevabeautyclinic.com',
      senderEmail: 'martijnven123@gmail.com',
      messageId: NEVA_SENT.message_id,
      providerId: 'sent:682',
      sentAt: '2026-08-04T14:14:05.000Z',
      postSmtpEvidence: 'smtp-accepted',
      postSmtpReconciled: false,
    },
  };
  const service = createColdmailPostSmtpReconciliation({
    now: () => new Date('2026-08-04T15:30:00.000Z'),
    getSenderEmails: () => ['martijnven123@gmail.com'],
    outboundRecipientGuardStore: {
      async listReservedRecipientGroups() { return []; },
      async listSentRecipientGroups() { return [sentPending]; },
      async confirmReservation(reservationId, options) {
        confirmations.push({ reservationId, options });
        return { ok: true, count: 4 };
      },
    },
    dataOpsStore: {
      async listMailboxMessages() {
        throw new Error('pending guard with exact message evidence must not need mailbox hydration');
      },
    },
    finalizeEvidence: async (evidence) => finalized.push(evidence),
  });

  const result = await service.reconcilePending();

  assert.equal(result.reconciled, 1);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].messageId, NEVA_SENT.message_id);
  assert.equal(confirmations.at(-1).options.payload.postSmtpReconciled, true);
});

test('post-SMTP reconciliation fails closed on ambiguous or unrelated Sent evidence', async () => {
  const confirmations = [];
  const finalized = [];
  const service = createColdmailPostSmtpReconciliation({
    now: () => new Date('2026-08-04T15:30:00.000Z'),
    getSenderEmails: () => ['martijnven123@gmail.com'],
    outboundRecipientGuardStore: {
      async listReservedRecipientGroups() { return [NEVA_GROUP]; },
      async listSentRecipientGroups() { return []; },
      async confirmReservation(...args) {
        confirmations.push(args);
        return { ok: true, count: 4 };
      },
    },
    dataOpsStore: {
      async listMailboxMessages() {
        return [
          NEVA_SENT,
          { ...NEVA_SENT, provider_id: 'sent:683', message_id: '<second@gmail.com>', date: '2026-08-04T14:15:05.000Z' },
          { ...NEVA_SENT, account_email: 'serve@softora.nl', provider_id: 'wrong-sender' },
        ];
      },
    },
    finalizeEvidence: async (evidence) => finalized.push(evidence),
  });

  const result = await service.reconcilePending();

  assert.equal(result.reconciled, 0);
  assert.equal(result.unresolved, 1);
  assert.equal(confirmations.length, 0);
  assert.equal(finalized.length, 0);
});

test('Sent matching requires immutable sender, recipient, time and exact source marker', () => {
  assert.equal(matchesSentEvidence(NEVA_GROUP, NEVA_SENT), true);
  assert.equal(matchesSentEvidence(NEVA_GROUP, { ...NEVA_SENT, account_email: 'serve@softora.nl' }), false);
  assert.equal(matchesSentEvidence(NEVA_GROUP, { ...NEVA_SENT, recipients_text: 'other@example.test' }), false);
  assert.equal(matchesSentEvidence(NEVA_GROUP, { ...NEVA_SENT, date: '2026-08-04T18:14:05.000Z' }), false);
  assert.equal(matchesSentEvidence(NEVA_GROUP, { ...NEVA_SENT, body_text: 'no exact reference' }), false);
});
