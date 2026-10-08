const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createKvkDatabaseUploadService } = require('../../server/services/kvk-database-upload');
const { createKvkCompanyDirectoryService, DIRECTORY_SELECT_COLUMNS } = require('../../server/services/kvk-company-directory');
const { buildCustomerIdentityKey } = require('../../server/services/data-ops-serialization');
const { createKvkTransferInventory } = require('../../server/services/kvk-transfer-inventory');
const { createController, createPendingNavigation } = require('../../assets/kvk-database-upload');
const requestId = '06ef6c6d-98ef-4cc4-b5f4-39e6d1d6bbc4';
const secondId = 'd13a45d5-99be-43d8-b933-c2bd6eaf8d75';
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
const migration = name => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');

test('real transfer transaction shares exact stock with listings and atomically preserves exclusions', async () => {
  const db = new PGlite();
  try {
    const fields = DIRECTORY_SELECT_COLUMNS.split(',').filter(key => !['source_company_id', 'premium_database_transferred', 'unusable_review_grade'].includes(key));
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table softora_customers(customer_id text primary key, identity_key text, company text, contact_name text,
        phone text, email text, website text, database_status text, lifecycle_status text, responsible text,
        payload jsonb, source text, version bigint, deleted_at timestamptz);
      create table softora_customer_identity_keys(key_type text, key_value text);
      create table softora_outbound_recipient_guards(guard_key text primary key);
      create table softora_kvk_company_directory(source_company_id bigint primary key,
        ${fields.map(key => `${key} text default ''`).join(',')}, search_text text,
        unusable_review_grade smallint default 0, premium_database_transferred boolean default false);
      grant select, insert, update on all tables in schema public to service_role;`);
    await db.exec(migration('20260923124429_restore_returned_kvk_directory_rows.sql'));
    await db.exec(migration('20260924132100_kvk_upload_available.sql'));
    const sql = migration('20261007203220_kvk_upload_shared_inventory.sql');
    await db.exec(sql); await db.exec(sql);
    await db.exec(migration('20261007215800_kvk_inventory_single_read.sql'));
    const timeoutMigration = migration('20261008150122_kvk_bulk_upload_timeout.sql');
    await db.exec(timeoutMigration); await db.exec(timeoutMigration);
    const config = (await db.query("select proconfig, prosecdef from pg_proc where oid='softora_kvk_upload_available_counted(uuid,text,boolean,jsonb,integer)'::regprocedure")).rows[0];
    assert.ok(config.proconfig.includes('statement_timeout=60s'));
    assert.ok(config.proconfig.includes('search_path=public'));
    assert.equal(config.prosecdef, false, 'bulk timeout must preserve invoker access');
    const rows = Array.from({ length: 10 }, (_, index) => ({ source_company_id: index + 1,
      kvk_nummer: String(10000001 + index), bedrijfsnaam: `Synthetic ${index + 1}`, telefoonnummer: `123${index + 1}`,
      email: `lead${index + 1}@example.test`, website: `site${index + 1}.test`, website_status: 'found', lead_status: 'usable',
      search_text: `synthetic ${index + 1}` }));
    rows[2].email = rows[0].email;
    Object.assign(rows[3], { bedrijfsnaam: rows[0].bedrijfsnaam, telefoonnummer: rows[0].telefoonnummer });
    rows[6].kvk_nummer = 'invalid';
    Object.assign(rows[7], { website_status: 'no_website', website: '' });
    for (const row of rows) {
      const keys = Object.keys(row);
      await db.query(`insert into softora_kvk_company_directory(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    }
    const identity = row => buildCustomerIdentityKey({ bedrijf: row.bedrijfsnaam, naam: row.bedrijfsnaam, tel: row.telefoonnummer });
    await db.query("insert into softora_outbound_recipient_guards values ($1)", [`email:${rows[1].email}`]);
    await db.query("insert into softora_customers(customer_id,identity_key,payload,source) values('existing',$1,'{}','manual')", [identity(rows[5])]);
    await db.query(`insert into softora_customers(customer_id,identity_key,payload,source,deleted_at)
      values('returned',$1,$2,'kvk-database-return-to-scraper',now())`, [identity(rows[9]), JSON.stringify({ kvkNummer: rows[9].kvk_nummer, bronDatabase: 'Softora Bedrijven Scraper' })]);
    let pageReads = 0;
    const client = { from(table) {
      if (table === 'softora_kvk_upload_receipts') return { select() { return { eq(_key, id) { return { async maybeSingle() {
        const found = await db.query('select result from softora_kvk_upload_receipts where request_id=$1', [id]);
        return { data: found.rows[0] || null };
      } }; } }; } };
      assert.equal(table, 'softora_kvk_unused_company_directory');
      let after = 0, columns;
      const q = { select(value) { columns = value; return q; }, gt(_key, value) { after = value; return q; }, order() { return q; }, async limit() {
        pageReads++;
        return { data: (await db.query(`select ${columns} from softora_kvk_unused_company_directory where source_company_id>$1 order by source_company_id limit 3`, [after])).rows };
      } }; return q;
    }, async rpc(name, args) {
      if (name === 'softora_kvk_unused_inventory_rows') {
        pageReads++;
        return { data: (await db.query('select softora_kvk_unused_inventory_rows() as rows')).rows[0].rows };
      }
      try { return { data: (await db.query('select softora_kvk_upload_available_counted($1::uuid,$2,$3,$4::jsonb,$5) as result',
        [args.p_request_id, args.p_mode, args.p_dry_run, JSON.stringify(args.p_candidates), args.p_limit])).rows[0].result }; }
      catch (error) { return { error }; }
    } };
    let guardUnavailable = false;
    const upload = createKvkDatabaseUploadService({ getSupabaseClient: () => client, getUiStateValues: async () => {
      if (guardUnavailable) throw new Error('Guard unavailable');
      return { values: { softora_coldmail_send_guard_v1: JSON.stringify({ recipientEntries: [{ recipientEmail: rows[4].email }] }) } };
    } });
    const preview = response(); await upload.preview({}, preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.count, 3); assert.equal(preview.body.sourceCount, 9); assert.equal(preview.body.excludedCount, 6);
    assert.deepEqual(preview.body.exclusions, { previouslyContacted: 2, existingCustomer: 1, invalid: 1, duplicateIdentity: 1, duplicateEmail: 1 });
    assert.equal(pageReads, 1, 'one SQL snapshot must contain the entire source');
    assert.equal((await db.query('select count(*)::int n from softora_kvk_upload_receipts')).rows[0].n, 0);
    const directory = createKvkCompanyDirectoryService({ readTransferInventory: upload.readInventory });
    const list = await directory.fetchDirectoryRows({ category: 'met-website', limit: 1 });
    assert.deepEqual(list.rows.map(row => Number(row.source_company_id)), [1, 9]);
    assert.equal((await directory.fetchDirectoryCount({ category: 'met-website' })).count, 3);
    assert.equal((await directory.fetchDirectoryCount({ category: 'bruikbaar' })).count, 4);
    assert.equal((await directory.fetchDirectoryCount({ category: 'met-website', query: 'synthetic 10' })).count, 1);
    assert.deepEqual((await directory.fetchDirectoryRows({ category: 'met-website', cursor: 9 })).rows.map(row => Number(row.source_company_id)), [10]);
    assert.equal(pageReads, 1, 'counts and lists reuse one verified read');
    const shortage = response(); await upload.upload({ body: { mode: 'with-website', requestId, count: 4 } }, shortage);
    assert.equal(shortage.statusCode, 409);
    assert.equal((await db.query('select count(*)::int n from softora_customers')).rows[0].n, 2);
    assert.equal((await db.query('select count(*)::int n from softora_kvk_upload_receipts')).rows[0].n, 0);
    const success = response(); await upload.upload({ body: { mode: 'with-website', requestId, count: 2 } }, success);
    assert.equal(success.body.count, 2);
    assert.deepEqual((await db.query('select source_company_id::int id from softora_kvk_company_directory where premium_database_transferred order by source_company_id')).rows.map(row => row.id), [1, 9]);
    assert.equal((await directory.fetchDirectoryCount({ category: 'met-website' })).count, 1);
    guardUnavailable = true;
    const replay = response(); await upload.upload({ body: { mode: 'with-website', requestId, count: 2 } }, replay);
    assert.equal(replay.body.replayed, true); assert.equal(replay.body.count, 2);
    const mismatch = response(); await upload.upload({ body: { mode: 'with-website', requestId, count: 1 } }, mismatch);
    assert.equal(mismatch.statusCode, 409);
    guardUnavailable = false;
    const final = response(); await upload.upload({ body: { mode: 'with-website', requestId: secondId, count: 1 } }, final);
    assert.equal(final.body.count, 1);
    assert.equal((await db.query("select count(*)::int n from softora_customers where source='kvk-database-transfer'")).rows[0].n, 3);
    assert.equal((await db.query('select count(*)::int n from softora_outbound_recipient_guards')).rows[0].n, 1);
    assert.equal((await directory.fetchDirectoryCount({ category: 'met-website' })).count, 0);
    assert.equal((await directory.fetchDirectoryCount({ category: 'bruikbaar' })).count, 1);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query("select softora_kvk_upload_available_counted(null,'with-website',true,'[]',null)"), /permission denied/);
      await assert.rejects(() => db.query('select softora_kvk_unused_inventory_rows()'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.ok(Array.isArray((await db.query('select softora_kvk_unused_inventory_rows() rows')).rows[0].rows));
    await db.exec('reset role');
    // Exercise the reported batch size through the service and real transaction.
    const bulkCount = 12844, bulkId = '811c1d6e-93cc-4ea4-b4bc-a5b54e7d2c84';
    await db.exec(`insert into softora_kvk_company_directory
      (source_company_id,kvk_nummer,bedrijfsnaam,telefoonnummer,email,website,website_status,lead_status)
      select n, (20000000+n)::text, 'Bulk Example '||n, '123'||n,
        'bulk'||n||'@example.test', 'bulk'||n||'.test', 'found', 'usable'
      from generate_series(100, ${bulkCount + 99}) n`);
    await db.exec('set role service_role');
    const bulkPreview = response(); await upload.preview({}, bulkPreview);
    assert.equal(bulkPreview.body.count, bulkCount);
    const bulk = response(); await upload.upload({ body: { mode: 'with-website', requestId: bulkId, count: bulkCount } }, bulk);
    assert.equal(bulk.statusCode, 200); assert.equal(bulk.body.count, bulkCount);
    const bulkReplay = response(); await upload.upload({ body: { mode: 'with-website', requestId: bulkId, count: bulkCount } }, bulkReplay);
    assert.equal(bulkReplay.body.replayed, true); assert.equal(bulkReplay.body.count, bulkCount);
    assert.equal((await db.query("select count(*)::int n from softora_customers where payload->>'premiumTransferRunId'=$1", ['kvk-transfer-' + bulkId])).rows[0].n, bulkCount);
    assert.equal((await db.query('select count(*)::int n from softora_kvk_company_directory where source_company_id>=100 and premium_database_transferred')).rows[0].n, bulkCount);
    assert.equal((await db.query('select count(*)::int n from softora_kvk_upload_receipts where request_id=$1', [bulkId])).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from softora_outbound_recipient_guards')).rows[0].n, 1);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('inventory refuses corrupt guards and mismatched SQL row IDs without a raw fallback', async () => {
  let rpcCalls = 0;
  const db = { from() { const q = { select() { return q; }, gt() { return q; }, order() { return q; }, async limit() { return { data: [] }; } }; return q; },
    async rpc(name) { rpcCalls++; return { data: name === 'softora_kvk_unused_inventory_rows' ? [] : { count: 1, sourceIds: [2] } }; } };
  for (const raw of ['{invalid', { entries: {} }, []]) {
    const stock = createKvkTransferInventory({ getClient: () => db, getUiStateValues: async () => ({ values: { softora_coldmail_send_guard_v1: raw } }) });
    await assert.rejects(() => stock.read());
  }
  assert.equal(rpcCalls, 0);
  const stock = createKvkTransferInventory({ getClient: () => db, getUiStateValues: async () => ({ values: {} }) });
  await assert.rejects(() => stock.read(), /gewijzigd/);
});

function uiFixture(fetch, pendingNavigation, refresh) {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { value: '1', disabled: false, hidden: true, textContent: '', addEventListener() {}, showModal() {}, close() {} }); return nodes.get(id); } };
  return { ui: createController({ document, fetch, pendingNavigation, crypto: { randomUUID: () => requestId }, refresh }), nodes };
}
const ok = count => ({ ok: true, json: async () => ({ ok: true, count }) });

