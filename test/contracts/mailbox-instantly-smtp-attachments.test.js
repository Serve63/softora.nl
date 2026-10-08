const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMailboxService } = require('../../server/services/mailbox');
const { createMailboxSendProvenanceStore } = require('../../server/services/mailbox-send-provenance-store');
const { createBindingHash } = require('../../server/services/mailbox-attachment-service');
const { createMailboxComposeThreadContext } = require('../../server/services/mailbox-compose-thread-context');
const { withMailboxPreDispatchProvenance } = require('../helpers/mailbox-pre-dispatch-provenance-fixture');
const senderModule = require('../../assets/premium-mailbox-compose-sender');
const controllerModule = require('../../assets/premium-mailbox-compose-controller');
const composeModule = require('../../assets/premium-mailbox-compose');
const sendState = require('../../assets/premium-mailbox-compose-send-state');
const resilience = require('../../assets/premium-mailbox-compose-send-resilience');
const acceptedSend = require('../../assets/premium-mailbox-compose-accepted-send');
const attachmentDigest = require('../../assets/premium-mailbox-attachment-digest');

const smtpAccount = 'martijn@softora.nl';
const providerAccount = 'martijnven@websoftora.com';
const recipient = 'info@kidssenz.example';
const content = Buffer.from('three-logo-fixture');
const metadata = {
  filename: 'logo.png', contentType: 'image/png', size: content.length,
  sha256: crypto.createHash('sha256').update(content).digest('hex'),
};
const source = {
  id: 'instantly:incoming', provider: 'instantly', direction: 'received', folder: 'inbox',
  accountEmail: providerAccount, providerAccountEmail: providerAccount, providerOwner: 'martijn',
  providerMessageId: 'incoming', providerThreadId: 'thread-1', email: recipient,
  messageId: '<incoming@kidssenz.example>', references: '<original@websoftora.com>',
  subject: 'Kleine vraag over jullie website', conversationId: 'conversation:kidssenz',
};
const identity = {
  version: 1, provider: 'instantly', owner: 'martijn', accountEmail: providerAccount,
  providerAccountEmail: providerAccount, providerMessageId: 'incoming', providerThreadId: 'thread-1',
  sourceMessageId: source.messageId, conversationId: source.conversationId,
};

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, setHeader() {},
  };
}

