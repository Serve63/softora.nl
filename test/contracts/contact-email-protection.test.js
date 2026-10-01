const test = require('node:test');
const assert = require('node:assert/strict');
const { isProtectedContactEmail, normalizeProtectedContactEmail } = require('../../server/services/contact-email-protection');
const { normalizeCustomerPayload } = require('../../server/services/data-ops-serialization');
const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');
const { createKvkCompanyDirectoryService } = require('../../server/services/kvk-company-directory');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getContactEmail } = require('../../assets/premium-database-table-helpers');

const protectedValues = [
  '[email protected]', '[email\u00a0protected]', '[EMAIL\u200bPROTECTED]',
  '[email&nbsp;protected]', '[email&#160;protected]', '[email&#xA0;protected]',
  '/cdn-cgi/l/email-protection#123abc',
  '<span class="__cf_email__" data-cfemail="123abc">contact</span>',
];

test('website protection markers cannot become contact email addresses', () => {
  for (const value of protectedValues) {
    assert.equal(isProtectedContactEmail(value), true, value);
    assert.equal(normalizeProtectedContactEmail(value), '', value);
  }
  for (const value of ['', '—', 'info@example.nl', 'emailprotected@example.nl', 'one@example.nl; two@example.nl']) {
    assert.equal(isProtectedContactEmail(value), false, value);
    assert.equal(normalizeProtectedContactEmail(value), value);
  }
});

test('the table hides stale protection markers and never guesses missing addresses', () => {
  for (const value of protectedValues) assert.equal(getContactEmail({ email: value }), '—');
  assert.equal(getContactEmail({ website: 'https://example.nl' }), '—');
  assert.equal(getContactEmail({ email: '[email protected]', contactEmail: 'info@example.nl' }), 'info@example.nl');
  const html = fs.readFileSync(path.join(__dirname, '../../premium-database.html'), 'utf8');
  assert.match(html, /const email = window\.SoftoraDatabaseTableHelpers\.getContactEmail\(raw\)/);
});

test('the SQLite source rejects protected addresses on insert and update', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../scripts/contact-email-protection-sqlite.sql'), 'utf8');
  const script = [
    'import sqlite3, json, sys',
    'db = sqlite3.connect(":memory:")',
    'db.execute("CREATE TABLE companies(id INTEGER PRIMARY KEY, email TEXT)")',
    'db.executescript(sys.argv[1])',
    'db.execute("INSERT INTO companies VALUES(1, ?)", ("info@example.nl",))',
    'for value in json.loads(sys.argv[2]):',
    ' for statement in ["INSERT INTO companies VALUES(2, ?)", "UPDATE companies SET email=? WHERE id=1"]:',
    '  try:',
    '   db.execute(statement, (value,))',
    '  except sqlite3.IntegrityError:',
    '   continue',
    '  raise AssertionError("Source accepted protection marker: " + value)',
    'assert db.execute("SELECT email FROM companies WHERE id=1").fetchone()[0] == "info@example.nl"',
    'db.execute("UPDATE companies SET email=?", ("emailprotected@example.nl",))',
  ].join('\n');
  execFileSync('python3', ['-c', script, sql, JSON.stringify(protectedValues)]);
});

test('a protected email disables mail without guessing an address or mutating the source', () => {
  const raw = { id: 'prospect', email: '[email protected]', mail: true, canMail: true, tel: '013 1234567' };
  const payload = normalizeCustomerPayload(raw);
  assert.equal(raw.email, '[email protected]');
  assert.equal(payload.email, '—');
  assert.equal(payload.telefoon, raw.tel);
  assert.equal(payload.mail, false);
  assert.equal(payload.canMail, false);
  assert.equal(payload.emailVerificationStatus, 'protected');
});

test('valid alias contacts and existing opt-outs survive removal of a protection marker', () => {
  const alternate = normalizeCustomerPayload({ email: '[email protected]', contactEmail: 'info@example.nl', mail: false });
  assert.equal(alternate.email, '');
  assert.equal(alternate.contactEmail, 'info@example.nl');
  assert.equal(alternate.mail, false);
  assert.equal(alternate.emailVerificationStatus, undefined);
  const primary = normalizeCustomerPayload({ email: 'info@example.nl', contactEmail: '[email protected]', canMail: false });
  assert.equal(primary.email, 'info@example.nl');
  assert.equal(primary.contactEmail, '');
  assert.equal(primary.canMail, false);
});

test('the canonical customer write sanitizes column and payload before the database upsert', async () => {
  let written;
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from(table) {
      assert.equal(table, 'softora_customers');
      return { upsert(rows) { written = rows; return Promise.resolve({ data: rows, error: null }); } };
    } }),
    logger: { error() {}, warn() {} },
  });
  const result = await store.upsertCustomers(protectedValues.map((email, index) => ({
    id: 'protected-' + index, bedrijf: 'Example', email, status: 'prospect', mail: true,
  })));
  assert.equal(result.ok, true);
  assert.equal(written.length, protectedValues.length);
  for (const row of written) {
    assert.equal(row.email, '—');
    assert.equal(row.payload.email, '—');
    assert.equal(row.payload.mail, false);
    assert.equal(row.payload.canMail, false);
  }
});

test('the KVK mirror discards protection markers before a source sync reaches storage', async () => {
  let written;
  const service = createKvkCompanyDirectoryService({
    kvkDatabaseSyncToken: 'fixture-token',
    upsertDirectoryRows: async (rows) => { written = rows; return { ok: true }; },
  });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await service.sendPostDirectorySyncResponse({
    headers: { 'x-kvk-sync-token': 'fixture-token' },
    body: { generation: 'fixture', rows: [
      { source_company_id: 1, kvk_nummer: '12345678', bedrijfsnaam: 'Protected', email: '[email protected]' },
      { source_company_id: 2, kvk_nummer: '87654321', bedrijfsnaam: 'Valid', email: 'info@example.nl' },
    ] },
  }, response);
  assert.equal(response.code, 200);
  assert.equal(written[0].email, '');
  assert.equal(written[1].email, 'info@example.nl');
});
