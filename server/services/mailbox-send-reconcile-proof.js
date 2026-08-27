const {
  createMailboxReconcileRequiredError,
  mailboxAttachmentsMetadataEqual,
  normalizeMailboxAttachmentsMetadata,
} = require('./mailbox-send-provenance-store');

const MAILBOX_SEND_RECONCILE_PROOF_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function createMailboxReconcileProofError(message, code, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function createMalformedProofError() {
  return createMailboxReconcileProofError(
    'Het duurzame verzendbewijs is onvolledig of ongeldig.',
    'MAILBOX_SEND_RECONCILE_PROOF_INVALID'
  );
}

function normalizeMailboxReconcileProof(input, normalizeString = (value) => String(value || '').trim()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Number(input.version) !== MAILBOX_SEND_RECONCILE_PROOF_VERSION) {
    throw createMalformedProofError();
  }
  const text = (value) => normalizeString(value);
  const email = (value) => text(value).toLowerCase();
  const mode = text(input.mode).toLowerCase();
  const provider = text(input.provider || 'smtp').toLowerCase();
  const attachmentsMetadata = normalizeMailboxAttachmentsMetadata(input.attachmentsMetadata);
  const proof = {
    version: MAILBOX_SEND_RECONCILE_PROOF_VERSION,
    idempotencyKey: text(input.idempotencyKey),
    owner: text(input.owner).toLowerCase(),
    accountEmail: email(input.accountEmail),
    recipientEmail: email(input.recipientEmail),
    provider,
    mode,
    conversationId: text(input.conversationId),
    replyTargetMessageId: text(input.replyTargetMessageId),
    references: text(input.references),
    providerThreadId: text(input.providerThreadId),
    scopeFingerprint: text(input.scopeFingerprint),
    requestPayloadFingerprint: text(input.requestPayloadFingerprint).toLowerCase(),
    attachmentsMetadata,
  };
  const required = [
    proof.idempotencyKey, proof.owner, proof.accountEmail, proof.recipientEmail, proof.provider, proof.mode,
    proof.scopeFingerprint, proof.requestPayloadFingerprint,
  ];
  const invalidReply = mode === 'reply' && (
    !proof.conversationId || !proof.replyTargetMessageId || !proof.references
    || (provider === 'instantly' && !proof.providerThreadId)
  );
  if (required.some((value) => !value)
    || !['serve', 'martijn'].includes(proof.owner)
    || !['smtp', 'instantly'].includes(provider)
    || !['reply', 'new-message'].includes(mode)
    || !proof.accountEmail.includes('@')
    || !proof.recipientEmail.includes('@')
    || attachmentsMetadata === null
    || !SHA256_PATTERN.test(proof.requestPayloadFingerprint)
    || proof.scopeFingerprint.slice(0, -64) !== `${provider}-${mode}-scope:`
    || !SHA256_PATTERN.test(proof.scopeFingerprint.slice(-64))
    || invalidReply) {
    throw createMalformedProofError();
  }
  if (mode === 'new-message' && (
    proof.replyTargetMessageId || proof.references || proof.providerThreadId || provider !== 'smtp'
  )) throw createMalformedProofError();
  if (provider === 'smtp' && proof.providerThreadId) throw createMalformedProofError();
  return proof;
}

function createMailboxReconcileProof(intent, normalizeString) {
  const proof = {
    version: MAILBOX_SEND_RECONCILE_PROOF_VERSION,
    idempotencyKey: intent?.idempotencyKey,
    owner: intent?.owner,
    accountEmail: intent?.accountEmail,
    recipientEmail: intent?.recipientEmail,
    provider: intent?.provider || 'smtp',
    mode: intent?.mode,
    conversationId: intent?.conversationId,
    replyTargetMessageId: intent?.replyTargetMessageId,
    references: intent?.references,
    providerThreadId: intent?.providerThreadId,
    scopeFingerprint: intent?.sendScopeKey,
    requestPayloadFingerprint: intent?.requestPayloadFingerprint,
    attachmentsMetadata: intent?.attachmentsMetadata,
  };
  try {
    return normalizeMailboxReconcileProof(proof, normalizeString);
  } catch (cause) {
    throw createMailboxReconcileRequiredError(cause);
  }
}

function assertMailboxReconcileProofMatchesIntent(proofInput, intent, normalizeString) {
  const proof = normalizeMailboxReconcileProof(proofInput, normalizeString);
  const durableProof = createMailboxReconcileProof(intent, normalizeString);
  const contextFields = [
    'idempotencyKey', 'owner', 'accountEmail', 'recipientEmail', 'provider', 'mode', 'conversationId',
    'replyTargetMessageId', 'references', 'providerThreadId', 'scopeFingerprint',
  ];
  if (!contextFields.every((field) => proof[field] === durableProof[field])) {
    throw createMailboxReconcileProofError(
      'De veilige verzend-ID hoort bij een andere mailbox- of threadcontext.',
      'MAILBOX_SEND_IDEMPOTENCY_CONTEXT_MISMATCH'
    );
  }
  if (proof.requestPayloadFingerprint !== durableProof.requestPayloadFingerprint
    || !mailboxAttachmentsMetadataEqual(proof.attachmentsMetadata, durableProof.attachmentsMetadata)) {
    throw createMailboxReconcileProofError(
      'De veilige verzend-ID hoort bij andere mailinhoud of bijlagen.',
      'MAILBOX_SEND_IDEMPOTENCY_PAYLOAD_MISMATCH'
    );
  }
  return durableProof;
}

module.exports = {
  MAILBOX_SEND_RECONCILE_PROOF_VERSION,
  assertMailboxReconcileProofMatchesIntent,
  createMailboxReconcileProof,
  createMailboxReconcileProofError,
  normalizeMailboxReconcileProof,
};
