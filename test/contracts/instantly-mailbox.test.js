const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createInstantlyMailboxService,
  normalizeAccountOwnership,
} = require('../../server/services/instantly-mailbox');
const {
  buildOriginalMessageSource,
} = require('../../server/services/instantly-original-message-source');
const { createMailboxService } = require('../../server/services/mailbox');
const { createMailboxIndexStore } = require('../../server/services/mailbox-index-store');
const {
  createDefaultInstantlyMailboxService,
  mergeCampaignReplies,
} = require('../../server/services/mailbox-instantly-integration');

function createStore(initialMessages = []) {
  const rows = initialMessages.slice();
  const syncStates = new Map();
  return {
    rows,
    async getSyncState({ accountEmail, folder }) {
      return syncStates.get(`${accountEmail}|${folder}`) || null;
    },
    async acquireSyncLock({ accountEmail, folder }) {
      const lockToken = `lock:${accountEmail}:${folder}`;
      syncStates.set(`${accountEmail}|${folder}`, { lock_token: lockToken });
      return { ok: true, lockToken };
    },
    async finishSync({ accountEmail, folder, lockToken, messageCount, error }) {
      syncStates.set(`${accountEmail}|${folder}`, {
        lock_token: null,
        last_synced_at: error ? null : '2026-07-25T12:00:00.000Z',
        message_count: messageCount,
        last_error: error || null,
        finished_lock_token: lockToken,
      });
      return { ok: true };
    },
    async upsertProviderMessages({ messages }) {
      messages.forEach((message) => {
        const index = rows.findIndex(
          (candidate) => candidate.providerMessageId === message.providerMessageId
        );
        if (index >= 0) rows[index] = message;
        else rows.push(message);
      });
      return { ok: true, upserted: messages.length };
    },
    async listProviderMessages({ accountEmails }) {
      return rows.filter((message) => accountEmails.includes(message.accountEmail));
    },
  };
}

