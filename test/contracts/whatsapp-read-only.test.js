const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createWhatsAppReadOnlyService } = require('../../server/services/whatsapp-read-only');
const { registerWhatsAppReadOnlyRoutes } = require('../../server/routes/whatsapp-read-only');

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const APP_SECRET = 'test-whatsapp-app-secret';
const VERIFY_TOKEN = 'test-whatsapp-verify-token';
const READ_TOKEN = 'test-whatsapp-read-token';
const PROVIDER_WEBHOOK_TOKEN = 'provider-webhook-token-with-at-least-43-characters';
const YCLOUD_WEBHOOK_SECRET = 'whsec_0123456789abcdef0123456789abcdef';
const YCLOUD_WEBHOOK_TOLERANCE_SECONDS = 300;
const TEST_NOW = new Date('2026-08-13T09:00:00.000Z');

function createMemorySupabase() {
  const tables = {
    softora_whatsapp_webhook_events: [],
    softora_whatsapp_messages: [],
    softora_whatsapp_contacts: [],
    softora_whatsapp_sync_state: [],
  };
  const rpcCalls = [];

  function from(tableName) {
    const state = {
      action: 'select',
      values: null,
      filters: [],
      order: null,
      limit: null,
      count: null,
      head: false,
      onConflict: '',
      ignoreDuplicates: false,
    };

    function matches(row) {
      return state.filters.every((filter) => filter(row));
    }

    function execute() {
      const rows = tables[tableName] || (tables[tableName] = []);
      if (state.action === 'select') {
        let selected = rows.filter(matches).map((row) => structuredClone(row));
        if (state.order) {
          selected.sort((left, right) => {
            const compared = String(left[state.order.column] || '').localeCompare(String(right[state.order.column] || ''));
            return state.order.ascending ? compared : -compared;
          });
        }
        if (Number.isInteger(state.limit)) selected = selected.slice(0, state.limit);
        return {
          data: state.head ? null : selected,
          count: state.count === 'exact' ? rows.filter(matches).length : null,
          error: null,
        };
      }
      if (state.action === 'insert') {
        const values = Array.isArray(state.values) ? state.values : [state.values];
        rows.push(...values.map((value) => structuredClone(value)));
        return { data: values, error: null };
      }
      if (state.action === 'update') {
        const updated = [];
        for (const row of rows) {
          if (!matches(row)) continue;
          Object.assign(row, structuredClone(state.values));
          updated.push(structuredClone(row));
        }
        return { data: updated, error: null };
      }
      if (state.action === 'upsert') {
        const values = Array.isArray(state.values) ? state.values : [state.values];
        const keys = String(state.onConflict || '').split(',').filter(Boolean);
        for (const value of values) {
          const index = keys.length
            ? rows.findIndex((row) => keys.every((key) => row[key] === value[key]))
            : -1;
          if (index >= 0 && state.ignoreDuplicates) continue;
          if (index >= 0) rows[index] = { ...rows[index], ...structuredClone(value) };
          else rows.push(structuredClone(value));
        }
        return { data: values, error: null };
      }
      return { data: null, error: new Error(`Unsupported ${state.action}`) };
    }

    const builder = {
      select(_columns, options = {}) {
        state.action = 'select';
        state.count = options.count || null;
        state.head = Boolean(options.head);
        return builder;
      },
      insert(values) { state.action = 'insert'; state.values = values; return builder; },
      update(values) { state.action = 'update'; state.values = values; return builder; },
      upsert(values, options = {}) {
        state.action = 'upsert';
        state.values = values;
        state.onConflict = options.onConflict || '';
        state.ignoreDuplicates = Boolean(options.ignoreDuplicates);
        return builder;
      },
      eq(column, value) { state.filters.push((row) => row[column] === value); return builder; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return builder; },
      gte(column, value) { state.filters.push((row) => String(row[column]) >= String(value)); return builder; },
      lte(column, value) { state.filters.push((row) => String(row[column]) <= String(value)); return builder; },
      overlaps(column, values) {
        state.filters.push((row) => (row[column] || []).some((value) => values.includes(value)));
        return builder;
      },
      contains(column, values) {
        state.filters.push((row) => values.every((value) => (row[column] || []).includes(value)));
        return builder;
      },
      order(column, options = {}) { state.order = { column, ascending: options.ascending !== false }; return builder; },
      limit(value) { state.limit = Number(value); return builder; },
      maybeSingle: async () => {
        const result = execute();
        return { data: result.data?.[0] || null, error: result.error };
      },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return builder;
  }

  async function rpc(name, args) {
    rpcCalls.push([name, structuredClone(args)]);
    if (name === 'softora_claim_whatsapp_webhook_events') {
      const claimed = tables.softora_whatsapp_webhook_events
        .filter((event) => ['pending', 'retry'].includes(event.status))
        .slice(0, args.p_limit);
      for (const event of claimed) {
        event.status = 'processing';
        event.attempts = Number(event.attempts || 0) + 1;
        event.lock_token = args.p_lock_token;
      }
      return { data: structuredClone(claimed), error: null };
    }
    if (name === 'softora_upsert_whatsapp_messages') {
      for (const message of args.p_messages) {
        const index = tables.softora_whatsapp_messages.findIndex((row) => row.message_key === message.message_key);
        if (index >= 0) {
          const stored = tables.softora_whatsapp_messages[index];
          const incoming = structuredClone(message);
          tables.softora_whatsapp_messages[index] = {
            ...stored,
            ...incoming,
            direction: incoming.edited_at || incoming.revoked_at ? stored.direction : incoming.direction,
            content_encrypted: incoming.revoked_at
              ? incoming.content_encrypted
              : stored.revoked_at || (stored.edited_at && !incoming.edited_at)
                ? stored.content_encrypted
                : incoming.content_encrypted,
            content_search_keys: incoming.revoked_at
              ? []
              : stored.revoked_at || (stored.edited_at && !incoming.edited_at)
                ? stored.content_search_keys
                : incoming.content_search_keys,
            message_type: incoming.revoked_at
              ? 'revoked'
              : stored.revoked_at || (stored.edited_at && !incoming.edited_at)
                ? stored.message_type
                : incoming.message_type,
            edited_at: incoming.edited_at || stored.edited_at || null,
            revoked_at: incoming.revoked_at || stored.revoked_at || null,
          };
        }
        else tables.softora_whatsapp_messages.push(structuredClone(message));
      }
      return { data: args.p_messages.length, error: null };
    }
    if (name === 'softora_upsert_whatsapp_contacts') {
      for (const contact of args.p_contacts) {
        const index = tables.softora_whatsapp_contacts.findIndex((row) => row.conversation_key === contact.conversation_key);
        if (index >= 0) {
          const searchKeys = [...new Set([
            ...(tables.softora_whatsapp_contacts[index].search_keys || []),
            ...(contact.search_keys || []),
          ])];
          tables.softora_whatsapp_contacts[index] = {
            ...tables.softora_whatsapp_contacts[index],
            ...structuredClone(contact),
            search_keys: searchKeys,
          };
        } else tables.softora_whatsapp_contacts.push(structuredClone(contact));
      }
      return { data: args.p_contacts.length, error: null };
    }
    return { data: null, error: new Error(`Unknown RPC ${name}`) };
  }

  return { client: { from, rpc }, tables, rpcCalls };
}

function createService(memory, now = new Date('2026-08-13T09:00:00.000Z'), config = {}) {
  return createWhatsAppReadOnlyService({
    config: {
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      encryptionKey: ENCRYPTION_KEY,
      readToken: READ_TOKEN,
      ownerKey: 'serve',
      ...config,
    },
    getSupabaseClient: () => memory.client,
    now: () => new Date(now),
    randomBytes: (size) => Buffer.alloc(size, 5),
  });
}

function createYCloudService(memory, now = TEST_NOW, config = {}) {
  return createService(memory, now, {
    ycloudWebhookSecret: YCLOUD_WEBHOOK_SECRET,
    ycloudWebhookToleranceSeconds: YCLOUD_WEBHOOK_TOLERANCE_SECONDS,
    ...config,
  });
}

function signedPayload(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    signature: `sha256=${crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`,
  };
}

