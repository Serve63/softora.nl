const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PAGE_STATE_SCOPES,
  createPremiumPageStateBootstrapService,
} = require('../../server/services/premium-page-state-bootstrap');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');

test('gedeelde pagina-bootstrap dekt alle database-UI-state pagina’s', () => {
  assert.deepEqual(PAGE_STATE_SCOPES['premium-mailbox.html'], [
    'premium_mailbox_preferences',
    'premium_coldmailing_settings',
  ]);
  assert.deepEqual(PAGE_STATE_SCOPES['premium-bevestigingsmails.html'], [
    'premium_coldmailing_settings',
    'premium_ai_lead_generator_settings',
  ]);
  assert.deepEqual(PAGE_STATE_SCOPES['premium-seo-crm-system.html'], ['premium_seo_crm']);
  assert.deepEqual(PAGE_STATE_SCOPES['premium-vaste-lasten.html'], ['premium_monthly_costs']);
  assert.deepEqual(PAGE_STATE_SCOPES['sportschool.html'], ['sportschool_logboek']);

  const primaryBootstrapMarkers = {
    'premium-actieve-opdrachten.html': /<!-- SOFTORA_ACTIVE_ORDERS_BOOTSTRAP -->/,
    'premium-database.html': /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/,
    'premium-personeel-dashboard.html': /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/,
  };
  Object.keys(PAGE_STATE_SCOPES).forEach((fileName) => {
    const pageSource = fs.readFileSync(path.join(__dirname, '../..', fileName), 'utf8');
    assert.match(
      pageSource,
      primaryBootstrapMarkers[fileName] || /<!-- SOFTORA_PAGE_STATE_BOOTSTRAP -->/,
      fileName
    );
    assert.match(pageSource, /premium-ui-state-client\.js\?v=20260722b/, fileName);
  });
});

test('SEO CRM blokkeert de browser niet meer met een synchrone database-request', () => {
  const pageSource = fs.readFileSync(
    path.join(__dirname, '../../premium-seo-crm-system.html'),
    'utf8'
  );

  assert.match(pageSource, /preloadRemoteUiStateFromPage/);
  assert.match(pageSource, /client\.peek\(REMOTE_UI_STATE_SCOPE\)/);
  assert.doesNotMatch(pageSource, /XMLHttpRequest/);
  assert.doesNotMatch(pageSource, /preloadRemoteUiStateSync/);
});

test('pagina-bootstrap leest scopes parallel en levert een veilig snapshot', async () => {
  const calls = [];
  const service = createPremiumPageStateBootstrapService({
    now: () => new Date('2026-07-22T20:00:00.000Z'),
    getUiStateValues: async (scope, options) => {
      calls.push({ scope, options });
      return {
        values: { scope },
        source: 'supabase',
        updatedAt: '2026-07-22T19:59:00.000Z',
      };
    },
  });

  const payload = await service.buildPageStateBootstrapPayload('PREMIUM-MAILBOX.HTML');

  assert.equal(payload.ok, true);
  assert.equal(payload.page, 'premium-mailbox.html');
  assert.equal(payload.loadedAt, '2026-07-22T20:00:00.000Z');
  assert.deepEqual(Object.keys(payload.scopes), [
    'premium_mailbox_preferences',
    'premium_coldmailing_settings',
  ]);
  assert.equal(calls.length, 3);
  assert.ok(calls.some((call) => call.scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE));
  assert.ok(calls.every((call) => call.options.preferSupabaseRestRead === true));
});

test('pagina-bootstrap blokkeert de pagina niet als één scope faalt', async () => {
  const service = createPremiumPageStateBootstrapService({
    getUiStateValues: async (scope) => {
      if (scope === 'premium_mailbox_preferences') throw new Error('tijdelijk niet beschikbaar');
      return { values: { ok: '1' }, source: 'supabase' };
    },
  });

  const payload = await service.buildPageStateBootstrapPayload('premium-mailbox.html');

  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload.scopes), ['premium_coldmailing_settings']);
  assert.equal(await service.buildPageStateBootstrapPayload('index.html'), null);
});

