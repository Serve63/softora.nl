const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createInstantlyMailboxService,
  normalizeAccountOwnership,
} = require('../../server/services/instantly-mailbox');
const {
  buildCustomerQuotedMessageSource,
  buildOriginalMessageSource,
} = require('../../server/services/instantly-original-message-source');
const { createMailboxService } = require('../../server/services/mailbox');
const { createMailboxIndexStore } = require('../../server/services/mailbox-index-store');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');
const {
  createDefaultInstantlyMailboxService,
  mergeCampaignReplies,
  syncInstantlyMailboxResponse,
} = require('../../server/services/mailbox-instantly-integration');
const {
  createMailboxCampaignMutationRunner,
} = require('../../server/services/mailbox-campaign-mutation-runner');

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
    async listProviderActiveConversationAuditMessages({ accountEmails }) {
      const activeThreadKeys = new Set(
        rows
          .filter((message) => (
            accountEmails.includes(message.accountEmail) &&
            message.direction === 'received' &&
            message.providerThreadId
          ))
          .map((message) => `${message.accountEmail}|${message.providerThreadId}`)
      );
      return rows.filter((message) => (
        accountEmails.includes(message.accountEmail) &&
        message.originalCampaignOutbound === true &&
        activeThreadKeys.has(`${message.accountEmail}|${message.providerThreadId}`)
      ));
    },
    async getProviderMessage({ providerMessageId, accountEmail }) {
      const exactProviderMessageId = String(providerMessageId || '').replace(/^instantly:/, '');
      return rows.find((message) => (
        message.providerMessageId === exactProviderMessageId &&
        message.accountEmail === accountEmail
      )) || null;
    },
  };
}

function buildService(overrides = {}) {
  const store = overrides.store || createStore();
  const requests = [];
  const syncUiState = new Map();
  const getUiStateValues = overrides.getUiStateValues || (async (scope) => ({
    values: { ...(syncUiState.get(scope) || {}) },
    source: 'supabase',
  }));
  const setUiStateValues = overrides.setUiStateValues || (async (scope, values) => {
    syncUiState.set(scope, { ...(values || {}) });
    return { values: { ...(values || {}) }, source: 'supabase' };
  });
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
    getCustomerSourcesByEmails: overrides.getCustomerSourcesByEmails,
    getUiStateValues,
    setUiStateValues,
    onMessagesUpserted: overrides.onMessagesUpserted,
    getCampaignMutationRunner: overrides.getCampaignMutationRunner,
    requireMutationJournal: overrides.requireMutationJournal,
    createMutationRequestKey: overrides.createMutationRequestKey,
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

test('exact customer and delivered quote restore Ramon emoji and the proven direct hier link without lead API access', async () => {
  const customerId = 'safe-dedupe-20260615-row-2586-0163075ffe';
  const exactUrl = `https://www.softora.nl/webdesign/ramon-design-store?cid=${customerId}&sender=serve`;
  const rawSent = incoming({
    id: 'ramon-local-sent',
    thread_id: 'ramon-local-thread',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['info@ramoncc.nl'],
    subject: 'Kleine vraag over jullie website',
    body: {
      text: [
        'Goedendag,',
        '',
        'Afgelopen week kwam ik jullie website ramoncc.nl tegen.',
        'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
        'Ik ben benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
        'Je kunt het webdesign hier bekijken.',
        'Servé Creusen',
        "'s-Hertogenbosch",
      ].join('\n'),
    },
  });
  const rawReceived = incoming({
    id: 'ramon-local-received',
    thread_id: 'ramon-local-thread',
    from_address_email: 'info@ramoncc.nl',
    body: {
      text: [
        'Dank voor je mail.',
        '',
        'Op di 7 jul 2026 om 07:52 schreef Servé Creusen <serve-sender@example.com>:',
        '> Goedendag,',
        '>',
        '> Afgelopen week kwam ik jullie website ramoncc.nl tegen.',
        '> Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
        '> Ik ben benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
        '> Je kunt het webdesign hier bekijken 👈',
        '> Servé Creusen',
        "> 📍 's-Hertogenbosch",
      ].join('\n'),
    },
  });
  const exactCustomer = {
    id: customerId,
    email: 'info@ramoncc.nl',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'lead-ramon-local',
    instantlyActualSenderEmail: 'serve-sender@example.com',
    instantlyPublicPreviewUrl: exactUrl,
  };
  const source = buildCustomerQuotedMessageSource(
    rawSent,
    [rawSent, rawReceived],
    exactCustomer,
    { accountEmail: 'serve-sender@example.com', recipientEmail: 'info@ramoncc.nl' }
  );
  assert.equal(source.available, true);
  assert.equal(source.webdesignLinkUrl, exactUrl);
  assert.match(source.body, /eerlijke mening 😁/u);
  assert.match(source.body, new RegExp(`hier \\[${exactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] bekijken 👈`));
  assert.match(source.body, /📍 's-Hertogenbosch/u);

  const store = createStore();
  const { service, requests } = buildService({
    store,
    getCustomerSourcesByEmails: async ({ emails }) => {
      assert.deepEqual(emails, ['info@ramoncc.nl']);
      return [exactCustomer];
    },
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname.endsWith('/leads/list'), false);
      assert.equal(parsed.pathname.includes('/leads/'), false);
      if (parsed.searchParams.get('search') === 'thread:ramon-local-thread') {
        return { response: { ok: true, status: 200 }, data: { items: [rawSent, rawReceived] } };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  await service.hydrateThread({
    threadId: 'ramon-local-thread',
    accountEmail: 'serve-sender@example.com',
    owner: 'serve',
  });

  const restored = store.rows.find((message) => message.providerMessageId === 'ramon-local-sent');
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /😁/u);
  assert.equal(requests.some((request) => /\/leads(?:\/|$)/.test(new URL(request.url).pathname)), false);
});

test('MHC current CTA restores the exact quoted body and link across a proven same-owner alias', async () => {
  const customerId = 'safe-dedupe-20260615-row-830-5ee1bc4e3b';
  const exactUrl = `https://www.softora.nl/webdesign/mhc-berkel-enschot?cid=${customerId}&sender=serve`;
  const providerBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website mhcbe.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    'Berkel-Enschot',
  ].join('\n');
  const quotedBody = providerBody
    .replace('eerlijke mening', 'eerlijke mening 😁')
    .replace('link bekijken', 'link bekijken 🎨')
    .replace('\nBerkel-Enschot', '\n📍 Berkel-Enschot');
  const rawSent = incoming({
    id: 'mhc-sent',
    lead_id: 'lead-mhc',
    thread_id: 'mhc-thread',
    email_type: '1',
    eaccount: 'servecreusen@websoftora.com',
    from_address_email: 'servecreusen@websoftora.com',
    to_address_email_list: ['bestuur@mhcbe.nl'],
    body: { text: providerBody },
  });
  const rawReceived = incoming({
    id: 'mhc-received',
    thread_id: 'mhc-thread',
    eaccount: 'servecreusen@websoftora.com',
    from_address_email: 'bestuur@mhcbe.nl',
    to_address_email_list: ['servecreusen@websoftora.com'],
    body: {
      text: [
        'Beste Servé, bedankt voor je bericht.',
        '',
        'Op vr 24 jul 2026 om 07:33 schreef Servé Creusen <servecreusen@websoftora.com>:',
        ...quotedBody.split('\n').map((line) => `> ${line}`),
      ].join('\n'),
    },
  });
  const exactCustomer = {
    id: customerId,
    email: 'bestuur@mhcbe.nl',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'lead-mhc',
    instantlyActualSenderEmail: 'serve@websoftora.com',
    instantlyPublicPreviewUrl: exactUrl,
  };
  const source = buildCustomerQuotedMessageSource(
    rawSent,
    [rawSent, rawReceived],
    exactCustomer,
    {
      accountEmail: 'servecreusen@websoftora.com',
      recipientEmail: 'bestuur@mhcbe.nl',
      sameOwnerAccountEmails: ['serve@websoftora.com', 'servecreusen@websoftora.com'],
    }
  );

  assert.equal(source.available, true);
  assert.equal(source.webdesignLinkEvidenceKnown, true);
  assert.equal(source.webdesignLinkUrl, exactUrl);
  assert.match(source.body, /eerlijke mening 😁/u);
  assert.match(source.body, new RegExp(`deze link \\[${exactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] bekijken 🎨`));

  const store = createStore();
  const { service, requests } = buildService({
    store,
    config: {
      accountOwners: {
        'serve@websoftora.com': 'serve',
        'servecreusen@websoftora.com': 'serve',
      },
      campaignOwners: { 'campaign-serve': 'serve' },
    },
    getCustomerSourcesByEmails: async () => [exactCustomer],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('search') === 'thread:mhc-thread') {
        return { response: { ok: true, status: 200 }, data: { items: [rawSent, rawReceived] } };
      }
      throw new Error(`Onverwachte providerrequest: ${url}`);
    },
  });

  await service.hydrateThread({
    threadId: 'mhc-thread',
    accountEmail: 'servecreusen@websoftora.com',
    owner: 'serve',
  });

  const restored = store.rows.find((message) => message.providerMessageId === 'mhc-sent');
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /📍 Berkel-Enschot/u);
  assert.equal(requests.some((request) => /\/leads(?:\/|$)/.test(new URL(request.url).pathname)), false);
});

