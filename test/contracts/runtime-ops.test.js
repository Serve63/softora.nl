const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeOpsCoordinator } = require('../../server/services/runtime-ops');

function createPasswordRegisterValues(version = 2) {
  return {
    entries_encrypted_v1: JSON.stringify({
      version,
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: version === 1 ? 210000 : 600000,
      salt: Buffer.alloc(16, 1).toString('base64'),
      iv: Buffer.alloc(12, 2).toString('base64'),
      ciphertext: Buffer.alloc(48, 3).toString('base64'),
    }),
    entries_json: '',
    updated_at: '2026-08-04T12:00:00.000Z',
    updated_by: 'test-save',
  };
}

function createPasswordRegisterWriteBody(values, overrides = {}) {
  return {
    patch: values,
    writeProof: 'opaque-test-proof',
    ...overrides,
  };
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const dashboardActivityCalls = [];
  const securityAuditCalls = [];
  const coordinator = createRuntimeOpsCoordinator({
    parseIntSafe: (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    recentDashboardActivities: overrides.recentDashboardActivities || [
      { id: 'act-1', title: 'Eerste' },
      { id: 'act-2', title: 'Tweede' },
    ],
    recentSecurityAuditEvents: overrides.recentSecurityAuditEvents || [
      { id: 'sec-1', type: 'login' },
      { id: 'sec-2', type: 'logout' },
    ],
    normalizeString: (value) => String(value || '').trim(),
    appendDashboardActivity: (payload, reason) => {
      dashboardActivityCalls.push({ payload, reason });
      return {
        id: 'act-new',
        ...payload,
      };
    },
    normalizeUiStateScope: (value) => {
      const scope = String(value || '').trim().toLowerCase();
      return /^[a-z0-9:_-]{1,80}$/.test(scope) ? scope : '';
    },
    getUiStateValues: overrides.getUiStateValues || (async () => ({
      values: { panel: 'overview' },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    })),
    sanitizeUiStateValues: (values) => {
      const out = {};
      for (const [key, value] of Object.entries(values || {})) {
        if (value === undefined) continue;
        out[String(key).trim()] = value === null ? '' : String(value);
      }
      return out;
    },
    setUiStateValues:
      overrides.setUiStateValues ||
      (async (_scope, values, meta) => ({
        values,
        source: meta.source,
        updatedAt: '2026-04-07T12:30:00.000Z',
      })),
    compareAndSwapUiStateValues:
      overrides.compareAndSwapUiStateValues ||
      (async (_scope, values, meta) => ({
        ok: true,
        values,
        source: 'supabase',
        revision: Number(meta.expectedRevision) + 1,
        updatedAt: '2026-08-04T12:00:00.000Z',
      })),
    dataOpsUiStateBridge: overrides.dataOpsUiStateBridge || null,
    dataOpsStore: overrides.dataOpsStore || null,
    sportschoolLogbookStore: overrides.sportschoolLogbookStore || null,
    dataOpsUiStateReadTimeoutMs: overrides.dataOpsUiStateReadTimeoutMs,
    dataOpsUiStateReadTimeoutMsByScope: overrides.dataOpsUiStateReadTimeoutMsByScope,
    uiStateReadTimeoutMs: overrides.uiStateReadTimeoutMs,
    adminOnlyUiStateScopes: overrides.adminOnlyUiStateScopes || new Set(['premium_password_register']),
    passwordRegisterOwnerPolicy: overrides.passwordRegisterOwnerPolicy || {
      getAccessDecision(authState) {
        return authState?.userId === 'usr_password_owner'
          ? { ok: true }
          : {
              ok: false,
              statusCode: 403,
              code: 'PASSWORD_REGISTER_OWNER_REQUIRED',
              error: 'Alleen de geconfigureerde eigenaar heeft toegang.',
            };
      },
    },
    appendSecurityAuditEvent: overrides.appendSecurityAuditEvent || ((payload, reason) => {
      securityAuditCalls.push({ payload, reason });
      return payload;
    }),
    logger: overrides.logger,
  });

  return {
    coordinator,
    dashboardActivityCalls,
    securityAuditCalls,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('runtime ops coordinator lists dashboard activity and audit events with stable payloads', () => {
  const { coordinator } = createFixture();
  const dashboardRes = createResponseRecorder();
  const auditRes = createResponseRecorder();

  coordinator.sendDashboardActivityResponse({ query: { limit: '1' } }, dashboardRes);
  coordinator.sendSecurityAuditLogResponse({ query: { limit: '1' } }, auditRes);

  assert.equal(dashboardRes.statusCode, 200);
  assert.equal(dashboardRes.body.ok, true);
  assert.equal(dashboardRes.body.count, 1);
  assert.equal(dashboardRes.body.activities.length, 1);

  assert.equal(auditRes.statusCode, 200);
  assert.equal(auditRes.body.ok, true);
  assert.equal(auditRes.body.count, 1);
  assert.equal(auditRes.body.events.length, 1);
});

test('runtime ops coordinator levert compacte formele dashboardklanten', async () => {
  const calls = [];
  const { coordinator } = createFixture({
    dataOpsStore: {
      listDashboardCustomers: async (options) => {
        calls.push(options);
        return [
          {
            id: 'klant-1',
            databaseStatus: 'klant',
            status: 'Betaald',
            type: 'Website',
            bedrag: 300,
            datum: '2026-03-23',
            interneNotities: 'mag nooit naar het dashboard',
            history: 'x'.repeat(100_000),
          },
        ];
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendDashboardCustomersResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.source, 'dashboard-customers');
  assert.equal(res.body.customers.length, 1);
  assert.equal(res.body.customers[0].websiteBedrag, 300);
  assert.equal(res.body.customers[0].interneNotities, undefined);
  assert.equal(res.body.customers[0].history, undefined);
  assert.deepEqual(Object.keys(res.body.customers[0]).sort(), [
    'bedrag',
    'bedrijf',
    'databaseStatus',
    'datum',
    'id',
    'naam',
    'onderhoudPerMaand',
    'status',
    'type',
    'websiteBedrag',
  ]);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bypassReadFailureCooldown, true);
});

test('runtime ops coordinator faalt veilig als formele dashboardklanten niet laden', async () => {
  const { coordinator } = createFixture({
    dataOpsStore: {
      listDashboardCustomers: async () => null,
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendDashboardCustomersResponse({}, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /dashboardklanten/i);
});

test('runtime ops coordinator returns 400 or 503 for invalid or unavailable ui-state reads', async () => {
  const invalidFixture = createFixture();
  const invalidRes = createResponseRecorder();

  await invalidFixture.coordinator.sendUiStateGetResponse({ query: {} }, invalidRes, '../bad');

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Ongeldige UI state scope');

  const unavailableFixture = createFixture({
    getUiStateValues: async () => null,
  });
  const unavailableRes = createResponseRecorder();

  await unavailableFixture.coordinator.sendUiStateGetResponse(
    { query: {} },
    unavailableRes,
    'dashboard'
  );

  assert.equal(unavailableRes.statusCode, 503);
  assert.match(unavailableRes.body.error, /Kon UI state niet laden/i);
});

test('runtime ops coordinator timeboxt hanging ui-state reads', async () => {
  const warnings = [];
  const { coordinator } = createFixture({
    uiStateReadTimeoutMs: 5,
    getUiStateValues: async () => new Promise(() => {}),
    logger: {
      warn: (...args) => warnings.push(args.join(' ')),
    },
  });
  const res = createResponseRecorder();
  const startedAt = Date.now();

  await coordinator.sendUiStateGetResponse({ query: {} }, res, 'premium_customers_database');

  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /Kon UI state niet laden/i);
  assert.ok(Date.now() - startedAt < 250, 'ui-state read moet snel fail-fast teruggeven');
  assert.match(warnings.join('\n'), /\[RuntimeOps\]\[ui-state-read-fallback\]/);
  assert.match(warnings.join('\n'), /UI-state read timeout/);
});

test('runtime ops coordinator merges patches for ui-state writes', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        panel: 'overview',
      },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-04-07T12:30:00.000Z',
      };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          drawer: 'open',
        },
        source: 'frontend',
        actor: 'serve',
      },
    },
    res,
    'dashboard'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(writes[0], {
    scope: 'dashboard',
    values: {
      panel: 'overview',
      drawer: 'open',
    },
    meta: {
      source: 'frontend',
      actor: 'serve',
    },
  });
});

test('runtime ops coordinator upserts compact customer mutations without reading or rewriting the full dataset', async () => {
  const bridgeWrites = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => {
      throw new Error('full customer read should not run for one customer upsert');
    },
    setUiStateValues: async () => {
      throw new Error('legacy ui-state write should not run for one customer upsert');
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_customers_database',
      setUiStateValues: async (scope, values, meta) => {
        bridgeWrites.push({ scope, values, meta });
        return {
          values,
          source: 'supabase:data_ops',
          updatedAt: '2026-08-24T14:30:00.000Z',
        };
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          softora_customers_premium_v1: JSON.stringify([{ id: 'klant-413', bedrijf: 'Administratieportaal' }]),
        },
        mode: 'upsert',
        upsertOnly: true,
        source: 'premium-klanten',
        actor: 'Premium klanten database',
      },
    },
    res,
    'premium_customers_database'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.source, 'supabase:data_ops');
  assert.deepEqual(bridgeWrites, [{
    scope: 'premium_customers_database',
    values: {
      softora_customers_premium_v1: '[{"id":"klant-413","bedrijf":"Administratieportaal"}]',
    },
    meta: {
      source: 'premium-klanten',
      actor: 'Premium klanten database',
      upsertOnly: true,
    },
  }]);
});

