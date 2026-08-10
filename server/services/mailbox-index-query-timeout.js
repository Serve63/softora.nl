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
function createMailboxIndexAbortError(label, cause = null) {
  const error = new Error(`Mailbox index ${label} geannuleerd vóór databasewrite.`);
  error.code = 'MAILBOX_INDEX_ABORTED';
  if (cause) error.cause = cause;
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
  label = 'query',
  timeoutMs = 2500,
  mutationSignal = null,
  signal = null,
} = {}) {
  const boundedTimeoutMs = safeTimeoutMs(timeoutMs);
  const activeSignal = mutationSignal || signal;
  const isMutation = Boolean(mutationSignal);
  if (!activeSignal) {
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
  if (activeSignal.aborted) {
    throw activeSignal.reason instanceof Error
      ? activeSignal.reason
      : createMailboxIndexAbortError(label, activeSignal.reason);
  }
  const controller = new AbortController();
  let rejectParentAbort;
  const parentAbort = new Promise((_, reject) => { rejectParentAbort = reject; });
  parentAbort.catch(() => null);
  const onParentAbort = () => {
    const error = isMutation
      ? createMailboxIndexWriteOutcomeUnknownError(label, activeSignal.reason)
      : activeSignal.reason instanceof Error
        ? activeSignal.reason
        : createMailboxIndexAbortError(label, activeSignal.reason);
    if (!controller.signal.aborted) controller.abort(activeSignal.reason || error);
    rejectParentAbort(error);
  };
  activeSignal.addEventListener('abort', onParentAbort, { once: true });
  let rejectTimeout;
  const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
  timeoutPromise.catch(() => null);
  const timer = setTimeout(() => {
    const error = createMailboxIndexTimeoutError(label, boundedTimeoutMs);
    controller.abort(error);
    if (!isMutation) rejectTimeout(error);
  }, boundedTimeoutMs);
  let request;
  try {
    request = attachMutationAbortSignal(query, controller.signal, label);
  } catch (error) {
    clearTimeout(timer);
    activeSignal.removeEventListener('abort', onParentAbort);
    if (activeSignal.aborted && isMutation) {
      throw createMailboxIndexWriteOutcomeUnknownError(label, error);
    }
    throw error;
  }
  try {
    return await Promise.race([Promise.resolve(request), parentAbort, timeoutPromise]);
  } catch (error) {
    if (error?.leaveMutationPending === true) throw error;
    throw isMutation ? createMailboxIndexWriteOutcomeUnknownError(label, error) : error;
  } finally {
    clearTimeout(timer);
    activeSignal.removeEventListener('abort', onParentAbort);
  }
}
module.exports = { createMailboxIndexWriteOutcomeUnknownError, executeMailboxIndexQuery };