test('exact delivered quote remains available without inventing a link when no supported CTA exists', () => {
  const exactBody = [
    'Goedendag,',
    '',
    'Dit is een voldoende lange, exact bewezen uitgaande tekst zonder ontwerpknop of linkmarker.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const result = buildCustomerQuotedMessageSource({
    id: 'body-only-sent',
    lead_id: 'lead-body-only',
    campaign_id: 'campaign-serve',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['prospect@example.org'],
    body: { text: exactBody },
  }, [{
    id: 'body-only-received',
    body: {
      text: `Bedankt.\n\nOp di 7 jul 2026 om 07:52 schreef Servé <serve-sender@example.com>:\n${exactBody}`,
    },
  }], {
    id: 'customer-body-only',
    email: 'prospect@example.org',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'lead-body-only',
    instantlyActualSenderEmail: 'serve-sender@example.com',
    instantlyPublicPreviewUrl: 'https://www.softora.nl/webdesign/prospect?cid=customer-body-only&sender=serve',
  }, {
    accountEmail: 'serve-sender@example.com',
    recipientEmail: 'prospect@example.org',
  });

  assert.equal(result.available, true);
  assert.equal(result.body, exactBody);
  assert.equal(result.webdesignLinkEvidenceKnown, true);
  assert.equal(result.webdesignLinkUrl, '');
  assert.match(result.reason, /:body-only$/);
});

