const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxAttachmentsMetadataFromContent,
  createMailboxRequestPayloadFingerprint,
  createMailboxSendProvenanceStore,
  isDefinitiveMailboxProviderRejection,
  mailboxAttachmentsMetadataEqual,
  normalizeMailboxAttachmentsMetadata,
} = require('../../server/services/mailbox-send-provenance-store');
const { createSupabaseStateStore } = require('../../server/services/supabase-state');

test('providerclassifier vereist echt providerbewijs voor een definitieve afwijzing', () => {
  assert.equal(isDefinitiveMailboxProviderRejection(
    Object.assign(new Error('lokale validatie gaf 400'), { status: 400 })
  ), false);
  assert.equal(isDefinitiveMailboxProviderRejection(
    Object.assign(new SyntaxError('lokale JSON-parsefout'), { status: 422 })
  ), false);
  assert.equal(isDefinitiveMailboxProviderRejection(
    Object.assign(new Error('SMTP mailbox unavailable'), { responseCode: 550 })
  ), true);
  assert.equal(isDefinitiveMailboxProviderRejection(Object.assign(new Error('provider rejected'), {
    mailboxProviderResponseReceived: true,
    providerStatus: 422,
  })), true);
  for (const providerStatus of [408, 409, 425, 429, 503]) {
    assert.equal(isDefinitiveMailboxProviderRejection(Object.assign(new Error('onzekere providerstatus'), {
      mailboxProviderResponseReceived: true,
      providerStatus,
    })), false);
  }
});

function createFakeSupabase(options = {}) {
  const rows = [];
  const client = {
    rows,
    insertCalls: 0,
    readCalls: 0,
    rpcCalls: [],
    updateCalls: 0,
    filterCalls: [],
    async rpc(name, args = {}) {
      client.rpcCalls.push({ name, args: { ...args } });
      const row = rows.find((candidate) => candidate.intent_id === args.p_intent_id);
      const expectedLeaseMs = Date.parse(String(args.p_expected_dispatch_lease_expires_at || ''));
      const expectedUpdatedMs = Date.parse(String(args.p_expected_updated_at || ''));
      const requestedClaimUpdatedMs = Date.parse(String(args.p_row?.updated_at || ''));
      const configuredRpcNow = typeof options.rpcNow === 'function'
        ? options.rpcNow({ name, args: { ...args }, row: row ? { ...row } : null })
        : options.rpcNow;
      const dbNow = configuredRpcNow
        ? new Date(configuredRpcNow)
        : new Date(Number.isFinite(expectedUpdatedMs)
          ? expectedUpdatedMs + 1
          : Number.isFinite(requestedClaimUpdatedMs) ? requestedClaimUpdatedMs : Date.now());
      const dbNowMs = dbNow.getTime();
      const claim = name === 'softora_claim_mailbox_pre_dispatch';
      if (claim) {
        const leaseMs = Number(args.p_lease_ms);
        const claimRow = {
          ...(args.p_row || {}),
          transition_token: args.p_transition_token,
          dispatch_lease_expires_at: new Date(dbNowMs + leaseMs).toISOString(),
          created_at: dbNow.toISOString(),
          updated_at: dbNow.toISOString(),
        };
        const active = (candidate) => ['prepared', 'unknown', 'accepted'].includes(candidate.status);
        const conflict = rows.some((candidate) => (
          candidate.intent_id === claimRow.intent_id
          || candidate.idempotency_key === claimRow.idempotency_key
          || (active(candidate) && candidate.send_identity_key === claimRow.send_identity_key)
          || (claimRow.mode === 'new-message' && ['prepared', 'unknown'].includes(candidate.status)
            && candidate.send_scope_key === claimRow.send_scope_key)
        ));
        const valid = Number.isFinite(dbNowMs)
          && leaseMs >= 900_000 && leaseMs <= 3_600_000
          && /^[0-9a-f]{64}$/.test(String(claimRow.pre_dispatch_claim_fingerprint || ''))
          && String(args.p_transition_token || '').length > 0;
        if (!valid || conflict) return { data: [], error: null };
        client.insertCalls += 1;
        const hook = typeof options.onRpc === 'function' ? options.onRpc : options.onInsert;
        const outcome = typeof hook === 'function'
          ? await hook({
              call: client.insertCalls,
              name,
              args: { ...args },
              row: { ...claimRow },
            })
          : null;
        if (!outcome || outcome.commit !== false) rows.push(claimRow);
        if (outcome?.error) return { data: null, error: outcome.error };
        return { data: [{ ...claimRow }], error: null };
      }
      const expireReserved = name === 'softora_expire_mailbox_reserved_dispatch';
      const expireStarted = name === 'softora_expire_mailbox_started_dispatch';
      if (expireReserved || expireStarted) {
        const sameNullableTimestamp = (left, right) => {
          if (left == null || left === '') return right == null || right === '';
          if (right == null || right === '') return false;
          return Date.parse(String(left)) === Date.parse(String(right));
        };
        const validFence = row
          && row.status === 'prepared'
          && row.dispatch_state === (expireStarted ? 'started' : 'reserved')
          && row.transition_token === args.p_expected_transition_token
          && Date.parse(String(row.dispatch_lease_expires_at || '')) === expectedLeaseMs
          && Date.parse(String(row.updated_at || '')) === expectedUpdatedMs
          && (row.pre_dispatch_claim_fingerprint ?? null)
            === (args.p_expected_claim_fingerprint ?? null)
          && sameNullableTimestamp(
            row.pre_dispatch_finalized_at,
            args.p_expected_finalized_at
          )
          && (!expireStarted || (
            sameNullableTimestamp(row.dispatch_started_at, args.p_expected_dispatch_started_at)
            && row.dispatch_started_at != null
          ))
          && Number.isFinite(expectedLeaseMs)
          && Number.isFinite(dbNowMs)
          && expectedLeaseMs <= dbNowMs
          && String(args.p_next_transition_token || '').length > 0
          && args.p_next_transition_token !== args.p_expected_transition_token;
        if (!validFence) return { data: [], error: null };

        const patch = expireStarted ? {
          status: 'unknown',
          dispatch_state: 'started',
          dispatch_lease_expires_at: null,
          reconcile_required: true,
          sent_reconcile_required: true,
          error_text: 'De dispatchlease is verlopen; de provideruitkomst moet eerst worden gereconcilieerd.',
          transition_token: args.p_next_transition_token,
          updated_at: dbNow.toISOString(),
        } : {
          status: 'failed',
          dispatch_state: 'finished',
          dispatch_lease_expires_at: null,
          reconcile_required: false,
          sent_reconcile_required: false,
          error_text: 'De pre-dispatchreservering verliep voordat de provider werd gestart.',
          transition_token: args.p_next_transition_token,
          updated_at: dbNow.toISOString(),
        };
        client.updateCalls += 1;
        const hook = typeof options.onRpc === 'function' ? options.onRpc : options.onUpdate;
        const outcome = typeof hook === 'function'
          ? await hook({
              call: client.updateCalls,
              name,
              args: { ...args },
              patch: { ...patch },
              row: { ...row },
            })
          : null;
        if (outcome?.concurrentPatch) Object.assign(row, outcome.concurrentPatch);
        if (!outcome || outcome.commit !== false) Object.assign(row, patch);
        if (outcome?.error) return { data: null, error: outcome.error };
        return { data: [{ ...row }], error: null };
      }
      const commonFence = row
        && row.status === 'prepared'
        && row.dispatch_state === 'reserved'
        && row.transition_token === args.p_expected_transition_token
        && Date.parse(String(row.dispatch_lease_expires_at || '')) === expectedLeaseMs
        && Date.parse(String(row.updated_at || '')) === expectedUpdatedMs
        && row.pre_dispatch_claim_fingerprint === args.p_expected_claim_fingerprint
        && Number.isFinite(expectedLeaseMs)
        && Number.isFinite(dbNowMs)
        && expectedLeaseMs > dbNowMs;
      const finalize = name === 'softora_finalize_mailbox_pre_dispatch_claim';
      const start = name === 'softora_start_mailbox_pre_dispatch';
      const phaseFence = finalize
        ? row?.pre_dispatch_finalized_at == null
          && Number(args.p_lease_ms) >= 900_000
          && Number(args.p_lease_ms) <= 3_600_000
        : start
          ? Date.parse(String(row?.pre_dispatch_finalized_at || ''))
              === Date.parse(String(args.p_expected_finalized_at || ''))
            && Number(args.p_lease_ms) >= 30_000
            && Number(args.p_lease_ms) <= 900_000
          : false;
      if (!commonFence || !phaseFence) return { data: [], error: null };

      const patch = finalize ? {
        send_identity_key: args.p_send_identity_key,
        send_scope_key: args.p_send_scope_key,
        payload_fingerprint: args.p_payload_fingerprint,
        attachments_fingerprint: args.p_attachments_fingerprint,
        request_payload_fingerprint: args.p_request_payload_fingerprint,
        attachments_metadata: args.p_attachments_metadata,
        sent_message_id: args.p_sent_message_id,
        sender_name: args.p_sender_name,
        subject: args.p_subject,
        body_text: args.p_body_text,
        cc_text: args.p_cc_text,
        bcc_text: args.p_bcc_text,
        pre_dispatch_finalized_at: dbNow.toISOString(),
        dispatch_lease_expires_at: new Date(dbNowMs + Number(args.p_lease_ms)).toISOString(),
        error_text: null,
        transition_token: args.p_next_transition_token,
        updated_at: dbNow.toISOString(),
      } : {
        dispatch_state: 'started',
        dispatch_started_at: dbNow.toISOString(),
        dispatch_lease_expires_at: new Date(dbNowMs + Number(args.p_lease_ms)).toISOString(),
        transition_token: args.p_next_transition_token,
        updated_at: dbNow.toISOString(),
      };
      client.updateCalls += 1;
      const hook = typeof options.onRpc === 'function' ? options.onRpc : options.onUpdate;
      const outcome = typeof hook === 'function'
        ? await hook({
            call: client.updateCalls,
            name,
            args: { ...args },
            patch: { ...patch },
            row: { ...row },
          })
        : null;
      if (outcome?.concurrentPatch) Object.assign(row, outcome.concurrentPatch);
      if (!outcome || outcome.commit !== false) Object.assign(row, patch);
      if (outcome?.error) return { data: null, error: outcome.error };
      return { data: [{ ...row }], error: null };
    },
    from() {
      const state = { action: 'select', filters: [], patch: null, inserted: null };
      const exactValue = (left, right) => (
        left === right
        || (left && right && typeof left === 'object' && typeof right === 'object'
          && JSON.stringify(left) === JSON.stringify(right))
      );
      const matching = () => rows.filter((row) => state.filters.every(([key, value, kind]) => {
        if (kind === 'in') return value.includes(row[key]);
        if (kind === 'gt') {
          const actualMs = Date.parse(String(row[key] || ''));
          const expectedMs = Date.parse(String(value || ''));
          return Number.isFinite(actualMs) && Number.isFinite(expectedMs) && actualMs > expectedMs;
        }
        return exactValue(row[key], value);
      }));
      const query = {
        select() { return query; },
        insert(row) { state.action = 'insert'; state.inserted = { ...row }; return query; },
        update(patch) { state.action = 'update'; state.patch = { ...patch }; return query; },
        eq(key, value) {
          client.filterCalls.push({ key, value, kind: 'eq' });
          state.filters.push([key, value, 'eq']);
          return query;
        },
        in(key, value) {
          client.filterCalls.push({ key, value, kind: 'in' });
          state.filters.push([key, value, 'in']);
          return query;
        },
        gt(key, value) {
          client.filterCalls.push({ key, value, kind: 'gt' });
          state.filters.push([key, value, 'gt']);
          return query;
        },
        is(key, value) {
          client.filterCalls.push({ key, value, kind: 'is' });
          state.filters.push([key, value, 'eq']);
          return query;
        },
        order() { return query; },
        limit(limit) {
          return Promise.resolve({ data: matching().slice(0, limit), error: null });
        },
        async single() {
          if (state.action === 'insert') {
            const requiredKeys = ['send_identity_key', 'send_scope_key', 'payload_fingerprint'];
            if (requiredKeys.some((key) => !String(state.inserted[key] || '').trim())) {
              return { data: null, error: { code: '23502', message: 'null identity key' } };
            }
            const active = (row) => ['prepared', 'unknown', 'accepted'].includes(row.status);
            if (rows.some((row) => row.idempotency_key === state.inserted.idempotency_key
              || (active(row) && row.send_identity_key === state.inserted.send_identity_key)
              || (state.inserted.mode === 'new-message' && ['prepared', 'unknown'].includes(row.status)
                && row.send_scope_key === state.inserted.send_scope_key))) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            const row = {
              created_at: '2026-08-05T20:00:00.000Z',
              updated_at: '2026-08-05T20:00:00.000Z',
              ...state.inserted,
            };
            client.insertCalls += 1;
            const outcome = typeof options.onInsert === 'function'
              ? await options.onInsert({
                  call: client.insertCalls,
                  row: { ...row },
                })
              : null;
            if (!outcome || outcome.commit !== false) rows.push(row);
            if (outcome?.error) return { data: null, error: outcome.error };
            return { data: row, error: null };
          }
          if (state.action === 'update') {
            const row = matching()[0];
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'missing' } };
            client.updateCalls += 1;
            const outcome = typeof options.onUpdate === 'function'
              ? await options.onUpdate({
                  call: client.updateCalls,
                  patch: { ...state.patch },
                  row: { ...row },
                })
              : null;
            if (outcome?.concurrentPatch) Object.assign(row, outcome.concurrentPatch);
            if (!outcome || outcome.commit !== false) Object.assign(row, state.patch);
            if (outcome?.error) return { data: null, error: outcome.error };
            return { data: row, error: null };
          }
          return { data: matching()[0] || null, error: null };
        },
        async maybeSingle() {
          client.readCalls += 1;
          const outcome = typeof options.onMaybeSingle === 'function'
            ? await options.onMaybeSingle({
                call: client.readCalls,
                rows: matching().map((row) => ({ ...row })),
              })
            : null;
          if (outcome?.error) return { data: null, error: outcome.error };
          if (Object.prototype.hasOwnProperty.call(outcome || {}, 'data')) {
            return { data: outcome.data, error: null };
          }
          return { data: matching()[0] || null, error: null };
        },
      };
      return query;
    },
  };
  return client;
}

