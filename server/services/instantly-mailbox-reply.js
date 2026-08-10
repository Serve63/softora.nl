const DEFINITIVE_REPLY_REJECTION_STATUSES = new Set([400, 401, 403, 404, 422]);

const text = (value) => String(value || '').trim();
const email = (value) => text(value).toLowerCase();

function isDefinitiveInstantlyReplyRejection(error = {}) {
  return DEFINITIVE_REPLY_REJECTION_STATUSES.has(Number(error.providerStatus));
}

function createInstantlyMailboxReply(deps = {}) {
  const {
    apiRequest,
    assertConfigured,
    assertOwner,
    assertStoredMessageOwnership,
    buildAcceptedSentMessage,
    createError,
    extractAddress,
    extractAddressList,
    logger = console,
    normalizeMessage,
    throwStoreFailure,
    upsertMessages,
  } = deps;

  function normalizeRecipientInput(value, label) {
    const addresses = extractAddressList(value);
    const supplied = Array.isArray(value)
      ? value.filter((item) => text(item)).length
      : text(value)
        ? String(value).split(/[,;]/).filter((item) => text(item)).length
        : 0;
    if (addresses.length !== supplied) {
      throw createError(
        `Controleer de e-mailadressen bij ${label}.`,
        'INSTANTLY_RECIPIENT_INVALID',
        400
      );
    }
    return addresses;
  }

  async function replyWithProviderFence({
    owner,
    accountEmail,
    providerMessageId,
    providerThreadId,
    subject,
    text: messageText,
    to,
    cc,
    bcc,
    attachments,
    mutationRequestKey,
    onProviderRequestStarting,
  } = {}) {
    const selectedOwner = assertOwner(owner);
    assertConfigured();
    if (Array.isArray(attachments) && attachments.length) {
      throw createError(
        'Instantly ondersteunt via deze API geen bijlagen bij antwoorden; verwijder de bijlage of verstuur via de gewone mailbox.',
        'INSTANTLY_ATTACHMENTS_UNSUPPORTED',
        400
      );
    }
    const account = email(accountEmail);
    const stored = await assertStoredMessageOwnership({
      owner: selectedOwner,
      accountEmail: account,
      providerMessageId,
      providerThreadId,
    });
    const expectedRecipient = stored.folder === 'sent'
      ? extractAddress(stored.to)
      : email(stored.email);
    if (!expectedRecipient || email(to) !== expectedRecipient) {
      throw createError(
        'De ontvanger wijkt af van de bewezen Instantly-thread.',
        'INSTANTLY_REPLY_RECIPIENT_MISMATCH',
        409
      );
    }
    const cleanSubject = text(subject).slice(0, 240);
    const cleanText = text(messageText);
    if (!cleanSubject || !cleanText) {
      throw createError(
        'Onderwerp en bericht zijn verplicht.',
        'INSTANTLY_REPLY_CONTENT_REQUIRED',
        400
      );
    }
    const ccAddresses = normalizeRecipientInput(cc, 'CC');
    const bccAddresses = normalizeRecipientInput(bcc, 'BCC');
    let providerRequestStarted = false;
    let acceptedResult = null;
    try {
      return await upsertMessages.runMutationLifecycle({
        accountEmail: account,
        requestKey: text(mutationRequestKey),
      }, async (mutationContext) => {
        if (typeof onProviderRequestStarting === 'function') {
          await onProviderRequestStarting();
        }
        providerRequestStarted = true;
        let response;
        try {
          response = await apiRequest('emails/reply', {
            method: 'POST', signal: mutationContext?.signal,
            body: {
              eaccount: account, reply_to_uuid: stored.providerMessageId,
              subject: cleanSubject, body: { text: cleanText },
              cc_address_email_list: ccAddresses.join(','),
              bcc_address_email_list: bccAddresses.join(','),
            },
          });
        } catch (error) {
          const rejected = isDefinitiveInstantlyReplyRejection(error);
          Object.assign(error, rejected
            ? { providerRejected: true, noExternalEffect: true }
            : { providerOutcomeUnknown: true, leaveMutationPending: true, status: 202 });
          throw error;
        }
        const rawSent = response?.email || response?.data || response;
        const normalizedSent = normalizeMessage({
          ...rawSent, eaccount: account, from_address_email: account, email_type: 'sent',
          in_reply_to: text(rawSent?.in_reply_to || stored.providerMessageId),
          thread_id: text(rawSent?.thread_id || stored.providerThreadId),
          campaign_id: text(rawSent?.campaign_id || stored.providerCampaignId),
        });
        if (
          !normalizedSent?.providerMessageId ||
          normalizedSent.providerAccountEmail !== account ||
          normalizedSent.providerOwner !== selectedOwner
        ) {
          throw createError(
            'Instantly accepteerde het antwoord zonder exact bewijsbare provideridentiteit.',
            'INSTANTLY_REPLY_OUTCOME_UNKNOWN', 202,
            { providerOutcomeUnknown: true, leaveMutationPending: true }
          );
        }
        acceptedResult = {
          provider: 'instantly', providerMessageId: normalizedSent.providerMessageId,
          providerThreadId: text(normalizedSent.providerThreadId || stored.providerThreadId),
          accountEmail: account, owner: selectedOwner, providerOutcomeUnknown: false,
          storageDegraded: false, reconcileRequired: false,
          sentMessage: buildAcceptedSentMessage(normalizedSent, {
            body: cleanText, subject: cleanSubject, to: expectedRecipient,
            cc: ccAddresses.join(', '), bcc: bccAddresses.join(', '),
          }),
        };
        const upsert = await upsertMessages([normalizedSent], mutationContext);
        if (!upsert?.ok) throwStoreFailure(
          upsert, 'Verzonden antwoord kon niet lokaal worden opgeslagen.', 'INSTANTLY_REPLY_STORE_FAILED'
        );
        return acceptedResult;
      });
    } catch (error) {
      if (acceptedResult) {
        logger.error('[InstantlyMailbox][ReplyStore]', error?.message || error);
        return { ...acceptedResult, storageDegraded: true, reconcileRequired: true };
      }
      if (error?.providerOutcomeUnknown === true) {
        logger.error('[InstantlyMailbox][ReplyOutcomeUnknown]', error?.message || error);
        return {
          provider: 'instantly', providerMessageId: '',
          providerThreadId: text(stored.providerThreadId),
          accountEmail: account, owner: selectedOwner, processing: true,
          providerOutcomeUnknown: true, storageDegraded: true, reconcileRequired: true,
        };
      }
      if (providerRequestStarted && error?.providerRejected !== true) {
        error.providerOutcomeUnknown = true;
        error.leaveMutationPending = true;
        error.status = 202;
        return {
          provider: 'instantly', providerMessageId: '',
          providerThreadId: text(stored.providerThreadId),
          accountEmail: account, owner: selectedOwner, processing: true,
          providerOutcomeUnknown: true, storageDegraded: true, reconcileRequired: true,
        };
      }
      error.noExternalEffect = true;
      throw error;
    }
  }

  return async function reply(input = {}) {
    try {
      return await replyWithProviderFence(input);
    } catch (error) {
      if (error?.providerOutcomeUnknown !== true && error?.providerRejected !== true) {
        error.noExternalEffect = true;
      }
      throw error;
    }
  };
}

module.exports = { createInstantlyMailboxReply, isDefinitiveInstantlyReplyRejection };
