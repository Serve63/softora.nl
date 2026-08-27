(function (global) {
  'use strict';

  const MARKER_VERSION = 1;
  const STORAGE_PREFIX = 'softora.mailbox.send-resilience.v1:';
  const LOCK_NAME = 'softora-mailbox-send-resilience:v1';
  const RESOLVED_RETENTION_MS = 2 * 60 * 60 * 1000;
  const MAX_RESOLVED_MARKERS = 20;
  const MIN_STAGING_VALIDITY_MS = 30_000;
  const MAX_FAILED_KEY_ROTATIONS = 2;
  const MARKER_STATES = new Set(['armed', 'staged', 'dispatching', 'processing', 'accepted', 'failed']);
  const UNRESOLVED_STATES = new Set(['armed', 'staged', 'dispatching', 'processing']);

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
      try {
        storage = global.localStorage;
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
      throw storageError(new Error('localStorage ontbreekt'));
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
    const valid = marker
      && marker.version === MARKER_VERSION
      && key
      && (!expectedKey || key === expectedKey)
      && normalizeText(marker.casToken)
      && /^[0-9a-f]{64}$/i.test(normalizeText(marker.payloadFingerprint))
      && /^[0-9a-f]{64}$/i.test(normalizeText(marker.localScopeFingerprint))
      && MARKER_STATES.has(normalizeText(marker.state))
      && Number.isFinite(Number(marker.createdAt))
      && Number.isFinite(Number(marker.updatedAt))
      && (marker.reconcileProof == null || typeof marker.reconcileProof === 'object');
    if (!valid) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'De veilige verzendstatus is ongeldig; de mail is niet verzonden.'
      );
    }
    return marker;
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
      if (readback !== serialized) throw new Error('localStorage write/readback mismatch');
      const verified = parseMarker(readback, idempotencyKey);
      if (verified.casToken !== next.casToken) throw new Error('localStorage CAS token mismatch');
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
        throw new Error('localStorage delete/readback mismatch');
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
      normalized.push({ filename, contentType, size });
    }
    return normalized;
  }

  function attachmentMetadataFromSelection(attachments) {
    const metadata = (Array.isArray(attachments) ? attachments : []).map((attachment) => ({
      filename: attachment?.filename || attachment?.name,
      contentType: attachment?.contentType || attachment?.type,
      size: attachment?.size,
    }));
    const normalized = normalizeAttachmentMetadata(metadata);
    if (normalized === null) {
      throw createProtocolError(
        'MAILBOX_ATTACHMENT_METADATA_INVALID',
        'De bijlagemetadata kon niet veilig worden vastgesteld; de mail is niet verzonden.',
        { status: 400 }
      );
    }
    return normalized;
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
    const digest = await cryptoRef.subtle.digest('SHA-256', new global.TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

  function createMarker(idempotencyKey, payloadFingerprint, localScopeFingerprint, options = {}) {
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
      durableIdentity: null,
      reconcileProof: null,
    }, null, options);
  }

  function patchMarker(storage, marker, patch, options = {}) {
    return compareAndSwapMarker(storage, { ...marker, ...patch }, marker.casToken, options);
  }

  function selectMarker(storage, requestedKey, payloadFingerprint, localScopeFingerprint, options = {}) {
    const requested = normalizeText(requestedKey);
    if (requested) {
      const exact = readMarker(storage, requested);
      if (exact) {
        if (exact.payloadFingerprint !== payloadFingerprint) {
          throw createProtocolError(
            'MAILBOX_SEND_DURABLE_STATE_PAYLOAD_MISMATCH',
            'De verzendgegevens wijken af van de veilige eerdere poging; de mail is niet verzonden.'
          );
        }
        return exact;
      }
    }
    const matches = listMarkers(storage).filter((marker) => marker.payloadFingerprint === payloadFingerprint);
    const unresolved = matches.filter((marker) => UNRESOLVED_STATES.has(marker.state));
    if (unresolved.length > 1) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_AMBIGUOUS',
        'Meerdere onopgeloste verzendpogingen passen bij deze mail; er is niets opnieuw verzonden.'
      );
    }
    if (unresolved.length === 1) return unresolved[0];
    const unresolvedScopeConflicts = listMarkers(storage).filter((marker) => (
      UNRESOLVED_STATES.has(marker.state)
      && marker.localScopeFingerprint === localScopeFingerprint
      && marker.payloadFingerprint !== payloadFingerprint
    ));
    if (unresolvedScopeConflicts.length) {
      throw createProtocolError(
        'MAILBOX_SEND_UNRESOLVED_SCOPE_CONFLICT',
        'Voor deze mailcontext bestaat nog een onopgeloste verzending met andere inhoud of bijlagen; er is niets opnieuw verzonden.'
      );
    }
    const recentAccepted = matches
      .filter((marker) => marker.state === 'accepted')
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    if (recentAccepted.length) return recentAccepted[0];
    const idempotencyKey = requested || `browser:${getRandomToken(options)}`;
    return createMarker(idempotencyKey, payloadFingerprint, localScopeFingerprint, options);
  }

  function responseHeader(response, name) {
    try {
      return normalizeText(response?.headers?.get?.(name)).replace(/[\r\n]/g, '');
    } catch (_) {
      return '';
    }
  }

  function extractDurableIdentity(result, response = null) {
    const sentMessage = result?.sentMessage && typeof result.sentMessage === 'object' ? result.sentMessage : {};
    const identity = {
      intentId: normalizeText(
        result?.intentId || sentMessage.softoraSendIntentId
        || responseHeader(response, 'X-Softora-Send-Intent-Id')
      ),
      messageId: normalizeText(
        result?.messageId || sentMessage.messageId
        || responseHeader(response, 'X-Softora-Message-Id')
      ),
      providerMessageId: normalizeText(
        result?.providerMessageId || sentMessage.providerMessageId
        || responseHeader(response, 'X-Softora-Provider-Message-Id')
      ),
    };
    return identity.intentId || identity.messageId || identity.providerMessageId ? identity : null;
  }

  function expectedPreflightScope(payload) {
    const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const replyIdentity = payload?.replyIdentity && typeof payload.replyIdentity === 'object'
      ? payload.replyIdentity : {};
    return {
      owner: normalize(payload?.owner),
      accountEmail: normalize(payload?.account),
      provider: normalize(payload?.provider) || 'smtp',
      mode: normalize(payload?.mode),
      conversationId: normalizeText(replyIdentity.conversationId || context.conversationId),
      replyTargetMessageId: normalizeText(replyIdentity.sourceMessageId || context.messageId),
      providerThreadId: normalizeText(
        payload?.providerThreadId || replyIdentity.providerThreadId || ''
      ),
    };
  }

  function attachmentMetadataEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function validateReconcileProof(value, payload, attachmentsMetadata) {
    const proof = value && typeof value === 'object' ? value : null;
    const expected = expectedPreflightScope(payload);
    const proofMetadata = normalizeAttachmentMetadata(proof?.attachmentsMetadata);
    const valid = proof
      && proof.version === 1
      && typeof proof.idempotencyKey === 'string'
      && proof.idempotencyKey === payload?.idempotencyKey
      && normalize(proof.owner) === expected.owner
      && normalize(proof.accountEmail) === expected.accountEmail
      && normalize(proof.recipientEmail) === normalize(payload?.to)
      && (normalize(proof.provider) || 'smtp') === expected.provider
      && normalize(proof.mode) === expected.mode
      && normalizeText(proof.conversationId) === expected.conversationId
      && normalizeText(proof.replyTargetMessageId) === expected.replyTargetMessageId
      && normalizeText(proof.providerThreadId) === expected.providerThreadId
      && typeof proof.references === 'string'
      && (expected.mode !== 'new-message' || proof.references === '')
      && /^[0-9a-f]{64}$/i.test(normalizeText(proof.scopeFingerprint))
      && /^[0-9a-f]{64}$/i.test(normalizeText(proof.requestPayloadFingerprint))
      && proofMetadata !== null
      && attachmentMetadataEqual(proofMetadata, attachmentsMetadata);
    if (!valid) {
      throw createProtocolError(
        'MAILBOX_SEND_RECONCILE_PROOF_INVALID',
        'De server gaf geen exact, duurzaam verzendbewijs; er is niets verzonden.',
        { status: 502 }
      );
    }
    return {
      version: 1,
      idempotencyKey: proof.idempotencyKey,
      owner: normalize(proof.owner),
      accountEmail: normalize(proof.accountEmail),
      recipientEmail: normalize(proof.recipientEmail),
      provider: normalize(proof.provider) || 'smtp',
      mode: normalize(proof.mode),
      conversationId: normalizeText(proof.conversationId),
      replyTargetMessageId: normalizeText(proof.replyTargetMessageId),
      references: String(proof.references),
      providerThreadId: normalizeText(proof.providerThreadId),
      scopeFingerprint: normalizeText(proof.scopeFingerprint).toLowerCase(),
      requestPayloadFingerprint: normalizeText(proof.requestPayloadFingerprint).toLowerCase(),
      attachmentsMetadata: proofMetadata,
    };
  }

  function assertPreflightScope(result, payload) {
    const expected = expectedPreflightScope(payload);
    const actual = {
      owner: normalize(result?.owner),
      accountEmail: normalize(result?.accountEmail),
      provider: normalize(result?.provider),
      mode: normalize(result?.mode),
      conversationId: normalizeText(result?.conversationId),
      replyTargetMessageId: normalizeText(result?.replyTargetMessageId),
      providerThreadId: normalizeText(result?.providerThreadId),
    };
    if (Object.keys(expected).some((key) => expected[key] !== actual[key])) {
      throw createProtocolError(
        'MAILBOX_SEND_PREFLIGHT_SCOPE_MISMATCH',
        'De veilige mailcontrole hoort bij een andere verzendcontext; er is niets verzonden.'
      );
    }
  }

  function responseIsHttp200(response) {
    return typeof response?.status === 'number'
      && Number.isFinite(response.status)
      && response.status === 200;
  }

  async function parseJsonObject(response) {
    try {
      const data = await response?.json?.();
      return data && typeof data === 'object' ? data : {};
    } catch (_) {
      return {};
    }
  }

  function responseError(response, data, fallback) {
    return global.SoftoraMailboxError?.fromResponse?.(response, data, fallback)
      || createProtocolError(
        normalizeText(data?.code) || 'MAILBOX_SEND_FAILED',
        normalizeText(data?.detail || data?.error) || fallback,
        { status: Number(response?.status) || 500, retryable: data?.retryable === true }
      );
  }

  async function runPreflight(fetchImpl, requestPayload, expectedPayload, attachmentsMetadata, serialize) {
    const response = await fetchImpl('/api/mailbox/send/preflight', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: serialize(requestPayload),
    });
    const data = await parseJsonObject(response);
    if (!responseIsHttp200(response) || data?.ok !== true) {
      throw responseError(response, data, 'Veilige mailcontrole mislukt');
    }
    const result = data?.result;
    const status = normalizeText(result?.status);
    if (
      !result
      || result.preflight !== true
      || result.externalEffect !== false
      || !['accepted', 'processing', 'failed', 'ready'].includes(status)
    ) {
      throw createProtocolError(
        'MAILBOX_SEND_PREFLIGHT_INVALID',
        'De veilige mailcontrole gaf geen geldige status; er is niets verzonden.',
        { status: 502 }
      );
    }
    assertPreflightScope(result, expectedPayload);
    if (status === 'ready' && result.reservationReady !== true) {
      throw createProtocolError(
        'MAILBOX_SEND_PREFLIGHT_NOT_READY',
        'De veilige verzending kon niet worden gereserveerd; er is niets verzonden.',
        { status: 503, retryable: true }
      );
    }
    if (status !== 'ready' && result.reservationReady !== false) {
      throw createProtocolError(
        'MAILBOX_SEND_PREFLIGHT_INVALID',
        'De veilige mailcontrole gaf tegenstrijdige informatie; er is niets verzonden.',
        { status: 502 }
      );
    }
    if (status === 'accepted' && !extractDurableIdentity(result.acceptedResult)) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_IDENTITY_MISSING',
        'De mailstatus mist een duurzame berichtidentiteit; er is niets opnieuw verzonden.',
        { status: 409 }
      );
    }
    const reconcileProof = validateReconcileProof(
      result.reconcileProof,
      expectedPayload,
      attachmentsMetadata
    );
    return { response, data, result, status, reconcileProof };
  }

  function stagingIsReusable(marker, attachmentsMetadata, options = {}) {
    const staging = Array.isArray(marker?.staging) ? marker.staging : [];
    if (!attachmentsMetadata.length) return staging.length === 0;
    if (staging.length !== attachmentsMetadata.length) return false;
    const now = getNow(options);
    const references = new Set();
    return staging.every((attachment, index) => {
      const metadata = attachmentsMetadata[index];
      const rawReference = typeof attachment?.reference === 'string' ? attachment.reference : '';
      const reference = rawReference.trim();
      const uniqueReference = reference && !references.has(reference);
      if (uniqueReference) references.add(reference);
      return uniqueReference
        && rawReference === reference
        && attachment?.filename === metadata.filename
        && attachment?.contentType === metadata.contentType
        && Number(attachment?.size) === metadata.size
        && typeof attachment?.expiresAt === 'number'
        && Number.isSafeInteger(attachment.expiresAt)
        && Number(attachment.expiresAt) > now + MIN_STAGING_VALIDITY_MS;
    });
  }

  function normalizeStaging(value, attachmentsMetadata, options = {}) {
    const uploads = Array.isArray(value) ? value : [];
    if (uploads.length !== attachmentsMetadata.length) {
      throw createProtocolError(
        'MAILBOX_ATTACHMENT_STAGING_INVALID',
        'De bijlage-upload gaf geen volledige veilige status; de mail is niet verzonden.',
        { status: 502 }
      );
    }
    const now = getNow(options);
    const references = new Set();
    return uploads.map((upload, index) => {
      const metadata = attachmentsMetadata[index];
      const rawReference = typeof upload?.reference === 'string' ? upload.reference : '';
      const reference = rawReference.trim();
      const expiresAt = upload?.expiresAt;
      if (
        !reference
        || rawReference !== reference
        || references.has(reference)
        || upload?.filename !== metadata.filename
        || normalize(upload?.contentType) !== metadata.contentType
        || Number(upload?.size) !== metadata.size
        || typeof expiresAt !== 'number'
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= now + MIN_STAGING_VALIDITY_MS
      ) {
        throw createProtocolError(
          'MAILBOX_ATTACHMENT_STAGING_INVALID',
          'De bijlage-upload is niet lang genoeg geldig; de mail is niet verzonden.',
          { status: 409 }
        );
      }
      references.add(reference);
      return {
        reference,
        filename: metadata.filename,
        contentType: metadata.contentType,
        size: metadata.size,
        expiresAt,
      };
    });
  }

  function sendAttachmentsFromStaging(staging) {
    return (Array.isArray(staging) ? staging : []).map((attachment) => ({
      reference: attachment.reference,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    }));
  }

  function acceptedExecutionFromPreflight(preflight, marker, payload) {
    const attachments = Array.isArray(marker.staging) ? sendAttachmentsFromStaging(marker.staging) : [];
    const sentPayload = {
      ...payload,
      idempotencyKey: marker.idempotencyKey,
      reconcileProof: marker.reconcileProof,
      attachments,
    };
    return {
      response: preflight.response,
      data: { ok: true, result: preflight.result.acceptedResult },
      result: preflight.result.acceptedResult,
      idempotencyKey: marker.idempotencyKey,
      attachments,
      payload: sentPayload,
      recoveredByPreflight: true,
    };
  }

  function ensureLocks(options = {}) {
    const locks = Object.prototype.hasOwnProperty.call(options, 'locks')
      ? options.locks
      : options.navigator?.locks || global.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
      throw createProtocolError(
        'MAILBOX_SEND_CROSS_TAB_LOCK_UNAVAILABLE',
        'De browser kan verzending tussen tabbladen niet veilig vergrendelen; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    return locks;
  }

  function create(options = {}) {
    async function execute(input = {}) {
      const locks = ensureLocks(options);
      const fetchImpl = input.fetch || options.fetch || global.fetch?.bind(global);
      if (typeof fetchImpl !== 'function') {
        throw createProtocolError('MAILBOX_SEND_FETCH_UNAVAILABLE', 'Mail verzenden is tijdelijk niet beschikbaar.', { status: 503 });
      }
      const serialize = typeof input.serializeSendPayload === 'function'
        ? input.serializeSendPayload : JSON.stringify;
      const attachments = Array.isArray(input.attachments) ? input.attachments : [];
      const attachmentsMetadata = attachmentMetadataFromSelection(attachments);
      const payloadBase = {
        ...(input.payload && typeof input.payload === 'object' ? input.payload : {}),
        ...(input.payload?.replyIdentity && typeof input.payload.replyIdentity === 'object'
          ? { replyIdentity: { ...input.payload.replyIdentity } } : {}),
        context: input.payload?.context && typeof input.payload.context === 'object'
          ? {
              ...input.payload.context,
              ...(input.payload.context.replyIdentity && typeof input.payload.context.replyIdentity === 'object'
                ? { replyIdentity: { ...input.payload.context.replyIdentity } } : {}),
            }
          : {},
        attachments: [],
        attachmentsMetadata,
      };
      delete payloadBase.reconcileProof;
      const payloadFingerprint = await createPayloadFingerprint(payloadBase, attachmentsMetadata, options);
      const localScopeFingerprint = await createLocalScopeFingerprint(payloadBase, options);

      let lockEntered = false;
      try {
        return await locks.request(LOCK_NAME, { mode: 'exclusive' }, async (lock) => {
          if (!lock) {
            throw createProtocolError(
              'MAILBOX_SEND_CROSS_TAB_LOCK_UNAVAILABLE',
              'De veilige tabbladvergrendeling werd niet verkregen; de mail is niet verzonden.',
              { status: 503 }
            );
          }
          lockEntered = true;
          const storage = getStorage(options);
          pruneResolvedMarkers(storage, options);
          let marker = selectMarker(
            storage,
            payloadBase.idempotencyKey,
            payloadFingerprint,
            localScopeFingerprint,
            options
          );
          input.onIdempotencyKey?.(marker.idempotencyKey);

        for (let failedRotations = 0; ; failedRotations += 1) {
          const attemptPayload = { ...payloadBase, idempotencyKey: marker.idempotencyKey };
          const preflightRequest = marker.reconcileProof
            ? { idempotencyKey: marker.idempotencyKey, reconcileProof: marker.reconcileProof }
            : attemptPayload;
          const preflight = await runPreflight(
            fetchImpl,
            preflightRequest,
            attemptPayload,
            attachmentsMetadata,
            serialize
          );
          if (
            marker.reconcileProof
            && JSON.stringify(marker.reconcileProof) !== JSON.stringify(preflight.reconcileProof)
          ) {
            throw createProtocolError(
              'MAILBOX_SEND_RECONCILE_PROOF_MISMATCH',
              'Het duurzame verzendbewijs is gewijzigd; er is niets opnieuw verzonden.'
            );
          }
          if (!marker.reconcileProof) {
            marker = patchMarker(storage, marker, { reconcileProof: preflight.reconcileProof }, options);
          }
          if (preflight.status === 'accepted') {
            const durableIdentity = extractDurableIdentity(preflight.result.acceptedResult);
            try {
              marker = patchMarker(storage, marker, { state: 'accepted', durableIdentity }, options);
            } catch (error) {
              options.logger?.warn?.('[MailboxCompose][SendMarkerAccepted]', error?.message || error);
            }
            return acceptedExecutionFromPreflight(preflight, marker, attemptPayload);
          }
          if (preflight.status === 'processing') {
            marker = patchMarker(storage, marker, { state: 'processing' }, options);
            throw createProtocolError(
              'MAILBOX_SEND_ALREADY_PROCESSING',
              'Deze mail wordt al veilig verwerkt; wacht op bevestiging voordat je opnieuw probeert.',
              { status: 409, retryable: true }
            );
          }
          if (preflight.status === 'failed') {
            marker = patchMarker(storage, marker, { state: 'failed', staging: [] }, options);
            if (failedRotations >= MAX_FAILED_KEY_ROTATIONS) {
              throw createProtocolError(
                'MAILBOX_SEND_FAILED_KEY_ROTATION_EXHAUSTED',
                'De eerdere verzending bleef definitief gestopt; er is geen nieuwe mail gestart.',
                { status: 409 }
              );
            }
            const nextKey = `browser:${getRandomToken(options)}`;
            marker = createMarker(nextKey, payloadFingerprint, localScopeFingerprint, options);
            input.onIdempotencyKey?.(marker.idempotencyKey);
            continue;
          }

          const provenAttemptPayload = {
            ...attemptPayload,
            reconcileProof: marker.reconcileProof,
          };
          let staging = stagingIsReusable(marker, attachmentsMetadata, options)
            ? marker.staging : [];
          if (attachmentsMetadata.length && !staging.length) {
            if (typeof input.uploadAttachments !== 'function') {
              throw createProtocolError(
                'MAILBOX_ATTACHMENT_RESELECT_REQUIRED',
                'Kies de bijlagen opnieuw voordat je deze mail veilig verzendt.',
                { status: 409 }
              );
            }
            const uploaded = await input.uploadAttachments(attachments, {
              fetch: fetchImpl,
              payload: provenAttemptPayload,
            });
            staging = normalizeStaging(uploaded, attachmentsMetadata, options);
            marker = patchMarker(storage, marker, { state: 'staged', staging }, options);
          }

          const sendPayload = {
            ...provenAttemptPayload,
            attachments: sendAttachmentsFromStaging(staging),
          };
          marker = patchMarker(storage, marker, {
            state: 'dispatching',
            staging,
            sendStartedAt: getNow(options),
          }, options);
          const response = await fetchImpl('/api/mailbox/send', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: serialize(sendPayload),
          });
          const data = await parseJsonObject(response);
          if (!responseIsHttp200(response) || data?.ok === false) {
            throw responseError(response, data, 'Mail verzenden mislukt');
          }
          const result = data?.result && typeof data.result === 'object' ? data.result : {};
          const durableIdentity = extractDurableIdentity(result, response);
          if (!durableIdentity) {
            throw createProtocolError(
              'MAILBOX_SEND_DURABLE_IDENTITY_MISSING',
              'De server bevestigde geen duurzame berichtidentiteit; er is niets automatisch opnieuw verzonden.',
              { status: 409 }
            );
          }
          try {
            marker = patchMarker(storage, marker, { state: 'accepted', durableIdentity }, options);
          } catch (error) {
            options.logger?.warn?.('[MailboxCompose][SendMarkerAccepted]', error?.message || error);
          }
          return {
            response,
            data,
            result,
            idempotencyKey: marker.idempotencyKey,
            attachments: sendPayload.attachments,
            payload: sendPayload,
            recoveredByPreflight: false,
          };
          }
        });
      } catch (error) {
        if (lockEntered || error?.code === 'MAILBOX_SEND_CROSS_TAB_LOCK_UNAVAILABLE') throw error;
        throw createProtocolError(
          'MAILBOX_SEND_CROSS_TAB_LOCK_UNAVAILABLE',
          'De veilige tabbladvergrendeling kon niet worden gestart; de mail is niet verzonden.',
          { status: 503, cause: error }
        );
      }
    }

    return { execute };
  }

  const api = {
    LOCK_NAME,
    MARKER_VERSION,
    STORAGE_PREFIX,
    UNRESOLVED_STATES,
    compareAndSwapMarker,
    create,
    createLocalScopeFingerprint,
    createPayloadFingerprint,
    listMarkers,
    markerStorageKey,
    parseMarker,
    pruneResolvedMarkers,
    readMarker,
  };
  global.SoftoraMailboxComposeSendResilience = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
