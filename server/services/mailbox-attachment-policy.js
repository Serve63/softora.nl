const MAX_MAILBOX_ATTACHMENTS = 5;
const MAX_MAILBOX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES = 5 * 1024 * 1024;
const MAILBOX_ATTACHMENT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

const MAILBOX_ATTACHMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
  'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
]);

const MAILBOX_ATTACHMENT_CONTENT_TYPE_BY_EXTENSION = Object.freeze({
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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeFilename(value) {
  const normalized = normalizeText(value)
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}/\\]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');
  const characters = Array.from(normalized);
  if (characters.length <= 120) return normalized;
  const extensionMatch = normalized.match(/(\.[a-z0-9]{1,15})$/i);
  const extension = extensionMatch?.[1] || '';
  const extensionLength = Array.from(extension).length;
  return `${characters.slice(0, Math.max(1, 120 - extensionLength)).join('')}${extension}`;
}

function normalizeContentType(value, filename) {
  const normalizedFilename = safeFilename(filename);
  const extension = normalizedFilename.includes('.')
    ? normalizedFilename.split('.').pop().toLowerCase()
    : '';
  const canonical = MAILBOX_ATTACHMENT_CONTENT_TYPE_BY_EXTENSION[extension];
  if (canonical) return canonical;
  return normalizeText(value).toLowerCase().split(';')[0] || 'application/octet-stream';
}

function normalizeAttachmentMetadata(value) {
  const source = (Array.isArray(value) ? value : []).slice(0, MAX_MAILBOX_ATTACHMENTS);
  const hashPresence = source.map((attachment) => (
    Boolean(attachment && Object.prototype.hasOwnProperty.call(attachment, 'sha256'))
  ));
  if (hashPresence.some(Boolean) && !hashPresence.every(Boolean)) return [];
  let totalBytes = 0;
  const normalized = source
    .map((attachment) => {
      const filename = safeFilename(attachment?.filename || attachment?.name);
      const size = Number(attachment?.size);
      if (!filename || !Number.isSafeInteger(size) || size <= 0 || size > MAX_MAILBOX_ATTACHMENT_BYTES) {
        return null;
      }
      const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
      if (!MAILBOX_ATTACHMENT_EXTENSIONS.has(extension)) return null;
      totalBytes += size;
      if (totalBytes > MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES) return null;
      const metadata = {
        filename,
        contentType: normalizeContentType(attachment?.contentType || attachment?.type, filename),
        size,
      };
      if (Object.prototype.hasOwnProperty.call(attachment || {}, 'sha256')) {
        const sha256 = typeof attachment.sha256 === 'string' ? attachment.sha256 : '';
        if (!MAILBOX_ATTACHMENT_SHA256_PATTERN.test(sha256)) return null;
        metadata.sha256 = sha256;
      }
      return metadata;
    })
    .filter(Boolean);
  return totalBytes <= MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES ? normalized : [];
}

module.exports = {
  MAILBOX_ATTACHMENT_CONTENT_TYPE_BY_EXTENSION,
  MAILBOX_ATTACHMENT_EXTENSIONS,
  MAILBOX_ATTACHMENT_SHA256_PATTERN,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS,
  MAX_MAILBOX_ATTACHMENTS_TOTAL_BYTES,
  normalizeAttachmentMetadata,
  normalizeContentType,
  safeFilename,
};
