(function (global) {
  'use strict';

  let rewriteUsed = false;
  let selectedAttachments = [];
  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set([
    'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
    'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
  ]);

  function getRewriteButton(documentRef = global.document) {
    return documentRef?.querySelector?.('[data-mailbox-action="rewrite-compose"]') || null;
  }

  function reset(isSuggestedReply = false, documentRef = global.document) {
    rewriteUsed = false;
    const button = getRewriteButton(documentRef);
    if (!button) return;
    button.hidden = false;
    button.disabled = false;
    button.textContent = isSuggestedReply ? 'Voorgestelde reactie' : 'Verwoord dit beter';
  }

  function complete(button) {
    rewriteUsed = true;
    if (button) button.hidden = true;
  }

  function finish(button, fallbackLabel) {
    if (!button) return;
    button.disabled = rewriteUsed;
    if (!rewriteUsed) button.textContent = fallbackLabel;
  }

  function renderAttachments(documentRef = global.document) {
    const target = documentRef?.getElementById?.('c-attachment-list');
    if (!target) return;
    target.innerHTML = selectedAttachments.map((attachment, index) => `
      <span class="compose-attachment-chip">
        <span>${String(attachment.filename || 'Bijlage').replace(/[&<>"']/g, (character) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[character]))}</span>
        <button type="button" data-mailbox-action="remove-attachment" data-attachment-index="${index}" aria-label="Bijlage verwijderen">×</button>
      </span>`).join('');
  }

  function resetOptionalFields(documentRef = global.document) {
    selectedAttachments = [];
    ['c-cc', 'c-bcc'].forEach((id) => {
      const field = documentRef?.getElementById?.(id);
      if (field) field.value = '';
    });
    const copyFields = documentRef?.getElementById?.('c-copy-fields');
    if (copyFields) copyFields.hidden = true;
    const input = documentRef?.getElementById?.('c-attachments');
    if (input) input.value = '';
    renderAttachments(documentRef);
  }

  function toggleCopyFields(documentRef = global.document) {
    const copyFields = documentRef?.getElementById?.('c-copy-fields');
    if (!copyFields) return;
    copyFields.hidden = !copyFields.hidden;
    if (!copyFields.hidden) documentRef?.getElementById?.('c-cc')?.focus?.();
  }

  function encodeBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return global.btoa(binary);
  }

  async function addAttachments(fileList, documentRef = global.document) {
    const files = Array.from(fileList || []);
    if (!files.length) return { ok: true };
    if (selectedAttachments.length + files.length > MAX_ATTACHMENTS) {
      return { ok: false, error: `Je kunt maximaal ${MAX_ATTACHMENTS} bijlagen toevoegen.` };
    }
    let totalBytes = selectedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const prepared = [];
    for (const file of files) {
      const filename = String(file && file.name || '').trim();
      const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
      const size = Math.max(0, Number(file && file.size) || 0);
      if (!filename || !ALLOWED_EXTENSIONS.has(extension)) {
        return { ok: false, error: `Bestand "${filename || 'zonder naam'}" wordt niet ondersteund.` };
      }
      if (!size || size > MAX_ATTACHMENT_BYTES) {
        return { ok: false, error: `Bijlage "${filename}" mag maximaal 4 MB zijn.` };
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return { ok: false, error: 'De bijlagen mogen samen maximaal 5 MB zijn.' };
      }
      const contentBase64 = encodeBase64(await file.arrayBuffer());
      prepared.push({
        filename,
        contentType: String(file.type || '').trim().toLowerCase(),
        size,
        contentBase64,
      });
    }
    selectedAttachments = [...selectedAttachments, ...prepared];
    renderAttachments(documentRef);
    return { ok: true };
  }

  function removeAttachment(index, documentRef = global.document) {
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= selectedAttachments.length) return;
    selectedAttachments.splice(safeIndex, 1);
    renderAttachments(documentRef);
  }

  function getMessageTimestamp(message) {
    const timestamp = Date.parse(String(message && (message.receivedAt || message.internalDate || message.date) || ''));
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }

  function getOriginalSentMail(mail) {
    const sentMessages = (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => String(message && message.folder || '').trim().toLowerCase() === 'sent')
      .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
    const original = sentMessages.find((message) => message && message.originalCampaignOutbound === true)
      || sentMessages[0];
    if (!original) return null;
    return {
      id: original.id || original.mailboxId || '',
      from: original.from || '',
      email: original.email || '',
      to: original.to || '',
      subject: original.subject || '',
      preview: original.preview || '',
      body: original.body || original.preview || '',
      date: original.date || original.receivedAt || '',
      folder: 'sent',
    };
  }

  function buildReplyContext(mail, options = {}) {
    if (!mail) return null;
    const getAccount = typeof options.getAccount === 'function' ? options.getAccount : () => '';
    return {
      id: mail.id,
      from: mail.from,
      email: mail.email,
      subject: mail.subject,
      preview: mail.preview,
      body: mail.body,
      date: mail.date,
      time: mail.time,
      folder: mail.folder || options.activeFolder || 'inbox',
      uid: Number(mail.uid || 0) || 0,
      mailboxId: String(mail.mailboxId || mail.id || '').trim(),
      messageId: String(mail.messageId || '').trim(),
      inReplyTo: String(mail.inReplyTo || '').trim(),
      references: String(mail.references || '').trim(),
      conversationId: String(mail.conversationId || '').trim(),
      accountEmail: getAccount(mail, options.fallbackAccount),
      ...(String(mail.provider || '').trim()
        ? {
            provider: String(mail.provider || '').trim().toLowerCase(),
            providerMessageId: String(mail.providerMessageId || '').trim(),
            providerThreadId: String(mail.providerThreadId || '').trim(),
            providerOwner: String(mail.providerOwner || '').trim().toLowerCase(),
          }
        : {}),
      originalSentMail: getOriginalSentMail(mail),
      mode: 'reply',
    };
  }

  function extractEmail(value) {
    const match = String(value || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? match[0].toLowerCase() : '';
  }

  function buildNewMessageContext(mail, options = {}) {
    if (!mail) return null;
    const latest = options.latestMessage && typeof options.latestMessage === 'object'
      ? options.latestMessage
      : mail;
    const copyContext = mail.copyContext && mail.copyContext.evidenceKnown === true
      ? mail.copyContext
      : null;
    const accountEmail = extractEmail(
      copyContext && copyContext.sourceAccountEmail ||
      latest.accountEmail ||
      mail.accountEmail ||
      options.fallbackAccount
    );
    const to = extractEmail(
      copyContext && copyContext.recipientEmail ||
      latest.to ||
      mail.email
    );
    if (!accountEmail || !to) return null;
    return {
      id: mail.id,
      mailboxId: String(mail.mailboxId || mail.id || '').trim(),
      conversationId: String(mail.conversationId || '').trim(),
      accountEmail,
      to,
      subject: String(latest.subject || mail.subject || '').trim(),
      ...(String(latest.provider || mail.provider || '').trim()
        ? {
            provider: String(latest.provider || mail.provider || '').trim().toLowerCase(),
            providerMessageId: String(latest.providerMessageId || mail.providerMessageId || '').trim(),
            providerThreadId: String(latest.providerThreadId || mail.providerThreadId || '').trim(),
            providerOwner: String(latest.providerOwner || mail.providerOwner || '').trim().toLowerCase(),
          }
        : {}),
      mode: 'new-message',
    };
  }

  const api = {
    buildNewMessageContext,
    buildReplyContext,
    addAttachments,
    complete,
    finish,
    getOriginalSentMail,
    getAttachments: () => selectedAttachments.map((attachment) => ({ ...attachment })),
    isUsed: () => rewriteUsed,
    reset,
    resetOptionalFields,
    removeAttachment,
    toggleCopyFields,
  };
  global.SoftoraMailboxCompose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
