const test = require('node:test');
const assert = require('node:assert/strict');

const { createConfirmationMailService } = require('../../server/services/confirmation-mail');

function createFixture(overrides = {}) {
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const dashboardActivities = [];
  const transportCalls = [];
  const markedSeenCalls = [];
  const releaseCalls = [];
  let loggedOut = false;

  const runtimeState = overrides.runtimeState || {};
  const transport = overrides.transport || {
    sendMail: async (payload) => {
      transportCalls.push(payload);
      return {
        messageId: '<message-1@example.com>',
        response: '250 OK',
        accepted: [payload.to],
        rejected: [],
        envelope: { from: payload.from, to: [payload.to] },
      };
    },
  };

  const client =
    overrides.client || {
      usable: true,
      connect: async () => {},
      getMailboxLock: async () => ({
        release() {
          releaseCalls.push(true);
        },
      }),
      search: async (criteria) => (criteria[0] === 'UNSEEN' ? [7] : [7]),
      fetch: async function* () {
        yield {
          uid: 7,
          source: Buffer.from('mail source'),
          flags: new Set(),
        };
      },
      messageFlagsAdd: async (uids, flags, options) => {
        markedSeenCalls.push({ uids, flags, options });
      },
      logout: async () => {
        loggedOut = true;
      },
    };

  const service = createConfirmationMailService({
    mailConfig: {
      smtpHost: overrides.smtpHost === undefined ? 'smtp.example.com' : overrides.smtpHost,
      smtpPort: overrides.smtpPort === undefined ? 587 : overrides.smtpPort,
      smtpSecure: overrides.smtpSecure === undefined ? false : overrides.smtpSecure,
      smtpUser: overrides.smtpUser === undefined ? 'mailer@example.com' : overrides.smtpUser,
      smtpPass: overrides.smtpPass === undefined ? 'secret' : overrides.smtpPass,
      mailFromAddress:
        overrides.mailFromAddress === undefined ? 'info@softora.nl' : overrides.mailFromAddress,
      mailFromName: overrides.mailFromName === undefined ? 'Softora' : overrides.mailFromName,
      mailReplyTo: overrides.mailReplyTo === undefined ? 'reply@softora.nl' : overrides.mailReplyTo,
      imapHost: overrides.imapHost === undefined ? 'imap.example.com' : overrides.imapHost,
      imapPort: overrides.imapPort === undefined ? 993 : overrides.imapPort,
      imapSecure: overrides.imapSecure === undefined ? true : overrides.imapSecure,
      imapUser: overrides.imapUser === undefined ? 'mailer@example.com' : overrides.imapUser,
      imapPass: overrides.imapPass === undefined ? 'secret' : overrides.imapPass,
      imapMailbox: overrides.imapMailbox === undefined ? 'INBOX' : overrides.imapMailbox,
      imapExtraMailboxes:
        overrides.imapExtraMailboxes === undefined ? ['Spam', 'INBOX', 'Junk'] : overrides.imapExtraMailboxes,
      imapPollCooldownMs:
        overrides.imapPollCooldownMs === undefined ? 20_000 : overrides.imapPollCooldownMs,
    },
    runtimeState,
    generatedAgendaAppointments,
    appendDashboardActivity: (activity) => dashboardActivities.push(activity),
    getGeneratedAppointmentIndexById:
      overrides.getGeneratedAppointmentIndexById ||
      ((taskIdRaw) =>
        generatedAgendaAppointments.findIndex(
          (item) => Number(item?.id || 0) === (Number(taskIdRaw) || 0)
        )),
    mapAppointmentToConfirmationTask:
      overrides.mapAppointmentToConfirmationTask ||
      ((appointment) =>
        appointment && !appointment.confirmationResponseReceived && !appointment.confirmationAppointmentCancelled
          ? { id: appointment.id }
          : null),
    normalizeDateYyyyMmDd: (value) => String(value || '').trim(),
    normalizeString: (value) => String(value || '').trim(),
    normalizeTimeHhMm: (value) => String(value || '').trim(),
    setGeneratedAgendaAppointmentAtIndex:
      overrides.setGeneratedAgendaAppointmentAtIndex ||
      ((idx, nextValue) => {
        generatedAgendaAppointments[idx] = { ...nextValue };
        return generatedAgendaAppointments[idx];
      }),
    formatDateTimeLabelNl: (date, time) => `${date} ${time}`.trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    createTransport: overrides.createTransport || (() => transport),
    createImapClient: overrides.createImapClient || (() => client),
    parseMailSource:
      overrides.parseMailSource ||
      (async () => ({
        subject: 'Re: [CT-42] Bevestiging afspraak',
        text: 'Ja, dat klopt. Tot dan!',
        from: { value: [{ address: 'klant+nieuw@gmail.com', name: 'Klant' }] },
        inReplyTo: '<message-1@example.com>',
        references: ['<message-1@example.com>'],
      })),
  });

  return {
    client,
    dashboardActivities,
    generatedAgendaAppointments,
    loggedOut: () => loggedOut,
    markedSeenCalls,
    releaseCalls,
    runtimeState,
    service,
    transportCalls,
  };
}

