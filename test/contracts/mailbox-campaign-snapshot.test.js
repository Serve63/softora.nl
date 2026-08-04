const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS,
  markMailboxCampaignSnapshotReplyDismissed,
  parseMailboxCampaignSnapshot,
  removeMailboxCampaignSnapshotMessage,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');

test('mailbox campaign snapshot bewaart een afgehandelde antwoordherinnering', () => {
  const raw = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      unread: true,
      subject: 'Re: Kleine vraag',
      date: '2026-08-04T14:00:00.000Z',
    }],
  });
  const result = markMailboxCampaignSnapshotReplyDismissed(
    raw,
    { accountEmail: 'serve@softora.nl', folder: 'inbox', id: 'inbox:42', uid: 42 },
    { dismissedAt: '2026-08-04T15:10:00.000Z' }
  );
  const [message] = parseMailboxCampaignSnapshot(result.serialized).messages;

  assert.equal(result.changed, true);
  assert.equal(message.unread, false);
  assert.equal(message.replyDismissedAt, '2026-08-04T15:10:00.000Z');
});

test('mailbox campaign snapshot blijft compact en opent de nieuwste mail direct', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `inbox:${100 - index}`,
    uid: 100 - index,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: `Bedrijf ${index}`,
    email: `bedrijf-${index}@example.test`,
    subject: `Reactie ${index}`,
    preview: `Preview ${index}`,
    body: `Volledige inhoud ${index} ${'x'.repeat(59_000)}`,
    date: new Date(Date.UTC(2026, 6, 22, 14, 0, 0) - index * 60_000).toISOString(),
    unread: index < 2,
    indexed: true,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 1,
    originalCampaignOutbound: false,
    bodyImages: [{ alt: 'Ontwerp', dataUrl: `data:image/png;base64,${'a'.repeat(150_000)}` }],
    campaign: {
      company: `Bedrijf ${index}`,
      account: 'serve@softora.nl',
      customerId: `customer-${index}`,
      status: 'reactie_ontvangen',
      actionRequired: true,
    },
    threadMessages: index === 0 ? [{
      id: 'sent:201',
      uid: 201,
      folder: 'sent',
      accountEmail: 'serve@softora.nl',
      from: 'Servé Creusen',
      email: 'serve@softora.nl',
      to: 'bedrijf-0@example.test',
      subject: 'Re: Reactie 0',
      body: 'Dankjewel voor je reactie.',
      date: '2026-07-22T14:05:00.000Z',
      messageId: '<sent-answer@example.test>',
      inReplyTo: '<inbox-answer@example.test>',
      bodyImageEvidenceKnown: true,
      embeddedImageCount: 1,
      originalCampaignOutbound: false,
      bodyImages: [{
        alt: 'Verzonden ontwerp',
        dataUrl: `data:image/png;base64,${'b'.repeat(120)}`,
      }],
    }] : [],
  }));

  const serialized = serializeMailboxCampaignSnapshot(
    { ok: true, messages, sync: { indexed: true, stale: false } },
    { savedAt: '2026-07-22T21:00:00.000Z' }
  );
  const parsed = parseMailboxCampaignSnapshot(serialized);

  assert.ok(serialized.length <= MAILBOX_CAMPAIGN_SNAPSHOT_MAX_CHARS);
  assert.equal(parsed.messages.length, 100);
  assert.match(parsed.messages[0].body, /^Volledige inhoud 0/);
  assert.equal(parsed.messages[0].campaign.company, 'Bedrijf 0');
  assert.deepEqual(parsed.messages[0].threadMessages, [{
    id: 'sent:201',
    uid: 201,
    folder: 'sent',
    accountEmail: 'serve@softora.nl',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'bedrijf-0@example.test',
    toDisplay: '',
    cc: '',
    bcc: '',
    deliveredTo: '',
    recipientRoutingEvidenceKnown: false,
    attachments: [],
    subject: 'Re: Reactie 0',
    preview: '',
    body: 'Dankjewel voor je reactie.',
    optOutUrl: '',
    date: '2026-07-22T14:05:00.000Z',
    messageId: '<sent-answer@example.test>',
    inReplyTo: '<inbox-answer@example.test>',
    references: '',
    hasBody: true,
    bodyImageEvidenceKnown: true,
    embeddedImageCount: 1,
    originalCampaignOutbound: false,
    webdesignLinkEvidenceKnown: false,
    webdesignLinkUrl: '',
    bodyTruncated: false,
    bodyImagesTruncated: false,
    bodyImages: [{
      alt: 'Verzonden ontwerp',
      dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=sent&id=sent%3A201&index=0',
    }],
  }]);
  assert.deepEqual(parsed.messages[0].bodyImages, [{
    alt: 'Ontwerp',
    dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A100&index=0',
  }]);
  assert.equal(parsed.messages[0].bodyImagesTruncated, false);
  assert.equal(parsed.messages.at(-1).body, '');
  assert.deepEqual(parsed.messages.at(-1).bodyImages, [{
    alt: 'Ontwerp',
    dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A1&index=0',
  }]);
  assert.equal(parsed.messages.at(-1).bodyImagesTruncated, false);
  assert.equal(parsed.sync.source, 'campaign-replies-snapshot');
});

