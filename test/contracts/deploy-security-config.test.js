const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractRenderServiceBlock(renderYaml, serviceName) {
  const startPattern = new RegExp(`^\\s+- type: web\\n\\s+name: ${serviceName}\\n`, 'm');
  const match = startPattern.exec(renderYaml);
  assert.ok(match, `Render service ${serviceName} bestaat`);

  const nextServiceIndex = renderYaml.slice(match.index + match[0].length).search(/\n\s+- type: web\n/);
  if (nextServiceIndex < 0) return renderYaml.slice(match.index);
  return renderYaml.slice(match.index, match.index + match[0].length + nextServiceIndex);
}

function assertRenderEnvKey(serviceBlock, key, expectedValue = null) {
  const keyPattern = new RegExp(`- key: ${key}\\n(?:\\s+[^\\n]+\\n){0,3}`, 'm');
  const match = keyPattern.exec(serviceBlock);
  assert.ok(match, `Render env ${key} ontbreekt`);
  if (expectedValue !== null) {
    assert.match(match[0], new RegExp(`value: ${expectedValue}`));
  }
}

test('render blueprint keeps production security env vars explicit for the main service', () => {
  const renderYaml = readRepoFile('render.yaml');
  const serviceBlock = extractRenderServiceBlock(renderYaml, 'softora-retell-coldcalling');

  assertRenderEnvKey(serviceBlock, 'NODE_ENV', 'production');
  assertRenderEnvKey(serviceBlock, 'PUBLIC_BASE_URL', 'https://www\\.softora\\.nl');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_SESSION_SECRET');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_MFA_TOTP_SECRET');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_REQUIRE_MFA', 'true');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_ADMIN_IP_ALLOWLIST');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS', 'true');
  assertRenderEnvKey(serviceBlock, 'PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES', 'false');
  assertRenderEnvKey(serviceBlock, 'SUPABASE_URL');
  assertRenderEnvKey(serviceBlock, 'SUPABASE_SERVICE_ROLE_KEY');
  assertRenderEnvKey(serviceBlock, 'WEBHOOK_SECRET');
  assertRenderEnvKey(serviceBlock, 'TWILIO_WEBHOOK_SECRET');
});

test('supabase runtime-state schema is server-only with row level security', () => {
  const schemaSql = readRepoFile('supabase/runtime-state-schema.sql');

  assert.match(schemaSql, /alter table public\.softora_runtime_state enable row level security;/i);
  assert.match(schemaSql, /alter table public\.softora_runtime_state force row level security;/i);
  assert.match(schemaSql, /revoke all on table public\.softora_runtime_state from anon;/i);
  assert.match(schemaSql, /revoke all on table public\.softora_runtime_state from authenticated;/i);
  assert.match(
    schemaSql,
    /grant select, insert, update, delete on table public\.softora_runtime_state to service_role;/i
  );
});
