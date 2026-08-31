(function (global) {
  'use strict';

  const MARKER_VERSION = 1;
  const STORAGE_PREFIX = 'softora.mailbox.send-resilience.v1:';
  const LOCK_NAME = 'softora-mailbox-send-resilience:v1';
  const RESOLVED_RETENTION_MS = 2 * 60 * 60 * 1000;
  const MAX_RESOLVED_MARKERS = 20;
  const MIN_STAGING_VALIDITY_MS = 30_000;
  const MAX_FAILED_KEY_ROTATIONS = 2;
  const PREFLIGHT_DEADLINE_MS = 15_000;
  const SEND_DEADLINE_MS = 45_000;
  const MARKER_STATES = new Set(['armed', 'staged', 'dispatching', 'processing', 'accepted', 'failed']);
  const UNRESOLVED_STATES = new Set(['armed', 'staged', 'dispatching', 'processing']);
  const PROVEN_PRE_DISPATCH_STATES = new Set(['armed', 'staged']);

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function createProtocolError(code, message, options = {}) {
    const error = new Error(String(message || 'Mail verzenden mislukt'));
    error.code = String(code || 'MAILBOX_SEND_RESILIENCE_FAILED');
    error.status = Number(options.status) || 409;
    error.retryable = options.retryable === true;
    if (options.cause) error.cause = options.cause;
    return error;
  }

  function storageError(cause) {
    return createProtocolError(
      'MAILBOX_SEND_DURABLE_STATE_UNAVAILABLE',
      'De veilige verzendstatus kon niet duurzaam worden opgeslagen; de mail is niet verzonden.',
      { status: 503, retryable: true, cause }
    );
  }

  function getNow(options = {}) {
    const value = typeof options.now === 'function' ? options.now() : Date.now();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function getCrypto(options = {}) {
    return options.crypto || global.crypto || null;
  }

  function getRandomToken(options = {}) {
    const cryptoRef = getCrypto(options);
    if (typeof options.randomUUID === 'function') return String(options.randomUUID());
    if (typeof cryptoRef?.randomUUID === 'function') return String(cryptoRef.randomUUID());
    throw createProtocolError(
      'MAILBOX_SEND_CRYPTO_UNAVAILABLE',
      'De browser kan geen veilige verzend-ID maken; de mail is niet verzonden.',
      { status: 503 }
    );
  }

  function getStorage(options = {}) {
    let storage = options.storage;
    if (storage === undefined) {
      const browserStorage = options.browserStorage || global.SoftoraPremiumBrowserStorage;
      try {
        storage = browserStorage?.createStrictPrefixedStorage?.({ prefix: STORAGE_PREFIX });
      } catch (error) {
        throw storageError(error);
      }
    }
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
      || typeof storage.key !== 'function'
      || !Number.isFinite(Number(storage.length))
    ) {
      throw storageError(new Error('duurzame browseropslag ontbreekt'));
    }
    return storage;
  }

  function markerStorageKey(idempotencyKey) {
    return `${STORAGE_PREFIX}${encodeURIComponent(normalizeText(idempotencyKey))}`;
  }

  function parseMarker(raw, expectedKey = '') {
    if (typeof raw !== 'string' || !raw) return null;
    let marker;
    try {
      marker = JSON.parse(raw);
    } catch (error) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'De veilige verzendstatus is beschadigd; de mail is niet verzonden.',
        { status: 409, cause: error }
      );
    }
    const key = normalizeText(marker?.idempotencyKey);
    const hasMetadata = Object.prototype.hasOwnProperty.call(marker || {}, 'attachmentsMetadata');
    const rawMetadata = hasMetadata ? marker.attachmentsMetadata : [];
    const markerMetadata = Array.isArray(rawMetadata)
      ? normalizeAttachmentMetadata(rawMetadata)
      : null;
    const metadataIsCanonical = markerMetadata !== null
      && JSON.stringify(rawMetadata) === JSON.stringify(markerMetadata);
    const state = marker?.state;
    const valid = marker
      && marker.version === MARKER_VERSION
      && typeof marker.idempotencyKey === 'string'
      && marker.idempotencyKey === key
      && key
      && (!expectedKey || key === expectedKey)
      && typeof marker.casToken === 'string'
      && marker.casToken === normalizeText(marker.casToken)
      && marker.casToken
      && typeof marker.payloadFingerprint === 'string'
      && /^[0-9a-f]{64}$/.test(marker.payloadFingerprint)
      && typeof marker.localScopeFingerprint === 'string'
      && /^[0-9a-f]{64}$/.test(marker.localScopeFingerprint)
      && typeof state === 'string'
      && MARKER_STATES.has(state)
      && typeof marker.createdAt === 'number'
      && Number.isFinite(marker.createdAt)
      && typeof marker.updatedAt === 'number'
      && Number.isFinite(marker.updatedAt)
      && marker.createdAt >= 0
      && marker.updatedAt >= marker.createdAt
      && metadataIsCanonical
      && (
        marker.reconcileProof == null
        || (typeof marker.reconcileProof === 'object' && !Array.isArray(marker.reconcileProof))
      );
    if (!valid) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'De veilige verzendstatus is ongeldig; de mail is niet verzonden.'
      );
    }
    return {
      ...marker,
      idempotencyKey: key,
      state,
      attachmentsMetadata: markerMetadata,
    };
  }

  function readMarker(storage, idempotencyKey) {
    const key = normalizeText(idempotencyKey);
    let raw;
    try {
      raw = storage.getItem(markerStorageKey(key));
    } catch (error) {
      throw storageError(error);
    }
    return raw === null ? null : parseMarker(raw, key);
  }

  function listMarkers(storage) {
    const markers = [];
    let keys;
    try {
      const length = Number(storage.length);
      keys = Array.from({ length }, (_value, index) => storage.key(index));
    } catch (error) {
      throw storageError(error);
    }
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(STORAGE_PREFIX)) continue;
      let raw;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        throw storageError(error);
      }
      if (raw !== null) markers.push(parseMarker(raw));
    }
    return markers;
  }

  function compareAndSwapMarker(storage, marker, expectedCasToken, options = {}) {
    const idempotencyKey = normalizeText(marker?.idempotencyKey);
    if (!idempotencyKey) {
      throw createProtocolError('MAILBOX_SEND_DURABLE_STATE_INVALID', 'Veilige verzend-ID ontbreekt.');
    }
    const current = readMarker(storage, idempotencyKey);
    const expected = expectedCasToken == null ? null : normalizeText(expectedCasToken);
    const currentToken = current ? normalizeText(current.casToken) : null;
    if (currentToken !== expected) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CONFLICT',
        'De veilige verzendstatus is in een ander tabblad gewijzigd; probeer opnieuw.',
        { status: 409, retryable: true }
      );
    }
    const next = {
      ...marker,
      version: MARKER_VERSION,
      idempotencyKey,
      casToken: getRandomToken(options),
      updatedAt: getNow(options),
    };
    const serialized = JSON.stringify(next);
    const storageKey = markerStorageKey(idempotencyKey);
    try {
      storage.setItem(storageKey, serialized);
      const readback = storage.getItem(storageKey);
      if (readback !== serialized) throw new Error('duurzame opslag write/readback mismatch');
      const verified = parseMarker(readback, idempotencyKey);
      if (verified.casToken !== next.casToken) throw new Error('duurzame opslag CAS token mismatch');
      return verified;
    } catch (error) {
      if (error?.code === 'MAILBOX_SEND_DURABLE_STATE_CORRUPT') throw error;
      throw storageError(error);
    }
  }

  function removeResolvedMarker(storage, marker) {
    if (UNRESOLVED_STATES.has(normalizeText(marker?.state))) return false;
    const current = readMarker(storage, marker.idempotencyKey);
    if (!current || current.casToken !== marker.casToken) return false;
    try {
      storage.removeItem(markerStorageKey(marker.idempotencyKey));
      if (storage.getItem(markerStorageKey(marker.idempotencyKey)) !== null) {
        throw new Error('duurzame opslag delete/readback mismatch');
      }
      return true;
    } catch (error) {
      throw storageError(error);
    }
  }

  function pruneResolvedMarkers(storage, options = {}) {
    const now = getNow(options);
    const retentionMs = Math.max(RESOLVED_RETENTION_MS, Number(options.resolvedRetentionMs) || 0);
    const maxResolved = Math.max(MAX_RESOLVED_MARKERS, Number(options.maxResolvedMarkers) || 0);
    const resolved = listMarkers(storage)
      .filter((marker) => !UNRESOLVED_STATES.has(marker.state))
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    resolved.forEach((marker, index) => {
      if (now - Number(marker.updatedAt) > retentionMs || index >= maxResolved) {
        removeResolvedMarker(storage, marker);
      }
    });
  }

  function normalizeAttachmentMetadata(value) {
    const list = Array.isArray(value) ? value : [];
    if (list.length > 5) return null;
    let total = 0;
    const normalized = [];
    for (const attachment of list) {
      const filename = normalizeText(attachment?.filename || attachment?.name);
      const contentType = normalize(attachment?.contentType || attachment?.type);
      const size = Number(attachment?.size);
      const sha256 = normalizeText(attachment?.sha256);
      if (
        !filename
        || Array.from(filename).length > 120
        || !contentType
        || contentType.length > 128
        || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(contentType)
        || !Number.isSafeInteger(size)
        || size <= 0
        || size > 4 * 1024 * 1024
      ) return null;
      total += size;
      if (total > 5 * 1024 * 1024) return null;
      if (attachment?.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) return null;
      normalized.push({ filename, contentType, size, ...(sha256 ? { sha256 } : {}) });
    }
    if (normalized.some((item) => item.sha256) && !normalized.every((item) => item.sha256)) return null;
    return normalized;
  }

  async function bindAttachmentSelection(value, options = {}) {
    const attachments = Array.isArray(value) ? value : [];
    if (!attachments.length) return { attachments: [], metadata: [], digest: null };
    const digest = options.attachmentDigest || global.SoftoraMailboxAttachmentDigest;
    if (!digest || typeof digest.bind !== 'function' || typeof digest.verify !== 'function') {
      throw createProtocolError(
        'MAILBOX_ATTACHMENT_DIGEST_UNAVAILABLE',
        'De browser kan de bijlage niet veilig controleren; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    const bound = await digest.bind(attachments, { crypto: getCrypto(options) });
    const metadata = normalizeAttachmentMetadata(bound?.metadata);
    if (
      metadata === null
      || bound?.attachments?.length !== metadata.length
      || !metadata.every((attachment) => /^[0-9a-f]{64}$/.test(attachment.sha256 || ''))
    ) {
      throw createProtocolError(
        'MAILBOX_ATTACHMENT_METADATA_INVALID',
        'De bijlagemetadata kon niet veilig worden vastgesteld; de mail is niet verzonden.',
        { status: 400 }
      );
    }
    return { attachments: bound.attachments, metadata, digest };
  }

  function canonicalFingerprintPayload(payload, attachmentsMetadata) {
    const replyIdentity = payload?.replyIdentity && typeof payload.replyIdentity === 'object'
      ? payload.replyIdentity : {};
    const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    return {
      account: normalize(payload?.account),
      owner: normalize(payload?.owner),
      provider: normalize(payload?.provider) || 'smtp',
      mode: normalize(payload?.mode),
      providerMessageId: normalizeText(payload?.providerMessageId),
      providerThreadId: normalizeText(payload?.providerThreadId),
      replyIdentity: {
        version: Number(replyIdentity.version) || 0,
        provider: normalize(replyIdentity.provider),
        owner: normalize(replyIdentity.owner),
        accountEmail: normalize(replyIdentity.accountEmail),
        providerAccountEmail: normalize(replyIdentity.providerAccountEmail),
        providerMessageId: normalizeText(replyIdentity.providerMessageId),
        providerThreadId: normalizeText(replyIdentity.providerThreadId),
        sourceMessageId: normalizeText(replyIdentity.sourceMessageId),
        conversationId: normalizeText(replyIdentity.conversationId),
      },
      context: {
        conversationId: normalizeText(context.conversationId),
        id: normalizeText(context.id),
        folder: normalize(context.folder),
        uid: Number(context.uid) || 0,
        messageId: normalizeText(context.messageId),
        references: normalizeText(context.references),
      },
      to: normalize(payload?.to),
      cc: normalize(payload?.cc),
      bcc: normalize(payload?.bcc),
      subject: normalizeText(payload?.subject),
      body: normalizeText(payload?.body),
      attachmentsMetadata,
    };
  }

  async function sha256Hex(value, options = {}) {
    const cryptoRef = getCrypto(options);
    if (typeof cryptoRef?.subtle?.digest !== 'function' || typeof global.TextEncoder !== 'function') {
      throw createProtocolError(
        'MAILBOX_SEND_CRYPTO_UNAVAILABLE',
        'De browser kan de verzendgegevens niet veilig verifiëren; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    const digest = await cryptoRef.subtle.digest(
      'SHA-256',
      new global.TextEncoder().encode(String(value))
    );
    if (Object.prototype.toString.call(digest) !== '[object ArrayBuffer]' || digest.byteLength !== 32) {
      throw createProtocolError(
        'MAILBOX_SEND_CRYPTO_INVALID',
        'De browser gaf geen geldig verzendbewijs; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function createPayloadFingerprint(payload, attachmentsMetadata, options = {}) {
    return sha256Hex(JSON.stringify(canonicalFingerprintPayload(payload, attachmentsMetadata)), options);
  }

  async function createLocalScopeFingerprint(payload, options = {}) {
    const canonical = canonicalFingerprintPayload(payload, []);
    return sha256Hex(JSON.stringify({
      account: canonical.account,
      owner: canonical.owner,
      provider: canonical.provider,
      mode: canonical.mode,
      providerMessageId: canonical.providerMessageId,
      providerThreadId: canonical.providerThreadId,
      replyIdentity: canonical.replyIdentity,
      context: canonical.context,
      to: canonical.to,
    }), options);
  }

  function createMarker(
    idempotencyKey,
    payloadFingerprint,
    localScopeFingerprint,
    attachmentsMetadata,
    options = {}
  ) {
    const now = getNow(options);
    return compareAndSwapMarker(getStorage(options), {
      version: MARKER_VERSION,
      idempotencyKey,
      payloadFingerprint,
      localScopeFingerprint,
      state: 'armed',
      createdAt: now,
      updatedAt: now,
      staging: [],
      attachmentsMetadata,
      durableIdentity: null,
      reconcileProof: null,
    }, null, options);
  }

  function patchMarker(storage, marker, patch, options = {}) {
    return compareAndSwapMarker(storage, { ...marker, ...patch }, marker.casToken, options);
  }

  function markerIsProvenPreDispatch(marker) {
    return PROVEN_PRE_DISPATCH_STATES.has(normalizeText(marker?.state))
      && !Object.prototype.hasOwnProperty.call(marker || {}, 'sendStartedAt')
      && marker?.durableIdentity == null;
  }

  function retireProvenPreDispatchMarker(storage, marker, options = {}) {
    return patchMarker(storage, marker, {
      state: 'failed',
      staging: [],
      durableIdentity: null,
      reconcileProof: null,
      sendStartedAt: undefined,
    }, options);
  }

  function selectMarker(
    storage,
    requestedKey,
    payloadFingerprint,
    localScopeFingerprint,
    attachmentsMetadata,
    options = {}
  ) {
    const requested = normalizeText(requestedKey);
    const replaceProvenPreDispatch = options.replaceProvenPreDispatch === true;
    let requestedCanBeCreated = Boolean(requested);
    let exact = requested ? readMarker(storage, requested) : null;
    const exactPayloadMismatch = Boolean(
      exact && exact.payloadFingerprint !== payloadFingerprint
    );
    const exactCanRotate = Boolean(
      exactPayloadMismatch
      && replaceProvenPreDispatch
      && (
        (exact.state === 'failed' && exact.durableIdentity == null)
        || markerIsProvenPreDispatch(exact)
      )
    );
    if (exactPayloadMismatch && !exactCanRotate) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_PAYLOAD_MISMATCH',
        'De verzendgegevens wijken af van de veilige eerdere poging; de mail is niet verzonden.'
      );
    }
    const markers = listMarkers(storage);
    const matches = markers.filter((marker) => marker.payloadFingerprint === payloadFingerprint);
    const unresolved = matches.filter((marker) => UNRESOLVED_STATES.has(marker.state));
    if (unresolved.length > 1) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_AMBIGUOUS',
        'Meerdere onopgeloste verzendpogingen passen bij deze mail; er is niets opnieuw verzonden.'
      );
    }
    const unresolvedScopeConflicts = markers.filter((marker) => (
      UNRESOLVED_STATES.has(marker.state)
      && marker.localScopeFingerprint === localScopeFingerprint
      && marker.payloadFingerprint !== payloadFingerprint
    ));
    if (unresolvedScopeConflicts.length) {
      const allProvenPreDispatch = unresolvedScopeConflicts.every(markerIsProvenPreDispatch);
      if (!replaceProvenPreDispatch || !allProvenPreDispatch) {
        throw createProtocolError(
          'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT',
          'Voor deze mailcontext bestaat nog een onopgeloste verzending met andere inhoud of bijlagen; er is niets opnieuw verzonden.'
        );
      }
    }
    unresolvedScopeConflicts.forEach((marker) => {
      retireProvenPreDispatchMarker(storage, marker, options);
    });
    if (exactPayloadMismatch) {
      if (exact.state !== 'failed' && !unresolvedScopeConflicts.some((marker) => (
        marker.idempotencyKey === exact.idempotencyKey
      ))) {
        retireProvenPreDispatchMarker(storage, exact, options);
      }
      exact = null;
      requestedCanBeCreated = false;
    }
    if (requested) {
      if (exact) {
        if (exact.state === 'accepted' || UNRESOLVED_STATES.has(exact.state)) return exact;
      }
    }
    if (unresolved.length === 1) return unresolved[0];
    const recentAccepted = matches
      .filter((marker) => marker.state === 'accepted')
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    if (recentAccepted.length) return recentAccepted[0];
    if (exact) return exact;
    const idempotencyKey = requestedCanBeCreated
      ? requested
      : `browser:${getRandomToken(options)}`;
    return createMarker(
      idempotencyKey,
      payloadFingerprint,
      localScopeFingerprint,
      attachmentsMetadata,
      { ...options, storage }
    );
  }

  const api = Object.freeze({
    LOCK_NAME,
    MARKER_STATES,
    MARKER_VERSION,
    MAX_FAILED_KEY_ROTATIONS,
    MAX_RESOLVED_MARKERS,
    MIN_STAGING_VALIDITY_MS,
    PREFLIGHT_DEADLINE_MS,
    PROVEN_PRE_DISPATCH_STATES,
    RESOLVED_RETENTION_MS,
    SEND_DEADLINE_MS,
    STORAGE_PREFIX,
    UNRESOLVED_STATES,
    bindAttachmentSelection,
    canonicalFingerprintPayload,
    compareAndSwapMarker,
    createLocalScopeFingerprint,
    createMarker,
    createPayloadFingerprint,
    createProtocolError,
    getCrypto,
    getNow,
    getRandomToken,
    getStorage,
    listMarkers,
    markerStorageKey,
    normalize,
    normalizeAttachmentMetadata,
    normalizeText,
    parseMarker,
    patchMarker,
    pruneResolvedMarkers,
    readMarker,
    removeResolvedMarker,
    selectMarker,
    sha256Hex,
    storageError,
  });
  global.SoftoraMailboxComposeSendState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
