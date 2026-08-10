function safeTimeoutMs(value) {
  return Math.max(250, Math.min(10_000, Number(value) || 2500));
}
function createMailboxIndexTimeoutError(label, timeoutMs) {
  const error = new Error(`Mailbox index ${label} timeout na ${safeTimeoutMs(timeoutMs)}ms`);
  error.code = 'MAILBOX_INDEX_TIMEOUT';
  return error;
}
function createMailboxIndexWriteOutcomeUnknownError(label, cause = null) {
  const error = new Error(
    `Mailbox index ${label} is afgebroken, maar de database-uitkomst kan niet veilig worden bewezen.`
  );
  error.code = 'MAILBOX_INDEX_WRITE_OUTCOME_UNKNOWN';
  error.status = 503;
  error.leaveMutationPending = true;
  if (cause) error.cause = cause;
  return error;
}
function createMailboxIndexAbortError(label) {
  const error = new Error(`Mailbox index ${label} geannuleerd vóór databasewrite.`);
  error.code = 'MAILBOX_INDEX_ABORTED';
  return error;
}
function attachMutationAbortSignal(query, signal, label) {
  if (signal.aborted) throw createMailboxIndexAbortError(label);
  if (!query || typeof query.abortSignal !== 'function') {
    const error = new Error(`Mailbox index ${label} ondersteunt geen harde annulering.`);
    error.code = 'MAILBOX_INDEX_ABORT_UNAVAILABLE';
    throw error;
  }
  return query.abortSignal(signal);
}
async function executeMailboxIndexQuery(query, {
  label = 'query', timeoutMs = 2500, mutationSignal = null,
} = {}) {
  const boundedTimeoutMs = safeTimeoutMs(timeoutMs);
  if (!mutationSignal) {
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve(query),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(
            createMailboxIndexTimeoutError(label, boundedTimeoutMs)
          ), boundedTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (mutationSignal.aborted) throw createMailboxIndexAbortError(label);
  const controller = new AbortController();
  let timedOut = false;
  let rejectParentAbort;
  const parentAbort = new Promise((_, reject) => { rejectParentAbort = reject; });
  parentAbort.catch(() => null);
  const onParentAbort = () => {
    const error = createMailboxIndexWriteOutcomeUnknownError(label, mutationSignal.reason);
    if (!controller.signal.aborted) controller.abort(mutationSignal.reason || error);
    rejectParentAbort(error);
  };
  mutationSignal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(createMailboxIndexTimeoutError(label, boundedTimeoutMs));
  }, boundedTimeoutMs);
  let request;
  try {
    request = attachMutationAbortSignal(query, controller.signal, label);
  } catch (error) {
    clearTimeout(timer);
    mutationSignal.removeEventListener('abort', onParentAbort);
    if (mutationSignal.aborted) throw createMailboxIndexWriteOutcomeUnknownError(label, error);
    throw error;
  }
  try {
    const result = await Promise.race([Promise.resolve(request), parentAbort]);
    if (timedOut && result?.error) {
      throw createMailboxIndexWriteOutcomeUnknownError(label, result.error);
    }
    return result;
  } catch (error) {
    if (error?.leaveMutationPending === true) throw error;
    throw createMailboxIndexWriteOutcomeUnknownError(label, error);
  } finally {
    clearTimeout(timer);
    mutationSignal.removeEventListener('abort', onParentAbort);
  }
}
module.exports = { createMailboxIndexWriteOutcomeUnknownError, executeMailboxIndexQuery };
