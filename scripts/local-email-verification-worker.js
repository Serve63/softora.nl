#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyMailbox } = require('../server/services/smtp-mailbox-validator');

const TABLE = 'softora_email_verifications';
const DEFAULT_ENV_FILE = path.join(os.homedir(), 'Desktop', 'softora.nl-main', '.env');
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 15 * 1000;
const VALIDITY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_MS = 24 * 60 * 60 * 1000;
const CATCH_ALL_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_PROCESSING_MS = 30 * 60 * 1000;

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed[match[1]] = value.replace(/\\n/g, '\n');
  }
  return parsed;
}

function getConfig(env = process.env) {
  const envFile = DEFAULT_ENV_FILE;
  const fileEnv = parseEnvFile(envFile);
  const supabaseUrl = String(env.SUPABASE_URL || fileEnv.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || !serviceRoleKey) {
    throw new Error(`SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY ontbreken in ${envFile}.`);
  }
  return {
    envFile,
    supabaseUrl,
    serviceRoleKey,
    batchSize: Math.max(1, Math.min(50, Number(env.EMAIL_VERIFICATION_BATCH_SIZE) || DEFAULT_BATCH_SIZE)),
    pollMs: DEFAULT_POLL_MS,
    heloHost: String(env.EMAIL_VERIFICATION_HELO_HOST || 'softora.nl').trim(),
  };
}

async function restRequest(config, suffix, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${TABLE}${suffix}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function recoverStaleRows(config, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS).toISOString();
  await restRequest(
    config,
    `?status=eq.processing&updated_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'pending',
        reason: 'verification_worker_recovered_stale_claim',
        updated_at: now.toISOString(),
      }),
    }
  );
}

async function listPending(config) {
  return restRequest(
    config,
    `?select=email,attempt_count,requested_at&status=eq.pending&order=requested_at.asc&limit=${config.batchSize}`,
    { method: 'GET' }
  );
}

async function claimRow(config, row, now = new Date()) {
  const result = await restRequest(
    config,
    `?email=eq.${encodeURIComponent(row.email)}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'processing',
        reason: 'smtp_verification_in_progress',
        updated_at: now.toISOString(),
      }),
    }
  );
  return Array.isArray(result) && result.length === 1 ? result[0] : null;
}

function buildPersistencePatch(result, row, now = new Date()) {
  const valid = result.status === 'valid';
  const invalid = result.status === 'invalid';
  const retryMs = result.catchAll === true ? CATCH_ALL_RETRY_MS : TRANSIENT_RETRY_MS;
  return {
    status: valid ? 'valid' : invalid ? 'invalid' : 'unknown',
    reason: result.reason,
    smtp_code: result.smtpCode,
    smtp_response: result.smtpResponse,
    mx_host: result.mxHost,
    catch_all: result.catchAll,
    checked_at: now.toISOString(),
    valid_until: valid ? new Date(now.getTime() + VALIDITY_MS).toISOString() : null,
    retry_after: valid || invalid ? null : new Date(now.getTime() + retryMs).toISOString(),
    attempt_count: Math.max(0, Number(row.attempt_count) || 0) + 1,
    source: 'softora-self-hosted-smtp-v1',
    updated_at: now.toISOString(),
  };
}

async function persistResult(config, row, result, now = new Date()) {
  await restRequest(config, `?email=eq.${encodeURIComponent(row.email)}&status=eq.processing`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(buildPersistencePatch(result, row, now)),
  });
}

async function processBatch(config, deps = {}) {
  const verify = deps.verifyMailbox || verifyMailbox;
  const rows = await listPending(config);
  let processed = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const claimed = await claimRow(config, row);
    if (!claimed) continue;
    const result = await verify(row.email, {
      heloHost: config.heloHost,
      timeoutMs: 12_000,
      maxMxHosts: 3,
    });
    await persistResult(config, { ...row, ...claimed }, result);
    processed += 1;
    console.log(`[MailboxVerifier] ${result.status} ${result.reason} (${processed}/${rows.length})`);
  }
  return processed;
}

async function main() {
  const config = getConfig();
  const once = process.argv.includes('--once');
  await recoverStaleRows(config);
  do {
    try {
      const processed = await processBatch(config);
      if (once) return;
      await new Promise((resolve) => setTimeout(resolve, processed ? 1000 : config.pollMs));
    } catch (error) {
      console.error('[MailboxVerifier][Error]', error?.message || error);
      if (once) throw error;
      await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    }
  } while (!once);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[MailboxVerifier][Fatal]', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPersistencePatch,
  getConfig,
  parseEnvFile,
  processBatch,
  recoverStaleRows,
};