function signedYCloudPayload(payload, options = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestampSeconds = Number.isSafeInteger(options.timestampSeconds)
    ? options.timestampSeconds
    : Math.floor(TEST_NOW.getTime() / 1000);
  const secret = options.secret || YCLOUD_WEBHOOK_SECRET;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(Buffer.from(`${timestampSeconds}.`, 'utf8'))
    .update(rawBody)
    .digest('hex');
  return {
    rawBody,
    signature: `t=${timestampSeconds},s=${signature}`,
  };
}

function ycloudInboundPayload(overrides = {}) {
  return {
    id: 'evt-inbound',
    type: 'whatsapp.inbound_message.received',
    apiVersion: 'v2',
    createTime: '2026-08-13T08:31:00.000Z',
    whatsappInboundMessage: {
      id: 'ycloud-inbound-id',
      wamid: 'wamid.ycloud-inbound-1',
      wabaId: 'waba-1',
      from: '31622222222',
      to: '31611111111',
      sendTime: '2026-08-13T08:31:00.000Z',
      customerProfile: { name: 'Jolanda Voorbeeld' },
      type: 'text',
      text: { body: 'YCloud inkomend bericht.' },
      ...(overrides.message || {}),
    },
    ...overrides.event,
  };
}

function ycloudEchoPayload(overrides = {}) {
  return {
    id: 'evt-echo',
    type: 'whatsapp.smb.message.echoes',
    apiVersion: 'v2',
    createTime: '2026-08-13T08:32:00.000Z',
    whatsappMessage: {
      id: 'ycloud-echo-id',
      wamid: 'wamid.ycloud-outbound-1',
      wabaId: 'waba-1',
      from: '31611111111',
      to: '31622222222',
      sendTime: '2026-08-13T08:32:00.000Z',
      customerProfile: { name: 'Jolanda Voorbeeld' },
      type: 'text',
      text: { body: 'YCloud uitgaand bericht.' },
      ...(overrides.message || {}),
    },
    ...overrides.event,
  };
}