async function claimAndFinalize(store, payload) {
  const input = {
    ...payload,
    attachmentsMetadata: payload.attachmentsMetadata === undefined
      ? []
      : payload.attachmentsMetadata,
  };
  const claim = await store.claimPreDispatch(input);
  if (!claim.created) return claim;
  const finalized = await store.finalizeClaim(claim, input);
  return { ...finalized, created: true, claim };
}

test('mailbox send provenance survives acceptance and prevents an idempotent resend', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-05T20:00:00.000Z'),
    logger: { error() {} },
  });
  const payload = {
    intentId: 'send:blue',
    idempotencyKey: 'blue-key',
    owner: 'martijn',
    accountEmail: 'contact.venvisuals@gmail.com',
    recipientEmail: 'info@blue-monkey.nl',
    mode: 'reply',
    conversationId: 'conversation:blue',
    replyTargetMessageId: '<blue-inbound@example.nl>',
    references: '<blue-original@example.nl> <blue-inbound@example.nl>',
    provider: 'smtp',
    messageId: '<planned@example.nl>',
    senderName: 'Martijn van de Ven',
    subject: 'Re: Kleine vraag over jullie website',
    body: 'Dankjewel voor je reactie.',
    attachmentsMetadata: [{ filename: 'bewijs.pdf', contentType: 'text/plain', size: 4 }],
  };

  const first = await store.reserve(payload);
  assert.equal(first.created, true);
  assert.match(client.rows[0].send_identity_key, /^smtp-reply:[0-9a-f]{64}$/);
  assert.match(client.rows[0].send_scope_key, /^smtp-reply-scope:[0-9a-f]{64}$/);
  assert.match(client.rows[0].payload_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(client.rows[0].request_payload_fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(client.rows[0].attachments_metadata, [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }]);
  await store.accept(payload.intentId, {
    messageId: '<accepted@example.nl>',
    acceptedAt: '2026-08-05T20:01:00.000Z',
  });
  const repeated = await store.reserve(payload);
  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'accepted');
  assert.equal(repeated.intent.messageId, '<accepted@example.nl>');
  const accepted = await store.listAcceptedMessages({
    accountEmails: ['contact.venvisuals@gmail.com'],
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].conversationId, 'conversation:blue');
  assert.deepEqual(accepted[0].attachmentsMetadata, [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }]);
});

test('attachment metadata bewaart legacy-onbekend als null en vergelijkt arrays canoniek diep', () => {
  assert.equal(normalizeMailboxAttachmentsMetadata(null), null);
  assert.deepEqual(normalizeMailboxAttachmentsMetadata([]), []);
  assert.deepEqual(normalizeMailboxAttachmentsMetadata([{
    filename: ' bewijs.pdf ', contentType: 'text/plain; charset=utf-8', size: 4,
  }]), [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }]);
  assert.equal(mailboxAttachmentsMetadataEqual(
    [{ filename: 'bewijs.pdf', contentType: 'text/plain', size: 4 }],
    [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4 }]
  ), true);
  assert.equal(mailboxAttachmentsMetadataEqual([], null), false);
  assert.equal(normalizeMailboxAttachmentsMetadata([{
    filename: 'te-groot.pdf', contentType: 'application/pdf', size: 5 * 1024 * 1024,
  }]), null);
  assert.equal(normalizeMailboxAttachmentsMetadata([
    { filename: 'deel-a.pdf', contentType: 'application/pdf', size: 3 * 1024 * 1024 },
    { filename: 'deel-b.pdf', contentType: 'application/pdf', size: 3 * 1024 * 1024 },
  ]), null);
  assert.deepEqual(normalizeMailboxAttachmentsMetadata([{
    filename: 'bewijs.pdf', contentType: 'text/plain', size: 4, sha256: 'a'.repeat(64),
  }]), [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }]);
  assert.equal(normalizeMailboxAttachmentsMetadata([{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'A'.repeat(64),
  }]), null);
  assert.equal(normalizeMailboxAttachmentsMetadata([
    { filename: 'a.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64) },
    { filename: 'b.pdf', contentType: 'application/pdf', size: 4 },
  ]), null);
  assert.equal(mailboxAttachmentsMetadataEqual(
    [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64) }],
    [{ filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'b'.repeat(64) }]
  ), false);
});

test('provenance en request fingerprint bewaren v2 SHA-256 zonder downgrade', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-27T20:20:00.000Z'),
  });
  const metadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }];
  const reserved = await store.reserve({
    intentId: 'send:hash-bound', idempotencyKey: 'browser:hash-bound', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'reply',
    conversationId: 'conversation:hash-bound', replyTargetMessageId: '<incoming@example.nl>',
    references: '<incoming@example.nl>', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Re: Bijlage', body: 'Zie bijlage', requestBody: 'Zie bijlage',
    attachmentsMetadata: metadata,
  });
  assert.deepEqual(reserved.intent.attachmentsMetadata, metadata);
  assert.deepEqual(client.rows[0].attachments_metadata, metadata);
  assert.equal(reserved.intent.requestPayloadFingerprint, createMailboxRequestPayloadFingerprint({
    subject: 'Re: Bijlage', requestBody: 'Zie bijlage', attachmentsMetadata: metadata,
  }));
  assert.notEqual(
    createMailboxRequestPayloadFingerprint({
      subject: 'Re: Bijlage', requestBody: 'Zie bijlage', attachmentsMetadata: metadata,
    }),
    createMailboxRequestPayloadFingerprint({
      subject: 'Re: Bijlage', requestBody: 'Zie bijlage', attachmentsMetadata: [{
        ...metadata[0], sha256: 'b'.repeat(64),
      }],
    })
  );
});