function harness(options = {}) {
  const sent = [], calls = [], intents = new Map();
  const preview = createMailboxSendProvenanceStore().preview;
  const stored = { ...source, ...options.source };
  const instantlyMailboxService = {
    getConfiguredAccounts: (owner) => owner === 'martijn' ? [{ email: providerAccount }] : [],
    async assertStoredMessageOwnership(input) {
      calls.push('source-proof');
      assert.equal(input.accountEmail, providerAccount);
      assert.equal(input.providerMessageId, source.providerMessageId);
      assert.equal(input.providerThreadId, source.providerThreadId);
      return stored;
    },
    async reply() { throw new Error('An attachment must never reach the Instantly reply endpoint'); },
  };
  const provenance = withMailboxPreDispatchProvenance({
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
      const old = [...intents.values()].find((entry) => entry.intentId === intentId);
      const intent = { ...old, ...values, status: 'accepted', dispatchState: 'finished',
        reconcileRequired: false, sentReconcileRequired: false };
      intents.set(old.idempotencyKey, intent);
      return intent;
    },
  });
  const service = createMailboxService({
    env: { PREMIUM_SESSION_SECRET: 'smtp-attachment-test-secret' },
    mailConfig: {},
    mailboxAccountsRaw: JSON.stringify(['martijn', 'serve'].map((owner) => ({
      email: `${owner}@softora.nl`, smtpHost: 'smtp.example.test', smtpUser: `${owner}@softora.nl`,
      smtpPass: options.smtpUnavailable ? '' : 'test-only',
    }))),
    instantlyMailboxService, mailboxSendProvenanceStore: provenance,
    mailboxAttachmentService: {
      async downloadAttachments(attachments, binding) {
        calls.push('attachment-download');
        assert.equal(binding.accountEmail, smtpAccount);
        assert.equal(binding.provider, 'smtp');
        return attachments.map((attachment) => ({ filename: attachment.filename,
          contentType: attachment.contentType, sha256: attachment.sha256, content }));
      },
      async cleanupAttachments() { calls.push('cleanup'); },
    },
    outboundRecipientGuardStore: {
      async findRecipientSuppressionConflict() {
        calls.push('suppression');
        return { ok: true, conflict: options.suppressed ? { recipient_email: recipient } : null };
      },
      async reserveRecipients() { throw new Error('A proven inbound reply must not become a second coldmail'); },
    },
    createTransport: () => ({ async sendMail(message) {
      calls.push('smtp'); sent.push(message);
      return { messageId: message.messageId, accepted: [message.to], rejected: [] };
    } }),
    logger: { warn() {}, error() {}, log() {} },
  });
  const body = {
    account: smtpAccount, owner: 'martijn', provider: 'smtp', replyTransport: 'smtp',
    mode: 'reply', idempotencyKey: 'kidssenz-smtp-attachments', to: recipient,
    subject: 'Re: Kleine vraag over jullie website', body: 'Hoi Renata, hierbij de logo’s.',
    replyIdentity: identity,
    context: { id: source.id, folder: 'instantly', messageId: source.messageId,
      conversationId: source.conversationId, references: source.references },
    attachments: [{ reference: 'test-staged-reference', ...metadata }],
    attachmentsMetadata: [metadata], ...options.body,
  };
  return {
    sent, calls, body, service,
    async preflight() {
      const res = response();
      await service.preflightMessageResponse({ body }, res);
      return res;
    },
    async send(proof) {
      const res = response();
      await service.sendMessageResponse({ body: { ...body, reconcileProof: proof } }, res);
      return res;
    },
    async cleanup() {
      const res = response();
      await service.attachmentCleanupResponse({ body }, res);
      return res;
    },
    resolver: createMailboxComposeThreadContext({ instantlyMailboxService }),
  };
}

test('Instantly attachment reply uses a proven SMTP identity, RFC thread headers and one durable send', async () => {
  const h = harness();
  const preflight = await h.preflight();
  assert.equal(preflight.statusCode, 200, JSON.stringify(preflight.body));
  const result = preflight.body.result;
  assert.equal(result.provider, 'smtp');
  assert.equal(result.accountEmail, smtpAccount);
  assert.equal(result.replyTargetMessageId, source.messageId);
  assert.equal(result.providerThreadId, '');
  assert.equal(result.correspondenceSourceMessageId, source.messageId);
  const first = await h.send(result.reconcileProof);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].inReplyTo, source.messageId);
  assert.equal(h.sent[0].references, `${source.references} ${source.messageId}`);
  assert.deepEqual(h.sent[0].attachments.map((attachment) => attachment.content), [content]);
  assert.ok(h.calls.indexOf('source-proof') < h.calls.indexOf('claim'));
  assert.ok(h.calls.indexOf('suppression') < h.calls.indexOf('smtp'));
  assert.equal(first.body.result.sentMessage.conversationId, source.conversationId);
  assert.equal(first.body.result.sentMessage.attachments[0].filename, metadata.filename);
  const replay = await h.send(result.reconcileProof);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.result.idempotentReplay, true);
  assert.equal(h.sent.length, 1);
  const binding = await h.resolver.resolve({ body: h.body, recipientEmail: recipient });
  const cleanupBinding = h.resolver.resolveAttachmentCleanupBinding({ body: h.body, recipientEmail: recipient });
  assert.equal(createBindingHash(binding), createBindingHash(cleanupBinding));
  assert.equal((await h.cleanup()).statusCode, 200);
});

