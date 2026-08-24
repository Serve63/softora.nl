const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const discoveryUi = require('../../assets/premium-mailbox-discovery');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const { createMailboxDiscoveryService } = require('../../server/services/mailbox-discovery');
const { createMailboxOutreachScope } = require('../../server/services/mailbox-outreach-scope');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817102256_mailbox_full_history_search.sql'
);
const performanceMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817115400_mailbox_search_stored_document.sql'
);
const outreachScopeMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817141000_mailbox_outreach_discovery_scope.sql'
);
const outreachQueryPlanMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817143800_mailbox_outreach_discovery_query_plan.sql'
);
const outreachEligibilitySetMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817145600_mailbox_outreach_eligibility_set.sql'
);
const outreachNarrowPlanMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817151000_mailbox_search_narrow_outreach_plan.sql'
);
const outreachScoreOnceMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817153000_mailbox_search_score_once.sql'
);
const contactDossierMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260820171023_mailbox_contact_search_and_logical_tombstones.sql'
);
const atomicVisibilityMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260820174711_mailbox_contact_atomic_visibility.sql'
);
const acceptedTimelineMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260824120230_mailbox_contact_timeline_send_provenance.sql'
);
const campaignProvenanceMigrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260824122203_mailbox_discovery_campaign_provenance.sql'
);

function createElement() {
  const listeners = {};
  const attributes = {};
  return {
    value: '', hidden: false, disabled: false, textContent: '', dataset: {}, scrollTop: 0,
    addEventListener(type, handler) { listeners[type] = handler; },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name]; },
    focus() {},
    dispatch(type, event = {}) { return listeners[type]?.(event); },
  };
}

test('mailbox discovery beperkt owner-scope server-side en valideert query en cursor', async () => {
  const calls = [];
  const service = createMailboxDiscoveryService({
    repository: {
      async search(input) {
        calls.push(input);
        return { messages: [{ id: 'match' }], totalCount: 22 };
      },
      async contactTimeline(input) {
        calls.push(input);
        return { messages: [{ id: 'timeline' }], totalCount: 1 };
      },
    },
    logger: { error() {} },
  });

  const first = await service.searchMailbox({ owner: 'martijn', query: ' Ziggo.nl ', limit: 20 });
  assert.deepEqual(calls[0].accountEmails, [
    'martijn@softora.nl',
    'martijnvandeven@softora.nl',
    'martijnven123@gmail.com',
    'contact.venvisuals@gmail.com',
  ]);
  assert.deepEqual(Object.keys(calls[0].ownerAccounts), ['martijn']);
  assert.deepEqual(calls[0].ownerAccounts.martijn, calls[0].accountEmails);
  assert.equal(first.query, 'Ziggo.nl');
  assert.ok(first.nextCursor);
  await service.searchMailbox({ owner: 'martijn', query: 'ziggo', cursor: first.nextCursor, limit: 20 });
  assert.equal(calls[1].offset, 1);
  await assert.rejects(() => service.searchMailbox({ owner: 'unknown', query: 'mail' }), /Onbekende mailboxscope/);
  await assert.rejects(() => service.searchMailbox({ owner: 'serve', query: '%' }), /2 tot 160/);
  await assert.rejects(() => service.getContactTimeline({ owner: 'serve', contactEmail: 'not-an-email' }), /Ongeldig contactadres/);
});

test('gedeelde outreachscope voegt provideraccounts toe en filtert de normale lijst exact', async () => {
  const calls = [];
  const scope = createMailboxOutreachScope({
    getInstantlyAccounts(owner) {
      return [{ email: `${owner}@websoftora.com` }];
    },
    repository: {
      async filterOutreachContacts(input) {
        calls.push(input);
        return ['eric@outreach.example'];
      },
    },
  });
  const scoped = scope.getScopedAccounts('serve');
  assert.ok(scoped.includes('serve@softora.nl'));
  assert.ok(scoped.includes('serve@websoftora.com'));
  assert.ok(!scoped.includes('martijn@websoftora.com'));
  const messages = await scope.filterConversations({
    owner: 'serve',
    messages: [
      { accountEmail: 'serve@softora.nl', email: 'eric@outreach.example', folder: 'inbox' },
      { accountEmail: 'serve@softora.nl', email: 'newsletter@example', folder: 'inbox' },
    ],
  });
  assert.deepEqual(messages.map((message) => message.email), ['eric@outreach.example']);
  assert.deepEqual(calls[0].contactEmails.sort(), ['eric@outreach.example', 'newsletter@example']);
});

test('contacttijdlijn merge gebruikt exact e-mailadres, dedupet en bewaart technische threadgrenzen', () => {
  const root = {
    id: 'martijn@softora.nl|inbox:55',
    messageId: '<old-2@example.test>',
    email: 'psonnemans@ziggo.nl',
  };
  const rows = [
    { id: root.id, messageId: root.messageId, technicalThreadKey: 'imap:martijn:old', messageKey: 'old-2' },
    { id: 'new-in', messageId: '<new-1@example.test>', technicalThreadKey: 'imap:martijn:new', subject: 'afspraak 17/8' },
    { id: 'new-out', messageId: '<new-2@example.test>', technicalThreadKey: 'imap:martijn:new', subject: 'Re: afspraak 17/8' },
    { id: 'mirror', messageId: '<new-2@example.test>', technicalThreadKey: 'imap:martijn:new', subject: 'Re: afspraak 17/8' },
  ];
  discoveryUi.mergeContactTimeline(root, rows, 'psonnemans@ziggo.nl', 3);
  assert.equal(root.threadMessages.length, 2);
  assert.equal(root.contactTimelineTotal, 3);
  assert.equal(root.contactTimelineThreadCount, 2);
  assert.equal(root.technicalThreadKey, 'imap:martijn:old');
  assert.equal(discoveryUi.resolveExternalContact(
    { folder: 'sent', email: 'martijn@softora.nl', to: 'psonnemans@ziggo.nl' },
    ['martijn@softora.nl']
  ), 'psonnemans@ziggo.nl');
  assert.notEqual(
    discoveryUi.resolveExternalContact({ email: 'ander@ziggo.nl' }, ['martijn@softora.nl']),
    'psonnemans@ziggo.nl'
  );
});

test('contacttijdlijn laat alleen hetzelfde externe adres binnen exact dezelfde eigenaar toe', () => {
  const root = {
    id: 'martijn@softora.nl|sent:1',
    messageId: '<root@example.test>',
    accountEmail: 'martijn@softora.nl',
    folder: 'sent',
    email: 'martijn@softora.nl',
    to: 'secretariaat@seniorenhaaren.nl',
  };
  const rows = [
    root,
    {
      id: 'inbox:correct', messageId: '<correct@example.test>', accountEmail: 'martijnvandeven@softora.nl',
      folder: 'inbox', email: 'secretariaat@seniorenhaaren.nl', to: 'martijnvandeven@softora.nl',
    },
    {
      id: 'sent:serve-alias', messageId: '<serve@example.test>', accountEmail: 'serve290@gmail.com',
      folder: 'sent', email: 'serve290@gmail.com', to: 'secretariaat@seniorenhaaren.nl',
    },
    {
      id: 'inbox:same-name-other-contact', messageId: '<wrong@example.test>', accountEmail: 'martijn@softora.nl',
      folder: 'inbox', from: 'Secretariaat', email: 'ander@example.nl', to: 'martijn@softora.nl',
    },
  ];

  discoveryUi.mergeContactTimeline(root, rows, 'secretariaat@seniorenhaaren.nl', 4, {
    accountEmails: ['martijn@softora.nl', 'martijnvandeven@softora.nl'],
  });

  assert.deepEqual(root.threadMessages.map((message) => message.id), ['inbox:correct']);
  assert.equal(root.contactTimelineRejectedCount, 2);
  assert.equal(root.contactTimelineTotal, 2);
});

