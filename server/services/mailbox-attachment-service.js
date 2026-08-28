const crypto = require('crypto');
const {
  MAILBOX_ATTACHMENT_EXTENSIONS,
  MAILBOX_ATTACHMENT_SHA256_PATTERN,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS,
  MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES,
  normalizeContentType,
  safeFilename,
} = require('./mailbox-attachment-policy');

const MAILBOX_ATTACHMENT_BUCKET = 'softora-mailbox-attachments';
const MAILBOX_ATTACHMENT_LEGACY_REFERENCE_VERSION = 1;
const MAILBOX_ATTACHMENT_REFERENCE_VERSION = 2;
const MAILBOX_ATTACHMENT_REFERENCE_TTL_MS = 30 * 60 * 1000;
const MAILBOX_ATTACHMENT_STORAGE_TIMEOUT_MS = 8_000;
const MAILBOX_ATTACHMENT_STORAGE_MAX_ATTEMPTS = 2;
const MAILBOX_ATTACHMENT_STORAGE_PREFIX = 'mailbox/v2';
// Signed upload URLs remain valid for two hours. Start the grace period only
// after the shorter mailbox reference has expired, so an old upload URL can
// never recreate an object after the sweeper removed it.
const MAILBOX_ATTACHMENT_SWEEP_GRACE_MS = 2 * 60 * 60 * 1000;
const MAILBOX_ATTACHMENT_SWEEP_MAX_BATCHES = 20;
const MAILBOX_ATTACHMENT_SWEEP_OPERATION_TIMEOUT_MS = 2_500;
const MAILBOX_ATTACHMENT_SWEEP_TOTAL_TIMEOUT_MS = 5_000;
const MAILBOX_ATTACHMENT_SWEEP_ROOT_PAGE_SIZE = 100;
const MAILBOX_ATTACHMENT_SWEEP_MAX_ROOT_PAGES = 5;
const MAILBOX_ATTACHMENT_SWEEP_MAX_PATHS =
  MAILBOX_ATTACHMENT_SWEEP_MAX_BATCHES * MAX_MAILBOX_ATTACHMENTS;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function createAttachmentError(message, code = 'MAILBOX_ATTACHMENT_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function canonicalBinding(binding = {}) {
  return [
    normalizeText(binding.owner).toLowerCase(),
    normalizeEmail(binding.accountEmail),
    normalizeEmail(binding.providerAccountEmail),
    normalizeEmail(binding.recipientEmail),
    normalizeText(binding.provider || 'smtp').toLowerCase(),
    normalizeText(binding.mode).toLowerCase(),
    normalizeText(binding.conversationId),
    normalizeText(binding.replyTargetMessageId),
    normalizeText(binding.providerThreadId),
    normalizeText(binding.idempotencyKey),
  ];
}

function createBindingHash(binding = {}) {
  return crypto.createHash('sha256').update(canonicalBinding(binding).map((part) => `${Buffer.byteLength(part)}:${part}`).join('|')).digest('hex');
}

function createStorageObjectFilename(filename) {
  const normalized = safeFilename(filename);
  const extension = normalized.includes('.') ? normalized.split('.').pop().toLowerCase() : '';
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `${digest}${extension ? `.${extension}` : ''}`;
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signReference(payload, secret) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyReference(reference, secret) {
  const parts = String(reference || '').split('.');
  const [encoded, signature] = parts;
  if (parts.length !== 2 || !encoded || !signature || !secret
    || !/^[a-z0-9_-]+$/i.test(encoded) || !/^[a-z0-9_-]+$/i.test(signature)) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(encoded));
  } catch (_) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  return payload;
}

function unwrapSupabaseResult(result) {
  if (result?.error) throw result.error;
  return result?.data ?? result;
}

function toSafeStorageError(error, fallback = 'Bijlage-opslag is tijdelijk niet beschikbaar; probeer opnieuw.') {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const safe = createAttachmentError(fallback, 'MAILBOX_ATTACHMENT_STORAGE_FAILED', status || 503);
  safe.retryable = isTransientStorageError(error);
  safe.cause = error;
  return safe;
}

