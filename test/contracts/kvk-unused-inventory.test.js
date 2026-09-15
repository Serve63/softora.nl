const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createKvkCompanyDirectoryService, DIRECTORY_TABLE, UNUSED_DIRECTORY_VIEW,
} = require('../../server/services/kvk-company-directory');

const migration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260916000500_kvk_unused_destination_filter.sql'), 'utf8');

function response() {
  return { status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; } };
}

function recordingClient(calls, result = { data: [], count: 0 }) {
  return { from(table) {
    const call = { table, filters: [] };
    calls.push(call);
    const request = {
      select(columns, options) { call.columns = columns; call.options = options; return this; },
      order(column, options) { call.order = [column, options]; return this; },
      limit(value) { call.limit = value; return this; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    for (const method of ['eq', 'neq', 'in', 'gt', 'gte', 'or', 'ilike']) {
      request[method] = (...args) => { call.filters.push([method, ...args]); return request; };
    }
    return request;
  } };
}

test('only the three unused categories read the destination-filtered view, for both rows and totals', async () => {
  for (const category of ['bruikbaar', 'met-website', 'zonder-werkende-website',
    'all', 'behandeld', 'bruikbaar-verklaard', 'succesvol-gevonden',
    'onbruikbaar-verklaard', 'controlekamer', 'controle', 'definitief']) {
    const calls = [];
    const service = createKvkCompanyDirectoryService({ getSupabaseClient: () => recordingClient(calls) });
    await service.fetchDirectoryRows({ category, cursor: 100, limit: 2, query: 'test' });
    await service.fetchDirectoryCount({ category, query: 'test' });
    const expected = ['bruikbaar', 'met-website', 'zonder-werkende-website'].includes(category)
      ? UNUSED_DIRECTORY_VIEW : DIRECTORY_TABLE;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.table), [expected, expected]);
    assert.deepEqual(calls[1].options, { count: 'exact', head: true });
    assert.deepEqual(calls[0].filters.filter(f => f[0] !== 'gt'), calls[1].filters);
    assert.deepEqual(calls[0].order, ['source_company_id', { ascending: true }]);
    assert.equal(calls[0].limit, 3);
    assert.ok(calls[0].filters.some(f => f[0] === 'gt' && f[2] === 100));
    assert.equal(calls[1].filters.some(f => f[0] === 'gt'), false);
  }
});