test('contacttijdlijn gebruikt in beide-scope altijd de concrete eigenaar van zoekresultaat of normaal bericht', async () => {
  const cases = [{
    label: 'zoekresultaat',
    root: {
      id: 'search-result', messageId: '<search-root@test>', canonicalOwner: 'serve',
      accountEmail: 'serve@softora.nl', folder: 'inbox', email: 'contact@example.nl',
      to: 'serve@softora.nl', externalContactEmail: 'contact@example.nl',
    },
    expectedOwner: 'serve',
  }, {
    label: 'normaal bericht',
    root: {
      id: 'normal-message', messageId: '<normal-root@test>',
      accountEmail: 'martijn@softora.nl', folder: 'inbox', email: 'contact@example.nl',
      to: 'martijn@softora.nl', externalContactEmail: 'contact@example.nl',
    },
    expectedOwner: 'martijn',
  }];

  for (const fixture of cases) {
    const elements = {
      'mailbox-search-input': createElement(),
      'mailbox-search-clear': createElement(),
      'mailbox-search-status': createElement(),
      'mailbox-search-more': createElement(),
    };
    const requests = [];
    const controller = discoveryUi.create({
      document: { getElementById: (id) => elements[id] || null, querySelector: () => null },
      async fetch(url) {
        requests.push(new URL(url, 'https://softora.test'));
        return {
          ok: true,
          json: async () => ({
            ok: true,
            totalCount: 2,
            messages: [{
              id: `${fixture.label}-serve`, messageId: `<${fixture.label}-serve@test>`,
              accountEmail: 'serve@softora.nl', folder: 'inbox', email: 'contact@example.nl',
              to: 'serve@softora.nl', technicalThreadKey: 'serve-thread',
            }, {
              id: `${fixture.label}-martijn`, messageId: `<${fixture.label}-martijn@test>`,
              accountEmail: 'martijn@softora.nl', folder: 'inbox', email: 'contact@example.nl',
              to: 'martijn@softora.nl', technicalThreadKey: 'martijn-thread',
            }],
          }),
        };
      },
      getOwner: () => 'both',
      getMessageOwner: (message) => String(message?.accountEmail || '').startsWith('martijn@') ? 'martijn' : 'serve',
      getAccountEmails: () => ['serve@softora.nl', 'martijn@softora.nl'],
      getActiveMail: () => fixture.root.id,
      normalizeMessage: (value) => ({ ...value }),
      openMail() {},
    });

    assert.equal(await controller.loadContactTimeline(fixture.root), true, fixture.label);
    assert.equal(requests.length, 1, fixture.label);
    assert.equal(requests[0].searchParams.get('owner'), fixture.expectedOwner, fixture.label);
    assert.ok(
      fixture.root.threadMessages.every((message) => message.accountEmail.startsWith(`${fixture.expectedOwner}@`)),
      fixture.label
    );
  }
});

test('zoekcontroller voorkomt stale A naar B resultaten en clear herstelt selectie en scroll', async () => {
  const input = createElement();
  const clear = createElement();
  const status = createElement();
  const more = createElement();
  const list = createElement();
  list.scrollTop = 86;
  const elements = {
    'mailbox-search-input': input,
    'mailbox-search-clear': clear,
    'mailbox-search-status': status,
    'mailbox-search-more': more,
  };
  const pending = new Map();
  let messages = [{ id: 'normal' }];
  let activeMail = 'normal';
  const rendered = [];
  let resetDetailCalls = 0;
  const controller = discoveryUi.create({
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector() { return { scrollTop: 44 }; },
    },
    fetch(url) {
      const query = new URL(url, 'https://softora.test').searchParams.get('q');
      return new Promise((resolve) => pending.set(query, resolve));
    },
    getOwner: () => 'both',
    getAccountEmails: () => ['serve@softora.nl', 'martijn@softora.nl'],
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveMail: () => activeMail,
    setActiveMail: (value) => { activeMail = value; },
    getListElement: () => list,
    normalizeMessage: (value) => ({ ...value }),
    renderList: (value) => rendered.push(value),
    openMail() {},
    resetDetail: () => { resetDetailCalls += 1; },
  });

  input.value = 'alpha';
  const alpha = controller.runSearch();
  input.value = 'beta';
  const beta = controller.runSearch();
  pending.get('beta')({ ok: true, json: async () => ({ ok: true, messages: [{ id: 'beta' }], totalCount: 1 }) });
  assert.equal(await beta, true);
  pending.get('alpha')({ ok: true, json: async () => ({ ok: true, messages: [{ id: 'alpha' }], totalCount: 1 }) });
  assert.equal(await alpha, false);
  assert.deepEqual(messages.map((message) => message.id), ['beta']);
  assert.equal(resetDetailCalls, 1);
  assert.equal(controller.canOpenResult(messages[0]), true);
  assert.equal(controller.canOpenResult({ id: 'stale-normal-row' }), false);
  controller.clearSearch();
  assert.deepEqual(messages.map((message) => message.id), ['normal']);
  assert.equal(activeMail, 'normal');
  assert.equal(list.scrollTop, 86);
  assert.ok(rendered.length >= 2);
  assert.equal(controller.canOpenResult({ id: 'normal' }), true);
});

test('zoekpaginering is single-flight en verdwijnt pas na de laatste pagina', async () => {
  const input = createElement();
  const status = createElement();
  const more = createElement();
  const list = createElement();
  const elements = {
    'mailbox-search-input': input,
    'mailbox-search-status': status,
    'mailbox-search-more': more,
  };
  const pending = [];
  let messages = [];
  const controller = discoveryUi.create({
    document: { getElementById: (id) => elements[id] || null, querySelector: () => null },
    fetch(url) {
      return new Promise((resolve) => pending.push({ url, resolve }));
    },
    getOwner: () => 'both',
    getMessages: () => messages,
    setMessages: (value) => { messages = value; },
    getActiveMail: () => null,
    setActiveMail() {},
    getListElement: () => list,
    normalizeMessage: (value) => ({ ...value }),
    renderList() {},
  });

  input.value = 'eric';
  const first = controller.runSearch();
  pending[0].resolve({
    ok: true,
    json: async () => ({ ok: true, messages: [{ id: 'page-1' }], totalCount: 2, nextCursor: 'page-2' }),
  });
  assert.equal(await first, true);
  assert.equal(more.hidden, false);
  assert.equal(more.disabled, false);

  const append = more.dispatch('click');
  more.dispatch('click');
  assert.equal(pending.length, 2);
  assert.equal(more.disabled, true);
  assert.equal(more.getAttribute('aria-busy'), 'true');
  pending[1].resolve({
    ok: true,
    json: async () => ({ ok: true, messages: [{ id: 'page-2' }], totalCount: 2, nextCursor: null }),
  });
  await append;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages.map((message) => message.id), ['page-1', 'page-2']);
  assert.equal(more.hidden, true);
  assert.equal(more.disabled, false);
});

test('contactdossier ververst na inboxreconciliatie opnieuw uit de exacte contactbron', async () => {
  const elements = {
    'mailbox-search-input': createElement(),
    'mailbox-search-clear': createElement(),
    'mailbox-search-status': createElement(),
    'mailbox-search-more': createElement(),
  };
  const mail = {
    id: 'contact-root',
    messageId: '<root@example.test>',
    accountEmail: 'owner@example.test',
    folder: 'inbox',
    email: 'contact@example.test',
    to: 'owner@example.test',
    contactTimelineLoaded: true,
    contactTimelineNeedsRefresh: true,
    externalContactEmail: 'contact@example.test',
    threadMessages: [{ id: 'stale-copy', messageId: '<stale@example.test>' }],
  };
  let requests = 0;
  let renders = 0;
  const controller = discoveryUi.create({
    document: { getElementById: (id) => elements[id] || null, querySelector: () => null },
    async fetch() {
      requests += 1;
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            totalCount: 2,
            messages: [
              { id: 'root-row', messageId: '<root@example.test>', accountEmail: 'owner@example.test', folder: 'inbox', email: 'contact@example.test', to: 'owner@example.test', technicalThreadKey: 'thread-a' },
              { id: 'fresh-row', messageId: '<fresh@example.test>', accountEmail: 'owner@example.test', folder: 'sent', email: 'owner@example.test', to: 'contact@example.test', technicalThreadKey: 'thread-b' },
            ],
          };
        },
      };
    },
    getOwner: () => 'both',
    getAccountEmails: () => ['owner@example.test'],
    getActiveMail: () => mail.id,
    normalizeMessage: (value) => ({ ...value }),
    openMail: () => { renders += 1; },
  });

  assert.equal(await controller.loadContactTimeline(mail), true);
  assert.equal(requests, 1);
  assert.equal(renders, 1);
  assert.equal(mail.contactTimelineNeedsRefresh, false);
  assert.equal(mail.contactTimelineTotal, 2);
  assert.deepEqual(mail.threadMessages.map((message) => message.id), ['fresh-row']);
  assert.equal(await controller.loadContactTimeline(mail), true);
  assert.equal(requests, 1);
});