test('Vught Outlook quote restores exact rich body across a stale same-owner sender alias', async () => {
  const customerId = 'safe-dedupe-vught';
  const exactUrl = `https://www.softora.nl/webdesign/gemeente-vught?cid=${customerId}&sender=serve`;
  const providerBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website vught.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening',
    '',
    'Je kunt het webdesign hier bekijken',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    "'s-Hertogenbosch",
  ].join('\n');
  const rawSent = incoming({
    id: 'vught-sent',
    thread_id: 'vught-thread',
    email_type: '1',
    eaccount: 'serve-alias@example.com',
    from_address_email: 'serve-alias@example.com',
    to_address_email_list: ['gemeente@vught.nl'],
    subject: 'Kleine vraag over jullie website',
    body: { text: providerBody },
  });
  const rawReceived = incoming({
    id: 'vught-received',
    thread_id: 'vught-thread',
    eaccount: 'serve-alias@example.com',
    from_address_email: 'communicatie@vught.nl',
    to_address_email_list: ['serve-alias@example.com'],
    body: {
      text: [
        'Dag Servé,',
        '',
        'Hartelijk dank, maar we hebben geen interesse.',
        '',
        'Van: Servé Creusen <serve-alias@example.com>',
        'Verzonden: dinsdag 7 juli 2026 10:13',
        'Aan: Vught, gemeente <gemeente@vught.nl>',
        'Onderwerp: Kleine vraag over jullie website',
        '',
        'Let op: deze mail komt van buiten de organisatie.',
        '',
        'Goedendag,',
        '',
        'Afgelopen week kwam ik jullie website vught.nl tegen.',
        '',
        'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
        '',
        'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
        '',
        'Je kunt het webdesign hier bekijken 👈',
        '',
        'Met vriendelijke groet,',
        'Servé Creusen',
        "📍 's-Hertogenbosch",
      ].join('\n'),
    },
  });
  const exactCustomer = {
    id: customerId,
    email: 'gemeente@vught.nl',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'lead-vught',
    instantlyActualSenderEmail: 'serve-sender@example.com',
    instantlyPublicPreviewUrl: exactUrl,
  };
  const store = createStore();
  const { service, requests } = buildService({
    store,
    config: {
      accountOwners: {
        'serve-sender@example.com': 'serve',
        'serve-alias@example.com': 'serve',
        'martijn-sender@example.com': 'martijn',
      },
    },
    getCustomerSourcesByEmails: async () => [exactCustomer],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('search') === 'thread:vught-thread') {
        return { response: { ok: true, status: 200 }, data: { items: [rawSent, rawReceived] } };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  await service.hydrateThread({
    threadId: 'vught-thread',
    accountEmail: 'serve-alias@example.com',
    owner: 'serve',
  });

  const restored = store.rows.find((message) => message.providerMessageId === 'vught-sent');
  assert.equal(restored.providerOriginalBodyEvidenceKnown, true);
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /eerlijke mening 😁/u);
  assert.match(restored.body, /hier \[https:\/\/www\.softora\.nl\/webdesign\/gemeente-vught/);
  assert.doesNotMatch(restored.body, /Let op: deze mail komt van buiten/);
  assert.equal(
    requests.some((request) => /\/leads(?:\/|$)/.test(new URL(request.url).pathname)),
    false
  );
});

test('rich-body audit falls back to exact provider messages when Instantly thread search is empty', async () => {
  const customerId = 'fallback-customer';
  const exactUrl = `https://www.softora.nl/webdesign/fallback?cid=${customerId}&sender=serve`;
  const providerBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website fallback.example tegen.',
    '',
    'Dit originele ontwerpbericht bevat voldoende inhoud om de providertekst veilig te vergelijken.',
    '',
    'Je kunt het webdesign hier bekijken',
  ].join('\n');
  const rawSent = incoming({
    id: 'fallback-sent',
    thread_id: 'fallback-thread',
    email_type: '1',
    lead_id: 'fallback-lead',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['fallback@example.org'],
    subject: 'Kleine vraag over jullie website',
    body: { text: providerBody },
  });
  const rawReceived = incoming({
    id: 'fallback-received',
    thread_id: 'fallback-thread',
    from_address_email: 'fallback@example.org',
    to_address_email_list: ['serve-sender@example.com'],
    body: {
      text: [
        'Dank voor je bericht.',
        '',
        'Op di 7 jul 2026 om 10:12 schreef Servé Creusen <serve-sender@example.com>:',
        '> Goedendag,',
        '>',
        '> Afgelopen week kwam ik jullie website fallback.example tegen.',
        '>',
        '> Dit originele ontwerpbericht bevat voldoende inhoud om de providertekst veilig te vergelijken. 😁',
        '>',
        '> Je kunt het webdesign hier bekijken 👈',
        '>',
        "> 📍 's-Hertogenbosch",
      ].join('\n'),
    },
  });
  const exactCustomer = {
    id: customerId,
    email: 'fallback@example.org',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'fallback-lead',
    instantlyActualSenderEmail: 'serve-sender@example.com',
    instantlyPublicPreviewUrl: exactUrl,
  };
  const store = createStore();
  const { service, requests } = buildService({
    store,
    getCustomerSourcesByEmails: async () => [exactCustomer],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('search') === 'thread:fallback-thread') {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      if (parsed.pathname.endsWith('/emails/fallback-sent')) {
        return { response: { ok: true, status: 200 }, data: { email: rawSent } };
      }
      if (parsed.pathname.endsWith('/emails/fallback-received')) {
        return { response: { ok: true, status: 200 }, data: { data: rawReceived } };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });
  const indexedMessages = [
    service.normalizeInstantlyMessage(rawSent),
    service.normalizeInstantlyMessage(rawReceived),
  ];
  store.rows.push(...indexedMessages);

  await service.hydrateThread({
    threadId: 'fallback-thread',
    accountEmail: 'serve-sender@example.com',
    owner: 'serve',
    indexedMessages,
  });

  const restored = store.rows.find((message) => message.providerMessageId === 'fallback-sent');
  assert.equal(restored.providerOriginalBodyEvidenceKnown, true);
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /😁/u);
  assert.match(restored.body, /👈/u);
  assert.match(restored.body, /📍/u);
  assert.equal(
    requests.filter((request) => new URL(request.url).pathname.includes('/emails/fallback-')).length,
    2
  );
});