test('mailbox campaign snapshot bewaart conversatie-id en ontvangen threadberichten', () => {
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'inbox:37476',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      subject: 'Re: Kleine vraag over jullie website',
      date: '2026-07-23T09:31:11.000Z',
      activityAt: '2026-07-23T11:31:12.000Z',
      conversationId: 'conversation:martijnven123@gmail.com|campaign-start@example.test',
      threadMessages: [{
        id: 'inbox:37467',
        folder: 'inbox',
        accountEmail: 'martijnven123@gmail.com',
        subject: 'Re: Kleine vraag over jullie website',
        body: 'Het eerdere ontvangen bericht.',
        date: '2026-07-22T15:36:03.000Z',
      }],
    }],
  });
  const [message] = parseMailboxCampaignSnapshot(serialized).messages;

  assert.equal(
    message.conversationId,
    'conversation:martijnven123@gmail.com|campaign-start@example.test'
  );
  assert.equal(message.receivedAt, '2026-07-23T09:31:11.000Z');
  assert.equal(message.activityAt, '2026-07-23T11:31:12.000Z');
  assert.equal(message.threadMessages[0].folder, 'inbox');
  assert.equal(message.threadMessages[0].body, 'Het eerdere ontvangen bericht.');
});

test('mailbox campaign snapshot bewaart volledige Instantly provenance voor root en thread', () => {
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'serve@websoftora.com|instantly-thread:ramon-thread',
      mailboxId: 'instantly:ramon-reply',
      provider: 'instantly',
      providerMessageId: 'ramon-reply',
      providerThreadId: 'ramon-thread',
      providerCampaignId: 'campaign-serve',
      providerAccountEmail: 'serve@websoftora.com',
      providerOwner: 'serve',
      storageFolder: 'instantly',
      storageUid: 12345,
      direction: 'received',
      providerBodyHtmlEvidenceKnown: true,
      providerRichBodyAvailable: true,
      providerOriginalBodyEvidenceKnown: true,
      providerOriginalBodyAvailable: true,
      folder: 'inbox',
      accountEmail: 'serve@websoftora.com',
      email: 'info@ramoncc.nl',
      body: 'Dank voor je bericht.',
      date: '2026-07-07T10:47:10.000Z',
      conversationId: 'instantly:serve@websoftora.com:ramon-thread',
      campaign: {
        provider: 'instantly',
        campaignId: 'campaign-serve',
        account: 'serve@websoftora.com',
        company: 'Ramon Design Store',
      },
      outreach: {
        provider: 'instantly',
        threadId: 'ramon-thread',
        owner: 'serve',
      },
      threadMessages: [{
        id: 'instantly:ramon-original',
        provider: 'instantly',
        providerMessageId: 'ramon-original',
        providerThreadId: 'ramon-thread',
        providerCampaignId: 'campaign-serve',
        providerAccountEmail: 'serve@websoftora.com',
        providerOwner: 'serve',
        storageFolder: 'instantly',
        storageUid: 67890,
        direction: 'sent',
        providerOriginalBodyEvidenceKnown: true,
        providerOriginalBodyAvailable: true,
        folder: 'sent',
        accountEmail: 'serve@websoftora.com',
        body: 'De oorspronkelijke mail.',
        date: '2026-07-07T05:52:41.000Z',
      }],
    }],
  });
  const [message] = parseMailboxCampaignSnapshot(serialized).messages;

  assert.equal(message.provider, 'instantly');
  assert.equal(message.providerOwner, 'serve');
  assert.equal(message.providerAccountEmail, 'serve@websoftora.com');
  assert.equal(message.providerThreadId, 'ramon-thread');
  assert.equal(message.storageFolder, 'instantly');
  assert.equal(message.storageUid, 12345);
  assert.equal(message.campaign.provider, 'instantly');
  assert.equal(message.campaign.campaignId, 'campaign-serve');
  assert.equal(message.outreach.provider, 'instantly');
  assert.equal(message.outreach.owner, 'serve');
  assert.equal(message.threadMessages[0].provider, 'instantly');
  assert.equal(message.threadMessages[0].providerOwner, 'serve');
  assert.equal(message.threadMessages[0].providerMessageId, 'ramon-original');
  assert.equal(message.threadMessages[0].storageFolder, 'instantly');
  assert.equal(message.threadMessages[0].direction, 'sent');
});