function buildService(overrides = {}) {
  const store = overrides.store || createStore();
  const requests = [];
  const service = createInstantlyMailboxService({
    config: {
      enabled: true,
      apiKey: 'instant-key',
      webhookSecret: 'webhook-secret',
      apiBaseUrl: 'https://api.instantly.test/api/v2',
      accountOwners: {
        'serve-sender@example.com': 'serve',
        'martijn-sender@example.com': 'martijn',
      },
      campaignOwners: {
        'campaign-serve': 'serve',
        'campaign-martijn': 'martijn',
      },
      ...(overrides.config || {}),
    },
    mailboxIndexStore: store,
    getUiStateValues: overrides.getUiStateValues,
    setUiStateValues: overrides.setUiStateValues,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    fetchJsonWithTimeout: async (url, options) => {
      requests.push({ url, options });
      if (overrides.fetchJsonWithTimeout) {
        return overrides.fetchJsonWithTimeout(url, options);
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });
  return { service, store, requests };
}

function incoming(overrides = {}) {
  return {
    id: 'incoming-serve-1',
    eaccount: 'serve-sender@example.com',
    campaign_id: 'campaign-serve',
    thread_id: 'thread-serve',
    email_type: 'received',
    from_address_email: 'prospect@example.org',
    from_address_name: 'Prospect',
    to_address_email_list: ['serve-sender@example.com'],
    subject: 'Re: Kleine vraag over jullie website',
    body: { text: 'Ik heb interesse.' },
    timestamp_email: '2026-07-25T11:00:00.000Z',
    ...overrides,
  };
}

test('Instantly account ownership is exact and rejects incomplete entries', () => {
  const ownership = normalizeAccountOwnership({
    'serve-account-id': { email: 'Serve-Sender@Example.com', owner: 'servé' },
    'martijn-sender@example.com': 'martijn',
    'unknown@example.com': 'someone-else',
    broken: 'serve',
  });
  assert.equal(ownership.get('serve-account-id').owner, 'serve');
  assert.equal(ownership.get('serve-sender@example.com').key, 'serve-account-id');
  assert.equal(ownership.get('martijn-sender@example.com').owner, 'martijn');
  assert.equal(ownership.has('unknown@example.com'), false);
  assert.equal(ownership.has('broken'), false);
});

test('Instantly original HTML keeps paragraph structure and the exact proven webdesign anchor', () => {
  const { service } = buildService();
  const message = service.normalizeInstantlyMessage(incoming({
    id: 'rich-outbound',
    email_type: 'sent',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['prospect@example.org'],
    body: {
      text: 'Goedendag, Dit is plat. Je kunt het webdesign hier bekijken.',
      html: [
        '<div class="softora-instantly-email-body">',
        '<p>Goedendag,</p>',
        '<p>Dit is de tweede alinea.</p>',
        '<p>Je kunt het webdesign <a href="https://www.softora.nl/webdesign/prospect?cid=exact">hier</a> bekijken.</p>',
        '<script>niet-tonen()</script>',
        '<p><a href="javascript:alert(1)">onveilig</a></p>',
        '</div>',
      ].join(''),
    },
  }));

  assert.equal(message.body, [
    'Goedendag,',
    '',
    'Dit is de tweede alinea.',
    '',
    'Je kunt het webdesign hier [https://www.softora.nl/webdesign/prospect?cid=exact] bekijken.',
    '',
    'onveilig',
  ].join('\n'));
  assert.equal(message.providerBodyHtmlEvidenceKnown, true);
  assert.equal(message.providerRichBodyAvailable, true);
  assert.equal(message.webdesignLinkEvidenceKnown, true);
  assert.equal(
    message.webdesignLinkUrl,
    'https://www.softora.nl/webdesign/prospect?cid=exact'
  );
  assert.doesNotMatch(message.body, /script|javascript|niet-tonen/);
});

test('Instantly never invents a webdesign link when exact provider HTML has none', () => {
  const { service } = buildService();
  const message = service.normalizeInstantlyMessage(incoming({
    id: 'no-rich-link',
    body: {
      text: 'Je kunt het webdesign hier bekijken.',
      html: '<p>Je kunt het webdesign hier bekijken.</p>',
    },
  }));

  assert.equal(message.body, 'Je kunt het webdesign hier bekijken.');
  assert.equal(message.webdesignLinkEvidenceKnown, false);
  assert.equal(message.webdesignLinkUrl, '');
});

test('exact lead source restores Ramon-style emoji and direct hier link after strict provenance checks', async () => {
  const exactUrl = 'https://www.softora.nl/webdesign/ramon-design-store?cid=exact&sender=serve';
  const providerHtml = [
    '<div>Goedendag,</div>',
    '<div><br></div>',
    '<div>Ik ben benieuwd wat je ervan vindt en hoor graag je eerlijke mening </div>',
    '<div>Je kunt het webdesign <a href="https://inst.example.test/lt/click-token">hier</a> bekijken </div>',
    '<div>Servé Creusen</div>',
    '<div>Den Bosch</div>',
  ].join('');
  const sourceHtml = [
    '<div>Goedendag,</div>',
    '<div><br></div>',
    '<div>Ik ben benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁</div>',
    `<div>Je kunt het webdesign <a href="${exactUrl}">hier</a> bekijken 👈</div>`,
    '<div>Servé Creusen</div>',
    '<div>📍 Den Bosch</div>',
  ].join('');
  const rawSent = incoming({
    id: 'ramon-sent',
    lead: 'prospect@example.org',
    email_type: '1',
    campaign_id: 'campaign-serve',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['prospect@example.org'],
    subject: 'Kleine vraag over jullie website',
    body: { html: providerHtml },
  });
  const rawReceived = incoming({ id: 'ramon-received' });
  const lead = {
    id: 'lead-ramon',
    campaign: 'campaign-serve',
    contact: 'prospect@example.org',
    payload: {
      softora_sender_email: 'serve-sender@example.com',
      softora_subject: 'Kleine vraag over jullie website',
      softora_webdesign_public_url: exactUrl,
      softora_instantly_email_html: sourceHtml,
    },
  };
  const store = createStore();
  const { service, requests } = buildService({
    store,
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/leads/lead-ramon')) {
        return { response: { ok: true, status: 200 }, data: lead };
      }
      if (parsed.pathname.endsWith('/leads/list')) {
        return { response: { ok: true, status: 200 }, data: { items: [lead] } };
      }
      if (parsed.searchParams.get('search') === 'thread:thread-serve') {
        return {
          response: { ok: true, status: 200 },
          data: { items: [rawSent, rawReceived] },
        };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });
  store.rows.push(
    service.normalizeInstantlyMessage(rawReceived),
    service.normalizeInstantlyMessage(rawSent)
  );

  await service.syncOwner('serve');

  const restored = store.rows.find((message) => message.providerMessageId === 'ramon-sent');
  assert.equal(restored.providerOriginalBodyEvidenceKnown, true);
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkEvidenceKnown, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /eerlijke mening 😁/u);
  assert.match(restored.body, new RegExp(`hier \\[${exactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] bekijken 👈`));
  assert.match(restored.body, /📍 Den Bosch/u);
  const leadRequest = requests.find((request) => request.url.endsWith('/leads/list'));
  assert.ok(leadRequest);
  assert.deepEqual(JSON.parse(leadRequest.options.body), {
    campaign: 'campaign-serve',
    contacts: ['prospect@example.org'],
    limit: 2,
  });
});

test('exact lead source fails closed when campaign or recipient provenance drifts', () => {
  const result = buildOriginalMessageSource({
    lead_id: 'lead-1',
    campaign_id: 'campaign-serve',
    subject: 'Kleine vraag',
    body: { html: '<p>Dit is een voldoende lange providertekst met concrete inhoud voor een betrouwbare vergelijking van dezelfde originele mail.</p>' },
  }, {
    id: 'lead-1',
    campaign: 'campaign-other',
    email: 'ander@example.org',
    payload: {
      softora_sender_email: 'serve-sender@example.com',
      softora_subject: 'Kleine vraag',
      softora_webdesign_public_url: 'https://www.softora.nl/webdesign/prospect',
      softora_instantly_email_html: '<p>Dit is een voldoende lange providertekst met concrete inhoud voor een betrouwbare vergelijking van dezelfde originele mail. 😁</p><p><a href="https://www.softora.nl/webdesign/prospect">hier</a></p>',
    },
  }, {
    accountEmail: 'serve-sender@example.com',
    recipientEmail: 'prospect@example.org',
  });

  assert.deepEqual(result, {
    evidenceKnown: true,
    available: false,
    reason: 'identity-mismatch',
  });
});

test('sync queries only the selected owner accounts and drops unmapped or conflicting messages', async () => {
  const rawMessages = [
    incoming(),
    incoming({
      id: 'martijn-incoming',
      eaccount: 'martijn-sender@example.com',
      campaign_id: 'campaign-martijn',
      thread_id: 'thread-martijn',
      to_address_email_list: ['martijn-sender@example.com'],
    }),
    incoming({
      id: 'wrong-campaign-owner',
      campaign_id: 'campaign-martijn',
    }),
    incoming({
      id: 'unmapped-account',
      eaccount: 'other@example.com',
      to_address_email_list: ['other@example.com'],
    }),
  ];
  const { service, store, requests } = buildService({
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { items: rawMessages },
    }),
  });

  const result = await service.syncOwner('serve');
  assert.equal(result.owner, 'serve');
  assert.deepEqual(store.rows.map((message) => message.providerMessageId), ['incoming-serve-1']);
  assert.equal(store.rows[0].providerOwner, 'serve');
  const query = new URL(requests[0].url).searchParams;
  assert.equal(query.get('eaccount'), 'serve-sender@example.com');
  assert.equal(query.get('limit'), '100');
});

