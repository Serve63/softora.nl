const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { PGlite } = require('@electric-sql/pglite');
const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');
const { createPremiumDatabaseCustomersArchiveResponder } = require('../../server/services/premium-database-customers-archive');
const { createPremiumDatabaseMailReadySnapshotService, parseMailReadySnapshotCacheValue, MAIL_READY_SNAPSHOT_CACHE_SCOPE, MAIL_READY_SNAPSHOT_CACHE_KEY } = require('../../server/services/premium-database-mail-ready-snapshot');
const { createCustomerSnapshotRowsRepository } = require('../../server/repositories/customer-snapshot-rows');
const { MAX_DATABASE_CUSTOMERS } = require('../../server/config/premium-database-limits');
const customerClient = require('../../assets/premium-database-customers-loader');
const snapshotClient = require('../../assets/premium-database-mail-ready-snapshot');

const quiet = { info() {}, warn() {}, error() {} };
const migration = name => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, end(body) { this.body = body; }, json(body) { this.body = body; } });
test('a complete 32810-company import survives SQL chunks, snapshot storage and browser pagination', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table softora_customers(customer_id text primary key, identity_key text, company text, contact_name text,
        phone text, email text, website text, database_status text, lifecycle_status text, responsible text,
        payload jsonb, updated_at timestamptz, deleted_at timestamptz);
      insert into softora_customers(customer_id,company,email,website,database_status,payload,updated_at)
        select 'lead-' || lpad(n::text,5,'0'), 'Synthetic ' || n, 'lead' || n || '@example.test', 'https://site' || n || '.test',
          'prospect', jsonb_build_object('id','lead-' || lpad(n::text,5,'0'), 'bedrijf','Synthetic ' || n,
            'email','lead' || n || '@example.test', 'website','https://site' || n || '.test', 'bronDatabase','Softora Bedrijven Scraper'),
          '2026-10-07T20:00:00Z'::timestamptz from generate_series(1,32810) n;`);
    await db.exec(migration('20261007205710_customer_archive_large_inventory.sql'));
    const counts = (await db.query('select count(*)::int n from softora_customers')).rows[0].n;
    const offsets = [];
    const client = { from(table) {
      assert.equal(table, 'softora_customers');
      const execute = async (offset, limit) => ({
        data: (await db.query('select * from softora_customers order by updated_at desc,customer_id asc offset $1 limit $2', [offset, limit])).rows,
        count: counts, error: null,
      });
      const q = { select() { return q; }, is() { return q; }, order() { return q; },
        range(from, to) { offsets.push(from); return execute(from, to - from + 1); }, limit(limit) { return execute(0, limit); } };
      return q;
    }, async rpc(name, args) {
      assert.equal(name, 'softora_customer_archive_chunk');
      offsets.push(args.p_offset);
      return { data: (await db.query('select public.softora_customer_archive_chunk($1,$2) value', [args.p_offset, args.p_limit])).rows[0].value, error: null };
    } };
    const store = createSoftoraDataOpsStore({ isSupabaseConfigured: () => true, getSupabaseClient: () => client, logger: quiet });
    const source = await store.listCustomerSnapshotRows({ pageSize: 250 });
    assert.equal(source.length, 32810);
    assert.equal(source.at(-1).customer_id, 'lead-32810');
    const page = await store.listCustomersPage({ offset: 28000, limit: 2 });
    assert.equal(page.customers[0].id, 'lead-28001');
    const chunk = await store.listCustomersArchiveChunk({ offset: 28000, limit: 2 });
    assert.equal(chunk[0].id, 'lead-28001');
    assert.equal((await db.query("select has_function_privilege('anon','public.softora_customer_archive_chunk(integer,integer)','execute') allowed")).rows[0].allowed, false);

    const archiveResponse = response();
    await createPremiumDatabaseCustomersArchiveResponder({ dataOpsStore: store, logger: quiet })({}, archiveResponse);
    assert.equal(archiveResponse.statusCode, 200);
    const archive = JSON.parse(gunzipSync(archiveResponse.body));
    assert.equal(archive.customers.length, 32810);
    assert.equal(new Set(archive.customers.map(row => row.id)).size, 32810);
    const loaded = await customerClient.load({ fetchJsonWithTimeout: async () => ({ ok: true, json: async () => archive }) });
    assert.equal(loaded.customers.length, 32810);
    assert.equal(customerClient.maxCustomers, MAX_DATABASE_CUSTOMERS);

    let durable;
    const snapshotService = createPremiumDatabaseMailReadySnapshotService({ logger: quiet,
      dataOpsStore: { listCustomerSnapshotRows: options => store.listCustomerSnapshotRows(options),
        listDesignPhotoAssetFlags: async () => [], listOutboundRecipientGuardKeys: async () => ['email:lead32810@example.test'],
        listDesignPhotosWithSignedUrls: async () => [] },
      getUiStateValues: async () => ({ values: {} }),
      setUiStateValues: async (scope, values) => { if (scope === MAIL_READY_SNAPSHOT_CACHE_SCOPE) durable = values[MAIL_READY_SNAPSHOT_CACHE_KEY]; return true; },
    });
    const snapshot = await snapshotService.buildMailReadySnapshot({ allRows: true, includeFoundSnapshot: true });
    assert.equal(snapshot.availableTotal, 32809);
    assert.equal(snapshot.availableCustomers.length, 32809);
    assert.equal(snapshot.foundTotal, 32809);
    assert.equal(snapshot.availableCustomers.some(row => row.id === 'lead-32810'), false, 'contact guards also protect rows beyond the old limit');
    const restored = parseMailReadySnapshotCacheValue(durable);
    assert.equal(restored.availableCustomers.length, 32809);
    assert.equal(new Set(restored.availableCustomers.map(row => row.id)).size, 32809);
    assert.ok(durable.length < 4000000, 'complete compressed cache fits the existing storage bound');
    assert.equal((await snapshotService.buildMailReadySnapshot({ offset: 28000, limit: 2 })).availableCustomers.length, 2);

    const state = {}, requests = [];
    const published = await snapshotClient.load({ state, useSnapshotArchive: false, renderPage() {}, logger: quiet,
      fetchJsonWithTimeout: async url => {
        const query = new URL(url, 'https://example.test').searchParams;
        const offset = Number(query.get('offset')) || 0; requests.push(offset);
        return { ok: true, json: async () => snapshotService.buildMailReadySnapshot({ offset, limit: query.get('limit'), includeFoundSnapshot: true }) };
      } });
    assert.equal(published, true);
    assert.equal(state.availableSnapshotCustomers.length, 32809);
    assert.ok(requests.some(offset => offset > 25000));
    assert.ok(offsets.some(offset => offset > 25000));
  } finally { await db.close(); }
});

test('snapshot reads continue through short Data API pages and reject incomplete or excessive sources', async () => {
  const all = Array.from({ length: 601 }, (_, index) => ({ customer_id: `row-${index}` }));
  let total = all.length, cap = 100, repeat = false;
  const repository = createCustomerSnapshotRowsRepository({ cachedRead: (_key, load) => load(), tableName: 'customers', readQueryTimeoutMs: 1000,
    run: async (_label, build) => ({ ok: true, ...await build({ from() {
      const q = { select() { return q; }, is() { return q; }, order() { return q; },
        range(from, to) { return { data: all.slice(repeat ? 0 : from, repeat ? cap : Math.min(to + 1, from + cap)), count: total }; } };
      return q;
    } }) }) });
  assert.equal((await repository.listCustomerSnapshotRows({ pageSize: 250 })).length, 601);
  total++; assert.equal(await repository.listCustomerSnapshotRows(), null, 'missing terminal rows cannot be published as complete');
  total = MAX_DATABASE_CUSTOMERS + 1; assert.equal(await repository.listCustomerSnapshotRows(), null);
  total = all.length; repeat = true; assert.equal(await repository.listCustomerSnapshotRows(), null, 'repeated pages cannot hide missing rows');
});