function ycloudHistoryPayload({ direction = 'inbound', ...overrides } = {}) {
  const inbound = direction === 'inbound';
  const messageKey = inbound ? 'whatsappInboundMessage' : 'whatsappMessage';
  return {
    id: inbound ? 'evt-history-inbound' : 'evt-history-outbound',
    type: 'whatsapp.smb.history',
    apiVersion: 'v2',
    createTime: inbound ? '2026-08-12T08:00:00.000Z' : '2026-08-12T08:01:00.000Z',
    [messageKey]: {
      id: inbound ? 'ycloud-history-inbound-id' : 'ycloud-history-outbound-id',
      wamid: inbound ? 'wamid.ycloud-history-inbound' : 'wamid.ycloud-history-outbound',
      wabaId: 'waba-1',
      from: inbound ? '31622222222' : '31611111111',
      to: inbound ? '31611111111' : '31622222222',
      sendTime: inbound ? '2026-08-12T08:00:00.000Z' : '2026-08-12T08:01:00.000Z',
      customerProfile: { name: 'Jolanda Voorbeeld' },
      status: inbound ? 'READ' : 'SENT',
      type: 'text',
      text: { body: inbound ? 'YCloud historie inkomend.' : 'YCloud historie uitgaand.' },
      ...(overrides.message || {}),
    },
    ...overrides.event,
  };
}

function samplePayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '31611111111', phone_number_id: 'phone-id-1' },
          contacts: [{ profile: { name: 'Jolanda Voorbeeld' }, wa_id: '31622222222' }],
          messages: [{
            from: '31622222222',
            id: 'wamid.inbound-1',
            timestamp: '1786611000',
            type: 'text',
            text: { body: 'De afspraak is morgen om tien uur.' },
          }],
        },
      }, {
        field: 'smb_message_echoes',
        value: {
          metadata: { display_phone_number: '31611111111', phone_number_id: 'phone-id-1' },
          message_echoes: [{
            from: '31611111111',
            to: '31622222222',
            id: 'wamid.outbound-1',
            timestamp: '1786611060',
            type: 'text',
            text: { body: 'Prima, tot morgen.' },
          }],
        },
      }, {
        field: 'history',
        value: {
          metadata: { display_phone_number: '31611111111', phone_number_id: 'phone-id-1' },
          history: [{
            metadata: { phase: 2, chunk_order: 4, progress: 100 },
            threads: [{
              id: '31622222222',
              messages: [{
                from: '31622222222',
                id: 'wamid.history-1',
                timestamp: '1786524600',
                type: 'text',
                text: { body: 'Ouder bericht uit de historie.' },
                history_context: { status: 'READ' },
              }],
            }],
          }],
        },
      }],
    }],
  };
}

test('WhatsApp webhook challenge and HMAC verification fail closed', () => {
  const service = createService(createMemorySupabase());
  assert.equal(service.verifyChallenge({ mode: 'subscribe', token: VERIFY_TOKEN, challenge: '12345' }), '12345');
  assert.equal(service.verifyChallenge({ mode: 'subscribe', token: 'wrong', challenge: '12345' }), null);
  const { rawBody, signature } = signedPayload(samplePayload());
  assert.equal(service.verifyWebhookSignature(rawBody, signature), true);
  assert.equal(service.verifyWebhookSignature(rawBody, 'sha256=wrong'), false);
  assert.equal(service.isProviderWebhookAuthorized(PROVIDER_WEBHOOK_TOKEN), false);
  assert.equal(service.isReadAuthorized(READ_TOKEN), true);
  assert.equal(service.isReadAuthorized('wrong'), false);
});

test('YCloud webhook signatures bind timestamp and exact raw body and fail before storage', async () => {
  const memory = createMemorySupabase();
  const service = createYCloudService(memory);
  const payload = ycloudInboundPayload();
  const signed = signedYCloudPayload(payload);
  const nowSeconds = Math.floor(TEST_NOW.getTime() / 1000);

  assert.equal(service.verifyYCloudWebhookSignature(signed.rawBody, signed.signature), true);

  const invalidDeliveries = [
    { name: 'missing', rawBody: signed.rawBody, signature: '' },
    {
      name: 'wrong',
      ...signedYCloudPayload(payload, { secret: 'wrong-ycloud-webhook-secret' }),
    },
    {
      name: 'malformed',
      rawBody: signed.rawBody,
      signature: `t=${nowSeconds},s=not-a-valid-hmac`,
    },
    {
      name: 'tampered raw body',
      rawBody: Buffer.from(`${signed.rawBody.toString('utf8')} `),
      signature: signed.signature,
    },
    {
      name: 'expired',
      ...signedYCloudPayload(payload, {
        timestampSeconds: nowSeconds - YCLOUD_WEBHOOK_TOLERANCE_SECONDS - 1,
      }),
    },
    {
      name: 'future',
      ...signedYCloudPayload(payload, {
        timestampSeconds: nowSeconds + YCLOUD_WEBHOOK_TOLERANCE_SECONDS + 1,
      }),
    },
  ];

  for (const delivery of invalidDeliveries) {
    assert.equal(
      service.verifyYCloudWebhookSignature(delivery.rawBody, delivery.signature),
      false,
      delivery.name
    );
    await assert.rejects(
      service.acceptYCloudWebhook({
        rawBody: delivery.rawBody,
        signature: delivery.signature,
      }),
      (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID',
      delivery.name
    );
  }
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);

  const oversizedToleranceService = createYCloudService(createMemorySupabase(), TEST_NOW, {
    ycloudWebhookToleranceSeconds: 3_600,
  });
  const outsideSafeWindow = signedYCloudPayload(payload, {
    timestampSeconds: nowSeconds - YCLOUD_WEBHOOK_TOLERANCE_SECONDS - 1,
  });
  assert.equal(
    oversizedToleranceService.verifyYCloudWebhookSignature(
      outsideSafeWindow.rawBody,
      outsideSafeWindow.signature
    ),
    false
  );

  const weakSecretService = createYCloudService(createMemorySupabase(), TEST_NOW, {
    appSecret: '',
    verifyToken: '',
    providerWebhookToken: '',
    ycloudWebhookSecret: 'too-short',
  });
  assert.equal(weakSecretService.verifyYCloudWebhookSignature(signed.rawBody, signed.signature), false);
  assert.deepEqual(
    await weakSecretService.getStatus(),
    {
      configured: false,
      connected: false,
      provider: null,
      historyPhase: null,
      historyProgress: null,
      historyDeclined: false,
      lastWebhookAt: null,
      lastMessageAt: null,
      queuePendingEvents: 0,
      queueCaughtUp: true,
    }
  );
});

