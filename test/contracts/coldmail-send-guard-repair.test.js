const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  COLDMAIL_SEND_GUARD_KEY,
  analyzeColdmailSendGuardRow,
  createColdmailSendGuardRepairService,
} = require('../../server/services/coldmail-send-guard-repair');
const {
  registerColdmailSendGuardRepairRoutes,
  REPAIR_CONFIRMATION,
} = require('../../server/routes/coldmail-send-guard-repair');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createCorruptRow(rawGuard, overrides = {}) {
  const chunkKeys = [
    'softora_coldmail_send_guard_chunk_0001',
    'softora_coldmail_send_guard_chunk_0002',
  ];
  const splitAt = Math.max(1, Math.floor(rawGuard.length / 2));
  return {
    state_key: 'ui_state:premium_coldmail_send_guard',
    payload: {
      scope: 'premium_coldmail_send_guard',
      values: {
        [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify({
          storageFormat: 'softora-coldmail-send-guard-chunks-v1',
          chunkKeys,
          serializedLength: rawGuard.length + 17,
          sha256: '0'.repeat(64),
        }),
        [chunkKeys[0]]: rawGuard.slice(0, splitAt),
        [chunkKeys[1]]: rawGuard.slice(splitAt),
      },
    },
    meta: { type: 'ui_state', scope: 'premium_coldmail_send_guard' },
    updated_at: '2026-09-21T10:00:00.000Z',
    revision: 7,
    ...overrides,
  };
}

function createClientFixture(initialRow, options = {}) {
  let row = initialRow;
  const actions = [];
  const backups = [];
  const updates = [];
  const client = {
    from(table) {
      assert.equal(table, 'softora_runtime_state');
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'state_key');
              assert.equal(value, 'ui_state:premium_coldmail_send_guard');
              return {
                async maybeSingle() {
                  actions.push('read');
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        upsert(backupRow) {
          actions.push('backup');
          backups.push(backupRow);
          return {
            select() {
              return {
                async maybeSingle() {
                  if (options.backupError) return { data: null, error: options.backupError };
                  return { data: { state_key: backupRow.state_key }, error: null };
                },
              };
            },
          };
        },
        update(updateRow) {
          actions.push('update');
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            select() {
              return {
                async maybeSingle() {
                  updates.push({ updateRow, filters });
                  if (options.updateError) return { data: null, error: options.updateError };
                  if (options.race) return { data: null, error: null };
                  row = { ...row, ...updateRow };
                  return { data: row, error: null };
                },
              };
            },
          };
          return query;
        },
      };
    },
  };
  return { actions, backups, client, getRow: () => row, updates };
}

function createRepairFixture(row, options = {}) {
  const database = createClientFixture(row, options);
  const logEntries = [];
  const service = createColdmailSendGuardRepairService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => database.client,
    supabaseStateTable: 'softora_runtime_state',
    fetchSupabaseRowByKeyViaRest: async () => ({ ok: false }),
    getUiStateValues: async () => {
      const current = database.getRow();
      const analysis = analyzeColdmailSendGuardRow(current);
      if (analysis.status !== 'healthy_chunked') return null;
      const values = current.payload.values;
      const manifest = JSON.parse(values[COLDMAIL_SEND_GUARD_KEY]);
      const raw = manifest.chunkKeys.map((key) => values[key]).join('');
      return {
        source: 'supabase',
        revision: current.revision,
        updatedAt: current.updated_at,
        values: { [COLDMAIL_SEND_GUARD_KEY]: raw },
      };
    },
    logger: { info: (...args) => logEntries.push(args), error: (...args) => logEntries.push(args) },
  });
  return { ...database, logEntries, service };
}