test('mailbox campaign snapshot bewaart oudere Instantly-gesprekken van beide eigenaren binnen de limiet', () => {
  const regularMessages = Array.from({ length: 100 }, (_, index) => ({
    id: `inbox:${index + 1}`,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    email: `bedrijf-${index}@example.test`,
    subject: `Reactie ${index}`,
    date: new Date(Date.UTC(2026, 6, 26, 18, 0, 0) - index * 60_000).toISOString(),
  }));
  const instantlyMessages = [{
    id: 'serve@websoftora.com|instantly-thread:ramon-thread',
    provider: 'instantly',
    providerMessageId: 'ramon-reply',
    providerThreadId: 'ramon-thread',
    providerAccountEmail: 'serve@websoftora.com',
    providerOwner: 'serve',
    folder: 'inbox',
    accountEmail: 'serve@websoftora.com',
    email: 'info@ramoncc.nl',
    date: '2026-07-07T10:47:10.000Z',
  }, {
    id: 'martijn@websoftora.com|instantly-thread:martijn-thread',
    provider: 'instantly',
    providerMessageId: 'martijn-reply',
    providerThreadId: 'martijn-thread',
    providerAccountEmail: 'martijn@websoftora.com',
    providerOwner: 'martijn',
    folder: 'inbox',
    accountEmail: 'martijn@websoftora.com',
    email: 'contact@example.test',
    date: '2026-06-01T10:00:00.000Z',
  }];

  const parsed = parseMailboxCampaignSnapshot(serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [...regularMessages, ...instantlyMessages],
  }));

  assert.equal(parsed.messages.length, 100);
  assert.ok(parsed.messages.some((message) => message.email === 'info@ramoncc.nl'));
  assert.deepEqual(
    parsed.messages
      .filter((message) => message.provider === 'instantly')
      .map((message) => message.providerOwner),
    ['serve', 'martijn']
  );
  assert.equal(parsed.messages.some((message) => message.id === 'inbox:99'), false);
  assert.equal(parsed.messages.some((message) => message.id === 'inbox:100'), false);
});

test('mailbox campaign snapshot herstelt laatste activiteit uit oude threaddata', () => {
  const legacySnapshot = JSON.stringify({
    version: 6,
    savedAt: '2026-07-23T15:00:00.000Z',
    ok: true,
    messages: [{
      id: 'martijn@softora.nl|inbox|23',
      folder: 'inbox',
      accountEmail: 'martijn@softora.nl',
      email: 'rruyters@road2value.com',
      date: '2026-06-15T13:58:18.000Z',
      receivedAt: '2026-06-15T13:58:18.000Z',
      conversationId: 'conversation:martijn@softora.nl|contact:rruyters@road2value.com',
      threadMessages: [{
        id: 'martijn@softora.nl|sent|111',
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        date: '2026-06-16T12:31:32.000Z',
      }, {
        id: 'martijn@softora.nl|sent|149',
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        date: '2026-06-23T11:32:58.000Z',
      }],
    }],
    sync: {
      indexed: true,
      stale: false,
    },
  });
  const [message] = parseMailboxCampaignSnapshot(legacySnapshot).messages;

  assert.equal(message.receivedAt, '2026-06-15T13:58:18.000Z');
  assert.equal(message.activityAt, '2026-06-23T11:32:58.000Z');
});

