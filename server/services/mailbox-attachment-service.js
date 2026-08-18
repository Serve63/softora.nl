const crypto = require('crypto');

const MAILBOX_ATTACHMENT_BUCKET = 'softora-mailbox-attachments';
const MAILBOX_ATTACHMENT_REFERENCE_VERSION = 1;
const MAILBOX_ATTACHMENT_REFERENCE_TTL_MS = 30 * 60 * 1000;
const MAX_MAILBOX_ATTACHMENTS = 5;
const MAX_MAILBOX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES = 5 * 1024 * 1024;
const MAILBOX_ATTACHMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
  'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function createAttachmentError(message, code = 'MAILBOX_ATTACHMENT_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeFilename(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120);
}

function normalizeContentType(value, filename) {
  const supplied = normalizeText(value).toLowerCase().split(';')[0];
  if (supplied) return supplied;
  const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  return {
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    pdf: 'application/pdf',
    png: 'image/png',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }[extension] || 'application/octet-stream';
}

function canonicalBinding(binding = {}) {
  return [
    normalizeText(binding.owner).toLowerCase(),
    normalizeEmail(binding.accountEmail),
    normalizeEmail(binding.providerAccountEmail),
    normalizeEmail(binding.recipientEmail),
    normalizeText(binding.provider || 'smtp').toLowerCase(),
    normalizeText(binding.mode).toLowerCase(),
    normalizeText(binding.conversationId),
    normalizeText(binding.replyTargetMessageId),
    normalizeText(binding.providerThreadId),
    normalizeText(binding.idempotencyKey),
  ];
}

function createBindingHash(binding = {}) {
  return crypto.createHash('sha256').update(canonicalBinding(binding).map((part) => `${Buffer.byteLength(part)}:${part}`).join('|')).digest('hex');
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signReference(payload, secret) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyReference(reference, secret) {
  const [encoded, signature] = String(reference || '').split('.');
  if (!encoded || !signature || !secret) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(encoded));
  } catch (_) {
    throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
  }
  return payload;
}

function unwrapSupabaseResult(result) {
  if (result?.error) throw result.error;
  return result?.data ?? result;
}

function toSafeStorageError(error, fallback = 'Bijlage-opslag is tijdelijk niet beschikbaar; probeer opnieuw.') {
  const safe = createAttachmentError(fallback, 'MAILBOX_ATTACHMENT_STORAGE_FAILED', Number(error?.status) || 503);
  safe.cause = error;
  return safe;
}