test('runtime ops coordinator rejects malformed customer upserts before data ops storage', async () => {
  const bridgeWrites = [];
  const { coordinator } = createFixture({
    dataOpsUiStateBridge: {
      canHandleScope: () => true,
      setUiStateValues: async (...args) => {
        bridgeWrites.push(args);
        return null;
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    { body: { patch: { softora_customers_premium_v1: '[]' }, mode: 'upsert' } },
    res,
    'premium_customers_database'
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'CUSTOMER_UPSERT_PAYLOAD_INVALID');
  assert.equal(bridgeWrites.length, 0);
});

test('runtime ops coordinator fails closed when a compact customer upsert is not confirmed', async () => {
  const legacyWrites = [];
  const { coordinator } = createFixture({
    setUiStateValues: async (...args) => {
      legacyWrites.push(args);
      return { values: {} };
    },
    dataOpsUiStateBridge: {
      canHandleScope: () => true,
      setUiStateValues: async () => null,
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          softora_customers_premium_v1: JSON.stringify([{ id: 'klant-fail-closed' }]),
        },
        mode: 'upsert',
      },
    },
    res,
    'premium_customers_database'
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'CUSTOMER_UPSERT_FAILED');
  assert.equal(legacyWrites.length, 0);
});

test('runtime ops coordinator saves data ops patches when ui-state pre-read is unavailable', async () => {
  const bridgeWrites = [];
  const legacyWrites = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => null,
    setUiStateValues: async (scope, values, meta) => {
      legacyWrites.push({ scope, values, meta });
      return null;
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_customers_database',
      setUiStateValues: async (scope, values, meta) => {
        bridgeWrites.push({ scope, values, meta });
        return {
          values,
          source: 'supabase:data_ops',
          updatedAt: '2026-06-11T12:00:00.000Z',
        };
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          softora_customers_premium_v1: '[{"id":"cust-2","bedrijf":"Softora"}]',
        },
        source: 'premium-database',
        actor: 'Premium database',
      },
    },
    res,
    'premium_customers_database'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.source, 'supabase:data_ops');
  assert.equal(legacyWrites.length, 0);
  assert.deepEqual(bridgeWrites[0], {
    scope: 'premium_customers_database',
    values: {
      softora_customers_premium_v1: '[{"id":"cust-2","bedrijf":"Softora"}]',
    },
    meta: {
      source: 'premium-database',
      actor: 'Premium database',
    },
  });
});

