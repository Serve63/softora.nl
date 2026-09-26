'use strict';

const { gzipSync, gunzipSync } = require('node:zlib');

// Shares a built campaign reply set between serverless instances. This is a
// cache only: entries are keyed by the campaign content_version and every read
// or write failure falls back to the canonical rebuild. Disable with
// MAILBOX_CAMPAIGN_SHARED_CACHE=0.
const MAILBOX_CAMPAIGN_LIST_CACHE_TABLE = 'softora_mailbox_campaign_list_cache';
const MAILBOX_CAMPAIGN_SHARED_CACHE_TIMEOUT_MS = 1500;
const MAILBOX_CAMPAIGN_SHARED_CACHE_MAX_ENCODED_CHARS = 4_000_000;
const MAILBOX_CAMPAIGN_SHARED_CACHE_MAX_INFLATED_BYTES = 32_000_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} duurde te lang.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isMailboxCampaignSharedCacheEnabled(env = {}) {
  return !/^(0|false|no|off)$/i.test(String(env.MAILBOX_CAMPAIGN_SHARED_CACHE || '').trim());
}

function createMailboxCampaignSharedCache({
  getSupabaseClient,
  timeoutMs = MAILBOX_CAMPAIGN_SHARED_CACHE_TIMEOUT_MS,
} = {}) {
  function getClient() {
    return typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
  }

  async function read(key) {
    const client = getClient();
    if (!client) return null;
    const result = await withTimeout(
      client.from(MAILBOX_CAMPAIGN_LIST_CACHE_TABLE)
        .select('content_version,built_at,payload').eq('cache_key', key).maybeSingle(),
      timeoutMs, 'Gedeelde campagnelijst lezen'
    );
    if (result?.error) throw result.error;
    const row = result?.data;
    const version = Number(row?.content_version);
    const builtAt = Date.parse(row?.built_at || '');
    if (!row || !Number.isSafeInteger(version) || !Number.isFinite(builtAt) || typeof row.payload !== 'string') return null;
    if (row.payload.length > MAILBOX_CAMPAIGN_SHARED_CACHE_MAX_ENCODED_CHARS) return null;
    const inflated = gunzipSync(Buffer.from(row.payload, 'base64'), {
      maxOutputLength: MAILBOX_CAMPAIGN_SHARED_CACHE_MAX_INFLATED_BYTES,
    });
    return { version, builtAt, value: JSON.parse(inflated.toString('utf8')) };
  }

  async function write(key, { version, builtAt, value }) {
    const client = getClient();
    if (!client) return false;
    const payload = gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
    if (payload.length > MAILBOX_CAMPAIGN_SHARED_CACHE_MAX_ENCODED_CHARS) return false;
    const row = {
      cache_key: key,
      content_version: version,
      built_at: new Date(builtAt).toISOString(),
      payload,
      updated_at: new Date().toISOString(),
    };
    const result = await withTimeout(
      client.from(MAILBOX_CAMPAIGN_LIST_CACHE_TABLE).upsert(row, { onConflict: 'cache_key' }),
      timeoutMs, 'Gedeelde campagnelijst opslaan'
    );
    if (result?.error) throw result.error;
    return true;
  }

  return { read, write };
}

module.exports = {
  MAILBOX_CAMPAIGN_LIST_CACHE_TABLE,
  createMailboxCampaignSharedCache,
  isMailboxCampaignSharedCacheEnabled,
};