test('mailbox campaign snapshot bewaart de volledige conversatie van meer dan tien berichten', () => {
  const threadMessages = Array.from({ length: 12 }, (_, index) => ({
    id: `sent:${index + 1}`,
    uid: index + 1,
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    to: 'rruyters@road2value.com',
    subject: 'Re: Kleine vraag over jullie website',
    preview: `Bericht ${index + 1}`,
    body: `Volledige inhoud ${index + 1}`,
    date: new Date(Date.UTC(2026, 5, 23, 12, 0, 0) - index * 60_000).toISOString(),
  }));
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'inbox:23',
      folder: 'inbox',
      accountEmail: 'martijn@softora.nl',
      email: 'rruyters@road2value.com',
      conversationId: 'conversation:martijn@softora.nl|contact:rruyters@road2value.com',
      threadMessages,
    }],
  });
  const [message] = parseMailboxCampaignSnapshot(serialized).messages;

  assert.equal(message.threadMessages.length, 12);
  assert.equal(message.threadMessages[0].body, 'Volledige inhoud 1');
  assert.equal(message.threadMessages.at(-1).body, 'Volledige inhoud 12');
});

test('mailbox campaign snapshot bewaart alleen complete afbeeldingen', () => {
  const smallImage = `data:image/png;base64,${'a'.repeat(120)}`;
  const oversizedImage = `data:image/jpeg;base64,${'b'.repeat(90_000)}`;
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [{
      id: 'inbox:1',
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
      body: 'Bericht met afbeeldingen',
      bodyImages: [
        { alt: 'Klein ontwerp', dataUrl: smallImage, owner: 'sent-campaign' },
        { alt: 'Grote mockup', dataUrl: oversizedImage },
      ],
    }],
  });
  const [message] = parseMailboxCampaignSnapshot(serialized).messages;

  assert.deepEqual(message.bodyImages, [
    {
      alt: 'Klein ontwerp',
      dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A1&index=0',
      owner: 'sent-campaign',
    },
    {
      alt: 'Grote mockup',
      dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A1&index=1',
    },
  ]);
  assert.equal(message.bodyImagesTruncated, false);
  assert.doesNotMatch(serialized, new RegExp(smallImage.slice(0, 100)));
  assert.doesNotMatch(serialized, new RegExp(oversizedImage.slice(0, 80_000)));
});

test('mailbox campaign snapshot verwijdert alleen de exact gekozen mail', () => {
  const serialized = serializeMailboxCampaignSnapshot({
    ok: true,
    messages: [
      { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl', subject: 'Weg' },
      { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'martijn@softora.nl', subject: 'Blijft' },
      { id: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl', subject: 'Blijft ook' },
    ],
  }, { savedAt: '2026-07-23T10:00:00.000Z' });

  const next = removeMailboxCampaignSnapshotMessage(serialized, {
    accountEmail: 'SERVE@SOFTORA.NL',
    folder: 'INBOX',
    uid: 42,
  }, { savedAt: '2026-07-23T10:01:00.000Z' });
  const parsed = parseMailboxCampaignSnapshot(next.serialized);

  assert.equal(next.changed, true);
  assert.equal(parsed.savedAt, '2026-07-23T10:01:00.000Z');
  assert.deepEqual(parsed.messages.map((message) => [message.accountEmail, message.uid]), [
    ['martijn@softora.nl', 42],
    ['serve@softora.nl', 43],
  ]);
});

test('mailbox campaign snapshot weigert lege en ongeldige data', () => {
  assert.equal(serializeMailboxCampaignSnapshot({ ok: true, messages: [] }), '');
  assert.equal(parseMailboxCampaignSnapshot('{kapot'), null);
  assert.equal(parseMailboxCampaignSnapshot(JSON.stringify({ version: 2, messages: [] })), null);
  assert.equal(parseMailboxCampaignSnapshot(JSON.stringify({ version: 3, messages: [{}] })), null);
});
