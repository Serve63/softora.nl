const { buildAcceptedSentMessage } = require('./mailbox-accepted-sent-message');

function normalizeText(value) {
  return String(value || '').trim();
}

function createLocalStoreError() {
  const error = new Error('Verzonden antwoord kon niet lokaal worden opgeslagen.');
  error.code = 'INSTANTLY_REPLY_INDEX_STORE_FAILED';
  error.status = 503;
  return error;
}

function logPostAcceptFailure(logger, error, acceptedResult) {
  try {
    logger?.error?.('[InstantlyMailbox][ReplyStore]', {
      errorCode: normalizeText(error?.code) || 'INSTANTLY_REPLY_INDEX_STORE_FAILED',
      errorStatus: Number(error?.status) || null,
      providerMessageId: acceptedResult.providerMessageId,
      providerThreadId: acceptedResult.providerThreadId,
    });
  } catch (_) {
    // Provideracceptatie mag nooit door een lokale loggerfout worden teruggedraaid.
  }
}

async function finalizeInstantlyAcceptedReply({
  rawSent,
  stored,
  account,
  owner,
  subject,
  body,
  to,
  ccAddresses = [],
  bccAddresses = [],
  normalizeInstantlyMessage,
  mailboxIndexStore,
  logger = console,
} = {}) {
  const acceptedResult = {
    provider: 'instantly',
    providerAccepted: true,
    providerMessageId: '',
    providerThreadId: normalizeText(stored?.providerThreadId),
    accountEmail: account,
    owner,
    localIndexStored: false,
    sentMessage: null,
  };
  try {
    acceptedResult.providerMessageId = normalizeText(
      rawSent?.id || rawSent?.email_id || rawSent?.uuid
    );
    acceptedResult.providerThreadId = normalizeText(
      rawSent?.thread_id || stored?.providerThreadId
    );
    const acceptedAt = normalizeText(
      rawSent?.timestamp_email || rawSent?.timestamp_created || rawSent?.created_at
    ) || new Date().toISOString();
    const sentValues = {
      body,
      subject,
      to,
      cc: ccAddresses.join(', '),
      bcc: bccAddresses.join(', '),
    };
    acceptedResult.sentMessage = buildAcceptedSentMessage({
      id: acceptedResult.providerMessageId
        ? `instantly:${acceptedResult.providerMessageId}`
        : '',
      mailboxId: acceptedResult.providerMessageId
        ? `instantly:${acceptedResult.providerMessageId}`
        : '',
      provider: 'instantly',
      providerMessageId: acceptedResult.providerMessageId,
      providerThreadId: acceptedResult.providerThreadId,
      providerAccountEmail: account,
      providerOwner: owner,
      accountEmail: account,
      folder: 'sent',
      storageFolder: 'instantly',
      direction: 'sent',
      from: account,
      email: account,
      messageId: normalizeText(rawSent?.message_id),
      receivedAt: acceptedAt,
      activityAt: acceptedAt,
      bodyLoaded: true,
      attachments: [],
    }, sentValues);
    const normalizedSent = normalizeInstantlyMessage({
      ...rawSent,
      eaccount: account,
      from_address_email: account,
      email_type: 'sent',
      in_reply_to: normalizeText(rawSent?.in_reply_to || stored?.providerMessageId),
      thread_id: acceptedResult.providerThreadId,
      campaign_id: normalizeText(rawSent?.campaign_id || stored?.providerCampaignId),
    });
    if (!normalizedSent) {
      acceptedResult.postAcceptWarningCode = 'INSTANTLY_REPLY_PROVIDER_ID_MISSING';
      return acceptedResult;
    }
    acceptedResult.providerMessageId = normalizedSent.providerMessageId
      || acceptedResult.providerMessageId;
    acceptedResult.providerThreadId = normalizedSent.providerThreadId
      || acceptedResult.providerThreadId;
    acceptedResult.sentMessage = buildAcceptedSentMessage(normalizedSent, sentValues);
    const upsert = await mailboxIndexStore.upsertProviderMessages({
      provider: 'instantly',
      messages: [normalizedSent],
    });
    if (!upsert?.ok) throw createLocalStoreError();
    acceptedResult.localIndexStored = true;
  } catch (error) {
    acceptedResult.postAcceptWarningCode = 'INSTANTLY_REPLY_INDEX_STORE_FAILED';
    logPostAcceptFailure(logger, error, acceptedResult);
  }
  return acceptedResult;
}

module.exports = { finalizeInstantlyAcceptedReply };
