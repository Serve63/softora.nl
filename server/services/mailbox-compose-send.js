const {
  MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
  renderMailboxComposeEmailHtml,
} = require('./mailbox-compose-email-renderer');
const {
  createMailboxAttachmentsFingerprint,
  createMailboxPayloadFingerprint,
  createMailboxRequestPayloadFingerprint,
  createMailboxReconcileRequiredError,
  isAmbiguousMailboxProviderError,
  isExpiredMailboxReservedDispatch,
  mailboxAttachmentsMetadataEqual,
  normalizeMailboxAttachmentsMetadata,
} = require('./mailbox-send-provenance-store');
const {
  assertOutboundRecipientsNotSuppressed,
} = require('../security/outbound-mail-suppression');
const {
  MAILBOX_ATTACHMENT_EXTENSIONS,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS,
  MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES,
  normalizeContentType,
  safeFilename,
} = require('./mailbox-attachment-policy');

const MAX_COMPOSE_ATTACHMENTS = MAX_MAILBOX_ATTACHMENTS;
const MAX_COMPOSE_ATTACHMENT_BYTES = MAX_MAILBOX_ATTACHMENT_BYTES;
const MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES = MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES;
const COMPOSE_ATTACHMENT_EXTENSIONS = MAILBOX_ATTACHMENT_EXTENSIONS;