test('exact provider fallback records unavailable rich evidence without inventing a link', async () => {
  const rawSent = incoming({
    id: 'unavailable-sent',
    thread_id: 'unavailable-thread',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['unavailable@example.org'],
    body: {
      text: 'Goedendag. Dit originele campagnebericht bevat voldoende inhoud, maar heeft geen exacte rijke Softora-bron of bewezen webdesignlink.',
    },
  });
  const rawReceived = incoming({
    id: 'unavailable-received',
    thread_id: 'unavailable-thread',
    from_address_email: 'unavailable@example.org',
    to_address_email_list: ['serve-sender@example.com'],
    body: { text: 'Bedankt, maar geen interesse.' },
  });
  const store = createStore();
  const { service } = buildService({
    store,
    getCustomerSourcesByEmails: async () => [],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('search') === 'thread:unavailable-thread') {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      if (parsed.pathname.includes('/emails/unavailable-')) {
        return {
          response: { ok: false, status: 404 },
          data: { message: 'Exact providerbericht is niet meer beschikbaar.' },
        };
      }
      if (parsed.pathname.endsWith('/leads/list')) {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });
  const indexedMessages = [
    service.normalizeInstantlyMessage(rawSent),
    service.normalizeInstantlyMessage(rawReceived),
  ];
  store.rows.push(...indexedMessages);

  await service.hydrateThread({
    threadId: 'unavailable-thread',
    accountEmail: 'serve-sender@example.com',
    owner: 'serve',
    indexedMessages,
  });

  const audited = store.rows.find((message) => message.providerMessageId === 'unavailable-sent');
  assert.equal(audited.providerOriginalBodyEvidenceKnown, true);
  assert.equal(audited.providerOriginalBodyAvailable, false);
  assert.equal(audited.webdesignLinkEvidenceKnown, false);
  assert.equal(audited.webdesignLinkUrl, '');
});

test('same-owner alias exception never crosses from Martijn provenance into Servé', () => {
  const result = buildCustomerQuotedMessageSource({
    id: 'cross-owner-sent',
    campaign_id: 'campaign-serve',
    from_address_email: 'serve-alias@example.com',
    to_address_email_list: ['prospect@example.org'],
    body: {
      text: 'Goedendag. Dit is een voldoende lange originele campagneboodschap die uitsluitend voor deze ontvanger en campagne is verstuurd. Je kunt het webdesign hier bekijken.',
    },
  }, [{
    id: 'cross-owner-received',
    body: {
      text: [
        'Van: Servé <serve-alias@example.com>',
        'Verzonden: gisteren',
        'Aan: prospect@example.org',
        'Onderwerp: Kleine vraag',
        '',
        'Goedendag. Dit is een voldoende lange originele campagneboodschap die uitsluitend voor deze ontvanger en campagne is verstuurd 😁. Je kunt het webdesign hier bekijken 👈',
      ].join('\n'),
    },
  }], {
    id: 'customer-cross-owner',
    email: 'prospect@example.org',
    instantlyCampaignId: 'campaign-serve',
    instantlyLeadId: 'lead-cross-owner',
    instantlyActualSenderEmail: 'martijn-sender@example.com',
    instantlyPublicPreviewUrl: 'https://www.softora.nl/webdesign/prospect?cid=customer-cross-owner&sender=serve',
  }, {
    accountEmail: 'serve-alias@example.com',
    recipientEmail: 'prospect@example.org',
    sameOwnerAccountEmails: ['serve-alias@example.com', 'serve-sender@example.com'],
  });

  assert.deepEqual(result, {
    evidenceKnown: true,
    available: false,
    reason: 'customer-identity-mismatch',
  });
});

test('Martijn original body restores from an exact same-thread content match without a standard quote header', () => {
  const customerId = 'safe-dedupe-martijn';
  const exactUrl = `https://www.softora.nl/webdesign/tete-a-tete?cid=${customerId}&sender=martijn`;
  const providerBody = [
    'Goedendag,',
    '',
    'Dit is een voldoende lange originele campagneboodschap voor dezelfde ontvanger en campagne.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening',
    '',
    'Je kunt het webdesign hier bekijken',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
    'Alphen',
  ].join('\n');
  const rawSent = incoming({
    id: 'martijn-nonstandard-sent',
    campaign_id: 'campaign-martijn',
    eaccount: 'martijn-sender@example.com',
    email_type: '1',
    from_address_email: 'martijn-sender@example.com',
    to_address_email_list: ['prospect@example.org'],
    body: { text: providerBody },
  });
  const rawReceived = incoming({
    id: 'martijn-nonstandard-received',
    campaign_id: 'campaign-martijn',
    eaccount: 'martijn-sender@example.com',
    from_address_email: 'prospect@example.org',
    body: {
      text: [
        'Bedankt voor je bericht.',
        '',
        '-------- Oorspronkelijke bericht --------',
        'Onderwerp: Kleine vraag over jullie website',
        'Datum: gisteren',
        'Afzender: Martijn van de Ven <martijn-sender@example.com>',
        'Ontvanger: prospect@example.org',
        '',
        'Goedendag,',
        '',
        'Dit is een voldoende lange originele campagneboodschap voor dezelfde ontvanger en campagne.',
        '',
        'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
        '',
        'Je kunt het webdesign hier bekijken 👈',
        '',
        'Met vriendelijke groet,',
        'Martijn van de Ven',
        '📍 Alphen',
      ].join('\n'),
    },
  });

  const result = buildCustomerQuotedMessageSource(
    rawSent,
    [rawSent, rawReceived],
    {
      id: customerId,
      email: 'prospect@example.org',
      instantlyCampaignId: 'campaign-martijn',
      instantlyLeadId: 'lead-martijn',
      instantlyActualSenderEmail: 'martijn-sender@example.com',
      instantlyPublicPreviewUrl: exactUrl,
    },
    {
      accountEmail: 'martijn-sender@example.com',
      recipientEmail: 'prospect@example.org',
      sameOwnerAccountEmails: ['martijn-sender@example.com'],
    }
  );

  assert.equal(result.available, true);
  assert.equal(result.reason, 'exact-customer-and-delivered-quote-source:exact-thread-content-match');
  assert.equal(result.webdesignLinkUrl, exactUrl);
  assert.match(result.body, /eerlijke mening 😁/u);
  assert.match(result.body, /📍 Alphen/u);
});

test('delivered quote restoration fails closed when exact customer provenance drifts', () => {
  const result = buildCustomerQuotedMessageSource({
    campaign_id: 'campaign-serve',
    body: { text: 'Dit is een voldoende lange providertekst voor een betrouwbare vergelijking van exact dezelfde verzonden campagne-inhoud en geen andere boodschap.' },
  }, [{
    body: { text: 'Op di 7 jul 2026 om 07:52 schreef Servé <serve-sender@example.com>:\nDit is een voldoende lange providertekst voor een betrouwbare vergelijking van exact dezelfde verzonden campagne-inhoud en geen andere boodschap. 😁\nJe kunt het webdesign hier bekijken 👈' },
  }], {
    id: 'customer-1',
    email: 'prospect@example.org',
    instantlyCampaignId: 'campaign-other',
    instantlyLeadId: 'lead-1',
    instantlyActualSenderEmail: 'serve-sender@example.com',
    instantlyPublicPreviewUrl: 'https://www.softora.nl/webdesign/prospect?cid=customer-1&sender=serve',
  }, {
    accountEmail: 'serve-sender@example.com',
    recipientEmail: 'prospect@example.org',
  });

  assert.deepEqual(result, {
    evidenceKnown: true,
    available: false,
    reason: 'customer-identity-mismatch',
  });
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

test('complete recent threads cannot starve an older exact-body hydration', async () => {
  const exactUrl = 'https://www.softora.nl/webdesign/older-prospect?cid=exact&sender=serve';
  const providerHtml = [
    '<p>Goedendag,</p>',
    '<p>Dit is een voldoende lange originele campagneboodschap voor betrouwbare vergelijking.</p>',
    '<p>Je kunt het webdesign <a href="https://inst.example.test/lt/older">hier</a> bekijken.</p>',
  ].join('');
  const sourceHtml = [
    '<p>Goedendag,</p>',
    '<p>Dit is een voldoende lange originele campagneboodschap voor betrouwbare vergelijking 😁</p>',
    `<p>Je kunt het webdesign <a href="${exactUrl}">hier</a> bekijken 👈</p>`,
  ].join('');
  const recentIncoming = Array.from({ length: 4 }, (_, index) => incoming({
    id: `recent-incoming-${index}`,
    thread_id: `recent-thread-${index}`,
    from_address_email: `recent-${index}@example.org`,
    timestamp_email: `2026-07-25T11:0${index}:00.000Z`,
  }));
  const targetReceived = incoming({
    id: 'older-received',
    thread_id: 'older-thread',
    from_address_email: 'older@example.org',
    timestamp_email: '2026-07-07T10:47:10.000Z',
  });
  const targetSent = incoming({
    id: 'older-sent',
    lead: 'older@example.org',
    thread_id: 'older-thread',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['older@example.org'],
    subject: 'Kleine vraag over jullie website',
    body: { html: providerHtml },
    timestamp_email: '2026-07-07T05:52:41.000Z',
  });
  const lead = {
    id: 'older-lead',
    campaign: 'campaign-serve',
    contact: 'older@example.org',
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
      if (parsed.pathname.endsWith('/leads/list')) {
        return { response: { ok: true, status: 200 }, data: { items: [lead] } };
      }
      if (parsed.searchParams.get('search') === 'thread:older-thread') {
        return {
          response: { ok: true, status: 200 },
          data: { items: [targetSent, targetReceived] },
        };
      }
      if (parsed.pathname.endsWith('/emails')) {
        return {
          response: { ok: true, status: 200 },
          data: { items: [...recentIncoming, targetReceived] },
        };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  recentIncoming.forEach((rawIncoming, index) => {
    const rawSent = incoming({
      id: `recent-sent-${index}`,
      thread_id: `recent-thread-${index}`,
      email_type: '1',
      from_address_email: 'serve-sender@example.com',
      to_address_email_list: [`recent-${index}@example.org`],
      body: { html: '<p>Volledig recent uitgaand bericht met voldoende inhoud.</p>' },
    });
    const normalizedSent = service.normalizeInstantlyMessage(rawSent);
    normalizedSent.providerBodyHtmlEvidenceKnown = true;
    normalizedSent.providerOriginalBodyEvidenceKnown = true;
    normalizedSent.providerOriginalBodyAvailable = true;
    store.rows.push(service.normalizeInstantlyMessage(rawIncoming), normalizedSent);
  });
  store.rows.push(
    service.normalizeInstantlyMessage(targetReceived),
    service.normalizeInstantlyMessage(targetSent)
  );

  await service.syncOwner('serve');

  const restored = store.rows.find((message) => message.providerMessageId === 'older-sent');
  assert.equal(restored.providerOriginalBodyEvidenceKnown, true);
  assert.equal(restored.providerOriginalBodyAvailable, true);
  assert.equal(restored.webdesignLinkUrl, exactUrl);
  assert.match(restored.body, /😁/u);
  assert.equal(
    requests.some((request) => new URL(request.url).searchParams.get('search') === 'thread:older-thread'),
    true
  );
});

test('one sync audits every active rich-body candidate within the bounded audit budget', async () => {
  const store = createStore();
  const rawThreads = new Map();
  const { service, requests } = buildService({
    store,
    getCustomerSourcesByEmails: async () => [],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      const search = parsed.searchParams.get('search');
      if (search?.startsWith('thread:')) {
        return {
          response: { ok: true, status: 200 },
          data: { items: rawThreads.get(search.slice('thread:'.length)) || [] },
        };
      }
      if (parsed.pathname.endsWith('/leads/list')) {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  for (let index = 0; index < 6; index += 1) {
    const threadId = `audit-thread-${index}`;
    const recipient = `audit-${index}@example.org`;
    const rawSent = incoming({
      id: `audit-sent-${index}`,
      thread_id: threadId,
      email_type: '1',
      from_address_email: 'serve-sender@example.com',
      to_address_email_list: [recipient],
      body: {
        text: 'Goedendag. Dit originele campagnebericht heeft voldoende inhoud voor een veilige audit, maar geen bewezen rijke bron.',
      },
    });
    const rawReceived = incoming({
      id: `audit-received-${index}`,
      thread_id: threadId,
      from_address_email: recipient,
      to_address_email_list: ['serve-sender@example.com'],
      body: { text: 'Bedankt, maar geen interesse.' },
    });
    rawThreads.set(threadId, [rawSent, rawReceived]);
    store.rows.push(
      service.normalizeInstantlyMessage(rawSent),
      service.normalizeInstantlyMessage(rawReceived)
    );
  }

  await service.syncOwner('serve');

  const threadSearches = requests.filter(
    (request) => new URL(request.url).searchParams.get('search')?.startsWith('thread:')
  );
  assert.equal(threadSearches.length, 6);
  const auditedSent = store.rows.filter(
    (message) => message.originalCampaignOutbound === true
  );
  assert.equal(auditedSent.length, 6);
  assert.equal(
    auditedSent.every((message) => (
      message.providerOriginalBodyEvidenceKnown === true &&
      message.providerOriginalBodyAvailable === false
    )),
    true
  );
});

test('active Instantly replies outside the newest 2000-message window are still audited exactly', async () => {
  const targetReceived = incoming({
    id: 'outside-window-received',
    thread_id: 'outside-window-thread',
    from_address_email: 'outside-window@example.org',
  });
  const targetSent = incoming({
    id: 'outside-window-sent',
    thread_id: 'outside-window-thread',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['outside-window@example.org'],
    body: {
      text: 'Dit oude originele campagnebericht staat buiten het algemene venster en heeft geen rijke bron.',
    },
  });
  const store = createStore();
  const normalizer = buildService({ store }).service;
  store.rows.push(
    normalizer.normalizeInstantlyMessage(targetReceived),
    normalizer.normalizeInstantlyMessage(targetSent)
  );
  store.listProviderMessages = async () => [];
  store.listProviderActiveConversationAuditMessages =
    createStore(store.rows).listProviderActiveConversationAuditMessages;

  const { service, requests } = buildService({
    store,
    getCustomerSourcesByEmails: async () => [],
    fetchJsonWithTimeout: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('search') === 'thread:outside-window-thread') {
        return {
          response: { ok: true, status: 200 },
          data: { items: [targetReceived] },
        };
      }
      if (parsed.pathname.endsWith('/emails/outside-window-sent')) {
        return {
          response: { ok: false, status: 404 },
          data: { message: 'not found' },
        };
      }
      return { response: { ok: true, status: 200 }, data: { items: [] } };
    },
  });

  await service.syncOwner('serve');

  const audited = store.rows.find((message) => message.providerMessageId === 'outside-window-sent');
  assert.equal(audited.providerOriginalBodyEvidenceKnown, true);
  assert.equal(audited.providerOriginalBodyAvailable, false);
  assert.equal(
    requests.some((request) => request.url.endsWith('/emails/outside-window-sent')),
    true
  );
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
  assert.equal(conversations[0].activityAt, '2026-07-25T11:00:00.000Z');
  assert.equal(conversations[0].latestInboundAt, '2026-07-25T11:00:00.000Z');
  assert.equal(conversations[0].latestOutboundAt, '2026-07-25T11:05:00.000Z');
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.providerMessageId),
    ['serve-sent']
  );
  assert.equal(JSON.stringify(conversations).includes('martijn-incoming'), false);
});

test('Instantly conversation listing hides automatic ticket receipts but preserves later human replies', async () => {
  const { service, store } = buildService();
  const sent = service.normalizeInstantlyMessage(incoming({
    id: 'sbsupply-sent',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['helpdesknl@sbsupply.eu'],
    subject: 'Kleine vraag over jullie website',
    body: { text: 'Goedendag, ik heb een webdesign voor jullie gemaakt.' },
    timestamp_email: '2026-07-29T05:31:39.000Z',
  }));
  const automaticReceipt = service.normalizeInstantlyMessage(incoming({
    id: 'sbsupply-ticket-receipt',
    email_type: 'received',
    from_address_email: 'helpdesknl@sbsupply.eu',
    from_address_name: 'helpdesknl@sbsupply.eu',
    to_address_email_list: ['serve-sender@example.com'],
    subject: '[Serviceaanvraag ontvangen] Kleine vraag over jullie website',
    body: {
      text: [
        '##- Please type your reply above this line -##',
        'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
        'Your request (269705) has been received and will be answered as soon as possible.',
      ].join('\n'),
    },
    timestamp_email: '2026-07-29T05:31:49.000Z',
  }));
  store.rows.push(sent, automaticReceipt);

  assert.deepEqual(await service.listOwnerConversations('serve'), []);

  const humanReply = service.normalizeInstantlyMessage(incoming({
    id: 'sbsupply-human-reply',
    email_type: 'received',
    from_address_email: 'helpdesknl@sbsupply.eu',
    from_address_name: 'SBSupply medewerker',
    to_address_email_list: ['serve-sender@example.com'],
    subject: 'Re: [Serviceaanvraag ontvangen] Kleine vraag over jullie website',
    body: {
      text: [
        'Dank voor het ontwerp. Kun je de online preview doorsturen?',
        '',
        'On Tue, 29 Jul 2026, helpdesknl@sbsupply.eu wrote:',
        'Uw aanvraag (269705) is ontvangen en wordt zo snel mogelijk in behandeling genomen.',
      ].join('\n'),
    },
    timestamp_email: '2026-07-29T09:00:00.000Z',
  }));
  store.rows.push(humanReply);

  const conversations = await service.listOwnerConversations('serve');
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].providerMessageId, 'sbsupply-human-reply');
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.providerMessageId),
    ['sbsupply-sent']
  );
  assert.equal(JSON.stringify(conversations).includes('sbsupply-ticket-receipt'), false);
});