function isTransientStorageError(error) {
  const code = normalizeText(error?.code).toUpperCase();
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const text = normalizeText(error?.message || error?.details || error?.hint || error?.name || error);
  return [408, 425, 429].includes(status) || status >= 500
    || ['57014', 'SUPABASE_REST_COOLDOWN'].includes(code)
    || /abort|timeout|timed out|cooldown|fetch failed|network|econnreset|etimedout|connection terminated|temporar/i.test(text);
}

function createMailboxAttachmentService(deps = {}) {
  const {
    getSupabaseClient = () => null,
    secret = '',
    bucket = MAILBOX_ATTACHMENT_BUCKET,
    now = () => new Date(),
    randomUUID = crypto.randomUUID,
    logger = console,
    storageTimeoutMs = MAILBOX_ATTACHMENT_STORAGE_TIMEOUT_MS,
    storageMaxAttempts = MAILBOX_ATTACHMENT_STORAGE_MAX_ATTEMPTS,
    retryDelayMs = 75,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = deps;
  const signingSecret = normalizeText(secret);

  function getStorageTimeoutMs(timeoutOverride) {
    return Math.max(1_000, Math.min(
      60_000,
      Number(timeoutOverride) || Number(storageTimeoutMs) || MAILBOX_ATTACHMENT_STORAGE_TIMEOUT_MS
    ));
  }

  async function runWithStorageDeadline(operation, timeoutOverride) {
    const timeoutMs = getStorageTimeoutMs(timeoutOverride);
    let timeout = null;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeoutFn(() => {
        const error = new Error(`Mailbox attachment storage timeout na ${timeoutMs}ms`);
        error.name = 'AbortError';
        error.code = 'MAILBOX_ATTACHMENT_STORAGE_TIMEOUT';
        error.status = 504;
        error.retryable = true;
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), deadline]);
    } finally {
      if (timeout !== null && timeout !== undefined) clearTimeoutFn(timeout);
    }
  }

  function getStorageClient(timeoutOverride) {
    return getSupabaseClient({
      timeoutMs: getStorageTimeoutMs(timeoutOverride),
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
  }

  function storage(timeoutOverride) {
    if (!signingSecret) {
      throw createAttachmentError('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.', 'MAILBOX_ATTACHMENT_SIGNING_UNAVAILABLE', 503);
    }
    const client = getStorageClient(timeoutOverride);
    if (!client?.storage?.from) {
      throw createAttachmentError('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.', 'MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE', 503);
    }
    return client.storage.from(bucket);
  }

  async function runStorageOperation(operation, options = {}) {
    const configuredAttempts = Math.max(1, Math.min(2, Number(storageMaxAttempts) || 1));
    const maxAttempts = options.maxAttempts === undefined
      ? configuredAttempts
      : Math.max(1, Math.min(configuredAttempts, Number(options.maxAttempts) || 1));
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return unwrapSupabaseResult(await runWithStorageDeadline(
          () => operation(storage(options.timeoutMs)),
          options.timeoutMs
        ));
      } catch (error) {
        lastError = error;
        if (!isTransientStorageError(error) || attempt >= maxAttempts - 1) throw error;
        const delayMs = Math.max(0, Math.min(250, Number(retryDelayMs) || 0));
        if (delayMs) await sleep(delayMs);
      }
    }
    throw lastError;
  }

  function validateMetadata(attachment = {}, options = {}) {
    const filename = safeFilename(attachment?.filename || attachment?.name);
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (!filename || !MAILBOX_ATTACHMENT_EXTENSIONS.has(extension)) {
      throw createAttachmentError(`Bestand "${filename || 'zonder naam'}" wordt niet ondersteund.`);
    }
    const size = Number(attachment?.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MAILBOX_ATTACHMENT_BYTES) {
      throw createAttachmentError(`Bijlage "${filename}" mag maximaal 4 MB zijn.`);
    }
    const metadata = {
      filename,
      contentType: normalizeContentType(attachment?.contentType, filename),
      size,
    };
    if (Object.prototype.hasOwnProperty.call(attachment || {}, 'sha256')) {
      const sha256 = typeof attachment.sha256 === 'string' ? attachment.sha256 : '';
      if (!MAILBOX_ATTACHMENT_SHA256_PATTERN.test(sha256)) {
        throw createAttachmentError(
          `De inhoudsvingerafdruk van bijlage "${filename}" is ongeldig.`,
          'MAILBOX_ATTACHMENT_SHA256_INVALID'
        );
      }
      metadata.sha256 = sha256;
    } else if (options.requireSha256 === true) {
      throw createAttachmentError(
        `De inhoudsvingerafdruk van bijlage "${filename}" ontbreekt; kies de bijlage opnieuw.`,
        'MAILBOX_ATTACHMENT_SHA256_REQUIRED',
        409
      );
    }
    return metadata;
  }

  function assertUniformHashMode(metadata = []) {
    const hashModes = metadata.map((item) => Boolean(item?.sha256));
    if (hashModes.some(Boolean) && !hashModes.every(Boolean)) {
      throw createAttachmentError(
        'Alle bijlagen moeten dezelfde veilige inhoudscontrole gebruiken; kies de bijlagen opnieuw.',
        'MAILBOX_ATTACHMENT_HASH_MODE_MISMATCH',
        409
      );
    }
  }

  function assertUniqueReferencePayloads(payloads = []) {
    const paths = new Set();
    for (const payload of payloads) {
      const path = normalizeText(payload?.path);
      if (paths.has(path)) {
        throw createAttachmentError(
          'Dezelfde bijlageverwijzing staat meer dan één keer in deze verzending; kies de bijlagen opnieuw.',
          'MAILBOX_ATTACHMENT_REFERENCE_DUPLICATE',
          409
        );
      }
      paths.add(path);
    }
  }

  function validateReferencePayload(payload, binding, {
    allowExpired = false,
    allowLegacy = false,
  } = {}) {
    const referenceVersion = payload?.v;
    if (!payload || ![
      MAILBOX_ATTACHMENT_LEGACY_REFERENCE_VERSION,
      MAILBOX_ATTACHMENT_REFERENCE_VERSION,
    ].includes(referenceVersion) || payload.bucket !== bucket) {
      throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
    }
    if (referenceVersion === MAILBOX_ATTACHMENT_LEGACY_REFERENCE_VERSION && !allowLegacy) {
      throw createAttachmentError(
        'Deze oude bijlageverwijzing kan niet meer worden verzonden; kies de bijlage opnieuw.',
        'MAILBOX_ATTACHMENT_REFERENCE_INVALID',
        409
      );
    }
    if (!allowExpired && Number(payload.expiresAt) < now().getTime()) {
      throw createAttachmentError('De bijlage-upload is verlopen; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_EXPIRED', 409);
    }
    if (payload.bindingHash !== createBindingHash(binding)) {
      throw createAttachmentError('De bijlage hoort niet bij deze veilige verzendcontext.', 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH', 409);
    }
    const storagePath = String(payload.path || '');
    const unsafePathSegment = storagePath.split('/').some((segment) => segment === '.' || segment === '..');
    const isLegacyPath = /^mailbox\/[a-z0-9-]+\/\d+-[^/]+$/i.test(storagePath);
    const isExpiringPath = /^mailbox\/v2\/\d{13}-[a-z0-9-]+\/\d+-[^/]+$/i.test(storagePath);
    if ((!isLegacyPath && !isExpiringPath) || unsafePathSegment
      || (referenceVersion === MAILBOX_ATTACHMENT_REFERENCE_VERSION && !isExpiringPath)) {
      throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
    }
    const metadata = validateMetadata(payload);
    if ((referenceVersion === MAILBOX_ATTACHMENT_REFERENCE_VERSION && !metadata.sha256)
      || (referenceVersion === MAILBOX_ATTACHMENT_LEGACY_REFERENCE_VERSION && metadata.sha256)) {
      throw createAttachmentError(
        'De bijlageverwijzing mist een eenduidige inhoudscontrole; kies de bijlage opnieuw.',
        'MAILBOX_ATTACHMENT_REFERENCE_HASH_INVALID',
        409
      );
    }
    return { ...payload, ...metadata, v: referenceVersion };
  }

  async function removePaths(paths, options = {}) {
    const uniquePaths = Array.from(new Set(paths.map((path) => normalizeText(path)).filter(Boolean)));
    if (!uniquePaths.length) return;
    await runStorageOperation((store) => store.remove(uniquePaths), options);
  }

  async function createUploadPlan({ attachments = [], binding = {} } = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_MAILBOX_ATTACHMENTS) {
      throw createAttachmentError(`Je kunt maximaal ${MAX_MAILBOX_ATTACHMENTS} bijlagen toevoegen.`);
    }
    const metadata = list.map((attachment) => validateMetadata(attachment, { requireSha256: true }));
    assertUniformHashMode(metadata);
    const totalBytes = metadata.reduce((total, item) => total + item.size, 0);
    if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) {
      throw createAttachmentError('De bijlagen mogen samen maximaal 5 MB zijn.');
    }
    const bindingHash = createBindingHash(binding);
    const expiresAt = now().getTime() + MAILBOX_ATTACHMENT_REFERENCE_TTL_MS;
    const batchId = String(randomUUID()).replace(/[^a-z0-9-]/gi, '');
    const createdPaths = [];
    try {
      const uploads = [];
      for (const [index, item] of metadata.entries()) {
        const storageFilename = createStorageObjectFilename(item.filename);
        const path = `${MAILBOX_ATTACHMENT_STORAGE_PREFIX}/${expiresAt}-${batchId}/${index}-${storageFilename}`;
        const result = await runStorageOperation(async (store) => {
          const signedUpload = unwrapSupabaseResult(
            await store.createSignedUploadUrl(path, { upsert: true })
          );
          if (!signedUpload?.signedUrl) {
            const error = new Error('signed upload URL ontbreekt');
            error.status = 503;
            error.code = 'MAILBOX_ATTACHMENT_STORAGE_INCOMPLETE';
            error.retryable = true;
            throw error;
          }
          return signedUpload;
        });
        createdPaths.push(path);
        const reference = signReference({
          v: MAILBOX_ATTACHMENT_REFERENCE_VERSION,
          bucket,
          path,
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          sha256: item.sha256,
          bindingHash,
          expiresAt,
        }, signingSecret);
        uploads.push({
          reference,
          signedUrl: result.signedUrl,
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          sha256: item.sha256,
          referenceVersion: MAILBOX_ATTACHMENT_REFERENCE_VERSION,
          expiresAt,
        });
      }
      return uploads;
    } catch (error) {
      await removePaths(createdPaths).catch((cleanupError) => {
        logger.warn('[MailboxAttachment][CleanupAfterPlanFailure]', cleanupError?.message || cleanupError);
      });
      if (error?.code?.startsWith?.('MAILBOX_ATTACHMENT_')) throw error;
      throw toSafeStorageError(error);
    }
  }

  function inspectAttachments(attachments = [], binding = {}, options = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_MAILBOX_ATTACHMENTS) {
      throw createAttachmentError(`Je kunt maximaal ${MAX_MAILBOX_ATTACHMENTS} bijlagen toevoegen.`);
    }
    const payloads = list.map((attachment) => validateReferencePayload(
      verifyReference(attachment?.reference, signingSecret),
      binding,
      { allowExpired: options.allowExpired === true }
    ));
    assertUniqueReferencePayloads(payloads);
    assertUniformHashMode(payloads);
    const totalBytes = payloads.reduce((total, item) => total + Number(item.size || 0), 0);
    if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) {
      throw createAttachmentError('De bijlagen mogen samen maximaal 5 MB zijn.');
    }
    return payloads.map((payload) => ({
      filename: payload.filename,
      contentType: payload.contentType,
      size: Number(payload.size),
      ...(payload.sha256 ? { sha256: payload.sha256 } : {}),
    }));
  }

  async function downloadAttachments(attachments = [], binding = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_MAILBOX_ATTACHMENTS) {
      throw createAttachmentError(`Je kunt maximaal ${MAX_MAILBOX_ATTACHMENTS} bijlagen toevoegen.`);
    }
    const payloads = list.map((attachment) => validateReferencePayload(
      verifyReference(attachment?.reference, signingSecret),
      binding
    ));
    assertUniqueReferencePayloads(payloads);
    assertUniformHashMode(payloads);
    const totalBytes = payloads.reduce((total, item) => total + Number(item.size || 0), 0);
    if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) {
      throw createAttachmentError('De bijlagen mogen samen maximaal 5 MB zijn.');
    }
    const resolved = [];
    for (const payload of payloads) {
      let content;
      try {
        content = await runStorageOperation(async (store) => {
          const result = unwrapSupabaseResult(await store.download(payload.path));
          if (Buffer.isBuffer(result)) return result;
          if (result instanceof Uint8Array) return Buffer.from(result);
          if (result && typeof result.arrayBuffer === 'function') {
            return Buffer.from(await result.arrayBuffer());
          }
          return null;
        });
      } catch (error) {
        throw toSafeStorageError(error, 'Bijlage kon niet veilig worden opgehaald; de mail is niet verzonden.');
      }
      if (!content?.length || content.length !== Number(payload.size)) {
        throw createAttachmentError(`Bijlage "${payload.filename}" kon niet veilig worden gecontroleerd.`, 'MAILBOX_ATTACHMENT_SIZE_MISMATCH');
      }
      const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (payload.sha256 && actualSha256 !== payload.sha256) {
        throw createAttachmentError(
          `De inhoud van bijlage "${payload.filename}" wijkt af van de veilige uploadcontrole.`,
          'MAILBOX_ATTACHMENT_SHA256_MISMATCH',
          409
        );
      }
      resolved.push({
        filename: payload.filename,
        content,
        contentType: payload.contentType,
        contentDisposition: 'attachment',
        ...(payload.sha256 ? { sha256: actualSha256 } : {}),
      });
    }
    return resolved;
  }

  async function cleanupAttachments(attachments = [], binding = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return { removed: 0 };
    const payloads = list.map((attachment) => validateReferencePayload(
      verifyReference(attachment?.reference, signingSecret),
      binding,
      { allowExpired: true, allowLegacy: true }
    ));
    await removePaths(payloads.map((payload) => payload.path));
    return { removed: payloads.length };
  }

  async function sweepExpiredAttachments(options = {}) {
    const maxBatches = Math.max(1, Math.min(
      MAILBOX_ATTACHMENT_SWEEP_MAX_BATCHES,
      Number(options.maxBatches) || MAILBOX_ATTACHMENT_SWEEP_MAX_BATCHES
    ));
    const maxRootPages = Math.max(1, Math.min(
      MAILBOX_ATTACHMENT_SWEEP_MAX_ROOT_PAGES,
      Number(options.maxRootPages) || MAILBOX_ATTACHMENT_SWEEP_MAX_ROOT_PAGES
    ));
    const rootPageSize = Math.max(1, Math.min(
      MAILBOX_ATTACHMENT_SWEEP_ROOT_PAGE_SIZE,
      Number(options.rootPageSize) || MAILBOX_ATTACHMENT_SWEEP_ROOT_PAGE_SIZE
    ));
    const maxPaths = Math.max(1, Math.min(
      MAILBOX_ATTACHMENT_SWEEP_MAX_PATHS,
      Number(options.maxPaths) || MAILBOX_ATTACHMENT_SWEEP_MAX_PATHS
    ));
    const operationTimeoutMs = Math.max(1_000, Math.min(
      MAILBOX_ATTACHMENT_STORAGE_TIMEOUT_MS,
      Number(options.operationTimeoutMs) || MAILBOX_ATTACHMENT_SWEEP_OPERATION_TIMEOUT_MS
    ));
    const totalTimeoutMs = Math.max(1, Math.min(
      30_000,
      Number(options.totalTimeoutMs) || MAILBOX_ATTACHMENT_SWEEP_TOTAL_TIMEOUT_MS
    ));
    const expiredBefore = now().getTime() - MAILBOX_ATTACHMENT_SWEEP_GRACE_MS;
    const deadlineAt = Date.now() + totalTimeoutMs;
    const deadlineReserveMs = Math.min(50, Math.max(5, Math.ceil(totalTimeoutMs * 0.01)));
    let cancelled = false;
    const summary = { batches: 0, removed: 0, scannedPages: 0, timedOut: false };
    let totalTimer = null;

    function takeOperationTimeout() {
      const remainingMs = deadlineAt - Date.now() - deadlineReserveMs;
      if (remainingMs < 1_000) {
        cancelled = true;
        summary.timedOut = true;
        return 0;
      }
      return Math.min(operationTimeoutMs, remainingMs);
    }

    const work = (async () => {
      const expiredBatches = [];
      for (let page = 0; page < maxRootPages && !cancelled && expiredBatches.length < maxBatches; page += 1) {
        const currentOperationTimeoutMs = takeOperationTimeout();
        if (!currentOperationTimeoutMs) break;
        const entries = await runStorageOperation((store) => store.list(
          MAILBOX_ATTACHMENT_STORAGE_PREFIX,
          {
            limit: rootPageSize,
            offset: page * rootPageSize,
            sortBy: { column: 'name', order: 'asc' },
          }
        ), { maxAttempts: 1, timeoutMs: currentOperationTimeoutMs });
        if (cancelled) break;
        const pageEntries = Array.isArray(entries) ? entries : [];
        summary.scannedPages += 1;
        for (const entry of pageEntries) {
          const name = normalizeText(entry?.name);
          const match = name.match(/^(\d{13})-[a-z0-9-]+$/i);
          const expiresAt = match ? Number(match[1]) : Number.NaN;
          if (Number.isFinite(expiresAt) && expiresAt <= expiredBefore) {
            expiredBatches.push({ name, expiresAt });
            if (expiredBatches.length >= maxBatches) break;
          }
        }
        if (pageEntries.length < rootPageSize) break;
      }

      for (const batch of expiredBatches) {
        if (cancelled || summary.removed >= maxPaths) break;
        const prefix = `${MAILBOX_ATTACHMENT_STORAGE_PREFIX}/${batch.name}`;
        const listOperationTimeoutMs = takeOperationTimeout();
        if (!listOperationTimeoutMs) break;
        const files = await runStorageOperation((store) => store.list(
          prefix,
          {
            limit: Math.min(100, maxPaths - summary.removed),
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          }
        ), { maxAttempts: 1, timeoutMs: listOperationTimeoutMs });
        if (cancelled) break;
        const paths = (Array.isArray(files) ? files : [])
          .map((file) => normalizeText(file?.name))
          .filter((name) => /^\d+-[^/]+$/.test(name))
          .slice(0, maxPaths - summary.removed)
          .map((name) => `${prefix}/${name}`);
        if (!paths.length) continue;
        const removeOperationTimeoutMs = takeOperationTimeout();
        if (!removeOperationTimeoutMs) break;
        await removePaths(paths, { maxAttempts: 1, timeoutMs: removeOperationTimeoutMs });
        if (cancelled) break;
        summary.removed += paths.length;
        summary.batches += 1;
      }
      return { ...summary };
    })();

    const deadline = new Promise((resolve) => {
      totalTimer = setTimeoutFn(() => {
        cancelled = true;
        summary.timedOut = true;
        resolve({ ...summary });
      }, totalTimeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (totalTimer !== null && totalTimer !== undefined) clearTimeoutFn(totalTimer);
    }
  }

  return {
    cleanupAttachments,
    createBindingHash,
    createUploadPlan,
    downloadAttachments,
    inspectAttachments,
    isConfigured: () => Boolean(signingSecret && getStorageClient()?.storage?.from),
    sweepExpiredAttachments,
  };
}

module.exports = {
  MAILBOX_ATTACHMENT_BUCKET,
  MAILBOX_ATTACHMENT_EXTENSIONS,
  MAILBOX_ATTACHMENT_LEGACY_REFERENCE_VERSION,
  MAILBOX_ATTACHMENT_REFERENCE_VERSION,
  MAILBOX_ATTACHMENT_REFERENCE_TTL_MS,
  MAILBOX_ATTACHMENT_STORAGE_MAX_ATTEMPTS,
  MAILBOX_ATTACHMENT_STORAGE_PREFIX,
  MAILBOX_ATTACHMENT_STORAGE_TIMEOUT_MS,
  MAILBOX_ATTACHMENT_SWEEP_GRACE_MS,
  MAILBOX_ATTACHMENT_SWEEP_MAX_BATCHES,
  MAILBOX_ATTACHMENT_SWEEP_MAX_PATHS,
  MAILBOX_ATTACHMENT_SWEEP_MAX_ROOT_PAGES,
  MAILBOX_ATTACHMENT_SWEEP_ROOT_PAGE_SIZE,
  MAILBOX_ATTACHMENT_SWEEP_TOTAL_TIMEOUT_MS,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS,
  MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES,
  createBindingHash,
  createMailboxAttachmentService,
  isTransientStorageError,
  safeFilename,
};