test('sync rehydrates a visible older thread only when its exact provider HTML is still unknown', async () => {
  const store = createStore();
  const { service, requests } = buildService({
    store,
    fetchJsonWithTimeout: async (url) => {
      const query = new URL(url).searchParams;
      if (query.get('search') === 'thread:thread-serve') {
        return {
          response: { ok: true, status: 200 },
          data: {
            items: [
              incoming({
                id: 'old-sent',
                email_type: '1',
                from_address_email: 'serve-sender@example.com',
                to_address_email_list: ['prospect@example.org'],
                body: {
                  text: 'Goedendag, Je kunt het webdesign hier bekijken.',
                  html: '<p>Goedendag,</p><p>Je kunt het webdesign <a href="https://www.softora.nl/webdesign/prospect">hier</a> bekijken.</p>',
                },
              }),
              incoming(),
            ],
          },
        };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });
  store.rows.push(
    service.normalizeInstantlyMessage(incoming()),
    {
      ...service.normalizeInstantlyMessage(incoming({
        id: 'old-sent',
        email_type: '1',
        from_address_email: 'serve-sender@example.com',
        to_address_email_list: ['prospect@example.org'],
        body: { text: 'Alles stond hier eerst als één platte regel.' },
      })),
      providerBodyHtmlEvidenceKnown: false,
      providerRichBodyAvailable: false,
    }
  );

  await service.syncOwner('serve');

  const hydrated = store.rows.find((message) => message.providerMessageId === 'old-sent');
  assert.match(hydrated.body, /Goedendag,\n\nJe kunt het webdesign hier \[/);
  assert.equal(hydrated.providerBodyHtmlEvidenceKnown, true);
  assert.equal(hydrated.webdesignLinkEvidenceKnown, true);
  assert.equal(
    requests.filter((request) => new URL(request.url).searchParams.get('search') === 'thread:thread-serve').length,
    1
  );
});

test('owner conversation listing never leaks the other owner and preserves exact thread chronology', async () => {
  const { service, store } = buildService();
  const serveIncoming = service.normalizeInstantlyMessage(incoming());
  const serveSent = service.normalizeInstantlyMessage(incoming({
    id: 'serve-sent',
    email_type: 'sent',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['prospect@example.org'],
    body: { text: 'Dank voor je reactie.' },
    timestamp_email: '2026-07-25T11:05:00.000Z',
  }));
  const martijnIncoming = service.normalizeInstantlyMessage(incoming({
    id: 'martijn-incoming',
    eaccount: 'martijn-sender@example.com',
    campaign_id: 'campaign-martijn',
    thread_id: 'thread-martijn',
    to_address_email_list: ['martijn-sender@example.com'],
  }));
  store.rows.push(serveIncoming, serveSent, martijnIncoming);

  const conversations = await service.listOwnerConversations('serve');
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].providerOwner, 'serve');
  assert.equal(conversations[0].activityAt, '2026-07-25T11:05:00.000Z');
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.providerMessageId),
    ['serve-sent']
  );
  assert.equal(JSON.stringify(conversations).includes('martijn-incoming'), false);
});