test('Instantly verbergt Neelis WhatsApp-autoreply uit een latere menselijke conversatie', async () => {
  const { service, store } = buildService();
  const sent = service.normalizeInstantlyMessage(incoming({
    id: 'neelis-sent',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['info@neelisstikwerken.com'],
    body: { text: 'Goedendag, ik heb een fris webdesign voor jullie gemaakt.' },
    timestamp_email: '2026-07-28T06:28:27.000Z',
  }));
  const whatsappAutoReply = service.normalizeInstantlyMessage(incoming({
    id: 'neelis-whatsapp-auto',
    email_type: 'received',
    from_address_email: 'info@neelisstikwerken.com',
    to_address_email_list: ['serve-sender@example.com'],
    subject: 'Whatsapp Re: Kleine vraag over jullie website',
    body: {
      text: 'Welkom bij Neelis Stikwerken. Als u een foto met de globale maten naar whatsapp stuurt, dan krijgt u van mij zo snel mogelijk een richtprijs.',
    },
    timestamp_email: '2026-07-28T06:28:31.000Z',
  }));
  const humanReply = service.normalizeInstantlyMessage(incoming({
    id: 'neelis-human-reply',
    email_type: 'received',
    from_address_email: 'info@neelisstikwerken.com',
    to_address_email_list: ['serve-sender@example.com'],
    body: { text: 'Helaas, mijn website is prima zo.' },
    timestamp_email: '2026-07-28T13:56:13.000Z',
  }));
  store.rows.push(sent, whatsappAutoReply, humanReply);

  const conversations = await service.listOwnerConversations('serve');
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].providerMessageId, 'neelis-human-reply');
  assert.deepEqual(
    conversations[0].threadMessages.map((message) => message.providerMessageId),
    ['neelis-sent']
  );
  assert.equal(JSON.stringify(conversations).includes('neelis-whatsapp-auto'), false);
});