test('provenance-opslag onderscheidt ontbrekende attachmentmetadata van bewezen leeg', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-27T16:00:00.000Z'),
    logger: { error() {} },
  });
  const base = {
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    senderName: 'Servé Creusen', mode: 'reply', conversationId: 'conversation:metadata',
    replyTargetMessageId: '<incoming@example.nl>', references: '<incoming@example.nl>',
    provider: 'smtp', subject: 'Re: Metadata', body: 'Antwoord', cc: '', bcc: '',
  };
  await store.reserve({
    ...base, intentId: 'send:metadata-unknown', idempotencyKey: 'browser:metadata-unknown',
  });
  await store.reserve({
    ...base, intentId: 'send:metadata-empty', idempotencyKey: 'browser:metadata-empty',
    conversationId: 'conversation:metadata-empty', replyTargetMessageId: '<incoming-empty@example.nl>',
    references: '<incoming-empty@example.nl>', attachmentsMetadata: [],
  });
  assert.equal(client.rows[0].attachments_metadata, null);
  assert.deepEqual(client.rows[1].attachments_metadata, []);
});

test('gerichte accepted-provenance lookup gebruikt één canonieke geaggregeerde RPC en behoudt ambiguïteit', async () => {
  const rpcCalls = [];
  const rows = [1, 2].map((number) => ({
    intent_id: `send:targeted-${number}`,
    idempotency_key: `browser:targeted-${number}`,
    owner: 'serve',
    account_email: 'serve@softora.nl',
    recipient_email: 'lead@example.nl',
    mode: 'reply',
    conversation_id: 'conversation:targeted',
    reply_target_message_id: '<incoming@example.nl>',
    references_text: '<root@example.nl> <incoming@example.nl>',
    provider: 'smtp',
    provider_thread_id: 'thread-targeted',
    provider_message_id: `provider-targeted-${number}`,
    sent_message_id: number === 1 ? '<TARGET@Example.NL>' : 'target@example.nl',
    canonical_message_id: 'target@example.nl',
    sender_name: 'Servé Creusen',
    subject: 'Re: Kleine vraag',
    body_text: `Exact antwoord ${number}`,
    cc_text: 'cc@example.nl',
    bcc_text: 'bcc@example.nl',
    status: 'accepted',
    dispatch_state: 'finished',
    accepted_at: `2026-08-25T00:0${number}:00.000Z`,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: `2026-08-25T00:0${number}:00.000Z`,
  }));
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc(name, args) {
        rpcCalls.push([name, args]);
        return {
          data: {
            rows,
            complete: true,
            overflow: false,
            returned_count: rows.length,
            max_rows: 3,
          },
          error: null,
        };
      },
    }),
    logger: { error() {} },
  });

  const accepted = await store.listAcceptedMessagesByMessageIds({
    accountEmails: [' SERVE@SOFTORA.NL ', 'serve@softora.nl'],
    messageIds: [' <<TARGET@EXAMPLE.NL>>, ', '<target@example.nl>'],
    maxRows: 3,
  });

  assert.equal(accepted.length, 2, 'dubbele accepted provenance moet zichtbaar blijven als ambiguïteit');
  assert.deepEqual(accepted.map((row) => row.intentId), ['send:targeted-1', 'send:targeted-2']);
  assert.equal(accepted[0].messageId, '<TARGET@Example.NL>');
  assert.equal(accepted[0].canonicalMessageId, 'target@example.nl');
  assert.equal(accepted[0].body, 'Exact antwoord 1');
  assert.equal(accepted[0].replyTargetMessageId, '<incoming@example.nl>');
  assert.deepEqual(rpcCalls, [[
    'softora_list_accepted_mailbox_send_provenance_by_message_ids',
    {
      p_account_emails: ['serve@softora.nl'],
      p_message_ids: ['target@example.nl'],
      p_max_rows: 3,
    },
  ]]);
});

test('gerichte accepted-provenance lookup faalt gesloten op overflow, scopeschending en ontbrekende opslag', async () => {
  const baseRow = {
    intent_id: 'send:overflow', idempotency_key: 'browser:overflow', owner: 'serve',
    account_email: 'serve@softora.nl', recipient_email: 'lead@example.nl', mode: 'reply',
    provider: 'smtp', sent_message_id: '<target@example.nl>',
    canonical_message_id: 'target@example.nl', subject: 'Re: Vraag', body_text: 'Antwoord',
    status: 'accepted', dispatch_state: 'finished',
  };
  const overflowRows = [1, 2, 3].map((number) => ({
    ...baseRow, intent_id: `send:overflow-${number}`,
  }));
  const overflowStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() {
        return { data: {
          rows: overflowRows, complete: false, overflow: true,
          returned_count: 3, max_rows: 2,
        }, error: null };
      },
    }),
    logger: { error() {} },
  });
  await assert.rejects(
    overflowStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_OVERFLOW'
  );

  const scopeStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      async rpc() {
        return { data: {
          rows: [{ ...baseRow, account_email: 'martijn@softora.nl' }],
          complete: true, overflow: false, returned_count: 1, max_rows: 2,
        }, error: null };
      },
    }),
    logger: { error() {} },
  });
  await assert.rejects(
    scopeStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INVALID_RESULT'
  );

  const unavailableStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => false,
    logger: { error() {} },
  });
  await assert.rejects(
    unavailableStore.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'], messageIds: ['target@example.nl'], maxRows: 2,
    }),
    (error) => error.code === 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE'
  );
});

test('gerichte accepted-provenance lookup weigert te brede input vóór de RPC', async () => {
  let rpcCalls = 0;
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ async rpc() { rpcCalls += 1; return { data: null, error: null }; } }),
  });
  await assert.rejects(
    store.listAcceptedMessagesByMessageIds({
      accountEmails: ['serve@softora.nl'],
      messageIds: Array.from({ length: 201 }, (_, index) => `target-${index}@example.nl`),
      maxRows: 500,
    }),
    (error) => error.code === 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE'
  );
  assert.equal(rpcCalls, 0);
});

test('mailbox send provenance bypasses an active shared circuit and retries one isolated timeout', async () => {
  let backgroundCalls = 0;
  let criticalCalls = 0;
  const createdClients = [];
  const createClient = (_url, _key, options = {}) => {
    const timedFetch = options.global.fetch;
    const client = {
      timedFetch,
      from() {
        let inserted = null;
        const query = {
          insert(row) { inserted = { ...row }; return query; },
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          async single() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'POST',
              });
              return { data: inserted, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async maybeSingle() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'GET',
              });
              return { data: null, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        };
        return query;
      },
    };
    createdClients.push(client);
    return client;
  };
  const stateStore = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role-key',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    createClient,
    fetchImpl: async (url) => {
      if (String(url).includes('/background-sync')) {
        backgroundCalls += 1;
        const error = new Error('Supabase client timeout na 1500ms');
        error.name = 'AbortError';
        throw error;
      }
      criticalCalls += 1;
      if (criticalCalls === 1) {
        const error = new Error('Supabase client timeout na 8000ms');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, status: 201, text: async () => '[]' };
    },
  });
  const backgroundClient = stateStore.getSupabaseClient();
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /1500ms/
  );
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /tijdelijk overgeslagen/
  );

  const provenanceStore = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: stateStore.getSupabaseClient,
    retryDelayMs: 0,
  });
  const result = await provenanceStore.reserve({
    intentId: 'send:circuit-isolated', idempotencyKey: 'browser:circuit-isolated', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'reply',
    conversationId: 'conversation:circuit-isolated', replyTargetMessageId: '<incoming@example.nl>',
    references: '<incoming@example.nl>', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Re: Website', body: 'Dankjewel voor je reactie.',
  });

  assert.equal(result.created, true);
  assert.equal(result.intent.status, 'prepared');
  assert.equal(backgroundCalls, 1, 'het gedeelde circuit hoort de tweede achtergrondcall over te slaan');
  assert.equal(criticalCalls, 5, 'de kritieke insert mag pas na geïsoleerde conflict-read-backs opnieuw proberen');
  assert.equal(createdClients.length, 2, 'default- en kritieke clientpolicy horen gescheiden te zijn');
});