test('reply uses the exact stored account/thread and rejects cross-owner, recipient and attachment drift', async () => {
  const { service, store, requests } = buildService({
    fetchJsonWithTimeout: async (_url, options) => ({
      response: { ok: true, status: 200 },
      data: {
        id: 'sent-reply-1',
        subject: 'Re: Kleine vraag',
        body: { text: JSON.parse(options.body).body.text },
        timestamp_created: '2026-07-25T12:00:00.000Z',
      },
    }),
  });
  store.rows.push(service.normalizeInstantlyMessage(incoming()));

  await assert.rejects(
    service.reply({
      owner: 'martijn',
      accountEmail: 'serve-sender@example.com',
      providerMessageId: 'incoming-serve-1',
      providerThreadId: 'thread-serve',
      to: 'prospect@example.org',
      subject: 'Re: Kleine vraag',
      text: 'Antwoord',
    }),
    { code: 'INSTANTLY_ACCOUNT_OWNER_MISMATCH' }
  );
  await assert.rejects(
    service.reply({
      owner: 'serve',
      accountEmail: 'serve-sender@example.com',
      providerMessageId: 'incoming-serve-1',
      providerThreadId: 'thread-serve',
      to: 'someone-else@example.org',
      subject: 'Re: Kleine vraag',
      text: 'Antwoord',
    }),
    { code: 'INSTANTLY_REPLY_RECIPIENT_MISMATCH' }
  );
  await assert.rejects(
    service.reply({
      owner: 'serve',
      accountEmail: 'serve-sender@example.com',
      providerMessageId: 'incoming-serve-1',
      providerThreadId: 'thread-serve',
      to: 'prospect@example.org',
      subject: 'Re: Kleine vraag',
      text: 'Antwoord',
      attachments: [{ filename: 'ontwerp.pdf' }],
    }),
    { code: 'INSTANTLY_ATTACHMENTS_UNSUPPORTED' }
  );

  const result = await service.reply({
    owner: 'serve',
    accountEmail: 'serve-sender@example.com',
    providerMessageId: 'incoming-serve-1',
    providerThreadId: 'thread-serve',
    to: 'prospect@example.org',
    cc: 'collega@example.org',
    bcc: '',
    subject: 'Re: Kleine vraag',
    text: 'Dank voor je reactie.',
  });
  assert.equal(result.owner, 'serve');
  const request = requests.find((candidate) => candidate.url.endsWith('/emails/reply'));
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.eaccount, 'serve-sender@example.com');
  assert.equal(payload.reply_to_uuid, 'incoming-serve-1');
  assert.equal(payload.cc_address_email_list, 'collega@example.org');
  assert.equal(payload.bcc_address_email_list, '');
  assert.equal(store.rows.some((message) => message.providerMessageId === 'sent-reply-1'), true);
});

