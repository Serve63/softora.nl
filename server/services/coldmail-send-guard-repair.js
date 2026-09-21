const crypto = require('node:crypto');

const {
  CHUNK_KEY_PREFIX,
  STORAGE_FORMAT,
} = require('./coldmail-send-guard-chunks');

const COLDMAIL_SEND_GUARD_SCOPE = 'premium_coldmail_send_guard';
const COLDMAIL_SEND_GUARD_KEY = 'softora_coldmail_send_guard_v1';
const MAX_CHUNKS = 100;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function createRepairError(code, message, status = 500, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function analyzeColdmailSendGuardRow(row) {
  const revision = normalizeRevision(row?.revision);
  const updatedAt = String(row?.updated_at || '').trim() || null;
  const values = row?.payload?.values;
  if (!row) {
    return {
      status: 'missing',
      repairable: false,
      chunked: false,
      revision,
      updatedAt,
      chunkCount: 0,
      missingChunkCount: 0,
      declaredLength: null,
      actualLength: null,
      declaredSha256: null,
      actualSha256: null,
      lengthMatches: false,
      shaMatches: false,
      jsonValid: false,
      entryCount: 0,
      recipientEntryCount: 0,
    };
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return {
      status: 'invalid_values',
      repairable: false,
      chunked: false,
      revision,
      updatedAt,
      chunkCount: 0,
      missingChunkCount: 0,
      declaredLength: null,
      actualLength: null,
      declaredSha256: null,
      actualSha256: null,
      lengthMatches: false,
      shaMatches: false,
      jsonValid: false,
      entryCount: 0,
      recipientEntryCount: 0,
    };
  }

  const manifestRaw = String(values[COLDMAIL_SEND_GUARD_KEY] || '');
  const manifest = parseObject(manifestRaw);
  if (!manifest || manifest.storageFormat !== STORAGE_FORMAT) {
    const guard = parseObject(manifestRaw);
    return {
      status: guard ? 'healthy_unchunked' : 'invalid_manifest',
      repairable: false,
      chunked: false,
      revision,
      updatedAt,
      chunkCount: 0,
      missingChunkCount: 0,
      declaredLength: manifestRaw.length,
      actualLength: manifestRaw.length,
      declaredSha256: manifestRaw ? sha256(manifestRaw) : null,
      actualSha256: manifestRaw ? sha256(manifestRaw) : null,
      lengthMatches: Boolean(guard),
      shaMatches: Boolean(guard),
      jsonValid: Boolean(guard),
      entryCount: Array.isArray(guard?.entries) ? guard.entries.length : 0,
      recipientEntryCount: Array.isArray(guard?.recipientEntries) ? guard.recipientEntries.length : 0,
    };
  }

  const chunkKeys = Array.isArray(manifest.chunkKeys) ? manifest.chunkKeys.map(String) : [];
  const uniqueChunkKeys = new Set(chunkKeys);
  const validChunkKeys =
    chunkKeys.length > 0 &&
    chunkKeys.length <= MAX_CHUNKS &&
    uniqueChunkKeys.size === chunkKeys.length &&
    chunkKeys.every((key) => key.startsWith(CHUNK_KEY_PREFIX));
  const missingChunkCount = validChunkKeys
    ? chunkKeys.filter((key) => !Object.prototype.hasOwnProperty.call(values, key)).length
    : 0;
  const restoredRaw = validChunkKeys && missingChunkCount === 0
    ? chunkKeys.map((key) => String(values[key] || '')).join('')
    : '';
  const guard = restoredRaw ? parseObject(restoredRaw) : null;
  const actualLength = restoredRaw.length;
  const actualSha256 = restoredRaw ? sha256(restoredRaw) : null;
  const declaredLength = Number.isSafeInteger(Number(manifest.serializedLength))
    ? Number(manifest.serializedLength)
    : null;
  const declaredSha256 = /^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))
    ? String(manifest.sha256).toLowerCase()
    : null;
  const lengthMatches = declaredLength !== null && declaredLength === actualLength;
  const shaMatches = Boolean(declaredSha256 && actualSha256 && declaredSha256 === actualSha256);
  const jsonValid = Boolean(guard);
  const healthy = validChunkKeys && missingChunkCount === 0 && jsonValid && lengthMatches && shaMatches;
  const repairable = validChunkKeys && missingChunkCount === 0 && jsonValid && !healthy;

  return {
    status: healthy
      ? 'healthy_chunked'
      : repairable
        ? 'manifest_integrity_mismatch'
        : !validChunkKeys
          ? 'invalid_chunk_list'
          : missingChunkCount
            ? 'missing_chunks'
            : 'invalid_chunk_json',
    repairable,
    chunked: true,
    revision,
    updatedAt,
    chunkCount: chunkKeys.length,
    missingChunkCount,
    declaredLength,
    actualLength,
    declaredSha256,
    actualSha256,
    lengthMatches,
    shaMatches,
    jsonValid,
    entryCount: Array.isArray(guard?.entries) ? guard.entries.length : 0,
    recipientEntryCount: Array.isArray(guard?.recipientEntries) ? guard.recipientEntries.length : 0,
  };
}

