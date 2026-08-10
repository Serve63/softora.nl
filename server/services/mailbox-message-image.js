const MAILBOX_MESSAGE_IMAGE_PATH = '/api/mailbox/message-image';
const MAILBOX_MESSAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAILBOX_MESSAGE_IMAGE_MAX_INDEX = 15;
const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i;

function text(value) {
  return String(value || '').trim();
}

function isMailboxMessageImageUrl(value) {
  const source = text(value);
  return source.startsWith(`${MAILBOX_MESSAGE_IMAGE_PATH}?`) && !/[\s"'<>]/.test(source);
}

function buildMailboxMessageImageUrl(message, imageIndex) {
  const source = message && typeof message === 'object' && !Array.isArray(message) ? message : {};
  const account = text(source.accountEmail).toLowerCase();
  const folder = text(source.folder || 'inbox').toLowerCase() || 'inbox';
  const id = text(source.mailboxId || source.id);
  const index = Number(imageIndex);
  if (!account || !id || !Number.isInteger(index) || index < 0 || index > MAILBOX_MESSAGE_IMAGE_MAX_INDEX) {
    return '';
  }
  const params = new URLSearchParams({ account, folder, id, index: String(index) });
  return `${MAILBOX_MESSAGE_IMAGE_PATH}?${params.toString()}`;
}

function decodeMailboxMessageImage(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const dataUrl = text(source.dataUrl || source.src);
  const match = dataUrl.match(IMAGE_DATA_URL_PATTERN);
  if (!match) return null;
  const contentType = String(match[1] || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  const content = Buffer.from(String(match[2] || '').replace(/\s+/g, ''), 'base64');
  if (!content.length || content.length > MAILBOX_MESSAGE_IMAGE_MAX_BYTES) return null;
  return {
    alt: text(source.alt || source.name || 'Afbeelding') || 'Afbeelding',
    contentType,
    content,
  };
}

module.exports = {
  MAILBOX_MESSAGE_IMAGE_MAX_INDEX,
  MAILBOX_MESSAGE_IMAGE_PATH,
  buildMailboxMessageImageUrl,
  decodeMailboxMessageImage,
  isMailboxMessageImageUrl,
};