test('reserve recovers its exact committed UUID after a response-timeout and starts one provider dispatch', async () => {
  let firstInsert = true;
  const client = createFakeSupabase({
    onInsert: () => {
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: true,
        error: Object.assign(new Error('insert committed but response timed out'), { code: 'ETIMEDOUT' }),
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:40:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:reserve-commit-timeout', idempotencyKey: 'browser:reserve-commit-timeout', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reserve-commit-timeout', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  let providerDispatches = 0;

  const reservation = await claimAndFinalize(store, payload);
  const committedReservationToken = client.rows[0].transition_token;
  if (reservation.created) {
    await store.startDispatch(reservation);
    providerDispatches += 1;
  }

  assert.equal(reservation.created, true);
  assert.equal(reservation.intent.transitionToken, committedReservationToken);
  assert.notEqual(client.rows[0].transition_token, committedReservationToken);
  assert.equal(client.insertCalls, 1, 'een gecommitteerde INSERT-timeout mag geen tweede INSERT doen');
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('pre-dispatchclaim accepteert alleen lege metadata of lowercase SHA-256 per bijlage', async (t) => {
  const basePayload = {
    intentId: 'send:attachment-sha-guard', idempotencyKey: 'browser:attachment-sha-guard',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:attachment-sha-guard', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht',
  };
  const expectRejectedMetadata = async (attachmentsMetadata) => {
    const client = createFakeSupabase();
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () => store.claimPreDispatch({ ...basePayload, attachmentsMetadata }),
      (error) => error.code === 'MAILBOX_SEND_PRE_DISPATCH_ATTACHMENT_CONTEXT_REQUIRED'
    );
    assert.equal(client.rpcCalls.length, 0, 'ongeldige metadata mag de claim-RPC niet bereiken');
    assert.equal(client.rows.length, 0);
  };

  await t.test('legacy metadata zonder hash faalt gesloten', () => expectRejectedMetadata([{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4,
  }]));
  await t.test('uppercase hash faalt gesloten', () => expectRejectedMetadata([{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'A'.repeat(64),
  }]));
  await t.test('gemengde metadata met ontbrekende hash faalt gesloten', () => expectRejectedMetadata([{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }, {
    filename: 'uitleg.txt', contentType: 'text/plain', size: 4,
  }]));

  await t.test('lege metadata blijft geldig', async () => {
    const client = createFakeSupabase();
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      retryDelayMs: 0,
    });
    const claim = await store.claimPreDispatch({ ...basePayload, attachmentsMetadata: [] });
    assert.equal(claim.created, true);
    assert.deepEqual(claim.intent.attachmentsMetadata, []);
  });

  await t.test('ruwe attachmentbytes genereren een lowercase SHA-256 en slagen', async () => {
    const client = createFakeSupabase();
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      retryDelayMs: 0,
    });
    const content = Buffer.from('exacte bewijsbytes', 'utf8');
    const claim = await store.claimPreDispatch({
      ...basePayload,
      intentId: 'send:attachment-raw-bytes',
      idempotencyKey: 'browser:attachment-raw-bytes',
      conversationId: 'draft:attachment-raw-bytes',
      attachments: [{ filename: 'bewijs.pdf', contentType: 'application/pdf', content }],
    });
    assert.equal(claim.created, true);
    assert.match(claim.intent.attachmentsMetadata[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(
      claim.intent.attachmentsMetadata[0].sha256,
      require('crypto').createHash('sha256').update(content).digest('hex')
    );
  });
});

test('legacy string-start gebruikt null-filters en kan geen onafgeronde claim starten', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:legacy-start-must-not-start-claim',
    idempotencyKey: 'browser:legacy-start-must-not-start-claim',
    owner: 'martijn', accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:legacy-start-must-not-start-claim', provider: 'smtp',
    senderName: 'Martijn van de Ven', subject: 'Vraag', body: 'Exact bericht',
    attachmentsMetadata: [],
  };
  const claim = await store.claimPreDispatch(payload);
  const updatesBeforeUnsafeStart = client.updateCalls;

  await assert.rejects(
    () => store.startDispatch(claim.intent.intentId),
    (error) => error.code === 'PGRST116'
  );

  assert.equal(client.updateCalls, updatesBeforeUnsafeStart, 'een onafgeronde claim mag nul updates winnen');
  assert.equal(client.rpcCalls.length, 1, 'alleen de claim-RPC mag zijn aangeroepen');
  assert.equal(claim.intent.dispatchState, 'reserved');
  assert.equal(client.rows[0].dispatch_state, 'reserved');
  assert.ok(client.filterCalls.some((filter) => (
    filter.kind === 'is' && filter.key === 'pre_dispatch_claim_fingerprint' && filter.value === null
  )));
  assert.ok(client.filterCalls.some((filter) => (
    filter.kind === 'is' && filter.key === 'pre_dispatch_finalized_at' && filter.value === null
  )));
});

test('reserve retries the same UUID only after read-back proves the first insert did not commit', async () => {
  let firstInsert = true;
  const attemptedTokens = [];
  const client = createFakeSupabase({
    onInsert: ({ row }) => {
      attemptedTokens.push(row.transition_token);
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: false,
        error: Object.assign(new Error('insert timed out before commit'), { code: 'ETIMEDOUT' }),
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:45:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:reserve-precommit-timeout', idempotencyKey: 'browser:reserve-precommit-timeout', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reserve-precommit-timeout', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };

  const reservation = await store.reserve(payload);

  assert.equal(reservation.created, true);
  assert.equal(client.insertCalls, 2);
  assert.equal(new Set(attemptedTokens).size, 1, 'de bewezen veilige retry behoudt exact hetzelfde reservatietoken');
  assert.equal(reservation.intent.transitionToken, attemptedTokens[0]);
});

test('a committed claim with failed response/read-backs expires to failed and never authorizes dispatch', async () => {
  let currentTime = new Date('2026-08-24T13:47:00.000Z');
  let firstInsert = true;
  const readTimeout = () => Object.assign(new Error('reservation read-back timed out'), { code: 'ETIMEDOUT' });
  const client = createFakeSupabase({
    rpcNow: () => currentTime,
    onInsert: () => {
      if (!firstInsert) return null;
      firstInsert = false;
      return {
        commit: true,
        error: Object.assign(new Error('insert response timed out'), { code: 'ETIMEDOUT' }),
      };
    },
    onMaybeSingle: ({ call }) => call <= 2 ? { error: readTimeout() } : null,
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:lost-reserve-response', idempotencyKey: 'browser:stable-after-reserve-failure', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:lost-reserve-response', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };

  await assert.rejects(() => store.claimPreDispatch({
    ...original, attachmentsMetadata: [],
  }), (error) => error.code === 'ETIMEDOUT');
  const abandonedToken = client.rows[0].transition_token;
  assert.equal(client.rows[0].dispatch_state, 'reserved');
  currentTime = new Date('2026-08-24T14:02:01.000Z');
  const retry = { ...original, intentId: 'send:renewed-after-lost-readback' };

  const renewed = await store.claimPreDispatch({ ...retry, attachmentsMetadata: [] });

  assert.equal(renewed.created, false);
  assert.equal(renewed.intent.intentId, original.intentId);
  assert.equal(renewed.intent.status, 'failed');
  assert.notEqual(renewed.intent.transitionToken, abandonedToken);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].dispatch_state, 'finished');
});

test('an expired reserved row with another idempotency key is failed before a new row is inserted', async () => {
  let currentTime = new Date('2026-08-24T13:48:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => currentTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:expired-other-key-a', idempotencyKey: 'browser:expired-other-key-a', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expired-other-key', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(original);
  currentTime = new Date('2026-08-24T13:48:31.000Z');
  const replacement = {
    ...original,
    intentId: 'send:expired-other-key-b',
    idempotencyKey: 'browser:expired-other-key-b',
  };

  const reserved = await store.reserve(replacement);

  assert.equal(reserved.created, true);
  assert.equal(reserved.intent.intentId, replacement.intentId);
  assert.equal(client.rows.length, 2);
  assert.equal(client.rows.find((row) => row.intent_id === original.intentId).status, 'failed');
  assert.equal(client.rows.find((row) => row.intent_id === replacement.intentId).status, 'prepared');
});

test('preflight reconciliation releases an expired reserved intent through exact CAS', async () => {
  let currentTime = new Date('2026-08-24T13:48:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => currentTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:expired-reconcile', idempotencyKey: 'browser:expired-reconcile', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expired-reconcile', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht', attachmentsMetadata: [],
  };
  await store.reserve(payload);
  currentTime = new Date('2026-08-24T13:48:31.000Z');

  const reconciled = await store.reconcilePreflight(payload.idempotencyKey);

  assert.equal(reconciled.status, 'failed');
  assert.equal(reconciled.dispatchState, 'finished');
  assert.match(reconciled.error, /pre-dispatchreservering verliep/i);
  assert.equal(client.rows[0].status, 'failed');
  assert.equal(client.updateCalls, 1);
});

test('expired-reservation reconciliation rereads started and accepted CAS races without authorizing resend', async (t) => {
  for (const [label, concurrentPatch, expected] of [
    ['started', {
      status: 'prepared', dispatch_state: 'started',
      dispatch_started_at: '2026-08-24T13:49:30.000Z',
      dispatch_lease_expires_at: '2026-08-24T13:51:30.000Z',
      updated_at: '2026-08-24T13:49:30.000Z',
      transition_token: '00000000-0000-4000-8000-000000000091',
    }, { status: 'prepared', dispatchState: 'started' }],
    ['accepted', {
      status: 'accepted', dispatch_state: 'finished',
      dispatch_lease_expires_at: null, sent_message_id: '<accepted-race@example.nl>',
      accepted_at: '2026-08-24T13:49:30.000Z',
      updated_at: '2026-08-24T13:49:30.000Z',
      transition_token: '00000000-0000-4000-8000-000000000092',
    }, { status: 'accepted', dispatchState: 'finished' }],
  ]) {
    await t.test(label, async () => {
      let currentTime = new Date('2026-08-24T13:49:00.000Z');
      let injectRace = true;
      const client = createFakeSupabase({
        rpcNow: () => currentTime,
        onUpdate: ({ patch }) => {
          if (patch.status !== 'failed' || !injectRace) return null;
          injectRace = false;
          return {
            commit: false,
            concurrentPatch,
            error: { code: 'PGRST116', message: 'conditional row changed concurrently' },
          };
        },
      });
      const store = createMailboxSendProvenanceStore({
        isSupabaseConfigured: () => true,
        getSupabaseClient: () => client,
        now: () => currentTime,
        reservationLeaseMs: 30_000,
        retryDelayMs: 0,
      });
      const payload = {
        intentId: `send:expired-race-${label}`,
        idempotencyKey: `browser:expired-race-${label}`,
        owner: 'martijn', accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl',
        mode: 'new-message', conversationId: `draft:expired-race-${label}`, provider: 'smtp',
        senderName: 'Martijn van de Ven', subject: 'Vraag', body: 'Bericht', attachmentsMetadata: [],
      };
      await store.reserve(payload);
      currentTime = new Date('2026-08-24T13:49:31.000Z');

      const reconciled = await store.reconcilePreflight(payload.idempotencyKey);

      assert.equal(reconciled.status, expected.status);
      assert.equal(reconciled.dispatchState, expected.dispatchState);
      assert.notEqual(reconciled.status, 'failed');
      assert.equal(client.rows[0].status, expected.status);
    });
  }
});

test('concurrent same-key claims with distinct intent IDs expose one final token and provider winner', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:49:00.000Z'),
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:reclaim-original', idempotencyKey: 'browser:reclaim-stable', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:reclaim-stable', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  let providerDispatches = 0;
  const flow = async (suffix) => {
    const input = { ...original, intentId: `send:reclaim-${suffix}` };
    const reservation = await claimAndFinalize(store, input);
    if (!reservation.created) return reservation;
    await store.startDispatch(reservation);
    providerDispatches += 1;
    return reservation;
  };

  const results = await Promise.all([flow('one'), flow('two')]);

  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('legacy reserved rows with a null DB lease stay fail-closed instead of using app-clock expiry', async () => {
  let currentTime = new Date('2026-08-24T13:50:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => currentTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    reservationLeaseMs: 30_000,
    retryDelayMs: 0,
  });
  const original = {
    intentId: 'send:legacy-null-lease', idempotencyKey: 'browser:legacy-null-lease', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:legacy-null-lease', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  await store.reserve(original);
  client.rows[0].dispatch_lease_expires_at = null;
  client.rows[0].transition_token = null;
  currentTime = new Date('2026-08-24T13:50:20.000Z');

  const early = await store.reserve({ ...original, intentId: 'send:legacy-too-early' });
  assert.equal(early.created, false);
  assert.equal(client.rows[0].intent_id, original.intentId);

  currentTime = new Date('2026-08-24T13:50:31.000Z');
  const blocked = await store.reserve({ ...original, intentId: 'send:legacy-renewed' });

  assert.equal(blocked.created, false);
  assert.equal(blocked.intent.intentId, original.intentId);
  assert.equal(blocked.intent.status, 'prepared');
  assert.equal(blocked.intent.dispatchState, 'reserved');
  assert.equal(client.rows.length, 1);
});

test('two identical concurrent reserve-and-start flows expose exactly one provider winner', async () => {
  const client = createFakeSupabase();
  const tokens = [
    '00000000-0000-4000-8000-000000000071',
    '00000000-0000-4000-8000-000000000072',
    '00000000-0000-4000-8000-000000000073',
    '00000000-0000-4000-8000-000000000074',
    '00000000-0000-4000-8000-000000000075',
    '00000000-0000-4000-8000-000000000076',
  ];
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T13:50:00.000Z'),
    createTransitionToken: () => tokens.shift(),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:concurrent-reserve', idempotencyKey: 'browser:concurrent-reserve', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:concurrent-reserve', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  let providerDispatches = 0;
  const flow = async () => {
    const reservation = await claimAndFinalize(store, payload);
    if (!reservation.created) return reservation;
    await store.startDispatch(reservation);
    providerDispatches += 1;
    return reservation;
  };

  const reservations = await Promise.all([flow(), flow()]);

  assert.deepEqual(reservations.map((result) => result.created).sort(), [false, true]);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('accepted provenance listing bypasses an open shared circuit with its own bounded client', async () => {
  let backgroundCalls = 0;
  let acceptedListCalls = 0;
  const createdPolicies = [];
  const acceptedRow = {
    intent_id: 'send:accepted-circuit', idempotency_key: 'browser:accepted-circuit',
    owner: 'serve', account_email: 'serve@softora.nl', recipient_email: 'lead@example.nl',
    mode: 'reply', provider: 'smtp', status: 'accepted', dispatch_state: 'finished',
    sent_message_id: '<accepted-circuit@example.nl>', subject: 'Re: Website', body_text: 'Exact antwoord',
    accepted_at: '2026-08-24T13:51:00.000Z', created_at: '2026-08-24T13:50:00.000Z',
    updated_at: '2026-08-24T13:51:00.000Z', transition_token: '00000000-0000-4000-8000-000000000051',
  };
  const createClient = (_url, _key, options = {}) => {
    const timedFetch = options.global.fetch;
    createdPolicies.push(options);
    return {
      timedFetch,
      from() {
        const query = {
          select() { return query; },
          in() { return query; },
          eq() { return query; },
          order() { return query; },
          async limit() {
            try {
              await timedFetch('https://example.supabase.co/rest/v1/softora_mailbox_send_provenance', {
                method: 'GET',
              });
              return { data: [acceptedRow], error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        };
        return query;
      },
    };
  };
  const stateStore = createSupabaseStateStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'service-role-key',
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'runtime_state_main',
    createClient,
    fetchImpl: async (url) => {
      if (String(url).includes('/background-sync')) {
        backgroundCalls += 1;
        const error = new Error('Supabase client timeout na 1500ms');
        error.name = 'AbortError';
        throw error;
      }
      acceptedListCalls += 1;
      return { ok: true, status: 200, text: async () => '[]' };
    },
  });
  const backgroundClient = stateStore.getSupabaseClient();
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /1500ms/
  );
  await assert.rejects(
    backgroundClient.timedFetch('https://example.supabase.co/background-sync'),
    /tijdelijk overgeslagen/
  );

  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: stateStore.getSupabaseClient,
    retryDelayMs: 0,
  });
  const accepted = await store.listAcceptedMessages({ accountEmails: ['SERVE@softora.nl'] });

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].intentId, 'send:accepted-circuit');
  assert.equal(accepted[0].messageId, '<accepted-circuit@example.nl>');
  assert.equal(backgroundCalls, 1);
  assert.equal(acceptedListCalls, 1);
  assert.equal(createdPolicies.length, 2);
  assert.equal(createdPolicies[1].global.fetch === createdPolicies[0].global.fetch, false);
});

test('mailbox send provenance requests the bounded isolated client policy for every send guard query', async () => {
  const requestedPolicies = [];
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: (options) => {
      requestedPolicies.push(options || {});
      return client;
    },
    retryDelayMs: 0,
  });

  await store.reserve({
    intentId: 'send:policy', idempotencyKey: 'browser:policy', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'prospect@example.nl', mode: 'new-message',
    conversationId: 'draft:prospect', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Kleine vraag', body: 'Goedendag',
  });

  assert.deepEqual(requestedPolicies, [{
    timeoutMs: 8000,
    ignoreFailureCooldown: true,
    suppressFailureCooldown: true,
  }]);
});

