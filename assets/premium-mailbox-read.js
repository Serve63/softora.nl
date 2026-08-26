(function (global) {
  'use strict';

  const READ_STATE_CHANNEL = 'softora_mailbox_read_state_v3';

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function create(options = {}) {
    const BroadcastChannelImpl = options.BroadcastChannel || (global.document ? global.BroadcastChannel : null);
    const confirmedStates = new Map();
    const pendingStates = new Map();
    const rejectedStates = new Map();
    const failedRecords = new Map();
    const pendingOperations = new Map();
    const stateOutbox = options.outbox || global.SoftoraMailboxStateOutbox?.create?.({
      fetch: options.fetch,
    }) || null;
    let channel = null;

    function getIdentity(mail) {
      if (!mail || typeof mail !== 'object') return null;
      const id = String(options.getRequestId?.(mail) || mail.id || '').trim();
      const account = normalize(options.getAccount?.(mail) || mail.accountEmail);
      const folder = normalize(options.getFolder?.(mail) || mail.storageFolder || mail.folder || 'inbox');
      const owner = normalize(options.getOwner?.(mail) || mail.providerOwner);
      const messageKey = String(mail.messageKey || '').trim();
      const messageId = String(mail.messageId || '').trim();
      const provider = normalize(mail.provider || (folder === 'instantly' ? 'instantly' : ''));
      const providerMessageId = String(mail.providerMessageId || '').trim();
      if (!id || !account || !messageKey) return null;
      return { owner, account, folder, id, messageKey, messageId, provider, providerMessageId };
    }

    function getIdentityKey(identity) {
      const source = identity && typeof identity === 'object' ? identity : {};
      const owner = normalize(source.owner);
      const account = normalize(source.account);
      const messageKey = String(source.messageKey || '').trim();
      return owner && account && messageKey ? `message-key:${owner}|${account}|${messageKey}` : '';
    }

    function getConversationTargets(mail) {
      const candidates = [mail];
      const action = options.getConversationAction?.(mail);
      if (action?.kind === 'reply' && action.message && action.message !== mail) candidates.push(action.message);
      const seen = new Set();
      return candidates.filter((target) => {
        if (!target || typeof target !== 'object') return false;
        const identity = getIdentity(target);
        const key = identity ? getIdentityKey(identity) : '';
        if (key) {
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }
        if (seen.has(target)) return false;
        seen.add(target);
        return true;
      });
    }

    function getStateFor(target) {
      const identity = getIdentity(target);
      if (!identity) return null;
      const key = getIdentityKey(identity);
      return pendingStates.get(key) || confirmedStates.get(key) || rejectedStates.get(key) || null;
    }

    function applyStateToTarget(target, state) {
      if (!target || !state) return false;
      const identity = getIdentity(target);
      const targetKey = identity ? getIdentityKey(identity) : '';
      if (state.failed) {
        target.unread = state.unread;
        target.readPending = false;
        target.readError = String(state.readError || 'Gelezen status opslaan mislukt');
        if (state.dismissReply && (!state.targetKey || state.targetKey === targetKey)) {
          target.replyDismissedAt = String(state.replyDismissedAt || '');
          target.replyDismissPending = false;
        }
        return true;
      }
      target.unread = false;
      target.readPending = state.pending === true;
      target.readError = '';
      if (state.dismissReply) {
        if (!state.targetKey || state.targetKey === targetKey) {
          if (state.replyDismissedAt) target.replyDismissedAt = state.replyDismissedAt;
          target.replyDismissPending = state.pending === true;
        }
      }
      if (!state.pending) target.softoraReadConfirmed = true;
      return true;
    }

    function applyConfirmedState(mail) {
      const targets = getConversationTargets(mail);
      let applied = false;
      targets.forEach((target) => {
        const identity = getIdentity(target);
        const key = identity ? getIdentityKey(identity) : '';
        const failedRecord = key ? failedRecords.get(key) : null;
        const readAt = String(target && (target.softoraReadAt || target.readAt) || '').trim();
        const replyDismissedAt = String(target?.replyDismissedAt || '').trim();
        const durableConfirmation = failedRecord && failedRecord.unread !== true && (
          failedRecord.dismissReply === true ? Boolean(replyDismissedAt) : Boolean(readAt || replyDismissedAt)
        );
        if (durableConfirmation) {
          pendingStates.delete(key);
          rejectedStates.delete(key);
          failedRecords.delete(key);
          const confirmed = {
            identity,
            unread: false,
            pending: false,
            dismissReply: failedRecord.dismissReply === true,
            targetKey: getIdentityKey(failedRecord.identity) || key,
            replyDismissedAt,
            savedAt: Date.now(),
          };
          confirmedStates.set(key, confirmed);
          void stateOutbox?.confirmDurable?.(failedRecord, { readAt, replyDismissedAt });
        }
        const state = getStateFor(target);
        if (state) applied = applyStateToTarget(target, state) || applied;
      });
      const persistedReadAt = String(mail && (mail.softoraReadAt || mail.readAt) || '').trim();
      if (!applied && !persistedReadAt) return mail;
      if (persistedReadAt && !applied) {
        mail.unread = false;
        mail.readPending = false;
        mail.readError = '';
        mail.softoraReadConfirmed = true;
      }
      return mail;
    }

    function publishStates(type, states) {
      if (!channel || typeof channel.postMessage !== 'function') return;
      try {
        const safeStates = Array.isArray(states) ? states.filter(Boolean) : [];
        if (!safeStates.length) return;
        channel.postMessage({ type, state: safeStates[0], states: safeStates });
      } catch (_) {}
    }

    function rememberConfirmedState(mail, result = {}, settings = {}) {
      const identity = getIdentity(mail);
      if (!identity) return false;
      const replyDismissedAt = Object.prototype.hasOwnProperty.call(settings, 'replyDismissedAt')
        ? String(settings.replyDismissedAt || '')
        : String(result.replyDismissedAt || mail.replyDismissedAt || '');
      const state = {
        identity,
        unread: false,
        pending: false,
        dismissReply: settings.dismissReply === true || Boolean(replyDismissedAt),
        targetKey: String(settings.targetKey || getIdentityKey(identity)),
        replyDismissedAt,
        savedAt: Date.now(),
      };
      pendingStates.delete(getIdentityKey(identity));
      rejectedStates.delete(getIdentityKey(identity));
      confirmedStates.set(getIdentityKey(identity), state);
      if (settings.broadcast !== false) publishStates('mailbox-read-confirmed', [state]);
      return true;
    }

    function rememberConfirmedStates(targets, result = {}, settings = {}) {
      const safeTargets = Array.isArray(targets) ? targets : [];
      const targetKey = String(settings.targetKey || '');
      const states = safeTargets.map((target) => {
        const identity = getIdentity(target);
        if (!identity) return null;
        const key = getIdentityKey(identity);
        const isDismissTarget = !targetKey || key === targetKey;
        const replyDismissedAt = settings.dismissReply === true && isDismissTarget
          ? String(result.replyDismissedAt || target.replyDismissedAt || '')
          : '';
        rememberConfirmedState(target, result, {
          broadcast: false,
          dismissReply: settings.dismissReply === true && isDismissTarget,
          targetKey,
          replyDismissedAt,
        });
        return confirmedStates.get(key);
      }).filter(Boolean);
      if (settings.broadcast !== false) publishStates('mailbox-read-confirmed', states);
      return states;
    }

    function setPendingStates(targets, settings = {}) {
      const targetKey = String(settings.targetKey || '');
      const states = (Array.isArray(targets) ? targets : []).map((target) => {
        const identity = getIdentity(target);
        if (!identity) return null;
        const state = {
          identity,
          unread: false,
          pending: true,
          dismissReply: settings.dismissReply === true,
          targetKey,
          replyDismissedAt: String(settings.replyDismissedAt || ''),
          savedAt: Date.now(),
        };
        const key = getIdentityKey(identity);
        rejectedStates.delete(key);
        pendingStates.set(key, state);
        return state;
      }).filter(Boolean);
      if (settings.broadcast !== false) publishStates('mailbox-read-pending', states);
      return states;
    }

    function clearPendingStates(targets) {
      (Array.isArray(targets) ? targets : []).forEach((target) => {
        const identity = getIdentity(target);
        if (identity) pendingStates.delete(getIdentityKey(identity));
      });
    }

    function clearRejectedStates(targets) {
      (Array.isArray(targets) ? targets : []).forEach((target) => {
        const identity = getIdentity(target);
        if (identity) rejectedStates.delete(getIdentityKey(identity));
      });
    }

    function rememberRejectedStates(targets, snapshots, error, settings = {}) {
      const errorText = String(error?.message || error || 'Gelezen status opslaan mislukt');
      const targetKey = String(settings.targetKey || '');
      const states = (Array.isArray(targets) ? targets : []).map((target) => {
        const identity = getIdentity(target);
        if (!identity) return null;
        const key = getIdentityKey(identity);
        const snapshot = (Array.isArray(snapshots) ? snapshots : []).find((candidate) => candidate.target === target);
        const isDismissTarget = !targetKey || key === targetKey;
        const state = {
          identity,
          unread: snapshot ? snapshot.unread : Boolean(target.unread),
          pending: false,
          failed: true,
          readError: errorText,
          dismissReply: settings.dismissReply === true && isDismissTarget,
          targetKey,
          replyDismissedAt: settings.dismissReply === true && isDismissTarget
            ? String(snapshot?.replyDismissedAt || '')
            : '',
          savedAt: Date.now(),
        };
        pendingStates.delete(key);
        confirmedStates.delete(key);
        rejectedStates.set(key, state);
        return state;
      }).filter(Boolean);
      if (settings.broadcast !== false) publishStates('mailbox-read-rollback', states);
      return states;
    }

    async function persist(mail, persistOptions = {}) {
      const requestId = options.getRequestId?.(mail);
      const account = options.getAccount?.(mail);
      const identity = getIdentity(mail);
      if (!mail || !requestId || !account || !identity) {
        return { ok: false, error: new Error('Gelezen status mist berichtprovenance') };
      }
      const payload = {
        account,
        owner: options.getOwner?.(mail) || '',
        id: requestId,
        uid: mail.uid,
        folder: options.getFolder?.(mail) || 'inbox',
        messageKey: identity.messageKey,
        messageId: identity.messageId,
        provider: identity.provider,
        providerMessageId: identity.providerMessageId,
        unread: persistOptions.unread === true,
        dismissReply: persistOptions.dismissReply === true,
      };
      if (stateOutbox && typeof stateOutbox.enqueue === 'function') {
        const identities = getConversationTargets(persistOptions.conversation || mail)
          .map(getIdentity)
          .filter(Boolean);
        try {
          return await stateOutbox.enqueue(payload, {
            resourceKey: getIdentityKey(identity),
            identity,
            identities,
            previous: persistOptions.previous || null,
          });
        } catch (_) {
          return { ok: false, error: new Error('Mailboxstatus kon niet in de veilige wachtrij worden geplaatst.') };
        }
      }
      try {
        const response = await options.fetch('/api/mailbox/messages/read', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Gelezen status opslaan mislukt');
        }
        return { ok: true, result: data.result || null };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function render(hooks, mail, target) {
      if (typeof hooks.render === 'function') hooks.render(mail, target);
    }

    function snapshotTargets(targets) {
      return (Array.isArray(targets) ? targets : []).map((target) => ({
        target,
        unread: target.unread,
        readPending: target.readPending,
        readError: target.readError,
        replyDismissedAt: target.replyDismissedAt,
        replyDismissPending: target.replyDismissPending,
        softoraReadConfirmed: target.softoraReadConfirmed,
      }));
    }

    function restoreSnapshots(snapshots) {
      (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
        if (!snapshot?.target) return;
        snapshot.target.unread = snapshot.unread;
        snapshot.target.readPending = snapshot.readPending;
        snapshot.target.readError = snapshot.readError;
        snapshot.target.replyDismissedAt = snapshot.replyDismissedAt;
        snapshot.target.replyDismissPending = snapshot.replyDismissPending;
        snapshot.target.softoraReadConfirmed = snapshot.softoraReadConfirmed;
      });
    }

    function setFailure(target, previous, error, hooks, mail, snapshots = [], settings = {}) {
      restoreSnapshots(snapshots);
      target.unread = previous.unread;
      target.replyDismissedAt = previous.replyDismissedAt;
      target.readPending = false;
      target.replyDismissPending = false;
      target.readError = String(error?.message || error || 'Gelezen status opslaan mislukt');
      if (mail && mail !== target) {
        mail.readPending = false;
        mail.readError = target.readError;
      }
      rememberRejectedStates(
        snapshots.map((snapshot) => snapshot.target),
        snapshots,
        target.readError,
        settings
      );
      render(hooks, mail, target);
      options.toast?.(`${target.readError} · probeer opnieuw`);
    }

    async function markRead(mail, hooks = {}) {
      if (!mail) return { ok: false };
      const targets = getConversationTargets(mail);
      if (targets.some((target) => target.readPending || getStateFor(target)?.pending)) return { ok: false, pending: true };
      if (!targets.some((target) => Boolean(target.unread) || Boolean(target.readError))) return { ok: true, skipped: true };
      clearRejectedStates(targets);
      const snapshots = snapshotTargets(targets);
      const previous = snapshots.find((snapshot) => snapshot.target === mail) || snapshots[0] || { unread: false, replyDismissedAt: '' };
      targets.forEach((target) => {
        target.unread = false;
        target.readPending = true;
        target.readError = '';
      });
      setPendingStates(targets, { dismissReply: false });
      render(hooks, mail, mail);
      const outcome = await persist(mail, {
        conversation: mail,
        previous: { unread: previous.unread, replyDismissedAt: previous.replyDismissedAt },
      });
      if (outcome.ok && outcome.pending && outcome.record) {
        pendingOperations.set(outcome.record.mutationId, {
          kind: 'read', mail, target: mail, targets, snapshots, previous, hooks,
        });
        return { ok: true, pending: true, mutationId: outcome.record.mutationId };
      }
      clearPendingStates(targets);
      if (!outcome.ok) {
        setFailure(mail, previous, outcome.error, hooks, mail, snapshots, { dismissReply: false });
        return { ok: false, error: outcome.error };
      }
      targets.forEach((target) => {
        target.readPending = false;
        target.readError = '';
        target.softoraReadConfirmed = true;
      });
      rememberConfirmedStates(targets, outcome.result || {});
      render(hooks, mail, mail);
      return { ok: true, result: outcome.result };
    }

    function getDismissTarget(mail) {
      if (typeof options.getDismissTarget === 'function') return options.getDismissTarget(mail);
      const action = options.getConversationAction?.(mail);
      if (!action) return mail;
      if (action.kind !== 'reply') return null;
      return action.isRoot ? mail : action.message;
    }

    function resolveDismissTarget(mail, requestedTarget) {
      if (!requestedTarget) return null;
      const requestedIdentity = getIdentity(requestedTarget);
      const requestedKey = requestedIdentity ? getIdentityKey(requestedIdentity) : '';
      if (!requestedKey || !mail) return requestedTarget;
      return [mail, ...(Array.isArray(mail.threadMessages) ? mail.threadMessages : [])]
        .find((candidate) => {
          const identity = getIdentity(candidate);
          return identity && getIdentityKey(identity) === requestedKey;
        }) || requestedTarget;
    }

    async function dismissReplyTarget(mail, requestedTarget, hooks = {}) {
      const conversation = mail || requestedTarget;
      const target = resolveDismissTarget(mail, requestedTarget);
      if (!target || target.replyDismissedAt || target.replyDismissPending) return { ok: false };
      const targets = getConversationTargets(conversation);
      if (!targets.includes(target)) targets.push(target);
      if (targets.some((candidate) => candidate.readPending || candidate.replyDismissPending || getStateFor(candidate)?.pending)) return { ok: false, pending: true };
      const snapshots = snapshotTargets(targets);
      const previous = snapshots.find((snapshot) => snapshot.target === target) || { unread: Boolean(target.unread), replyDismissedAt: String(target.replyDismissedAt || '') };
      const targetKey = getIdentityKey(getIdentity(target));
      const optimisticReplyDismissedAt = new Date().toISOString();
      options.toast?.('Gesprek wordt als gelezen verwerkt…');
      clearRejectedStates(targets);
      targets.forEach((candidate) => {
        candidate.readPending = true;
        candidate.readError = '';
        candidate.unread = false;
      });
      target.replyDismissPending = true;
      target.replyDismissedAt = optimisticReplyDismissedAt;
      setPendingStates(targets, {
        dismissReply: true,
        targetKey,
        replyDismissedAt: optimisticReplyDismissedAt,
      });
      render(hooks, conversation, target);
      const outcome = await persist(target, {
        dismissReply: true,
        conversation,
        previous: { unread: previous.unread, replyDismissedAt: previous.replyDismissedAt },
      });
      if (outcome.ok && outcome.pending && outcome.record) {
        pendingOperations.set(outcome.record.mutationId, {
          kind: 'dismiss', mail: conversation, target, targets, snapshots, previous, hooks, targetKey,
        });
        return { ok: true, pending: true, mutationId: outcome.record.mutationId };
      }
      clearPendingStates(targets);
      if (!outcome.ok || !outcome.result?.replyDismissedAt) {
        setFailure(target, previous, outcome.error || new Error('Gelezen status opslaan mislukt'), hooks, conversation, snapshots, { dismissReply: true, targetKey });
        return { ok: false, error: outcome.error };
      }
      targets.forEach((candidate) => {
        candidate.readPending = false;
        candidate.readError = '';
        candidate.softoraReadConfirmed = true;
      });
      target.replyDismissPending = false;
      target.replyDismissedAt = outcome.result.replyDismissedAt;
      rememberConfirmedStates(targets, outcome.result, { dismissReply: true, targetKey });
      render(hooks, conversation, target);
      options.toast?.('Gesprek als gelezen afgehandeld');
      return { ok: true, result: outcome.result };
    }

    function dismissReply(mail, hooks = {}) {
      return dismissReplyTarget(mail, getDismissTarget(mail), hooks);
    }

    function rememberOutboxRecord(record, type, detail = {}) {
      const identities = (Array.isArray(record?.identities) && record.identities.length
        ? record.identities
        : [record?.identity]).filter(Boolean);
      identities.forEach((identity) => {
        const key = getIdentityKey(identity);
        if (!key) return;
        if (type === 'confirmed') {
          pendingStates.delete(key);
          rejectedStates.delete(key);
          failedRecords.delete(key);
          confirmedStates.set(key, {
            identity,
            unread: record?.unread === true,
            pending: false,
            dismissReply: record?.dismissReply === true,
            targetKey: getIdentityKey(record?.identity) || key,
            replyDismissedAt: String(detail.result?.replyDismissedAt || ''),
            savedAt: Date.now(),
          });
          return;
        }
        if (type === 'failed') {
          pendingStates.delete(key);
          confirmedStates.delete(key);
          if (key === getIdentityKey(record?.identity)) failedRecords.set(key, record);
          rejectedStates.set(key, {
            identity,
            unread: Boolean(record?.previous?.unread),
            pending: false,
            failed: true,
            readError: String(detail.message || record?.errorMessage || 'Opslaan lukt nog niet.'),
            dismissReply: record?.dismissReply === true,
            targetKey: getIdentityKey(record?.identity) || key,
            replyDismissedAt: String(record?.previous?.replyDismissedAt || ''),
            savedAt: Date.now(),
          });
          return;
        }
        rejectedStates.delete(key);
        failedRecords.delete(key);
        pendingStates.set(key, {
          identity,
          unread: record?.unread === true,
          pending: true,
          dismissReply: record?.dismissReply === true,
          targetKey: getIdentityKey(record?.identity) || key,
          replyDismissedAt: '',
          savedAt: Date.now(),
        });
      });
    }

    function handleOutboxEvent(event = {}) {
      const record = event.record;
      if (!record?.mutationId) return;
      const operation = pendingOperations.get(record.mutationId);
      if (event.type === 'pending' || event.type === 'retry-scheduled') {
        rememberOutboxRecord(record, 'pending', event);
        options.onExternalState?.(record.identity);
        return;
      }
      if (event.type === 'confirmed') {
        rememberOutboxRecord(record, 'confirmed', event);
        if (operation) {
          pendingOperations.delete(record.mutationId);
          clearPendingStates(operation.targets);
          operation.targets.forEach((candidate) => {
            candidate.unread = record.unread === true;
            candidate.readPending = false;
            candidate.readError = '';
            candidate.softoraReadConfirmed = record.unread !== true;
          });
          if (operation.kind === 'dismiss') {
            operation.target.replyDismissPending = false;
            operation.target.replyDismissedAt = String(
              event.result?.replyDismissedAt || operation.target.replyDismissedAt || new Date().toISOString()
            );
            rememberConfirmedStates(operation.targets, {
              replyDismissedAt: operation.target.replyDismissedAt,
            }, { dismissReply: true, targetKey: operation.targetKey });
            options.toast?.('Gesprek als gelezen afgehandeld');
          } else {
            rememberConfirmedStates(operation.targets, event.result || {});
          }
          render(operation.hooks, operation.mail, operation.target);
        }
        options.onExternalState?.(record.identity);
        return;
      }
      if (event.type !== 'failed') return;
      rememberOutboxRecord(record, 'failed', event);
      if (operation) {
        pendingOperations.delete(record.mutationId);
        clearPendingStates(operation.targets);
        setFailure(
          operation.target,
          operation.previous,
          new Error(event.message || record.errorMessage || 'Opslaan lukt nog niet.'),
          operation.hooks,
          operation.mail,
          operation.snapshots,
          { dismissReply: operation.kind === 'dismiss', targetKey: operation.targetKey || '' }
        );
      }
      options.onExternalState?.(record.identity);
    }

    stateOutbox?.subscribe?.(handleOutboxEvent);

    if (typeof BroadcastChannelImpl === 'function') {
      try {
        channel = new BroadcastChannelImpl(READ_STATE_CHANNEL);
        channel.addEventListener?.('message', (event) => {
          const payload = event && event.data;
          const type = String(payload?.type || '');
          const states = Array.isArray(payload?.states)
            ? payload.states
            : payload?.state ? [payload.state] : [];
          if (!states.length) return;
          if (type === 'mailbox-read-pending') {
            states.forEach((state) => {
              const key = getIdentityKey(state && state.identity);
              if (!key) return;
              rejectedStates.delete(key);
              pendingStates.set(key, { ...state, pending: true });
            });
            options.onExternalState?.(states[0].identity);
            return;
          }
          if (type === 'mailbox-read-rollback') {
            states.forEach((state) => {
              const key = getIdentityKey(state && state.identity);
              if (!key) return;
              pendingStates.delete(key);
              confirmedStates.delete(key);
              rejectedStates.set(key, { ...state, pending: false, failed: true });
            });
            options.onExternalState?.(states[0].identity);
            return;
          }
          if (type !== 'mailbox-read-confirmed') return;
          states.forEach((state) => {
            const identity = state && state.identity;
            const key = getIdentityKey(identity);
            if (!key || state.unread !== false) return;
            pendingStates.delete(key);
            rejectedStates.delete(key);
            confirmedStates.set(key, {
              identity,
              unread: false,
              pending: false,
              dismissReply: state.dismissReply === true,
              targetKey: String(state.targetKey || key),
              replyDismissedAt: String(state.replyDismissedAt || ''),
              savedAt: Number(state.savedAt) || Date.now(),
            });
          });
          options.onExternalState?.(states[0].identity);
        });
      } catch (_) {
        channel = null;
      }
    }

    return {
      dismissReply,
      dismissReplyTarget,
      getIdentity,
      getConversationTargets,
      markRead,
      persist,
      reconcile: applyConfirmedState,
      rememberConfirmedState,
    };
  }

  const api = {
    READ_STATE_CHANNEL,
    create,
  };
  global.SoftoraMailboxRead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