test('official Instantly lifecycle fields retain direction, unread state and attachments', () => {
  const { service } = buildService();
  const received = service.normalizeInstantlyMessage(incoming({
    email_type: undefined,
    ue_type: 2,
    is_unread: 1,
    attachment_json: {
      files: [{ filename: 'vraag.pdf', type: 'application/pdf', size: 2048 }],
    },
  }));
  const sent = service.normalizeInstantlyMessage(incoming({
    id: 'sent-numeric',
    email_type: undefined,
    ue_type: 1,
    from_address_email: '',
    to_address_email_list: ['prospect@example.org'],
  }));
  assert.equal(received.folder, 'inbox');
  assert.equal(received.unread, true);
  assert.deepEqual(received.attachments, [{
    filename: 'vraag.pdf',
    contentType: 'application/pdf',
    size: 2048,
  }]);
  assert.equal(sent.folder, 'sent');
  assert.equal(sent.originalCampaignOutbound, true);
});

test('configuration stays fail-closed until key, secret and exact owner map exist', () => {
  const service = createInstantlyMailboxService({
    config: { enabled: true },
    mailboxIndexStore: createStore(),
  });
  assert.deepEqual(service.getStatus().missing, [
    'INSTANTLY_API_KEY',
    'INSTANTLY_WEBHOOK_SECRET',
    'INSTANTLY_ACCOUNT_OWNERS_JSON',
  ]);
  assert.equal(service.isConfigured(), false);
});

test('mailbox integration never activates from the separate outreach scheduler flag', () => {
  const service = createDefaultInstantlyMailboxService({
    env: {
      INSTANTLY_ENABLED: 'true',
      INSTANTLY_API_KEY: 'key',
      INSTANTLY_WEBHOOK_SECRET: 'secret',
      INSTANTLY_ACCOUNT_OWNERS_JSON: '{"serve@example.com":"serve"}',
    },
    mailboxIndexStore: createStore(),
  });
  assert.equal(service.getStatus().enabled, false);
  assert.equal(service.isConfigured(), false);
});