for (const [name, options, code] of [
  ['other owner', { body: { account: 'serve@softora.nl' } }, 'MAILBOX_SEND_OWNER_MISMATCH'],
  ['other recipient', { body: { to: 'other@example.nl' } }, 'INSTANTLY_REPLY_RECIPIENT_MISMATCH'],
  ['sent source', { source: { direction: 'sent', folder: 'sent' } }, 'MAILBOX_REPLY_TARGET_MISMATCH'],
  ['no RFC identity', { source: { messageId: 'provider-uuid' } }, 'MAILBOX_REPLY_TARGET_MISMATCH'],
  ['forged RFC identity', { body: { replyIdentity: { ...identity, sourceMessageId: '<forged@example.nl>' } } }, 'MAILBOX_REPLY_TARGET_MISMATCH'],
  ['unavailable SMTP', { smtpUnavailable: true }, 'MAILBOX_SMTP_UNAVAILABLE'],
]) {
  test(`SMTP attachment preflight refuses ${name} before upload or send`, async () => {
    const h = harness(options);
    const res = await h.preflight();
    assert.notEqual(res.statusCode, 200);
    assert.equal(res.body.code, code);
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.includes('claim'), false);
    assert.equal(h.calls.includes('attachment-download'), false);
  });
}

test('SMTP delivery retains recipient suppression and never silently drops an attachment', async () => {
  const h = harness({ suppressed: true });
  const preflight = await h.preflight();
  const res = await h.send(preflight.body.result.reconcileProof);
  assert.notEqual(res.statusCode, 200);
  assert.equal(h.sent.length, 0);
  assert.ok(h.calls.includes('suppression'));
});

test('Instantly API delivery still refuses attachments without the proven SMTP transport', async () => {
  const h = harness({ body: { account: providerAccount, provider: 'instantly', replyTransport: undefined } });
  assert.equal((await h.preflight()).body.code, 'INSTANTLY_ATTACHMENTS_UNSUPPORTED');
  assert.equal(h.sent.length, 0);
});

function field(value = '') {
  return { value, hidden: false, disabled: false, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
}

test('composer keeps the draft and attachments and visibly selects only the original owner’s SMTP accounts', async () => {
  const fields = new Map(['c-to', 'c-subject', 'c-body', 'c-cc', 'c-bcc', 'c-from',
    'compose-from-field', 'compose-attachment-delivery', 'compose-overlay'].map((id) => [id, field()]));
  const document = { getElementById: (id) => fields.get(id), querySelector: () => null };
  const accounts = [{ email: smtpAccount, smtpConfigured: true }, { email: 'serve@softora.nl', smtpConfigured: true },
    { email: providerAccount, smtpConfigured: false }];
  const attachments = [{ name: metadata.filename, size: metadata.size, type: metadata.contentType }];
  const sent = [], toasts = [];
  const campaignInbox = { resolveReplyAccount: () => providerAccount, getMessageOwner: () => 'martijn',
    getOwnerByAccount: (account) => account.startsWith('serve') ? 'serve' : 'martijn',
    getConversationAction: (message) => ({ kind: 'reply', isRoot: true, message }) };
  const controller = controllerModule.create({ document, campaignInbox, getAccounts: () => accounts,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    getAccount: () => providerAccount, getOwner: () => 'martijn', getActiveFolder: () => 'outreach',
    findMail: () => source, toast: (text) => toasts.push(text),
    display: { getReplyToAddress: () => recipient, formatDetailSubject: (value) => value },
    compose: { buildReplyContext: () => ({ ...composeModule.buildReplyContext(source), replyIdentity: identity }),
      reset() {}, resetOptionalFields() {}, getAttachments: () => attachments, uploadAttachments() {},
      removeAttachment: () => attachments.splice(0, 1) },
    sendResilience: { async execute(input) { sent.push(input); throw new Error('Test stops before dispatch'); } },
  });
  controller.reply(source);
  fields.get('c-body').value = 'Mijn oorspronkelijke concept.';
  await controller.send();
  assert.equal(fields.get('compose-from-field').hidden, false);
  assert.equal(fields.get('compose-attachment-delivery').hidden, false);
  assert.equal(fields.get('c-from').value, smtpAccount);
  assert.doesNotMatch(fields.get('c-from').innerHTML, /serve@|websoftora/);
  assert.equal(fields.get('c-body').value, 'Mijn oorspronkelijke concept.');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.provider, 'smtp');
  assert.equal(sent[0].payload.account, smtpAccount);
  assert.equal(sent[0].payload.replyTransport, 'smtp');
  assert.deepEqual(sent[0].payload.replyIdentity, identity);
  assert.deepEqual(sent[0].attachments, attachments);
  assert.equal(toasts.some((text) => text.includes('geen bijlagen')), false);
  fields.get('c-from').value = 'serve@softora.nl';
  await controller.send();
  assert.equal(sent.length, 1, 'another owner must not reach dispatch');
  controller.handleAction('remove-attachment', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fields.get('compose-attachment-delivery').hidden, true);
  assert.equal(fields.get('compose-from-field').hidden, true);
  await controller.send();
  assert.equal(sent[1].payload.provider, 'instantly');
  assert.equal(sent[1].payload.replyTransport, undefined);
  assert.equal(sent[1].payload.account, providerAccount);
  const sender = senderModule.create({ document, campaignInbox, getAccounts: () => accounts });
  await sender.open();
  assert.equal(fields.get('c-from').value, '', 'fresh mail still requires an explicit sender choice');
});

