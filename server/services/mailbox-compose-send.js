const {
  MAILBOX_COMPOSE_EMAIL_TEMPLATE_VERSION,
  renderMailboxComposeEmailHtml,
} = require('./mailbox-compose-email-renderer');
const {
  createMailboxReconcileRequiredError,
  isAmbiguousMailboxProviderError,
} = require('./mailbox-send-provenance-store');

const MAX_COMPOSE_ATTACHMENTS = 5;
const MAX_COMPOSE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_COMPOSE_ATTACHMENTS_TOTAL_BYTES = 5 * 1024 * 1024;
const COMPOSE_ATTACHMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
  'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
]);

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

  async function cleanupUploadedAttachments(attachments, threadProvenance) {
    const references = (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => normalizeString(attachment?.reference));
    if (!references.length || !mailboxAttachmentService || typeof mailboxAttachmentService.cleanupAttachments !== 'function') return;
    await mailboxAttachmentService.cleanupAttachments(references, threadProvenance);
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
    const explicitAttachments = await normalizeComposeAttachments(attachments, threadProvenance);
    const cleanSubject = truncateText(normalizeString(subject), 240);
    if (!cleanSubject) {
      const error = new Error('Onderwerp is verplicht.');
      error.status = 400;
      throw error;
    }
    const transporter = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.smtpUser, pass: account.smtpPass },
    });
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
      cc: normalizedCc.join(', '),
      bcc: normalizedBcc.join(', '),
      attachments: outboundAttachments,
    });
    if (!provenanceReservation.created) {
      if (provenanceReservation.intent.status === 'accepted') {
        const accepted = provenanceReservation.intent;
        await cleanupUploadedAttachments(attachments, threadProvenance).catch((error) => {
          logger.warn('[MailboxAttachment][CleanupAfterIdempotentReplay]', error?.message || error);
        });
        return {
          messageId: accepted.messageId,
          accepted: [normalizedTo],
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
            conversationId: accepted.conversationId,
            softoraSendIntentId: accepted.intentId,
            softoraSendMode: accepted.mode,
          },
        };
      }
      const error = new Error('Deze verzending wordt al veilig verwerkt; wacht op bevestiging voordat je opnieuw probeert.');
      error.status = 409;
      error.code = 'MAILBOX_SEND_ALREADY_PROCESSING';
      throw error;
    }
    if (typeof mailboxSendProvenanceStore.startDispatch === 'function') {
      await mailboxSendProvenanceStore.startDispatch(threadProvenance.intentId);
    }
    let info;
    try {
      info = await transporter.sendMail(mail);
    } catch (error) {
      if (isAmbiguousMailboxProviderError(error) && typeof mailboxSendProvenanceStore.markUnknown === 'function') {
        await mailboxSendProvenanceStore.markUnknown(threadProvenance.intentId, error, { sentReconcileRequired: true })
          .catch((markError) => logger.error('[MailboxSendProvenance][Unknown]', markError?.message || markError));
        throw createMailboxReconcileRequiredError(error);
      }
      await mailboxSendProvenanceStore.fail(threadProvenance.intentId, error);
      await cleanupUploadedAttachments(attachments, threadProvenance).catch((cleanupError) => {
        logger.warn('[MailboxAttachment][CleanupAfterProviderFailure]', cleanupError?.message || cleanupError);
      });
      throw error;
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
    await cleanupUploadedAttachments(attachments, threadProvenance).catch((error) => {
      logger.warn('[MailboxAttachment][CleanupAfterAcceptedSend]', error?.message || error);
    });
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
