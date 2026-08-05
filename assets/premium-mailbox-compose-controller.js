(function (global) {
  function create(options = {}) {
    const documentRef = options.document || global.document;
    const acceptedSends = new Map();
    let replyContext = null;
    let replyOwner = '';

    function normalize(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeMessageId(value) {
      return normalize(value).replace(/^<+|>+$/g, '');
    }

    function getMessageIdentity(message) {
      const providerMessageId = normalize(message?.providerMessageId);
      if (providerMessageId) return `provider:${providerMessageId}`;
      const messageId = normalizeMessageId(message?.messageId);
      if (messageId) return `message:${messageId}`;
      return `local:${normalize(message?.id || message?.mailboxId)}`;
    }

    function getConversationKeys(mail) {
      return new Set([
        mail?.id,
        mail?.mailboxId,
        mail?.conversationId,
        mail?.providerThreadId && `provider-thread:${normalize(mail.providerThreadId)}`,
        mail?.messageId && `message:${normalizeMessageId(mail.messageId)}`,
      ].map((value) => String(value || '').trim()).filter(Boolean));
    }

    function recordMatchesMail(record, mail) {
      if (!record || !mail) return false;
      if (normalize(record.owner) !== normalize(options.campaignInbox?.getMessageOwner?.(mail))) return false;
      if (normalize(record.accountEmail) !== normalize(mail.accountEmail)) return false;
      const keys = getConversationKeys(mail);
      return (Array.isArray(record.conversationKeys) ? record.conversationKeys : [])
        .some((key) => keys.has(String(key || '').trim()));
    }

    function reconcile(mail) {
      if (!mail) return mail;
      const records = Array.from(acceptedSends.values()).filter((record) => recordMatchesMail(record, mail));
      if (!records.length) return mail;
      const messages = Array.isArray(mail.threadMessages) ? mail.threadMessages.slice() : [];
      const identities = new Set([mail, ...messages].map(getMessageIdentity).filter(Boolean));
      records
        .sort((left, right) => Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt))
        .forEach((record) => {
          const normalizedMessage = typeof options.normalizeAcceptedMessage === 'function'
            ? options.normalizeAcceptedMessage(record.message)
            : { ...record.message };
          const identity = getMessageIdentity(normalizedMessage);
          if (identity && !identities.has(identity)) {
            messages.push(normalizedMessage);
            identities.add(identity);
          }
          const acceptedAt = String(record.acceptedAt || '');
          mail.latestOutboundAt = acceptedAt;
          mail.unread = false;
          mail.replyDismissedAt = acceptedAt;
        });
      mail.threadMessages = messages.sort((left, right) => (
        Date.parse(String(right?.receivedAt || right?.date || '')) - Date.parse(String(left?.receivedAt || left?.date || ''))
      ));
      return mail;
    }

    function rememberAcceptedSend(record) {
      if (!record?.key) return;
      acceptedSends.set(record.key, record);
      options.onAcceptedSend?.(record);
    }

    function fieldValue(id) {
      return String(documentRef?.getElementById(id)?.value || '');
    }

    function setReplyContext(mail) {
      replyContext = mail
        ? options.compose.buildReplyContext(mail, {
            activeFolder: options.getActiveFolder(),
            fallbackAccount: options.getAccount(),
            getAccount: options.campaignInbox.getAccount,
          })
        : null;
      replyOwner = mail
        ? String(options.campaignInbox?.getMessageOwner?.(mail) || options.getOwner?.() || '').trim().toLowerCase()
        : '';
    }

    function assertReplyOwner() {
      const selectedOwner = String(options.getOwner?.() || '').trim().toLowerCase();
      if (selectedOwner === 'both') {
        if (replyOwner && options.campaignInbox?.isPersonalOwner?.(replyOwner)) return;
        throw new Error('De echte afzender van dit bericht kon niet veilig worden vastgesteld.');
      }
      if (replyOwner && selectedOwner && replyOwner !== selectedOwner) {
        throw new Error('Deze composer hoort bij een andere mailbox. Open het bericht opnieuw.');
      }
    }

    function buildRewriteContext() {
      if (!replyContext) return null;
      const currentMail = options.findMail(replyContext.id);
      return currentMail
        ? options.compose.buildReplyContext(currentMail, {
            activeFolder: options.getActiveFolder(),
            fallbackAccount: options.getAccount(),
            getAccount: options.campaignInbox.getAccount,
          })
        : { ...replyContext };
    }

    function open(optionsOverride = {}) {
      if (!optionsOverride.keepContext) {
        setReplyContext(null);
        options.compose.resetOptionalFields();
      }
      options.compose.reset(Boolean(replyContext && replyContext.mode !== 'new-message'));
      options.composeWindow?.reset?.();
      documentRef?.getElementById('compose-overlay')?.classList.add('open');
    }

    function close() {
      documentRef?.getElementById('compose-overlay')?.classList.remove('open');
      options.composeWindow?.reset?.();
      setReplyContext(null);
      options.compose.reset(false);
      options.compose.resetOptionalFields();
      ['c-to', 'c-subject', 'c-body'].forEach((id) => {
        const field = documentRef?.getElementById(id);
        if (field) field.value = '';
      });
    }

    function reply(mail) {
      if (!mail) return;
      options.compose.resetOptionalFields();
      setReplyContext(mail);
      const toField = documentRef?.getElementById('c-to');
      const subjectField = documentRef?.getElementById('c-subject');
      if (toField) {
        toField.value = options.display.getReplyToAddress(mail, {
          activeFolder: options.getActiveFolder(),
          account: options.getAccount(),
        });
      }
      if (subjectField) {
        const subject = options.display.formatDetailSubject(mail.subject);
        subjectField.value = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
      }
      open({ keepContext: true });
    }

    function newMessage(mail) {
      if (!mail) return;
      const action = options.campaignInbox.getConversationAction?.(mail);
      if (!action || action.kind !== 'new-message') return;
      options.compose.resetOptionalFields();
      replyContext = options.compose.buildNewMessageContext(mail, {
        latestMessage: action.message,
        fallbackAccount: options.getAccount(),
      });
      replyOwner = String(
        options.campaignInbox?.getMessageOwner?.(mail) || options.getOwner?.() || ''
      ).trim().toLowerCase();
      if (!replyContext) {
        options.toast('Ontvanger of afzender ontbreekt');
        return;
      }
      const toField = documentRef?.getElementById('c-to');
      const subjectField = documentRef?.getElementById('c-subject');
      if (toField) toField.value = replyContext.to;
      if (subjectField) subjectField.value = replyContext.subject;
      open({ keepContext: true });
    }

    async function rewrite() {
      if (options.compose.isUsed()) return;
      const bodyField = documentRef?.getElementById('c-body');
      const draft = String(bodyField?.value || '').trim();
      const isSuggestedReply = Boolean(replyContext && replyContext.mode !== 'new-message');
      if (!draft && !isSuggestedReply) {
        options.toast('Typ eerst je mailtekst');
        return;
      }
      const rewriteBtn = documentRef?.querySelector('[data-mailbox-action="rewrite-compose"]');
      const sendBtn = documentRef?.querySelector('.btn-send');
      const originalLabel = rewriteBtn ? rewriteBtn.textContent : '';
      if (rewriteBtn) {
        rewriteBtn.disabled = true;
        rewriteBtn.textContent = 'Bezig...';
      }
      if (sendBtn) sendBtn.disabled = true;
      try {
        assertReplyOwner();
        const replyAccount = options.normalizeEmail(replyContext && replyContext.accountEmail) || options.getAccount();
        const senderProfile = await options.loadSenderProfile(replyAccount);
        const response = await options.fetch('/api/mailbox/rewrite', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            account: replyAccount,
            to: fieldValue('c-to'),
            subject: fieldValue('c-subject'),
            body: draft,
            senderProfile,
            context: buildRewriteContext(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || (isSuggestedReply ? 'Reactie voorstellen mislukt' : 'Mailtekst verbeteren mislukt'));
        }
        const rewritten = String(data?.text || data?.result?.text || '').trim();
        if (!rewritten) throw new Error('Geen verbeterde tekst ontvangen');
        bodyField.value = rewritten;
        options.compose.complete(rewriteBtn);
        options.toast(isSuggestedReply ? 'Reactie voorgesteld' : 'Tekst verbeterd');
      } catch (error) {
        options.toast(String(error?.message || error || (isSuggestedReply ? 'Reactie voorstellen mislukt' : 'Mailtekst verbeteren mislukt')));
      } finally {
        options.compose.finish(
          rewriteBtn,
          originalLabel || (isSuggestedReply ? 'Voorgestelde reactie' : 'Verwoord dit beter')
        );
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    async function send() {
      const to = fieldValue('c-to').trim();
      const subject = fieldValue('c-subject').trim();
      if (!to || !subject) {
        options.toast('Vul ontvanger en onderwerp in');
        return;
      }
      const account = options.normalizeEmail(replyContext && replyContext.accountEmail) || options.getAccount();
      const sendBtn = documentRef?.querySelector('.btn-send');
      const originalSendLabel = sendBtn ? sendBtn.textContent : '';
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.setAttribute?.('aria-busy', 'true');
        sendBtn.textContent = 'Versturen…';
      }
      try {
        assertReplyOwner();
        const contextAtSend = replyContext ? { ...replyContext } : null;
        const provider = String(replyContext && replyContext.provider || '').trim().toLowerCase();
        const attachments = options.compose.getAttachments();
        if (provider === 'instantly' && attachments.length) {
          throw new Error('Instantly ondersteunt geen bijlagen bij antwoorden; verwijder de bijlage of verstuur via de gewone mailbox.');
        }
        const response = await options.fetch('/api/mailbox/send', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            account,
            ...(provider
              ? {
                  owner: replyOwner,
                  provider,
                  providerMessageId: String(replyContext && replyContext.providerMessageId || '').trim(),
                  providerThreadId: String(replyContext && replyContext.providerThreadId || '').trim(),
                }
              : {}),
            to,
            cc: fieldValue('c-cc'),
            bcc: fieldValue('c-bcc'),
            subject,
            body: fieldValue('c-body'),
            attachments,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Mail verzenden mislukt');
        }
        const result = data?.result && typeof data.result === 'object' ? data.result : {};
        const acceptedAt = new Date().toISOString();
        const messageId = String(result.messageId || '').trim();
        const providerMessageId = String(result.providerMessageId || '').trim();
        const contextMail = contextAtSend ? options.findMail(contextAtSend.id) : null;
        const conversationKeys = Array.from(getConversationKeys(contextMail || contextAtSend));
        if (contextAtSend?.providerThreadId) {
          conversationKeys.push(`provider-thread:${normalize(contextAtSend.providerThreadId)}`);
        }
        const sentMessage = {
          ...(result.sentMessage && typeof result.sentMessage === 'object' ? result.sentMessage : {}),
          id: providerMessageId ? `instantly:${providerMessageId}` : `accepted-sent:${messageId || acceptedAt}`,
          mailboxId: providerMessageId ? `instantly:${providerMessageId}` : `accepted-sent:${messageId || acceptedAt}`,
          folder: 'sent',
          storageFolder: provider === 'instantly' ? 'instantly' : 'sent',
          direction: 'sent',
          accountEmail: account,
          provider,
          providerOwner: replyOwner,
          providerMessageId,
          providerThreadId: String(result.providerThreadId || contextAtSend?.providerThreadId || '').trim(),
          messageId: String(result.sentMessage?.messageId || messageId).trim(),
          from: String(result.sentMessage?.from || options.campaignInbox?.getOwnerLabel?.(replyOwner) || account),
          email: String(result.sentMessage?.email || account),
          to: String(result.sentMessage?.to || to),
          toDisplay: String(result.sentMessage?.toDisplay || result.sentMessage?.to || to),
          cc: String(result.sentMessage?.cc || fieldValue('c-cc')),
          bcc: String(result.sentMessage?.bcc || fieldValue('c-bcc')),
          recipientRoutingEvidenceKnown: true,
          subject,
          body: fieldValue('c-body'),
          preview: fieldValue('c-body'),
          receivedAt: String(result.sentMessage?.receivedAt || acceptedAt),
          activityAt: String(result.sentMessage?.activityAt || result.sentMessage?.receivedAt || acceptedAt),
          hasBody: true,
          bodyLoaded: true,
          bodyTruncated: false,
          unread: false,
          replyDismissedAt: acceptedAt,
          localAcceptedSend: true,
        };
        const identity = getMessageIdentity(sentMessage);
        rememberAcceptedSend({
          key: `${normalize(replyOwner)}|${normalize(account)}|${identity}`,
          owner: normalize(replyOwner),
          accountEmail: normalize(account),
          acceptedAt,
          conversationKeys: Array.from(new Set(conversationKeys.filter(Boolean))),
          message: sentMessage,
        });
        close();
        options.toast('✓ Mail verzonden');
      } catch (error) {
        options.toast(String(error?.message || error || 'Mail verzenden mislukt'));
      } finally {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.removeAttribute?.('aria-busy');
          sendBtn.textContent = originalSendLabel || 'Versturen';
        }
      }
    }

    function handleAction(action, id) {
      if (action === 'close-compose') close();
      else if (action === 'send-mail') void send();
      else if (action === 'rewrite-compose') void rewrite();
      else if (action === 'toggle-copy-fields') options.compose.toggleCopyFields();
      else if (action === 'choose-attachments') documentRef?.getElementById('c-attachments')?.click();
      else if (action === 'remove-attachment') options.compose.removeAttachment(id);
      else if (action === 'reply-mail') reply(options.findMail(id));
      else if (action === 'new-message') newMessage(options.findMail(id));
      else return false;
      return true;
    }

    function bind() {
      const overlay = documentRef?.getElementById('compose-overlay');
      overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) close();
      });
      const input = documentRef?.getElementById('c-attachments');
      input?.addEventListener('change', async () => {
        const result = await options.compose.addAttachments(input.files);
        input.value = '';
        if (!result.ok) options.toast(result.error);
      });
    }

    return {
      bind,
      close,
      getContext: () => replyContext,
      handleAction,
      newMessage,
      open,
      reply,
      rewrite,
      reconcile,
      send,
    };
  }

  const api = { create };
  global.SoftoraMailboxComposeController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