test('switching delivery retains the original local uncertainty scope but changes the payload fingerprint', async () => {
  const h = harness();
  const original = { ...h.body, account: providerAccount, provider: 'instantly', replyTransport: undefined,
    providerMessageId: identity.providerMessageId, providerThreadId: identity.providerThreadId };
  assert.equal(await sendState.createLocalScopeFingerprint(original), await sendState.createLocalScopeFingerprint(h.body));
  assert.notEqual(await sendState.createPayloadFingerprint(original, [metadata]),
    await sendState.createPayloadFingerprint(h.body, [metadata]));
});

test('browser protocol accepts the real SMTP preflight and sends the staged attachment exactly once', async () => {
  const h = harness();
  const values = new Map();
  const storage = {
    get length() { return values.size; }, key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const protocol = resilience.create({ storage, attachmentDigest,
    locks: { request: async (...args) => args.at(-1)({ name: args[0], mode: 'exclusive' }) },
    fetch: async (url, request) => {
      const body = JSON.parse(request.body);
      const res = response();
      if (url.endsWith('/preflight')) await h.service.preflightMessageResponse({ body }, res);
      else await h.service.sendMessageResponse({ body }, res);
      return { status: res.statusCode, ok: res.statusCode === 200, json: async () => res.body };
    },
  });
  const attachments = [{ name: metadata.filename, filename: metadata.filename,
    type: metadata.contentType, size: content.length, file: new File([content], metadata.filename, { type: metadata.contentType }) }];
  const result = await protocol.execute({ payload: h.body, attachments,
    uploadAttachments: async () => [{ reference: 'test-staged-reference', ...metadata,
      referenceVersion: 2, expiresAt: Date.now() + 120_000 }],
  });
  assert.equal(result.result.sentMessage.accountEmail, smtpAccount);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].attachments[0].content, content);
});

test('SMTP accepted reply appears in its proven Instantly conversation without crossing owners or replacing sender evidence', () => {
  const state = acceptedSend.create({ campaignInbox: { getMessageOwner: (message) => message.providerOwner },
    normalizeAcceptedMessage: (message) => ({ ...message }) });
  const message = { id: 'accepted-sent:logo-reply', messageId: '<logo-reply@softora.nl>',
    accountEmail: smtpAccount, providerOwner: 'martijn', provider: 'smtp', direction: 'sent', folder: 'sent',
    receivedAt: '2026-10-08T14:00:00.000Z', conversationId: source.conversationId };
  state.remember({ key: 'logo-reply', accountEmail: smtpAccount, sourceAccountEmail: providerAccount,
    owner: 'martijn', mode: 'reply', sourceMailId: source.id, acceptedAt: message.receivedAt,
    conversationKeys: [source.conversationId], message });
  const original = { ...source, threadMessages: [] };
  const otherOwner = { ...source, providerOwner: 'serve', threadMessages: [] };
  state.reconcile(original);
  state.reconcile(otherOwner);
  assert.equal(original.threadMessages.length, 1);
  assert.equal(original.threadMessages[0].accountEmail, smtpAccount);
  assert.equal(original.threadMessages[0].provider, 'smtp');
  assert.deepEqual(otherOwner.threadMessages, []);
});
