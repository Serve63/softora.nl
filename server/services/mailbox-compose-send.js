const crypto = require('crypto');
const {
  MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
  renderMailboxComposeEmailHtml,
} = require('./mailbox-compose-email-renderer');
const {
  DEFAULT_COLDMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  DEFAULT_COLDMAIL_SMTP_GREETING_TIMEOUT_MS,
  DEFAULT_COLDMAIL_SMTP_SOCKET_TIMEOUT_MS,
} = require('../config/coldmail-campaign');
const {
  createMailboxPayloadFingerprint,
  createMailboxRecipientFingerprint,
} = require('./mailbox-send-provenance-store');

const MAX_COMPOSE_ATTACHMENTS = 5;
const MAX_COMPOSE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES = 5 * 1024 * 1024;
const COMPOSE_ATTACHMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
  'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
]);

function fingerprintComposeAttachments(attachments = []) {
  if (!attachments.length) return '';
  const normalizedAttachments = attachments.map((attachment) => ({
    filename: String(attachment?.filename || ''), contentType: String(attachment?.contentType || ''),
    disposition: String(attachment?.contentDisposition || ''), cid: String(attachment?.cid || ''),
    content: crypto.createHash('sha256').update(Buffer.isBuffer(attachment?.content)
      ? attachment.content : Buffer.from(String(attachment?.content || ''))).digest('hex'),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(normalizedAttachments)).digest('hex');
}

function fingerprintComposePayload({ subject, body, cc, bcc, attachments = [] }) {
  return createMailboxPayloadFingerprint({
    subject, body, cc: [...cc].sort().join(', '), bcc: [...bcc].sort().join(', '),
    attachmentsFingerprint: fingerprintComposeAttachments(attachments),
  });
}

function isDefinitiveSmtpNoExternalEffect(error = {}) {
  const responseCode = Number(error.responseCode);
  return responseCode >= 400 && responseCode <= 599;
}

function normalizeSmtpRecipients(values, normalizeEmail) {
  return (Array.isArray(values) ? values : []).map((value) =>
    normalizeEmail(value && typeof value === 'object' ? value.address || value.email : value)
  ).filter(Boolean);
}

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
    releaseMailboxWebdesignOutboundRecipient,
    appendSentMessage,
    createImapClient,
    nodemailer,
    webdesignEmailTemplateVersion,
    mailboxSendProvenanceStore,
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

  function normalizeComposeAttachments(value) {
    const attachments = Array.isArray(value) ? value : [];
    if (attachments.length > MAX_COMPOSE_ATTACHMENTS) {
      const error = new Error(`Je kunt maximaal ${MAX_COMPOSE_ATTACHMENTS} bijlagen toevoegen.`);
      error.status = 400;
      throw error;
    }
    let totalBytes = 0;
    return attachments.map((attachment) => {
      const rawName = normalizeString(attachment && (attachment.filename || attachment.name))
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f/\\]+/g, '-')
        .replace(/^\.+/, '')
        .slice(0, 120);
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
        contentType: truncateText(normalizeString(attachment && attachment.contentType), 120) || undefined,
        contentDisposition: 'attachment',
      };
    });
  }

  return async function sendMessage({ accountEmail, to, cc, bcc, subject, text, attachments, threadProvenance }) {
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
    const explicitAttachments = normalizeComposeAttachments(attachments);
    const cleanSubject = truncateText(normalizeString(subject), 240);
    if (!cleanSubject) {
      const error = new Error('Onderwerp is verplicht.');
      error.status = 400;
      throw error;
    }
    const normalizedText = normalizeString(text);
    if (!threadProvenance || !mailboxSendProvenanceStore) {
      const error = new Error('De duurzame threadcontext ontbreekt; verzending is veilig gestopt.');
      error.status = 503;
      error.code = 'MAILBOX_SEND_PROVENANCE_REQUIRED';
      throw error;
    }
    const webdesignParts = await buildMailboxWebdesignSendParts({
      accountEmail: account.email,
      to: normalizedTo,
      subject: cleanSubject,
      text: normalizedText,
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
    const outboundAttachments = [
      ...(Array.isArray(webdesignParts?.attachments) ? webdesignParts.attachments : []),
      ...explicitAttachments,
    ];
    if (outboundAttachments.length) mail.attachments = outboundAttachments;
    const attachmentsFingerprint = fingerprintComposeAttachments(outboundAttachments);
    const payloadFingerprint = createMailboxPayloadFingerprint({
      subject: cleanSubject, body: webdesignParts?.text || normalizedText,
      cc: normalizedCc.join(', '), bcc: normalizedBcc.join(', '), attachmentsFingerprint,
    });
    const recipientFingerprint = createMailboxRecipientFingerprint({
      to: normalizedTo, cc: normalizedCc, bcc: normalizedBcc,
    });
    mail.headers['X-Softora-Recipient-Fingerprint'] = recipientFingerprint;
    mail.headers['X-Softora-Payload-Fingerprint'] = payloadFingerprint;
    const provenanceReservation = await mailboxSendProvenanceStore.reserve({
      ...threadProvenance,
      accountEmail: account.email,
      recipientEmail: normalizedTo,
      senderName: account.name || account.email,
      subject: cleanSubject,
      body: webdesignParts?.text || normalizedText,
      cc: normalizedCc.join(', '),
      bcc: normalizedBcc.join(', '),
      payloadFingerprint,
      attachmentsFingerprint,
      outboundGuardRequired: Boolean(webdesignParts),
    });
    if (!provenanceReservation.created) {
      if (provenanceReservation.intent.status === 'accepted') {
        const accepted = provenanceReservation.intent;
        return {
          messageId: accepted.messageId,
          accepted: accepted.accepted?.length ? accepted.accepted : [normalizedTo],
          rejected: accepted.rejected || [],
          sentCopySaved: !accepted.sentReconcileRequired,
          intentId: accepted.intentId,
          idempotentReplay: true,
          degraded: accepted.storageDegraded === true || accepted.rejected?.length > 0,
          deliveryDegraded: accepted.rejected?.length > 0,
          storageDegraded: accepted.storageDegraded === true,
          reconcileRequired: accepted.reconcileRequired === true,
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
            conversationId: accepted.conversationId,
            softoraSendIntentId: accepted.intentId,
            softoraPayloadFingerprint: accepted.payloadFingerprint,
            softoraSendMode: accepted.mode,
          },
        };
      }
      if (['prepared', 'unknown'].includes(provenanceReservation.intent.status)) {
        return {
          intentId: provenanceReservation.intent.intentId,
          processing: true, providerOutcomeUnknown: true, storageDegraded: true,
          reconcileRequired: true, idempotentReplay: true,
        };
      }
      const error = new Error('Deze verzending wordt al veilig verwerkt; wacht op bevestiging voordat je opnieuw probeert.');
      error.status = 409;
      error.code = 'MAILBOX_SEND_ALREADY_PROCESSING';
      throw error;
    }
    let outboundReservation = null;
    try {
      outboundReservation = webdesignParts
        ? await reserveMailboxWebdesignOutboundRecipient(webdesignParts.outboundIdentity, {
            accountEmail: account.email, subject: cleanSubject,
            reservationId: threadProvenance.intentId,
          })
        : null;
    } catch (error) {
      await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
      throw error;
    }
    const releaseDefinitiveGuard = async () => {
      if (!webdesignParts || !outboundReservation) return;
      if (typeof releaseMailboxWebdesignOutboundRecipient !== 'function') {
        const error = new Error('De gereserveerde outbound-guard kon niet veilig worden vrijgegeven.');
        error.status = 503;
        error.code = 'MAILBOX_OUTBOUND_GUARD_RELEASE_UNAVAILABLE';
        throw error;
      }
      await releaseMailboxWebdesignOutboundRecipient(
        outboundReservation.reservationId || threadProvenance.intentId
      );
    };
    let transporter;
    try {
      transporter = createTransport({
        host: account.smtpHost, port: account.smtpPort, secure: account.smtpSecure,
        auth: { user: account.smtpUser, pass: account.smtpPass },
        connectionTimeout: DEFAULT_COLDMAIL_SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: DEFAULT_COLDMAIL_SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: DEFAULT_COLDMAIL_SMTP_SOCKET_TIMEOUT_MS,
      });
      if (typeof mailboxSendProvenanceStore.markDispatchStarted !== 'function') {
        const error = new Error('De duurzame providerstartregistratie ontbreekt.');
        error.status = 503;
        error.code = 'MAILBOX_SEND_DISPATCH_START_UNAVAILABLE';
        throw error;
      }
      await mailboxSendProvenanceStore.markDispatchStarted(threadProvenance.intentId);
    } catch (error) {
      try {
        await releaseDefinitiveGuard();
      } catch (releaseError) {
        logger.error('[Mailbox][GuardReleaseBeforeDispatch]', releaseError?.message || releaseError);
        await mailboxSendProvenanceStore.fail(threadProvenance.intentId, releaseError);
        throw releaseError;
      }
      await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
      throw error;
    }
    let info;
    try {
      info = await transporter.sendMail(mail);
    } catch (error) {
      if (isDefinitiveSmtpNoExternalEffect(error)) {
        try {
          await releaseDefinitiveGuard();
        } catch (releaseError) {
          logger.error('[Mailbox][GuardReleaseRejected]', releaseError?.message || releaseError);
          await mailboxSendProvenanceStore.fail(threadProvenance.intentId, releaseError);
          throw releaseError;
        }
        await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
        throw error;
      }
      await mailboxSendProvenanceStore.markUnknown?.(threadProvenance.intentId, error).catch((storeError) =>
        logger.error('[Mailbox][SmtpUnknownStore]', storeError?.message || storeError));
      return {
        intentId: threadProvenance.intentId, processing: true, providerOutcomeUnknown: true,
        storageDegraded: true, reconcileRequired: true,
      };
    }
    const accepted = normalizeSmtpRecipients(info?.accepted, normalizeEmail);
    const rejected = normalizeSmtpRecipients(info?.rejected, normalizeEmail);
    const expectedRecipients = Array.from(new Set([normalizedTo, ...normalizedCc, ...normalizedBcc]));
    if (!accepted.length) {
      const error = new Error(rejected.length === expectedRecipients.length
        ? 'SMTP heeft alle ontvangers definitief geweigerd.'
        : 'De SMTP-uitkomst kon niet definitief worden vastgesteld.');
      error.status = 502;
      error.code = rejected.length === expectedRecipients.length
        ? 'MAILBOX_SMTP_RECIPIENTS_REJECTED' : 'MAILBOX_SMTP_OUTCOME_UNKNOWN';
      if (rejected.length === expectedRecipients.length) {
        try {
          await releaseDefinitiveGuard();
        } catch (releaseError) {
          logger.error('[Mailbox][GuardReleaseAllRejected]', releaseError?.message || releaseError);
          await mailboxSendProvenanceStore.fail(threadProvenance.intentId, releaseError);
          throw releaseError;
        }
        await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
        throw error;
      }
      await mailboxSendProvenanceStore.markUnknown?.(threadProvenance.intentId, error)
        .catch((storeError) => logger.error('[Mailbox][SmtpUnknownStore]', storeError?.message || storeError));
      return { intentId: threadProvenance.intentId, processing: true, providerOutcomeUnknown: true,
        storageDegraded: true, reconcileRequired: true };
    }
    const sentAt = now();
    const messageId = normalizeString(info?.messageId || threadProvenance.messageId);
    const [guardResult, sentCopyResult] = await Promise.allSettled([
      webdesignParts ? confirmMailboxWebdesignOutboundRecipient(
        outboundReservation?.reservationId || threadProvenance.intentId,
        { messageId, email: normalizedTo, subject: cleanSubject }
      ) : true,
      appendSentMessage({ account, createImapClient, nodemailer, mail, messageId, sentAt, logger }),
    ]);
    if (guardResult.status === 'rejected') logger.error('[Mailbox][GuardConfirm]', guardResult.reason?.message || guardResult.reason);
    if (sentCopyResult.status === 'rejected') logger.error('[Mailbox][SentCopy]', sentCopyResult.reason?.message || sentCopyResult.reason);
    const guardPending = Boolean(webdesignParts && guardResult.status !== 'fulfilled');
    const sentCopySaved = sentCopyResult.status === 'fulfilled' && sentCopyResult.value === true;
    const sentPending = !sentCopySaved;
    let provenanceAccepted = true;
    try {
      await acceptProvenanceWithRetry(threadProvenance.intentId, {
        messageId, acceptedAt: sentAt.toISOString(), accepted, rejected,
        storageDegraded: guardPending || sentPending,
        reconcileRequired: guardPending || sentPending,
        outboundGuardReconcileRequired: guardPending,
        sentReconcileRequired: sentPending,
      });
    } catch (error) {
      provenanceAccepted = false;
      logger.error('[Mailbox][SmtpAcceptStore]', error?.message || error);
      const preserved = await mailboxSendProvenanceStore.markUnknown?.(threadProvenance.intentId, error)
        .catch((storeError) => {
          logger.error('[Mailbox][SmtpUnknownStore]', storeError?.message || storeError);
          return null;
        });
      if (preserved?.status === 'accepted') provenanceAccepted = true;
    }
    const storageDegraded = guardPending || sentPending || !provenanceAccepted;
    const deliveryDegraded = rejected.length > 0 || accepted.length < expectedRecipients.length;
    return {
      messageId, accepted, rejected, sentCopySaved, intentId: threadProvenance.intentId,
      degraded: deliveryDegraded || storageDegraded, deliveryDegraded, storageDegraded,
      reconcileRequired: storageDegraded, providerOutcomeUnknown: false,
      sentMessage: {
        id: `accepted-sent:${messageId || sentAt.toISOString()}`,
        mailboxId: `accepted-sent:${messageId || sentAt.toISOString()}`,
        folder: 'sent',
        storageFolder: 'sent',
        direction: 'sent',
        accountEmail: account.email,
        messageId,
        from: account.name || account.email,
        email: account.email,
        to: normalizedTo,
        toDisplay: normalizedTo,
        cc: normalizedCc.join(', '),
        bcc: normalizedBcc.join(', '),
        recipientRoutingEvidenceKnown: true,
        subject: cleanSubject,
        body: webdesignParts?.text || normalizedText,
        preview: webdesignParts?.text || normalizedText,
        receivedAt: sentAt.toISOString(),
        activityAt: sentAt.toISOString(),
        hasBody: true,
        bodyTruncated: false,
        unread: false,
        conversationId: threadProvenance.conversationId,
        softoraSendIntentId: threadProvenance.intentId,
        softoraPayloadFingerprint: payloadFingerprint,
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
  fingerprintComposeAttachments,
  fingerprintComposePayload,
  isDefinitiveSmtpNoExternalEffect,
};