test('runtime ops coordinator bewaart sportschool logboek snapshots zonder premium login patchpad', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => null,
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-06-11T10:00:00.000Z',
      };
    },
  });
  const getRes = createResponseRecorder();
  const setRes = createResponseRecorder();
  const snapshot = {
    days: {
      tuesday: {
        orders: [1],
        exercises: {
          1: {
            id: 1,
            title: 'Leg Extensions',
            sets: '3',
            reps: '8',
            kg: '100',
            notes: '',
          },
        },
      },
    },
  };

  await coordinator.sendSportschoolLogbookGetResponse({}, getRes);
  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot,
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    setRes
  );

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.ok, true);
  assert.deepEqual(getRes.body.values, {});
  assert.equal(setRes.statusCode, 200);
  assert.equal(setRes.body.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope, 'sportschool_logboek');
  assert.equal(writes[0].meta.source, 'sportschool-logboek');
  assert.equal(writes[0].meta.actor, 'serve');
  assert.equal(typeof writes[0].values.sportschool_logboek_v1, 'string');
  assert.equal(JSON.parse(writes[0].values.sportschool_logboek_v1).days.tuesday.exercises['1'].kg, '100');
});

test('runtime ops coordinator leest sportschool logboek primair uit formele sportschooltabel', async () => {
  let legacyRead = false;
  const { coordinator } = createFixture({
    getUiStateValues: async () => {
      legacyRead = true;
      return {
        values: {
          sportschool_logboek_v1: JSON.stringify({
            days: {
              tuesday: {
                orders: [1],
                exercises: { 1: { title: 'Leg Extensions', kg: '100' } },
              },
            },
          }),
        },
        source: 'supabase',
        updatedAt: '2026-06-11T10:00:00.000Z',
      };
    },
    sportschoolLogbookStore: {
      readLogbookState: async () => ({
        values: {
          sportschool_logboek_v1: JSON.stringify({
            days: {
              tuesday: {
                orders: [1],
                exercises: { 1: { title: 'Leg Extensions', kg: '104' } },
              },
            },
          }),
        },
        source: 'supabase:sportschool',
        updatedAt: '2026-06-24T10:00:00.000Z',
      }),
      writeLogbookSnapshot: async () => null,
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookGetResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'supabase:sportschool');
  assert.equal(
    JSON.parse(res.body.values.sportschool_logboek_v1).days.tuesday.exercises['1'].kg,
    '104'
  );
  assert.equal(legacyRead, true);
});

test('runtime ops coordinator biedt een read-only publieke bootstrap zonder legacy-fallback', async () => {
  const snapshot = {
    version: 2,
    days: {
      wednesday: {
        orders: [1],
        exercises: { 1: { title: 'Chest Press', kg: '82' } },
      },
    },
  };
  let writes = 0;
  const { coordinator } = createFixture({
    getUiStateValues: async () => {
      throw new Error('publieke bootstrap mag legacy UI-state niet lezen');
    },
    sportschoolLogbookStore: {
      readLogbookState: async () => ({
        values: { sportschool_logboek_v1: JSON.stringify(snapshot) },
        source: 'supabase:sportschool',
        updatedAt: '2026-08-19T12:35:33.380Z',
      }),
      writeLogbookSnapshot: async () => {
        writes += 1;
        return null;
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookPublicGetResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive, nosnippet');
  assert.equal(res.body.source, 'supabase:sportschool-public');
  assert.deepEqual(Object.keys(res.body.values), ['sportschool_logboek_v1']);
  assert.deepEqual(JSON.parse(res.body.values.sportschool_logboek_v1), snapshot);
  assert.equal(writes, 0);
});

test('runtime ops coordinator herstelt nieuwer legacy sportschool logboek naar formele tabel', async () => {
  const recovered = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        sportschool_logboek_v1: JSON.stringify({
          days: {
            wednesday: {
              orders: [3],
              exercises: { 3: { title: 'Chest Press', kg: '68', reps: '10' } },
            },
          },
        }),
      },
      source: 'supabase',
      updatedAt: '2026-06-24T15:02:35.716Z',
    }),
    sportschoolLogbookStore: {
      readLogbookState: async () => ({
        values: {
          sportschool_logboek_v1: JSON.stringify({
            days: {
              wednesday: {
                orders: [3],
                exercises: { 3: { title: 'Chest Press', kg: '82', reps: '8' } },
              },
            },
          }),
        },
        source: 'supabase:sportschool',
        updatedAt: '2026-06-12T13:39:13.418Z',
      }),
      writeLogbookSnapshot: async (snapshot, meta) => {
        recovered.push({ snapshot: JSON.parse(snapshot), meta });
        return { values: { sportschool_logboek_v1: snapshot }, source: 'supabase:sportschool' };
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookGetResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'supabase');
  assert.equal(JSON.parse(res.body.values.sportschool_logboek_v1).days.wednesday.exercises['3'].kg, '68');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].meta.source, 'sportschool-logboek-legacy-recovery');
});

test('runtime ops coordinator laat nieuwere legacy v1 sportschooldata geen formele v2 overschrijven', async () => {
  const recovered = [];
  const syncedLegacy = [];
  const formalSnapshot = {
    version: 2,
    exerciseSources: {
      'name:CHEST PRESS': {
        title: 'CHEST PRESS',
        sets: '2',
        reps: '10',
        kg: '68',
        notes: '',
      },
    },
    days: {
      wednesday: {
        orders: [3],
        exercises: {
          3: {
            exerciseKey: 'name:CHEST PRESS',
            title: 'CHEST PRESS',
            sets: '2',
            reps: '10',
            kg: '68',
            notes: '',
          },
        },
      },
    },
  };
  const legacySnapshot = {
    version: 1,
    days: {
      wednesday: {
        orders: [3],
        exercises: {
          3: {
            title: 'CHEST PRESS',
            sets: '2',
            reps: '10',
            kg: '68',
            notes: '',
          },
        },
      },
    },
  };
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        sportschool_logboek_v1: JSON.stringify(legacySnapshot),
      },
      source: 'supabase',
      updatedAt: '2026-06-24T15:21:33.311Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      syncedLegacy.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-06-24T15:30:00.000Z',
      };
    },
    sportschoolLogbookStore: {
      readLogbookState: async () => ({
        values: {
          sportschool_logboek_v1: JSON.stringify(formalSnapshot),
        },
        source: 'supabase:sportschool',
        updatedAt: '2026-06-24T15:17:17.511Z',
      }),
      writeLogbookSnapshot: async (snapshot, meta) => {
        recovered.push({ snapshot: JSON.parse(snapshot), meta });
        return { values: { sportschool_logboek_v1: snapshot }, source: 'supabase:sportschool' };
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookGetResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'supabase:sportschool');
  assert.equal(JSON.parse(res.body.values.sportschool_logboek_v1).version, 2);
  assert.equal(recovered.length, 0);
  assert.equal(syncedLegacy.length, 1);
  assert.equal(syncedLegacy[0].meta.source, 'sportschool-logboek-canonical-sync');
  assert.equal(JSON.parse(syncedLegacy[0].values.sportschool_logboek_v1).exerciseSources['name:CHEST PRESS'].kg, '68');
});