test('missing destination view fails closed, never returning raw mirror inventory', async () => {
  const calls = [];
  const service = createKvkCompanyDirectoryService({
    getSupabaseClient: () => recordingClient(calls, { error: { message: 'view unavailable' } }),
    fetchDirectoryMeta: async () => ({ ok: true, row: { completed: true, category_totals: { bruikbaar: 14000 } } }),
  });
  const res = response();
  await service.sendGetDirectoryResponse({ query: { categorie: 'bruikbaar' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.ok, false);
  assert.ok(calls.every(call => call.table === UNUSED_DIRECTORY_VIEW));
});

test('SQL migration is a server-only, non-mutating projection of the destination and mirror', () => {
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /from public\.softora_customers/);
  assert.match(migration, /from public\.softora_customer_identity_keys/);
  assert.match(migration, /revoke all on table .* from public, anon, authenticated;/);
  assert.match(migration, /grant select on table .* to service_role;/);
  assert.doesNotMatch(migration, /\b(?:insert into|update public\.|delete from|truncate|drop table)\b/i);
  assert.doesNotMatch(migration, /where deleted_at is null/i);
});

test('actual SQL excludes prior imports before category counts, search and pagination without deleting rows', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.softora_customers (
        customer_id text primary key, payload jsonb, email text, deleted_at timestamptz
      );
      create table public.softora_customer_identity_keys (
        key_type text, key_value text, customer_id text, deleted_at timestamptz
      );
      create table public.softora_kvk_company_directory (
        source_company_id bigint primary key, kvk_nummer text, bedrijfsnaam text,
        email text, website text, website_status text, search_text text,
        lead_status text, premium_database_transferred boolean,
        unusable_review_grade smallint default 0
      );
      alter table public.softora_customers enable row level security;
      alter table public.softora_customer_identity_keys enable row level security;
      alter table public.softora_kvk_company_directory enable row level security;
      grant select on all tables in schema public to service_role;
    `);
    for (let id = 1; id <= 12; id++) {
      await db.query(`insert into public.softora_kvk_company_directory values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`, [id, String(10000000 + id), `Synthetic ${id}`,
        id === 11 ? '' : `lead${id}@example.test`, id === 6 ? '' : `https://site${id}.test`,
        id === 6 ? 'no_website' : id === 7 ? 'unknown' : 'found', `synthetic ${id}`,
        id === 9 ? 'unusable' : 'usable', id === 8]);
    }
    // Same business through independent destination identities. Include old
    // tombstones and aliases so cleanup never resurrects an old import as new.
    const customers = [
      ['kvk', { kvkNummer: ' 10-000-001 ' }, '', null],
      ['source', { bronDatabase: 'Softora Bedrijven Scraper', bronCompanyId: '2' }, '', null],
      ['email', {}, '  LEAD3@EXAMPLE.TEST ', null],
      ['deleted', { kvkNummer: '10000004' }, '', '2026-01-01'],
      ['blank', { kvkNummer: null, bronCompanyId: null }, null, null],
      ['foreign-source', { bronDatabase: 'Unrelated database', bronCompanyId: '10' }, 'different@example.test', null],
    ];
    for (const row of customers) await db.query('insert into public.softora_customers values ($1,$2,$3,$4)',
      [row[0], JSON.stringify(row[1]), row[2], row[3]]);
    await db.exec(`insert into public.softora_customer_identity_keys values
      ('email',' LEAD5@EXAMPLE.TEST ','alias-target','2026-01-01'),
      ('email',null,'blank',null), ('email',' ','blank',null),
      ('domain','example.test','foreign-source',null);`);
    await db.exec(migration);
    await db.exec(migration); // repeatable deployment
    const ids = async (tail = '') => (await db.query(`select source_company_id::int as id
      from public.softora_kvk_unused_company_directory ${tail} order by source_company_id`)).rows.map(r => r.id);
    assert.deepEqual(await ids(), [6, 7, 10, 11, 12]);
    assert.deepEqual(await ids("where website <> '' and website_status not in ('no_website','not_working')"), [7, 10, 11, 12]);
    assert.deepEqual(await ids("where website_status in ('no_website','not_working')"), [6]);
    assert.deepEqual(await ids("where search_text ilike '%synthetic 1%'"), [10, 11, 12]);
    const page = await db.query(`select source_company_id::int as id from public.softora_kvk_unused_company_directory
      where source_company_id > 5 order by source_company_id limit 2`);
    assert.deepEqual(page.rows.map(r => r.id), [6, 7]);
    assert.equal((await db.query('select count(*)::int as n from public.softora_kvk_company_directory')).rows[0].n, 12);
    assert.equal((await db.query("select count(*)::int as n from public.softora_kvk_company_directory where lead_status='usable'")).rows[0].n, 11);
    // A future import disappears immediately, including after a stale robot sync.
    await db.exec(`insert into public.softora_customers values ('new-import','{"kvkNummer":"10000007"}',null,null);
      update public.softora_kvk_company_directory set premium_database_transferred=false where source_company_id=7;`);
    assert.deepEqual(await ids(), [6, 10, 11, 12]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query('select * from public.softora_kvk_unused_company_directory'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual(await ids(), [6, 10, 11, 12]);
    await assert.rejects(() => db.exec('delete from public.softora_kvk_unused_company_directory'), /permission denied|cannot delete/);
    await db.exec('reset role');
    const options = (await db.query("select reloptions from pg_class where relname='softora_kvk_unused_company_directory'")).rows[0].reloptions;
    assert.ok(options.includes('security_invoker=true'));
  } finally {
    await db.close();
  }
});
