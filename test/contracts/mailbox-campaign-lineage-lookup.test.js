'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS,
  createMailboxCampaignLineageLookup,
} = require('../../server/repositories/mailbox-campaign-lineage-lookup');

function createLookup(rows, calls = []) {
  return createMailboxCampaignLineageLookup({
    normalizeString: (value) => String(value || '').trim(),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeMessageRow: (row) => ({
      id: row.provider_id,
      accountEmail: row.account_email,
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      providerMessageId: row.payload?.providerMessageId || '',
      providerThreadId: row.payload?.providerThreadId || '',
      providerAccountEmail: row.payload?.providerAccountEmail || '',
    }),
    run: async (label, operation, runOptions = {}) => {
      const client = {
        rpc: async (name, args) => {
          calls.push({ label, name, args, runOptions });
          return { data: rows, error: null };
        },
      };
      const result = await operation(client);
      return { ok: !result.error, data: result.data, error: result.error };
    },
  });
}

test('campaign lineage lookup uses exactly one bounded RPC and preserves exact provider identities', async () => {
  const calls = [];
  const lookup = createLookup([{
    message: {
      provider_id: 'instantly:reply-1',
      account_email: 'serve@softora.nl',
      message_id: '<reply-1@example.test>',
      in_reply_to: '<manual-sent-1@softora.test>',
      payload: {
        providerMessageId: 'reply-1',
        providerThreadId: 'thread-1',
        providerAccountEmail: 'serve@softora.nl',
      },
    },
    lineage_depth: 3,
    campaign_root_message_id: 'root-1@softora.test',
    lineage_discovered_at: '2026-08-10T09:00:00.000Z',
    lineage_selected_reply: true,
    lineage_selection_source: 'lineage-discovered',
    lineage_has_more: true,
    lineage_context_truncated: false,
  }], calls);

  const rows = await lookup({
    accountEmails: ['Serve@Softora.nl'],
    maxDepth: 20,
    maxResults: 100,
    deadlineMs: 2000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'softora_find_mailbox_campaign_lineage_metadata');
  assert.deepEqual(calls[0].runOptions, { timeoutMs: 2000 });
  assert.deepEqual(calls[0].args, {
    p_account_emails: ['serve@softora.nl'],
    p_reply_limit: 200,
    p_max_depth: 20,
    p_max_context_messages: 100,
    p_deadline_ms: 2000,
    p_before_message_date: null,
    p_before_message_key: null,
    p_before_discovered_at: null,
    p_before_discovered_key: null,
  });
  assert.equal(rows[0].campaignLineageDepth, 3);
  assert.equal(rows[0].campaignLineageRootMessageId, 'root-1@softora.test');
  assert.equal(rows[0].providerMessageId, 'reply-1');
  assert.equal(rows[0].providerThreadId, 'thread-1');
  assert.equal(rows[0].inReplyTo, '<manual-sent-1@softora.test>');
  assert.equal(rows[0].campaignLineageDiscoveredAt, '2026-08-10T09:00:00.000Z');
  assert.equal(rows[0].campaignLineageSelectedReply, true);
  assert.equal(rows[0].campaignLineageSelectionSource, 'lineage-discovered');
  assert.equal(rows[0].campaignLineageHasMore, true);
  assert.equal(rows[0].campaignLineageContextTruncated, false);
});

test('campaign lineage lookup gives the bounded metadata response enough network time', () => {
  assert.equal(MAILBOX_CAMPAIGN_LINEAGE_DEFAULT_DEADLINE_MS, 8000);
});

test('4500 historical descendants cannot hide a newly proven old-date reply', async () => {
  const accountEmail = 'serve@softora.nl';
  const history = Array.from({ length: 4501 }, (_value, index) => ({
    message: {
      provider_id: `inbox:${index}`,
      account_email: accountEmail,
      message_id: `<reply-${index}@example.test>`,
      in_reply_to: '<root@softora.test>',
      date: new Date(Date.UTC(2026, 6, 1, 0, 0, index % 60)).toISOString(),
    },
    lineage_depth: 1,
    campaign_root_message_id: 'root@softora.test',
    lineage_discovered_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index % 60)).toISOString(),
  }));
  const lateProof = history[0];
  lateProof.message.provider_id = 'inbox:late-proof';
  lateProof.message.date = '2026-05-10T08:00:00.000Z';
  lateProof.lineage_discovered_at = '2026-08-10T10:30:00.000Z';

  let rpcCalls = 0;
  const lookup = createMailboxCampaignLineageLookup({
    normalizeString: (value) => String(value || '').trim(),
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeMessageRow: (row) => ({
      id: row.provider_id,
      accountEmail: row.account_email,
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      date: row.date,
    }),
    run: async (_label, operation) => {
      const result = await operation({
        rpc: async (_name, args) => {
          rpcCalls += 1;
          const byMessageDate = history
            .slice()
            .sort((left, right) => right.message.date.localeCompare(left.message.date))
            .slice(0, args.p_reply_limit);
          const byDiscovery = history
            .slice()
            .sort((left, right) => right.lineage_discovered_at.localeCompare(left.lineage_discovered_at))
            .slice(0, args.p_reply_limit);
          const selected = Array.from(new Map(
            [...byMessageDate, ...byDiscovery].map((row) => [row.message.provider_id, row])
          ).values());
          return {
            data: selected.map((row) => ({
              ...row,
              lineage_selected_reply: true,
              lineage_selection_source: row === lateProof
                ? 'lineage-discovered'
                : 'message-date',
              lineage_has_more: true,
            })),
            error: null,
          };
        },
      });
      return { ok: !result.error, data: result.data, error: result.error };
    },
  });

  const rows = await lookup({
    accountEmails: [accountEmail],
    replyLimit: 200,
    maxResults: 9000,
  });

  assert.equal(history.length, 4501);
  assert.equal(rpcCalls, 1);
  assert.ok(rows.length <= 400, 'twee begrensde feeds mogen samen maximaal 400 replies geven');
  assert.ok(rows.some((row) => row.id === 'inbox:late-proof'));
  assert.equal(
    rows.find((row) => row.id === 'inbox:late-proof').campaignLineageSelectionSource,
    'lineage-discovered'
  );
});