test('runtime ops coordinator weigert stale v1 sportschool writes bovenop formele v2 data', async () => {
  const formalSnapshot = {
    version: 2,
    exerciseSources: {
      'name:CHEST PRESS': {
        title: 'CHEST PRESS',
        sets: '2',
        reps: '10',
        kg: '68',
        notes: '',
      },
    },
    days: {
      wednesday: {
        orders: [3],
        exercises: {
          3: {
            exerciseKey: 'name:CHEST PRESS',
            title: 'CHEST PRESS',
            sets: '2',
            reps: '10',
            kg: '68',
            notes: '',
          },
        },
      },
    },
  };
  const legacyWriteSnapshot = {
    version: 1,
    days: {
      wednesday: {
        orders: [3],
        exercises: {
          3: {
            title: 'CHEST PRESS',
            sets: '3',
            reps: '8',
            kg: '50',
            notes: '',
          },
        },
      },
    },
  };
  let formalWrites = 0;
  let legacyWrites = 0;
  const { coordinator } = createFixture({
    getUiStateValues: async () => null,
    setUiStateValues: async () => {
      legacyWrites += 1;
      return null;
    },
    sportschoolLogbookStore: {
      readLogbookState: async () => ({
        values: {
          sportschool_logboek_v1: JSON.stringify(formalSnapshot),
        },
        source: 'supabase:sportschool',
        updatedAt: '2026-06-24T15:17:17.511Z',
      }),
      writeLogbookSnapshot: async () => {
        formalWrites += 1;
        return null;
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: legacyWriteSnapshot,
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Verouderde sportschool logboekdata geweigerd/);
  assert.equal(JSON.parse(res.body.values.sportschool_logboek_v1).exerciseSources['name:CHEST PRESS'].kg, '68');
  assert.equal(formalWrites, 0);
  assert.equal(legacyWrites, 0);
});

test('runtime ops coordinator weigert oudere v2 sportschool snapshots met stale updatedAt', async () => {
  const writes = [];
  const currentSnapshot = {
    version: 2,
    updatedAt: '2026-07-01T10:00:02.000Z',
    exerciseSources: {
      'name:LEG EXTENSIONS': {
        title: 'LEG EXTENSIONS',
        sets: '3',
        reps: '8',
        kg: '104',
        notes: '',
      },
    },
    days: {
      tuesday: {
        orders: [1],
        exercises: {
          1: {
            exerciseKey: 'name:LEG EXTENSIONS',
            title: 'LEG EXTENSIONS',
            sets: '3',
            reps: '8',
            kg: '104',
            notes: '',
          },
        },
      },
    },
  };
  const staleSnapshot = {
    ...currentSnapshot,
    updatedAt: '2026-07-01T10:00:01.000Z',
    exerciseSources: {
      'name:LEG EXTENSIONS': {
        title: 'LEG EXTENSIONS',
        sets: '3',
        reps: '8',
        kg: '100',
        notes: '',
      },
    },
    days: {
      tuesday: {
        orders: [1],
        exercises: {
          1: {
            exerciseKey: 'name:LEG EXTENSIONS',
            title: 'LEG EXTENSIONS',
            sets: '3',
            reps: '8',
            kg: '100',
            notes: '',
          },
        },
      },
    },
  };
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        sportschool_logboek_v1: JSON.stringify(currentSnapshot),
      },
      source: 'supabase',
      updatedAt: '2026-07-01T10:00:03.000Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-07-01T10:00:04.000Z' };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: staleSnapshot,
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Verouderde sportschool logboekdata geweigerd/);
  assert.equal(JSON.parse(res.body.values.sportschool_logboek_v1).exerciseSources['name:LEG EXTENSIONS'].kg, '104');
  assert.equal(writes.length, 0);
});