test('mailbox send provenance fails closed when durable storage is unavailable', async () => {
  const store = createMailboxSendProvenanceStore({ isSupabaseConfigured: () => false });
  await assert.rejects(() => store.reserve({}), (error) => (
    error.code === 'MAILBOX_SEND_PROVENANCE_INVALID' ||
    error.code === 'MAILBOX_SEND_PROVENANCE_UNAVAILABLE'
  ));
});

test('definitieve fail-transitie propageert een opslagfout in plaats van vals succes te melden', async () => {
  const storageError = Object.assign(new Error('fail update geweigerd'), { code: '42501' });
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => patch.status === 'failed'
      ? { commit: false, error: storageError }
      : null,
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:fail-persist', idempotencyKey: 'browser:fail-persist', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:fail-persist', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht', attachmentsMetadata: [],
  };
  const finalized = await claimAndFinalize(store, payload);
  await store.startDispatch(finalized);
  await assert.rejects(() => store.fail(payload.intentId, new Error('SMTP 550')), (error) => (
    error.code === '42501' && /fail update geweigerd/.test(error.message)
  ));
  assert.equal(client.rows[0].status, 'prepared');
  assert.equal(client.rows[0].dispatch_state, 'started');
});

test('semantic reply identity blocks a second browser key before provider dispatch', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });
  const base = {
    owner: 'martijn', accountEmail: 'martijn@websoftora.com', recipientEmail: 'bestuur@example.nl',
    mode: 'reply', conversationId: 'instantly:martijn:thread-1', replyTargetMessageId: 'message-1',
    references: 'message-1', provider: 'instantly', providerThreadId: 'thread-1',
    senderName: 'Martijn van de Ven', subject: 'Re: Vraag', body: 'Antwoord',
  };
  const first = await store.reserve({ ...base, intentId: 'send:first', idempotencyKey: 'browser:first' });
  const second = await store.reserve({ ...base, intentId: 'send:second', idempotencyKey: 'browser:second' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.intent.intentId, 'send:first');
  assert.equal(client.rows.length, 1);
});

test('dispatch state records success and ambiguous provider outcome without allowing blind resend', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-13T10:00:00.000Z'),
  });
  const payload = {
    intentId: 'send:unknown', idempotencyKey: 'browser:unknown', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:lead', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  await store.startDispatch(finalized);
  const unknown = await store.markUnknown(payload.intentId, new Error('timeout'), { sentReconcileRequired: true });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.dispatchState, 'started');
  assert.equal(unknown.reconcileRequired, true);
  assert.equal(unknown.sentReconcileRequired, true);
  const retry = await store.reserve({ ...payload, intentId: 'send:retry', idempotencyKey: 'browser:retry' });
  assert.equal(retry.created, false);
  assert.equal(retry.intent.status, 'unknown');
  const accepted = await store.accept(payload.intentId, { messageId: '<confirmed@example.nl>' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.dispatchState, 'finished');
  assert.equal(accepted.reconcileRequired, false);
});

test('a committed start with a lost response stays pre-provider and aborts through the rotated started fence', async () => {
  const timedOutTransitions = new Set(['started']);
  const timeout = () => Object.assign(new Error('commit succeeded but response timed out'), {
    code: 'ETIMEDOUT',
  });
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      const transition = patch.status === 'accepted' ? 'accepted' : patch.dispatch_state;
      if (timedOutTransitions.delete(transition)) return { commit: true, error: timeout() };
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:00:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:commit-timeout', idempotencyKey: 'browser:commit-timeout', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:commit-timeout', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  const updatesAfterFinalize = client.updateCalls;

  let startError = null;
  await assert.rejects(store.startDispatch(finalized), (error) => {
    startError = error;
    return error.code === 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED'
      && error.intent?.dispatchState === 'started'
      && error.intent?.transitionToken !== finalized.finalToken;
  });
  assert.equal(
    client.updateCalls,
    updatesAfterFinalize + 1,
    'een gecommitteerde start-timeout mag geen tweede PATCH doen'
  );

  const failed = await store.failPreDispatch({
    intent: startError.intent,
    finalToken: startError.intent.transitionToken,
  }, startError);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.dispatchState, 'finished');
  assert.notEqual(failed.transitionToken, startError.intent.transitionToken);
  assert.equal(
    client.updateCalls,
    updatesAfterFinalize + 2,
    'de bewezen pre-providerstart wordt exact eenmaal naar failed geaborteerd'
  );
});

