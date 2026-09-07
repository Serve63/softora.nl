const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxService } = require('../../server/services/mailbox');
const { createMailboxSendProvenanceStore } = require('../../server/services/mailbox-send-provenance-store');
const { MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION } = require('../../server/services/mailbox-compose-email-renderer');
const { withMailboxPreDispatchProvenance } = require('../helpers/mailbox-pre-dispatch-provenance-fixture');

const accountEmail = 'serve@softora.nl';
const recipientEmail = 'info@correspondence.example';
const draft = 'Hoi Alex,\n\nIk wilde terugkomen op het webdesign dat ik je laatst stuurde.\nAls je wilt, kan ik de online preview opnieuw doorsturen.';

function responseRecorder() {
  return {
    statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
  };
}

function createHarness(options = {}) {
  const calls = [], sent = [], intents = new Map();
  const preview = createMailboxSendProvenanceStore().preview;
  const stored = {
    id: 'sent:20', folder: 'sent', accountEmail, email: accountEmail, to: recipientEmail,
    messageId: '<previous-reply@softora.nl>', inReplyTo: '<incoming@correspondence.example>',
    originalCampaignOutbound: false, softoraSendMode: 'reply', ...options.stored,
  };
  const provenanceStore = withMailboxPreDispatchProvenance({
    preview,
    preflight: async (input) => ({ intent: preview(input), conflict: intents.get(input.idempotencyKey) || null }),
    findByIdempotencyKey: async (key) => intents.get(key) || null,
    reserve: async (input) => {
      calls.push('claim');
      const intent = preview(input);
      intents.set(input.idempotencyKey, intent);
      return { created: true, intent };
    },
    accept: async (intentId, values) => {
      calls.push('accept');
      const existing = [...intents.values()].find((intent) => intent.intentId === intentId);
      const intent = { ...existing, ...values, intentId, status: 'accepted', dispatchState: 'finished' };
      intents.set(intent.idempotencyKey, intent);
      return intent;
    },
    listAcceptedMessages: async () => [],
  });
  const service = createMailboxService({
    env: { PREMIUM_SESSION_SECRET: 'test-only-correspondence-signing-secret' },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify([{
      email: accountEmail, name: 'Servé Creusen', smtpHost: 'smtp.example.test', smtpPort: 587,
      smtpUser: accountEmail, smtpPass: 'test-only',
    }]),
    mailboxIndexStore: options.indexUnavailable ? {} : {
      getMessageForReplyProof: async (input) => {
        calls.push({ proof: input });
        if (options.indexError) throw new Error('index timeout');
        return options.missingSource ? null : stored;
      },
    },
    mailboxSendProvenanceStore: options.provenanceUnavailable ? {} : provenanceStore,
    outboundRecipientGuardStore: {
      findRecipientSuppressionConflict: async () => {
        calls.push('suppression');
        return { ok: true, conflict: options.suppressed ? { recipient_email: recipientEmail } : null };
      },
      reserveRecipients: async () => {
        calls.push('coldmail-reserve');
        return { ok: false, conflict: { recipient_email: recipientEmail, provider: 'instantly' } };
      },
      releaseReservation: async () => ({ ok: true }),
    },
    getUiStateValues: async (scope) => {
      calls.push('campaign-data');
      return { values: scope === 'premium_customers_database' && !options.withoutHistory ? {
        softora_customers_premium_v1: JSON.stringify([{
          id: 'correspondence-example', email: recipientEmail, bedrijf: 'Correspondence Example',
          website: 'https://correspondence.example', lastColdmailSentAt: '2026-08-25T12:00:00Z',
        }]),
      } : {} };
    },
    createTransport: () => ({
      sendMail: async (message) => {
        calls.push('smtp');
        sent.push(message);
        return { messageId: message.messageId, accepted: [message.to], rejected: [] };
      },
    }),
    logger: { warn() {}, error() {}, log() {} },
  });
  const body = {
    account: accountEmail, owner: 'serve', mode: 'new-message', idempotencyKey: 'correspondence-test',
    to: recipientEmail, subject: 'RE: Kleine vraag over jullie website', body: draft,
    attachments: [], attachmentsMetadata: [],
    // The existing composer sends a sent-folder ID without folder or Message-ID.
    context: { id: stored.id, folder: '', messageId: '', conversationId: 'conversation:existing' },
    ...options.body,
  };
  async function preflight() {
    const res = responseRecorder();
    await service.preflightMessageResponse({ body }, res);
    return res;
  }
  async function send(proof) {
    const res = responseRecorder();
    await service.sendMessageResponse({ body: { ...body, reconcileProof: proof } }, res);
    return res;
  }
  return { body, calls, preflight, send, sent, stored };
}

