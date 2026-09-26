'use strict';

// Reuses a built campaign reply set while the database campaign
// content_version is unchanged. Triggers bump that version on every campaign
// message, state (read/dismissed/starred/deleted) and send-provenance change.
// Inputs outside that version (customer rows, recipient guards) are bounded by
// MAX_AGE_MS, and any failure to read the version falls back to a full build.
const MAILBOX_CAMPAIGN_CONSISTENCY_TABLE = 'softora_mailbox_campaign_consistency';
const MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const MAILBOX_CAMPAIGN_VERSION_READ_TIMEOUT_MS = 1500;
const MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_ENTRIES = 12;

function createMailboxCampaignContentVersionReader({ getSupabaseClient, timeoutMs = MAILBOX_CAMPAIGN_VERSION_READ_TIMEOUT_MS } = {}) {
  return async function readMailboxCampaignContentVersion() {
    const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!client) return null;
    let timer;
    try {
      const result = await Promise.race([
        client.from(MAILBOX_CAMPAIGN_CONSISTENCY_TABLE).select('content_version').eq('scope', 'campaign').maybeSingle(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Campagneversie lezen duurde te lang.')), timeoutMs);
        }),
      ]);
      if (result?.error) throw result.error;
      return Number(result?.data?.content_version);
    } finally {
      clearTimeout(timer);
    }
  };
}

function createMailboxCampaignVersionCache({
  readContentVersion,
  now = Date.now,
  maxAgeMs = MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_AGE_MS,
  maxEntries = MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_ENTRIES,
  clone = (value) => structuredClone(value),
  sharedStore = null,
  logger = console,
} = {}) {
  const entries = new Map();
  const inFlight = new Map();

  async function readVersion() {
    if (typeof readContentVersion !== 'function') return null;
    try {
      const version = await readContentVersion();
      return Number.isSafeInteger(version) && version > 0 ? version : null;
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignVersionCache]', error?.message || error);
      return null;
    }
  }

  function isFresh(entry, version) {
    const ageMs = now() - (entry ? Number(entry.builtAt) : 0);
    return Boolean(entry) && entry.version === version && ageMs >= 0 && ageMs < maxAgeMs;
  }

  function remember(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  async function readShared(key) {
    if (!sharedStore || typeof sharedStore.read !== 'function') return null;
    try {
      return await sharedStore.read(key);
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSharedCache]', error?.message || error);
      return null;
    }
  }

  async function writeShared(key, entry) {
    if (!sharedStore || typeof sharedStore.write !== 'function') return;
    try {
      await sharedStore.write(key, entry);
    } catch (error) {
      logger.warn?.('[Mailbox][CampaignSharedCache]', error?.message || error);
    }
  }

  // Returns { value, cache } where cache is 'hit', 'shared-hit', 'miss' or
  // 'bypass'. The version is read before building, so a change during the
  // build leaves an entry with the older version that the next read rebuilds.
  return async function readThrough(key, build) {
    const cached = entries.get(key);
    const [version, shared] = await Promise.all([
      readVersion(),
      cached ? Promise.resolve(null) : readShared(key),
    ]);
    if (version === null) return { value: await build(), cache: 'bypass' };
    if (isFresh(cached, version)) return { value: clone(cached.value), cache: 'hit' };
    const sharedEntry = shared || (cached ? await readShared(key) : null);
    if (isFresh(sharedEntry, version)) {
      remember(key, { version, builtAt: Number(sharedEntry.builtAt), value: clone(sharedEntry.value) });
      return { value: clone(sharedEntry.value), cache: 'shared-hit' };
    }
    const flightKey = `${key}|${version}`;
    if (!inFlight.has(flightKey)) {
      const builtAt = now();
      inFlight.set(flightKey, (async () => {
        try {
          const value = await build();
          const entry = { version, builtAt, value: clone(value) };
          remember(key, entry);
          await writeShared(key, entry);
          return value;
        } finally {
          inFlight.delete(flightKey);
        }
      })());
    }
    return { value: clone(await inFlight.get(flightKey)), cache: 'miss' };
  };
}

module.exports = {
  MAILBOX_CAMPAIGN_VERSION_CACHE_MAX_AGE_MS,
  createMailboxCampaignContentVersionReader,
  createMailboxCampaignVersionCache,
};