test('uncertain uploads survive page reload and can replay while the stock reader is unavailable', async () => {
  const windowRef = { location: { href: 'https://www.softora.nl/kvk-database?tab=planning#current' }, history: { state: { other: true }, replaceState(_state, _title, url) { windowRef.location.href = url; } } };
  const navigation = createPendingNavigation({ top: windowRef });
  const first = uiFixture(async (_url, options) => { if (!options.method) return ok(10); throw new Error('Connection lost after commit'); }, navigation);
  await first.ui.open(); first.nodes.get('kvk-upload-amount').value = '5'; await first.ui.upload();
  assert.equal(navigation.read().requestId, requestId);
  const calls = [];
  const reloaded = uiFixture(async (_url, options) => { assert.equal(options.method, 'POST'); calls.push(JSON.parse(options.body)); return ok(5); }, navigation);
  await reloaded.ui.open(); assert.equal(calls.length, 0); assert.equal(reloaded.nodes.get('kvk-upload-amount').disabled, true);
  await reloaded.ui.upload();
  assert.deepEqual(calls, [{ mode: 'with-website', requestId, count: 5 }]); assert.equal(navigation.read().requestId, null);
  assert.equal(windowRef.location.href, 'https://www.softora.nl/kvk-database?tab=planning#current');
  assert.equal(reloaded.nodes.get('kvk-upload-result').hidden, false);
});