test('contactdossier verbergt technische onderwerpen en reply gebruikt exact het gekozen bronbericht', () => {
  campaignInbox.setOwner('both');
  const older = {
    id: 'inbox:older', mailboxId: 'inbox:older', accountEmail: 'martijn@softora.nl',
    messageId: '<older@test>', email: 'contact@example.nl', subject: 'Los onderwerp',
    date: '2026-08-10T10:00:00Z', technicalThreadKey: 'imap:martijn:older', body: 'Ouder',
  };
  const newer = {
    id: 'inbox:newer', mailboxId: 'inbox:newer', accountEmail: 'martijn@softora.nl',
    messageId: '<newer@test>', email: 'contact@example.nl', subject: 'Nieuw onderwerp',
    date: '2026-08-16T10:00:00Z', technicalThreadKey: 'imap:martijn:newer', body: 'Nieuwer',
  };
  const root = {
    ...newer,
    id: 'contact-root',
    contactTimelineLoaded: true,
    threadMessages: [older, newer],
  };
  const rendered = campaignInbox.renderThreadMessages(root, String, () => ({ date: '16 aug', time: '12:00' }), {
    newestFirst: true,
    renderMessageAction: (message) => `<button data-key="${campaignInbox.getActionMessageKey(message)}">Reply</button>`,
  });
  assert.doesNotMatch(rendered, /mail-contact-thread-boundary/);
  assert.doesNotMatch(rendered, /Los onderwerp|Nieuw onderwerp/);
  assert.ok(rendered.indexOf('Nieuwer') < rendered.indexOf('Ouder'));
  assert.equal((rendered.match(/>Reply<\/button>/g) || []).length, 2);

  const fields = new Map(['c-to', 'c-subject', 'c-body', 'compose-overlay'].map((id) => [id, {
    value: '', classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
  }]));
  let selectedSource = null;
  const controller = composeController.create({
    document: { getElementById: (id) => fields.get(id) || null, querySelector: () => null },
    compose: {
      buildReplyContext(source) { selectedSource = source; return { id: source.id, accountEmail: source.accountEmail, mode: 'reply' }; },
      resetOptionalFields() {}, reset() {},
    },
    campaignInbox,
    display: { getReplyToAddress: (source) => source.email, formatDetailSubject: (value) => value },
    getActiveFolder: () => 'outreach',
    getAccount: () => 'martijn@softora.nl',
    getOwner: () => 'both',
    findMail: () => root,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    composeWindow: { reset() {} },
    toast(message) { throw new Error(message); },
  });
  controller.reply(root, campaignInbox.getActionMessageKey(older));
  assert.equal(selectedSource.messageId, '<older@test>');
  assert.equal(fields.get('c-to').value, 'contact@example.nl');
});

