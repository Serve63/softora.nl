(function (global) {
  function create(options = {}) {
    const documentRef = options.document || global.document;
    const acceptedSends = new Map();
    let replyContext = null;
    let replyOwner = '';

    function normalize(value) {
      return String(value || '').trim().toLowerCase();
    }

    function isPersonalOwner(value) {
      const owner = normalize(value);
      return owner === 'serve' || owner === 'martijn';
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

    function getActionMessageKey(message) {
      const canonical = options.campaignInbox?.getActionMessageKey?.(message);
      if (canonical) return String(canonical).trim();
      const messageId = normalizeMessageId(message?.messageId);
      if (messageId) return `message:${messageId}`;
      const account = options.normalizeEmail(message?.accountEmail || '');
      const mailboxId = String(message?.mailboxId || message?.id || '').trim();
      return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
    }

    function normalizeRequestedMessageKey(value) {
      const key = String(value || '').trim();
      if (!key.toLowerCase().startsWith('message:')) return key;
      return `message:${normalizeMessageId(key.slice('message:'.length))}`;
    }

    function recordMatchesMail(record, mail) {
      if (!record || !mail) return false;
      if (normalize(record.owner) !== normalize(options.campaignInbox?.getMessageOwner?.(mail))) return false;
      if (normalize(record.accountEmail) !== normalize(mail.accountEmail)) return false;
      const keys = getConversationKeys(mail);
      return (Array.isArray(record.conversationKeys) ? record.conversationKeys : [])
        .some((key) => keys.has(String(key || '').trim()));
    }

    function getMailAccount(mail) {
      if (!mail) return '';
      const account = typeof options.campaignInbox?.getAccount === 'function'
        ? options.campaignInbox.getAccount(mail, options.getAccount?.())
        : mail.accountEmail || mail.campaign?.account || options.getAccount?.();
      return options.normalizeEmail(account || '');
    }

    function getReplyAccount(mail, fallbackAccount) {
      if (typeof options.campaignInbox?.resolveReplyAccount === 'function') {
        return options.normalizeEmail(options.campaignInbox.resolveReplyAccount(
          mail,
          fallbackAccount == null ? options.getAccount?.() : fallbackAccount,
          options.getOwner?.()
        ) || '');
      }
      return getMailAccount(mail);
    }

    function resolveOwnerForMail(mail, accountOverride = '') {
      const accountOwner = typeof options.campaignInbox?.getOwnerByAccount === 'function'
        ? normalize(options.campaignInbox.getOwnerByAccount(accountOverride || getMailAccount(mail)))
        : '';
      if (isPersonalOwner(accountOwner)) return accountOwner;
      const provenOwner = normalize(options.campaignInbox?.getMessageOwner?.(mail));
      return isPersonalOwner(provenOwner) ? provenOwner : '';
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
      if (!mail) {
        replyContext = null;
        replyOwner = '';
        return;
      }
      const replyAccount = getReplyAccount(mail);
      if (!replyAccount) throw new Error('Deze conversatie heeft geen veilige afzender voor de geselecteerde mailbox.');
      const resolvedOwner = resolveOwnerForMail(mail, replyAccount);
      replyContext = mail
        ? options.compose.buildReplyContext(mail, {
            activeFolder: options.getActiveFolder(),
            fallbackAccount: replyAccount,
            getAccount: () => replyAccount,
            getOwner: () => resolvedOwner,
          })
        : null;
      replyContext.accountEmail = replyAccount;
      replyOwner = resolvedOwner;
      replyContext.replyIdentity = {
        version: 1,
        provider: String(replyContext.replyIdentity?.provider || replyContext.provider || 'smtp').trim().toLowerCase(),
        owner: String(replyContext.replyIdentity?.owner || replyOwner).trim().toLowerCase(),
        accountEmail: options.normalizeEmail(replyContext.replyIdentity?.accountEmail || replyAccount),
        providerAccountEmail: options.normalizeEmail(
          replyContext.replyIdentity?.providerAccountEmail || replyContext.providerAccountEmail || ''
        ),
        providerMessageId: String(replyContext.replyIdentity?.providerMessageId || replyContext.providerMessageId || '').trim(),
        providerThreadId: String(replyContext.replyIdentity?.providerThreadId || replyContext.providerThreadId || '').trim(),
        sourceMessageId: String(replyContext.replyIdentity?.sourceMessageId || replyContext.messageId || '').trim(),
        conversationId: String(replyContext.replyIdentity?.conversationId || replyContext.conversationId || '').trim(),
      };
    }

    function resolveReplySource(mail, requestedMessageKey = '') {
      if (!mail) return null;
      const action = options.campaignInbox?.getConversationAction?.(mail);
      const requested = normalizeRequestedMessageKey(requestedMessageKey);
      if (requested) {
        const exact = [mail, ...(Array.isArray(mail.threadMessages) ? mail.threadMessages : [])]
          .find((message) => getActionMessageKey(message) === requested);
        const exactAction = exact && options.campaignInbox?.getConversationAction?.({ ...exact, threadMessages: [] });
        if (!exact || exactAction?.kind !== 'reply') {
          throw new Error('De geselecteerde reply is gewijzigd; open het bericht opnieuw.');
        }
        if (exact === mail) return mail;
        return {
          ...exact,
          conversationId: String(mail.conversationId || exact.conversationId || '').trim(),
          threadMessages: Array.isArray(mail.threadMessages) ? mail.threadMessages : [],
          campaign: exact.campaign || mail.campaign || null,
        };
      }
      if (!action || action.kind !== 'reply' || !action.message) return mail;
      if (action.isRoot) return mail;
      return {
        ...action.message,
        conversationId: String(mail.conversationId || action.message.conversationId || '').trim(),
        threadMessages: Array.isArray(mail.threadMessages) ? mail.threadMessages : [],
        campaign: action.message.campaign || mail.campaign || null,
      };
    }

    function assertReplyOwner(accountEmail = '') {
      const selectedOwner = String(options.getOwner?.() || '').trim().toLowerCase();
      const accountOwner = normalize(
        options.campaignInbox?.getOwnerByAccount?.(accountEmail)
      );
      if (isPersonalOwner(accountOwner)) replyOwner = accountOwner;
      if (selectedOwner === 'both') {
        if (isPersonalOwner(replyOwner)) return;
        throw new Error('De echte afzender van dit bericht kon niet veilig worden vastgesteld.');
      }
      if (selectedOwner && !isPersonalOwner(replyOwner)) {
        throw new Error('Deze composer hoort bij een andere mailbox. Open het bericht opnieuw.');
      }
      if (replyOwner && selectedOwner && replyOwner !== selectedOwner) {
        throw new Error('Deze composer hoort bij een andere mailbox. Open het bericht opnieuw.');
      }
    }

    function buildRewriteContext() {
      if (!replyContext) return null;
      const currentMail = options.findMail(replyContext.id);
      if (!currentMail) return { ...replyContext };
      const currentAccount = getReplyAccount(currentMail, replyContext.accountEmail);
      if (!currentAccount) throw new Error('De geselecteerde mailbox hoort niet bij deze conversatie.');
      const rebuilt = options.compose.buildReplyContext(currentMail, {
            activeFolder: options.getActiveFolder(),
            fallbackAccount: currentAccount,
            getAccount: () => currentAccount,
            getOwner: () => replyOwner,
          });
      rebuilt.replyIdentity = { ...replyContext.replyIdentity };
      return rebuilt;
    }

    function open(optionsOverride = {}) {
      if (!optionsOverride.keepContext) {
        setReplyContext(null);
        options.compose.resetOptionalFields();
      }
      options.compose.reset(Boolean(replyContext && replyContext.mode !== 'new-message'));
      options.composeWindow?.reset?.();
      documentRef?.getElementById('compose-overlay')?.classList.add('open');
      options.composeWindow?.open?.();
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

    function reply(mail, requestedMessageKey = '') {
      if (!mail) return;
      options.compose.resetOptionalFields();
      let replySource = mail;
      try {
        replySource = resolveReplySource(mail, requestedMessageKey);
        setReplyContext(replySource);
      } catch (error) {
        options.toast(String(error?.message || error));
        return;
      }
      const toField = documentRef?.getElementById('c-to');
      const subjectField = documentRef?.getElementById('c-subject');
      if (toField) {
        toField.value = options.display.getReplyToAddress(replySource, {
          activeFolder: options.getActiveFolder(),
          account: options.getAccount(),
        });
      }
      if (subjectField) {
        const subject = options.display.formatDetailSubject(replySource.subject);
        subjectField.value = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
      }
      open({ keepContext: true });
    }

    function newMessage(mail, requestedMessageKey = '') {
      if (!mail) return;
      const requested = normalizeRequestedMessageKey(requestedMessageKey);
      const exact = requested
        ? [mail, ...(Array.isArray(mail.threadMessages) ? mail.threadMessages : [])]
          .find((message) => getActionMessageKey(message) === requested)
        : null;
      const source = exact || mail;
      const action = options.campaignInbox.getConversationAction?.(exact ? { ...exact, threadMessages: [] } : mail);
      if (!action || action.kind !== 'new-message') return;
      options.compose.resetOptionalFields();
      replyContext = options.compose.buildNewMessageContext(source, {
        latestMessage: action.message,
        fallbackAccount: options.getAccount(),
      });
      replyOwner = String(
        resolveOwnerForMail(mail)
      ).trim().toLowerCase();
      if (!replyContext) {
        options.toast('Ontvanger of afzender ontbreekt');
        return;
      }
      if (!replyOwner) {
        replyContext = null;
        options.toast('Deze conversatie heeft geen veilige verzendmailbox; open het bericht opnieuw vanuit een persoonlijke mailbox.');
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
        const replyAccount = options.normalizeEmail(replyContext && replyContext.accountEmail) || options.getAccount();
        assertReplyOwner(replyAccount);
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
        const contextAtSend = replyContext ? { ...replyContext } : null;
        const currentMail = contextAtSend && options.findMail(contextAtSend.id);
        const canonicalIdentity = contextAtSend?.replyIdentity && typeof contextAtSend.replyIdentity === 'object'
          ? { ...contextAtSend.replyIdentity }
          : null;
        const account = contextAtSend?.mode === 'reply' && canonicalIdentity?.accountEmail
          ? options.normalizeEmail(canonicalIdentity.accountEmail)
          : contextAtSend
            ? getReplyAccount(currentMail || contextAtSend, contextAtSend.accountEmail)
          : options.normalizeEmail(options.getAccount());
        if (!account) throw new Error('Het afzenderaccount past niet bij de geselecteerde mailbox; open de reply opnieuw.');
        if (contextAtSend) contextAtSend.accountEmail = account;
        if (replyContext) replyContext.accountEmail = account;
        assertReplyOwner(account);
        const sendOwner = replyOwner;
        const sendMode = contextAtSend?.mode === 'reply' ? 'reply' : 'new-message';
        const idempotencyKey = String(contextAtSend?.sendIdempotencyKey || '').trim() || global.crypto?.randomUUID?.() || [
          'mailbox-send',
          Date.now(),
          Math.random().toString(36).slice(2),
        ].join(':');
        if (replyContext) replyContext.sendIdempotencyKey = idempotencyKey;
        const provider = String(canonicalIdentity?.provider || replyContext && replyContext.provider || '').trim().toLowerCase();
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
            owner: sendOwner,
            mode: sendMode,
            idempotencyKey,
            ...(canonicalIdentity ? { replyIdentity: canonicalIdentity } : {}),
            context: {
              conversationId: String(contextAtSend?.conversationId || '').trim(),
              id: String(contextAtSend?.mailboxId || contextAtSend?.id || '').trim(),
              folder: String(contextAtSend?.folder || '').trim().toLowerCase(),
              uid: Number(contextAtSend?.uid || 0) || 0,
              messageId: String(contextAtSend?.messageId || '').trim(),
              references: String(contextAtSend?.references || '').trim(),
              ...(canonicalIdentity ? { replyIdentity: canonicalIdentity } : {}),
            },
            ...(provider
              ? {
                  provider,
                  providerMessageId: String(canonicalIdentity?.providerMessageId || replyContext && replyContext.providerMessageId || '').trim(),
                  providerThreadId: String(canonicalIdentity?.providerThreadId || replyContext && replyContext.providerThreadId || '').trim(),
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
          providerOwner: sendOwner,
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
          conversationId: String(result.sentMessage?.conversationId || contextAtSend?.conversationId || '').trim(),
          softoraSendMode: sendMode,
          softoraSendIntentId: String(result.sentMessage?.softoraSendIntentId || result.intentId || '').trim(),
        };
        const identity = getMessageIdentity(sentMessage);
        rememberAcceptedSend({
          key: `${normalize(sendOwner)}|${normalize(account)}|${identity}`,
          owner: normalize(sendOwner),
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

    function handleAction(action, id, actionContext = {}) {
      if (action === 'close-compose') close();
      else if (action === 'send-mail') void send();
      else if (action === 'rewrite-compose') void rewrite();
      else if (action === 'toggle-copy-fields') options.compose.toggleCopyFields();
      else if (action === 'choose-attachments') documentRef?.getElementById('c-attachments')?.click();
      else if (action === 'remove-attachment') options.compose.removeAttachment(id);
      else if (action === 'reply-mail') reply(options.findMail(id), actionContext.messageKey);
      else if (action === 'new-message') newMessage(options.findMail(id), actionContext.messageKey);
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
