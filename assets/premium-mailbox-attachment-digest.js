(function (global) {
  'use strict';

  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;
  const CONTENT_TYPE_BY_EXTENSION = Object.freeze({
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
  });
  const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPE_BY_EXTENSION));

  function createDigestError(code, message, options = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = Number(options.status) || 409;
    error.retryable = false;
    if (options.cause) error.cause = options.cause;
    return error;
  }

  function safeFilename(value) {
    const normalized = String(value ?? '').trim().normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}/\\]+/gu, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '');
    const characters = Array.from(normalized);
    if (characters.length <= 120) return normalized;
    const extension = (normalized.match(/(\.[a-z0-9]{1,15})$/i) || [])[1] || '';
    return `${characters.slice(0, Math.max(1, 120 - Array.from(extension).length)).join('')}${extension}`;
  }

  function normalizeContentType(value, filename) {
    const safe = safeFilename(filename);
    const extension = safe.includes('.') ? safe.split('.').pop().toLowerCase() : '';
    return CONTENT_TYPE_BY_EXTENSION[extension]
      || String(value || '').trim().toLowerCase().split(';')[0]
      || 'application/octet-stream';
  }

  function canonicalAttachment(attachment) {
    const file = attachment?.file;
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_RESELECT_REQUIRED',
        'Kies de bijlagen opnieuw voordat je deze mail veilig verzendt.'
      );
    }
    const filename = safeFilename(attachment?.filename || attachment?.name);
    const sourceFilename = safeFilename(file.name);
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const size = Number(attachment?.size);
    const fileSize = Number(file.size);
    const contentType = normalizeContentType(attachment?.contentType || attachment?.type, filename);
    const fileContentType = normalizeContentType(file.type, sourceFilename);
    if (
      !filename
      || filename !== sourceFilename
      || !ALLOWED_EXTENSIONS.has(extension)
      || !Number.isSafeInteger(size)
      || size <= 0
      || size > MAX_ATTACHMENT_BYTES
      || size !== fileSize
      || contentType !== fileContentType
    ) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_FILE_IDENTITY_MISMATCH',
        'De gekozen bijlage wijkt af van de zichtbare bestandsgegevens; kies het bestand opnieuw.'
      );
    }
    const suppliedSha256 = attachment?.sha256;
    if (suppliedSha256 !== undefined && !SHA256_PATTERN.test(String(suppliedSha256))) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_SHA256_INVALID',
        'De bijlage heeft geen geldig veilig bestandsbewijs; kies het bestand opnieuw.'
      );
    }
    return { file, filename, contentType, size, suppliedSha256: suppliedSha256 || '' };
  }

  function isArrayBuffer(value) {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
      && Number.isSafeInteger(Number(value?.byteLength));
  }

  async function digestFile(file, options = {}) {
    const cryptoRef = options.crypto || global.crypto;
    if (!cryptoRef?.subtle || typeof cryptoRef.subtle.digest !== 'function') {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_DIGEST_UNAVAILABLE',
        'De browser kan de bijlage niet veilig controleren; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch (error) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_READ_FAILED',
        'De bijlage kon niet veilig worden gelezen; kies het bestand opnieuw.',
        { cause: error }
      );
    }
    if (!isArrayBuffer(bytes) || bytes.byteLength !== Number(file.size)) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_FILE_BYTES_MISMATCH',
        'De inhoud van de bijlage wijkt af van de gekozen bestandsgrootte; kies het bestand opnieuw.'
      );
    }
    let digest;
    try {
      digest = await cryptoRef.subtle.digest('SHA-256', bytes);
    } catch (error) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_DIGEST_FAILED',
        'De browser kon de bijlage niet veilig controleren; de mail is niet verzonden.',
        { status: 503, cause: error }
      );
    }
    if (!isArrayBuffer(digest) || digest.byteLength !== 32) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_DIGEST_INVALID',
        'De browser gaf geen geldig veilig bestandsbewijs; de mail is niet verzonden.',
        { status: 503 }
      );
    }
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function bind(attachments, options = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length > MAX_ATTACHMENTS) {
      throw createDigestError('MAILBOX_ATTACHMENT_LIMIT_EXCEEDED', 'Je kunt maximaal 5 bijlagen toevoegen.', { status: 400 });
    }
    const canonical = list.map(canonicalAttachment);
    const totalBytes = canonical.reduce((total, attachment) => total + attachment.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw createDigestError('MAILBOX_ATTACHMENT_TOTAL_TOO_LARGE', 'De bijlagen mogen samen maximaal 5 MB zijn.', { status: 400 });
    }
    const digests = await Promise.all(canonical.map((attachment) => digestFile(attachment.file, options)));
    const boundAttachments = canonical.map((attachment, index) => {
      const sha256 = digests[index];
      if (attachment.suppliedSha256 && attachment.suppliedSha256 !== sha256) {
        throw createDigestError(
          'MAILBOX_ATTACHMENT_DIGEST_MISMATCH',
          'De inhoud van de bijlage is tijdens de verzendcontrole gewijzigd; kies het bestand opnieuw.'
        );
      }
      return {
        ...list[index],
        file: attachment.file,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        sha256,
      };
    });
    return {
      attachments: boundAttachments,
      metadata: boundAttachments.map(({ filename, contentType, size, sha256 }) => ({
        filename, contentType, size, sha256,
      })),
    };
  }

  async function verify(attachments, expectedMetadata, options = {}) {
    const rebound = await bind(attachments, options);
    if (JSON.stringify(rebound.metadata) !== JSON.stringify(expectedMetadata)) {
      throw createDigestError(
        'MAILBOX_ATTACHMENT_DIGEST_MISMATCH',
        'De inhoud van de bijlage is tijdens de verzending gewijzigd; de mail is niet verzonden.'
      );
    }
    return rebound;
  }

  const api = { CONTENT_TYPE_BY_EXTENSION, SHA256_PATTERN, bind, normalizeContentType, safeFilename, verify };
  global.SoftoraMailboxAttachmentDigest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
