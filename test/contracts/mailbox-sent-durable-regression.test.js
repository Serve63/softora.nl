const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const { createColdmailSendProvenance } = require('../../server/services/coldmail-send-provenance');
const {
  attachSentThreadMessages,
  buildAcceptedProvenanceMessage,
} = require('../../server/services/mailbox-campaign-replies');
const { createMailboxDiscoveryRepository } = require('../../server/repositories/mailbox-discovery');

const atomicVisibilityMigration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260820174711_mailbox_contact_atomic_visibility.sql'
), 'utf8');
const acceptedTimelineMigration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260824120230_mailbox_contact_timeline_send_provenance.sql'
), 'utf8');

async function createTimelineDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.softora_mailbox_campaign_consistency (
      scope text primary key,
      content_version bigint not null default 0,
      updated_at timestamptz not null default now()
    );
    insert into public.softora_mailbox_campaign_consistency (scope, content_version)
    values ('campaign', 0);

    create table public.softora_mailbox_messages (
      message_key text primary key,
      account_email text not null,
      folder text not null,
      uid bigint not null default 0,
      provider_id text not null,
      message_id text,
      in_reply_to text,
      references_text text,
      sender_name text,
      sender_email text,
      recipients_text text,
      subject text,
      preview text,
      body_text text,
      date timestamptz,
      internal_date timestamptz,
      unread boolean not null default false,
      softora_read_at timestamptz,
      state_revision bigint not null default 0,
      state_mutation_key text,
      state_mutation_at timestamptz,
      starred boolean not null default false,
      reply_dismissed_at timestamptz,
      has_body boolean not null default true,
      body_truncated boolean not null default false,
      payload jsonb not null default '{}'::jsonb,
      search_document text not null default '',
      deleted_at timestamptz,
      generation_superseded_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table public.softora_mailbox_message_tombstones (
      account_email text not null,
      normalized_message_id text not null,
      deleted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (account_email, normalized_message_id)
    );

    create table public.softora_mailbox_send_provenance (
      intent_id text primary key,
      idempotency_key text not null unique,
      owner text not null,
      account_email text not null,
      recipient_email text not null,
      mode text not null,
      conversation_id text,
      reply_target_message_id text,
      references_text text,
      provider text not null default 'smtp',
      provider_thread_id text,
      provider_message_id text,
      sent_message_id text,
      sender_name text,
      subject text not null,
      body_text text not null default '',
      cc_text text,
      bcc_text text,
      status text not null default 'prepared',
      error_text text,
      accepted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.softora_outbound_recipient_guards (
      guard_key text primary key, key_type text, key_value text,
      provider text, channel text, sender_email text, recipient_email text,
      status text, permanent boolean not null default false,
      payload jsonb not null default '{}'::jsonb
    );
    create table public.softora_mailbox_campaign_lineage_roots (
      message_key text primary key, account_email text not null
    );
    create table public.softora_mailbox_campaign_lineage_members (
      message_key text primary key, account_email text not null,
      is_proven_automated boolean not null default false
    );

    create or replace function public.softora_mailbox_search_normalize(p_value text)
    returns text language sql immutable security invoker set search_path = '' as $function$
      select pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')));
    $function$;

    create or replace function public.softora_has_proven_automated_reply(p_payload jsonb)
    returns boolean language sql immutable security invoker set search_path = '' as $function$
      select pg_catalog.lower(pg_catalog.btrim(coalesce(
        coalesce(p_payload, '{}'::jsonb)->>'autoSubmitted', ''
      ))) not in ('', 'no');
    $function$;

    create or replace function public.softora_normalize_mailbox_message_id(p_value text)
    returns text language sql immutable security invoker set search_path = '' as $function$
      select nullif(pg_catalog.lower(pg_catalog.btrim(pg_catalog.btrim(coalesce(p_value, ''), '<>'))), '');
    $function$;

    create or replace function public.softora_mailbox_message_participants(
      p_sender_email text,
      p_recipients_text text,
      p_payload jsonb
    ) returns text[] language sql immutable security invoker set search_path = '' as $function$
      select array(
        select distinct participant
        from pg_catalog.unnest(array[
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email, ''))),
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_recipients_text, '')))
        ]) participant
        where participant <> ''
      );
    $function$;

    create or replace function public.softora_mailbox_technical_thread_key(
      p_account_email text,
      p_provider_id text,
      p_message_id text,
      p_in_reply_to text,
      p_references_text text,
      p_payload jsonb
    ) returns text language sql immutable security invoker set search_path = '' as $function$
      select pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))) || '|' || coalesce(
        public.softora_normalize_mailbox_message_id(p_in_reply_to),
        public.softora_normalize_mailbox_message_id(p_message_id),
        pg_catalog.lower(pg_catalog.btrim(coalesce(p_provider_id, '')))
      );
    $function$;

    create or replace function public.softora_mailbox_is_outreach_contact(
      p_account_emails text[],
      p_contact_email text
    ) returns boolean language sql stable security invoker set search_path = '' as $function$
      select nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, ''))), '') is not null
        and pg_catalog.lower(pg_catalog.btrim(p_contact_email)) <> all(coalesce(p_account_emails, array[]::text[]));
    $function$;

    create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
    returns trigger language plpgsql volatile security invoker set search_path = '' as $function$
    begin
      insert into public.softora_mailbox_campaign_consistency (scope, content_version)
      values ('campaign', 0) on conflict (scope) do nothing;
      perform 1 from public.softora_mailbox_campaign_consistency
      where scope = 'campaign' for update;
      return null;
    end;
    $function$;
  `);
  await database.exec(atomicVisibilityMigration);
  await database.exec(acceptedTimelineMigration);
  return database;
}

async function insertPhysical(database, input) {
  await database.query(`
    insert into public.softora_mailbox_messages (
      message_key, account_email, folder, uid, provider_id, message_id,
      in_reply_to, references_text, sender_name, sender_email, recipients_text,
      subject, preview, body_text, date, internal_date, payload, search_document
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16::jsonb,$17)
  `, [
    input.key, input.accountEmail, input.folder, input.uid, input.providerId,
    input.messageId, input.inReplyTo || '', input.references || '', input.senderName || '',
    input.senderEmail, input.recipients, input.subject, input.preview || input.body,
    input.body, input.date, JSON.stringify(input.payload || { source: 'imap-sync' }),
    input.searchDocument,
  ]);
}

async function insertProvenance(database, input) {
  await database.query(`
    insert into public.softora_mailbox_send_provenance (
      intent_id, idempotency_key, owner, account_email, recipient_email, mode,
      conversation_id, reply_target_message_id, references_text, provider,
      provider_thread_id, provider_message_id, sent_message_id, sender_name,
      subject, body_text, cc_text, bcc_text, status, accepted_at
    ) values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  `, [
    input.intentId, input.owner, input.accountEmail, input.recipientEmail,
    input.mode || 'reply', input.conversationId || null, input.replyTargetMessageId || null,
    input.references || null, input.provider || 'smtp', input.providerThreadId || null,
    input.providerMessageId || null, input.messageId || null, input.senderName || null,
    input.subject, input.body || '', input.cc || null, input.bcc || null,
    input.status, input.acceptedAt || null,
  ]);
}

test('accepted-sendfallback blijft owner-exact, bodyvast, deduped, pagineerbaar en atomisch verbergbaar', async () => {
  const database = await createTimelineDatabase();
  const contactEmail = 'karin@madamvintage.example';
  const serveAccounts = ['serve@softora.nl', 'serve290@gmail.com'];
  try {
    await insertPhysical(database, {
      key: 'karin-in', accountEmail: 'serve@softora.nl', folder: 'inbox', uid: 41,
      providerId: 'inbox:41', messageId: '<karin-in@test>', senderName: 'Karin',
      senderEmail: contactEmail, recipients: 'serve@softora.nl', subject: 'Re: Kleine vraag over jullie website',
      body: 'Oude reactie van Karin', date: '2026-08-24T12:00:00Z', searchDocument: contactEmail,
    });
    await database.query(`
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, is_proven_automated
      ) values ('karin-in','serve@softora.nl',false)
    `);
    await insertPhysical(database, {
      key: 'karin-ordinary-appointment', accountEmail: 'serve@softora.nl',
      folder: 'inbox', uid: 40, providerId: 'inbox:40',
      messageId: '<karin-ordinary@test>', senderName: 'Karin',
      senderEmail: contactEmail, recipients: 'serve@softora.nl',
      subject: 'Losse afspraak', body: 'Dit hoort niet bij de campagne.',
      date: '2026-08-24T11:59:00Z', searchDocument: contactEmail,
    });
    await insertProvenance(database, {
      intentId: 'karin-accepted', owner: 'serve', accountEmail: 'serve290@gmail.com',
      recipientEmail: contactEmail, conversationId: 'karin-conversation',
      replyTargetMessageId: '<karin-in@test>', references: '<karin-in@test>',
      messageId: '<karin-answer@test>', senderName: 'Servé Creusen',
      subject: 'Re: Kleine vraag over jullie website', body: 'Exact antwoord om 13:51.',
      status: 'accepted', acceptedAt: '2026-08-24T13:51:00Z',
    });
    for (const status of ['prepared', 'unknown', 'failed']) {
      await insertProvenance(database, {
        intentId: `karin-${status}`, owner: 'serve', accountEmail: 'serve@softora.nl',
        recipientEmail: contactEmail, messageId: `<karin-${status}@test>`,
        subject: 'Niet zichtbaar', body: status, status,
        acceptedAt: status === 'prepared' ? null : '2026-08-24T13:52:00Z',
      });
    }
    await insertProvenance(database, {
      intentId: 'karin-martijn', owner: 'martijn', accountEmail: 'martijn@softora.nl',
      recipientEmail: contactEmail, messageId: '<karin-martijn@test>',
      subject: 'Martijn blijft apart', body: 'Andere eigenaar', status: 'accepted',
      acceptedAt: '2026-08-24T13:53:00Z',
    });
    await insertProvenance(database, {
      intentId: 'other-contact', owner: 'serve', accountEmail: 'serve@softora.nl',
      recipientEmail: 'ander@example.nl', messageId: '<other-contact@test>',
      subject: 'Ander contact', body: 'Niet in Karin', status: 'accepted',
      acceptedAt: '2026-08-24T13:54:00Z',
    });

    const fallbackTimeline = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,50,0)
    `, [serveAccounts, contactEmail]);
    assert.equal(fallbackTimeline.rows.length, 2);
    assert.ok(fallbackTimeline.rows.every((row) => Number(row.total_count) === 2));
    const fallback = fallbackTimeline.rows.find((row) => row.message_key === 'accepted-send|karin-accepted');
    assert.equal(fallback.payload.timelineBodyText, 'Exact antwoord om 13:51.');
    assert.equal(fallback.payload.providerOwner, 'serve');
    assert.equal(fallback.account_email, 'serve290@gmail.com');
    assert.ok(!fallbackTimeline.rows.some((row) => /prepared|unknown|failed|martijn/.test(row.message_key)));

    const firstPage = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,1,0)
    `, [serveAccounts, contactEmail]);
    const secondPage = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,1,1)
    `, [serveAccounts, contactEmail]);
    assert.equal(Number(firstPage.rows[0].total_count), 2);
    assert.equal(Number(secondPage.rows[0].total_count), 2);
    assert.notEqual(firstPage.rows[0].message_key, secondPage.rows[0].message_key);

    const martijnTimeline = await database.query(`
      select * from public.softora_mailbox_contact_timeline(array['martijn@softora.nl'],$1,50,0)
    `, [contactEmail]);
    assert.deepEqual(martijnTimeline.rows.map((row) => row.message_key), ['accepted-send|karin-martijn']);

    await database.query(`
      insert into public.softora_mailbox_message_tombstones (
        account_email, normalized_message_id, deleted_at, updated_at
      ) values ('serve290@gmail.com','karin-answer@test',now(),now())
    `);
    const tombstonedFallback = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,50,0)
    `, [serveAccounts, contactEmail]);
    assert.deepEqual(tombstonedFallback.rows.map((row) => row.message_key), ['karin-in']);
    await database.query(`
      delete from public.softora_mailbox_message_tombstones
      where normalized_message_id = 'karin-answer@test'
    `);

    await insertPhysical(database, {
      key: 'karin-out-imap', accountEmail: 'serve290@gmail.com', folder: 'sent', uid: 42,
      providerId: 'sent:42', messageId: '<KARIN-ANSWER@test>', inReplyTo: '<karin-in@test>',
      references: '<karin-in@test>', senderName: 'Servé Creusen', senderEmail: 'serve290@gmail.com',
      recipients: contactEmail, subject: 'Re: Kleine vraag over jullie website',
      body: 'Exact antwoord uit IMAP.', date: '2026-08-24T13:51:00Z', searchDocument: contactEmail,
    });
    const indexedTimeline = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,50,0)
    `, [serveAccounts, contactEmail]);
    assert.equal(indexedTimeline.rows.length, 2);
    assert.equal(Number(indexedTimeline.rows[0].total_count), 2);
    const winningCopy = indexedTimeline.rows.find((row) =>
      String(row.message_id).toLowerCase().includes('karin-answer@test'));
    assert.equal(winningCopy.message_key, 'karin-out-imap');
    assert.equal(winningCopy.payload.source, 'imap-sync');

    const hidden = await database.query(`
      select * from public.softora_set_mailbox_contact_visibility(
        $1::text[],$2,'serve@softora.nl','inbox',41,'inbox:41',2,true
      )
    `, [serveAccounts, contactEmail]);
    assert.equal(hidden.rows.length, 2);
    const hiddenTimeline = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,50,0)
    `, [serveAccounts, contactEmail]);
    assert.equal(hiddenTimeline.rows.length, 0);
    const tombstoneCount = await database.query(`
      select count(*)::integer as count from public.softora_mailbox_message_tombstones
      where account_email = any($1::text[])
        and normalized_message_id = any(array['karin-in@test','karin-answer@test'])
    `, [serveAccounts]);
    assert.equal(tombstoneCount.rows[0].count, 4);

    const restored = await database.query(`
      select * from public.softora_set_mailbox_contact_visibility(
        $1::text[],$2,'serve@softora.nl','inbox',41,'inbox:41',0,false
      )
    `, [serveAccounts, contactEmail]);
    assert.equal(restored.rows.length, 2);
    const restoredTimeline = await database.query(`
      select * from public.softora_mailbox_contact_timeline($1::text[],$2,50,0)
    `, [serveAccounts, contactEmail]);
    assert.equal(restoredTimeline.rows.length, 2);
    assert.equal((await database.query(`
      select deleted_at from public.softora_mailbox_messages
      where message_key = 'karin-ordinary-appointment'
    `)).rows[0].deleted_at, null);
    assert.equal((await database.query(`
      select count(*)::integer as count from public.softora_mailbox_message_tombstones
      where account_email = any($1::text[])
    `, [serveAccounts])).rows[0].count, 0);
  } finally {
    await database.close();
  }
});

test('alleen een geaccepteerde provenancewijziging verhoogt de campagneversie', async () => {
  const database = await createTimelineDatabase();
  try {
    const before = Number((await database.query(`
      select content_version from public.softora_mailbox_campaign_consistency where scope='campaign'
    `)).rows[0].content_version);
    await insertProvenance(database, {
      intentId: 'version-probe', owner: 'serve', accountEmail: 'serve@softora.nl',
      recipientEmail: 'probe@example.nl', messageId: null, subject: 'Probe',
      body: 'Exact', status: 'prepared', acceptedAt: null,
    });
    const prepared = Number((await database.query(`
      select content_version from public.softora_mailbox_campaign_consistency where scope='campaign'
    `)).rows[0].content_version);
    assert.equal(prepared, before);
    await database.query(`
      update public.softora_mailbox_send_provenance
      set status='accepted', sent_message_id='<version-probe@test>',
        accepted_at='2026-08-24T14:00:00Z'
      where intent_id='version-probe'
    `);
    const accepted = Number((await database.query(`
      select content_version from public.softora_mailbox_campaign_consistency where scope='campaign'
    `)).rows[0].content_version);
    assert.equal(accepted, before + 1);
  } finally {
    await database.close();
  }
});

test('contacttijdlijnrepository hydrateert de echte opgeslagen fallbackbody zonder guardtekst', async () => {
  const normalizationCalls = [];
  const repository = createMailboxDiscoveryRepository({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      rpc: async () => ({
        data: [{
          message_key: 'accepted-send|exact',
          total_count: 1,
          external_contact_email: 'karin@example.nl',
          payload: {
            timelineSource: 'send-provenance',
            timelineBodyText: 'De volledige echte verzonden tekst.',
          },
        }],
      }),
    }),
    normalizeMessageRow: (row, options) => {
      normalizationCalls.push({ row, options });
      return { id: row.message_key, body: options.includeBody ? row.body_text : '' };
    },
  });
  const result = await repository.contactTimeline({
    accountEmails: ['serve@softora.nl'], contactEmail: 'karin@example.nl', limit: 30, offset: 0,
  });
  assert.equal(result.messages[0].body, 'De volledige echte verzonden tekst.');
  assert.equal(result.messages[0].bodyLoaded, true);
  assert.equal(result.messages[0].localAcceptedSend, true);
  assert.equal(result.messages[0].timelineSynthetic, true);
  assert.equal(normalizationCalls[0].options.includeBody, true);
});

test('coldmailprovenance reserveert vóór dispatch en accepteert alleen exact SMTP-bewijs', async () => {
  const calls = [];
  let existing = null;
  const store = {
    async reserve(input) {
      calls.push(['reserve', input]);
      existing = {
        intentId: input.intentId,
        accountEmail: input.accountEmail,
        recipientEmail: input.recipientEmail,
        status: 'prepared',
        messageId: '',
      };
      return { created: true, intent: existing };
    },
    async startDispatch(intentId) { calls.push(['start', intentId]); },
    async findByIdempotencyKey() { return existing; },
    async accept(intentId, evidence) {
      calls.push(['accept', intentId, evidence]);
      existing = { ...existing, status: 'accepted', messageId: evidence.messageId };
      return existing;
    },
    async markUnknown(intentId, error, options) {
      calls.push(['unknown', intentId, error.code, options]);
    },
    async fail(intentId, error) { calls.push(['fail', intentId, error.message]); },
  };
  const provenance = createColdmailSendProvenance({
    store,
    getOwner: (accountEmail) => accountEmail === 'serve@softora.nl' ? 'serve' : '',
    getSenderName: () => 'Servé Creusen',
    logger: { error() {} },
  });
  const intent = await provenance.reserve({
    reservationId: 'reservation-41', accountEmail: 'SERVE@softora.nl',
    recipientEmail: 'KARIN@example.nl', subject: 'Kleine vraag',
    body: 'Volledige echte body', bcc: 'audit@example.nl',
  });
  assert.deepEqual(calls.map((call) => call[0]), ['reserve']);
  assert.equal(calls[0][1].owner, 'serve');
  assert.equal(calls[0][1].accountEmail, 'serve@softora.nl');
  assert.equal(calls[0][1].recipientEmail, 'karin@example.nl');
  assert.equal(calls[0][1].body, 'Volledige echte body');
  assert.equal(intent.intentId, 'coldmail:reservation-41');
  await provenance.startDispatch(intent);
  assert.equal(calls[1][0], 'start');

  await provenance.acceptEvidence({
    sendIntentId: intent.intentId, senderEmail: 'serve@softora.nl',
    recipientEmail: 'karin@example.nl', messageId: '<accepted@test>',
    sentAt: '2026-08-24T13:51:00Z',
  });
  assert.equal(calls[2][0], 'accept');
  await provenance.acceptEvidence({
    sendIntentId: intent.intentId, senderEmail: 'serve@softora.nl',
    recipientEmail: 'karin@example.nl', messageId: '<accepted@test>',
  });
  assert.equal(calls.filter((call) => call[0] === 'accept').length, 1);
  await assert.rejects(() => provenance.acceptEvidence({
    sendIntentId: intent.intentId, senderEmail: 'martijn@softora.nl',
    recipientEmail: 'karin@example.nl', messageId: '<accepted@test>',
  }), (error) => error?.code === 'COLDMAIL_SEND_PROVENANCE_MISMATCH');
  const ambiguousError = Object.assign(new Error('SMTP antwoord bleef uit'), { code: 'ETIMEDOUT' });
  const ambiguous = await provenance.fail(intent, ambiguousError, { providerDispatchStarted: true });
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.error.code, 'MAILBOX_SEND_RECONCILE_REQUIRED');
  assert.deepEqual(calls.at(-1), [
    'unknown', intent.intentId, 'ETIMEDOUT', { sentReconcileRequired: true },
  ]);
  assert.equal(calls.filter((call) => call[0] === 'fail').length, 0);
  await provenance.fail(intent, new Error('providerfout'));
  assert.equal(calls.at(-1)[0], 'fail');
});

test('accepted reply van 13:51 houdt een ouder Karin-gesprek na refresh bovenaan', () => {
  const karinInbound = {
    id: 'inbox:karin', mailboxId: 'inbox:karin', folder: 'inbox',
    accountEmail: 'serve@softora.nl', email: 'karin@madamvintage.example',
    to: 'serve@softora.nl', subject: 'Re: Kleine vraag over jullie website',
    body: 'Karin reageert', preview: 'Karin reageert', date: '2026-08-24T12:00:00Z',
    messageId: '<karin-in@test>', unread: false,
  };
  const newerInbound = {
    id: 'inbox:newer', mailboxId: 'inbox:newer', folder: 'inbox',
    accountEmail: 'serve@softora.nl', email: 'ander@example.nl',
    to: 'serve@softora.nl', subject: 'Re: Kleine vraag over jullie website',
    body: 'Later ontvangen', preview: 'Later ontvangen', date: '2026-08-24T13:00:00Z',
    messageId: '<newer-in@test>', unread: false,
  };
  const acceptedReply = buildAcceptedProvenanceMessage({
    intentId: 'karin-reply', owner: 'serve', accountEmail: 'serve@softora.nl',
    recipientEmail: 'karin@madamvintage.example', mode: 'reply',
    conversationId: 'karin-thread', replyTargetMessageId: '<karin-in@test>',
    references: '<karin-in@test>', messageId: '<karin-out@test>',
    senderName: 'Servé Creusen', subject: 'Re: Kleine vraag over jullie website',
    body: 'Antwoord om 13:51', acceptedAt: '2026-08-24T13:51:00Z', provider: 'smtp',
  });

  const conversations = attachSentThreadMessages(
    [karinInbound, newerInbound],
    [acceptedReply]
  );
  assert.equal(conversations[0].id, 'inbox:karin');
  assert.equal(Date.parse(conversations[0].latestInboundAt), Date.parse('2026-08-24T12:00:00Z'));
  assert.equal(Date.parse(conversations[0].latestOutboundAt), Date.parse('2026-08-24T13:51:00Z'));
  assert.equal(conversations[0].threadMessages[0].body, 'Antwoord om 13:51');
});
