const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.resolve(
  __dirname,
  '../../supabase/migrations/20260817124812_harden_webdesign_bulk_worker_lease.sql'
), 'utf8');
const schema = fs.readFileSync(path.resolve(__dirname, '../../supabase/data-ops-schema.sql'), 'utf8');

function leaseBlock(source) {
  const match = source.match(
    /-- webdesign-bulk-worker-lease:start[\s\S]*?-- webdesign-bulk-worker-lease:end/
  );
  assert.ok(match, 'webdesign bulk workerleaseblok ontbreekt');
  return match[0];
}

test('deploymigratie en data-ops-schema bevatten exact dezelfde background-workerlease', () => {
  assert.equal(leaseBlock(schema), leaseBlock(migration));
  assert.match(migration, /create table if not exists public\.softora_background_worker_locks/);
  assert.match(migration, /create or replace function public\.softora_claim_background_worker_lock/);
  assert.match(migration, /create or replace function public\.softora_release_background_worker_lock/);
});

test('background-workerlease claim is atomically fenced and expired leases can be reclaimed', () => {
  assert.match(
    migration,
    /on conflict \(lock_key\) do update set[\s\S]*where stored_lock\.lock_expires_at <= v_now[\s\S]*or stored_lock\.lock_token = v_lock_token/
  );
  assert.match(
    migration,
    /if found then[\s\S]*return query select true, v_current\.lock_token, v_current\.lock_expires_at/
  );
  assert.match(
    migration,
    /return query select false, null::text, v_current\.lock_expires_at/
  );
  assert.match(
    migration,
    /delete from public\.softora_background_worker_locks[\s\S]*lock_token = btrim\(coalesce\(p_lock_token, ''\)\)/
  );
});

test('background-workerlease is RLS protected and service-role only', () => {
  const block = leaseBlock(migration);
  assert.doesNotMatch(block, /security definer/i);
  assert.equal((block.match(/security invoker\s+set search_path = ''/g) || []).length, 2);
  assert.match(block, /alter table public\.softora_background_worker_locks enable row level security/);
  assert.match(
    block,
    /revoke all privileges on table public\.softora_background_worker_locks[\s\S]*from public, anon, authenticated, service_role/
  );
  assert.match(
    block,
    /grant select, insert, update, delete on table public\.softora_background_worker_locks[\s\S]*to service_role/
  );
  [
    'softora_claim_background_worker_lock\\(text, text, integer\\)',
    'softora_release_background_worker_lock\\(text, text\\)',
  ].forEach((signature) => {
    assert.match(block, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`));
    assert.match(block, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to service_role`));
  });
});