test('YCloud, Meta, provider and read credentials cannot authenticate each other', async () => {
  const memory = createMemorySupabase();
  const service = createYCloudService(memory, TEST_NOW, {
    providerWebhookToken: PROVIDER_WEBHOOK_TOKEN,
  });
  const ycloudPayload = ycloudInboundPayload();
  const ycloudSigned = signedYCloudPayload(ycloudPayload);
  const metaPayload = samplePayload();
  const metaSigned = signedPayload(metaPayload);

  await assert.rejects(
    service.acceptYCloudWebhook({
      rawBody: ycloudSigned.rawBody,
      signature: metaSigned.signature,
      providerToken: PROVIDER_WEBHOOK_TOKEN,
      readToken: READ_TOKEN,
    }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
  );
  await assert.rejects(
    service.acceptYCloudWebhook({
      rawBody: ycloudSigned.rawBody,
      signature: '',
      providerToken: PROVIDER_WEBHOOK_TOKEN,
      readToken: READ_TOKEN,
    }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
  );
  await assert.rejects(
    service.acceptWebhook({
      rawBody: ycloudSigned.rawBody,
      signature: ycloudSigned.signature,
      payload: ycloudPayload,
    }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
  );
  assert.equal(service.verifyYCloudWebhookSignature(metaSigned.rawBody, metaSigned.signature), false);
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);
});

test('YCloud one-to-one messages and history are encrypted, normalized and deduplicated by wamid', async () => {
  const memory = createMemorySupabase();
  const service = createYCloudService(memory);
  const inbound = ycloudInboundPayload();
  const redelivery = ycloudInboundPayload({
    event: {
      id: 'evt-inbound-redelivery',
      createTime: '2026-08-13T08:31:05.000Z',
    },
  });
  const events = [
    inbound,
    redelivery,
    ycloudEchoPayload(),
    ycloudHistoryPayload({ direction: 'inbound' }),
    ycloudHistoryPayload({ direction: 'outbound' }),
  ];

  for (const payload of events) {
    const signed = signedYCloudPayload(payload);
    const accepted = await service.acceptYCloudWebhook(signed);
    assert.equal(accepted.accepted, true);
  }
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 5);
  const queuedStatus = await service.getStatus();
  assert.equal(queuedStatus.connected, false);
  assert.equal(queuedStatus.queuePendingEvents, 5);
  assert.equal(queuedStatus.queueCaughtUp, false);
  assert.doesNotMatch(
    JSON.stringify(memory.tables.softora_whatsapp_webhook_events),
    /Jolanda|YCloud inkomend|31622222222/
  );

  const processed = await service.processWebhookQueue({ limit: 5 });
  assert.equal(processed.processed, 5);
  assert.equal(processed.results.every((result) => result.ok), true);
  assert.equal(memory.tables.softora_whatsapp_messages.length, 4);
  assert.equal(memory.tables.softora_whatsapp_contacts.length, 1);
  assert.equal(memory.tables.softora_whatsapp_sync_state[0].owner_key, 'serve:ycloud');

  const sourceById = new Map(
    memory.tables.softora_whatsapp_messages.map((message) => [message.message_key, message.source_field])
  );
  assert.equal(sourceById.get('wamid.ycloud-inbound-1'), 'messages');
  assert.equal(sourceById.get('wamid.ycloud-outbound-1'), 'smb_message_echoes');
  assert.equal(sourceById.get('wamid.ycloud-history-inbound'), 'history');
  assert.equal(sourceById.get('wamid.ycloud-history-outbound'), 'history');

  const result = await service.readMessages({ contact: 'Jolanda Voorbeeld', limit: 20 });
  assert.equal(result.count, 4);
  assert.deepEqual(
    result.messages.map((message) => message.direction),
    ['inbound', 'outbound', 'inbound', 'outbound']
  );
  assert.equal(result.messages[0].id, 'wamid.ycloud-history-inbound');
  assert.equal(result.messages[0].contactName, 'Jolanda Voorbeeld');
  assert.equal(result.messages[0].contactPhone, '31622222222');
  assert.equal(result.messages[0].content.detail.body, 'YCloud historie inkomend.');
  assert.equal(result.messages[0].occurredAt, '2026-08-12T08:00:00.000Z');
  assert.equal(result.messages[0].historyStatus, 'READ');
  assert.equal(result.messages[1].content.detail.body, 'YCloud historie uitgaand.');
  assert.equal(result.messages[1].historyStatus, 'SENT');
  assert.equal(result.messages[2].content.detail.body, 'YCloud inkomend bericht.');
  assert.equal(result.messages[2].occurredAt, '2026-08-13T08:31:00.000Z');
  assert.equal(result.messages[3].content.detail.body, 'YCloud uitgaand bericht.');
  const status = await service.getStatus();
  assert.deepEqual(
    {
      connected: status.connected,
      provider: status.provider,
      queuePendingEvents: status.queuePendingEvents,
      queueCaughtUp: status.queueCaughtUp,
    },
    { connected: true, provider: 'ycloud', queuePendingEvents: 0, queueCaughtUp: true }
  );
});

test('WhatsApp webhook worker defaults to ten events for YCloud history bursts', async () => {
  const memory = createMemorySupabase();
  const service = createYCloudService(memory);
  const processed = await service.processWebhookQueue();
  assert.equal(processed.processed, 0);
  const claim = memory.rpcCalls.find(([name]) => name === 'softora_claim_whatsapp_webhook_events');
  assert.equal(claim?.[1]?.p_limit, 10);
});

test('YCloud rejects unknown events and ignores signed group messages without storage', async () => {
  const memory = createMemorySupabase();
  const service = createYCloudService(memory);
  const unknown = ycloudInboundPayload({ event: { id: 'evt-unknown', type: 'whatsapp.unknown' } });
  const signedUnknown = signedYCloudPayload(unknown);

  await assert.rejects(
    service.acceptYCloudWebhook(signedUnknown),
    (error) => error.code === 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID'
  );
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);

  const group = ycloudInboundPayload({
    event: { id: 'evt-group' },
    message: { groupId: 'group-1' },
  });
  const ignored = await service.acceptYCloudWebhook(signedYCloudPayload(group));
  assert.deepEqual(ignored, { ok: true, accepted: false, reason: 'group_not_supported' });
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);

  const malformedPayloads = [
    ycloudInboundPayload({ event: { id: 42 } }),
    ycloudInboundPayload({ event: { id: 'evt-bad-phone' }, message: { from: 'not-a-phone' } }),
    ycloudInboundPayload({ event: { id: 'evt-object-phone' }, message: { from: { digits: '31622222222' } } }),
    ycloudInboundPayload({ event: { id: 'evt-bad-type' }, message: { type: { name: 'text' } } }),
    ycloudInboundPayload({ event: { id: 'evt-bad-profile' }, message: { customerProfile: { name: 42 } } }),
  ];
  for (const malformedPayload of malformedPayloads) {
    await assert.rejects(
      service.acceptYCloudWebhook(signedYCloudPayload(malformedPayload)),
      (error) => error.code === 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID'
    );
  }
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);
});