test('runtime ops coordinator serialiseert sportschool writes zodat laatste snapshot wint', async () => {
  const writes = [];
  let currentState = null;
  const olderSnapshot = {
    version: 2,
    updatedAt: '2026-07-01T10:00:01.000Z',
    exerciseSources: {
      'name:LEG EXTENSIONS': {
        title: 'LEG EXTENSIONS',
        sets: '3',
        reps: '8',
        kg: '100',
        notes: '',
      },
    },
    days: {
      tuesday: {
        orders: [1],
        exercises: {
          1: {
            exerciseKey: 'name:LEG EXTENSIONS',
            title: 'LEG EXTENSIONS',
            sets: '3',
            reps: '8',
            kg: '100',
            notes: '',
          },
        },
      },
    },
  };
  const newerSnapshot = {
    version: 2,
    updatedAt: '2026-07-01T10:00:02.000Z',
    exerciseSources: {
      'name:LEG EXTENSIONS': {
        title: 'LEG EXTENSIONS',
        sets: '3',
        reps: '8',
        kg: '104',
        notes: '',
      },
    },
    days: {
      tuesday: {
        orders: [1],
        exercises: {
          1: {
            exerciseKey: 'name:LEG EXTENSIONS',
            title: 'LEG EXTENSIONS',
            sets: '3',
            reps: '8',
            kg: '104',
            notes: '',
          },
        },
      },
    },
  };
  const { coordinator } = createFixture({
    getUiStateValues: async () => currentState,
    setUiStateValues: async (scope, values, meta) => {
      const snapshot = JSON.parse(values.sportschool_logboek_v1);
      writes.push({ scope, snapshot, meta });
      if (snapshot.updatedAt === olderSnapshot.updatedAt) await delay(25);
      currentState = {
        values,
        source: 'supabase',
        updatedAt: snapshot.updatedAt,
      };
      return currentState;
    },
  });
  const olderRes = createResponseRecorder();
  const newerRes = createResponseRecorder();

  await Promise.all([
    coordinator.sendSportschoolLogbookSetResponse(
      {
        body: {
          snapshot: olderSnapshot,
          source: 'sportschool-logboek',
          actor: 'serve',
        },
      },
      olderRes
    ),
    coordinator.sendSportschoolLogbookSetResponse(
      {
        body: {
          snapshot: newerSnapshot,
          source: 'sportschool-logboek',
          actor: 'serve',
        },
      },
      newerRes
    ),
  ]);

  assert.equal(olderRes.statusCode, 200);
  assert.equal(newerRes.statusCode, 200);
  assert.deepEqual(writes.map((write) => write.snapshot.updatedAt), [
    '2026-07-01T10:00:01.000Z',
    '2026-07-01T10:00:02.000Z',
  ]);
  assert.equal(JSON.parse(currentState.values.sportschool_logboek_v1).exerciseSources['name:LEG EXTENSIONS'].kg, '104');
});

test('runtime ops coordinator weigert een nieuwere clientwrite vanaf een verouderde remote basis', async () => {
  const writes = [];
  const currentSnapshot = {
    version: 2,
    updatedAt: '2026-07-24T10:02:00.000Z',
    exerciseSources: {
      'name:CHEST PRESS': {
        title: 'CHEST PRESS',
        sets: '3',
        reps: '8',
        kg: '84',
        notes: '',
      },
    },
    days: {},
  };
  const incomingSnapshot = {
    ...currentSnapshot,
    updatedAt: '2026-07-24T10:03:00.000Z',
    exerciseSources: {
      ...currentSnapshot.exerciseSources,
      'name:CHEST PRESS': {
        ...currentSnapshot.exerciseSources['name:CHEST PRESS'],
        kg: '86',
      },
    },
  };
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: { sportschool_logboek_v1: JSON.stringify(currentSnapshot) },
      source: 'supabase',
      updatedAt: '2026-07-24T10:02:00.000Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: incomingSnapshot.updatedAt };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: incomingSnapshot,
        baseUpdatedAt: '2026-07-24T10:00:00.000Z',
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.conflict, true);
  assert.match(res.body.error, /intussen gewijzigd/);
  assert.equal(JSON.parse(res.body.values.sportschool_logboek_v1).exerciseSources['name:CHEST PRESS'].kg, '84');
  assert.equal(writes.length, 0);
});

test('runtime ops coordinator accepteert dezelfde remote versie met equivalente tijdzone-notatie', async () => {
  const writes = [];
  const currentSnapshot = {
    version: 2,
    updatedAt: '2026-07-24T10:02:00.000Z',
    exerciseSources: {},
    days: {},
  };
  const incomingSnapshot = {
    ...currentSnapshot,
    updatedAt: '2026-07-24T10:03:00.000Z',
  };
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: { sportschool_logboek_v1: JSON.stringify(currentSnapshot) },
      source: 'supabase',
      updatedAt: '2026-07-24T12:02:00.000+02:00',
    }),
    setUiStateValues: async (_scope, values) => {
      writes.push(values);
      return { values, source: 'supabase', updatedAt: incomingSnapshot.updatedAt };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: incomingSnapshot,
        baseUpdatedAt: '2026-07-24T10:02:00.000Z',
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(writes.length, 1);
});