test('confirmation mail service builds fallback draft and sends SMTP mail with reply reference', async () => {
  const fixture = createFixture();

  const fallbackDraft = fixture.service.buildConfirmationEmailDraftFallback(
    {
      id: 42,
      company: 'Acme BV',
      contact: 'Jan',
      date: '2026-04-09',
      time: '09:30',
      summary: 'Intake voor de nieuwe website.',
    },
    {}
  );
  const delivery = await fixture.service.sendConfirmationEmailViaSmtp({
    appointment: {
      id: 42,
      company: 'Acme BV',
      date: '2026-04-09',
      time: '09:30',
    },
    recipientEmail: ' Klant@Example.com ',
    draftText: 'Onderwerp: Intake bevestigd\n\nBedankt voor het gesprek.',
  });

  assert.match(fallbackDraft, /Onderwerp: Bevestiging afspraak Acme BV - 2026-04-09 09:30/);
  assert.equal(fixture.service.isSmtpMailConfigured(), true);
  assert.deepEqual(fixture.service.getMissingSmtpMailEnv(), []);
  assert.equal(fixture.transportCalls.length, 1);
  assert.equal(fixture.transportCalls[0].from, 'Softora <info@softora.nl>');
  assert.equal(fixture.transportCalls[0].to, 'klant@example.com');
  assert.equal(fixture.transportCalls[0].replyTo, 'reply@softora.nl');
  assert.equal(fixture.transportCalls[0].subject, '[CT-42] Intake bevestigd');
  assert.match(fixture.transportCalls[0].text, /Referentie: CT-42/);
  assert.equal(delivery.messageId, '<message-1@example.com>');
});

test('confirmation mail service exposes missing SMTP and IMAP env hints when config is incomplete', () => {
  const fixture = createFixture({
    smtpHost: '',
    smtpUser: '',
    smtpPass: '',
    mailFromAddress: '',
    imapHost: '',
    imapUser: '',
    imapPass: '',
  });

  assert.equal(fixture.service.isSmtpMailConfigured(), false);
  assert.equal(fixture.service.isImapMailConfigured(), false);
  assert.deepEqual(fixture.service.getMissingSmtpMailEnv(), [
    'MAIL_SMTP_HOST',
    'MAIL_SMTP_USER',
    'MAIL_SMTP_PASS',
    'MAIL_FROM_ADDRESS',
  ]);
  assert.deepEqual(fixture.service.getMissingImapMailEnv(), [
    'MAIL_IMAP_HOST',
    'MAIL_IMAP_USER',
    'MAIL_IMAP_PASS',
  ]);
});

test('confirmation mail service syncs IMAP confirmation replies and marks matched mail as seen', async () => {
  const fixture = createFixture({
    generatedAgendaAppointments: [
      {
        id: 42,
        company: 'Acme BV',
        callId: 'call-42',
        contactEmail: 'kl.ant@gmail.com',
        confirmationEmailSent: true,
        confirmationEmailSentAt: '2026-04-07T10:00:00.000Z',
        confirmationEmailSentBy: 'SMTP',
        confirmationEmailLastSentMessageId: '<message-1@example.com>',
        confirmationResponseReceived: false,
        confirmationAppointmentCancelled: false,
      },
    ],
  });

  const result = await fixture.service.syncInboundConfirmationEmailsFromImap({
    force: true,
    maxMessages: 20,
  });

  assert.equal(result.ok, true);
  assert.equal(result.matched, 1);
  assert.equal(result.confirmed, 1);
  assert.equal(result.markedSeen, 1);
  assert.equal(fixture.generatedAgendaAppointments[0].confirmationResponseReceived, true);
  assert.equal(
    fixture.generatedAgendaAppointments[0].contactEmail,
    'klant+nieuw@gmail.com'
  );
  assert.equal(fixture.dashboardActivities.length, 1);
  assert.equal(fixture.dashboardActivities[0].type, 'appointment_confirmed_by_mail');
  assert.deepEqual(fixture.markedSeenCalls[0], {
    uids: [7],
    flags: ['\\Seen'],
    options: { uid: true },
  });
  assert.equal(fixture.releaseCalls.length, 5);
  assert.equal(fixture.loggedOut(), true);
  assert.ok(
    Number.isFinite(fixture.runtimeState.inboundConfirmationMailSyncNotBeforeMs) &&
      fixture.runtimeState.inboundConfirmationMailSyncNotBeforeMs > Date.now()
  );
});
