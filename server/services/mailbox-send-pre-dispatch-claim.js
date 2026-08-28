const MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS = 15 * 60 * 1000;
const MAILBOX_SEND_PRE_DISPATCH_CLAIM_MIN_LEASE_MS = 15 * 60 * 1000;
const MAILBOX_SEND_PRE_DISPATCH_CLAIM_MAX_LEASE_MS = 60 * 60 * 1000;

function createMailboxSendPreDispatchClaim(deps = {}) {
  const {
    assertPreparedRow,
    buildPreparedRow,
    createAttachmentsMetadataFromContent,
    createCanonicalHash,
    createClaimAttachmentsFingerprint,
    createRequestPayloadFingerprint,
    createTransitionToken,
    exactReservedCasFilters,
    exactStartedCasFilters,
    finalizePreDispatchClaimAtomically,
    mailboxAttachmentsMetadataEqual,
    normalizeAttachmentsMetadata,
    normalizeRow,
    normalizeString,
    now,
    preDispatchClaimLeaseMs = MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS,
    reservePreparedRow,
    startPreDispatchAtomically,
    updateIntent,
    logger = console,
  } = deps;

  function getClaimLeaseMs() {
    return Math.max(
      MAILBOX_SEND_PRE_DISPATCH_CLAIM_MIN_LEASE_MS,
      Math.min(
        MAILBOX_SEND_PRE_DISPATCH_CLAIM_MAX_LEASE_MS,
        Number(preDispatchClaimLeaseMs) || MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS
      )
    );
  }

  function createClaimError(code, message, status = 409) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  function createRequiredToken(label, previousToken = '') {
    const token = normalizeString(createTransitionToken());
    const previous = normalizeString(previousToken);
    if (token && (!previous || token !== previous)) return token;
    throw createClaimError(
      'MAILBOX_SEND_PROVENANCE_UPDATE_FAILED',
      token
        ? `Threadregistratie kon niet als ${label} worden voorbereid omdat het fasetoken niet roteerde.`
        : `Threadregistratie kon niet als ${label} worden voorbereid.`,
      503
    );
  }

  function createClaimFingerprint(intent) {
    const metadata = normalizeAttachmentsMetadata(intent?.attachmentsMetadata);
    if (metadata === null) return '';
    return createCanonicalHash([
      'mailbox-pre-dispatch-claim-v1',
      intent?.intentId,
      intent?.idempotencyKey,
      intent?.sendIdentityKey,
      intent?.sendScopeKey,
      intent?.payloadFingerprint,
      intent?.attachmentsFingerprint,
      intent?.requestPayloadFingerprint,
      intent?.owner,
      intent?.accountEmail,
      intent?.recipientEmail,
      intent?.mode,
      intent?.conversationId,
      intent?.replyTargetMessageId,
      intent?.references,
      intent?.provider,
      intent?.providerThreadId,
      intent?.messageId,
      intent?.senderName,
      intent?.subject,
      intent?.body,
      intent?.cc,
      intent?.bcc,
      JSON.stringify(metadata),
    ]);
  }

  function claimMetadata(input = {}) {
    const metadata = input.attachmentsMetadata === undefined
      ? createAttachmentsMetadataFromContent(input.attachments)
      : normalizeAttachmentsMetadata(input.attachmentsMetadata);
    if (metadata === null) return null;
    if (metadata.length === 0) return metadata;
    return metadata.every((attachment) => (
      /^[0-9a-f]{64}$/.test(String(attachment?.sha256 || ''))
    )) ? metadata : null;
  }

  function buildClaimRow(input = {}) {
    const attachmentsMetadata = claimMetadata(input);
    if (attachmentsMetadata === null) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_ATTACHMENT_CONTEXT_REQUIRED',
        'De vroege verzendclaim mist exacte bijlagemetadata.'
      );
    }
    const requestBody = input.requestBody === undefined ? input.body : input.requestBody;
    const row = buildPreparedRow({
      ...input,
      body: requestBody,
      requestBody,
      attachments: [],
      attachmentsFingerprint: createClaimAttachmentsFingerprint(attachmentsMetadata),
      attachmentsMetadata,
      requestPayloadFingerprint: createRequestPayloadFingerprint({
        ...input,
        requestBody,
        attachmentsMetadata,
      }, normalizeString),
    });
    assertPreparedRow(row);
    row.pre_dispatch_claim_fingerprint = createClaimFingerprint(normalizeRow(row));
    if (!row.pre_dispatch_claim_fingerprint) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_CLAIM_INVALID',
        'De vroege verzendclaim kon niet volledig worden gebonden.'
      );
    }
    return row;
  }

  function normalizeHandle(handle, expectedPhase = '') {
    const intent = handle?.intent && typeof handle.intent === 'object' ? handle.intent : null;
    const token = expectedPhase === 'claim'
      ? normalizeString(handle?.claimToken)
      : expectedPhase === 'final'
        ? normalizeString(handle?.finalToken)
        : normalizeString(handle?.finalToken || handle?.claimToken);
    const finalized = Boolean(normalizeString(intent?.preDispatchFinalizedAt));
    const phaseMatches = !expectedPhase
      || (expectedPhase === 'claim' && !finalized)
      || (expectedPhase === 'final' && finalized);
    if (!intent?.intentId || !token || token !== normalizeString(intent.transitionToken)
      || !normalizeString(intent.preDispatchClaimFingerprint) || !phaseMatches) {
      throw createClaimError(
        expectedPhase === 'final'
          ? 'MAILBOX_SEND_FINAL_TOKEN_REQUIRED'
          : 'MAILBOX_SEND_PRE_DISPATCH_CLAIM_MISMATCH',
        expectedPhase === 'final'
          ? 'Providerdispatch vereist het exacte definitieve claimtoken.'
          : 'De pre-dispatchclaim is verouderd of onvolledig; verzending is veilig gestopt.'
      );
    }
    if (expectedPhase === 'claim'
      && createClaimFingerprint(intent) !== intent.preDispatchClaimFingerprint) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_CLAIM_MISMATCH',
        'De inhoud van de vroege verzendclaim is gewijzigd; verzending is veilig gestopt.'
      );
    }
    return { intent, finalized };
  }

  function buildFinalRow(claimIntent, input = {}) {
    const attachmentsMetadata = claimMetadata(input);
    if (attachmentsMetadata === null) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_FINALIZE_MISMATCH',
        'De definitieve bijlagemetadata ontbreekt of is gewijzigd.'
      );
    }
    const requestBody = input.requestBody === undefined ? input.body : input.requestBody;
    const row = buildPreparedRow({
      ...input,
      requestBody,
      attachmentsMetadata,
      requestPayloadFingerprint: createRequestPayloadFingerprint({
        ...input,
        requestBody,
        attachmentsMetadata,
      }, normalizeString),
      preDispatchClaimFingerprint: claimIntent.preDispatchClaimFingerprint,
    });
    assertPreparedRow(row);
    return row;
  }

  function assertFinalContext(claimIntent, finalRow) {
    const finalIntent = normalizeRow(finalRow);
    const immutableFields = [
      'intentId', 'idempotencyKey', 'sendScopeKey', 'owner', 'accountEmail', 'recipientEmail',
      'mode', 'conversationId', 'replyTargetMessageId', 'references', 'provider',
      'providerThreadId', 'messageId', 'senderName', 'subject', 'cc', 'bcc',
      'preDispatchClaimFingerprint',
    ];
    const exactContext = immutableFields.every((field) => claimIntent?.[field] === finalIntent[field]);
    const exactRequest = /^[0-9a-f]{64}$/.test(finalIntent.requestPayloadFingerprint)
      && claimIntent?.requestPayloadFingerprint === finalIntent.requestPayloadFingerprint
      && mailboxAttachmentsMetadataEqual(claimIntent?.attachmentsMetadata, finalIntent.attachmentsMetadata);
    if (exactContext && exactRequest) return finalIntent;
    throw createClaimError(
      'MAILBOX_SEND_PRE_DISPATCH_FINALIZE_MISMATCH',
      'De definitieve mailinhoud, bijlagen of mailboxcontext wijken af van de vroege verzendclaim.'
    );
  }

  async function claimPreDispatch(input = {}) {
    const claimed = await reservePreparedRow(buildClaimRow(input), {
      databaseClockClaim: true,
      leaseMs: getClaimLeaseMs(),
      renewExpired: false,
    });
    if (!claimed.created) return claimed;
    const claimToken = normalizeString(claimed.intent?.transitionToken);
    if (!claimToken || claimed.intent?.preDispatchFinalizedAt
      || claimed.intent?.preDispatchClaimFingerprint !== createClaimFingerprint(claimed.intent)) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_CLAIM_INVALID',
        'De vroege verzendclaim kon niet duurzaam worden bevestigd.',
        503
      );
    }
    return { ...claimed, claimToken };
  }

  async function finalizeClaim(handle, input = {}) {
    const { intent: claimIntent } = normalizeHandle(handle, 'claim');
    const finalIntent = assertFinalContext(claimIntent, buildFinalRow(claimIntent, input));
    const finalToken = createRequiredToken('definitief voorbereid', claimIntent.transitionToken);
    const finalized = await finalizePreDispatchClaimAtomically(claimIntent, finalIntent, {
      transitionToken: finalToken,
      leaseMs: getClaimLeaseMs(),
    });
    return { intent: finalized, finalToken };
  }

  async function failPreDispatch(handle, errorValue) {
    const { intent } = normalizeHandle(handle);
    const dispatchState = normalizeString(intent.dispatchState).toLowerCase();
    const filters = dispatchState === 'started'
      ? exactStartedCasFilters(intent)
      : dispatchState === 'reserved'
        ? exactReservedCasFilters(intent)
        : null;
    if (!filters) {
      throw createClaimError(
        'MAILBOX_SEND_PRE_DISPATCH_CLAIM_MISMATCH',
        'De pre-dispatchclaim staat niet meer in een veilig afbreekbare fase.'
      );
    }
    try {
      return await updateIntent(intent.intentId, {
        status: 'failed',
        dispatch_state: 'finished',
        dispatch_lease_expires_at: null,
        error_text: normalizeString(errorValue && (errorValue.message || errorValue)).slice(0, 1000)
          || 'Verzending stopte veilig vóór providerdispatch',
      }, 'vóór providerdispatch mislukt', filters, {
        transitionToken: createRequiredToken('veilig gestopt', intent.transitionToken),
      });
    } catch (error) {
      logger.error('[MailboxSendProvenance][FailPreDispatch]', error?.message || error);
      throw error;
    }
  }

  async function startDispatch(handle, leaseMs = 120_000) {
    if (typeof handle === 'string') {
      const intentId = normalizeString(handle);
      const startedAt = now();
      return updateIntent(intentId, {
        dispatch_state: 'started',
        dispatch_started_at: startedAt.toISOString(),
        dispatch_lease_expires_at: new Date(
          startedAt.getTime() + Math.max(30_000, Number(leaseMs) || 120_000)
        ).toISOString(),
      }, 'gestart', {
        statuses: ['prepared'],
        dispatchState: 'reserved',
        nulls: ['pre_dispatch_claim_fingerprint', 'pre_dispatch_finalized_at'],
      });
    }
    const { intent } = normalizeHandle(handle, 'final');
    return startPreDispatchAtomically(intent, {
      transitionToken: createRequiredToken('providerstart', intent.transitionToken),
      leaseMs: Math.max(30_000, Math.min(900_000, Number(leaseMs) || 120_000)),
    });
  }

  return { claimPreDispatch, failPreDispatch, finalizeClaim, startDispatch };
}

module.exports = {
  MAILBOX_SEND_PRE_DISPATCH_CLAIM_LEASE_MS,
  MAILBOX_SEND_PRE_DISPATCH_CLAIM_MAX_LEASE_MS,
  MAILBOX_SEND_PRE_DISPATCH_CLAIM_MIN_LEASE_MS,
  createMailboxSendPreDispatchClaim,
};
