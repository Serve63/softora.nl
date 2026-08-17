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

test('contacttijdlijn laat alleen berichten met exact bewezen alias en externe identiteit toe', () => {
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
    accountEmails: ['martijn@softora.nl', 'martijnvandeven@softora.nl', 'serve290@gmail.com'],
  });

  assert.deepEqual(root.threadMessages.map((message) => message.id), ['inbox:correct', 'sent:serve-alias']);
  assert.equal(root.contactTimelineRejectedCount, 1);
  assert.equal(root.contactTimelineTotal, 3);
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
      intent_id text primary key, account_email text, recipient_email text,
      provider text, status text, accepted_at timestamptz
    );
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

  const martijnTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],'psonnemans@ziggo.nl',50,0)"
  );
  assert.equal(martijnTimeline.rows.length, 4);
  assert.equal(Number(martijnTimeline.rows[0].total_count), 4);
  assert.equal(new Set(martijnTimeline.rows.map((row) => row.technical_thread_key)).size, 2);
  assert.ok(martijnTimeline.rows.every((row) => row.external_contact_email === 'psonnemans@ziggo.nl'));
  assert.ok(martijnTimeline.rows.every((row) => row.sender_email !== 'ander@ziggo.nl'));

  const bothTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl','serve@softora.nl'],'psonnemans@ziggo.nl',50,0)"
  );
  assert.equal(bothTimeline.rows.length, 5);
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
  const excludedTimeline = await database.query(
    "select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],'ander@ziggo.nl',50,0)"
  );
  assert.equal(excludedTimeline.rows.length, 0);
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
});