test('YCloud-only configuration is ready without Meta credentials or a provider path token', async () => {
  const memory = createMemorySupabase();
  memory.tables.softora_whatsapp_sync_state.push({
    owner_key: 'serve',
    phone_number_key: 'old-meta-phone-id',
    last_webhook_at: '2026-08-12T10:00:00.000Z',
  });
  const service = createYCloudService(memory, TEST_NOW, {
    appSecret: '',
    verifyToken: '',
    providerWebhookToken: '',
  });
  const status = await service.getStatus();
  assert.deepEqual(
    { configured: status.configured, connected: status.connected, provider: status.provider },
    { configured: true, connected: false, provider: 'ycloud' }
  );

  const unconfigured = createYCloudService(createMemorySupabase(), TEST_NOW, {
    appSecret: '',
    verifyToken: '',
    providerWebhookToken: '',
    ycloudWebhookSecret: '',
  });
  const unconfiguredStatus = await unconfigured.getStatus();
  assert.equal(unconfiguredStatus.configured, false);
  assert.equal(unconfiguredStatus.provider, null);
});

test('WhatsApp provider override accepts only a strong matching path token', async () => {
  const memory = createMemorySupabase();
  const service = createService(memory, new Date('2026-08-13T09:00:00.000Z'), {
    appSecret: '',
    providerWebhookToken: PROVIDER_WEBHOOK_TOKEN,
  });
  const payload = samplePayload();
  const rawBody = Buffer.from(JSON.stringify(payload));

  assert.equal(service.isProviderWebhookAuthorized(PROVIDER_WEBHOOK_TOKEN), true);
  assert.equal(service.isProviderWebhookAuthorized('wrong'), false);
  await assert.rejects(
    service.acceptWebhook({ rawBody, payload, providerToken: 'wrong' }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
  );
  await service.acceptWebhook({ rawBody, payload, providerToken: PROVIDER_WEBHOOK_TOKEN });
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 1);
  assert.equal((await service.getStatus()).configured, true);

  const weakService = createService(createMemorySupabase(), new Date('2026-08-13T09:00:00.000Z'), {
    appSecret: '',
    providerWebhookToken: 'too-short',
  });
  assert.equal(weakService.isProviderWebhookAuthorized('too-short'), false);
  const invalidCharacterToken = `${'a'.repeat(42)}$`;
  const invalidCharacterService = createService(
    createMemorySupabase(),
    new Date('2026-08-13T09:00:00.000Z'),
    { appSecret: '', providerWebhookToken: invalidCharacterToken }
  );
  assert.equal(invalidCharacterService.isProviderWebhookAuthorized(invalidCharacterToken), false);
  const oversizedToken = 'a'.repeat(181);
  const oversizedService = createService(
    createMemorySupabase(),
    new Date('2026-08-13T09:00:00.000Z'),
    { appSecret: '', providerWebhookToken: oversizedToken }
  );
  assert.equal(oversizedService.isProviderWebhookAuthorized(oversizedToken), false);
});

