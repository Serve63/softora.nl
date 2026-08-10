const crypto = require('crypto');

function createJournalUnavailableError() {
  const error = new Error('Duurzame Instantly-mutation journal is niet beschikbaar.');
  error.code = 'INSTANTLY_MUTATION_JOURNAL_UNAVAILABLE';
  error.status = 503;
  return error;
}

function throwInstantlyStoreFailure(result, message, code) {
  if (result?.error?.leaveMutationPending === true) {
    if (!result.error.status) result.error.status = 503;
    throw result.error;
  }
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  throw error;
}

function createInstantlyMailboxMutationWriter({
  mailboxIndexStore,
  onMessagesUpserted = async () => ({ ok: true }),
  getCampaignMutationRunner = () => null,
  requireMutationJournal = false,
  createMutationRequestKey = (options = {}) => String(options.requestKey || '').trim()
    || `instantly-upsert:${crypto.randomUUID()}`,
} = {}) {
  async function runMutationLifecycle(options = {}, task) {
    const mutationRunner = getCampaignMutationRunner?.();
    if (!mutationRunner?.isAvailable?.() || typeof mutationRunner.run !== 'function') {
      if (requireMutationJournal) throw createJournalUnavailableError();
      return task(null);
    }
    return mutationRunner.run({
      requestKey: createMutationRequestKey(options),
      kind: 'instantly-upsert',
      accountEmail: String(options.accountEmail || '').trim().toLowerCase(),
      folder: 'instantly',
    }, task);
  }

  async function upsertInstantlyMessages(messages, existingMutationContext = null) {
    if (!Array.isArray(messages) || !messages.length) return { ok: true, data: [], upserted: 0 };
    const persist = async (mutationContext = null) => {
      mutationContext?.assertActive();
      const result = await mailboxIndexStore.upsertProviderMessages({
        provider: 'instantly', messages, signal: mutationContext?.signal,
        mutationId: mutationContext?.mutationId, requestKey: mutationContext?.requestKey,
      });
      mutationContext?.assertActive();
      if (!result?.ok || !(Number(result.upserted) > 0)) return result;
      const invalidation = await onMessagesUpserted({
        provider: 'instantly', count: Number(result.upserted),
      });
      mutationContext?.assertActive();
      return invalidation?.ok === false ? { ...result, ok: false, invalidationFailed: true } : result;
    };
    if (existingMutationContext) return persist(existingMutationContext);
    return runMutationLifecycle({
      accountEmail: String(
        messages[0]?.providerAccountEmail || messages[0]?.accountEmail || ''
      ).trim().toLowerCase(),
    }, persist);
  }
  upsertInstantlyMessages.runMutationLifecycle = runMutationLifecycle;
  return upsertInstantlyMessages;
}

module.exports = { createInstantlyMailboxMutationWriter, throwInstantlyStoreFailure };
