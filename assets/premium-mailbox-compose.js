(function (global) {
  'use strict';

  let rewriteUsed = false;
  let selectedAttachments = [];
  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
  const MAX_SEND_JSON_BYTES = 4 * 1000 * 1000;
  const ATTACHMENT_MAX_ATTEMPTS = 2;
  const ATTACHMENT_PLAN_TIMEOUT_MS = 90_000;
  const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000;
  const ATTACHMENT_CLEANUP_TIMEOUT_MS = 10_000;
  const ATTACHMENT_STAGING_TIMEOUT_MS = 210_000;
  const ALLOWED_EXTENSIONS = new Set([
    'csv', 'doc', 'docx', 'gif', 'jpeg', 'jpg', 'pdf', 'png',
    'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx',
  ]);

  function safeFilename(value) {
    const normalized = String(value || '').trim()
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

  async function addAttachments(fileList, documentRef = global.document) {
    const files = Array.from(fileList || []);
    if (!files.length) return { ok: true };
    if (selectedAttachments.length + files.length > MAX_ATTACHMENTS) {
      return { ok: false, error: `Je kunt maximaal ${MAX_ATTACHMENTS} bijlagen toevoegen.` };
    }
    let totalBytes = selectedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const prepared = [];
    for (const file of files) {
      const filename = safeFilename(file && file.name);
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
      prepared.push({
        filename,
        contentType: String(file.type || '').trim().toLowerCase(),
        size,
        file,
      });
    }
    selectedAttachments = [...selectedAttachments, ...prepared];
    renderAttachments(documentRef);
    return { ok: true };
  }

  function serializedByteLength(value) {
    const serialized = String(value || '');
    if (typeof global.TextEncoder === 'function') return new global.TextEncoder().encode(serialized).length;
    return serialized.length;
  }

  function serializeSendPayload(payload) {
    const serialized = JSON.stringify(payload);
    if (serializedByteLength(serialized) > MAX_SEND_JSON_BYTES) {
      const error = new Error('De verzendgegevens zijn te groot; kies de bijlagen opnieuw.');
      error.status = 413;
      error.code = 'FUNCTION_PAYLOAD_TOO_LARGE';
      throw error;
    }
    return serialized;
  }

  function mailboxError(error, fallback, context = '') {
    return global.SoftoraMailboxError?.normalize?.(error, fallback, context)
      || String(error?.message || fallback);
  }

  function createAttachmentError(options = {}) {
    const error = new Error(String(options.message || 'Bijlage uploaden mislukt. Je mail is niet verzonden.'));
    error.code = String(options.code || 'MAILBOX_ATTACHMENT_UPLOAD_FAILED');
    error.status = Number(options.status) || 400;
    error.retryable = options.retryable === true;
    if (options.cause) error.cause = options.cause;
    return error;
  }

  async function runAttachmentWithDeadline(operation, options = {}) {
    const timeoutMs = Math.max(1, Math.min(300_000, Number(options.timeoutMs) || 1));
    const deadlineError = createAttachmentError(options);
    const controller = options.controller || null;
    let timedOut = false;
    let timeout = null;
    const deadline = new Promise((_, reject) => {
      timeout = global.setTimeout(() => {
        timedOut = true;
        controller?.abort?.();
        reject(deadlineError);
      }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), deadline]);
    } catch (error) {
      if (!timedOut) throw error;
      if (error !== deadlineError) deadlineError.cause = error;
      throw deadlineError;
    } finally {
      if (timeout !== null) global.clearTimeout(timeout);
    }
  }

  function attachmentNow(options = {}) {
    const value = typeof options.now === 'function' ? options.now() : Date.now();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function createStagingTimeoutError() {
    return createAttachmentError({
      code: 'MAILBOX_ATTACHMENT_STAGING_TIMEOUT',
      message: 'Bijlageverwerking duurde in totaal te lang; de mail is niet verzonden.',
      status: 504,
      retryable: false,
    });
  }

  function getAttachmentRequestDeadline(options, requestedTimeoutMs) {
    const requested = Math.max(1, Number(requestedTimeoutMs) || ATTACHMENT_PLAN_TIMEOUT_MS);
    const remaining = Number(options?.stagingDeadlineAt) - attachmentNow(options);
    if (!Number.isFinite(remaining)) return { timeoutMs: requested };
    if (remaining <= 0) throw createStagingTimeoutError();
    const stagingLimited = remaining <= requested;
    return {
      timeoutMs: Math.max(1, Math.min(requested, remaining)),
      ...(stagingLimited ? {
        code: 'MAILBOX_ATTACHMENT_STAGING_TIMEOUT',
        message: 'Bijlageverwerking duurde in totaal te lang; de mail is niet verzonden.',
        status: 504,
        retryable: false,
      } : {}),
    };
  }

  function getAttachmentRetryDelay(options = {}) {
    if (options.retryDelayMs === undefined || options.retryDelayMs === null) return 100;
    const configured = Number(options.retryDelayMs);
    return Number.isFinite(configured) ? Math.max(0, Math.min(500, configured)) : 100;
  }

  async function waitBeforeAttachmentRetry(options = {}) {
    const delayMs = getAttachmentRetryDelay(options);
    if (!delayMs) return;
    const deadline = getAttachmentRequestDeadline(options, delayMs);
    await runAttachmentWithDeadline(
      () => typeof options.sleep === 'function'
        ? options.sleep(delayMs)
        : new Promise((resolve) => global.setTimeout(resolve, delayMs)),
      {
        ...deadline,
        code: 'MAILBOX_ATTACHMENT_STAGING_TIMEOUT',
        message: 'Bijlageverwerking duurde in totaal te lang; de mail is niet verzonden.',
        status: 504,
        retryable: false,
      }
    );
  }

  function attachmentErrorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;
    while (current && (typeof current === 'object' || typeof current === 'function') && chain.length < 8) {
      if (seen.has(current)) break;
      seen.add(current);
      chain.push(current);
      current = current.cause || current.originalError || null;
    }
    return chain;
  }

  function isRetryableAttachmentStatus(status) {
    const numericStatus = Number(status || 0);
    return [408, 425, 429].includes(numericStatus)
      || (numericStatus >= 500 && numericStatus <= 599);
  }

  function isDefinitiveAttachmentClientStatus(status) {
    const numericStatus = Number(status || 0);
    return numericStatus >= 400 && numericStatus <= 499
      && ![408, 425, 429].includes(numericStatus);
  }

  function isRetryableAttachmentError(error) {
    const chain = attachmentErrorChain(error);
    const statuses = chain.map((item) => Number(
      item?.status || item?.statusCode || item?.response?.status || 0
    )).filter((status) => Number.isFinite(status) && status > 0);
    if (statuses.some(isDefinitiveAttachmentClientStatus)) return false;
    if (chain.some((item) => item?.retryable === false)) return false;
    return chain.some((item) => {
      const status = Number(item?.status || item?.statusCode || item?.response?.status || 0);
      const code = String(item?.code || '').trim().toUpperCase();
      const text = String(item?.message || item?.name || item || '').trim();
      return item?.retryable === true
        || isRetryableAttachmentStatus(status)
        || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
          'MAILBOX_ATTACHMENT_REQUEST_TIMEOUT', 'MAILBOX_ATTACHMENT_PLAN_INVALID'].includes(code)
        || /abort|timeout|timed out|fetch failed|network|econnreset|etimedout|connection terminated|temporar/i.test(text);
    });
  }

  async function fetchAttachmentRequest(fetchImpl, url, request, deadlineOptions, consumeResponse = (response) => response) {
    const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    const deadline = typeof deadlineOptions === 'object'
      ? deadlineOptions
      : { timeoutMs: deadlineOptions };
    return runAttachmentWithDeadline(async () => {
      const response = await fetchImpl(url, {
        ...request,
        ...(controller ? { signal: controller.signal } : {}),
      });
      return consumeResponse(response);
    }, {
      code: 'MAILBOX_ATTACHMENT_REQUEST_TIMEOUT',
      message: 'Bijlageverwerking duurde te lang; de mail is niet verzonden.',
      status: 504,
      retryable: true,
      ...deadline,
      controller,
    });
  }

  function createAttachmentResponseError(response, payload, fallback) {
    const error = global.SoftoraMailboxError?.fromResponse?.(
      response,
      payload,
      fallback,
      'attachment-upload'
    ) || new Error(mailboxError(payload, fallback, 'attachment-upload'));
    if (!Number(error.status)) error.status = Number(response?.status) || 0;
    if (isDefinitiveAttachmentClientStatus(error.status) || payload?.retryable === false) error.retryable = false;
    else if (payload?.retryable === true || isRetryableAttachmentStatus(response?.status)) error.retryable = true;
    return error;
  }

  function isValidSignedUploadUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      return parsed.protocol === 'https:' && Boolean(parsed.hostname)
        && !parsed.username && !parsed.password;
    } catch (_) {
      return false;
    }
  }

  function isValidAttachmentContentType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.length <= 128
      && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(normalized);
  }

  function validateUploadPlan(uploads, attachments, options = {}) {
    if (!Array.isArray(uploads) || uploads.length !== attachments.length) return false;
    const references = new Set();
    const signedUrls = new Set();
    let batchExpiresAt = null;
    const now = attachmentNow(options);
    return uploads.every((upload, index) => {
      const attachment = attachments[index];
      const rawReference = typeof upload?.reference === 'string' ? upload.reference : '';
      const rawSignedUrl = typeof upload?.signedUrl === 'string' ? upload.signedUrl : '';
      const reference = rawReference.trim();
      const signedUrl = rawSignedUrl.trim();
      const filename = typeof upload?.filename === 'string' ? upload.filename : '';
      const contentType = typeof upload?.contentType === 'string' ? upload.contentType : '';
      const size = upload?.size;
      const expiresAt = upload?.expiresAt;
      const valid = Boolean(reference)
        && rawReference === reference
        && !references.has(reference)
        && rawSignedUrl === signedUrl
        && isValidSignedUploadUrl(signedUrl)
        && !signedUrls.has(signedUrl)
        && filename === String(attachment?.filename || '')
        && Number.isSafeInteger(size)
        && size > 0
        && size === Number(attachment?.size)
        && contentType === contentType.trim().toLowerCase()
        && isValidAttachmentContentType(contentType)
        && Number.isSafeInteger(expiresAt)
        && expiresAt > now
        && (batchExpiresAt === null || expiresAt === batchExpiresAt);
      if (!valid) return false;
      references.add(reference);
      signedUrls.add(signedUrl);
      if (batchExpiresAt === null) batchExpiresAt = expiresAt;
      return true;
    });
  }

  function getCleanupReferences(value) {
    return (Array.isArray(value) ? value : []).map((upload) => ({
      reference: String(upload?.reference || '').trim(),
      filename: String(upload?.filename || '').trim(),
      contentType: String(upload?.contentType || '').trim().toLowerCase(),
      size: Math.max(0, Number(upload?.size) || 0),
    })).filter((upload) => upload.reference);
  }

  function startAttachmentCleanup(options, references) {
    if (!references.length) return;
    cleanupUploadedAttachments(options, references).catch((error) => {
      options.logger?.warn?.('[MailboxCompose][AttachmentCleanup]', error?.message || error);
    });
  }

  async function requestAttachmentUploadPlan(fetchImpl, uploadPayload, attachments, options = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < ATTACHMENT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const planDeadline = getAttachmentRequestDeadline(
          options,
          options.planTimeoutMs ?? ATTACHMENT_PLAN_TIMEOUT_MS
        );
        const { response, data } = await fetchAttachmentRequest(fetchImpl, '/api/mailbox/attachments/upload-url', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: serializeSendPayload(uploadPayload),
        }, planDeadline, async (response) => {
          if (isDefinitiveAttachmentClientStatus(response?.status)) {
            return { response, data: {} };
          }
          let data = null;
          try {
            data = await response.json();
          } catch (error) {
            if (response?.ok) {
              throw createAttachmentError({
                code: 'MAILBOX_ATTACHMENT_PLAN_INVALID',
                message: 'Bijlage uploaden mislukt. Je mail is niet verzonden.',
                status: 502,
                retryable: true,
                cause: error,
              });
            }
          }
          return { response, data: data && typeof data === 'object' ? data : {} };
        });
        if (!response?.ok) {
          throw createAttachmentResponseError(
            response,
            data,
            'Bijlage uploaden mislukt. Je mail is niet verzonden.'
          );
        }
        const uploads = Array.isArray(data?.uploads) ? data.uploads : [];
        if (data?.ok !== true || !validateUploadPlan(uploads, attachments, options)) {
          startAttachmentCleanup(options, getCleanupReferences(uploads));
          throw createAttachmentError({
            code: 'MAILBOX_ATTACHMENT_PLAN_INVALID',
            message: 'Bijlage uploaden mislukt. Je mail is niet verzonden.',
            status: 502,
            retryable: true,
          });
        }
        return uploads;
      } catch (error) {
        lastError = error;
        if (!isRetryableAttachmentError(error) || attempt >= ATTACHMENT_MAX_ATTEMPTS - 1) throw error;
        await waitBeforeAttachmentRetry(options);
      }
    }
    throw lastError;
  }

  async function cleanupUploadedAttachments(options, references) {
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (typeof fetchImpl !== 'function' || !references.length) return;
    for (let attempt = 0; attempt < ATTACHMENT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchAttachmentRequest(fetchImpl, '/api/mailbox/attachments/cleanup', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: serializeSendPayload({ ...options.payload, attachments: references }),
        }, options.cleanupTimeoutMs ?? ATTACHMENT_CLEANUP_TIMEOUT_MS);
        if (response?.ok || !isRetryableAttachmentStatus(response?.status)) return;
      } catch (error) {
        if (!isRetryableAttachmentError(error)) return;
      }
      if (attempt < ATTACHMENT_MAX_ATTEMPTS - 1) await waitBeforeAttachmentRetry(options);
    }
  }

  async function uploadAttachments(attachments, options = {}) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return [];
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (typeof fetchImpl !== 'function') {
      throw new Error('Bijlage uploaden is tijdelijk niet beschikbaar.');
    }
    const configuredStagingBudget = Number(options.stagingTimeoutMs);
    const stagingBudgetMs = Math.max(1, Math.min(
      ATTACHMENT_STAGING_TIMEOUT_MS,
      Number.isFinite(configuredStagingBudget) && configuredStagingBudget > 0
        ? configuredStagingBudget
        : ATTACHMENT_STAGING_TIMEOUT_MS
    ));
    const operationOptions = {
      ...options,
      stagingDeadlineAt: attachmentNow(options) + stagingBudgetMs,
    };
    const metadata = list.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    }));
    const uploadPayload = { ...options.payload, attachments: metadata };
    const uploads = await requestAttachmentUploadPlan(fetchImpl, uploadPayload, list, operationOptions);
    try {
      for (const [index, upload] of uploads.entries()) {
        const attachment = list[index];
        const file = attachment.file;
        if (!file || Number(file.size) !== Number(attachment.size)) {
          throw createAttachmentError({ message: 'Bijlage uploaden mislukt. Je mail is niet verzonden.' });
        }
        let lastUploadError = null;
        for (let attempt = 0; attempt < ATTACHMENT_MAX_ATTEMPTS; attempt += 1) {
          try {
            const uploadRequest = {
              method: 'PUT',
              headers: { 'x-upsert': 'true' },
            };
            try {
              const FormDataCtor = options.FormData || global.FormData;
              if (typeof FormDataCtor !== 'function') throw new Error('FormData ontbreekt');
              const canonicalFile = typeof file.slice === 'function'
                ? file.slice(0, file.size, upload.contentType)
                : file;
              const form = new FormDataCtor();
              form.append('cacheControl', '3600');
              form.append('', canonicalFile, upload.filename);
              uploadRequest.body = form;
            } catch (_) {
              uploadRequest.body = file;
              uploadRequest.headers['content-type'] = upload.contentType;
            }
            const uploadDeadline = getAttachmentRequestDeadline(
              operationOptions,
              options.uploadTimeoutMs ?? ATTACHMENT_UPLOAD_TIMEOUT_MS
            );
            const { response: uploadResponse, data: uploadData } = await fetchAttachmentRequest(
              fetchImpl,
              upload.signedUrl,
              uploadRequest,
              uploadDeadline,
              async (response) => {
                if (response?.ok) return { response, data: {} };
                if (isDefinitiveAttachmentClientStatus(response?.status)) {
                  return { response, data: {} };
                }
                let data = {};
                try {
                  const parsed = await response.json();
                  if (parsed && typeof parsed === 'object') data = parsed;
                } catch (_) {
                  // HTTP status remains the authoritative retry signal.
                }
                return { response, data };
              }
            );
            if (!uploadResponse?.ok) {
              throw createAttachmentResponseError(
                uploadResponse,
                uploadData,
                'Bijlage uploaden mislukt. Je mail is niet verzonden.'
              );
            }
            lastUploadError = null;
            break;
          } catch (error) {
            lastUploadError = error;
            if (!isRetryableAttachmentError(error) || attempt >= ATTACHMENT_MAX_ATTEMPTS - 1) throw error;
            await waitBeforeAttachmentRetry(operationOptions);
          }
        }
        if (lastUploadError) throw lastUploadError;
      }
      return uploads.map(({ reference, filename, contentType, size }) => ({
        reference,
        filename,
        contentType,
        size,
      }));
    } catch (error) {
      startAttachmentCleanup(options, getCleanupReferences(uploads));
      const normalized = mailboxError(error, 'Bijlage uploaden mislukt. Je mail is niet verzonden.', 'attachment-upload');
      const safeError = new Error(normalized);
      safeError.code = error?.code || 'MAILBOX_ATTACHMENT_UPLOAD_FAILED';
      safeError.status = Number(error?.status) || 400;
      safeError.retryable = error?.retryable === true;
      safeError.cause = error;
      throw safeError;
    }
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
    const accountEmail = getAccount(mail, options.fallbackAccount);
    const owner = typeof options.getOwner === 'function' ? options.getOwner(mail, accountEmail) : mail.providerOwner;
    const replyIdentity = global.SoftoraMailboxReplyIdentity?.createReplyIdentity?.(mail, accountEmail, owner) || null;
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
      messageKey: String(mail.messageKey || '').trim(),
      messageId: String(mail.messageId || '').trim(),
      inReplyTo: String(mail.inReplyTo || '').trim(),
      references: String(mail.references || '').trim(),
      conversationId: String(mail.conversationId || '').trim(),
      accountEmail,
      ...(replyIdentity ? { replyIdentity } : {}),
      ...(String(mail.provider || '').trim()
        ? {
            provider: String(mail.provider || '').trim().toLowerCase(),
            providerAccountEmail: String(mail.providerAccountEmail || '').trim().toLowerCase(),
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
            providerAccountEmail: String(latest.providerAccountEmail || mail.providerAccountEmail || '').trim().toLowerCase(),
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
    serializeSendPayload,
    uploadAttachments,
    isUsed: () => rewriteUsed,
    reset,
    resetOptionalFields,
    removeAttachment,
    toggleCopyFields,
  };
  global.SoftoraMailboxCompose = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
