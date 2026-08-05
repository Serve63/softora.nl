const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxComposeSend } = require('../../server/services/mailbox-compose-send');
const { MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION } = require('../../server/services/mailbox-compose-email-renderer');

test('mailbox compose returns the exact accepted sent message for immediate reconciliation', async () => {
  const sentAt = new Date('2026-08-05T14:05:06.000Z');
  const sentCopies = [];
  const sendMessage = createMailboxComposeSend({
    getAccount: () => ({
      email: 'serve@softora.nl',
      name: 'Servé Creusen',
      smtpConfigured: true,
      smtpIdentityMatches: true,
      smtpHost: 'smtp.example.test',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'serve@softora.nl',
      smtpPass: 'secret',
    }),
    isValidEmail: (value) => /^[^@]+@[^@]+\.[^@]+$/.test(String(value || '')),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
    createTransport: () => ({
      sendMail: async () => ({
        messageId: '<accepted-compose@softora.nl>',
        accepted: ['ontvanger@example.nl'],
        rejected: [],
      }),
    }),
    buildMailboxWebdesignSendParts: async () => null,
    reserveMailboxWebdesignOutboundRecipient: async () => null,
    confirmMailboxWebdesignOutboundRecipient: async () => {},
    appendSentMessage: async (payload) => { sentCopies.push(payload); return true; },
    now: () => sentAt,
    logger: { warn() {} },
  });

  const result = await sendMessage({
    accountEmail: 'serve@softora.nl',
    to: 'Ontvanger@Example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    subject: 'Re: Kleine vraag',
    text: 'Dankjewel voor je reactie 😁',
  });

  assert.equal(sentCopies.length, 1);
  assert.equal(sentCopies[0].mail.text, 'Dankjewel voor je reactie 😁');
  assert.match(sentCopies[0].mail.html, /class="softora-webdesign-email-body softora-mailbox-compose-body"/);
  assert.match(sentCopies[0].mail.html, /font-size:16px;line-height:26px/);
  assert.equal(sentCopies[0].mail.headers['X-Softora-Template-Version'], MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION);
  assert.equal(result.messageId, '<accepted-compose@softora.nl>');
  assert.deepEqual(result.sentMessage, {
    id: 'accepted-sent:<accepted-compose@softora.nl>',
    mailboxId: 'accepted-sent:<accepted-compose@softora.nl>',
    folder: 'sent',
    storageFolder: 'sent',
    direction: 'sent',
    accountEmail: 'serve@softora.nl',
    messageId: '<accepted-compose@softora.nl>',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'ontvanger@example.nl',
    toDisplay: 'ontvanger@example.nl',
    cc: 'cc@example.nl',
    bcc: 'bcc@example.nl',
    recipientRoutingEvidenceKnown: true,
    subject: 'Re: Kleine vraag',
    body: 'Dankjewel voor je reactie 😁',
    preview: 'Dankjewel voor je reactie 😁',
    receivedAt: sentAt.toISOString(),
    activityAt: sentAt.toISOString(),
    hasBody: true,
    bodyTruncated: false,
    unread: false,
  });
});