for (const mode of ['reply', 'new-message']) {
  test(`webdesign wording in a proven ${mode} keeps the authored message and only sends once`, async () => {
    const isReply = mode === 'reply';
    const h = createHarness(isReply ? {
      stored: { id: 'coldmail:7', folder: 'coldmail', email: recipientEmail, to: accountEmail,
        messageId: '<incoming@correspondence.example>', inReplyTo: '<original@softora.nl>' },
      body: { mode, context: { id: 'coldmail:7', folder: 'coldmail',
        messageId: '<incoming@correspondence.example>', conversationId: 'conversation:existing' } },
    } : {});
    const checked = await h.preflight();
    assert.equal(checked.statusCode, 200, checked.body?.detail);
    assert.equal(checked.body.result.externalEffect, false);
    assert.equal(checked.body.result.correspondenceSourceMessageId, h.stored.messageId);
    assert.equal(h.sent.length, 0);
    const result = await h.send(checked.body.result.reconcileProof);
    assert.equal(result.statusCode, 200, result.body?.detail);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].text, draft);
    assert.equal(h.sent[0].attachments, undefined);
    assert.equal(h.sent[0].headers['X-Softora-Template-Version'], MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION);
    assert.equal(h.sent[0].inReplyTo, isReply ? h.stored.messageId : undefined);
    assert.equal(h.calls.includes('campaign-data'), false);
    assert.equal(h.calls.includes('coldmail-reserve'), false);
    assert.ok(h.calls.indexOf('claim') < h.calls.indexOf('smtp'));
    assert.ok(h.calls.indexOf('suppression') < h.calls.indexOf('smtp'));
    const repeated = await h.send(checked.body.result.reconcileProof);
    assert.equal(repeated.statusCode, 200, repeated.body?.detail);
    assert.equal(h.sent.length, 1, 'accepted send is replayed without a second SMTP call');
  });
}

for (const variant of [
  { name: 'edited recipient', body: { to: 'other@example.test' } },
  { name: 'other mailbox', stored: { accountEmail: 'martijn@softora.nl' } },
  { name: 'other sender', stored: { email: 'martijn@softora.nl' } },
  { name: 'wrong Message-ID', body: { context: { id: 'sent:20', messageId: '<other@example.test>', conversationId: 'conversation:existing' } } },
  { name: 'missing source', missingSource: true },
]) {
  test(`new-message correspondence rejects ${variant.name} before dispatch`, async () => {
    const h = createHarness(variant);
    const checked = await h.preflight();
    assert.equal(checked.statusCode, 409);
    assert.equal(checked.body.code, 'MAILBOX_CORRESPONDENCE_SOURCE_MISMATCH');
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.includes('claim'), false);
  });
}

for (const options of [{ indexError: true }, { indexUnavailable: true }]) {
  test(`new-message proof fails closed when index is ${options.indexError ? 'offline' : 'unavailable'}`, async () => {
    const h = createHarness(options);
    const checked = await h.preflight();
    assert.equal(checked.statusCode, 503);
    assert.equal(checked.body.code, 'MAILBOX_CORRESPONDENCE_SOURCE_UNAVAILABLE');
    assert.equal(h.sent.length, 0);
  });
}

for (const options of [
  { body: { context: { conversationId: 'conversation:claimed' }, correspondenceSourceMessageId: '<forged@example.test>',
    threadProvenance: { correspondenceSourceMessageId: '<forged@example.test>' } } },
  { stored: { originalCampaignOutbound: true, softoraSendMode: '', inReplyTo: '' } },
]) {
  test(`initial coldmail history remains blocked with ${options.body ? 'client claims and RE subject' : 'an original campaign source'}`, async () => {
    const h = createHarness(options);
    const checked = await h.preflight();
    assert.equal(checked.statusCode, 200, checked.body?.detail);
    assert.ok(!checked.body.result.correspondenceSourceMessageId);
    const result = await h.send(checked.body.result.reconcileProof);
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.code, 'MAILBOX_WEBDESIGN_PRIOR_OUTBOUND_HISTORY');
    assert.equal(h.sent.length, 0);
  });
}

test('first webdesign mail still reserves centrally and stops on cross-channel conflict', async () => {
  const h = createHarness({ withoutHistory: true, body: { context: {} } });
  const checked = await h.preflight();
  const result = await h.send(checked.body.result.reconcileProof);
  assert.equal(result.statusCode, 409, result.body?.detail);
  assert.equal(result.body.code, 'MAILBOX_WEBDESIGN_OUTBOUND_GUARD_CONFLICT');
  assert.equal(h.calls.includes('coldmail-reserve'), true);
  assert.equal(h.sent.length, 0);
});

test('proven correspondence still respects permanent suppression', async () => {
  const h = createHarness({ suppressed: true });
  const checked = await h.preflight();
  const result = await h.send(checked.body.result.reconcileProof);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'OUTBOUND_RECIPIENT_SUPPRESSED');
  assert.equal(result.body.externalEffect, false);
  assert.equal(h.sent.length, 0);
});

test('proven correspondence cannot dispatch without durable provenance', async () => {
  const h = createHarness({ provenanceUnavailable: true });
  const checked = await h.preflight();
  assert.equal(checked.statusCode, 503);
  assert.equal(h.sent.length, 0);
});