function createMailboxAttachmentService(deps = {}) {
  const {
    getSupabaseClient = () => null,
    secret = '',
    bucket = MAILBOX_ATTACHMENT_BUCKET,
    now = () => new Date(),
    randomUUID = crypto.randomUUID,
    logger = console,
  } = deps;
  const signingSecret = normalizeText(secret);

  function storage() {
    if (!signingSecret) {
      throw createAttachmentError('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.', 'MAILBOX_ATTACHMENT_SIGNING_UNAVAILABLE', 503);
    }
    const client = getSupabaseClient();
    if (!client?.storage?.from) {
      throw createAttachmentError('Bijlagen zijn tijdelijk niet beschikbaar; probeer het opnieuw.', 'MAILBOX_ATTACHMENT_STORAGE_UNAVAILABLE', 503);
    }
    return client.storage.from(bucket);
  }

  function validateMetadata(attachment = {}) {
    const filename = safeFilename(attachment.filename || attachment.name);
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (!filename || !MAILBOX_ATTACHMENT_EXTENSIONS.has(extension)) {
      throw createAttachmentError(`Bestand "${filename || 'zonder naam'}" wordt niet ondersteund.`);
    }
    const size = Number(attachment.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MAILBOX_ATTACHMENT_BYTES) {
      throw createAttachmentError(`Bijlage "${filename}" mag maximaal 4 MB zijn.`);
    }
    return {
      filename,
      contentType: normalizeContentType(attachment.contentType, filename),
      size,
    };
  }

  function validateReferencePayload(payload, binding, { allowExpired = false } = {}) {
    if (!payload || payload.v !== MAILBOX_ATTACHMENT_REFERENCE_VERSION || payload.bucket !== bucket) {
      throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
    }
    if (!allowExpired && Number(payload.expiresAt) < now().getTime()) {
      throw createAttachmentError('De bijlage-upload is verlopen; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_EXPIRED', 409);
    }
    if (payload.bindingHash !== createBindingHash(binding)) {
      throw createAttachmentError('De bijlage hoort niet bij deze veilige verzendcontext.', 'MAILBOX_ATTACHMENT_CONTEXT_MISMATCH', 409);
    }
    if (!/^mailbox\/[a-z0-9-]+\/\d+-[^/]+$/i.test(String(payload.path || '')) || String(payload.path).includes('..')) {
      throw createAttachmentError('De bijlageverwijzing is ongeldig; kies de bijlage opnieuw.', 'MAILBOX_ATTACHMENT_REFERENCE_INVALID');
    }
    validateMetadata(payload);
    return payload;
  }

  async function removePaths(paths) {
    const uniquePaths = Array.from(new Set(paths.map((path) => normalizeText(path)).filter(Boolean)));
    if (!uniquePaths.length) return;
    const result = await storage().remove(uniquePaths);
    unwrapSupabaseResult(result);
  }

  async function createUploadPlan({ attachments = [], binding = {} } = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_MAILBOX_ATTACHMENTS) {
      throw createAttachmentError(`Je kunt maximaal ${MAX_MAILBOX_ATTACHMENTS} bijlagen toevoegen.`);
    }
    const metadata = list.map(validateMetadata);
    const totalBytes = metadata.reduce((total, item) => total + item.size, 0);
    if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) {
      throw createAttachmentError('De bijlagen mogen samen maximaal 5 MB zijn.');
    }
    const store = storage();
    const bindingHash = createBindingHash(binding);
    const expiresAt = now().getTime() + MAILBOX_ATTACHMENT_REFERENCE_TTL_MS;
    const createdPaths = [];
    try {
      const uploads = [];
      for (const [index, item] of metadata.entries()) {
        const path = `mailbox/${String(randomUUID()).replace(/[^a-z0-9-]/gi, '')}/${index}-${item.filename}`;
        const result = unwrapSupabaseResult(await store.createSignedUploadUrl(path, { upsert: false }));
        if (!result?.signedUrl) throw new Error('signed upload URL ontbreekt');
        createdPaths.push(path);
        const reference = signReference({
          v: MAILBOX_ATTACHMENT_REFERENCE_VERSION,
          bucket,
          path,
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          bindingHash,
          expiresAt,
        }, signingSecret);
        uploads.push({
          reference,
          signedUrl: result.signedUrl,
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          expiresAt,
        });
      }
      return uploads;
    } catch (error) {
      await removePaths(createdPaths).catch((cleanupError) => {
        logger.warn('[MailboxAttachment][CleanupAfterPlanFailure]', cleanupError?.message || cleanupError);
      });
      if (error?.code?.startsWith?.('MAILBOX_ATTACHMENT_')) throw error;
      throw toSafeStorageError(error);
    }
  }

  async function downloadAttachments(attachments = [], binding = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_MAILBOX_ATTACHMENTS) {
      throw createAttachmentError(`Je kunt maximaal ${MAX_MAILBOX_ATTACHMENTS} bijlagen toevoegen.`);
    }
    const payloads = list.map((attachment) => validateReferencePayload(
      verifyReference(attachment?.reference, signingSecret),
      binding
    ));
    const totalBytes = payloads.reduce((total, item) => total + Number(item.size || 0), 0);
    if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) {
      throw createAttachmentError('De bijlagen mogen samen maximaal 5 MB zijn.');
    }
    const store = storage();
    const resolved = [];
    for (const payload of payloads) {
      let result;
      try {
        result = unwrapSupabaseResult(await store.download(payload.path));
      } catch (error) {
        throw toSafeStorageError(error, 'Bijlage kon niet veilig worden opgehaald; de mail is niet verzonden.');
      }
      let content;
      if (Buffer.isBuffer(result)) content = result;
      else if (result instanceof Uint8Array) content = Buffer.from(result);
      else if (result && typeof result.arrayBuffer === 'function') content = Buffer.from(await result.arrayBuffer());
      if (!content?.length || content.length !== Number(payload.size)) {
        throw createAttachmentError(`Bijlage "${payload.filename}" kon niet veilig worden gecontroleerd.`, 'MAILBOX_ATTACHMENT_SIZE_MISMATCH');
      }
      resolved.push({
        filename: payload.filename,
        content,
        contentType: payload.contentType,
        contentDisposition: 'attachment',
      });
    }
    return resolved;
  }

  async function cleanupAttachments(attachments = [], binding = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return { removed: 0 };
    const payloads = list.map((attachment) => validateReferencePayload(
      verifyReference(attachment?.reference, signingSecret),
      binding,
      { allowExpired: false }
    ));
    await removePaths(payloads.map((payload) => payload.path));
    return { removed: payloads.length };
  }

  return {
    cleanupAttachments,
    createBindingHash,
    createUploadPlan,
    downloadAttachments,
    isConfigured: () => Boolean(signingSecret && getSupabaseClient()?.storage?.from),
  };
}

module.exports = {
  MAILBOX_ATTACHMENT_BUCKET,
  MAILBOX_ATTACHMENT_EXTENSIONS,
  MAILBOX_ATTACHMENT_REFERENCE_TTL_MS,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS,
  MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES,
  createBindingHash,
  createMailboxAttachmentService,
  safeFilename,
};