function buildCorrectedValues(row, analysis) {
  const values = row?.payload?.values;
  const manifest = parseObject(values?.[COLDMAIL_SEND_GUARD_KEY]);
  if (!manifest || !analysis.repairable || !analysis.actualSha256) return null;
  return {
    ...values,
    [COLDMAIL_SEND_GUARD_KEY]: JSON.stringify({
      ...manifest,
      serializedLength: analysis.actualLength,
      sha256: analysis.actualSha256,
    }),
  };
}

function createColdmailSendGuardRepairService(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseClient = () => null,
    supabaseStateTable = '',
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false }),
    getUiStateValues = async () => null,
    logger = console,
  } = deps;
  const rowKey = `ui_state:${COLDMAIL_SEND_GUARD_SCOPE}`;

  function getClient() {
    if (!isSupabaseConfigured()) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_STORAGE_UNAVAILABLE',
        'Supabase-opslag is niet beschikbaar.',
        503
      );
    }
    const client = getSupabaseClient({
      timeoutMs: 25000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!client || !supabaseStateTable) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_STORAGE_UNAVAILABLE',
        'Supabase-opslagclient is niet beschikbaar.',
        503
      );
    }
    return client;
  }

  async function readRawRow() {
    const client = getClient();
    let clientError = null;
    try {
      const result = await client
        .from(supabaseStateTable)
        .select('state_key,payload,meta,updated_at,revision')
        .eq('state_key', rowKey)
        .maybeSingle();
      if (!result?.error) return result?.data || null;
      clientError = result.error;
    } catch (error) {
      clientError = error;
    }

    const fallback = await fetchSupabaseRowByKeyViaRest(
      rowKey,
      'state_key,payload,meta,updated_at,revision',
      { timeoutMs: 25000, ignoreFailureCooldown: true, suppressFailureCooldown: true }
    );
    if (fallback?.ok) {
      return Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
    }
    throw createRepairError(
      'COLDMAIL_SEND_GUARD_READ_FAILED',
      'Coldmail send-guard-opslag kon niet worden gelezen.',
      503,
      { cause: String(clientError?.code || fallback?.status || 'read_failed') }
    );
  }

  async function inspect() {
    const row = await readRawRow();
    return {
      ok: true,
      source: 'coldmail-send-guard-storage',
      diagnostic: analyzeColdmailSendGuardRow(row),
    };
  }

  async function writeBackup(client, row, analysis) {
    const backupKey = [
      'backup:coldmail_send_guard',
      String(analysis.revision),
      String(analysis.actualSha256 || '').slice(0, 16),
    ].join(':');
    const backupRow = {
      state_key: backupKey,
      payload: {
        type: 'coldmail_send_guard_repair_backup_v1',
        sourceStateKey: rowKey,
        sourceRow: {
          state_key: row.state_key,
          payload: row.payload,
          meta: row.meta,
          updated_at: row.updated_at,
          revision: row.revision,
        },
      },
      meta: {
        type: 'coldmail_send_guard_repair_backup',
        source: 'admin-coldmail-send-guard-repair',
      },
      revision: 0,
      updated_at: new Date().toISOString(),
    };
    const result = await client
      .from(supabaseStateTable)
      .upsert(backupRow, { onConflict: 'state_key' })
      .select('state_key')
      .maybeSingle();
    if (result?.error || !result?.data) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_BACKUP_FAILED',
        'Coldmail send-guard-back-up kon niet veilig worden opgeslagen.',
        503
      );
    }
    return true;
  }

  async function applyCasRepair(client, row, analysis, correctedValues) {
    if (analysis.revision === null || !analysis.updatedAt) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_CAS_UNAVAILABLE',
        'Coldmail send-guard mist revision- of updated_at-bewijs.',
        409
      );
    }
    const nextUpdatedAt = new Date().toISOString();
    const update = {
      payload: { ...row.payload, values: correctedValues },
      meta: row.meta,
      revision: analysis.revision + 1,
      updated_at: nextUpdatedAt,
    };
    const result = await client
      .from(supabaseStateTable)
      .update(update)
      .eq('state_key', rowKey)
      .eq('revision', analysis.revision)
      .eq('updated_at', analysis.updatedAt)
      .select('state_key,payload,meta,updated_at,revision')
      .maybeSingle();
    if (result?.error) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_REPAIR_FAILED',
        'Coldmail send-guard kon niet worden hersteld.',
        503
      );
    }
    if (!result?.data) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_REPAIR_CONFLICT',
        'Coldmail send-guard veranderde tijdens het herstel; er is niets overschreven.',
        409
      );
    }
    return result.data;
  }

  async function verifyNormalRead(analysis) {
    const restored = await getUiStateValues(COLDMAIL_SEND_GUARD_SCOPE, {
      includeRevision: true,
      preferSupabaseRestRead: true,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressReadFailureLog: true,
      ignoreSupabaseRestFailureCooldown: true,
      suppressSupabaseRestFailureCooldown: true,
    });
    const raw = String(restored?.values?.[COLDMAIL_SEND_GUARD_KEY] || '');
    const guard = parseObject(raw);
    return Boolean(
      restored?.source === 'supabase' &&
      guard &&
      raw.length === analysis.actualLength &&
      sha256(raw) === analysis.actualSha256 &&
      (Array.isArray(guard.entries) ? guard.entries.length : 0) === analysis.entryCount &&
      (Array.isArray(guard.recipientEntries) ? guard.recipientEntries.length : 0) ===
        analysis.recipientEntryCount
    );
  }

  async function repair() {
    const client = getClient();
    const row = await readRawRow();
    const before = analyzeColdmailSendGuardRow(row);
    if (before.status === 'healthy_chunked' || before.status === 'healthy_unchunked') {
      return {
        ok: true,
        source: 'coldmail-send-guard-storage',
        changed: false,
        backupCreated: false,
        verified: true,
        before,
        after: before,
      };
    }
    if (!before.repairable) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_NOT_REPAIRABLE',
        'Coldmail send-guard is niet veilig automatisch herstelbaar.',
        409,
        { diagnostic: before }
      );
    }
    const correctedValues = buildCorrectedValues(row, before);
    if (!correctedValues) {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_NOT_REPAIRABLE',
        'Coldmail send-guard is niet veilig automatisch herstelbaar.',
        409,
        { diagnostic: before }
      );
    }

    await writeBackup(client, row, before);
    const repairedRow = await applyCasRepair(client, row, before, correctedValues);
    const after = analyzeColdmailSendGuardRow(repairedRow);
    const verified = await verifyNormalRead(before);
    if (!verified || after.status !== 'healthy_chunked') {
      throw createRepairError(
        'COLDMAIL_SEND_GUARD_POST_REPAIR_VERIFY_FAILED',
        'Coldmail send-guard is aangepast maar de normale read kon niet worden bevestigd.',
        502,
        { applied: true, backupCreated: true, diagnostic: after }
      );
    }

    if (typeof logger.info === 'function') {
      logger.info('[ColdmailSendGuardRepair][Verified]', {
        chunkCount: after.chunkCount,
        serializedLength: after.actualLength,
        sha256: after.actualSha256,
        entryCount: after.entryCount,
        recipientEntryCount: after.recipientEntryCount,
      });
    }
    return {
      ok: true,
      source: 'coldmail-send-guard-storage',
      changed: true,
      backupCreated: true,
      verified: true,
      before,
      after,
    };
  }

  return { inspect, repair };
}

module.exports = {
  COLDMAIL_SEND_GUARD_KEY,
  COLDMAIL_SEND_GUARD_SCOPE,
  analyzeColdmailSendGuardRow,
  createColdmailSendGuardRepairService,
};
