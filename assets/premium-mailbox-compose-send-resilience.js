(function (global) {
  'use strict';
  const sendState = global.SoftoraMailboxComposeSendState || (
    typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./premium-mailbox-compose-send-state') : null);
  if (!sendState) {
    throw new Error('SoftoraMailboxComposeSendState ontbreekt; veilig verzenden is gestopt.');
  }
  const {
    LOCK_NAME,
    MARKER_VERSION,
    MAX_FAILED_KEY_ROTATIONS,
    MIN_STAGING_VALIDITY_MS,
    PREFLIGHT_DEADLINE_MS,
    PROVEN_PRE_DISPATCH_STATES,
    SEND_DEADLINE_MS,
    STORAGE_PREFIX,
    UNRESOLVED_STATES,
    bindAttachmentSelection,
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
    selectMarker,
  } = sendState;
  const PRE_DISPATCH_PROOF_REFRESH_CODES = new Set([
    'MAILBOX_SEND_RECONCILE_PROOF_REQUIRED',
    'MAILBOX_SEND_RECONCILE_PROOF_INVALID',
    'MAILBOX_SEND_RECONCILE_PROOF_SIGNATURE_INVALID',
    'MAILBOX_SEND_RECONCILE_PROOF_SIGNATURE_UNAVAILABLE',
    'MAILBOX_SEND_RECONCILE_PROOF_TIME_INVALID',
    'MAILBOX_SEND_RECONCILE_PROOF_EXPIRED',
    'MAILBOX_SEND_RECONCILE_PROOF_UNAVAILABLE',
  ]);
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
    storage, payload, currentMetadata, localScopeFingerprint, options = {}
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
        candidatePayload, requiredMetadata, options);
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
  function normalizeMessageId(value) {
    const text = normalizeText(value);
    if (!text) return '';
    if (text.startsWith('<') && text.endsWith('>') && /^[^<>\s]+$/.test(text.slice(1, -1))) {
      return text;
    }
    const token = text.replace(/[<>\s]/g, '');
    return token ? `<${token}>` : '';
  }
  function parseReferenceTokens(value) {
    const source = Array.isArray(value) ? value.join(' ') : normalizeText(value);
    return Array.from(new Set(
      (source.match(/<[^<>\s]+>/g) || []).map(normalizeMessageId).filter(Boolean)
    ));
  }
  function reconcileReferencesMatch(proofReferences, expected) {
    if (typeof proofReferences !== 'string') return false;
    if (expected.mode !== 'reply') return proofReferences === '';
    if (expected.provider === 'instantly') {
      return Boolean(expected.replyTargetMessageId)
        && proofReferences === expected.replyTargetMessageId;
    }
    const replyTargetMessageId = normalizeMessageId(expected.replyTargetMessageId);
    const proofTokens = parseReferenceTokens(proofReferences);
    if (
      !replyTargetMessageId
      || proofReferences !== proofTokens.join(' ')
      || proofTokens[proofTokens.length - 1] !== replyTargetMessageId
    ) return false;
    const expectedTokens = parseReferenceTokens(expected.references);
    const targetIndex = expectedTokens.indexOf(replyTargetMessageId);
    if (targetIndex >= 0 && targetIndex !== expectedTokens.length - 1) return false;
    const expectedAncestors = expectedTokens.filter((token) => token !== replyTargetMessageId);
    return expectedAncestors.every((token, index) => proofTokens[index] === token);
  }
  function expectedPreflightScope(payload) {
    const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const replyIdentity = payload?.replyIdentity && typeof payload.replyIdentity === 'object'
      ? payload.replyIdentity : {};
    const provider = normalize(payload?.provider || replyIdentity.provider) || 'smtp';
    const replyTargetMessageId = provider === 'instantly'
      ? normalizeText(
          payload?.providerMessageId
          || replyIdentity.providerMessageId
          || context.providerMessageId
        )
      : normalizeMessageId(replyIdentity.sourceMessageId || context.messageId);
    return {
      owner: normalize(payload?.owner),
      accountEmail: normalize(payload?.account),
      provider,
      mode: normalize(payload?.mode),
      conversationId: normalizeText(replyIdentity.conversationId || context.conversationId),
      replyTargetMessageId,
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
      && reconcileReferencesMatch(proof.references, expected)
      && typeof proof.scopeFingerprint === 'string'
      && proof.scopeFingerprint.startsWith(expectedScopePrefix)
      && /^(smtp|instantly)-(reply|new-message)-scope:[0-9a-f]{64}$/.test(proof.scopeFingerprint)
      && typeof proof.requestPayloadFingerprint === 'string'
      && /^[0-9a-f]{64}$/.test(proof.requestPayloadFingerprint)
      && Number.isSafeInteger(proof.issuedAtMs)
      && Number.isSafeInteger(proof.expiresAtMs)
      && proof.issuedAtMs > 0
      && proof.expiresAtMs > proof.issuedAtMs
      && typeof proof.signature === 'string'
      && /^[0-9a-f]{64}$/.test(proof.signature)
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
      issuedAtMs: proof.issuedAtMs,
      expiresAtMs: proof.expiresAtMs,
      signature: proof.signature,
    };
  }
  function canonicalReconcileProofContent(value, payload, attachmentsMetadata) {
    const proof = value && typeof value === 'object' && !Array.isArray(value)
      ? value : null;
    const normalized = validateReconcileProof({
      ...proof,
      issuedAtMs: 1,
      expiresAtMs: 2,
      signature: '0'.repeat(64),
    }, payload, attachmentsMetadata);
    const {
      issuedAtMs: _issuedAtMs,
      expiresAtMs: _expiresAtMs,
      signature: _signature,
      ...content
    } = normalized;
    return content;
  }
  function reconcileProofContentEqual(left, right, payload, attachmentsMetadata) {
    return JSON.stringify(canonicalReconcileProofContent(
      left,
      payload,
      attachmentsMetadata
    )) === JSON.stringify(canonicalReconcileProofContent(
      right,
      payload,
      attachmentsMetadata
    ));
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
  function serverProvedPreDispatchFailure(response, data) {
    const status = Number(response?.status);
    const hasDurableIdentityHeaders = [
      'X-Softora-Send-Intent-Id',
      'X-Softora-Message-Id',
      'X-Softora-Provider-Message-Id',
    ].some((name) => responseHeader(response, name));
    return Number.isFinite(status)
      && status >= 400
      && status <= 599
      && data?.ok === false
      && data?.externalEffect === false
      && data?.failurePhase === 'pre-dispatch'
      && data?.result === undefined
      && !hasDurableIdentityHeaders;
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
        const error = responseError(response, data, 'Mail verzenden mislukt');
        if (serverProvedPreDispatchFailure(response, data)) {
          error.externalEffect = false;
          error.failurePhase = 'pre-dispatch';
        }
        throw error;
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
    storage, marker, payloadFingerprint, localScopeFingerprint, attachmentsMetadata,
    failedRotations, input, options = {}
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
          let preDispatchProofRefreshes = 0;
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
              && !reconcileProofContentEqual(
                marker.reconcileProof,
                preflight.reconcileProof,
                attemptPayload,
                effectiveAttachmentsMetadata
              )
            ) {
              throw createProtocolError(
                'MAILBOX_SEND_RECONCILE_PROOF_MISMATCH',
                'De inhoud van het duurzame verzendbewijs is gewijzigd; er is niets opnieuw verzonden.'
              );
            }
            if (
              !marker.reconcileProof
              || JSON.stringify(marker.reconcileProof) !== JSON.stringify(preflight.reconcileProof)
            ) {
              marker = patchMarker(
                storage,
                marker,
                { reconcileProof: preflight.reconcileProof },
                options
              );
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
          let sendExecution;
          try {
            sendExecution = await runSendRequest(
              fetchImpl,
              sendPayload,
              serialize,
              options
            );
          } catch (error) {
            if (error?.externalEffect === false && error?.failurePhase === 'pre-dispatch') {
              const shouldRefreshProof = PRE_DISPATCH_PROOF_REFRESH_CODES.has(
                normalizeText(error?.code).toUpperCase()
              ) && preDispatchProofRefreshes < 1;
              marker = patchMarker(storage, marker, {
                state: staging.length ? 'staged' : 'armed',
                sendStartedAt: undefined,
                reconcileProof: null,
              }, options);
              if (shouldRefreshProof) {
                preDispatchProofRefreshes += 1;
                continue;
              }
            }
            throw error;
          }
          const { response, data, result, durableIdentity } = sendExecution;
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