test('runtime ops coordinator schrijft sportschool logboek via data-ops brug wanneer legacy opslag ontbreekt', async () => {
  const bridgedWrites = [];
  const legacyWrites = [];
  const { coordinator } = createFixture({
    setUiStateValues: async (scope, values, meta) => {
      legacyWrites.push({ scope, values, meta });
      return null;
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'sportschool_logboek',
      setUiStateValues: async (scope, values, meta) => {
        bridgedWrites.push({ scope, values, meta });
        return {
          values,
          source: 'data-ops',
          updatedAt: '2026-06-11T16:00:00.000Z',
        };
      },
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: {
          days: {
            tuesday: {
              orders: [1],
              exercises: {
                1: {
                  title: 'Leg Extensions',
                  sets: '3',
                  reps: '8',
                  kg: '100',
                  notes: '',
                },
              },
            },
          },
        },
        source: 'sportschool-logboek',
        actor: 'serve',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'data-ops');
  assert.equal(bridgedWrites.length, 1);
  assert.equal(legacyWrites.length, 0);
  assert.equal(bridgedWrites[0].scope, 'sportschool_logboek');
  assert.equal(JSON.parse(bridgedWrites[0].values.sportschool_logboek_v1).days.tuesday.exercises['1'].kg, '100');
});

test('runtime ops coordinator weigert kapotte sportschool logboekdata', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase' };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendSportschoolLogbookSetResponse(
    {
      body: {
        snapshot: { exercises: [] },
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(writes.length, 0);
});

test('runtime ops coordinator stores previous Word content as backup before overwrite', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        softora_premium_word_html_v1: '<p>Oude belangrijke tekst</p>',
        softora_premium_word_html_backups_v1: JSON.stringify([
          {
            html: '<p>Nog oudere tekst</p>',
            savedAt: '2026-06-04T10:00:00.000Z',
            source: 'premium-word',
            actor: 'browser',
          },
        ]),
      },
      source: 'supabase',
      updatedAt: '2026-06-05T12:12:41.149Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: meta.source,
        updatedAt: '2026-06-05T12:30:00.000Z',
      };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          softora_premium_word_html_v1: '<p>Nieuwe tekst</p>',
        },
        source: 'premium-word',
        actor: 'browser',
      },
    },
    res,
    'premium_word'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].values.softora_premium_word_html_v1, '<p>Nieuwe tekst</p>');

  const backups = JSON.parse(writes[0].values.softora_premium_word_html_backups_v1);
  assert.equal(backups.length, 2);
  assert.equal(backups[0].html, '<p>Oude belangrijke tekst</p>');
  assert.equal(backups[0].savedAt, '2026-06-05T12:12:41.149Z');
  assert.equal(backups[0].source, 'premium-word');
  assert.equal(backups[0].actor, 'browser');
  assert.equal(backups[1].html, '<p>Nog oudere tekst</p>');
});

test('runtime ops coordinator prefers structured data ops reads and mirrors writes safely', async () => {
  const bridgeCalls = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: { panel: 'legacy' },
      source: 'legacy',
      updatedAt: '2026-04-07T12:00:00.000Z',
    }),
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_customers_database',
      getUiStateValues: async (scope, options) => {
        bridgeCalls.push({ type: 'get', scope, hasLegacy: typeof options.legacyGetUiStateValues === 'function' });
        return {
          values: { softora_customers_premium_v1: '[{"id":"cust-1"}]' },
          source: 'supabase:data_ops',
          updatedAt: '2026-04-07T12:15:00.000Z',
        };
      },
      setUiStateValues: async (scope, values, meta) => {
        bridgeCalls.push({ type: 'set', scope, values, meta });
        return {
          values,
          source: 'supabase:data_ops',
          updatedAt: '2026-04-07T12:30:00.000Z',
        };
      },
    },
  });
  const getRes = createResponseRecorder();
  const setRes = createResponseRecorder();

  await coordinator.sendUiStateGetResponse({}, getRes, 'premium_customers_database');
  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: { softora_customers_premium_v1: '[{"id":"cust-2"}]' },
        source: 'premium-klanten',
      },
    },
    setRes,
    'premium_customers_database'
  );

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.source, 'supabase:data_ops');
  assert.equal(setRes.statusCode, 200);
  assert.equal(setRes.body.source, 'supabase:data_ops');
  assert.deepEqual(bridgeCalls.map((call) => call.type), ['get', 'get', 'set']);
  assert.equal(bridgeCalls[2].meta.source, 'premium-klanten');
});

test('runtime ops coordinator uses legacy ui-state when structured data ops reads hang', async () => {
  const warnings = [];
  let legacyRead = false;
  const { coordinator } = createFixture({
    dataOpsUiStateReadTimeoutMs: 5,
    dataOpsUiStateReadTimeoutMsByScope: {
      premium_customers_database: 5,
    },
    getUiStateValues: async () => {
      legacyRead = true;
      return {
        values: { softora_customers_premium_v1: '[{"id":"legacy-cust"}]' },
        source: 'memory',
        updatedAt: null,
      };
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_customers_database',
      getUiStateValues: async () => new Promise(() => {}),
    },
    logger: {
      warn: (...args) => warnings.push(args),
      error: (...args) => warnings.push(args),
    },
  });
  const res = createResponseRecorder();
  const startedAt = Date.now();

  await coordinator.sendUiStateGetResponse({}, res, 'premium_customers_database');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'memory');
  assert.deepEqual(res.body.values, { softora_customers_premium_v1: '[{"id":"legacy-cust"}]' });
  assert.equal(legacyRead, true);
  assert.ok(Date.now() - startedAt < 500);
  assert.match(String(warnings[0]?.[0] || ''), /DataOps/);
});

test('runtime ops coordinator honors scope-specific data ops read timeouts', async () => {
  const warnings = [];
  let legacyRead = false;
  const { coordinator } = createFixture({
    dataOpsUiStateReadTimeoutMs: 5,
    dataOpsUiStateReadTimeoutMsByScope: {
      premium_database_photos: 80,
    },
    getUiStateValues: async () => {
      legacyRead = true;
      return {
        values: { softora_database_photos_v1: '{}' },
        source: 'memory',
        updatedAt: null,
      };
    },
    dataOpsUiStateBridge: {
      canHandleScope: (scope) => scope === 'premium_database_photos',
      getUiStateValues: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          values: { softora_database_photos_v1: '{"cust-1":{"id":"cust-1"}}' },
          source: 'supabase:data_ops',
          updatedAt: '2026-06-05T12:00:00.000Z',
        };
      },
    },
    logger: {
      warn: (...args) => warnings.push(args),
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateGetResponse({}, res, 'premium_database_photos');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'supabase:data_ops');
  assert.equal(legacyRead, false);
  assert.equal(warnings.length, 0);
});