test('Instantly conversation listing hides seasonal closure auto-replies', async () => {
  const { service, store } = buildService();
  const sent = service.normalizeInstantlyMessage(incoming({
    id: 'impressioni-sent',
    email_type: '1',
    from_address_email: 'serve-sender@example.com',
    to_address_email_list: ['info@impressioni.nl'],
    subject: 'Kleine vraag over jullie website',
    body: { text: 'Goedendag, ik heb een webdesign voor jullie gemaakt.' },
    timestamp_email: '2026-06-30T07:50:00.000Z',
  }));
  const summerClosure = service.normalizeInstantlyMessage(incoming({
    id: 'impressioni-summer-closure',
    email_type: 'received',
    from_address_email: 'info@impressioni.nl',
    from_address_name: 'info@impressioni.nl',
    to_address_email_list: ['serve-sender@example.com'],
    subject: 'zomersluiting Re: Kleine vraag over jullie website',
    body: {
      text: [
        'Beste mailer,',
        '',
        'Tot 1 juli is impressioni gesloten.',
        'Daarna helpen we u graag weer!',
      ].join('\n'),
    },
    timestamp_email: '2026-06-30T07:56:54.000Z',
  }));
  store.rows.push(sent, summerClosure);

  assert.deepEqual(await service.listOwnerConversations('serve'), []);
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

test('iedere duurzame Instantly-upsert invalideert de campagnemailbox-snapshot', async () => {
  const invalidations = [];
  const { service } = buildService({
    onMessagesUpserted: async (input) => { invalidations.push(input); return { ok: true }; },
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { items: [incoming()] },
    }),
  });

  const result = await service.hydrateThread({
    threadId: 'thread-serve',
    accountEmail: 'serve-sender@example.com',
    owner: 'serve',
  });

  assert.equal(result.stored, 1);
  assert.deepEqual(invalidations, [{ provider: 'instantly', count: 1 }]);
});