test('beschermde pagina zonder eigen scope krijgt de bevestigde sessie direct mee', async () => {
  const service = createPremiumPageStateBootstrapService();
  const payload = await service.buildPageStateBootstrapPayload('premium-instellingen.html', {
    session: {
      authenticated: true,
      email: 'serve@softora.nl',
      displayName: 'Servé Creusen',
      token: 'nooit-naar-de-browser',
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.session.displayName, 'Servé Creusen');
  assert.equal(Object.hasOwn(payload.session, 'token'), false);
  assert.deepEqual(payload.scopes, {});
});

test('mailbox-bootstrap levert sessie en berichten direct mee en hergebruikt het snapshot', async () => {
  let mailboxReads = 0;
  const service = createPremiumPageStateBootstrapService({
    now: () => new Date('2026-07-22T20:05:00.000Z'),
    getUiStateValues: async (scope) => ({ values: { scope }, source: 'supabase' }),
    mailboxCoordinator: {
      listCampaignReplies: async () => {
        mailboxReads += 1;
        return {
          ok: true,
          messages: [{
            id: 'inbox:reply-1',
            folder: 'inbox',
            accountEmail: 'serve@softora.nl',
            from: 'Studio Noord',
            body: 'Bericht met direct beschikbare afbeelding',
            bodyImages: [{
              alt: 'Ontwerp',
              dataUrl: `data:image/png;base64,${'a'.repeat(120_000)}`,
            }],
          }],
          sync: { source: 'campaign-replies-index' },
        };
      },
    },
  });
  const session = {
    authenticated: true,
    email: 'SERVE@SOFTORA.NL',
    userId: 'user-1',
    role: 'admin',
    firstName: 'Servé',
    lastName: 'Creusen',
    displayName: 'Servé Creusen',
    isAdmin: true,
    token: 'mag-nooit-naar-de-browser',
  };

  const first = await service.buildPageStateBootstrapPayload('premium-mailbox.html', { session });
  const second = await service.buildPageStateBootstrapPayload('premium-mailbox.html', { session });

  assert.equal(first.mailbox.messages[0].id, 'inbox:reply-1');
  assert.equal(first.mailbox.sync.source, 'campaign-replies-snapshot');
  assert.deepEqual(first.mailbox.messages[0].bodyImages, [{
    alt: 'Ontwerp',
    dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3Areply-1&index=0',
  }]);
  assert.equal(first.mailbox.messages[0].bodyImagesTruncated, false);
  assert.equal(first.session.email, 'serve@softora.nl');
  assert.equal(first.session.canManageUsers, true);
  assert.equal(Object.hasOwn(first.session, 'token'), false);
  assert.equal(second.mailbox.messages[0].from, 'Studio Noord');
  assert.equal(mailboxReads, 1);
});

test('mailbox-bootstrap leest bij een koude server eerst het duurzame snapshot', async () => {
  let mailboxReads = 0;
  const persisted = serializeMailboxCampaignSnapshot(
    {
      ok: true,
      messages: [{
        id: 'inbox:42',
        uid: 42,
        accountEmail: 'serve@softora.nl',
        from: 'Direct zichtbaar',
        email: 'reactie@example.test',
        subject: 'Re: Kleine vraag',
        body: 'Deze mail staat al in de eerste HTML.',
        date: '2026-07-22T20:30:00.000Z',
        campaign: { company: 'Direct zichtbaar', account: 'serve@softora.nl' },
      }],
      sync: { indexed: true, stale: false },
    },
    { savedAt: '2026-07-22T20:31:00.000Z' }
  );
  const service = createPremiumPageStateBootstrapService({
    getUiStateValues: async (scope) => scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE
      ? { values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: persisted }, source: 'supabase' }
      : { values: {}, source: 'supabase' },
    mailboxCoordinator: {
      listCampaignReplies: async () => {
        mailboxReads += 1;
        return { ok: true, messages: [], sync: { source: 'background' } };
      },
    },
  });

  const payload = await service.buildPageStateBootstrapPayload('premium-mailbox.html');

  assert.equal(payload.mailbox.messages[0].from, 'Direct zichtbaar');
  assert.equal(payload.mailbox.messages[0].body, 'Deze mail staat al in de eerste HTML.');
  assert.equal(payload.mailbox.sync.source, 'campaign-replies-snapshot');
  assert.equal(mailboxReads, 1);
});
