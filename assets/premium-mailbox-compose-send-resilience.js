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
    const markerMetadata = Object.prototype.hasOwnProperty.call(marker || {}, 'attachmentsMetadata')
      ? normalizeAttachmentMetadata(marker.attachmentsMetadata)
      : [];
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
      && markerMetadata !== null
      && (marker.reconcileProof == null || typeof marker.reconcileProof === 'object');
    if (!valid) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'De veilige verzendstatus is ongeldig; de mail is niet verzonden.'
      );
    }
    return { ...marker, attachmentsMetadata: markerMetadata };
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
      throw createProtocolError('MAILBOX_ATTACHMENT_DIGEST_UNAVAILABLE', 'De browser kan de bijlage niet veilig controleren; de mail is niet verzonden.', { status: 503 });
    }
    const bound = await digest.bind(attachments, { crypto: getCrypto(options) });
    const metadata = normalizeAttachmentMetadata(bound?.metadata);
    if (
      metadata === null
      || bound?.attachments?.length !== metadata.length
      || !metadata.every((attachment) => /^[0-9a-f]{64}$/.test(attachment.sha256 || ''))
    ) throw createProtocolError('MAILBOX_ATTACHMENT_METADATA_INVALID', 'De bijlagemetadata kon niet veilig worden vastgesteld; de mail is niet verzonden.', { status: 400 });
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

  function selectMarker(
    storage,
    requestedKey,
    payloadFingerprint,
    localScopeFingerprint,
    attachmentsMetadata,
    options = {}
  ) {
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
    return createMarker(
      idempotencyKey,
      payloadFingerprint,
      localScopeFingerprint,
      attachmentsMetadata,
      options
    );
  }

  function markerAttachmentMetadata(marker) {
    const stored = normalizeAttachmentMetadata(marker?.attachmentsMetadata);
    const proof = marker?.reconcileProof && typeof marker.reconcileProof === 'object'
      ? normalizeAttachmentMetadata(marker.reconcileProof.attachmentsMetadata)
      : null;
    if (stored === null || proof === null && marker?.reconcileProof) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'De veilige bijlagestatus is ongeldig; de mail is niet verzonden.'
      );
    }
    if (proof && !attachmentMetadataEqual(proof, stored)) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_CORRUPT',
        'Het duurzame verzendbewijs wijkt af van de bewaarde bijlagestatus; de mail is niet verzonden.'
      );
    }
    return proof || stored || [];
  }

  async function findMissingAttachmentMarker(
    storage,
    payload,
    currentMetadata,
    localScopeFingerprint,
    options = {}
  ) {
    if (currentMetadata.length) return null;
    const requestedKey = normalizeText(payload?.idempotencyKey);
    const candidates = [];
    for (const marker of listMarkers(storage)) {
      if (!UNRESOLVED_STATES.has(marker.state)) continue;
      if (marker.localScopeFingerprint !== localScopeFingerprint) continue;
      const requiredMetadata = markerAttachmentMetadata(marker);
      if (!requiredMetadata.length) continue;
      const candidatePayload = { ...payload, idempotencyKey: marker.idempotencyKey };
      const candidateFingerprint = await createPayloadFingerprint(
        candidatePayload,
        requiredMetadata,
        options
      );
      if (candidateFingerprint !== marker.payloadFingerprint) continue;
      if (marker.reconcileProof) {
        validateReconcileProof(marker.reconcileProof, candidatePayload, requiredMetadata);
      }
      candidates.push({ marker, attachmentsMetadata: requiredMetadata });
    }
    if (requestedKey) {
      const exact = candidates.filter(({ marker }) => marker.idempotencyKey === requestedKey);
      if (exact.length === 1) return exact[0];
      if (candidates.length && readMarker(storage, requestedKey)) {
        throw createProtocolError(
          'MAILBOX_SEND_DURABLE_STATE_PAYLOAD_MISMATCH',
          'De gevraagde verzendstatus past niet exact bij deze bijlageherstelpoging; de mail is niet verzonden.'
        );
      }
    }
    if (candidates.length > 1) {
      throw createProtocolError(
        'MAILBOX_SEND_DURABLE_STATE_AMBIGUOUS',
        'Meerdere onopgeloste verzendpogingen passen bij deze mail; er is niets opnieuw verzonden.'
      );
    }
    return candidates[0] || null;
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
    function exactField(values) {
      const unique = Array.from(new Set(values.map(normalizeText).filter(Boolean)));
      return { value: unique.length === 1 ? unique[0] : '', conflict: unique.length > 1 };
    }
    const intent = exactField([result?.intentId, sentMessage.softoraSendIntentId]);
    const message = exactField([result?.messageId, sentMessage.messageId]);
    const provider = exactField([result?.providerMessageId, sentMessage.providerMessageId]);
    if (intent.conflict || message.conflict || provider.conflict || !intent.value || (!message.value && !provider.value)) return null;
    const headerIntentId = responseHeader(response, 'X-Softora-Send-Intent-Id');
    const headerMessageId = responseHeader(response, 'X-Softora-Message-Id');
    const headerProviderMessageId = responseHeader(response, 'X-Softora-Provider-Message-Id');
    if (
      headerIntentId && headerIntentId !== intent.value
      || headerMessageId && message.value && headerMessageId !== message.value
      || headerProviderMessageId && provider.value && headerProviderMessageId !== provider.value
    ) return null;
    return { intentId: intent.value, messageId: message.value, providerMessageId: provider.value };
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
      references: normalizeText(context.references),
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
    const expectedScopePrefix = `${expected.provider}-${expected.mode}-scope:`;
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
      && proof.references === expected.references
      && typeof proof.scopeFingerprint === 'string'
      && proof.scopeFingerprint.startsWith(expectedScopePrefix)
      && /^(smtp|instantly)-(reply|new-message)-scope:[0-9a-f]{64}$/.test(proof.scopeFingerprint)
      && typeof proof.requestPayloadFingerprint === 'string'
      && /^[0-9a-f]{64}$/.test(proof.requestPayloadFingerprint)
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
      scopeFingerprint: proof.scopeFingerprint,
      requestPayloadFingerprint: proof.requestPayloadFingerprint,
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
    const comparableExpected = { ...expected };
    delete comparableExpected.references;
    if (Object.keys(comparableExpected).some((key) => comparableExpected[key] !== actual[key])) {
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

  function boundedDeadline(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  async function runWithDeadline(task, config, options = {}) {
    const AbortControllerRef = options.AbortController || global.AbortController;
    const setTimer = options.setTimeout || global.setTimeout;
    const clearTimer = options.clearTimeout || global.clearTimeout;
    if (
      typeof AbortControllerRef !== 'function'
      || typeof setTimer !== 'function'
      || typeof clearTimer !== 'function'
    ) {
      throw createProtocolError(
        'MAILBOX_SEND_DEADLINE_UNAVAILABLE',
        'De browser kan de verzenddeadline niet veilig bewaken; de mail is niet verzonden.',
        { status: 503, retryable: true }
      );
    }
    const controller = new AbortControllerRef();
    const timeoutMs = boundedDeadline(config.timeoutMs, config.fallbackTimeoutMs);
    let timer = null;
    let timeoutError = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimer(() => {
        timeoutError = createProtocolError(config.code, config.message, {
          status: 504,
          retryable: true,
        });
        reject(timeoutError);
        try { controller.abort(); } catch (_) {}
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => task(controller.signal)),
        timeoutPromise,
      ]);
    } catch (error) {
      if (timeoutError) throw timeoutError;
      throw error;
    } finally {
      if (timer !== null) clearTimer(timer);
    }
  }

  function isExactMutableProofRequired(response, data) {
    return response?.status === 409
      && data?.ok === false
      && data?.code === 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED'
      && data?.result === undefined
      && data?.reservationReady === undefined;
  }

  async function runPreflight(
    fetchImpl,
    requestPayload,
    expectedPayload,
    attachmentsMetadata,
    serialize,
    options = {}
  ) {
    return runWithDeadline(async (signal) => {
      const response = await fetchImpl('/api/mailbox/send/preflight', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serialize(requestPayload),
        signal,
      });
      const data = await parseJsonObject(response);
      if (isExactMutableProofRequired(response, data)) {
        throw createProtocolError(
          'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED',
          normalizeText(data.detail) || 'De verzend-ID is nog niet duurzaam geregistreerd.',
          { status: 409, retryable: true }
        );
      }
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
      if (options.proofOnly === true && status === 'ready') {
        throw createProtocolError(
          'MAILBOX_SEND_PROOF_ONLY_READY_FORBIDDEN',
          'Een bewijscontrole zonder actuele mailinhoud mag geen nieuwe verzending vrijgeven.',
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
    }, {
      timeoutMs: options.preflightDeadlineMs,
      fallbackTimeoutMs: PREFLIGHT_DEADLINE_MS,
      code: 'MAILBOX_SEND_PREFLIGHT_TIMEOUT',
      message: 'De veilige mailcontrole duurde te lang; er is niets verzonden.',
    }, options);
  }

  async function runSendRequest(fetchImpl, sendPayload, serialize, options = {}) {
    return runWithDeadline(async (signal) => {
      const response = await fetchImpl('/api/mailbox/send', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serialize(sendPayload),
        signal,
      });
      const data = await parseJsonObject(response);
      if (!responseIsHttp200(response) || data?.ok !== true) {
        throw responseError(response, data, 'Mail verzenden mislukt');
      }
      const result = data?.result && typeof data.result === 'object' ? data.result : {};
      const durableIdentity = extractDurableIdentity(result, response);
      if (!durableIdentity) {
        throw createProtocolError(
          'MAILBOX_SEND_DURABLE_IDENTITY_MISSING',
          'De server bevestigde geen volledige duurzame berichtidentiteit; er is niets automatisch opnieuw verzonden.',
          { status: 409 }
        );
      }
      return { response, data, result, durableIdentity };
    }, {
      timeoutMs: options.sendDeadlineMs,
      fallbackTimeoutMs: SEND_DEADLINE_MS,
      code: 'MAILBOX_SEND_TIMEOUT',
      message: 'De verzendbevestiging duurde te lang; controleer de status voordat je opnieuw probeert.',
    }, options);
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
        && (!metadata.sha256 || attachment?.sha256 === metadata.sha256)
        && (!metadata.sha256 || attachment?.referenceVersion === 2)
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
        || (metadata.sha256 && upload?.sha256 !== metadata.sha256)
        || (metadata.sha256 && upload?.referenceVersion !== 2)
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
        ...(metadata.sha256 ? { sha256: metadata.sha256, referenceVersion: 2 } : {}),
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
      ...(attachment.sha256 ? { sha256: attachment.sha256, referenceVersion: attachment.referenceVersion } : {}),
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

  function markerIsProvenPreDispatch(marker) {
    return PROVEN_PRE_DISPATCH_STATES.has(normalizeText(marker?.state))
      && !Object.prototype.hasOwnProperty.call(marker || {}, 'sendStartedAt');
  }

  function attachmentReselectError() {
    return createProtocolError(
      'MAILBOX_ATTACHMENT_RESELECT_REQUIRED',
      'Kies de bijlagen opnieuw voordat je deze mail veilig verzendt.',
      { status: 409 }
    );
  }

  function rotateToFreshMarker(
    storage,
    marker,
    payloadFingerprint,
    localScopeFingerprint,
    attachmentsMetadata,
    failedRotations,
    input,
    options = {}
  ) {
    if (failedRotations >= MAX_FAILED_KEY_ROTATIONS) {
      throw createProtocolError(
        'MAILBOX_SEND_FAILED_KEY_ROTATION_EXHAUSTED',
        'De eerdere verzending bleef definitief gestopt; er is geen nieuwe mail gestart.',
        { status: 409 }
      );
    }
    const nextKey = `browser:${getRandomToken(options)}`;
    const successor = createMarker(
      nextKey,
      payloadFingerprint,
      localScopeFingerprint,
      attachmentsMetadata,
      options
    );
    input.onIdempotencyKey?.(successor.idempotencyKey);
    patchMarker(storage, marker, { state: 'failed', staging: [] }, options);
    return successor;
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
      const selection = await bindAttachmentSelection(input.attachments, options);
      const { attachments, metadata: attachmentsMetadata, digest: attachmentDigest } = selection;
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
          const missingAttachmentMatch = await findMissingAttachmentMarker(
            storage,
            payloadBase,
            attachmentsMetadata,
            localScopeFingerprint,
            options
          );
          let effectiveAttachmentsMetadata = attachmentsMetadata;
          let effectivePayloadFingerprint = payloadFingerprint;
          let attachmentsUnavailable = false;
          let marker;
          if (missingAttachmentMatch) {
            marker = missingAttachmentMatch.marker;
            effectiveAttachmentsMetadata = missingAttachmentMatch.attachmentsMetadata;
            effectivePayloadFingerprint = marker.payloadFingerprint;
            attachmentsUnavailable = true;
          } else {
            marker = selectMarker(
              storage,
              payloadBase.idempotencyKey,
              payloadFingerprint,
              localScopeFingerprint,
              attachmentsMetadata,
              options
            );
          }
          input.onIdempotencyKey?.(marker.idempotencyKey);
          if (attachmentsUnavailable && !marker.reconcileProof) {
            throw attachmentReselectError();
          }

          let failedRotations = 0;
          let mutablePreflightRequired = false;
          for (;;) {
            const attemptPayload = { ...payloadBase, idempotencyKey: marker.idempotencyKey };
            const hasStoredProof = Boolean(marker.reconcileProof);
            const proofOnly = hasStoredProof && !mutablePreflightRequired;
            const preflightRequest = hasStoredProof
              ? proofOnly
                ? { idempotencyKey: marker.idempotencyKey, reconcileProof: marker.reconcileProof }
                : { ...attemptPayload, reconcileProof: marker.reconcileProof }
              : attemptPayload;
            let preflight;
            try {
              preflight = await runPreflight(
                fetchImpl,
                preflightRequest,
                attemptPayload,
                effectiveAttachmentsMetadata,
                serialize,
                { ...options, proofOnly }
              );
            } catch (error) {
              if (attachmentsUnavailable && error?.code === 'MAILBOX_SEND_PROOF_ONLY_READY_FORBIDDEN') {
                throw attachmentReselectError();
              }
              if (error?.code !== 'MAILBOX_SEND_MUTABLE_PROOF_REQUIRED' || !proofOnly) throw error;
              if (!markerIsProvenPreDispatch(marker)) throw error;
              if (attachmentsUnavailable) throw attachmentReselectError();
              mutablePreflightRequired = true;
              continue;
            }
            mutablePreflightRequired = false;
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
              marker = rotateToFreshMarker(
                storage,
                marker,
                effectivePayloadFingerprint,
                localScopeFingerprint,
                effectiveAttachmentsMetadata,
                failedRotations,
                input,
                options
              );
              failedRotations += 1;
              if (attachmentsUnavailable) throw attachmentReselectError();
              continue;
            }

          if (attachmentsUnavailable) throw attachmentReselectError();

          const provenAttemptPayload = {
            ...attemptPayload,
            reconcileProof: marker.reconcileProof,
          };
          let staging = stagingIsReusable(marker, effectiveAttachmentsMetadata, options)
            ? marker.staging : [];
          if (effectiveAttachmentsMetadata.length && !staging.length) {
            if (typeof input.uploadAttachments !== 'function' || attachments.length !== effectiveAttachmentsMetadata.length || !attachmentDigest) throw attachmentReselectError();
            await attachmentDigest.verify(attachments, effectiveAttachmentsMetadata, { crypto: getCrypto(options) });
            const uploaded = await input.uploadAttachments(attachments, {
              fetch: fetchImpl,
              payload: provenAttemptPayload,
            });
            await attachmentDigest.verify(attachments, effectiveAttachmentsMetadata, { crypto: getCrypto(options) });
            staging = normalizeStaging(uploaded, effectiveAttachmentsMetadata, options);
            marker = patchMarker(storage, marker, { state: 'staged', staging }, options);
          }

          if (!marker.reconcileProof) {
            throw createProtocolError(
              'MAILBOX_SEND_RECONCILE_PROOF_REQUIRED',
              'De daadwerkelijke verzending mist het verplichte preflightbewijs; er is niets verzonden.',
              { status: 409 }
            );
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
          const { response, data, result, durableIdentity } = await runSendRequest(
            fetchImpl,
            sendPayload,
            serialize,
            options
          );
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
