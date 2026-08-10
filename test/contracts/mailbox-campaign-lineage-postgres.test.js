'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260810152657_mailbox_campaign_lineage_index.sql'
);
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

const baseSchemaSql = `
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.softora_mailbox_messages (
    message_key text primary key,
    account_email text not null,
    folder text not null,
    uid bigint not null,
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
    body_truncated boolean not null default false,
    has_body boolean not null default false,
    date timestamptz not null,
    internal_date timestamptz,
    unread boolean not null default false,
    softora_read_at timestamptz,
    starred boolean not null default false,
    reply_dismissed_at timestamptz,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (account_email, folder, uid)
  );
`;

async function createBaseDatabase() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(baseSchemaSql);
  return db;
}

async function applyMigration(db) {
  await db.exec('begin');
  await db.exec(migrationSql);
  await db.exec('commit');
}

async function readLineage(db, accountEmail) {
  return db.query(`
    select *
    from public.softora_find_mailbox_campaign_lineage(
      $1::text[], 200, 20, 9000, 2500,
      null, null, null, null
    )
  `, [[accountEmail]]);
}

test('real PostgreSQL executes bounded lineage across scale, deep context, reconnect and feed masks', {
  timeout: 60_000,
}, async () => {
  const db = await createBaseDatabase();
  try {
    await applyMigration(db);
    await db.exec(`
      alter table public.softora_mailbox_messages
        disable trigger softora_refresh_mailbox_message_lineage;

      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:scale-root', 'serve@softora.nl', 'sent', 1, 'sent:scale-root',
        '<scale-root@softora.test>', 'serve@softora.nl', 'lead@example.test',
        'Kleine vraag over jullie website', '2026-08-01T08:00:00Z',
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      );
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id, in_reply_to,
        references_text, sender_email, recipients_text, subject, date, payload
      )
      select
        'inbox:scale-' || item::text,
        'serve@softora.nl',
        'inbox',
        item + 1,
        'inbox:scale-' || item::text,
        '<scale-' || item::text || '@example.test>',
        '<scale-root@softora.test>',
        '<scale-root@softora.test>',
        'lead-' || item::text || '@example.test',
        'serve@softora.nl',
        'Re: Kleine vraag over jullie website',
        '2026-08-01T09:00:00Z'::timestamptz + make_interval(secs => item),
        '{}'::jsonb
      from generate_series(1, 4501) as item;
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id, in_reply_to,
        references_text, sender_email, recipients_text, subject, date, created_at, payload
      ) values (
        'inbox:late-old-child', 'serve@softora.nl', 'inbox', 7000,
        'inbox:late-old-child', '<late-old-child@example.test>', '<late-root@softora.test>',
        '<late-root@softora.test>', 'late@example.test', 'serve@softora.nl',
        'Volledig gewijzigd onderwerp', '2026-05-10T08:00:00Z',
        '2026-05-10T08:01:00Z', '{}'::jsonb
      );
      insert into public.softora_mailbox_message_lineage_edges (
        account_email, child_message_key, child_message_id, parent_message_id
      ) values (
        'serve@softora.nl', 'inbox:late-old-child', 'late-old-child@example.test',
        'late-root@softora.test'
      );
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      ) values (
        'sent:scale-root', 'sent:scale-root', 'serve@softora.nl',
        '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z'
      );
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      ) values (
        'sent:scale-root', 'serve@softora.nl', 'scale-root@softora.test', null,
        'sent:scale-root', 'scale-root@softora.test', 0, '2026-08-01T08:00:00Z',
        false, false, '2026-08-01T08:00:00Z'
      );
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      )
      select
        'inbox:scale-' || item::text, 'sent:scale-root', 'serve@softora.nl',
        '2026-08-01T09:00:00Z'::timestamptz + make_interval(secs => item),
        '2026-08-01T09:00:00Z'::timestamptz + make_interval(secs => item)
      from generate_series(1, 4501) as item;
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      )
      select
        'inbox:scale-' || item::text, 'serve@softora.nl',
        'scale-' || item::text || '@example.test', 'sent:scale-root', 'sent:scale-root',
        'scale-root@softora.test', 1,
        '2026-08-01T09:00:00Z'::timestamptz + make_interval(secs => item),
        true, false,
        '2026-08-01T09:00:00Z'::timestamptz + make_interval(secs => item)
      from generate_series(1, 4501) as item;

      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:deep-root', 'martijn@softora.nl', 'sent', 1, 'sent:deep-root',
        '<deep-root@softora.test>', 'martijn@softora.nl', 'deep@example.test',
        'Kleine vraag over jullie website', '2026-08-02T08:00:00Z',
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      );
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id, in_reply_to,
        references_text, sender_email, recipients_text, subject, date, payload
      )
      select
        'deep:' || depth::text,
        'martijn@softora.nl',
        case when depth = 27 then 'inbox' else 'sent' end,
        depth + 1,
        'deep:' || depth::text,
        '<deep-' || depth::text || '@softora.test>',
        case when depth = 1 then '<deep-root@softora.test>' else '<deep-' || (depth - 1)::text || '@softora.test>' end,
        '<deep-root@softora.test>',
        case when depth = 27 then 'deep@example.test' else 'martijn@softora.nl' end,
        case when depth = 27 then 'martijn@softora.nl' else 'deep@example.test' end,
        'Exact deep thread',
        '2026-08-02T08:00:00Z'::timestamptz + make_interval(secs => depth),
        case when depth = 27 then '{"direction":"received"}'::jsonb else '{"direction":"sent"}'::jsonb end
      from generate_series(1, 28) as depth;
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      ) values (
        'sent:deep-root', 'sent:deep-root', 'martijn@softora.nl', now(), now()
      );
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      ) values (
        'sent:deep-root', 'martijn@softora.nl', 'deep-root@softora.test', null,
        'sent:deep-root', 'deep-root@softora.test', 0, '2026-08-02T08:00:00Z',
        false, false, now()
      );
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      ) select 'deep:' || depth::text, 'sent:deep-root', 'martijn@softora.nl', now(), now()
        from generate_series(1, 28) as depth;
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      )
      select
        'deep:' || depth::text, 'martijn@softora.nl', 'deep-' || depth::text || '@softora.test',
        case when depth = 1 then 'sent:deep-root' else 'deep:' || (depth - 1)::text end,
        'sent:deep-root', 'deep-root@softora.test', depth,
        '2026-08-02T08:00:00Z'::timestamptz + make_interval(secs => depth),
        depth = 27, false, now()
      from generate_series(1, 28) as depth;

      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:auto-root', 'serve290@gmail.com', 'sent', 1, 'sent:auto-root',
        '<auto-root@softora.test>', 'serve290@gmail.com', 'auto@example.test',
        'Kleine vraag over jullie website', '2026-07-01T08:00:00Z',
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      ), (
        'inbox:auto-human', 'serve290@gmail.com', 'inbox', 500, 'inbox:auto-human',
        '<auto-human@example.test>', 'human@example.test', 'serve290@gmail.com',
        'Re: Kleine vraag over jullie website', '2026-07-01T09:00:00Z',
        '{"direction":"received"}'::jsonb
      );
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      )
      select
        'inbox:auto-' || item::text, 'serve290@gmail.com', 'inbox', item + 1,
        'inbox:auto-' || item::text, '<auto-' || item::text || '@example.test>',
        'robot@example.test', 'serve290@gmail.com', 'Automatisch antwoord',
        '2026-08-05T08:00:00Z'::timestamptz + make_interval(secs => item),
        '{"direction":"received","automatedReplyEvidenceKnown":true,"automatedReplyEvidence":true,"automatedReplyEvidenceSource":"instantly:webhook:auto_reply_received"}'::jsonb
      from generate_series(1, 201) as item;
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      )
      select messages.message_key, 'sent:auto-root', 'serve290@gmail.com', messages.date, messages.date
      from public.softora_mailbox_messages as messages
      where messages.account_email = 'serve290@gmail.com';
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      )
      select
        messages.message_key, messages.account_email,
        public.softora_normalize_mailbox_message_id(messages.message_id),
        case when messages.folder = 'sent' then null else 'sent:auto-root' end,
        'sent:auto-root', 'auto-root@softora.test',
        case when messages.folder = 'sent' then 0 else 1 end,
        messages.date,
        public.softora_is_mailbox_incoming_message(
          messages.account_email, messages.folder, messages.sender_email,
          messages.recipients_text, messages.payload
        ),
        public.softora_has_proven_automated_reply(messages.payload),
        messages.date
      from public.softora_mailbox_messages as messages
      where messages.account_email = 'serve290@gmail.com';

      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:label-root', 'servecreusen7@gmail.com', 'sent', 1, 'sent:label-root',
        '<label-root@softora.test>', 'servecreusen7@gmail.com', 'label@example.test',
        'Kleine vraag over jullie website', '2026-07-02T08:00:00Z',
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      ), (
        'coldmail:human', 'servecreusen7@gmail.com', 'coldmail', 500,
        'coldmail:human', '<label-human@example.test>', 'human@example.test',
        'servecreusen7@gmail.com', 'Re: Kleine vraag over jullie website',
        '2026-07-02T09:00:00Z', '{}'::jsonb
      ), (
        'coldmail:bcc-alias-human', 'servecreusen7@gmail.com', 'coldmail', 501,
        'coldmail:bcc-alias-human', '<label-bcc@example.test>', 'bcc@example.test',
        'undisclosed-recipients:;', 'Re: via alias/BCC',
        '2026-07-02T09:01:00Z',
        '{"toDisplay":"sales@unrelated-alias.test","deliveredTo":"forward@alias.test"}'::jsonb
      );
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      )
      select
        'coldmail:outbound-' || item::text, 'servecreusen7@gmail.com', 'coldmail', item + 1,
        'coldmail:outbound-' || item::text, '<label-out-' || item::text || '@example.test>',
        'servecreusen7@gmail.com', 'lead-' || item::text || '@example.test',
        'Kleine vraag over jullie website',
        '2026-08-06T08:00:00Z'::timestamptz + make_interval(secs => item), '{}'::jsonb
      from generate_series(1, 201) as item;
      insert into public.softora_mailbox_campaign_lineage_discoveries (
        message_key, root_message_key, account_email, first_discovered_at, last_confirmed_at
      )
      select messages.message_key, 'sent:label-root', 'servecreusen7@gmail.com', messages.date, messages.date
      from public.softora_mailbox_messages as messages
      where messages.account_email = 'servecreusen7@gmail.com';
      insert into public.softora_mailbox_campaign_lineage_members (
        message_key, account_email, message_id, parent_message_key, root_message_key,
        root_message_id, lineage_depth, message_date, is_incoming,
        is_proven_automated, lineage_discovered_at
      )
      select
        messages.message_key, messages.account_email,
        public.softora_normalize_mailbox_message_id(messages.message_id),
        case when messages.folder = 'sent' then null else 'sent:label-root' end,
        'sent:label-root', 'label-root@softora.test',
        case when messages.folder = 'sent' then 0 else 1 end,
        messages.date,
        public.softora_is_mailbox_incoming_message(
          messages.account_email, messages.folder, messages.sender_email,
          messages.recipients_text, messages.payload
        ),
        public.softora_has_proven_automated_reply(messages.payload),
        messages.date
      from public.softora_mailbox_messages as messages
      where messages.account_email = 'servecreusen7@gmail.com';

      alter table public.softora_mailbox_messages
        enable trigger softora_refresh_mailbox_message_lineage;
    `);

    const lateBefore = await db.query(`
      select count(*)::int as count
      from public.softora_mailbox_campaign_lineage_members
      where message_key = 'inbox:late-old-child'
    `);
    await db.exec(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:late-root', 'serve@softora.nl', 'sent', 7001,
        'sent:late-root', '<late-root@softora.test>', 'serve@softora.nl',
        'late@example.test', 'Kleine vraag over jullie website',
        '2026-05-10T07:00:00Z',
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      );
    `);

    const scalePage = await readLineage(db, 'serve@softora.nl');
    const lateReply = scalePage.rows.find(
      (row) => row.message.provider_id === 'inbox:late-old-child'
    );
    const scaleCount = await db.query(`
      select count(*) filter (where lineage_depth > 0)::int as count
      from public.softora_mailbox_campaign_lineage_members
      where account_email = 'serve@softora.nl'
    `);
    assert.equal(lateBefore.rows[0].count, 0);
    assert.ok(scaleCount.rows[0].count > 4500);
    assert.ok(scalePage.rows.length < 9000);
    assert.equal(lateReply.lineage_selection_source, 'lineage-discovered');
    assert.equal(lateReply.lineage_has_more, true);

    const deepPage = await readLineage(db, 'martijn@softora.nl');
    assert.ok(deepPage.rows.some((row) => row.message.provider_id === 'deep:27'));
    assert.ok(
      deepPage.rows.some((row) => row.message.provider_id === 'deep:28'),
      'a later sent descendant of the selected reply must remain in the durable thread'
    );
    assert.ok(deepPage.rows.some((row) => row.message.provider_id === 'sent:deep-root'));
    assert.ok(deepPage.rows.every((row) => row.lineage_context_truncated === true));
    const cappedDeepPage = await db.query(`
      select *
      from public.softora_find_mailbox_campaign_lineage(
        array['martijn@softora.nl']::text[], 1, 20, 2, 2500,
        null, null, null, null
      )
    `);
    assert.deepEqual(
      new Set(cappedDeepPage.rows.map((row) => row.message.provider_id)),
      new Set(['deep:27', 'sent:deep-root']),
      'context caps must retain the selected reply and its explicit campaign root'
    );
    assert.ok(cappedDeepPage.rows.every((row) => row.lineage_context_truncated === true));

    const autoPage = await readLineage(db, 'serve290@gmail.com');
    assert.ok(autoPage.rows.some((row) => row.message.provider_id === 'inbox:auto-human'));
    assert.equal(
      autoPage.rows.some((row) => String(row.message.provider_id).startsWith('inbox:auto-')),
      true,
      'human id shares the prefix and must remain visible'
    );
    assert.equal(
      autoPage.rows.some((row) => /^inbox:auto-\d+$/.test(row.message.provider_id)),
      false,
      '201 source-proven automatic replies may not consume the 200-row feed'
    );

    const labelPage = await readLineage(db, 'servecreusen7@gmail.com');
    assert.ok(labelPage.rows.some((row) => row.message.provider_id === 'coldmail:human'));
    assert.ok(
      labelPage.rows.some((row) => row.message.provider_id === 'coldmail:bcc-alias-human'),
      'folder ownership plus an external sender must retain BCC/alias/forwarded inbound mail'
    );
    assert.equal(
      labelPage.rows.some((row) => row.message.provider_id.startsWith('coldmail:outbound-')),
      false,
      'legacy outbound Gmail-label rows may not consume the incoming feed'
    );

    await db.exec(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:reconnect-root', 'servec321@gmail.com', 'sent', 1,
        'sent:reconnect-root', '<reconnect-root@softora.test>', 'servec321@gmail.com',
        'reconnect@example.test', 'Kleine vraag over jullie website', now(),
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      ), (
        'inbox:reconnect', 'servec321@gmail.com', 'inbox', 2,
        'inbox:reconnect', '<reconnect@example.test>', 'reconnect@example.test',
        'servec321@gmail.com', 'Ander onderwerp', now(),
        '{"direction":"received"}'::jsonb
      );
      update public.softora_mailbox_messages
      set in_reply_to = '<reconnect-root@softora.test>',
          references_text = '<reconnect-root@softora.test>'
      where message_key = 'inbox:reconnect';
    `);
    const firstDiscovery = await db.query(`
      select first_discovered_at
      from public.softora_mailbox_campaign_lineage_discoveries
      where message_key = 'inbox:reconnect'
        and root_message_key = 'sent:reconnect-root'
    `);
    await db.exec(`
      update public.softora_mailbox_messages
      set in_reply_to = null, references_text = null
      where message_key = 'inbox:reconnect';
      select pg_sleep(0.01);
    `);
    const disconnected = await db.query(`
      select active
      from public.softora_mailbox_campaign_lineage_discoveries
      where message_key = 'inbox:reconnect'
        and root_message_key = 'sent:reconnect-root'
    `);
    await db.exec(`
      update public.softora_mailbox_messages
      set in_reply_to = '<reconnect-root@softora.test>',
          references_text = '<reconnect-root@softora.test>'
      where message_key = 'inbox:reconnect';
    `);
    const reconnected = await db.query(`
      select first_discovered_at, active
      from public.softora_mailbox_campaign_lineage_discoveries
      where message_key = 'inbox:reconnect'
        and root_message_key = 'sent:reconnect-root'
    `);
    assert.equal(disconnected.rows[0].active, false);
    assert.equal(reconnected.rows[0].active, true);
    assert.ok(
      reconnected.rows[0].first_discovered_at.getTime() >
      firstDiscovery.rows[0].first_discovered_at.getTime()
    );

    await db.exec(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'instantly:webhook-proof', 'martijnvandeven@softora.nl', 'instantly', 99,
        'instantly:webhook-proof', '<webhook-proof@example.test>', 'robot@example.test',
        'martijnvandeven@softora.nl', 'Automatisch antwoord', now(),
        '{"direction":"received","automatedReplyEvidenceKnown":true,"automatedReplyEvidence":true,"automatedReplyEvidenceSource":"instantly:webhook:auto_reply_received"}'::jsonb
      );
      update public.softora_mailbox_messages
      set payload = '{"direction":"received","automatedReplyEvidenceKnown":false,"automatedReplyEvidence":false,"automatedReplyEvidenceSource":""}'::jsonb
      where message_key = 'instantly:webhook-proof';
    `);
    const preserved = await db.query(`
      select payload
      from public.softora_mailbox_messages
      where message_key = 'instantly:webhook-proof'
    `);
    assert.equal(preserved.rows[0].payload.automatedReplyEvidenceKnown, true);
    assert.equal(preserved.rows[0].payload.automatedReplyEvidence, true);
    assert.match(
      preserved.rows[0].payload.automatedReplyEvidenceSource,
      /instantly:webhook:auto_reply_received/
    );
  } finally {
    await db.close();
  }
});

test('real PostgreSQL cutover installs the trigger before a forced interleaved write and backfill', {
  timeout: 20_000,
}, async () => {
  const db = await createBaseDatabase();
  try {
    const backfillMarker = '-- mailbox-campaign-lineage-backfill:start';
    const splitAt = migrationSql.indexOf(backfillMarker);
    assert.ok(splitAt > 0);
    const cutoverPrefix = migrationSql.slice(0, splitAt);
    const cutoverBackfill = migrationSql.slice(splitAt);

    await db.exec('begin');
    await db.exec(cutoverPrefix);
    await db.exec(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        sender_email, recipients_text, subject, date, payload
      ) values (
        'sent:cutover-root', 'serve@softora.nl', 'sent', 1,
        'sent:cutover-root', '<cutover-root@softora.test>', 'serve@softora.nl',
        'cutover@example.test', 'Kleine vraag over jullie website', now(),
        '{"originalCampaignOutbound":true,"direction":"sent"}'::jsonb
      ), (
        'inbox:cutover-write', 'serve@softora.nl', 'inbox', 2,
        'inbox:cutover-write', '<cutover-write@example.test>', 'cutover@example.test',
        'serve@softora.nl', 'Nieuw onderwerp tijdens cutover', now(),
        '{"direction":"received"}'::jsonb
      );
      update public.softora_mailbox_messages
      set in_reply_to = '<cutover-root@softora.test>',
          references_text = '<cutover-root@softora.test>'
      where message_key = 'inbox:cutover-write';
    `);
    await db.exec(cutoverBackfill);
    await db.exec('commit');

    const member = await db.query(`
      select lineage_depth, root_message_id
      from public.softora_mailbox_campaign_lineage_members
      where message_key = 'inbox:cutover-write'
    `);
    assert.equal(member.rows.length, 1);
    assert.equal(member.rows[0].lineage_depth, 1);
    assert.equal(member.rows[0].root_message_id, 'cutover-root@softora.test');
  } finally {
    await db.close();
  }
});