test('started abort-CAS rejects a stale dispatch_started_at fence and preserves the live start', async () => {
  let loseStartResponse = true;
  const client = createFakeSupabase({
    onRpc: ({ name }) => {
      if (name === 'softora_start_mailbox_pre_dispatch' && loseStartResponse) {
        loseStartResponse = false;
        return {
          commit: true,
          error: Object.assign(new Error('start response verloren'), { code: 'ETIMEDOUT' }),
        };
      }
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:03:00.000Z'),
    retryDelayMs: 0,
    logger: { error() {} },
  });
  const payload = {
    intentId: 'send:stale-started-at', idempotencyKey: 'browser:stale-started-at', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:stale-started-at', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  let startError = null;
  await assert.rejects(store.startDispatch(finalized), (error) => {
    startError = error;
    return error.code === 'MAILBOX_SEND_DISPATCH_START_UNCONFIRMED';
  });
  client.rows[0].dispatch_started_at = '2026-08-24T14:03:59.000Z';

  await assert.rejects(store.failPreDispatch({
    intent: startError.intent,
    finalToken: startError.intent.transitionToken,
  }, startError), (error) => error.code === 'PGRST116');
  assert.equal(client.rows[0].status, 'prepared');
  assert.equal(client.rows[0].dispatch_state, 'started');
  assert.equal(client.rows[0].dispatch_started_at, '2026-08-24T14:03:59.000Z');
});

test('accepted transition recovers its exact commit-success response-timeout without a blind retry', async () => {
  let acceptedTimedOut = true;
  const timeout = () => Object.assign(new Error('accepted commit succeeded but response timed out'), {
    code: 'ETIMEDOUT',
  });
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      if (patch.status === 'accepted' && acceptedTimedOut) {
        acceptedTimedOut = false;
        return { commit: true, error: timeout() };
      }
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:05:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:accepted-commit-timeout', idempotencyKey: 'browser:accepted-commit-timeout',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:accepted-commit-timeout', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  const started = await store.startDispatch(finalized);
  const updatesAfterStart = client.updateCalls;
  const accepted = await store.accept(payload.intentId, {
    messageId: '<accepted-commit-timeout@example.nl>',
    acceptedAt: '2026-08-24T14:06:00.000Z',
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.messageId, '<accepted-commit-timeout@example.nl>');
  assert.notEqual(accepted.transitionToken, started.transitionToken);
  assert.equal(
    client.updateCalls,
    updatesAfterStart + 1,
    'ook accepted read-back herstelt zonder blinde PATCH-retry'
  );
});

test('start timeout before commit stays fail-closed and never performs a second start RPC', async () => {
  let firstStartAttempt = true;
  const client = createFakeSupabase({
    onUpdate: ({ patch }) => {
      if (!patch.status && patch.dispatch_state === 'started' && firstStartAttempt) {
        firstStartAttempt = false;
        return {
          commit: false,
          error: Object.assign(new Error('request timed out before commit'), { code: 'ETIMEDOUT' }),
        };
      }
      return null;
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:10:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:read-confirmed-retry', idempotencyKey: 'browser:read-confirmed-retry', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:read-confirmed-retry', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  const updatesAfterFinalize = client.updateCalls;

  await assert.rejects(store.startDispatch(finalized), (error) => error.code === 'ETIMEDOUT');
  assert.equal(client.updateCalls, updatesAfterFinalize + 1);
  assert.equal(client.rpcCalls.filter(({ name }) => name === 'softora_start_mailbox_pre_dispatch').length, 1);
  assert.equal(client.rows[0].dispatch_state, 'reserved');
  assert.equal(client.rows[0].transition_token, finalized.finalToken);
});

test('two concurrent starts with the same clock expose exactly one dispatch winner', async () => {
  const client = createFakeSupabase();
  const transitionTokens = [
    '00000000-0000-4000-8000-000000000060',
    '00000000-0000-4000-8000-000000000061',
    '00000000-0000-4000-8000-000000000062',
    '00000000-0000-4000-8000-000000000063',
  ];
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-08-24T14:20:00.000Z'),
    createTransitionToken: () => transitionTokens.shift(),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:concurrent-start', idempotencyKey: 'browser:concurrent-start', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:concurrent-start', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  let providerDispatches = 0;
  const dispatch = async () => {
    const started = await store.startDispatch(finalized);
    providerDispatches += 1;
    return started;
  };

  const results = await Promise.allSettled([dispatch(), dispatch()]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(providerDispatches, 1);
  assert.equal(client.rows[0].transition_token, fulfilled[0].value.transitionToken);
  assert.equal(client.rows[0].dispatch_state, 'started');
  assert.equal(rejected[0].reason.code, 'PGRST116');
});

test('an expired started lease becomes explicit reconciliation and is never reopened for resend', async () => {
  let currentTime = new Date('2026-08-24T15:00:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => currentTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:expired-start', idempotencyKey: 'browser:expired-start', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expired-start', provider: 'smtp', senderName: 'Martijn van de Ven',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  await store.startDispatch(finalized, 30_000);
  currentTime = new Date('2026-08-24T15:01:00.000Z');

  const repeated = await store.reserve({
    ...payload,
    intentId: 'send:expired-retry',
    idempotencyKey: 'browser:expired-retry',
  });

  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'unknown');
  assert.equal(repeated.intent.dispatchState, 'started');
  assert.equal(repeated.intent.reconcileRequired, true);
  assert.equal(repeated.intent.sentReconcileRequired, true);
  assert.match(repeated.intent.error, /provideruitkomst moet eerst worden gereconcilieerd/i);
  assert.equal(client.rows.length, 1);
});

test('accepted terminal evidence safely wins a race against expired-lease reconciliation', async () => {
  let currentTime = new Date('2026-08-24T15:10:00.000Z');
  let injectAcceptedRace = true;
  const client = createFakeSupabase({
    rpcNow: () => currentTime,
    onUpdate: ({ patch }) => {
      if (patch.status !== 'unknown' || !injectAcceptedRace) return null;
      injectAcceptedRace = false;
      return {
        commit: false,
        concurrentPatch: {
          status: 'accepted',
          dispatch_state: 'finished',
          dispatch_lease_expires_at: null,
          sent_message_id: '<accepted-during-expiry@example.nl>',
          accepted_at: '2026-08-24T15:10:45.000Z',
          reconcile_required: false,
          sent_reconcile_required: false,
          transition_token: '00000000-0000-4000-8000-000000000081',
        },
        error: { code: 'PGRST116', message: 'conditional row changed concurrently' },
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => currentTime,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:expiry-accept-race', idempotencyKey: 'browser:expiry-accept-race', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:expiry-accept-race', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht',
  };
  const finalized = await claimAndFinalize(store, payload);
  await store.startDispatch(finalized, 30_000);
  currentTime = new Date('2026-08-24T15:11:00.000Z');

  const repeated = await store.reserve(payload);

  assert.equal(repeated.created, false);
  assert.equal(repeated.intent.status, 'accepted');
  assert.equal(repeated.intent.messageId, '<accepted-during-expiry@example.nl>');
  assert.equal(client.rows[0].status, 'accepted');
  assert.equal(client.rows[0].reconcile_required, false);
});

test('missing canonical sender values fail before any provenance insert', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  });
  await assert.rejects(() => store.reserve({
    intentId: 'send:invalid', idempotencyKey: 'browser:invalid', owner: ' ', accountEmail: '',
    recipientEmail: 'lead@example.nl', mode: 'new-message', provider: 'smtp', subject: 'Vraag', body: 'Body',
  }), (error) => error.code === 'MAILBOX_SEND_PROVENANCE_INVALID');
  assert.equal(client.rows.length, 0);
});

test('claim en finalize herstellen gecommitteerde response-timeouts zonder dubbele providerwinnaar', async () => {
  let finalizeResponseLost = true;
  const timeout = () => Object.assign(new Error('commit bevestigd maar response verloren'), {
    code: 'ETIMEDOUT',
  });
  const client = createFakeSupabase({
    onInsert: () => ({ commit: true, error: timeout() }),
    onUpdate: ({ patch }) => {
      if (patch.pre_dispatch_finalized_at && finalizeResponseLost) {
        finalizeResponseLost = false;
        return { commit: true, error: timeout() };
      }
      return null;
    },
  });
  const tokens = [
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
  ];
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    createTransitionToken: () => tokens.shift(),
    now: () => new Date('2026-08-27T18:00:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:claim-response-timeout', idempotencyKey: 'browser:claim-response-timeout',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:claim-response-timeout', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };

  const claim = await store.claimPreDispatch(payload);
  const finalized = await store.finalizeClaim(claim, payload);
  let providerWinners = 0;
  await store.startDispatch(finalized);
  providerWinners += 1;

  assert.equal(claim.created, true);
  assert.equal(client.insertCalls, 1, 'claim-timeout mag geen tweede INSERT starten');
  assert.equal(client.updateCalls, 2, 'finalize-timeout herstelt via read-back vóór één start-CAS');
  assert.equal(providerWinners, 1);
  assert.equal(client.rows[0].dispatch_state, 'started');
  assert.equal(client.rows[0].transition_token, '00000000-0000-4000-8000-000000000103');
});

test('databaseklok blijft leidend voor finalize en start bij extreme app-clock skew', async () => {
  let rpcTick = 0;
  const client = createFakeSupabase({
    rpcNow: () => new Date(Date.parse('2026-08-27T18:10:00.000Z') + (rpcTick += 1) * 1000),
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2099-08-27T18:10:00.000Z'),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:database-clock-skew', idempotencyKey: 'browser:database-clock-skew',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:database-clock-skew', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };

  const finalized = await claimAndFinalize(store, payload);
  const started = await store.startDispatch(finalized);

  assert.equal(started.dispatchState, 'started');
  assert.ok(Date.parse(started.dispatchLeaseExpiresAt) < Date.parse('2099-01-01T00:00:00.000Z'));
  assert.equal(client.rpcCalls.length, 3);
});

test('appklok plus 24 uur kan actieve reserved en started DB-leases niet laten verlopen', async (t) => {
  await t.test('reserved', async () => {
    let dbTime = new Date('2026-08-27T18:20:00.000Z');
    const client = createFakeSupabase({ rpcNow: () => dbTime });
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      now: () => new Date('2026-08-28T18:20:00.000Z'),
      retryDelayMs: 0,
    });
    const payload = {
      intentId: 'send:active-db-reserved', idempotencyKey: 'browser:active-db-reserved',
      owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
      mode: 'new-message', conversationId: 'draft:active-db-reserved', provider: 'smtp',
      senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
    };
    await store.claimPreDispatch(payload);
    dbTime = new Date('2026-08-27T18:21:00.000Z');

    const reconciled = await store.reconcilePreflight(payload.idempotencyKey);

    assert.equal(reconciled.status, 'prepared');
    assert.equal(reconciled.dispatchState, 'reserved');
    assert.equal(client.rows[0].transition_token, reconciled.transitionToken);
    assert.equal(client.updateCalls, 0);
  });

  await t.test('started', async () => {
    let dbTime = new Date('2026-08-27T18:30:00.000Z');
    const client = createFakeSupabase({ rpcNow: () => dbTime });
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      now: () => new Date('2026-08-28T18:30:00.000Z'),
      retryDelayMs: 0,
    });
    const payload = {
      intentId: 'send:active-db-started', idempotencyKey: 'browser:active-db-started',
      owner: 'martijn', accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl',
      mode: 'new-message', conversationId: 'draft:active-db-started', provider: 'smtp',
      senderName: 'Martijn van de Ven', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
    };
    const claim = await store.claimPreDispatch(payload);
    dbTime = new Date('2026-08-27T18:30:01.000Z');
    const finalized = await store.finalizeClaim(claim, payload);
    dbTime = new Date('2026-08-27T18:30:02.000Z');
    const started = await store.startDispatch(finalized);
    dbTime = new Date('2026-08-27T18:31:00.000Z');

    const repeated = await store.reserve({
      ...payload,
      intentId: 'send:active-db-started-retry',
      idempotencyKey: 'browser:active-db-started-retry',
    });

    assert.equal(repeated.created, false);
    assert.equal(repeated.intent.status, 'prepared');
    assert.equal(repeated.intent.dispatchState, 'started');
    assert.equal(repeated.intent.transitionToken, started.transitionToken);
  });
});

test('expiry-RPC fences geven bij stale waarden nul rijen en slechts één concurrente winnaar', async () => {
  let dbTime = new Date('2026-08-27T18:40:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => dbTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:reserved-expiry-fences', idempotencyKey: 'browser:reserved-expiry-fences',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:reserved-expiry-fences', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };
  const claim = await store.claimPreDispatch(payload);
  dbTime = new Date('2026-08-27T18:40:01.000Z');
  await store.finalizeClaim(claim, payload);
  const row = client.rows[0];
  dbTime = new Date(Date.parse(row.dispatch_lease_expires_at) + 1);
  const valid = {
    p_intent_id: row.intent_id,
    p_expected_transition_token: row.transition_token,
    p_expected_dispatch_lease_expires_at: row.dispatch_lease_expires_at,
    p_expected_updated_at: row.updated_at,
    p_expected_claim_fingerprint: row.pre_dispatch_claim_fingerprint,
    p_expected_finalized_at: row.pre_dispatch_finalized_at,
    p_next_transition_token: '00000000-0000-4000-8000-000000000301',
  };
  const staleCases = [
    { p_expected_transition_token: '00000000-0000-4000-8000-000000000399' },
    { p_expected_dispatch_lease_expires_at: '2026-08-27T18:00:00.000Z' },
    { p_expected_updated_at: '2026-08-27T18:00:00.000Z' },
    { p_expected_claim_fingerprint: 'f'.repeat(64) },
    { p_expected_finalized_at: '2026-08-27T18:00:00.000Z' },
  ];
  for (const changed of staleCases) {
    const result = await client.rpc('softora_expire_mailbox_reserved_dispatch', {
      ...valid,
      ...changed,
    });
    assert.deepEqual(result.data, []);
    assert.equal(row.status, 'prepared');
  }

  const concurrent = await Promise.all([
    client.rpc('softora_expire_mailbox_reserved_dispatch', valid),
    client.rpc('softora_expire_mailbox_reserved_dispatch', valid),
  ]);
  assert.deepEqual(concurrent.map((result) => result.data.length).sort(), [0, 1]);
  assert.equal(row.status, 'failed');
  assert.equal(row.transition_token, valid.p_next_transition_token);
});

test('started expiry weigert een stale dispatch_started_at fence', async () => {
  let dbTime = new Date('2026-08-27T18:50:00.000Z');
  const client = createFakeSupabase({ rpcNow: () => dbTime });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:started-expiry-fence', idempotencyKey: 'browser:started-expiry-fence',
    owner: 'martijn', accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:started-expiry-fence', provider: 'smtp',
    senderName: 'Martijn van de Ven', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };
  const claim = await store.claimPreDispatch(payload);
  dbTime = new Date('2026-08-27T18:50:01.000Z');
  const finalized = await store.finalizeClaim(claim, payload);
  dbTime = new Date('2026-08-27T18:50:02.000Z');
  await store.startDispatch(finalized, 30_000);
  const row = client.rows[0];
  dbTime = new Date(Date.parse(row.dispatch_lease_expires_at) + 1);

  const result = await client.rpc('softora_expire_mailbox_started_dispatch', {
    p_intent_id: row.intent_id,
    p_expected_transition_token: row.transition_token,
    p_expected_dispatch_lease_expires_at: row.dispatch_lease_expires_at,
    p_expected_updated_at: row.updated_at,
    p_expected_claim_fingerprint: row.pre_dispatch_claim_fingerprint,
    p_expected_finalized_at: row.pre_dispatch_finalized_at,
    p_expected_dispatch_started_at: '2026-08-27T18:00:00.000Z',
    p_next_transition_token: '00000000-0000-4000-8000-000000000302',
  });

  assert.deepEqual(result.data, []);
  assert.equal(row.status, 'prepared');
  assert.equal(row.dispatch_state, 'started');
});

test('lost started-expiry response herstelt uitsluitend via eigen token en exacte unknown-eindstaat', async () => {
  let dbTime = new Date('2026-08-27T19:00:00.000Z');
  let loseExpiryResponse = true;
  const expiryToken = '00000000-0000-4000-8000-000000000304';
  const tokens = [
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000303',
    expiryToken,
  ];
  const client = createFakeSupabase({
    rpcNow: () => dbTime,
    onRpc: ({ name }) => {
      if (name !== 'softora_expire_mailbox_started_dispatch' || !loseExpiryResponse) return null;
      loseExpiryResponse = false;
      return {
        commit: true,
        error: Object.assign(new Error('expiry commit response lost'), { code: 'ETIMEDOUT' }),
      };
    },
  });
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    createTransitionToken: () => tokens.shift(),
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:lost-started-expiry', idempotencyKey: 'browser:lost-started-expiry',
    owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:lost-started-expiry', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };
  const claim = await store.claimPreDispatch(payload);
  dbTime = new Date('2026-08-27T19:00:01.000Z');
  const finalized = await store.finalizeClaim(claim, payload);
  dbTime = new Date('2026-08-27T19:00:02.000Z');
  await store.startDispatch(finalized, 30_000);
  dbTime = new Date('2026-08-27T19:00:33.000Z');

  const reconciled = await store.reconcilePreflight(payload.idempotencyKey);

  assert.equal(reconciled.status, 'unknown');
  assert.equal(reconciled.dispatchState, 'started');
  assert.equal(reconciled.reconcileRequired, true);
  assert.equal(reconciled.sentReconcileRequired, true);
  assert.equal(reconciled.transitionToken, expiryToken);
  assert.equal(client.rpcCalls.filter(
    ({ name }) => name === 'softora_expire_mailbox_started_dispatch'
  ).length, 1);
});

test('legacy startDispatch(intentId) blijft compatibel naast de gefencete handle-route', async () => {
  const client = createFakeSupabase();
  const startedAt = new Date('2026-08-27T19:10:00.000Z');
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => startedAt,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:legacy-start-adapter', idempotencyKey: 'browser:legacy-start-adapter',
    owner: 'martijn', accountEmail: 'martijn@softora.nl', recipientEmail: 'lead@example.nl',
    mode: 'new-message', conversationId: 'draft:legacy-start-adapter', provider: 'smtp',
    senderName: 'Martijn van de Ven', subject: 'Vraag', body: 'Exact bericht',
  };
  await store.reserve(payload);

  const started = await store.startDispatch(payload.intentId, 45_000);

  assert.equal(started.status, 'prepared');
  assert.equal(started.dispatchState, 'started');
  assert.equal(started.dispatchStartedAt, startedAt.toISOString());
  assert.equal(started.dispatchLeaseExpiresAt, '2026-08-27T19:10:45.000Z');
  assert.equal(client.rpcCalls.length, 0);
  assert.equal(client.updateCalls, 1);
});

test('faseovergangen weigeren tokenhergebruik vóór iedere database- of providerautorisatie', async (t) => {
  const tokenA = '00000000-0000-4000-8000-000000000201';
  const tokenB = '00000000-0000-4000-8000-000000000202';
  const payload = {
    intentId: 'send:token-reuse', idempotencyKey: 'browser:token-reuse', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:token-reuse', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Exact bericht', attachmentsMetadata: [],
  };

  await t.test('claim naar finalize', async () => {
    const tokens = [tokenA, tokenA];
    const client = createFakeSupabase();
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      createTransitionToken: () => tokens.shift(),
      retryDelayMs: 0,
    });
    const claim = await store.claimPreDispatch(payload);
    await assert.rejects(store.finalizeClaim(claim, payload), (error) => (
      error.code === 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED'
      && /fasetoken niet roteerde/.test(error.message)
    ));
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.rows[0].pre_dispatch_finalized_at, null);
  });

  await t.test('finalize naar start', async () => {
    const tokens = [tokenA, tokenB, tokenB];
    const client = createFakeSupabase();
    const store = createMailboxSendProvenanceStore({
      isSupabaseConfigured: () => true,
      getSupabaseClient: () => client,
      createTransitionToken: () => tokens.shift(),
      retryDelayMs: 0,
    });
    const finalized = await claimAndFinalize(store, {
      ...payload,
      intentId: 'send:start-token-reuse',
      idempotencyKey: 'browser:start-token-reuse',
      conversationId: 'draft:start-token-reuse',
    });
    await assert.rejects(store.startDispatch(finalized), (error) => (
      error.code === 'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED'
      && /fasetoken niet roteerde/.test(error.message)
    ));
    assert.equal(client.rpcCalls.length, 2, 'alleen claim en finalize mogen de database bereiken');
    assert.equal(client.rows[0].dispatch_state, 'reserved');
  });
});

test('claimtoken bindt account thread requestpayload en attachmentbytes vóór iedere finalisatie', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const metadata = [{
    filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'a'.repeat(64),
  }];
  const payload = {
    intentId: 'send:claim-tamper', idempotencyKey: 'browser:claim-tamper', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'reply',
    conversationId: 'conversation:claim-tamper', replyTargetMessageId: '<incoming@example.nl>',
    references: '<root@example.nl> <incoming@example.nl>', provider: 'smtp',
    senderName: 'Servé Creusen', subject: 'Re: Vraag', body: 'Exact antwoord',
    requestBody: 'Exact antwoord', attachmentsMetadata: metadata,
  };
  const claim = await store.claimPreDispatch(payload);
  const cases = [
    ['verkeerd token', { ...claim, claimToken: '00000000-0000-4000-8000-ffffffffffff' }, payload],
    ['account in handle', {
      ...claim, intent: { ...claim.intent, accountEmail: 'martijn@softora.nl' },
    }, payload],
    ['account in input', claim, { ...payload, owner: 'martijn', accountEmail: 'martijn@softora.nl' }],
    ['thread', claim, { ...payload, conversationId: 'conversation:ander' }],
    ['references', claim, { ...payload, references: '<ander@example.nl>' }],
    ['requestbody', claim, { ...payload, body: 'Gewijzigd', requestBody: 'Gewijzigd' }],
    ['attachmenthash', claim, {
      ...payload,
      attachmentsMetadata: [{ ...metadata[0], sha256: 'b'.repeat(64) }],
    }],
  ];

  for (const [label, handle, changedInput] of cases) {
    await assert.rejects(
      () => store.finalizeClaim(handle, changedInput),
      (error) => ['MAILBOX_SEND_PRE_DISPATCH_CLAIM_MISMATCH', 'MAILBOX_SEND_PRE_DISPATCH_FINALIZE_MISMATCH']
        .includes(error.code),
      label
    );
  }
  assert.equal(client.updateCalls, 0, 'geen enkele tampercase mag de durable claim muteren');
  assert.equal(client.rows[0].dispatch_state, 'reserved');
  assert.equal(client.rows[0].pre_dispatch_finalized_at, null);
});

test('cross-account en stale tokens kunnen geen finalisatie start of fail-transitie winnen', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const serve = {
    intentId: 'send:serve-token', idempotencyKey: 'browser:serve-token', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'serve-lead@example.nl', mode: 'new-message',
    conversationId: 'draft:serve-token', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Serve', attachmentsMetadata: [],
  };
  const martijn = {
    ...serve,
    intentId: 'send:martijn-token', idempotencyKey: 'browser:martijn-token', owner: 'martijn',
    accountEmail: 'martijn@softora.nl', recipientEmail: 'martijn-lead@example.nl',
    conversationId: 'draft:martijn-token', senderName: 'Martijn van de Ven', body: 'Martijn',
  };
  const serveClaim = await store.claimPreDispatch(serve);
  const martijnClaim = await store.claimPreDispatch(martijn);

  await assert.rejects(() => store.finalizeClaim({
    ...serveClaim,
    claimToken: martijnClaim.claimToken,
  }, serve), (error) => error.code === 'MAILBOX_SEND_PRE_DISPATCH_CLAIM_MISMATCH');

  const finalized = await store.finalizeClaim(serveClaim, serve);
  await assert.rejects(
    () => store.startDispatch(serveClaim),
    (error) => error.code === 'MAILBOX_SEND_FINAL_TOKEN_REQUIRED'
  );
  await assert.rejects(
    () => store.startDispatch({ ...finalized, finalToken: serveClaim.claimToken }),
    (error) => error.code === 'MAILBOX_SEND_FINAL_TOKEN_REQUIRED'
  );
  await assert.rejects(
    () => store.failPreDispatch(serveClaim, new Error('stale crash')),
    (error) => error.code === 'PGRST116'
  );

  assert.equal(client.rows.find((row) => row.intent_id === serve.intentId).dispatch_state, 'reserved');
  assert.ok(client.rows.find((row) => row.intent_id === serve.intentId).pre_dispatch_finalized_at);
  assert.equal(client.rows.find((row) => row.intent_id === martijn.intentId).pre_dispatch_finalized_at, null);
});