test('bounded polling persists its cursor and resumes the next cycle without duplicate loss', async () => {
  let values = {};
  const listQueries = [];
  const { service, store } = buildService({
    config: { maxPages: 1 },
    getUiStateValues: async () => ({ values }),
    setUiStateValues: async (_scope, patch) => {
      values = { ...values, ...patch };
    },
    fetchJsonWithTimeout: async (url) => {
      const params = new URL(url).searchParams;
      if (params.get('search')) {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      listQueries.push(Object.fromEntries(params.entries()));
      return {
        response: { ok: true, status: 200 },
        data: {
          items: [incoming({ id: params.get('starting_after') ? 'page-two' : 'page-one' })],
          next_starting_after: params.get('starting_after') ? '' : 'cursor-page-two',
        },
      };
    },
  });

  const first = await service.syncOwner('serve');
  assert.equal(first.partial, true);
  assert.equal(values.cursor_serve, 'cursor-page-two');
  await service.syncOwner('serve');
  assert.equal(listQueries[1].starting_after, 'cursor-page-two');
  assert.equal(values.cursor_serve, '');
  assert.deepEqual(
    store.rows.map((message) => message.providerMessageId).sort(),
    ['page-one', 'page-two']
  );
});

test('suggested replies use the exact Instantly owner identity instead of falling back to Servé', async () => {
  let promptPayload = null;
  const coordinator = createMailboxService({
    getOpenAiApiKey: () => 'openai-test-key',
    instantlyMailboxService: {
      getConfiguredAccounts(owner) {
        return owner === 'martijn'
          ? [{ email: 'martijn-sender@example.com', owner: 'martijn' }]
          : [];
      },
      getStatus: () => ({ configured: true, owners: {} }),
    },
    fetchJsonWithTimeout: async (_url, options) => {
      const request = JSON.parse(options.body);
      promptPayload = JSON.parse(request.messages[1].content);
      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [{
            message: {
              content: 'Beste,\n\nDank voor je reactie 😁\n\nMet vriendelijke groet,\nMartijn van de Ven',
            },
          }],
        },
      };
    },
  });

  const result = await coordinator.rewriteDraft({
    accountEmail: 'martijn-sender@example.com',
    to: 'prospect@example.org',
    subject: 'Re: Website',
    body: '',
    context: {
      provider: 'instantly',
      providerOwner: 'martijn',
      accountEmail: 'martijn-sender@example.com',
      from: 'Prospect',
      email: 'prospect@example.org',
      subject: 'Re: Website',
      body: 'Bedankt, kun je meer vertellen?',
      folder: 'inbox',
    },
  });
  assert.equal(promptPayload.afzenderContext.naam, 'Martijn van de Ven');
  assert.match(result.text, /Met vriendelijke groet,\nMartijn van de Ven$/);

  await assert.rejects(
    coordinator.rewriteDraft({
      accountEmail: 'martijn-sender@example.com',
      to: 'prospect@example.org',
      subject: 'Re: Website',
      body: '',
      context: {
        provider: 'instantly',
        providerOwner: 'serve',
        accountEmail: 'martijn-sender@example.com',
        body: 'Test',
      },
    }),
    { code: 'INSTANTLY_REPLY_IDENTITY_MISMATCH' }
  );
});

test('Instantly mailbox gap-closing poll is registered as a protected five-minute cron', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  const cron = config.crons.find((candidate) => candidate.path === '/api/mailbox/instantly/sync');
  assert.deepEqual(cron, {
    path: '/api/mailbox/instantly/sync',
    schedule: '*/5 * * * *',
  });
});

test('provider index rows use exact provider IDs for idempotency and retain owner provenance', () => {
  const store = createMailboxIndexStore();
  const row = store.buildProviderMessageRow({
    provider: 'instantly',
    providerMessageId: 'email-uuid-1',
    providerThreadId: 'thread-uuid-1',
    providerCampaignId: 'campaign-serve',
    providerAccountEmail: 'serve-sender@example.com',
    providerOwner: 'serve',
    accountEmail: 'serve-sender@example.com',
    folder: 'inbox',
    email: 'prospect@example.org',
    to: 'serve-sender@example.com',
    subject: 'Re: Website',
    body: 'Interesse',
    date: '2026-07-25T11:00:00.000Z',
  });
  assert.equal(row.message_key, 'instantly|email-uuid-1');
  assert.equal(row.provider_id, 'instantly:email-uuid-1');
  assert.equal(row.folder, 'instantly');
  assert.equal(row.payload.providerOwner, 'serve');
  assert.equal(row.payload.providerThreadId, 'thread-uuid-1');
  assert.equal(row.payload.direction, 'received');
  const normalized = store.normalizeMessageRow(row, { includeBody: true });
  assert.equal(normalized.uid, 0);
  assert.equal(normalized.storageUid, row.uid);
  assert.equal(normalized.storageFolder, 'instantly');
  assert.equal(normalized.id, 'instantly:email-uuid-1');
});

test('webhook and polling-style replays remain idempotent by exact Instantly email ID', async () => {
  const { service, store } = buildService({
    fetchJsonWithTimeout: async (url) => {
      if (url.includes('/emails/incoming-serve-1')) {
        return { response: { ok: true, status: 200 }, data: incoming() };
      }
      return { response: { ok: true, status: 200 }, data: { items: [incoming()] } };
    },
  });
  const request = {
    headers: { 'x-instantly-webhook-secret': 'webhook-secret' },
    body: {
      event_type: 'reply_received',
      email_account: 'serve-sender@example.com',
      email_id: 'incoming-serve-1',
    },
  };
  await service.ingestWebhook(request);
  await service.ingestWebhook(request);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].providerMessageId, 'incoming-serve-1');
});