test('campaign lineage lookup fails loudly on result and provenance overflow', async () => {
  await assert.rejects(
    createLookup([
      { message: { account_email: 'serve@softora.nl' }, lineage_depth: 1, campaign_root_message_id: 'root' },
      { message: { account_email: 'serve@softora.nl' }, lineage_depth: 1, campaign_root_message_id: 'root' },
    ])({ accountEmails: ['serve@softora.nl'], maxResults: 1 }),
    { code: 'MAILBOX_CAMPAIGN_LINEAGE_RESULT_LIMIT', status: 503 }
  );
  await assert.rejects(
    createLookup([{
      message: { account_email: 'martijn@softora.nl' },
      lineage_depth: 1,
      campaign_root_message_id: 'root',
    }])({ accountEmails: ['serve@softora.nl'] }),
    { code: 'MAILBOX_CAMPAIGN_LINEAGE_PROVENANCE_INVALID', status: 503 }
  );
});

test('deep exact lineage remains visible with explicit truncated context instead of a mailbox-wide 503', async () => {
  const rows = await createLookup([
    {
      message: {
        provider_id: 'inbox:deep-reply',
        account_email: 'serve@softora.nl',
        message_id: '<deep@example.test>',
      },
      lineage_depth: 27,
      campaign_root_message_id: 'root@softora.test',
      lineage_selected_reply: true,
      lineage_selection_source: 'message-date',
      lineage_context_truncated: true,
    },
    {
      message: {
        provider_id: 'sent:deep-root',
        account_email: 'serve@softora.nl',
        message_id: '<root@softora.test>',
      },
      lineage_depth: 0,
      campaign_root_message_id: 'root@softora.test',
      lineage_selected_reply: false,
      lineage_selection_source: 'root-context',
      lineage_context_truncated: true,
    },
  ])({ accountEmails: ['serve@softora.nl'], maxDepth: 20 });

  assert.deepEqual(rows.map((row) => row.id), ['inbox:deep-reply', 'sent:deep-root']);
  assert.ok(rows.every((row) => row.campaignLineageContextTruncated === true));
});
