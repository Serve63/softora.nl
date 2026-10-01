const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { directoryDossier } = require('../../server/services/kvk-directory-candidates');
const { createKvkCompanyDirectoryService } = require('../../server/services/kvk-company-directory');
const { companyRowHtml } = require('../../assets/kvk-database-total-found');

function candidate(overrides = {}) {
  return { bedrijfsnaam: 'Voorbeeld Salon', adres: 'Andere plaats', telefoonnummer: '0101234567',
    telefoon_bron_url: 'https://example.nl/contact', email: 'info@example.nl',
    email_bron_url: 'https://example.nl/contact', website: 'https://example.nl/',
    bron_url: 'https://example.nl/contact', onzekerheid: 'Adresverschil nog te controleren.', ...overrides };
}
function row(matches = [candidate()]) {
  return { source_company_id: 1, kvk_nummer: '12345678', bedrijfsnaam: 'Voorbeeld Salon',
    lead_status: 'unusable', unusable_reason: 'identity_unconfirmed',
    telefoonnummer: '', email: '', website: '',
    research_dossier: { identity_status: 'unconfirmed', possible_matches: matches } };
}
function response() {
  return { status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; } };
}

test('candidate evidence survives protected sync without appearing as directory contacts', async () => {
  let stored;
  const service = createKvkCompanyDirectoryService({ kvkDatabaseSyncToken: 'test-token',
    upsertDirectoryRows: async (rows) => { stored = rows; return { ok: true }; },
    fetchDirectoryRows: async () => ({ ok: true, rows: stored }),
    fetchDirectoryMeta: async () => ({ ok: true, row: { completed: true, total: 1 } }),
  });
  const sync = response();
  await service.sendPostDirectorySyncResponse({ headers: { authorization: 'Bearer test-token' },
    body: { generation: 'test-generation', rows: [row()] } }, sync);
  assert.equal(sync.statusCode, 200);
  assert.deepEqual(stored[0].research_dossier, row().research_dossier);
  assert.equal(stored[0].telefoonnummer, '');
  assert.equal(stored[0].email, '');
  assert.equal(stored[0].website, '');
  assert.equal(stored[0].lead_status, 'unusable');
  const read = response();
  await service.sendGetDirectoryResponse({ query: {} }, read);
  const html = companyRowHtml(read.payload.rows[0]);
  assert.match(html, /Ter controle/);
  assert.equal((html.match(/<tr>/g) || []).length, 1);
  assert.equal((html.match(/<td[ >]/g) || []).length, 7);
  assert.equal((html.match(/aria-label="Niet bevestigd">—/g) || []).length, 3);
  assert.doesNotMatch(html, /0101234567|info@example\.nl|example\.nl|Mogelijke match|<details|<summary/);
  assert.deepEqual(read.payload.rows[0].research_dossier, row().research_dossier);
});

test('multiple unconfirmed matches never leak into rows while approved contacts stay visible', () => {
  const item = row([candidate({ bedrijfsnaam: '<SCRIPT>attack</SCRIPT>', email: '', email_bron_url: '' }),
    candidate({ telefoonnummer: '', telefoon_bron_url: '', email: 'second@example.nl', website: 'javascript:alert(1)' })]);
  item.research_dossier = directoryDossier(item);
  const html = companyRowHtml(item);
  assert.match(html, /Ter controle/);
  assert.doesNotMatch(html, /Mogelijke match|second@example\.nl|SCRIPT|attack|<details|href="javascript:/i);
  item.research_dossier.possible_matches[0].website = 'javascript:alert(1)';
  assert.doesNotMatch(companyRowHtml(item), /href="javascript:/i);
  const approved = { ...item, lead_status: 'usable', unusable_reason: '', telefoonnummer: '0201234567' };
  assert.deepEqual(directoryDossier(approved), {});
  assert.match(companyRowHtml(approved), /0201234567/);
  assert.equal(require('../../assets/kvk-database-total-found').companyStatus({ ...item, unusable_review_grade: 2 }).label, 'Afgekeurd');
  assert.doesNotMatch(companyRowHtml(approved), /second@example.nl|0101234567/);
  const unsourced = row([candidate({ telefoon_bron_url: 'javascript:alert(1)', email_bron_url: '' })]);
  const dossier = directoryDossier(unsourced);
  assert.equal(dossier.possible_matches[0].telefoonnummer, '');
  assert.equal(dossier.possible_matches[0].email, '');
});

test('additive candidate migration keeps existing data and server-only access', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.softora_kvk_company_directory (kvk_nummer text primary key, email text, lead_status text);
      alter table public.softora_kvk_company_directory enable row level security;
      grant select, insert, update, delete on public.softora_kvk_company_directory to service_role;
      insert into public.softora_kvk_company_directory values ('12345678', 'old@example.nl', 'usable');`);
    const migration = fs.readFileSync(path.join(__dirname,
      '../../supabase/migrations/20260930211000_kvk_directory_candidate_contacts.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.softora_kvk_company_directory')).rows,
      [{ kvk_nummer: '12345678', email: 'old@example.nl', lead_status: 'usable', research_dossier: {} }]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query('select research_dossier from public.softora_kvk_company_directory'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