function createMailboxComposeSend(deps = {}) {
  const {
    getAccount,
    isValidEmail,
    normalizeEmail,
    normalizeString,
    truncateText,
    createTransport,
    buildMailboxWebdesignSendParts,
    reserveMailboxWebdesignOutboundRecipient,
    confirmMailboxWebdesignOutboundRecipient,
    appendSentMessage,
    createImapClient,
    nodemailer,
    webdesignEmailTemplateVersion,
    mailboxSendProvenanceStore,
    outboundRecipientGuardStore,
    mailboxAttachmentService,
    logger = console,
    now = () => new Date(),
  } = deps;

  async function acceptProvenanceWithRetry(intentId, values) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await mailboxSendProvenanceStore.accept(intentId, values);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function normalizeRecipientList(value, label) {
    const values = (Array.isArray(value) ? value : String(value || '').split(/[;,]/))
      .map(normalizeEmail)
      .filter(Boolean);
    if (values.length > 10) {
      const error = new Error(`${label} ondersteunt maximaal 10 ontvangers.`);
      error.status = 400;
      throw error;
    }
    if (values.some((email) => !isValidEmail(email))) {
      const error = new Error(`Controleer de e-mailadressen bij ${label}.`);
      error.status = 400;
      throw error;
    }
    return Array.from(new Set(values));
  }

  async function normalizeComposeAttachments(value, threadProvenance) {
    const attachments = Array.isArray(value) ? value : [];
    if (attachments.length > MAX_COMPOSE_ATTACHMENTS) {
      const error = new Error(`Je kunt maximaal ${MAX_COMPOSE_ATTACHMENTS} bijlagen toevoegen.`);
      error.status = 400;
      throw error;
    }
    const hasReferences = attachments.some((attachment) => normalizeString(attachment?.reference));
    if (hasReferences) {
      if (!attachments.every((attachment) => normalizeString(attachment?.reference))) {
        const error = new Error('Kies de bijlagen opnieuw; gemengde bijlagegegevens zijn niet veilig.');
        error.status = 400;
        error.code = 'MAILBOX_ATTACHMENT_REFERENCE_INVALID';
        throw error;
      }
      if (!mailboxAttachmentService || typeof mailboxAttachmentService.downloadAttachments !== 'function') {
        const error = new Error('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.');
        error.status = 503;
        error.code = 'MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE';
        throw error;
      }
      return mailboxAttachmentService.downloadAttachments(attachments, threadProvenance);
    }
    let totalBytes = 0;
    return attachments.map((attachment) => {
      const rawName = safeFilename(attachment && (attachment.filename || attachment.name));
      const extension = rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : '';
      if (!rawName || !COMPOSE_ATTACHMENT_EXTENSIONS.has(extension)) {
        const error = new Error(`Bijlage "${rawName || 'zonder naam'}" heeft geen ondersteund bestandstype.`);
        error.status = 400;
        throw error;
      }
      const encoded = normalizeString(attachment && (attachment.contentBase64 || attachment.data))
        .replace(/^data:[^;,]+;base64,/i, '')
        .replace(/\s+/g, '');
      if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
        const error = new Error(`Bijlage "${rawName}" kon niet veilig worden gelezen.`);
        error.status = 400;
        throw error;
      }
      const content = Buffer.from(encoded, 'base64');
      if (!content.length || content.length > MAX_COMPOSE_ATTACHMENT_BYTES) {
        const error = new Error(`Bijlage "${rawName}" mag maximaal 4 MB zijn.`);
        error.status = 400;
        throw error;
      }
      totalBytes += content.length;
      if (totalBytes > MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES) {
        const error = new Error('De bijlagen mogen samen maximaal 5 MB zijn.');
        error.status = 400;
        throw error;
      }
      return {
        filename: rawName,
        content,
        contentType: normalizeContentType(attachment && attachment.contentType, rawName),
        contentDisposition: 'attachment',
      };
    });
  }

  async function cleanupUploadedAttachments(attachments, threadProvenance) {
    const references = (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => normalizeString(attachment?.reference));
    if (!references.length || !mailboxAttachmentService || typeof mailboxAttachmentService.cleanupAttachments !== 'function') return;
    await mailboxAttachmentService.cleanupAttachments(references, threadProvenance);
  }

  function createCombinedAttachmentLimitError(message, code = 'MAILBOX_ATTACHMENT_COMBINED_LIMIT') {
    const error = new Error(
      `Automatische webdesignafbeeldingen en handmatige bijlagen tellen samen mee. ${message}`
    );
    error.status = 400;
    error.code = code;
    return error;
  }

  function assertCombinedAttachmentLimits(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_COMPOSE_ATTACHMENTS) {
      throw createCombinedAttachmentLimitError(
        `Je kunt samen maximaal ${MAX_COMPOSE_ATTACHMENTS} bijlagen versturen.`
      );
    }
    let totalBytes = 0;
    for (const attachment of list) {
      const filename = normalizeString(attachment?.filename || attachment?.name) || 'zonder naam';
      if (!Buffer.isBuffer(attachment?.content) || !attachment.content.length) {
        throw createCombinedAttachmentLimitError(
          `Bijlage "${filename}" kon niet veilig worden gemeten.`,
          'MAILBOX_ATTACHMENT_COMBINED_INVALID'
        );
      }
      const size = attachment.content.length;
      if (size > MAX_COMPOSE_ATTACHMENT_BYTES) {
        throw createCombinedAttachmentLimitError(`Bijlage "${filename}" mag maximaal 4 MB zijn.`);
      }
      totalBytes += size;
      if (totalBytes > MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES) {
        throw createCombinedAttachmentLimitError('De bijlagen mogen samen maximaal 5 MB zijn.');
      }
    }
  }

  function normalizeProviderRecipients(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((recipient) => normalizeEmail(
        recipient && typeof recipient === 'object' ? recipient.address : recipient
      ))
      .filter(Boolean)));
  }

  function createPrimaryRecipientNotAcceptedError(info, recipientEmail) {
    const accepted = normalizeProviderRecipients(info?.accepted);
    const rejected = normalizeProviderRecipients(info?.rejected);
    const error = new Error([
      `De SMTP-provider accepteerde de primaire ontvanger ${recipientEmail} niet.`,
      `Geaccepteerd: ${accepted.join(', ') || 'geen'}.`,
      `Afgewezen: ${rejected.join(', ') || 'geen'}.`,
    ].join(' '));
    error.status = 409;
    error.code = 'MAILBOX_PRIMARY_RECIPIENT_NOT_ACCEPTED';
    error.accepted = accepted;
    error.rejected = rejected;
    return error;
  }

  function assertAcceptedReplayContext(accepted, threadProvenance, accountEmail, recipientEmail) {
    const normalizeProvider = (value) => normalizeString(value || 'smtp').toLowerCase();
    const normalizedAccount = normalizeEmail(accountEmail);
    const normalizedRecipient = normalizeEmail(recipientEmail);
    const matches = accepted
      && accepted.idempotencyKey === normalizeString(threadProvenance.idempotencyKey)
      && accepted.owner === normalizeString(threadProvenance.owner).toLowerCase()
      && accepted.accountEmail === normalizedAccount
      && accepted.recipientEmail === normalizedRecipient
      && normalizeEmail(threadProvenance.accountEmail) === normalizedAccount
      && normalizeEmail(threadProvenance.recipientEmail) === normalizedRecipient
      && accepted.mode === normalizeString(threadProvenance.mode).toLowerCase()
      && accepted.conversationId === normalizeString(threadProvenance.conversationId)
      && accepted.replyTargetMessageId === normalizeString(threadProvenance.replyTargetMessageId)
      && accepted.references === normalizeString(threadProvenance.references)
      && normalizeProvider(accepted.provider) === normalizeProvider(threadProvenance.provider)
      && accepted.providerThreadId === normalizeString(threadProvenance.providerThreadId);
    if (matches) return;
    const error = new Error('De veilige verzend-ID hoort bij een andere mailbox- of threadcontext.');
    error.status = 409;
    error.code = 'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH';
    throw error;
  }

  function createAcceptedReplayPayloadMismatchError() {
    const error = new Error(
      'De veilige verzend-ID hoort bij andere mailinhoud of bijlagen; open de mail opnieuw voordat je opnieuw verzendt.'
    );
    error.status = 409;
    error.code = 'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH';
    return error;
  }

  function createAcceptedReplayAttachmentEvidenceError() {
    const cause = new Error(
      'De eerdere verzending bevat geen duurzaam bewijs of handmatige bijlagen aanwezig waren.'
    );
    cause.code = 'MAILBOX_SEND_ATTACHMENT_EVIDENCE_MISSING';
    return createMailboxReconcileRequiredError(cause);
  }

  function assertAcceptedReplayPayload(accepted, payload) {
    const durableMetadata = normalizeMailboxAttachmentsMetadata(accepted?.attachmentsMetadata);
    const requestedMetadata = normalizeMailboxAttachmentsMetadata(payload?.attachmentsMetadata);
    if (durableMetadata === null) throw createAcceptedReplayAttachmentEvidenceError();
    if (requestedMetadata === null) throw createAcceptedReplayPayloadMismatchError();

    const durableRequestPayloadFingerprint = normalizeString(
      accepted?.requestPayloadFingerprint
    ).toLowerCase();
    const requestedRequestPayloadFingerprint = createMailboxRequestPayloadFingerprint(
      { ...payload, attachmentsMetadata: requestedMetadata },
      normalizeString
    );
    if (/^[0-9a-f]{64}$/.test(durableRequestPayloadFingerprint)) {
      if (requestedRequestPayloadFingerprint === durableRequestPayloadFingerprint) return;
      throw createAcceptedReplayPayloadMismatchError();
    }

    const durablePayloadFingerprint = normalizeString(accepted?.payloadFingerprint).toLowerCase();
    const durableAttachmentsFingerprint = normalizeString(accepted?.attachmentsFingerprint).toLowerCase();
    const durableFieldsFingerprint = createMailboxPayloadFingerprint({
      subject: accepted?.subject,
      body: accepted?.body,
      cc: accepted?.cc,
      bcc: accepted?.bcc,
      attachmentsFingerprint: durableAttachmentsFingerprint,
    }, normalizeString);
    const storedPayloadIsIntact = /^[0-9a-f]{64}$/.test(durablePayloadFingerprint)
      && (!durableAttachmentsFingerprint || /^[0-9a-f]{64}$/.test(durableAttachmentsFingerprint))
      && durablePayloadFingerprint === durableFieldsFingerprint;
    const fieldsMatch = normalizeString(accepted?.subject) === normalizeString(payload?.subject)
      && normalizeString(accepted?.body) === normalizeString(payload?.body)
      && normalizeString(accepted?.cc).toLowerCase() === normalizeString(payload?.cc).toLowerCase()
      && normalizeString(accepted?.bcc).toLowerCase() === normalizeString(payload?.bcc).toLowerCase();
    const matches = storedPayloadIsIntact && fieldsMatch
      && mailboxAttachmentsMetadataEqual(durableMetadata, requestedMetadata);
    if (matches) return;
    throw createAcceptedReplayPayloadMismatchError();
  }

  function createAcceptedReplayResult(accepted) {
    const attachmentMetadata = normalizeMailboxAttachmentsMetadata(accepted?.attachmentsMetadata);
    if (attachmentMetadata === null) throw createAcceptedReplayAttachmentEvidenceError();
    return {
      messageId: accepted.messageId,
      accepted: [accepted.recipientEmail],
      rejected: [],
      sentCopySaved: true,
      intentId: accepted.intentId,
      idempotentReplay: true,
      sentMessage: {
        id: `accepted-sent:${accepted.messageId || accepted.intentId}`,
        mailboxId: `accepted-sent:${accepted.messageId || accepted.intentId}`,
        folder: 'sent',
        storageFolder: 'sent',
        direction: 'sent',
        accountEmail: accepted.accountEmail,
        messageId: accepted.messageId,
        from: accepted.senderName || accepted.accountEmail,
        email: accepted.accountEmail,
        to: accepted.recipientEmail,
        toDisplay: accepted.recipientEmail,
        cc: accepted.cc,
        bcc: accepted.bcc,
        recipientRoutingEvidenceKnown: true,
        subject: accepted.subject,
        body: accepted.body,
        preview: accepted.body,
        receivedAt: accepted.acceptedAt,
        activityAt: accepted.acceptedAt,
        hasBody: true,
        bodyTruncated: false,
        unread: false,
        attachments: attachmentMetadata,
        attachmentEvidenceKnown: true,
        attachmentHydrationAttempted: true,
        conversationId: accepted.conversationId,
        softoraSendIntentId: accepted.intentId,
        softoraSendMode: accepted.mode,
        softoraReplyTargetMessageId: accepted.replyTargetMessageId,
      },
    };
  }

  return async function sendMessage({ accountEmail, to, cc, bcc, subject, text, attachments, threadProvenance }) {
    let stagedAttachmentCleanupStarted = false;
    async function cleanupStagedAttachments() {
      if (stagedAttachmentCleanupStarted) return;
      stagedAttachmentCleanupStarted = true;
      await cleanupUploadedAttachments(attachments, threadProvenance).catch((error) => {
        logger.warn('[MailboxAttachment][CleanupAfterSendLifecycle]', error?.message || error);
      });
    }

    const account = getAccount(accountEmail);
    if (!account) {
      const error = new Error('Mailbox-account niet gevonden.');
      error.status = 404;
      throw error;
    }
    if (account.smtpIdentityMatches === false) {
      const error = new Error('De SMTP-login hoort niet bij het gekozen afzenderadres. Verzending is geblokkeerd.');
      error.status = 503;
      error.code = 'SENDER_SMTP_IDENTITY_MISMATCH';
      throw error;
    }
    if (!account.smtpConfigured) {
      const error = new Error('SMTP is niet geconfigureerd voor deze mailbox.');
      error.status = 503;
      throw error;
    }
    if (!isValidEmail(to)) {
      const error = new Error('Vul een geldig e-mailadres in.');
      error.status = 400;
      throw error;
    }
    const normalizedTo = normalizeEmail(to);
    const normalizedCc = normalizeRecipientList(cc, 'CC');
    const normalizedBcc = normalizeRecipientList(bcc, 'BCC');
    const duplicateRecipient = [...normalizedCc, ...normalizedBcc]
      .find((email, index, recipients) => email === normalizedTo || recipients.indexOf(email) !== index);
    if (duplicateRecipient) {
      const error = new Error(`Ontvanger ${duplicateRecipient} staat meer dan één keer bij Aan, CC of BCC.`);
      error.status = 400;
      throw error;
    }
    if (!threadProvenance || !mailboxSendProvenanceStore
      || typeof mailboxSendProvenanceStore.findByIdempotencyKey !== 'function') {
      const error = new Error('De duurzame threadcontext ontbreekt; verzending is veilig gestopt.');
      error.status = 503;
      error.code = 'MAILBOX_SEND_PROVENANCE_REQUIRED';
      throw error;
    }
    const cleanSubject = truncateText(normalizeString(subject), 240);
    if (!cleanSubject) {
      const error = new Error('Onderwerp is verplicht.');
      error.status = 400;
      throw error;
    }
    const normalizedText = normalizeString(text);
    const normalizedCcText = normalizedCc.join(', ');
    const normalizedBccText = normalizedBcc.join(', ');
    const attachmentInputs = Array.isArray(attachments) ? attachments : [];
    const referenceCount = attachmentInputs.filter((attachment) => (
      normalizeString(attachment?.reference)
    )).length;
    if (referenceCount > 0 && referenceCount !== attachmentInputs.length) {
      const error = new Error('Kies de bijlagen opnieuw; gemengde bijlagegegevens zijn niet veilig.');
      error.status = 400;
      error.code = 'MAILBOX_ATTACHMENT_REFERENCE_INVALID';
      throw error;
    }

    let explicitAttachments = null;
    let explicitAttachmentMetadata = null;
    if (referenceCount > 0) {
      if (!mailboxAttachmentService || typeof mailboxAttachmentService.inspectAttachments !== 'function') {
        const error = new Error('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.');
        error.status = 503;
        error.code = 'MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE';
        throw error;
      }
      explicitAttachmentMetadata = normalizeMailboxAttachmentsMetadata(
        await mailboxAttachmentService.inspectAttachments(
          attachmentInputs,
          threadProvenance,
          { allowExpired: true }
        )
      );
    } else {
      explicitAttachments = await normalizeComposeAttachments(attachmentInputs, threadProvenance);
      explicitAttachmentMetadata = normalizeMailboxAttachmentsMetadata(
        explicitAttachments.map((attachment) => ({
          filename: normalizeString(attachment?.filename),
          contentType: truncateText(normalizeString(attachment?.contentType), 120),
          size: Buffer.isBuffer(attachment?.content) ? attachment.content.length : 0,
        }))
      );
    }
    if (explicitAttachmentMetadata === null) {
      const error = new Error('De bijlagemetadata kon niet veilig worden vastgesteld.');
      error.status = 400;
      error.code = 'MAILBOX_ATTACHMENT_METADATA_INVALID';
      throw error;
    }

    const requestPayload = {
      subject: cleanSubject,
      body: normalizedText,
      requestBody: normalizedText,
      cc: normalizedCcText,
      bcc: normalizedBccText,
      attachmentsMetadata: explicitAttachmentMetadata,
    };
    function processingError() {
      const error = new Error('Deze verzending wordt al veilig verwerkt; wacht op bevestiging voordat je opnieuw probeert.');
      error.status = 409;
      error.code = 'MAILBOX_SEND_ALREADY_PROCESSING';
      return error;
    }
    function previousFailedError() {
      const error = new Error('De vorige verzendpoging is definitief gestopt; probeer opnieuw met een nieuwe veilige verzend-ID.');
      error.status = 409;
      error.code = 'MAILBOX_SEND_PREVIOUSLY_FAILED';
      error.retryable = false;
      return error;
    }
    function uncertainDispatchError(intent) {
      const cause = new Error('Deze verzend-ID heeft een providerdispatch zonder duurzaam bevestigde eindstatus.');
      cause.code = 'MAILBOX_SEND_DISPATCH_OUTCOME_UNCERTAIN';
      cause.intentId = intent?.intentId;
      return createMailboxReconcileRequiredError(cause);
    }
    function preparedReservationExpired(intent) {
      if (typeof mailboxSendProvenanceStore.isExpiredReservedDispatch === 'function') {
        return mailboxSendProvenanceStore.isExpiredReservedDispatch(intent);
      }
      return isExpiredMailboxReservedDispatch(intent, {
        normalizeString,
        nowMs: now().getTime(),
      });
    }
    async function handleExistingIntent(intent) {
      if (!intent) return null;
      assertAcceptedReplayContext(intent, threadProvenance, account.email, normalizedTo);
      if (intent.status === 'accepted') {
        assertAcceptedReplayPayload(intent, requestPayload);
        await cleanupStagedAttachments();
        return createAcceptedReplayResult(intent);
      }
      if (intent.status === 'failed') {
        await cleanupStagedAttachments();
        throw previousFailedError();
      }
      if (intent.status === 'unknown' || intent.reconcileRequired === true
        || (intent.status === 'prepared' && intent.dispatchState === 'started')) {
        throw uncertainDispatchError(intent);
      }
      if (preparedReservationExpired(intent)) return null;
      throw processingError();
    }

    async function findExistingIntent() {
      try {
        return await mailboxSendProvenanceStore.findByIdempotencyKey(
          threadProvenance.idempotencyKey
        );
      } catch (error) {
        error.status = Number(error.status) || 503;
        error.code = normalizeString(error.code) || 'MAILBOX_SEND_PROVENANCE_READ_FAILED';
        throw error;
      }
    }

    const existingIntent = await findExistingIntent();
    const earlyReplay = await handleExistingIntent(existingIntent);
    if (earlyReplay) return earlyReplay;

    const webdesignParts = await buildMailboxWebdesignSendParts({
      accountEmail: account.email,
      to: normalizedTo,
      subject: cleanSubject,
      text: normalizedText,
    });
    if (explicitAttachments === null) {
      try {
        explicitAttachments = await normalizeComposeAttachments(attachmentInputs, threadProvenance);
      } catch (error) {
        const acceptedAfterStorageFailure = await findExistingIntent();
        const replayAfterStorageFailure = await handleExistingIntent(acceptedAfterStorageFailure);
        if (replayAfterStorageFailure) return replayAfterStorageFailure;
        throw error;
      }
    }
    const outboundAttachments = [
      ...(Array.isArray(webdesignParts?.attachments) ? webdesignParts.attachments : []),
      ...explicitAttachments,
    ];
    try {
      assertCombinedAttachmentLimits(outboundAttachments);
    } catch (error) {
      await cleanupStagedAttachments();
      throw error;
    }
    await assertOutboundRecipientsNotSuppressed({
      outboundRecipientGuardStore,
      identities: [
        { ...(webdesignParts?.outboundIdentity || {}), recipientEmail: normalizedTo },
        ...normalizedCc.map((recipientEmail) => ({ recipientEmail })),
        ...normalizedBcc.map((recipientEmail) => ({ recipientEmail })),
      ],
      channel: 'softora-mailbox',
    });
    const mail = {
      from: account.name ? `${account.name} <${account.email}>` : account.email,
      to: normalizedTo,
      cc: normalizedCc.length ? normalizedCc : undefined,
      bcc: normalizedBcc.length ? normalizedBcc : undefined,
      subject: cleanSubject,
      text: webdesignParts?.text || normalizedText,
      messageId: threadProvenance.messageId,
    };
    if (threadProvenance.mode === 'reply') {
      mail.inReplyTo = threadProvenance.replyTargetMessageId;
      mail.references = threadProvenance.references;
    }
    mail.html = webdesignParts?.html || renderMailboxComposeEmailHtml(normalizedText);
    mail.headers = {
      'X-Softora-Template-Version': webdesignParts
        ? webdesignEmailTemplateVersion
        : MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
      'X-Softora-Send-Intent-Id': threadProvenance.intentId,
      'X-Softora-Send-Mode': threadProvenance.mode,
      'X-Softora-Conversation-Id': threadProvenance.conversationId || '',
      'X-Softora-Reply-Target-Message-Id': threadProvenance.replyTargetMessageId || '',
    };
    if (outboundAttachments.length) mail.attachments = outboundAttachments;
    const outboundReservation = webdesignParts
      ? await reserveMailboxWebdesignOutboundRecipient(webdesignParts.outboundIdentity, {
          accountEmail: account.email,
          subject: cleanSubject,
        })
      : null;
    const provenanceReservation = await mailboxSendProvenanceStore.reserve({
      ...threadProvenance,
      accountEmail: account.email,
      recipientEmail: normalizedTo,
      senderName: account.name || account.email,
      subject: cleanSubject,
      body: webdesignParts?.text || normalizedText,
      requestBody: normalizedText,
      cc: normalizedCcText,
      bcc: normalizedBccText,
      attachments: outboundAttachments,
      attachmentsMetadata: explicitAttachmentMetadata,
    });
    if (!provenanceReservation.created) {
      const replay = await handleExistingIntent(provenanceReservation.intent);
      if (replay) return replay;
      throw processingError();
    }
    if (typeof mailboxSendProvenanceStore.startDispatch === 'function') {
      await mailboxSendProvenanceStore.startDispatch(threadProvenance.intentId);
    }
    const transporter = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.smtpUser, pass: account.smtpPass },
    });
    let info;
    try {
      info = await transporter.sendMail(mail);
    } catch (error) {
      if (isAmbiguousMailboxProviderError(error)) {
        if (typeof mailboxSendProvenanceStore.markUnknown === 'function') {
          await mailboxSendProvenanceStore.markUnknown(
            threadProvenance.intentId,
            error,
            { sentReconcileRequired: true }
          ).catch((markError) => {
            logger.error('[MailboxSendProvenance][Unknown]', markError?.message || markError);
          });
        }
        throw createMailboxReconcileRequiredError(error);
      }
      try {
        const failedIntent = await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
        if (!failedIntent || failedIntent.status !== 'failed') {
          const persistenceError = new Error('De definitieve providerfout kon niet duurzaam worden vastgelegd.');
          persistenceError.code = 'MAILBOX_SEND_PROVENANCE_FAIL_UNCONFIRMED';
          throw persistenceError;
        }
      } catch (provenanceError) {
        logger.error('[MailboxSendProvenance][FailAfterProviderRejection]', provenanceError?.message || provenanceError);
        const reconcileError = createMailboxReconcileRequiredError(provenanceError);
        reconcileError.providerError = error;
        throw reconcileError;
      }
      await cleanupStagedAttachments();
      error.retryable = false;
      throw error;
    }
    const providerAcceptedRecipients = normalizeProviderRecipients(info?.accepted);
    const providerRejectedRecipients = normalizeProviderRecipients(info?.rejected);
    if (
      !providerAcceptedRecipients.includes(normalizedTo)
      || providerRejectedRecipients.includes(normalizedTo)
    ) {
      const acceptanceError = createPrimaryRecipientNotAcceptedError(info, normalizedTo);
      if (typeof mailboxSendProvenanceStore.markUnknown === 'function') {
        await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, acceptanceError, {
          messageId: normalizeString(info?.messageId || threadProvenance.messageId),
          sentReconcileRequired: true,
        }).catch((markError) => {
          logger.error('[MailboxSendProvenance][PrimaryRecipientUnknown]', markError?.message || markError);
        });
      }
      throw createMailboxReconcileRequiredError(acceptanceError);
    }
    const sentAt = now();
    const sentCopyPromise = Promise.resolve().then(() => appendSentMessage({
      account,
      createImapClient,
      nodemailer,
      mail,
      messageId: normalizeString(info?.messageId || ''),
      sentAt,
      logger,
    })).catch((error) => {
      logger.warn('[MailboxSentCopy][append-after-smtp]', error?.message || error);
      return false;
    });
    let acceptedProvenance;
    try {
      if (webdesignParts) {
        await confirmMailboxWebdesignOutboundRecipient(outboundReservation && outboundReservation.reservationId, {
          messageId: normalizeString(info?.messageId || ''),
          email: normalizedTo,
          subject: cleanSubject,
        });
      }
      acceptedProvenance = await acceptProvenanceWithRetry(threadProvenance.intentId, {
        messageId: normalizeString(info?.messageId || threadProvenance.messageId),
        acceptedAt: sentAt.toISOString(),
      });
    } catch (error) {
      if (typeof mailboxSendProvenanceStore.markUnknown === 'function') {
        await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, error, {
          messageId: normalizeString(info?.messageId || threadProvenance.messageId),
          sentReconcileRequired: true,
        }).catch((markError) => logger.error('[MailboxSendProvenance][Unknown]', markError?.message || markError));
      }
      await sentCopyPromise;
      throw createMailboxReconcileRequiredError(error);
    }
    const sentCopySaved = await sentCopyPromise;
    await cleanupStagedAttachments();
    return {
      messageId: normalizeString(info?.messageId || ''),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
      sentCopySaved,
      intentId: acceptedProvenance.intentId,
      sentMessage: {
        id: `accepted-sent:${normalizeString(info?.messageId || sentAt.toISOString())}`,
        mailboxId: `accepted-sent:${normalizeString(info?.messageId || sentAt.toISOString())}`,
        folder: 'sent',
        storageFolder: 'sent',
        direction: 'sent',
        accountEmail: account.email,
        messageId: normalizeString(info?.messageId || threadProvenance.messageId),
        from: account.name || account.email,
        email: account.email,
        to: normalizedTo,
        toDisplay: normalizedTo,
        cc: normalizedCcText,
        bcc: normalizedBccText,
        recipientRoutingEvidenceKnown: true,
        subject: cleanSubject,
        body: webdesignParts?.text || normalizedText,
        preview: webdesignParts?.text || normalizedText,
        receivedAt: sentAt.toISOString(),
        activityAt: sentAt.toISOString(),
        hasBody: true,
        bodyTruncated: false,
        unread: false,
        attachments: explicitAttachmentMetadata,
        attachmentEvidenceKnown: true,
        attachmentHydrationAttempted: true,
        conversationId: threadProvenance.conversationId,
        softoraSendIntentId: threadProvenance.intentId,
        softoraSendMode: threadProvenance.mode,
        softoraReplyTargetMessageId: threadProvenance.replyTargetMessageId,
      },
    };
  };
}

module.exports = {
  COMPOSE_ATTACHMENT_EXTENSIONS,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  MAX_COMPOSE_ATTACHMENTS,
  MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES,
  createMailboxComposeSend,
};