test('runtime ops coordinator treats values writes as patches unless replace is explicit', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        panel: 'overview',
        keep: 'yes',
      },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-04-07T12:30:00.000Z',
      };
    },
  });
  const patchRes = createResponseRecorder();
  const replaceRes = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        values: {
          panel: 'details',
        },
      },
    },
    patchRes,
    'dashboard'
  );
  await coordinator.sendUiStateSetResponse(
    {
      body: {
        replace: true,
        values: {
          panel: 'only',
        },
      },
    },
    replaceRes,
    'dashboard'
  );

  assert.equal(patchRes.statusCode, 200);
  assert.deepEqual(writes[0].values, {
    panel: 'details',
    keep: 'yes',
  });
  assert.equal(replaceRes.statusCode, 200);
  assert.deepEqual(writes[1].values, {
    panel: 'only',
  });
});

test('runtime ops coordinator blocks admin-only ui-state scopes for non-admin users', async () => {
  const { coordinator, securityAuditCalls } = createFixture();
  const getRes = createResponseRecorder();
  const setRes = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: false, email: 'medewerker@softora.nl' },
      originalUrl: '/api/ui-state-get?scope=premium_password_register',
      headers: { origin: 'https://app.softora.nl' },
      get: () => 'agent',
      ip: '203.0.113.9',
    },
    getRes,
    'premium_password_register'
  );
  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: false, email: 'medewerker@softora.nl' },
      originalUrl: '/api/ui-state-set?scope=premium_password_register',
      headers: { origin: 'https://app.softora.nl' },
      get: () => 'agent',
      ip: '203.0.113.9',
      body: { values: { entries_json: '[]' } },
    },
    setRes,
    'premium_password_register'
  );

  assert.equal(getRes.statusCode, 403);
  assert.match(getRes.body.error, /Alleen Full Acces-accounts/i);
  assert.equal(setRes.statusCode, 403);
  assert.match(setRes.body.error, /Alleen Full Acces-accounts/i);
  assert.equal(securityAuditCalls.length, 2);
  assert.equal(securityAuditCalls[0].reason, 'security_admin_ui_state_scope_denied');
  assert.equal(securityAuditCalls[0].payload.type, 'admin_ui_state_scope_denied');
  assert.match(securityAuditCalls[0].payload.detail, /premium_password_register/);
});

test('runtime ops coordinator allows admin users on admin-only ui-state scopes', async () => {
  const { coordinator, securityAuditCalls } = createFixture({
    getUiStateValues: async () => ({
      values: createPasswordRegisterValues(1),
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
      revision: 4,
      exists: true,
    }),
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    { premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' } },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'premium_password_register');
  assert.equal(res.body.revision, 4);
  assert.equal(
    securityAuditCalls.some((call) => call.reason === 'security_password_register_vault_read'),
    true
  );
});

test('password register scope fails closed when owner configuration is missing', async () => {
  let reads = 0;
  const { coordinator } = createFixture({
    getUiStateValues: async () => {
      reads += 1;
      return { values: createPasswordRegisterValues(), source: 'supabase' };
    },
    passwordRegisterOwnerPolicy: {
      getAccessDecision: () => ({
        ok: false,
        statusCode: 503,
        code: 'PASSWORD_REGISTER_OWNER_NOT_CONFIGURED',
        error: 'Ownerconfiguratie ontbreekt.',
      }),
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    { premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_admin_test' } },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_OWNER_NOT_CONFIGURED');
  assert.equal(reads, 0);
});

test('password register scope blocks a second admin who is not the configured owner', async () => {
  const { coordinator, securityAuditCalls } = createFixture();
  const res = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    { premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_other_admin' } },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_OWNER_REQUIRED');
  assert.equal(securityAuditCalls.at(-1).reason, 'security_password_register_owner_denied');
});

test('password register writes accept current envelopes and reject non-exact patch-only v1 bodies', async () => {
  const writes = [];
  const { coordinator, securityAuditCalls } = createFixture({
    getUiStateValues: async () => ({
      values: createPasswordRegisterValues(1),
      source: 'supabase',
      updatedAt: '2026-08-04T11:00:00.000Z',
      revision: 7,
      exists: true,
    }),
    compareAndSwapUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        ok: true,
        values,
        source: 'supabase',
        revision: 8,
        updatedAt: '2026-08-04T12:00:00.000Z',
      };
    },
  });
  const res = createResponseRecorder();
  const nextValues = createPasswordRegisterValues(2);

  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: createPasswordRegisterWriteBody(nextValues, {
        expectedRevision: 7,
        expectedUpdatedAt: '2026-08-04T11:00:00.000Z',
      }),
    },
    res,
    'premium_password_register'
  );

  const extraFieldRes = createResponseRecorder();
  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: { patch: createPasswordRegisterValues(1), source: 'not-an-exact-legacy-client' },
    },
    extraFieldRes,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(extraFieldRes.statusCode, 400);
  assert.equal(extraFieldRes.body.code, 'PASSWORD_REGISTER_VAULT_INVALID');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].values.entries_encrypted_v1, nextValues.entries_encrypted_v1);
  assert.equal(writes[0].values.updated_by, 'usr_password_owner');
  assert.notEqual(writes[0].values.updated_at, nextValues.updated_at);
  assert.equal(writes[0].meta.expectedRevision, 7);
  assert.equal(writes[0].meta.source, 'password-register-vault');
  assert.equal(writes[0].meta.actor, 'usr_password_owner');
  assert.equal(res.body.revision, 8);
  assert.equal(
    securityAuditCalls.some((call) => call.reason === 'security_password_register_vault_written'),
    true
  );
});

