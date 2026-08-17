const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const discoveryUi = require('../../assets/premium-mailbox-discovery');
const campaignInbox = require('../../assets/premium-mailbox-campaign-inbox');
const composeController = require('../../assets/premium-mailbox-compose-controller');
const { createMailboxDiscoveryService } = require('../../server/services/mailbox-discovery');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260817102256_mailbox_full_history_search.sql'
);

function createElement() {
  const listeners = {};
  return {
    value: '', hidden: false, textContent: '', dataset: {}, scrollTop: 0,
    addEventListener(type, handler) { listeners[type] = handler; },
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
  controller.clearSearch();
  assert.deepEqual(messages.map((message) => message.id), ['normal']);
  assert.equal(activeMail, 'normal');
  assert.equal(list.scrollTop, 86);
  assert.ok(rendered.length >= 2);
});

test('contactdossier rendert onderwerpgrenzen en reply gebruikt exact het gekozen bronbericht', () => {
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
  assert.equal((rendered.match(/mail-contact-thread-boundary/g) || []).length, 2);
  assert.match(rendered, /Los onderwerp/);
  assert.match(rendered, /Nieuw onderwerp/);
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
  `);
  let migration = fs.readFileSync(migrationPath, 'utf8');
  migration = migration.replace(
    /create index if not exists softora_mailbox_messages_full_history_search_idx[\s\S]*?generation_superseded_at is null;\n\n/,
    ''
  );
  await database.exec(migration);

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
  await database.close();
});

test('SQL-contract houdt discovery service-role-only, bounded en op de volledige body-index', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  assert.match(source, /using gin[\s\S]*extensions\.gin_trgm_ops/);
  assert.match(source, /body_text/);
  assert.match(source, /generation_superseded_at is null/);
  assert.match(source, /least\(40/);
  assert.match(source, /least\(50/);
  assert.match(source, /revoke all on function public\.softora_search_mailbox_messages[\s\S]*from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.softora_mailbox_contact_timeline[\s\S]*to service_role/);
  assert.doesNotMatch(source, /grant execute[\s\S]*to authenticated/);
});