test('databasefuncties vinden volledige historie, scheiden RFC-threads en sluiten andere adressen uit', async () => {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.softora_mailbox_messages (
      message_key text primary key, account_email text, folder text, uid bigint,
      provider_id text, message_id text, in_reply_to text, references_text text,
      sender_name text, sender_email text, recipients_text text, subject text,
      preview text, body_text text, body_truncated boolean, has_body boolean,
      date timestamptz, internal_date timestamptz, unread boolean, starred boolean,
      payload jsonb, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz,
      reply_dismissed_at timestamptz, softora_read_at timestamptz, uid_validity bigint,
      generation_superseded_at timestamptz, state_revision bigint,
      state_mutation_key text, state_mutation_at timestamptz
    );
    create table public.softora_outbound_recipient_guards (
      guard_key text primary key, key_type text, key_value text, reservation_id text,
      provider text, channel text, sender_email text, recipient_email text,
      recipient_domain text, recipient_company_key text, recipient_id text,
      recipient_company text, status text, source text, actor text, permanent boolean,
      payload jsonb, expires_at timestamptz, last_seen_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    );
    create table public.softora_mailbox_send_provenance (
      intent_id text primary key, idempotency_key text unique, owner text,
      account_email text, recipient_email text, mode text,
      conversation_id text, reply_target_message_id text, references_text text,
      provider text, provider_thread_id text, provider_message_id text,
      sent_message_id text, sender_name text, subject text, body_text text,
      cc_text text, bcc_text text, status text, accepted_at timestamptz
    );
    create table public.softora_mailbox_campaign_consistency (
      scope text primary key, content_version bigint not null default 0,
      updated_at timestamptz not null default now()
    );
    create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
    returns trigger language plpgsql volatile security invoker set search_path = '' as $$
    begin
      insert into public.softora_mailbox_campaign_consistency (scope, content_version)
      values ('campaign', 0) on conflict (scope) do nothing;
      perform 1 from public.softora_mailbox_campaign_consistency
      where scope = 'campaign' for update;
      return null;
    end;
    $$;
    create table public.softora_mailbox_campaign_lineage_roots (
      message_key text primary key, account_email text not null
    );
    create table public.softora_mailbox_campaign_lineage_members (
      message_key text primary key, account_email text not null,
      is_proven_automated boolean not null default false
    );
    create function public.softora_has_proven_automated_reply(p_payload jsonb)
    returns boolean language sql immutable security invoker set search_path = '' as $$
      select (
        lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidenceKnown', ''))) = 'true'
        and lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidence', ''))) = 'true'
        and nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidenceSource', '')), '') is not null
      ) or (
        nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'autoSubmitted', '')), '') is not null
        and lower(btrim(coalesce(p_payload, '{}'::jsonb)->>'autoSubmitted')) <> 'no'
      ) or lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'precedence', ''))) in (
        'auto_reply', 'auto-reply', 'bulk', 'junk', 'list'
      ) or (
        nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'autoResponseSuppress', '')), '') is not null
        and lower(btrim(coalesce(p_payload, '{}'::jsonb)->>'autoResponseSuppress')) not in (
          '0', 'false', 'no', 'none', 'off'
        )
      );
    $$;
    insert into public.softora_mailbox_campaign_consistency (scope, content_version)
    values ('campaign', 0);
  `);
  let migration = fs.readFileSync(migrationPath, 'utf8');
  migration = migration.replace(
    /create index if not exists softora_mailbox_messages_full_history_search_idx[\s\S]*?generation_superseded_at is null;\n\n/,
    ''
  );
  await database.exec(migration);
  let performanceMigration = fs.readFileSync(performanceMigrationPath, 'utf8');
  performanceMigration = performanceMigration
    .replace(
      /create index if not exists softora_mailbox_messages_search_document_idx[\s\S]*?generation_superseded_at is null;\n\n/,
      ''
    )
    .replace(/drop index if exists public\.softora_mailbox_messages_full_history_search_idx;\n\n/, '');
  await database.exec(performanceMigration);
  await database.exec(fs.readFileSync(outreachScopeMigrationPath, 'utf8'));
  let outreachQueryPlanMigration = fs.readFileSync(outreachQueryPlanMigrationPath, 'utf8');
  outreachQueryPlanMigration = outreachQueryPlanMigration.replace(
    /create index if not exists softora_mailbox_messages_participants_active_idx[\s\S]*?generation_superseded_at is null;\n\n/,
    ''
  );
  await database.exec(outreachQueryPlanMigration);
  await database.exec(fs.readFileSync(outreachEligibilitySetMigrationPath, 'utf8'));
  await database.exec(fs.readFileSync(outreachNarrowPlanMigrationPath, 'utf8'));
  await database.exec(fs.readFileSync(outreachScoreOnceMigrationPath, 'utf8'));
  await database.exec(`
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id,
      deleted_at, updated_at
    ) values
      ('backfill-hidden','serve@softora.nl','inbox',901,'inbox:901',
        '<Backfill-Copy@Test>','2026-08-19T10:00:00Z','2026-08-19T10:00:00Z'),
      ('backfill-active','serve@softora.nl','allmail',902,'allmail:902',
        'backfill-copy@test',null,'2026-08-19T10:01:00Z'),
      ('backfill-other-owner','martijn@softora.nl','inbox',901,'inbox:901',
        '<BACKFILL-COPY@TEST>',null,'2026-08-19T10:02:00Z'),
      ('backfill-empty-hidden','serve@softora.nl','inbox',903,'inbox:903',
        '', '2026-08-19T10:03:00Z','2026-08-19T10:03:00Z'),
      ('backfill-empty-active','serve@softora.nl','allmail',904,'allmail:904',
        '', null,'2026-08-19T10:04:00Z');
  `);
  await database.exec(fs.readFileSync(contactDossierMigrationPath, 'utf8'));
  await database.exec(fs.readFileSync(atomicVisibilityMigrationPath, 'utf8'));
  await database.exec(fs.readFileSync(acceptedTimelineMigrationPath, 'utf8'));
  await database.exec(fs.readFileSync(campaignProvenanceMigrationPath, 'utf8'));

  const preMigrationDeleteState = await database.query(`
    select message_key, deleted_at
    from public.softora_mailbox_messages
    where message_key like 'backfill-%'
    order by message_key
  `);
  assert.equal(preMigrationDeleteState.rows.find((row) => row.message_key === 'backfill-active').deleted_at, null);
  assert.ok(preMigrationDeleteState.rows.find((row) => row.message_key === 'backfill-hidden').deleted_at);
  assert.equal(preMigrationDeleteState.rows.find((row) => row.message_key === 'backfill-other-owner').deleted_at, null);
  assert.equal(preMigrationDeleteState.rows.find((row) => row.message_key === 'backfill-empty-active').deleted_at, null);
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_message_tombstones
    where account_email = 'serve@softora.nl'
      and normalized_message_id = 'backfill-copy@test'
  `)).rows[0].count, 0);

  await database.exec(`
    update public.softora_mailbox_messages
    set
      account_email = account_email,
      message_id = message_id,
      updated_at = '2026-08-20T13:59:00Z'
    where message_key = 'backfill-hidden';
  `);
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_message_tombstones
    where account_email = 'serve@softora.nl'
      and normalized_message_id = 'backfill-copy@test'
  `)).rows[0].count, 0);
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_messages
    where message_key = 'backfill-active'
      and deleted_at is null
  `)).rows[0].count, 1);
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_message_tombstones
    where normalized_message_id = ''
  `)).rows[0].count, 0);

  await database.exec(`
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id, updated_at
    ) values (
      'legacy-window-hidden','serve@softora.nl','inbox',905,'inbox:905',
      '<Legacy-Window@Test>','2026-08-20T14:00:00Z'
    );
    update public.softora_mailbox_messages
    set deleted_at = '2026-08-20T14:01:00Z', updated_at = '2026-08-20T14:01:00Z'
    where message_key = 'legacy-window-hidden';
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id, updated_at
    ) values
      ('legacy-window-later','serve@softora.nl','allmail',906,'allmail:906',
        'legacy-window@test','2026-08-20T14:02:00Z'),
      ('legacy-window-other-owner','martijn@softora.nl','allmail',905,'allmail:905',
        '<LEGACY-WINDOW@TEST>','2026-08-20T14:02:00Z');
  `);
  const legacyWindowState = await database.query(`
    select message_key, deleted_at
    from public.softora_mailbox_messages
    where message_key like 'legacy-window-%'
    order by message_key
  `);
  assert.ok(legacyWindowState.rows.find((row) => row.message_key === 'legacy-window-hidden').deleted_at);
  assert.ok(legacyWindowState.rows.find((row) => row.message_key === 'legacy-window-later').deleted_at);
  assert.equal(legacyWindowState.rows.find((row) => row.message_key === 'legacy-window-other-owner').deleted_at, null);
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_message_tombstones
    where account_email = 'serve@softora.nl'
      and normalized_message_id = 'legacy-window@test'
  `)).rows[0].count, 1);

  const payload = (extra = {}) => JSON.stringify({ source: 'imap-sync', provider: 'imap', ...extra });
  const rows = [
    ['old-in', 'martijn@softora.nl', 'inbox', 1, 'inbox:1', '<old-in@test>', '', '', 'Peter Sönnemans', 'psonnemans@ziggo.nl', 'martijn@softora.nl', 'Kleine vraag', 'oude vraag', 'Crème inhoud', '2026-07-31T16:39:00Z', payload()],
    ['old-out', 'martijn@softora.nl', 'sent', 2, 'sent:2', '<old-out@test>', '<old-in@test>', '<old-in@test>', 'Martijn', 'martijn@softora.nl', 'psonnemans@ziggo.nl', 'Re: Kleine vraag', 'oud antwoord', 'antwoord', '2026-08-01T08:56:00Z', payload()],
    ['new-in', 'martijn@softora.nl', 'inbox', 3, 'inbox:3', '<new-in@test>', '', '', 'Peter', 'psonnemans@ziggo.nl', 'martijn@softora.nl', 'afspraak 17/8', 'nieuwe afspraak', 'los bericht', '2026-08-15T15:56:00Z', payload()],
    ['new-out', 'martijn@softora.nl', 'sent', 4, 'sent:4', '<new-out@test>', '<new-in@test>', '<new-in@test>', 'Martijn', 'martijn@softora.nl', 'psonnemans@ziggo.nl', 'Re: afspraak 17/8', 'bevestiging', 'los antwoord', '2026-08-17T08:33:00Z', payload()],
    ['new-out-mirror', 'martijn@softora.nl', 'coldmail', 5, 'coldmail:5', '<new-out@test>', '<new-in@test>', '<new-in@test>', 'Martijn', 'martijn@softora.nl', 'psonnemans@ziggo.nl', 'Re: afspraak 17/8', 'bevestiging', 'los antwoord', '2026-08-17T08:33:00Z', payload()],
    ['other-ziggo', 'martijn@softora.nl', 'inbox', 6, 'inbox:6', '<other@test>', '', '', 'Ander', 'ander@ziggo.nl', 'martijn@softora.nl', 'Andere klant', 'anders', 'anders', '2026-08-16T08:33:00Z', payload()],
    ['serve-contact', 'serve@softora.nl', 'inbox', 7, 'inbox:7', '<serve@test>', '', '', 'Peter', 'psonnemans@ziggo.nl', 'serve@softora.nl', 'Servé onderwerp', 'serve', 'serve', '2026-08-14T08:33:00Z', payload()],
    ['instantly-copy', 'martijn@softora.nl', 'instantly', 8, 'instantly:copy', '<old-in@test>', '', '', 'Peter', 'psonnemans@ziggo.nl', 'martijn@softora.nl', 'Kleine vraag', 'oude vraag', 'Crème inhoud', '2026-07-31T16:39:00Z', payload({ provider: 'instantly', providerThreadId: 'inst-thread', direction: 'received' })],
    ['bericht-address', 'martijn@softora.nl', 'coldmail', 10, 'coldmail:10', '<bericht-address@test>', '', '', 'Contact', 'bericht@outreach.example', 'martijn@softora.nl', 'Los onderwerp', 'gewone tekst', 'Geen zoekterm aanwezig', '2026-08-17T08:45:00Z', payload()],
    ['tessa-back-a-in', 'martijn@softora.nl', 'coldmail', 20, 'coldmail:20', '<tessa-a-1@test>', '', '', 'Tessa de Backer', 'communicatie@schakel-nu.nl', 'martijn@softora.nl', 'Kennismaking A', 'Tessa reageert', 'Eerste reactie', '2026-08-10T08:00:00Z', payload()],
    ['tessa-back-a-out', 'martijn@softora.nl', 'sent', 21, 'sent:21', '<tessa-a-2@test>', '<tessa-a-1@test>', '<tessa-a-1@test>', 'Martijn', 'martijn@softora.nl', 'communicatie@schakel-nu.nl', 'Re: Kennismaking A', 'Antwoord aan Tessa', 'Eerste antwoord', '2026-08-10T09:00:00Z', payload()],
    ['tessa-back-a-later', 'martijn@softora.nl', 'inbox', 22, 'inbox:22', '<tessa-a-3@test>', '<tessa-a-2@test>', '<tessa-a-1@test> <tessa-a-2@test>', 'Tessa de Backer', 'communicatie@schakel-nu.nl', 'martijn@softora.nl', 'Re: Kennismaking A', 'Tessa vervolgt', 'Tweede reactie', '2026-08-10T10:00:00Z', payload()],
    ['tessa-back-b-in', 'martijn@softora.nl', 'coldmail', 23, 'coldmail:23', '<tessa-b-1@test>', '', '', 'Tessa de Backer', 'communicatie@schakel-nu.nl', 'martijn@softora.nl', 'Kennismaking B', 'Tessa reageert opnieuw', 'Derde reactie', '2026-08-11T08:00:00Z', payload()],
    ['tessa-back-b-out', 'martijn@softora.nl', 'sent', 24, 'sent:24', '<tessa-b-2@test>', '<tessa-b-1@test>', '<tessa-b-1@test>', 'Martijn', 'martijn@softora.nl', 'communicatie@schakel-nu.nl', 'Re: Kennismaking B', 'Antwoord aan Tessa', 'Tweede antwoord', '2026-08-11T09:00:00Z', payload()],
    ['tessa-back-c-in', 'martijn@softora.nl', 'coldmail', 25, 'coldmail:25', '<tessa-c-1@test>', '', '', 'Tessa de Backer', 'communicatie@schakel-nu.nl', 'martijn@softora.nl', 'Kennismaking C', 'Tessa derde onderwerp', 'Vierde reactie', '2026-08-12T08:00:00Z', payload()],
    ['tessa-back-c-out', 'martijn@softora.nl', 'sent', 26, 'sent:26', '<tessa-c-2@test>', '<tessa-c-1@test>', '<tessa-c-1@test>', 'Martijn', 'martijn@softora.nl', 'communicatie@schakel-nu.nl', 'Re: Kennismaking C', 'Antwoord aan Tessa', 'Derde antwoord', '2026-08-12T09:00:00Z', payload()],
    ['tessa-dongen', 'martijn@softora.nl', 'coldmail', 27, 'coldmail:27', '<tessa-dongen@test>', '', '', 'Tessa van Dongen', 'tessa.van.dongen@gele-ster.nl', 'martijn@softora.nl', 'Los contact', 'Tessa van Dongen', 'Apart dossier', '2026-08-13T08:00:00Z', payload()],
    ['tessa-mensink', 'martijn@softora.nl', 'coldmail', 28, 'coldmail:28', '<tessa-mensink@test>', '', '', 'Tessa Mensink', 'mensink9@planet.nl', 'martijn@softora.nl', 'Los contact', 'Tessa Mensink', 'Apart dossier', '2026-08-14T08:00:00Z', payload()],
    ['tessa-back-serve', 'serve@softora.nl', 'coldmail', 29, 'coldmail:29', '<tessa-serve@test>', '', '', 'Tessa de Backer', 'communicatie@schakel-nu.nl', 'serve@softora.nl', 'Eigen Servé-contact', 'Tessa bij Servé', 'Apart eigenaardossier', '2026-08-15T08:00:00Z', payload()],
  ];
  for (const row of rows) {
    await database.query(`
      insert into public.softora_mailbox_messages (
        message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,
        sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,
        body_truncated,has_body,unread,starred,payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,false,true,false,false,$16::jsonb)
    `, row);
  }
  await database.exec(`
    insert into public.softora_outbound_recipient_guards (
      guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,
      status,source,permanent
    ) values (
      'email:psonnemans@ziggo.nl','email','psonnemans@ziggo.nl','softora','coldmail',
      'serve@softora.nl','psonnemans@ziggo.nl','sent','fixture',true
    );
  `);

  await database.exec(`
    insert into public.softora_mailbox_campaign_lineage_members (
      message_key, account_email, is_proven_automated
    ) values
      ('tessa-back-a-in','martijn@softora.nl',false),
      ('tessa-back-a-out','martijn@softora.nl',false),
      ('tessa-back-a-later','martijn@softora.nl',false),
      ('tessa-back-b-in','martijn@softora.nl',false),
      ('tessa-back-b-out','martijn@softora.nl',false),
      ('tessa-back-c-in','martijn@softora.nl',false),
      ('tessa-back-c-out','martijn@softora.nl',false),
      ('tessa-dongen','martijn@softora.nl',false),
      ('tessa-mensink','martijn@softora.nl',false),
      ('tessa-back-serve','serve@softora.nl',false),
      ('old-in','martijn@softora.nl',false),
      ('old-out','martijn@softora.nl',false);

    insert into public.softora_mailbox_messages (
      message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,
      sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,
      body_truncated,has_body,unread,starred,payload
    ) values
      ('peter-root-one','martijn@softora.nl','sent',301,'sent:301','<peter-root-one@test>','','',
        'Martijn','martijn@softora.nl','peter.root.one@example.nl','Campagne een','Peter root een','Eerste bewezen outbound','2026-08-18T08:00:00Z','2026-08-18T08:00:00Z',false,true,false,false,'{}'),
      ('peter-root-two','martijn@softora.nl','sent',302,'sent:302','<peter-root-two@test>','','',
        'Martijn','martijn@softora.nl','peter.root.two@example.nl','Campagne twee','Peter root twee','Tweede bewezen outbound','2026-08-18T08:01:00Z','2026-08-18T08:01:00Z',false,true,false,false,'{}'),
      ('peter-root-three','martijn@softora.nl','sent',303,'sent:303','<peter-root-three@test>','','',
        'Martijn','martijn@softora.nl','peter.root.three@example.nl','Campagne drie','Peter root drie','Derde bewezen outbound','2026-08-18T08:02:00Z','2026-08-18T08:02:00Z',false,true,false,false,'{"originalCampaignOutbound":true}'),
      ('peter-brouwers','martijn@softora.nl','inbox',304,'inbox:304','<peter-brouwers@test>','','',
        'Peter Brouwers','peter.brouwers@example.nl','martijn@softora.nl','RE: Kleine vraag over jullie website','Menselijke reactie','Dit is een echte reactie','2026-08-18T09:00:00Z','2026-08-18T09:00:00Z',false,true,false,false,'{}'),
      ('peter-bridge-reply','martijn@softora.nl','inbox',315,'inbox:315','<peter-bridge-reply@test>','<peter-bridge-root@test>','<peter-bridge-root@test>',
        'Peter Brug','peter.bridge@example.nl','martijn@softora.nl','Volledig gewijzigde titel','Brugreactie','Inbound reply via exact outbound Message-ID','2026-08-18T09:00:30Z','2026-08-18T09:00:30Z',false,true,false,false,'{}'),
      ('peter-afspraak','martijn@softora.nl','inbox',305,'inbox:305','<peter-afspraak@test>','','',
        'Peter Los Bericht','peter.losbericht@example.nl','martijn@softora.nl','Gesprek 17/8','Gewone mail','Geen campagnebewijs','2026-08-18T09:01:00Z','2026-08-18T09:01:00Z',false,true,false,false,'{}'),
      ('peter-strato-bounce','martijn@softora.nl','inbox',306,'inbox:306','<peter-strato@test>','<peter-root-one@test>','<peter-root-one@test>',
        'STRATO Mailserver','mailer-daemon@strato.nl','martijn@softora.nl, peter.bounce@example.nl','Re: Kleine vraag over jullie website','Delivery failed','Bezorging mislukt','2026-08-18T09:02:00Z','2026-08-18T09:02:00Z',false,true,false,false,'{"autoSubmitted":"auto-generated"}'),
      ('peter-linkedin','martijn@softora.nl','inbox',307,'inbox:307','<peter-linkedin@test>','','',
        'LinkedIn','messages-noreply@linkedin.com','martijn@softora.nl, peter.linkedin@example.nl','Re: Kleine vraag over jullie website','LinkedIn melding','Netwerkupdate','2026-08-18T09:03:00Z','2026-08-18T09:03:00Z',false,true,false,false,'{}'),
      ('changed-root','martijn@softora.nl','sent',308,'sent:308','<changed-root@test>','','',
        'Martijn','martijn@softora.nl','changed.contact@example.nl','Campagne ander onderwerp','Start','Campagne outbound','2026-08-18T10:00:00Z','2026-08-18T10:00:00Z',false,true,false,false,'{}'),
      ('changed-lineage-reply','martijn@softora.nl','inbox',309,'inbox:309','<changed-reply@test>','<changed-root@test>','<changed-root@test>',
        'Gewijzigde reactie','changed.contact@example.nl','martijn@softora.nl','Volledig ander onderwerp','Hernoemdzoekwoord','hernoemdzoekwoord blijft via exacte lineage zichtbaar','2026-08-18T10:01:00Z','2026-08-18T10:01:00Z',false,true,false,false,'{}'),
      ('autoflag-reply','martijn@softora.nl','inbox',310,'inbox:310','<autoflag@test>','<peter-root-one@test>','<peter-root-one@test>',
        'Autoflag Persoon','autoflag@example.nl','martijn@softora.nl','Re: Kleine vraag over jullie website','Automatisch','Automatische inhoud','2026-08-18T10:02:00Z','2026-08-18T10:02:00Z',false,true,false,false,'{"autoSubmitted":"auto-replied"}'),
      ('instantlycase-valid','martijn@softora.nl','instantly',311,'instantly:311','<instantly-valid@test>','','',
        'Instantlycase Geldig','instantlycase.valid@example.nl','martijn@softora.nl','Ander onderwerp','Geldig','Providerbewijs','2026-08-18T10:03:00Z','2026-08-18T10:03:00Z',false,true,false,false,
        '{"provider":"instantly","providerThreadId":"thread-valid","providerCampaignId":"campaign-valid","providerAccountEmail":"martijn@softora.nl","providerOwner":"martijn","direction":"received"}'),
      ('instantlycase-invalid','martijn@softora.nl','instantly',312,'instantly:312','<instantly-invalid@test>','','',
        'Instantlycase Ongeldig','instantlycase.invalid@example.nl','martijn@softora.nl','Ander onderwerp','Ongeldig','Geen campagne-id','2026-08-18T10:04:00Z','2026-08-18T10:04:00Z',false,true,false,false,
        '{"provider":"instantly","providerThreadId":"thread-invalid","providerAccountEmail":"martijn@softora.nl","providerOwner":"martijn","direction":"received"}'),
      ('ownerscope-martijn','martijn@softora.nl','inbox',313,'inbox:313','<ownerscope-martijn@test>','','',
        'Ownerscope Martijn','ownerscope.martijn@example.nl','martijn@softora.nl','Re: Kleine vraag over jullie website','Eigenaar','Martijn dossier','2026-08-18T10:05:00Z','2026-08-18T10:05:00Z',false,true,false,false,'{}'),
      ('ownerscope-serve','serve@softora.nl','inbox',314,'inbox:314','<ownerscope-serve@test>','','',
        'Ownerscope Serve','ownerscope.serve@example.nl','serve@softora.nl','Re: Kleine vraag over jullie website','Eigenaar','Serve dossier','2026-08-18T10:06:00Z','2026-08-18T10:06:00Z',false,true,false,false,'{}');

    insert into public.softora_mailbox_campaign_lineage_roots (message_key, account_email)
    values
      ('peter-root-one','martijn@softora.nl'),
      ('peter-root-two','martijn@softora.nl'),
      ('peter-root-three','martijn@softora.nl'),
      ('changed-root','martijn@softora.nl');
    insert into public.softora_mailbox_campaign_lineage_members (
      message_key, account_email, is_proven_automated
    ) values
      ('changed-lineage-reply','martijn@softora.nl',false),
      ('peter-strato-bounce','martijn@softora.nl',true),
      ('ownerscope-martijn','martijn@softora.nl',false),
      ('ownerscope-serve','serve@softora.nl',false);

    insert into public.softora_outbound_recipient_guards (
      guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,
      status,source,permanent
    ) values
      ('fixture:peter-root-one','email','peter.root.one@example.nl','softora','coldmail','martijn@softora.nl','peter.root.one@example.nl','sent','fixture',true),
      ('fixture:peter-root-two','email','peter.root.two@example.nl','softora','coldmail','martijn@softora.nl','peter.root.two@example.nl','sent','fixture',true),
      ('fixture:peter-root-three','email','peter.root.three@example.nl','softora','coldmail','martijn@softora.nl','peter.root.three@example.nl','sent','fixture',true),
      ('fixture:peter-brouwers','email','peter.brouwers@example.nl','softora','coldmail','martijn@softora.nl','peter.brouwers@example.nl','sent','fixture',true),
      ('fixture:peter-afspraak','email','peter.losbericht@example.nl','softora','coldmail','martijn@softora.nl','peter.losbericht@example.nl','sent','fixture',true),
      ('fixture:peter-bounce','email','peter.bounce@example.nl','softora','coldmail','martijn@softora.nl','peter.bounce@example.nl','sent','fixture',true),
      ('fixture:peter-linkedin','email','peter.linkedin@example.nl','softora','coldmail','martijn@softora.nl','peter.linkedin@example.nl','sent','fixture',true),
      ('fixture:changed','email','changed.contact@example.nl','softora','coldmail','martijn@softora.nl','changed.contact@example.nl','sent','fixture',true),
      ('fixture:autoflag','email','autoflag@example.nl','softora','coldmail','martijn@softora.nl','autoflag@example.nl','sent','fixture',true),
      ('fixture:instantly-valid','email','instantlycase.valid@example.nl','instantly','instantly','martijn@softora.nl','instantlycase.valid@example.nl','sent','fixture',true),
      ('fixture:instantly-invalid','email','instantlycase.invalid@example.nl','instantly','instantly','martijn@softora.nl','instantlycase.invalid@example.nl','sent','fixture',true),
      ('fixture:ownerscope-martijn','email','ownerscope.martijn@example.nl','softora','coldmail','martijn@softora.nl','ownerscope.martijn@example.nl','sent','fixture',true),
      ('fixture:ownerscope-serve','email','ownerscope.serve@example.nl','softora','coldmail','serve@softora.nl','ownerscope.serve@example.nl','sent','fixture',true);

    insert into public.softora_outbound_recipient_guards (
      guard_key,key_type,key_value,provider,channel,sender_email,recipient_email,
      status,source,permanent,payload
    ) values (
      'fixture:peter-bridge','email','peter.bridge@example.nl','softora','coldmail',
      'martijn@softora.nl','peter.bridge@example.nl','sent','fixture',true,
      '{"events":[{"messageId":"<peter-bridge-root@test>"}]}'
    );

    insert into public.softora_mailbox_send_provenance (
      intent_id,idempotency_key,owner,account_email,recipient_email,mode,
      provider,sent_message_id,sender_name,subject,body_text,status,accepted_at
    ) values (
      'search-fallback','search-fallback','martijn','martijn@softora.nl',
      'provenance.contact@example.nl','reply','smtp','<search-fallback@test>',
      'Martijn van de Ven','Volledig ander onderwerp','provenancezoekwoord voor Sent-sync',
      'accepted','2026-08-18T11:00:00Z'
    );
  `);

  const peterResults = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'peter', 20, 0
    )
  `);
  assert.equal(peterResults.rows.length, 5);
  assert.ok(peterResults.rows.every((row) => Number(row.total_count) === 5));
  assert.deepEqual(
    peterResults.rows.map((row) => row.external_contact_email).sort(),
    [
      'peter.bridge@example.nl',
      'peter.root.one@example.nl',
      'peter.root.three@example.nl',
      'peter.root.two@example.nl',
      'psonnemans@ziggo.nl',
    ]
  );
  assert.ok(peterResults.rows.every((row) => row.canonical_owner === 'martijn'));
  assert.ok(!peterResults.rows.some((row) => row.message_key === 'peter-brouwers'));

  const fallbackSearch = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'provenancezoekwoord', 20, 0
    )
  `);
  assert.deepEqual(fallbackSearch.rows.map((row) => row.message_key), [
    'accepted-send|search-fallback',
  ]);
  assert.equal(fallbackSearch.rows[0].payload.timelineSource, 'send-provenance');

  await database.exec(`
    insert into public.softora_mailbox_messages (
      message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,
      sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,
      body_truncated,has_body,unread,starred,payload
    ) values (
      'search-fallback-imap','martijn@softora.nl','sent',316,'sent:316',
      '<SEARCH-FALLBACK@test>','','','Martijn van de Ven','martijn@softora.nl',
      'provenance.contact@example.nl','Volledig ander onderwerp','provenancezoekwoord',
      'provenancezoekwoord uit echte IMAP Sent','2026-08-18T11:00:00Z',
      '2026-08-18T11:00:00Z',false,true,false,false,'{}'
    );
  `);
  const indexedFallbackSearch = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'provenancezoekwoord', 20, 0
    )
  `);
  assert.deepEqual(indexedFallbackSearch.rows.map((row) => row.message_key), [
    'search-fallback-imap',
  ]);

  const peterFirstPage = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'peter', 2, 0
    )
  `);
  const peterSecondPage = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'peter', 2, 2
    )
  `);
  const peterThirdPage = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'peter', 2, 4
    )
  `);
  assert.equal(peterFirstPage.rows.length, 2);
  assert.equal(peterSecondPage.rows.length, 2);
  assert.equal(peterThirdPage.rows.length, 1);
  assert.ok([...peterFirstPage.rows, ...peterSecondPage.rows, ...peterThirdPage.rows]
    .every((row) => Number(row.total_count) === 5));
  assert.equal(new Set([
    ...peterFirstPage.rows,
    ...peterSecondPage.rows,
    ...peterThirdPage.rows,
  ].map((row) => row.external_contact_email)).size, 5);

  const renamedLineage = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'hernoemdzoekwoord', 20, 0
    )
  `);
  assert.deepEqual(renamedLineage.rows.map((row) => row.message_key), ['changed-lineage-reply']);
  assert.equal(renamedLineage.rows[0].subject, 'Volledig ander onderwerp');

  const automated = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'autoflag', 20, 0
    )
  `);
  assert.equal(automated.rows.length, 0);

  const instantly = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'instantlycase', 20, 0
    )
  `);
  assert.deepEqual(instantly.rows.map((row) => row.message_key), ['instantlycase-valid']);

  const ownerScopes = [];
  for (const owner of ['martijn', 'serve']) {
    const account = owner === 'martijn' ? 'martijn@softora.nl' : 'serve@softora.nl';
    const result = await database.query(`
      select * from public.softora_search_mailbox_contact_dossiers(
        $1::jsonb, 'ownerscope', 20, 0
      )
    `, [JSON.stringify({ [owner]: [account] })]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].canonical_owner, owner);
    ownerScopes.push(result.rows[0].external_contact_email);
  }
  assert.deepEqual(ownerScopes.sort(), [
    'ownerscope.martijn@example.nl',
    'ownerscope.serve@example.nl',
  ]);
  const bothOwners = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"],"serve":["serve@softora.nl"]}'::jsonb,
      'ownerscope', 20, 0
    )
  `);
  assert.equal(bothOwners.rows.length, 2);
  assert.deepEqual(
    bothOwners.rows.map((row) => row.canonical_owner).sort(),
    ['martijn', 'serve']
  );

  const martijnTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],'psonnemans@ziggo.nl',50,0)"
  );
  assert.equal(martijnTimeline.rows.length, 2);
  assert.equal(Number(martijnTimeline.rows[0].total_count), 2);
  assert.equal(new Set(martijnTimeline.rows.map((row) => row.technical_thread_key)).size, 1);
  assert.ok(martijnTimeline.rows.every((row) => row.external_contact_email === 'psonnemans@ziggo.nl'));
  assert.ok(martijnTimeline.rows.every((row) => row.sender_email !== 'ander@ziggo.nl'));

  const bothTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl','serve@softora.nl'],'psonnemans@ziggo.nl',50,0)"
  );
  assert.equal(bothTimeline.rows.length, 2);
  assert.ok(!martijnTimeline.rows.some((row) => /afspraak/i.test(row.subject)));
  const search = await database.query(
    "select * from public.softora_search_mailbox_messages(array['martijn@softora.nl'],'afspraak',20,0)"
  );
  assert.equal(search.rows.length, 1);
  assert.equal(search.rows[0].subject, 'Re: afspraak 17/8');
  const accentSearch = await database.query(
    "select * from public.softora_search_mailbox_messages(array['martijn@softora.nl'],'creme',20,0)"
  );
  assert.equal(accentSearch.rows.length, 1);
  assert.match(accentSearch.rows[0].match_snippet, /Crème/);
  const boundarySearch = await database.query(
    "select * from public.softora_search_mailbox_messages(array['martijn@softora.nl'],'eric',20,0)"
  );
  assert.equal(boundarySearch.rows.length, 0);
  await database.query(`
    insert into public.softora_mailbox_messages (
      message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,references_text,
      sender_name,sender_email,recipients_text,subject,preview,body_text,date,internal_date,
      body_truncated,has_body,unread,starred,payload
    ) values (
      'eric-outreach','martijn@softora.nl','coldmail',9,'coldmail:9','<eric@test>','','',
      'Eric de Boer','eric@outreach.example','martijn@softora.nl','Los onderwerp',
      'Echte Eric','Dit bericht hoort bij Eric','2026-08-17T09:00:00Z','2026-08-17T09:00:00Z',
      false,true,false,false,'{"source":"imap-sync","provider":"imap"}'::jsonb
    )
  `);
  const exactEricSearch = await database.query(
    "select * from public.softora_search_mailbox_messages(array['martijn@softora.nl'],'eric',20,0)"
  );
  assert.equal(exactEricSearch.rows.length, 1);
  assert.equal(exactEricSearch.rows[0].sender_email, 'eric@outreach.example');
  const tessaDossiers = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'tessa', 20, 0
    )
  `);
  assert.equal(tessaDossiers.rows.length, 3);
  assert.equal(Number(tessaDossiers.rows[0].total_count), 3);
  assert.deepEqual(
    tessaDossiers.rows.map((row) => row.external_contact_email).sort(),
    ['communicatie@schakel-nu.nl', 'mensink9@planet.nl', 'tessa.van.dongen@gele-ster.nl']
  );
  assert.ok(tessaDossiers.rows.every((row) => row.canonical_owner === 'martijn'));
  const tessaPage = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"martijn":["martijn@softora.nl"]}'::jsonb, 'tessa', 2, 0
    )
  `);
  assert.equal(tessaPage.rows.length, 2);
  assert.ok(tessaPage.rows.every((row) => Number(row.total_count) === 3));
  const tessaBothOwners = await database.query(`
    select * from public.softora_search_mailbox_contact_dossiers(
      '{"serve":["serve@softora.nl"],"martijn":["martijn@softora.nl"]}'::jsonb,
      'tessa', 20, 0
    )
  `);
  assert.equal(tessaBothOwners.rows.length, 4);
  assert.deepEqual(
    tessaBothOwners.rows
      .filter((row) => row.external_contact_email === 'communicatie@schakel-nu.nl')
      .map((row) => row.canonical_owner)
      .sort(),
    ['martijn', 'serve']
  );
  const tessaTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],'communicatie@schakel-nu.nl',50,0)"
  );
  assert.equal(tessaTimeline.rows.length, 7);
  assert.equal(new Set(tessaTimeline.rows.map((row) => row.technical_thread_key)).size, 3);
  const excludedTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],'ander@ziggo.nl',50,0)"
  );
  assert.equal(excludedTimeline.rows.length, 0);

  await database.exec(`
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id, payload
    ) values
      ('serve-logical-coldmail','serve@softora.nl','coldmail',101,'coldmail:101','<Logical-Copy@Test>','{}'),
      ('serve-logical-inbox','serve@softora.nl','inbox',102,'inbox:102','logical-copy@test','{}'),
      ('serve-logical-allmail','serve@softora.nl','allmail',103,'allmail:103','<logical-copy@test>','{}'),
      ('martijn-logical-inbox','martijn@softora.nl','inbox',101,'inbox:101','<logical-copy@test>','{}'),
      ('serve-empty-coldmail','serve@softora.nl','coldmail',201,'coldmail:201','','{}'),
      ('serve-empty-allmail','serve@softora.nl','allmail',202,'allmail:202','','{}');
  `);
  const hiddenCopies = await database.query(`
    select * from public.softora_set_mailbox_message_visibility(
      'serve@softora.nl', 'coldmail', 101, 'coldmail:101', true
    )
  `);
  assert.deepEqual(
    hiddenCopies.rows.map((row) => row.folder).sort(),
    ['allmail', 'coldmail', 'inbox']
  );
  const hiddenState = await database.query(`
    select account_email, folder, deleted_at
    from public.softora_mailbox_messages
    where message_key like '%logical-%'
    order by account_email, folder
  `);
  assert.ok(hiddenState.rows
    .filter((row) => row.account_email === 'serve@softora.nl')
    .every((row) => row.deleted_at));
  assert.equal(hiddenState.rows
    .find((row) => row.account_email === 'martijn@softora.nl').deleted_at, null);
  const tombstones = await database.query(`
    select * from public.softora_mailbox_message_tombstones
    where account_email = 'serve@softora.nl'
      and normalized_message_id = 'logical-copy@test'
  `);
  assert.equal(tombstones.rows.length, 1);
  assert.equal(tombstones.rows[0].normalized_message_id, 'logical-copy@test');

  await database.exec(`
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id, payload
    ) values (
      'serve-logical-later','serve@softora.nl','inbox',104,'inbox:104',
      '<LOGICAL-COPY@TEST>','{}'
    );
    update public.softora_mailbox_messages
    set deleted_at = null
    where message_key = 'serve-logical-allmail';
  `);
  const inheritedState = await database.query(`
    select message_key, deleted_at
    from public.softora_mailbox_messages
    where message_key in ('serve-logical-later', 'serve-logical-allmail')
    order by message_key
  `);
  assert.ok(inheritedState.rows.every((row) => row.deleted_at));

  const restoredCopies = await database.query(`
    select * from public.softora_set_mailbox_message_visibility(
      'serve@softora.nl', 'inbox', 102, 'inbox:102', false
    )
  `);
  assert.equal(restoredCopies.rows.length, 4);
  const restoredState = await database.query(`
    select deleted_at from public.softora_mailbox_messages
    where account_email = 'serve@softora.nl'
      and public.softora_normalize_mailbox_message_id(message_id) = 'logical-copy@test'
  `);
  assert.ok(restoredState.rows.every((row) => row.deleted_at === null));
  assert.equal((await database.query(`
    select count(*)::integer as count
    from public.softora_mailbox_message_tombstones
    where account_email = 'serve@softora.nl'
      and normalized_message_id = 'logical-copy@test'
  `)).rows[0].count, 0);

  const hiddenEmpty = await database.query(`
    select * from public.softora_set_mailbox_message_visibility(
      'serve@softora.nl', 'coldmail', 201, 'coldmail:201', true
    )
  `);
  assert.equal(hiddenEmpty.rows.length, 1);
  const emptyState = await database.query(`
    select folder, deleted_at from public.softora_mailbox_messages
    where message_key in ('serve-empty-coldmail', 'serve-empty-allmail')
    order by folder
  `);
  assert.equal(emptyState.rows.find((row) => row.folder === 'coldmail').deleted_at !== null, true);
  assert.equal(emptyState.rows.find((row) => row.folder === 'allmail').deleted_at, null);
  await database.close();
});