test('coldmail send-guard repair backs up first and fixes only manifest integrity metadata', async () => {
  const sensitiveEmail = 'private-lead@example.test';
  const rawGuard = JSON.stringify({
    entries: [{ recipientEmail: sensitiveEmail, recipientKey: `email:${sensitiveEmail}` }],
    recipientEntries: [
      { recipientEmail: sensitiveEmail, recipientKey: `email:${sensitiveEmail}` },
      { recipientEmail: 'second-private@example.test', recipientKey: 'email:second-private@example.test' },
    ],
    preserved: { version: 9 },
  });
  const originalRow = createCorruptRow(rawGuard);
  const originalValues = structuredClone(originalRow.payload.values);
  const fixture = createRepairFixture(originalRow);

  const result = await fixture.service.repair();

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.backupCreated, true);
  assert.equal(result.verified, true);
  assert.deepEqual(fixture.actions, ['read', 'backup', 'update']);
  assert.equal(fixture.backups.length, 1);
  assert.deepEqual(fixture.backups[0].payload.sourceRow, originalRow);
  assert.equal(fixture.updates.length, 1);
  assert.deepEqual(fixture.updates[0].filters, [
    ['state_key', originalRow.state_key],
    ['revision', originalRow.revision],
    ['updated_at', originalRow.updated_at],
  ]);

  const repairedValues = fixture.getRow().payload.values;
  const repairedManifest = JSON.parse(repairedValues[COLDMAIL_SEND_GUARD_KEY]);
  assert.equal(repairedManifest.serializedLength, rawGuard.length);
  assert.equal(repairedManifest.sha256, sha256(rawGuard));
  repairedManifest.chunkKeys.forEach((key) => assert.equal(repairedValues[key], originalValues[key]));
  assert.equal(result.after.entryCount, 1);
  assert.equal(result.after.recipientEntryCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-lead|second-private/i);
  assert.doesNotMatch(JSON.stringify(fixture.logEntries), /private-lead|second-private/i);
});

test('coldmail send-guard repair refuses invalid chunk JSON without a backup or original-row write', async () => {
  const fixture = createRepairFixture(createCorruptRow('{"entries":[{"recipientEmail":"secret@example.test"}]'));

  await assert.rejects(
    fixture.service.repair(),
    (error) => error.code === 'COLDMAIL_SEND_GUARD_NOT_REPAIRABLE' && error.status === 409
  );

  assert.deepEqual(fixture.actions, ['read']);
  assert.equal(fixture.backups.length, 0);
  assert.equal(fixture.updates.length, 0);
});

test('coldmail send-guard repair keeps the backup and refuses a stale CAS race', async () => {
  const rawGuard = JSON.stringify({ entries: [], recipientEntries: [] });
  const fixture = createRepairFixture(createCorruptRow(rawGuard), { race: true });

  await assert.rejects(
    fixture.service.repair(),
    (error) => error.code === 'COLDMAIL_SEND_GUARD_REPAIR_CONFLICT' && error.status === 409
  );

  assert.deepEqual(fixture.actions, ['read', 'backup', 'update']);
  assert.equal(fixture.backups.length, 1);
  assert.equal(fixture.updates.length, 1);
});

test('coldmail send-guard inspection exposes hashes and counts but no stored recipient data', async () => {
  const sensitiveEmail = 'diagnostic-private@example.test';
  const rawGuard = JSON.stringify({
    entries: [],
    recipientEntries: [{ recipientEmail: sensitiveEmail }],
  });
  const fixture = createRepairFixture(createCorruptRow(rawGuard));

  const result = await fixture.service.inspect();

  assert.equal(result.diagnostic.status, 'manifest_integrity_mismatch');
  assert.equal(result.diagnostic.repairable, true);
  assert.equal(result.diagnostic.recipientEntryCount, 1);
  assert.equal(result.diagnostic.actualSha256, sha256(rawGuard));
  assert.doesNotMatch(JSON.stringify(result), /diagnostic-private/i);
  assert.deepEqual(fixture.actions, ['read']);
});

test('coldmail send-guard repair routes are admin-only and require exact write confirmation', async () => {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
  };
  const requireAdmin = (_req, _res, next) => next();
  const service = {
    inspect: async () => ({ ok: true }),
    repair: async () => ({ ok: true, changed: true }),
  };
  registerColdmailSendGuardRepairRoutes(app, {
    service,
    requirePremiumAdminApiAccess: requireAdmin,
  });

  assert.deepEqual(routes.map((route) => [route.method, route.path]), [
    ['GET', '/api/admin/coldmail-send-guard/storage'],
    ['POST', '/api/admin/coldmail-send-guard/repair'],
  ]);
  assert.equal(routes.every((route) => route.handlers[0] === requireAdmin), true);

  const response = {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await routes[1].handlers[1]({ body: { confirm: 'wrong' } }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'COLDMAIL_SEND_GUARD_REPAIR_CONFIRMATION_REQUIRED');

  await routes[1].handlers[1]({ body: { confirm: REPAIR_CONFIRMATION } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.changed, true);
});