test('stock conflicts refresh the count and let the user select a new valid amount', async () => {
  let reads = 0, writes = 0;
  const f = uiFixture(async (_url, options) => {
    if (!options.method) return ok(++reads === 1 ? 10 : 3);
    if (++writes === 1) return { ok: false, status: 409, json: async () => ({ ok: false, error: 'Stock fell' }) };
    return ok(JSON.parse(options.body).count);
  });
  await f.ui.open(); f.nodes.get('kvk-upload-amount').value = '5'; await f.ui.upload();
  assert.equal(f.nodes.get('kvk-upload-count').textContent, '3 beschikbaar');
  assert.equal(f.nodes.get('kvk-upload-amount').disabled, false); assert.equal(f.nodes.get('kvk-upload-amount').value, '3');
  await f.ui.upload(); assert.equal(writes, 2); assert.equal(f.nodes.get('kvk-upload-result').hidden, false);
});

test('a refresh error after a confirmed upload cannot turn success into an uncertain retry', async () => {
  const f = uiFixture(async (_url, options) => ok(options.method ? 1 : 10), undefined, () => { throw new Error('Render failed'); });
  await f.ui.open(); await f.ui.upload(); await f.ui.upload();
  assert.match(f.nodes.get('kvk-upload-message').textContent, /1 bedrijven toegevoegd/);
  assert.equal(f.nodes.get('kvk-upload-with-website').disabled, true);
});

test('an obsolete failed preview cannot overwrite a newer successful dialog', async () => {
  let rejectFirst, reads = 0;
  const f = uiFixture(async () => ++reads === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : ok(3));
  const first = f.ui.open(); await Promise.resolve(); await f.ui.open();
  rejectFirst(new Error('Old request failed')); await first;
  assert.equal(f.nodes.get('kvk-upload-count').textContent, '3 beschikbaar');
  assert.equal(f.nodes.get('kvk-upload-message').textContent, '');
});