test('crash vóór provider wordt exact failed en kan daarna niet alsnog dispatchen', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:pre-provider-crash', idempotencyKey: 'browser:pre-provider-crash', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'new-message',
    conversationId: 'draft:pre-provider-crash', provider: 'smtp', senderName: 'Servé Creusen',
    subject: 'Vraag', body: 'Bericht', attachmentsMetadata: [],
  };
  const claim = await store.claimPreDispatch(payload);
  const finalized = await store.finalizeClaim(claim, payload);
  const failed = await store.failPreDispatch(finalized, new Error('guard crash vóór SMTP'));

  assert.equal(failed.status, 'failed');
  assert.equal(failed.dispatchState, 'finished');
  assert.match(failed.error, /guard crash vóór SMTP/);
  await assert.rejects(
    () => store.startDispatch(finalized),
    (error) => error.code === 'PGRST116'
  );
  assert.equal(client.rows[0].status, 'failed');
  assert.equal(client.rows[0].dispatch_state, 'finished');
});

test('Buffer en Base64 met gelijke naam type en grootte blijven op echte bytes onderscheiden', () => {
  const shared = { filename: 'bewijs.pdf', contentType: 'application/pdf' };
  const bufferMetadata = createMailboxAttachmentsMetadataFromContent([{
    ...shared, content: Buffer.from([1, 2, 3, 4]),
  }]);
  const base64Metadata = createMailboxAttachmentsMetadataFromContent([{
    ...shared, contentBase64: Buffer.from([4, 3, 2, 1]).toString('base64'),
  }]);

  assert.deepEqual(bufferMetadata.map(({ filename, contentType, size }) => ({ filename, contentType, size })),
    base64Metadata.map(({ filename, contentType, size }) => ({ filename, contentType, size })));
  assert.notEqual(bufferMetadata[0].sha256, base64Metadata[0].sha256);
});