test('SQL-contract houdt discovery service-role-only, bounded en op de volledige body-index', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  const performanceSource = fs.readFileSync(performanceMigrationPath, 'utf8');
  const outreachSource = fs.readFileSync(outreachScopeMigrationPath, 'utf8');
  const queryPlanSource = fs.readFileSync(outreachQueryPlanMigrationPath, 'utf8');
  const eligibilitySetSource = fs.readFileSync(outreachEligibilitySetMigrationPath, 'utf8');
  const narrowPlanSource = fs.readFileSync(outreachNarrowPlanMigrationPath, 'utf8');
  const scoreOnceSource = fs.readFileSync(outreachScoreOnceMigrationPath, 'utf8');
  const contactDossierSource = fs.readFileSync(contactDossierMigrationPath, 'utf8');
  const acceptedTimelineSource = fs.readFileSync(acceptedTimelineMigrationPath, 'utf8');
  const campaignProvenanceSource = fs.readFileSync(campaignProvenanceMigrationPath, 'utf8');
  assert.match(source, /using gin[\s\S]*extensions\.gin_trgm_ops/);
  assert.match(source, /body_text/);
  assert.match(source, /generation_superseded_at is null/);
  assert.match(source, /least\(40/);
  assert.match(source, /least\(50/);
  assert.match(source, /revoke all on function public\.softora_search_mailbox_messages[\s\S]*from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.softora_mailbox_contact_timeline[\s\S]*to service_role/);
  assert.doesNotMatch(source, /grant execute[\s\S]*to authenticated/);
  assert.match(performanceSource, /search_document text generated always as/);
  assert.match(performanceSource, /using gin \(search_document extensions\.gin_trgm_ops\)/);
  assert.match(performanceSource, /matched_keys as materialized/);
  assert.match(performanceSource, /unique_messages as materialized/);
  assert.match(performanceSource, /thread_matches as materialized/);
  assert.match(performanceSource, /from paged[\s\S]*join public\.softora_mailbox_messages/);
  assert.doesNotMatch(performanceSource, /grant execute[\s\S]*to authenticated/);
  assert.match(outreachSource, /softora_mailbox_is_outreach_contact/);
  assert.match(outreachSource, /softora_filter_mailbox_outreach_contacts/);
  assert.match(outreachSource, /softora_mailbox_search_word_prefix/);
  assert.match(outreachSource, /guard\.key_type = 'email'/);
  assert.match(outreachSource, /participant <> all\(p_account_emails\)/);
  assert.doesNotMatch(outreachSource, /recipient_domain\s*=/);
  assert.doesNotMatch(outreachSource, /grant execute[\s\S]*to authenticated/);
  assert.match(queryPlanSource, /softora_mailbox_messages_participants_active_idx/);
  assert.match(queryPlanSource, /@> array\[p\.contact_email\]/);
  assert.match(queryPlanSource, /m\.search_document ~ \(/);
  assert.match(queryPlanSource, /\[\^a-z0-9\]\+/);
  assert.doesNotMatch(queryPlanSource, /recipient_domain\s*=/);
  assert.doesNotMatch(queryPlanSource, /grant execute[\s\S]*to authenticated/);
  assert.match(eligibilitySetSource, /softora_mailbox_outreach_contacts/);
  assert.match(eligibilitySetSource, /eligible_contacts as materialized/);
  assert.match(eligibilitySetSource, /expanded as materialized/);
  assert.match(eligibilitySetSource, /join eligible_contacts using \(contact_email\)/);
  assert.doesNotMatch(eligibilitySetSource, /recipient_domain\s*=/);
  assert.doesNotMatch(eligibilitySetSource, /grant execute[\s\S]*to authenticated/);
  assert.match(narrowPlanSource, /candidates as materialized/);
  assert.match(narrowPlanSource, /select\s+m\.message_key,/);
  assert.match(narrowPlanSource, /paged as materialized/);
  assert.match(narrowPlanSource, /from paged[\s\S]*join public\.softora_mailbox_messages/);
  assert.doesNotMatch(narrowPlanSource, /select\s+m\.\*,[\s\S]*candidates as materialized/);
  assert.doesNotMatch(narrowPlanSource, /grant execute[\s\S]*to authenticated/);
  assert.match(scoreOnceSource, /scored as materialized/);
  assert.match(scoreOnceSource, /eligible\.sender_email/);
  assert.match(scoreOnceSource, /from paged[\s\S]*join public\.softora_mailbox_messages/);
  assert.doesNotMatch(scoreOnceSource, /candidates as materialized \(\s*select\s+m\.\*,/);
  assert.doesNotMatch(scoreOnceSource, /grant execute[\s\S]*to authenticated/);
  assert.match(contactDossierSource, /distinct on \(\s*eligible_matches\.canonical_owner,\s*eligible_matches\.contact_email\s*\)/);
  assert.match(contactDossierSource, /canonical_owner text/);
  assert.match(contactDossierSource, /p_owner_accounts jsonb/);
  assert.match(contactDossierSource, /revoke all on function public\.softora_search_mailbox_contact_dossiers[\s\S]*from public, anon, authenticated/);
  assert.match(contactDossierSource, /alter table public\.softora_mailbox_message_tombstones enable row level security/);
  assert.match(contactDossierSource, /Deliberately do not backfill tombstones from historical deleted_at rows/);
  assert.doesNotMatch(contactDossierSource, /from public\.softora_mailbox_messages messages[\s\S]*messages\.deleted_at is not null[\s\S]*softora_normalize_mailbox_message_id\(messages\.message_id\) <> ''/);
  assert.doesNotMatch(contactDossierSource, /update public\.softora_mailbox_messages as messages[\s\S]*from public\.softora_mailbox_message_tombstones tombstone/);
  assert.match(contactDossierSource, /before insert or update of account_email, message_id, deleted_at/);
  assert.match(contactDossierSource, /tg_op = 'UPDATE'[\s\S]*old\.deleted_at is null[\s\S]*new\.deleted_at is not null/);
  assert.match(contactDossierSource, /if tg_op = 'INSERT' then[\s\S]*pg_advisory_xact_lock[\s\S]*end if;[\s\S]*select tombstone\.deleted_at/);
  assert.match(contactDossierSource, /softora_set_mailbox_message_visibility[\s\S]*security invoker/);
  assert.match(contactDossierSource, /softora_set_mailbox_message_visibility[\s\S]*softora_mailbox_campaign_consistency[\s\S]*for update;[\s\S]*select m\.\*[\s\S]*limit 1;[\s\S]*pg_advisory_xact_lock[\s\S]*select m\.\*[\s\S]*for update;/);
  assert.match(contactDossierSource, /where pg_catalog\.lower\(pg_catalog\.btrim\(m\.account_email\)\) = v_account_email[\s\S]*softora_normalize_mailbox_message_id\(m\.message_id\) = v_message_id/);
  assert.doesNotMatch(contactDossierSource, /grant execute[\s\S]*to authenticated/);
  assert.match(campaignProvenanceSource, /softora_mailbox_message_has_campaign_proof/);
  assert.match(campaignProvenanceSource, /provenance_candidates as materialized/);
  assert.match(campaignProvenanceSource, /timelineSource', 'send-provenance'/);
  assert.match(campaignProvenanceSource, /row_number\(\) over[\s\S]*source_rank/);
  assert.doesNotMatch(campaignProvenanceSource, /kleine vraag over jullie website|nieuw webdesign/);
  assert.match(acceptedTimelineSource, /softora_has_proven_automated_reply\(params\.payload\)/);
  assert.match(acceptedTimelineSource, /softora_mailbox_campaign_lineage_roots root/);
  assert.match(acceptedTimelineSource, /softora_mailbox_campaign_lineage_members member/);
  assert.match(acceptedTimelineSource, /originalCampaignOutbound/);
  assert.match(acceptedTimelineSource, /providerCampaignId/);
  assert.match(acceptedTimelineSource, /mailer-daemon\|postmaster/);
  assert.match(acceptedTimelineSource, /linkedin\[\.\]com/);
  assert.match(acceptedTimelineSource, /strato\[\.\]\(nl\|de\|com\)/);
  assert.match(acceptedTimelineSource, /physical_candidates as materialized[\s\S]*softora_mailbox_message_has_campaign_proof/);
  assert.match(campaignProvenanceSource, /contact_matches\.\*, pg_catalog\.count\(\*\) over \(\) as result_count/);
  assert.match(campaignProvenanceSource, /least\(40/);
  assert.match(campaignProvenanceSource, /least\(5000/);
  assert.match(campaignProvenanceSource, /revoke all on function public\.softora_search_mailbox_contact_dossiers[\s\S]*from public, anon, authenticated/);
  assert.match(campaignProvenanceSource, /grant execute on function public\.softora_search_mailbox_contact_dossiers[\s\S]*to service_role/);
  assert.doesNotMatch(campaignProvenanceSource, /grant execute[\s\S]*to authenticated/);
});