test('WhatsApp webhook is stored encrypted, processed idempotently, and readable by contact', async () => {
  const memory = createMemorySupabase();
  const service = createService(memory);
  const payload = samplePayload();
  const { rawBody, signature } = signedPayload(payload);

  await service.acceptWebhook({ rawBody, signature, payload });
  await service.acceptWebhook({ rawBody, signature, payload });
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 1);
  const encryptedPayload = memory.tables.softora_whatsapp_webhook_events[0].encrypted_payload;
  assert.ok(encryptedPayload.startsWith('v1.'));
  assert.doesNotMatch(encryptedPayload, /Jolanda|afspraak|31622222222/);

  const processed = await service.processWebhookQueue({ limit: 2 });
  assert.equal(processed.processed, 1);
  assert.equal(processed.results[0].messageCount, 3);
  assert.equal(memory.tables.softora_whatsapp_messages.length, 3);
  assert.equal(memory.tables.softora_whatsapp_contacts.length, 1);
  assert.equal(memory.tables.softora_whatsapp_sync_state[0].history_progress, 100);
  assert.equal(memory.tables.softora_whatsapp_sync_state[0].history_phase, 2);
  assert.doesNotMatch(JSON.stringify(memory.tables.softora_whatsapp_messages), /morgen om tien|Jolanda Voorbeeld|31622222222/);

  const result = await service.readMessages({ contact: 'Jolanda Voorbeeld', limit: 20, actor: 'contract-test' });
  assert.equal(result.count, 3);
  assert.deepEqual(result.messages.map((message) => message.direction), ['inbound', 'inbound', 'outbound']);
  assert.equal(result.messages[0].contactName, 'Jolanda Voorbeeld');
  assert.equal(result.messages[0].contactPhone, '31622222222');
  assert.equal(result.messages[2].content.detail.body, 'Prima, tot morgen.');

  const searched = await service.readMessages({ query: 'afspraak tien', limit: 1 });
  assert.equal(searched.count, 1);
  assert.equal(searched.messages[0].content.detail.body, 'De afspraak is morgen om tien uur.');

  const noDuplicateWork = await service.processWebhookQueue({ limit: 2 });
  assert.equal(noDuplicateWork.processed, 0);
});

test('WhatsApp read validation rejects invalid or reversed date ranges', async () => {
  const service = createService(createMemorySupabase());
  await assert.rejects(
    service.readMessages({ after: 'not-a-date' }),
    (error) => error.code === 'WHATSAPP_QUERY_INVALID'
  );
  await assert.rejects(
    service.readMessages({ after: '2026-08-13T10:00:00Z', before: '2026-08-13T09:00:00Z' }),
    (error) => error.code === 'WHATSAPP_QUERY_INVALID'
  );
});

test('WhatsApp edits and revocations survive out-of-order history without leaking old content', async () => {
  const memory = createMemorySupabase();
  const service = createService(memory);
  const editPayload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'smb_message_echoes', value: {
      metadata: { display_phone_number: '31611111111', phone_number_id: 'phone-id-1' },
      message_echoes: [{
        from: '31611111111',
        to: '31622222222',
        id: 'wamid.edit-event',
        timestamp: '1786612000',
        type: 'edit',
        edit: {
          original_message_id: 'wamid.original',
          message: { type: 'text', text: { body: 'Gecorrigeerde tekst' } },
        },
      }],
    } }] }],
  };
  const signedEdit = signedPayload(editPayload);
  await service.acceptWebhook({ ...signedEdit, payload: editPayload });
  await service.processWebhookQueue();

  const historyPayload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'history', value: {
      metadata: { display_phone_number: '31611111111', phone_number_id: 'phone-id-1' },
      history: [{ threads: [{ id: '31622222222', messages: [{
        from: '31611111111',
        id: 'wamid.original',
        timestamp: '1786611000',
        type: 'text',
        text: { body: 'Oude tekst' },
      }] }] }],
    } }] }],
  };
  const signedHistory = signedPayload(historyPayload);
  await service.acceptWebhook({ ...signedHistory, payload: historyPayload });
  await service.processWebhookQueue();
  let result = await service.readMessages({ contact: '31622222222' });
  assert.equal(result.messages[0].direction, 'outbound');
  assert.equal(result.messages[0].content.detail.body, 'Gecorrigeerde tekst');
  assert.ok(result.messages[0].editedAt);

  const revokePayload = structuredClone(editPayload);
  revokePayload.entry[0].changes[0].value.message_echoes[0] = {
    from: '31611111111',
    to: '31622222222',
    id: 'wamid.revoke-event',
    timestamp: '1786613000',
    type: 'revoke',
    revoke: { original_message_id: 'wamid.original' },
  };
  const signedRevoke = signedPayload(revokePayload);
  await service.acceptWebhook({ ...signedRevoke, payload: revokePayload });
  await service.processWebhookQueue();
  result = await service.readMessages({ contact: '31622222222' });
  assert.equal(result.messages[0].type, 'revoked');
  assert.equal(result.messages[0].content.type, 'revoked');
  assert.ok(result.messages[0].revokedAt);
  assert.equal((await service.readMessages({ query: 'oude' })).count, 0);
  assert.equal((await service.readMessages({ query: 'gecorrigeerde' })).count, 0);
});