test('Instantly-upsert blijft pending tijdens de abortbare DB-write en faalt zonder verplichte journal', async () => {
  const controller = new AbortController();
  const store = createStore();
  const baseUpsert = store.upsertProviderMessages.bind(store);
  let writeSignal = null;
  let writeMutationId = null;
  let writeRequestKey = null;
  let providerSignal = null;
  let runnerOptions = null;
  let activeChecks = 0;
  store.upsertProviderMessages = async (options) => {
    writeSignal = options.signal;
    writeMutationId = options.mutationId;
    writeRequestKey = options.requestKey;
    return baseUpsert(options);
  };
  const { service } = buildService({
    store,
    requireMutationJournal: true,
    createMutationRequestKey: () => 'instantly-upsert:test-1',
    getCampaignMutationRunner: () => ({
      isAvailable: () => true,
      run: async (options, task) => {
        runnerOptions = options;
        return task({
          signal: controller.signal,
          mutationId: '11111111-1111-4111-8111-111111111111',
          requestKey: options.requestKey,
          assertActive: () => { activeChecks += 1; },
        });
      },
    }),
    fetchJsonWithTimeout: async (_url, options) => {
      providerSignal = options.signal;
      return {
      response: { ok: true, status: 200 },
      data: { items: [incoming()] },
      };
    },
  });

  const result = await service.hydrateThread({
    threadId: 'thread-serve',
    accountEmail: 'serve-sender@example.com',
    owner: 'serve',
  });
  assert.equal(result.stored, 1);
  assert.equal(writeSignal, controller.signal);
  assert.equal(providerSignal, controller.signal);
  assert.equal(writeMutationId, '11111111-1111-4111-8111-111111111111');
  assert.equal(writeRequestKey, 'instantly-upsert:test-1');
  assert.equal(activeChecks, 3);
  assert.deepEqual(runnerOptions, {
    requestKey: 'instantly-upsert:test-1',
    kind: 'instantly-upsert',
    accountEmail: 'serve-sender@example.com',
    folder: 'instantly',
  });

  const withoutJournal = buildService({
    requireMutationJournal: true,
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: { items: [incoming()] },
    }),
  }).service;
  await assert.rejects(
    withoutJournal.hydrateThread({
      threadId: 'thread-serve',
      accountEmail: 'serve-sender@example.com',
      owner: 'serve',
    }),
    { code: 'INSTANTLY_MUTATION_JOURNAL_UNAVAILABLE' }
  );
});