test('provider read and hide stay local to Softora and reject cross-owner mutations', async () => {
  const mutations = [];
  const instantlyMailboxService = {
    getConfiguredAccounts(owner) {
      return owner === 'serve'
        ? [{ email: 'serve-sender@example.com', owner: 'serve' }]
        : [{ email: 'martijn-sender@example.com', owner: 'martijn' }];
    },
    async assertStoredMessageOwnership(input) {
      if (
        input.owner !== 'serve' ||
        input.accountEmail !== 'serve-sender@example.com' ||
        String(input.providerMessageId).replace(/^instantly:/, '') !== 'incoming-serve-1'
      ) {
        const error = new Error('wrong owner');
        error.status = 403;
        error.code = 'INSTANTLY_MESSAGE_OWNER_MISMATCH';
        throw error;
      }
      return {
        provider: 'instantly',
        providerOwner: 'serve',
        providerAccountEmail: 'serve-sender@example.com',
        providerMessageId: 'incoming-serve-1',
      };
    },
  };
  const store = {
    isAvailable: () => true,
    async listMessages() {
      return [];
    },
    async markMessageRead(input) {
      mutations.push({ operation: 'read', ...input });
      return { ok: true };
    },
    async markMessageDeleted(input) {
      mutations.push({ operation: 'hide', ...input });
      return { ok: true, data: [{ message_key: 'instantly|incoming-serve-1' }] };
    },
    async restoreMessage() {
      return { ok: true, data: [{ message_key: 'instantly|incoming-serve-1' }] };
    },
  };
  let imapCreated = false;
  const coordinator = createMailboxService({
    mailboxIndexStore: store,
    instantlyMailboxService,
    isSupabaseConfigured: () => true,
    createImapClient: () => {
      imapCreated = true;
      throw new Error('Instantly state must never touch IMAP');
    },
  });

  const read = await coordinator.markMessageRead({
    owner: 'serve',
    accountEmail: 'serve-sender@example.com',
    folder: 'instantly',
    id: 'instantly:incoming-serve-1',
  });
  assert.equal(read.sourceMailboxMutated, false);
  assert.equal(imapCreated, false);
  await coordinator.hideConversation({
    owner: 'serve',
    accountEmail: 'serve-sender@example.com',
    folder: 'instantly',
    id: 'instantly:incoming-serve-1',
  });
  assert.equal(imapCreated, false);
  assert.deepEqual(mutations.map((mutation) => mutation.operation), ['read', 'hide']);
  assert.equal(mutations[1].folder, 'instantly');
  assert.equal(mutations[1].id, 'instantly:incoming-serve-1');

  await assert.rejects(
    coordinator.hideConversation({
      owner: 'martijn',
      accountEmail: 'serve-sender@example.com',
      folder: 'instantly',
      id: 'instantly:incoming-serve-1',
    }),
    { code: 'INSTANTLY_MESSAGE_OWNER_MISMATCH' }
  );
  assert.deepEqual(mutations.map((mutation) => mutation.operation), ['read', 'hide']);
});

test('an exact RFC message imported through Gmail and Instantly appears only once with Instantly provenance', async () => {
  const result = await mergeCampaignReplies({
    owner: 'serve',
    limit: 100,
    refreshInstantly: false,
    baseReplies: [
      {
        id: 'gmail-copy',
        messageId: '<same-reply@example.org>',
        activityAt: '2026-07-25T11:00:00.000Z',
      },
      {
        id: 'gmail-other',
        messageId: '<other-reply@example.org>',
        activityAt: '2026-07-25T10:00:00.000Z',
      },
    ],
    instantlyMailboxService: {
      isConfigured: () => true,
      async listOwnerConversations() {
        return [{
          id: 'instantly-copy',
          provider: 'instantly',
          providerOwner: 'serve',
          messageId: '<same-reply@example.org>',
          activityAt: '2026-07-25T11:00:00.000Z',
          threadMessages: [],
        }];
      },
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
  });
  assert.deepEqual(result.messages.map((message) => message.id), [
    'instantly-copy',
    'gmail-other',
  ]);
});