test('WhatsApp service rejects unsigned or malformed webhooks before storage', async () => {
  const memory = createMemorySupabase();
  const service = createService(memory);
  const payload = samplePayload();
  const { rawBody } = signedPayload(payload);
  await assert.rejects(
    service.acceptWebhook({ rawBody, signature: 'sha256=wrong', payload }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
  );
  const malformed = signedPayload({ object: 'other', entry: [] });
  await assert.rejects(
    service.acceptWebhook({ ...malformed, payload: { object: 'other', entry: [] } }),
    (error) => error.code === 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID'
  );
  assert.equal(memory.tables.softora_whatsapp_webhook_events.length, 0);
});

function createRouteApp() {
  const routes = { get: new Map(), post: new Map() };
  return {
    routes,
    get(pathname, ...handlers) { routes.get.set(pathname, handlers); },
    post(pathname, ...handlers) { routes.post.set(pathname, handlers); },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

async function runHandlers(handlers, req, res) {
  let index = -1;
  async function next() {
    index += 1;
    if (index < handlers.length) return handlers[index](req, res, next);
    return undefined;
  }
  await next();
}

test('WhatsApp HTTP routes expose only read/status plus verified ingest and worker', async () => {
  const app = createRouteApp();
  const acceptedWebhooks = [];
  const acceptedYCloudWebhooks = [];
  const service = {
    isReadAuthorized: (token) => token === READ_TOKEN,
    isProviderWebhookAuthorized: (token) => token === PROVIDER_WEBHOOK_TOKEN,
    verifyChallenge: ({ token, challenge }) => token === VERIFY_TOKEN ? challenge : null,
    acceptWebhook: async (request) => {
      acceptedWebhooks.push(request);
      return { ok: true, accepted: true };
    },
    acceptYCloudWebhook: async (request) => {
      acceptedYCloudWebhooks.push(request);
      return { ok: true, accepted: true };
    },
    processWebhookQueue: async () => ({ ok: true, processed: 0 }),
    getStatus: async () => ({ connected: true }),
    readMessages: async () => ({ count: 1, messages: [{ id: 'one' }] }),
  };
  registerWhatsAppReadOnlyRoutes(app, { service, cronSecret: 'cron-secret' });

  assert.deepEqual([...app.routes.post.keys()], [
    '/api/whatsapp/webhook',
    '/api/whatsapp/ycloud-webhook',
    '/api/whatsapp/provider-webhook/:providerToken',
  ]);
  assert.equal(app.routes.get.has('/api/whatsapp/ycloud-webhook'), false);
  assert.equal(app.routes.post.has('/api/whatsapp/send'), false);
  assert.equal(app.routes.post.has('/api/whatsapp/reply'), false);
  assert.equal(app.routes.post.has('/api/whatsapp/delete'), false);

  const unauthorized = createResponse();
  await runHandlers(app.routes.get.get('/api/whatsapp/messages'), {
    query: {}, headers: {}, get: () => '',
  }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const authorized = createResponse();
  await runHandlers(app.routes.get.get('/api/whatsapp/messages'), {
    query: { contact: 'Jolanda' },
    headers: {},
    get: (name) => name.toLowerCase() === 'authorization' ? `Bearer ${READ_TOKEN}` : '',
  }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.count, 1);
  assert.equal(authorized.headers['Cache-Control'], 'private, no-store');

  const rejectedProviderChallenge = createResponse();
  await runHandlers(app.routes.get.get('/api/whatsapp/provider-webhook/:providerToken'), {
    params: { providerToken: 'wrong' },
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '123' },
  }, rejectedProviderChallenge);
  assert.equal(rejectedProviderChallenge.statusCode, 403);

  const acceptedProviderChallenge = createResponse();
  await runHandlers(app.routes.get.get('/api/whatsapp/provider-webhook/:providerToken'), {
    params: { providerToken: PROVIDER_WEBHOOK_TOKEN },
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '123' },
  }, acceptedProviderChallenge);
  assert.equal(acceptedProviderChallenge.statusCode, 200);
  assert.equal(acceptedProviderChallenge.body, '123');

  const acceptedProviderWebhook = createResponse();
  await runHandlers(app.routes.post.get('/api/whatsapp/provider-webhook/:providerToken'), {
    params: { providerToken: PROVIDER_WEBHOOK_TOKEN },
    body: samplePayload(),
    rawBody: Buffer.from('{}'),
    get: () => '',
  }, acceptedProviderWebhook);
  assert.equal(acceptedProviderWebhook.statusCode, 202);
  assert.equal(acceptedWebhooks[0].providerToken, PROVIDER_WEBHOOK_TOKEN);

  const ycloudRawBody = Buffer.from('{"id":"evt-route"}');
  const acceptedYCloudWebhook = createResponse();
  await runHandlers(app.routes.post.get('/api/whatsapp/ycloud-webhook'), {
    body: { id: 'different-parsed-body-is-not-trusted' },
    rawBody: ycloudRawBody,
    headers: { 'ycloud-signature': 't=123,s=route-signature' },
    get: (name) => name.toLowerCase() === 'ycloud-signature'
      ? 't=123,s=route-signature'
      : '',
  }, acceptedYCloudWebhook);
  assert.equal(acceptedYCloudWebhook.statusCode, 202);
  assert.deepEqual(acceptedYCloudWebhooks, [{
    rawBody: ycloudRawBody,
    signature: 't=123,s=route-signature',
  }]);
});

test('YCloud HTTP webhook maps authentication, payload and storage outcomes safely', async () => {
  const app = createRouteApp();
  const seen = [];
  registerWhatsAppReadOnlyRoutes(app, {
    cronSecret: 'cron-secret',
    service: {
      acceptYCloudWebhook: async (request) => {
        seen.push(request);
        if (request.signature === 'valid') return { ok: true, accepted: true, eventKey: 'event-key' };
        const error = new Error('sensitive provider detail');
        error.code = request.signature;
        throw error;
      },
    },
  });

  const rawBody = Buffer.from('{"id":"evt-route-errors"}');
  const cases = [
    ['valid', 202, true],
    ['WHATSAPP_WEBHOOK_SIGNATURE_INVALID', 401, false],
    ['WHATSAPP_WEBHOOK_PAYLOAD_INVALID', 400, false],
    ['WHATSAPP_STORAGE_NOT_CONFIGURED', 503, false],
  ];
  for (const [signature, expectedStatus, expectedAccepted] of cases) {
    const response = createResponse();
    await runHandlers(app.routes.post.get('/api/whatsapp/ycloud-webhook'), {
      rawBody,
      body: { ignored: true },
      get: (name) => name.toLowerCase() === 'ycloud-signature' ? signature : '',
    }, response);
    assert.equal(response.statusCode, expectedStatus, signature);
    if (expectedAccepted) assert.equal(response.body.accepted, true);
    else assert.equal(response.body.ok, false);
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive provider detail/);
  }
  assert.equal(seen.length, 4);
  assert.equal(seen.every((request) => request.rawBody === rawBody), true);
});

test('WhatsApp webhook returns retryable status for storage failures', async () => {
  const app = createRouteApp();
  registerWhatsAppReadOnlyRoutes(app, {
    cronSecret: 'cron-secret',
    service: {
      isReadAuthorized: () => false,
      isProviderWebhookAuthorized: () => false,
      verifyChallenge: () => null,
      acceptWebhook: async () => {
        const error = new Error('database unavailable');
        error.code = 'WHATSAPP_STORAGE_NOT_CONFIGURED';
        throw error;
      },
    },
  });
  const response = createResponse();
  await runHandlers(app.routes.post.get('/api/whatsapp/webhook'), {
    body: samplePayload(),
    rawBody: Buffer.from('{}'),
    headers: {},
    get: () => '',
  }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.errorCode, 'WHATSAPP_STORAGE_NOT_CONFIGURED');
});

test('WhatsApp migration and wiring remain least privilege and send-free', () => {
  const root = path.join(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260813090439_add_whatsapp_read_only_archive.sql'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'server/routes/whatsapp-read-only.js'), 'utf8');
  const featureRuntime = fs.readFileSync(path.join(root, 'server/services/feature-routes-runtime.js'), 'utf8');
  const featureComposition = fs.readFileSync(
    path.join(root, 'server/services/server-app-runtime-feature-composition-builders.js'),
    'utf8'
  );
  const middlewareRuntime = fs.readFileSync(path.join(root, 'server/services/app-middleware-runtime.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.softora_whatsapp_messages from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.softora_whatsapp_messages to service_role/);
  assert.doesNotMatch(migration, /whatsapp_read_audit/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'server/services/whatsapp-read-only.js'), 'utf8'), /\.insert\([^)]*audit/i);
  assert.doesNotMatch(routes, /\/api\/whatsapp\/(send|delete|reply)/);
  assert.match(routes, /app\.post\('\/api\/whatsapp\/ycloud-webhook'/);
  assert.doesNotMatch(routes, /app\.get\('\/api\/whatsapp\/ycloud-webhook'/);
  assert.match(middlewareRuntime, /jsonBodyParserWhatsAppHistory/);
  assert.match(middlewareRuntime, /pathname === '\/api\/whatsapp\/webhook'/);
  assert.match(middlewareRuntime, /pathname === '\/api\/whatsapp\/ycloud-webhook'/);
  assert.match(middlewareRuntime, /pathname\.startsWith\('\/api\/whatsapp\/provider-webhook\/'\)/);
  assert.match(featureComposition, /providerWebhookToken: env\.WHATSAPP_PROVIDER_WEBHOOK_TOKEN/);
  assert.match(featureComposition, /ycloudWebhookSecret: env\.WHATSAPP_YCLOUD_WEBHOOK_SECRET/);
  assert.match(
    featureComposition,
    /ycloudWebhookToleranceSeconds: env\.WHATSAPP_YCLOUD_WEBHOOK_TOLERANCE_SECONDS/
  );
  assert.match(envExample, /WHATSAPP_YCLOUD_WEBHOOK_SECRET=/);
  assert.doesNotMatch(envExample, /WHATSAPP_YCLOUD_API_KEY/);
  assert.doesNotMatch(featureComposition, /ycloudApiKey|WHATSAPP_YCLOUD_API_KEY/i);
  assert.ok(
    featureRuntime.indexOf('registerWhatsAppReadOnlyRoutes(app') < featureRuntime.indexOf('createPremiumRouteRuntime({'),
    'Meta webhook and bearer-protected read routes must be registered before generic premium auth'
  );
});
