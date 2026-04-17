function createSequentialDispatchCoordinator(deps = {}) {
  const {
    createQueueId = () => 'seq-1',
    sequentialDispatchQueues = new Map(),
    sequentialDispatchQueueIdByCallId = new Map(),
    normalizeString = (value) => String(value || '').trim(),
    processColdcallingLead = async () => ({ success: false }),
    logInfo = () => {},
    logError = () => {},
    schedule = (fn, delayMs) => setTimeout(fn, delayMs),
  } = deps;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function phoneDispatchKey(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function isCallUpdateTerminalForSequentialDispatch(callUpdate) {
    if (!callUpdate) return false;

    const messageType = normalizeString(callUpdate.messageType).toLowerCase();
    const status = normalizeString(callUpdate.status).toLowerCase();
    const endedReason = normalizeString(callUpdate.endedReason).toLowerCase();

    if (endedReason) return true;
    if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

    if (
      /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|error|not_connected|dial_)/.test(
        status
      )
    ) {
      return true;
    }

    return false;
  }

  function createSequentialDispatchQueue(campaign, leads) {
    const id = createQueueId();
    const queue = {
      id,
      createdAt: new Date().toISOString(),
      campaign: { ...campaign },
      leads: Array.isArray(leads) ? leads.slice() : [],
      nextLeadIndex: 0,
      waitingForCallId: null,
      waitingForPhoneKey: null,
      isAdvancing: false,
      completed: false,
      results: [],
    };
    sequentialDispatchQueues.set(id, queue);
    return queue;
  }

  function finalizeSequentialDispatchQueueIfDone(queue) {
    if (!queue) return;
    if (queue.completed) return;
    if (queue.waitingForCallId || queue.waitingForPhoneKey) return;
    if (queue.nextLeadIndex < queue.leads.length) return;

    queue.completed = true;
    logInfo(
      `[Coldcalling][Sequential Queue] Voltooid ${queue.id}: ${queue.results.filter((r) => r.success).length}/${
        queue.results.length
      } gestart`
    );

    const queueId = queue.id;
    schedule(() => {
      const current = sequentialDispatchQueues.get(queueId);
      if (!current || !current.completed) return;
      if (current.waitingForCallId) {
        sequentialDispatchQueueIdByCallId.delete(current.waitingForCallId);
      }
      sequentialDispatchQueues.delete(queueId);
    }, 10 * 60 * 1000);
  }

  async function advanceSequentialDispatchQueue(queueId, reason = 'unknown') {
    const queue = sequentialDispatchQueues.get(queueId);
    if (!queue || queue.completed) return queue || null;
    if (queue.isAdvancing) return queue;
    if (queue.waitingForCallId || queue.waitingForPhoneKey) return queue;

    queue.isAdvancing = true;
    try {
      logInfo(
        `[Coldcalling][Sequential Queue] Advance ${queue.id} (reason=${reason}) idx=${queue.nextLeadIndex}/${queue.leads.length}`
      );

      while (
        !queue.completed &&
        !queue.waitingForCallId &&
        !queue.waitingForPhoneKey &&
        queue.nextLeadIndex < queue.leads.length
      ) {
        const index = queue.nextLeadIndex;
        const lead = queue.leads[index];
        queue.nextLeadIndex += 1;

        const result = await processColdcallingLead(lead, queue.campaign, index);
        queue.results.push(result);

        const callId = normalizeString(result?.call?.callId);
        const phoneKey = phoneDispatchKey(result?.lead?.phoneE164 || result?.lead?.phone);
        if (result.success && callId) {
          queue.waitingForCallId = callId;
          queue.waitingForPhoneKey = phoneKey || null;
          sequentialDispatchQueueIdByCallId.set(callId, queue.id);
          logInfo(
            `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde (${callId}) voor lead ${index + 1}/${
              queue.leads.length
            }`
          );
          break;
        }

        if (result.success && phoneKey) {
          queue.waitingForPhoneKey = phoneKey;
          logInfo(
            `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde via telefoon (${phoneKey}) voor lead ${
              index + 1
            }/${queue.leads.length} (geen callId ontvangen)`
          );
          break;
        }

        logInfo(
          `[Coldcalling][Sequential Queue] ${queue.id} lead ${index + 1}/${queue.leads.length} ${
            result.success ? 'gestart (zonder callId)' : 'mislukt'
          }, ga door`
        );
      }

      finalizeSequentialDispatchQueueIfDone(queue);
      return queue;
    } finally {
      queue.isAdvancing = false;
    }
  }

  function handleSequentialDispatchQueueWebhookProgress(callUpdate) {
    if (!callUpdate || !isCallUpdateTerminalForSequentialDispatch(callUpdate)) return;

    const callId = normalizeString(callUpdate.callId);
    const webhookPhoneKey = phoneDispatchKey(callUpdate.phone);

    let queueId = callId ? sequentialDispatchQueueIdByCallId.get(callId) : null;
    let queue = queueId ? sequentialDispatchQueues.get(queueId) : null;

    if (!queue && callId) {
      sequentialDispatchQueueIdByCallId.delete(callId);
    }

    if (!queue && webhookPhoneKey) {
      for (const candidate of sequentialDispatchQueues.values()) {
        if (candidate.completed) continue;
        if (candidate.waitingForCallId && callId) continue;
        if (
          candidate.waitingForPhoneKey &&
          candidate.waitingForPhoneKey === webhookPhoneKey
        ) {
          queue = candidate;
          queueId = candidate.id;
          break;
        }
      }
    }

    if (!queue || !queueId) return;

    const matchesCallId = Boolean(
      callId && queue.waitingForCallId && queue.waitingForCallId === callId
    );
    const matchesPhone = Boolean(
      (!callId || !queue.waitingForCallId) &&
        webhookPhoneKey &&
        queue.waitingForPhoneKey &&
        queue.waitingForPhoneKey === webhookPhoneKey
    );
    if (!matchesCallId && !matchesPhone) return;

    if (queue.waitingForCallId) {
      sequentialDispatchQueueIdByCallId.delete(queue.waitingForCallId);
    }
    queue.waitingForCallId = null;
    queue.waitingForPhoneKey = null;

    logInfo(
      `[Coldcalling][Sequential Queue] Call beëindigd (${callId || webhookPhoneKey}), volgende lead starten voor queue ${queueId}`
    );

    void advanceSequentialDispatchQueue(queueId, 'webhook-ended').catch((error) => {
      logError(
        '[Coldcalling][Sequential Queue Error]',
        JSON.stringify(
          {
            queueId,
            callId: callId || null,
            message: error?.message || 'Onbekende fout',
          },
          null,
          2
        )
      );
    });
  }

  return {
    sleep,
    phoneDispatchKey,
    isCallUpdateTerminalForSequentialDispatch,
    createSequentialDispatchQueue,
    advanceSequentialDispatchQueue,
    handleSequentialDispatchQueueWebhookProgress,
  };
}

module.exports = {
  createSequentialDispatchCoordinator,
};