test('lange body references en JSON metadata blijven buiten de compacte PostgREST CAS-fence', async () => {
  const client = createFakeSupabase();
  const store = createMailboxSendProvenanceStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    retryDelayMs: 0,
  });
  const payload = {
    intentId: 'send:compact-cas', idempotencyKey: 'browser:compact-cas', owner: 'serve',
    accountEmail: 'serve@softora.nl', recipientEmail: 'lead@example.nl', mode: 'reply',
    conversationId: 'conversation:compact-cas', replyTargetMessageId: '<incoming@example.nl>',
    references: `<root@example.nl> ${'x'.repeat(120_000)} <incoming@example.nl>`,
    provider: 'smtp', senderName: 'Servé Creusen', subject: 'Re: Lange mail',
    body: 'b'.repeat(200_000), requestBody: 'b'.repeat(200_000),
    attachmentsMetadata: [{
      filename: 'bewijs.pdf', contentType: 'application/pdf', size: 4, sha256: 'c'.repeat(64),
    }],
  };
  const claim = await store.claimPreDispatch(payload);
  const beforeFinalize = client.filterCalls.length;
  const finalized = await store.finalizeClaim(claim, payload);
  const finalizeFilters = client.filterCalls.slice(beforeFinalize);
  const beforeStart = client.filterCalls.length;
  await store.startDispatch(finalized);
  const startFilters = client.filterCalls.slice(beforeStart);
  const allowedKeys = new Set([
    'intent_id', 'status', 'dispatch_state', 'transition_token', 'dispatch_lease_expires_at',
    'updated_at', 'pre_dispatch_claim_fingerprint', 'pre_dispatch_finalized_at',
  ]);

  for (const filter of [...finalizeFilters, ...startFilters]) {
    assert.equal(allowedKeys.has(filter.key), true, `onverwachte CAS-filter ${filter.key}`);
    assert.ok(JSON.stringify(filter.value).length < 200, `${filter.key} bevatte een grote payloadwaarde`);
  }
  assert.equal([...finalizeFilters, ...startFilters].some((filter) => (
    ['body_text', 'references_text', 'attachments_metadata'].includes(filter.key)
  )), false);
  assert.equal(client.rows[0].dispatch_state, 'started');
});