test('webhook, polling en cron kunnen een onzekere providerwrite nooit als failed completeren', async () => {
  for (const [index, channel] of ['webhook', 'polling', 'cron'].entries()) {
    const store = createStore();
    const unknown = new Error(`${channel} write-uitkomst onzeker`);
    unknown.code = 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN';
    unknown.status = 503;
    unknown.leaveMutationPending = true;
    store.upsertProviderMessages = async () => ({ ok: false, error: unknown });
    let completes = 0;
    const providerSignals = [];
    const runner = createMailboxCampaignMutationRunner({
      mailboxCampaignConsistencyStore: {
        isAvailable: () => true,
        beginMutation: async () => ({
          mutationId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
          status: 'pending',
          replayed: false,
        }),
        completeMutation: async () => { completes += 1; },
      },
    });
    const { service } = buildService({
      store,
      requireMutationJournal: true,
      getCampaignMutationRunner: () => runner,
      fetchJsonWithTimeout: async (url, options) => {
        providerSignals.push(options.signal);
        return {
          response: { ok: true, status: 200 },
          data: url.includes('/emails/incoming-serve-1')
            ? incoming({ thread_id: '' })
            : { items: [incoming({ thread_id: '' })] },
        };
      },
    });

    if (channel === 'webhook') {
      await assert.rejects(service.ingestWebhook({
        headers: { 'x-instantly-webhook-secret': 'webhook-secret' },
        body: {
          event_type: 'reply_received',
          email_account: 'serve-sender@example.com',
          email_id: 'incoming-serve-1',
        },
      }), { code: 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN' });
    } else if (channel === 'polling') {
      await assert.rejects(service.syncOwner('serve'), {
        code: 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN',
      });
    } else {
      const response = {
        statusCode: 0,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await syncInstantlyMailboxResponse({
        instantlyMailboxService: service,
        req: { body: {}, query: { owner: 'serve' } },
        res: response,
        logger: { error() {} },
        normalizeString: (value) => String(value || '').trim(),
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.code, 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN');
    }
    assert.equal(completes, 0, `${channel} completeerde een onzekere mutation`);
    assert.equal(providerSignals.length > 0, true);
    assert.equal(providerSignals.every((signal) => signal instanceof AbortSignal), true);
  }
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

test('standaard mailboxintegratie verplicht de mutation journal voor Instantly-webhooks', async () => {
  let journalRuns = 0;
  const controller = new AbortController();
  const service = createDefaultInstantlyMailboxService({
    env: {
      INSTANTLY_MAILBOX_ENABLED: 'true',
      INSTANTLY_API_KEY: 'key',
      INSTANTLY_WEBHOOK_SECRET: 'webhook-secret',
      INSTANTLY_ACCOUNT_OWNERS_JSON: '{"serve-sender@example.com":"serve"}',
      INSTANTLY_CAMPAIGN_OWNERS_JSON: '{"campaign-serve":"serve"}',
    },
    mailboxIndexStore: createStore(),
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: incoming({ thread_id: '' }),
    }),
    getCampaignMutationRunner: () => ({
      isAvailable: () => true,
      run: async (_options, task) => {
        journalRuns += 1;
        return task({ signal: controller.signal, assertActive() {} });
      },
    }),
  });

  const result = await service.ingestWebhook({
    headers: { 'x-instantly-webhook-secret': 'webhook-secret' },
    body: {
      event_type: 'reply_received',
      email_account: 'serve-sender@example.com',
      email_id: 'incoming-serve-1',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(journalRuns, 1);
});

test('bounded polling always scans the fresh head and resumes its durable backlog without duplicate loss', async () => {
  const states = new Map();
  const listQueries = [];
  const { service, store } = buildService({
    config: { maxPages: 3 },
    getUiStateValues: async (scope) => ({
      values: { ...(states.get(scope) || {}) },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, patch) => {
      states.set(scope, { ...(patch || {}) });
      return { values: { ...(patch || {}) }, source: 'supabase' };
    },
    fetchJsonWithTimeout: async (url) => {
      const params = new URL(url).searchParams;
      if (params.get('search')) {
        return { response: { ok: true, status: 200 }, data: { items: [] } };
      }
      listQueries.push(Object.fromEntries(params.entries()));
      const cursor = params.get('starting_after') || '';
      const idByCursor = {
        '': listQueries.length === 1 ? 'page-one' : 'fresh-head',
        'cursor-page-two': 'page-two',
        'cursor-page-three': 'page-three',
        'cursor-page-four': 'page-four',
      };
      const nextByCursor = {
        '': listQueries.length === 1 ? 'cursor-page-two' : '',
        'cursor-page-two': 'cursor-page-three',
        'cursor-page-three': 'cursor-page-four',
        'cursor-page-four': '',
      };
      return {
        response: { ok: true, status: 200 },
        data: {
          items: [incoming({ id: idByCursor[cursor] })],
          next_starting_after: nextByCursor[cursor],
        },
      };
    },
  });

  const first = await service.syncOwner('serve');
  assert.equal(first.partial, true);
  const firstState = JSON.parse(states.get('instantly_mailbox_sync_serve').state_json);
  assert.equal(firstState.segments[0].cursor, 'cursor-page-four');
  await service.syncOwner('serve');
  assert.equal(listQueries[3].starting_after, undefined);
  assert.equal(listQueries[3].max_timestamp_created, '2026-07-25T12:00:00.000Z');
  assert.equal(listQueries[4].starting_after, 'cursor-page-four');
  const secondState = JSON.parse(states.get('instantly_mailbox_sync_serve').state_json);
  assert.deepEqual(secondState.segments, []);
  assert.deepEqual(
    store.rows.map((message) => message.providerMessageId).sort(),
    ['fresh-head', 'page-four', 'page-one', 'page-three', 'page-two']
  );
});

test('interactive refresh reuses a recent durable Instantly sync instead of hitting provider rate limits', async () => {
  const store = createStore();
  let lockCalls = 0;
  store.getSyncState = async () => ({ last_synced_at: '2026-07-25T11:59:00.000Z' });
  store.acquireSyncLock = async () => { lockCalls += 1; return { ok: true, lockToken: 'lock' }; };
  const { service, requests } = buildService({ store });

  const result = await service.syncOwner('serve', { minIntervalMs: 3 * 60 * 1000 });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'recent-sync');
  assert.equal(result.syncedAt, '2026-07-25T11:59:00.000Z');
  assert.equal(result.nextAllowedAt, '2026-07-25T12:02:00.000Z');
  assert.equal(lockCalls, 0);
  assert.equal(requests.length, 0);
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
      return { ok: true, readAt: '2026-08-05T15:51:00.000Z' };
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
  assert.equal(read.unread, false);
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
        accountEmail: 'serve@softora.nl',
        messageId: '<same-reply@example.org>',
        activityAt: '2026-07-25T11:00:00.000Z',
      },
      {
        id: 'gmail-other',
        accountEmail: 'serve@softora.nl',
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

test('campaign aggregation leest en ververst alleen de geselecteerde owner', async () => {
  const listedOwners = [];
  const syncedOwners = [];
  const providerMessages = {
    serve: [{
      id: 'ramon',
      provider: 'instantly',
      providerOwner: 'serve',
      providerAccountEmail: 'serve@websoftora.com',
      accountEmail: 'serve@websoftora.com',
      messageId: '<ramon@example.org>',
      activityAt: '2026-07-07T10:47:10.000Z',
      threadMessages: [],
    }],
    martijn: [{
      id: 'martijn-thread',
      provider: 'instantly',
      providerOwner: 'martijn',
      providerAccountEmail: 'martijn-sender@example.org',
      accountEmail: 'martijn-sender@example.org',
      messageId: '<martijn@example.org>',
      activityAt: '2026-07-07T10:48:10.000Z',
      threadMessages: [],
    }],
  };
  const instantlyMailboxService = {
    isConfigured: () => true,
    getConfiguredAccounts: (owner) => owner === 'serve'
      ? [{ email: 'serve@websoftora.com' }]
      : [{ email: 'martijn-sender@example.org' }],
    async syncOwner(owner) {
      syncedOwners.push(owner);
      return { ok: true, owner };
    },
    async listOwnerConversations(owner) {
      listedOwners.push(owner);
      return providerMessages[owner];
    },
  };
  const dependencies = {
    limit: 100,
    baseReplies: [],
    instantlyMailboxService,
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
  };

  const selectedOwnerRefresh = await mergeCampaignReplies({
    ...dependencies,
    owner: 'serve',
    refreshInstantly: true,
  });
  assert.deepEqual(syncedOwners, ['serve']);
  assert.deepEqual(listedOwners, ['serve']);
  assert.deepEqual(
    selectedOwnerRefresh.messages.map((message) => [message.id, message.providerOwner]),
    [['ramon', 'serve']]
  );
  assert.deepEqual(
    selectedOwnerRefresh.snapshotMessages.map((message) => [message.id, message.providerOwner]),
    [['ramon', 'serve']]
  );
  assert.equal(selectedOwnerRefresh.snapshotComplete, false);

  listedOwners.length = 0;
  const ownerlessBackgroundRefresh = await mergeCampaignReplies({
    ...dependencies,
    owner: '',
    refreshInstantly: false,
  });
  assert.deepEqual(listedOwners.sort(), ['martijn', 'serve']);
  assert.deepEqual(
    ownerlessBackgroundRefresh.messages.map((message) => message.id),
    ['martijn-thread', 'ramon']
  );
  assert.equal(ownerlessBackgroundRefresh.snapshotComplete, true);
  await assert.rejects(
    mergeCampaignReplies({
      ...dependencies,
      owner: 'onbekend',
      refreshInstantly: false,
    }),
    { code: 'INSTANTLY_OWNER_REQUIRED', status: 400 }
  );
});

test('campaign aggregation behoudt een gezonde owner als de andere provider-read faalt', async () => {
  const result = await mergeCampaignReplies({
    owner: '',
    limit: 100,
    refreshInstantly: false,
    baseReplies: [],
    instantlyMailboxService: {
      isConfigured: () => true,
      getConfiguredAccounts: (owner) => [{ email: `${owner}@example.test` }],
      listOwnerConversations: async (owner) => {
        if (owner === 'serve') {
          const error = new Error('Serve provider tijdelijk onbereikbaar');
          error.code = 'INSTANTLY_PROVIDER_UNAVAILABLE';
          throw error;
        }
        return [{
          id: 'martijn-healthy',
          provider: 'instantly',
          providerOwner: 'martijn',
          activityAt: '2026-08-10T09:00:00.000Z',
          threadMessages: [],
        }];
      },
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, max) => String(value || '').slice(0, max),
  });

  assert.deepEqual(result.messages.map((message) => message.id), ['martijn-healthy']);
  assert.deepEqual(result.warnings, ['INSTANTLY_PROVIDER_UNAVAILABLE:serve']);
  assert.equal(result.snapshotComplete, false);
});
