const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TABLE_NAME = 'softora_company_website_videos';
const STORAGE_BUCKET = 'softora-company-website-videos';
const VIDEO_STORAGE_VERSION = '63s-v1';
const ACTIVE_STATUSES = new Set(['pending', 'processing']);
const VALID_STATUSES = new Set(['pending', 'processing', 'ready', 'failed']);

function normalizeString(value) {
  return String(value || '').trim();
}

function buildVideoStoragePath(companyId) {
  const safeId = normalizeString(companyId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  if (!safeId) throw new Error('Ongeldig bedrijfs-ID voor videopad.');
  return `companies/${safeId}/homepage-${VIDEO_STORAGE_VERSION}.mp4`;
}

function normalizeRecord(row) {
  if (!row) return null;
  return {
    companyId: normalizeString(row.company_id),
    originalWebsiteUrl: normalizeString(row.original_website_url),
    normalizedWebsiteUrl: normalizeString(row.normalized_website_url),
    videoPath: normalizeString(row.video_path),
    storageBucket: normalizeString(row.storage_bucket || STORAGE_BUCKET),
    status: VALID_STATUSES.has(row.status) ? row.status : 'failed',
    error: normalizeString(row.error_text),
    lockToken: normalizeString(row.lock_token),
    lockExpiresAt: normalizeString(row.lock_expires_at),
    startedAt: normalizeString(row.started_at),
    completedAt: normalizeString(row.completed_at),
    createdAt: normalizeString(row.created_at),
    updatedAt: normalizeString(row.updated_at),
  };
}

function canReuseVideo(record, normalizedWebsiteUrl, fileExists) {
  return Boolean(
    record &&
    record.status === 'ready' &&
    record.companyId &&
    record.videoPath &&
    record.videoPath === buildVideoStoragePath(record.companyId) &&
    record.normalizedWebsiteUrl === normalizeString(normalizedWebsiteUrl) &&
    fileExists
  );
}

function canTransitionStatus(fromStatus, toStatus) {
  const transitions = {
    pending: new Set(['processing']),
    processing: new Set(['ready', 'failed', 'processing']),
    ready: new Set(['pending']),
    failed: new Set(['pending']),
  };
  return Boolean(transitions[fromStatus] && transitions[fromStatus].has(toStatus));
}

function assertSupabaseResult(result, operation) {
  if (result && !result.error) return result;
  const source = result && result.error;
  const error = new Error(`${operation} mislukt: ${normalizeString(source && source.message) || 'onbekende databasefout'}`);
  error.cause = source;
  throw error;
}

function isRetryableStorageError(error) {
  const cause = error && error.cause;
  const status = Number(cause && (cause.statusCode || cause.status));
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  const message = `${normalizeString(error && error.message)} ${normalizeString(cause && cause.message)}`.toLowerCase();
  return /fetch failed|failed to fetch|network|econnreset|etimedout|timeout|socket|load failed/.test(message);
}

function createCompanyWebsiteVideoRepository(options = {}) {
  const client = options.client || (
    options.supabaseUrl && options.supabaseServiceRoleKey
      ? createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null
  );
  const bucket = normalizeString(options.storageBucket) || STORAGE_BUCKET;
  const uploadMaxAttempts = Math.max(1, Math.min(5, Number(options.uploadMaxAttempts) || 3));
  const configuredRetryDelay = Number(options.uploadRetryDelayMs);
  const uploadRetryDelayMs = Number.isFinite(configuredRetryDelay)
    ? Math.max(0, configuredRetryDelay)
    : 600;
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!client) {
    return {
      configured: false,
      async get() { throw new Error('Websitevideo-opslag is niet geconfigureerd.'); },
      async queue() { throw new Error('Websitevideo-opslag is niet geconfigureerd.'); },
      async claimNext() { return null; },
    };
  }

  async function get(companyId) {
    const result = assertSupabaseResult(await client
      .from(TABLE_NAME)
      .select('*')
      .eq('company_id', normalizeString(companyId))
      .maybeSingle(), 'Websitevideorecord ophalen');
    return normalizeRecord(result.data);
  }

  async function queue(input, options = {}) {
    const result = assertSupabaseResult(await client.rpc('softora_queue_company_website_video', {
      p_company_id: normalizeString(input.companyId),
      p_original_website_url: normalizeString(input.originalWebsiteUrl),
      p_normalized_website_url: normalizeString(input.normalizedWebsiteUrl),
      p_force_retry: Boolean(options.forceRetry),
    }), 'Websitevideo inplannen');
    return normalizeRecord(Array.isArray(result.data) ? result.data[0] : result.data);
  }

  async function claimNext(lockToken, lockTimeoutSeconds = 300) {
    const result = assertSupabaseResult(await client.rpc('softora_claim_company_website_video', {
      p_lock_token: normalizeString(lockToken),
      p_lock_timeout_seconds: Math.max(60, Math.min(1800, Number(lockTimeoutSeconds) || 300)),
    }), 'Websitevideo claimen');
    return normalizeRecord(Array.isArray(result.data) ? result.data[0] : result.data);
  }

  async function markReady(companyId, lockToken, videoPath) {
    const result = assertSupabaseResult(await client
      .from(TABLE_NAME)
      .update({
        status: 'ready',
        video_path: normalizeString(videoPath),
        storage_bucket: bucket,
        error_text: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        lock_token: null,
        lock_expires_at: null,
      })
      .eq('company_id', normalizeString(companyId))
      .eq('status', 'processing')
      .eq('lock_token', normalizeString(lockToken))
      .select('*')
      .maybeSingle(), 'Websitevideo gereedmelden');
    if (!result.data) throw new Error('Websitevideolock is verlopen voordat de render gereed was.');
    return normalizeRecord(result.data);
  }

  async function markFailed(companyId, lockToken, errorMessage) {
    const result = assertSupabaseResult(await client
      .from(TABLE_NAME)
      .update({
        status: 'failed',
        error_text: normalizeString(errorMessage).slice(0, 4000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        lock_token: null,
        lock_expires_at: null,
      })
      .eq('company_id', normalizeString(companyId))
      .eq('lock_token', normalizeString(lockToken))
      .select('*')
      .maybeSingle(), 'Websitevideo foutstatus opslaan');
    return normalizeRecord(result.data);
  }

  async function upload(companyId, filePath) {
    const storagePath = buildVideoStoragePath(companyId);
    const body = await fs.promises.readFile(filePath);
    for (let attempt = 1; attempt <= uploadMaxAttempts; attempt += 1) {
      try {
        assertSupabaseResult(await client.storage.from(bucket).upload(storagePath, body, {
          contentType: 'video/mp4',
          upsert: true,
          cacheControl: '3600',
        }), 'Websitevideo opslaan');
        return storagePath;
      } catch (error) {
        if (attempt >= uploadMaxAttempts || !isRetryableStorageError(error)) throw error;
        await wait(uploadRetryDelayMs * attempt);
      }
    }
    throw new Error('Websitevideo opslaan is onverwacht afgebroken.');
  }

  async function exists(record) {
    if (!record || !record.videoPath) return false;
    const directory = path.posix.dirname(record.videoPath);
    const fileName = path.posix.basename(record.videoPath);
    const result = await client.storage.from(record.storageBucket || bucket).list(directory, {
      limit: 10,
      search: fileName,
    });
    if (result.error) return false;
    return (result.data || []).some((entry) => entry.name === fileName && Number(entry.metadata && entry.metadata.size) > 0);
  }

  async function download(record) {
    const result = assertSupabaseResult(
      await client.storage.from(record.storageBucket || bucket).download(record.videoPath),
      'Websitevideo downloaden'
    );
    return Buffer.from(await result.data.arrayBuffer());
  }

  return {
    configured: true,
    claimNext,
    download,
    exists,
    get,
    markFailed,
    markReady,
    queue,
    upload,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  STORAGE_BUCKET,
  TABLE_NAME,
  VIDEO_STORAGE_VERSION,
  buildVideoStoragePath,
  canReuseVideo,
  canTransitionStatus,
  createCompanyWebsiteVideoRepository,
  normalizeRecord,
};