test('password register requires CAS fields and reports the authoritative revision', async () => {
  let writes = 0;
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: createPasswordRegisterValues(2),
      source: 'supabase',
      updatedAt: '2026-08-04T11:00:00.000Z',
      revision: 9,
      exists: true,
    }),
    compareAndSwapUiStateValues: async () => {
      writes += 1;
      return null;
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: createPasswordRegisterWriteBody(createPasswordRegisterValues(2)),
    },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_REVISION_REQUIRED');
  assert.equal(res.body.revision, 9);
  assert.equal(res.body.updatedAt, '2026-08-04T11:00:00.000Z');
  assert.equal(writes, 0);
});

test('password register rejects stale CAS before writing and propagates atomic conflicts', async () => {
  let writes = 0;
  const authoritativeState = {
    values: createPasswordRegisterValues(2),
    source: 'supabase',
    updatedAt: '2026-08-04T11:00:00.000Z',
    revision: 10,
    exists: true,
  };
  const staleFixture = createFixture({
    getUiStateValues: async () => authoritativeState,
    compareAndSwapUiStateValues: async () => {
      writes += 1;
      return null;
    },
  });
  const staleRes = createResponseRecorder();

  await staleFixture.coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: createPasswordRegisterWriteBody(createPasswordRegisterValues(2), {
        expectedRevision: 9,
        expectedUpdatedAt: '2026-08-04T10:59:00.000Z',
      }),
    },
    staleRes,
    'premium_password_register'
  );

  assert.equal(staleRes.statusCode, 409);
  assert.equal(staleRes.body.code, 'PASSWORD_REGISTER_REVISION_CONFLICT');
  assert.equal(staleRes.body.revision, 10);
  assert.equal(writes, 0);

  const atomicFixture = createFixture({
    getUiStateValues: async () => authoritativeState,
    compareAndSwapUiStateValues: async () => ({
      ok: false,
      conflict: true,
      revision: 11,
      updatedAt: '2026-08-04T11:01:00.000Z',
    }),
  });
  const atomicRes = createResponseRecorder();
  await atomicFixture.coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: createPasswordRegisterWriteBody(createPasswordRegisterValues(2), {
        expectedRevision: 10,
        expectedUpdatedAt: '2026-08-04T11:00:00.000Z',
      }),
    },
    atomicRes,
    'premium_password_register'
  );

  assert.equal(atomicRes.statusCode, 409);
  assert.equal(atomicRes.body.revision, 11);
  assert.equal(atomicRes.body.updatedAt, '2026-08-04T11:01:00.000Z');
});

test('password register rejects memory or fallback state instead of reading or writing it', async () => {
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: createPasswordRegisterValues(2),
      source: 'memory',
      updatedAt: null,
      revision: 0,
      exists: true,
    }),
  });
  const getRes = createResponseRecorder();
  const setRes = createResponseRecorder();
  const auth = { authenticated: true, isAdmin: true, userId: 'usr_password_owner' };

  await coordinator.sendUiStateGetResponse({ premiumAuth: auth }, getRes, 'premium_password_register');
  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: auth,
      body: createPasswordRegisterWriteBody(createPasswordRegisterValues(2), {
        expectedRevision: 0,
        expectedUpdatedAt: null,
      }),
    },
    setRes,
    'premium_password_register'
  );

  assert.equal(getRes.statusCode, 503);
  assert.equal(setRes.statusCode, 503);
  assert.equal(setRes.body.code, 'PASSWORD_REGISTER_STORAGE_UNAVAILABLE');
});

test('password register rejects plaintext and arbitrary fields', async () => {
  let writes = 0;
  const { coordinator } = createFixture({
    setUiStateValues: async () => {
      writes += 1;
      return null;
    },
  });
  const requests = [
    { ...createPasswordRegisterValues(2), entries_json: '[{"pw":"plaintext"}]' },
    { ...createPasswordRegisterValues(2), unexpected: 'value' },
  ];

  for (const values of requests) {
    const res = createResponseRecorder();
    await coordinator.sendUiStateSetResponse(
      {
        premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
        body: createPasswordRegisterWriteBody(values),
      },
      res,
      'premium_password_register'
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'PASSWORD_REGISTER_VAULT_INVALID');
  }

  assert.equal(writes, 0);
});

test('password register rejects every v1 write before authoritative read or CAS', async () => {
  let writes = 0;
  let reads = 0;
  const { coordinator, securityAuditCalls } = createFixture({
    getUiStateValues: async () => {
      reads += 1;
      return null;
    },
    compareAndSwapUiStateValues: async () => {
      writes += 1;
      return null;
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: true, userId: 'usr_password_owner' },
      body: createPasswordRegisterWriteBody(createPasswordRegisterValues(1), {
        expectedRevision: 5,
        expectedUpdatedAt: '2026-08-04T11:00:00.000Z',
      }),
    },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'PASSWORD_REGISTER_VAULT_INVALID');
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(
    securityAuditCalls.at(-1).reason,
    'security_password_register_vault_rejected'
  );
});

test('runtime ops coordinator creates manual dashboard activities with normalized defaults', () => {
  const { coordinator, dashboardActivityCalls } = createFixture();
  const res = createResponseRecorder();

  coordinator.sendDashboardActivityCreateResponse(
    {
      body: {
        type: 'contract_test',
        title: 'Handmatige update',
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(dashboardActivityCalls.length, 1);
  assert.equal(dashboardActivityCalls[0].reason, 'dashboard_activity_manual');
  assert.equal(dashboardActivityCalls[0].payload.source, 'premium-personeel-dashboard');
  assert.equal(dashboardActivityCalls[0].payload.actor, '');
});
