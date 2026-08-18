const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260818142317_mailbox_outbound_guard_ledger.sql'
);
const schemaPath = path.resolve(__dirname, '../../supabase/data-ops-schema.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync(schemaPath, 'utf8');

function ledgerBlock(source) {
  const match = source.match(
    /-- mailbox-outbound-guard-ledger:start[\s\S]*?-- mailbox-outbound-guard-ledger:end/
  );
  assert.ok(match, 'mailbox outbound guard ledger-blok ontbreekt');
  return match[0];
}

test('deploymigratie en data-ops-schema bevatten exact dezelfde idempotente ledger', () => {
  assert.equal(ledgerBlock(schema), ledgerBlock(migration));
  assert.match(migration, /on conflict \(guard_key\) do update/g);
  assert.match(migration, /system:mailbox-outbound-ledger-v1/);
  assert.match(migration, /status = 'ready',[\s\S]*permanent = true/);
});

test('mailbox writes vullen de centrale guard voor alle outbound folders', () => {
  assert.match(
    migration,
    /v_folder <> all\(array\['sent', 'coldmail', 'instantly'\]::text\[\]\)/
  );
  assert.match(
    migration,
    /create trigger softora_sync_mailbox_outbound_recipient_guards[\s\S]*after insert or update of[\s\S]*on public\.softora_mailbox_messages[\s\S]*for each row/
  );
  assert.match(migration, /'email:' \|\| recipient_email as guard_key/);
  assert.match(migration, /'domain:' \|\| domain_key as guard_key/);
  assert.match(migration, /'mailbox-outbound-ledger'/);
});

test('persoonlijke mailboxen krijgen alleen een exacte e-mailguard', () => {
  [
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'icloud.com',
    'me.com',
    'msn.com',
    'yahoo.com',
    'proton.me',
    'protonmail.com',
  ].forEach((domain) => assert.ok(migration.includes(`'${domain}'`), `${domain} ontbreekt`));
  assert.match(
    migration,
    /domain_keys as \([\s\S]*not public\.softora_outbound_guard_is_personal_domain\(raw_domain\)/
  );
  assert.match(
    migration,
    /when public\.softora_outbound_guard_is_personal_domain\(raw_domain\) then ''/
  );
});

test('de ledger promoveert bestaande reserveringen zonder hun identiteit of bewijs te overschrijven', () => {
  assert.match(migration, /status = 'sent',[\s\S]*permanent = true,[\s\S]*expires_at = null/);
  assert.match(
    migration,
    /recipient_email = coalesce\(nullif\(existing_guard\.recipient_email, ''\), excluded\.recipient_email\)/
  );
  assert.match(
    migration,
    /when existing_guard\.payload = '\{\}'::jsonb then excluded\.payload[\s\S]*else existing_guard\.payload/
  );
  assert.match(migration, /latest_key_rows as \([\s\S]*distinct on \(guard_key\)/);
  assert.equal(
    (migration.match(/where existing_guard\.permanent = false/g) || []).length,
    2,
    'bestaande permanente guards mogen tijdens backfill of trigger niet worden herschreven'
  );
});

test('alle ledgerfuncties zijn afgeschermd en alleen voor service_role uitvoerbaar', () => {
  assert.doesNotMatch(ledgerBlock(migration), /security definer/i);
  [
    'softora_mailbox_outbound_recipient_emails(text, jsonb)',
    'softora_outbound_guard_domain_key(text)',
    'softora_outbound_guard_is_personal_domain(text)',
    'softora_record_mailbox_outbound_recipient_guards(text, text, text, text, text, jsonb, timestamptz, timestamptz)',
    'softora_sync_mailbox_outbound_recipient_guards()',
  ].forEach((signature) => {
    assert.ok(
      migration.includes(`revoke all on function public.${signature}\n  from public, anon, authenticated;`),
      `${signature} mist publieke revoke`
    );
    assert.ok(
      migration.includes(`grant execute on function public.${signature}\n  to service_role;`),
      `${signature} mist service_role grant`
    );
  });
});
