const MAILBOX_CAMPAIGN_MUTATION_LEASE_SECONDS = 120;
const MAILBOX_CAMPAIGN_MUTATION_DEADLINE_MS = 90_000;
const MAILBOX_CAMPAIGN_MUTATION_LEASE_MARGIN_MS = 15_000;
function createMutationDeadlineError(message = 'Mailboxmutatie overschreed de harde taakdeadline.') {
  const error = new Error(message);
  error.code = 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE';
  error.status = 504;
  return error;
}
function createMutationTaskResultError(result = {}) {
  if (result.error instanceof Error) {
    if (result.leaveMutationPending === true) result.error.leaveMutationPending = true;
    return result.error;
  }
  const error = new Error(String(result.error?.message || result.error || 'Mailboxmutatie is mislukt.'));
  error.code = String(result.error?.code || result.code || 'MAILBOX_CAMPAIGN_MUTATION_FAILED');
  if (result.leaveMutationPending === true || result.error?.leaveMutationPending === true) {
    error.leaveMutationPending = true;
  }
  return error;
}
function createMailboxCampaignMutationRunner(deps = {}) {
  const {
    mailboxCampaignConsistencyStore, logger = console, now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer), createAbortController = () => new AbortController(),
  } = deps;
  function isAvailable() {
    return Boolean(
      mailboxCampaignConsistencyStore?.isAvailable?.() &&
      typeof mailboxCampaignConsistencyStore.beginMutation === 'function' &&
      typeof mailboxCampaignConsistencyStore.completeMutation === 'function'
    );
  }
  async function run(options = {}, task) {
    if (typeof task !== 'function') throw new TypeError('Mailboxmutatietaak ontbreekt.');
    const leaseSeconds = Math.max(
      15, Math.min(900, Math.trunc(
        Number(options.leaseSeconds) || MAILBOX_CAMPAIGN_MUTATION_LEASE_SECONDS
      ))
    );
    const deadlineMs = Math.max(
      1, Math.trunc(Number(options.deadlineMs) || MAILBOX_CAMPAIGN_MUTATION_DEADLINE_MS)
    );
    if (deadlineMs > leaseSeconds * 1000 - MAILBOX_CAMPAIGN_MUTATION_LEASE_MARGIN_MS) {
      const error = new Error('Mailboxmutatiedeadline moet ruim voor lease-expiry eindigen.');
      error.code = 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE_INVALID';
      throw error;
    }
    if (!isAvailable()) {
      const error = new Error('Duurzame mailboxmutatiejournal is niet beschikbaar.');
      error.code = 'MAILBOX_CAMPAIGN_MUTATION_UNAVAILABLE';
      throw error;
    }
    const controller = createAbortController();
    const parentSignal = options.signal;
    const startedAtMs = Number(now());
    const deadlineAtMs = startedAtMs + deadlineMs;
    let timedOut = false;
    let timeoutError = null;
    let rejectDeadline;
    const deadlinePromise = new Promise((_resolve, reject) => { rejectDeadline = reject; });
    const getAbortError = () => controller.signal.reason instanceof Error
      ? controller.signal.reason
      : timeoutError || createMutationDeadlineError();
    const abortFromParent = () => {
      const error = parentSignal?.reason instanceof Error
        ? parentSignal.reason
        : createMutationDeadlineError('Mailboxmutatie is door de bovenliggende sync geannuleerd.');
      if (!controller.signal.aborted) controller.abort(error);
      rejectDeadline(error);
    };
    if (parentSignal) {
      if (parentSignal.aborted) abortFromParent();
      else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
    const timer = setTimer(() => {
      timedOut = true;
      timeoutError = createMutationDeadlineError();
      controller.abort(timeoutError);
      rejectDeadline(timeoutError);
    }, deadlineMs);
    function assertActive() {
      if (timedOut || controller.signal.aborted || Number(now()) >= deadlineAtMs) {
        if (!controller.signal.aborted) {
          timeoutError = timeoutError || createMutationDeadlineError();
          timedOut = true;
          controller.abort(timeoutError);
        }
        throw getAbortError();
      }
    }
    const lifecycle = (async () => {
      assertActive();
      const mutation = await mailboxCampaignConsistencyStore.beginMutation({
        mutationId: options.mutationId,
        requestKey: options.requestKey,
        kind: options.kind,
        accountEmail: options.accountEmail,
        folder: options.folder,
        leaseSeconds,
        signal: controller.signal,
      });
      assertActive();
      if (mutation.replayed || mutation.status !== 'pending') {
        const error = new Error('Mailboxmutatie-request is al eerder gestart en wordt niet dubbel uitgevoerd.');
        error.code = 'MAILBOX_CAMPAIGN_MUTATION_REPLAYED';
        throw error;
      }
      const context = Object.freeze({
        mutationId: mutation.mutationId, requestKey: options.requestKey,
        signal: controller.signal, leaseSeconds, deadlineMs, deadlineAtMs, assertActive,
      });
      let taskResult;
      let taskError = null;
      try {
        taskResult = await task(context);
        assertActive();
        if (taskResult?.ok === false) throw createMutationTaskResultError(taskResult);
      } catch (error) {
        taskError = error;
      }
      if (controller.signal.aborted) throw taskError || getAbortError();
      if (taskError?.leaveMutationPending === true) throw taskError;
      try {
        await mailboxCampaignConsistencyStore.completeMutation({
          mutationId: mutation.mutationId,
          requestKey: options.requestKey,
          signal: controller.signal,
          result: taskError
            ? {
                ok: false,
                code: String(taskError.code || 'MAILBOX_CAMPAIGN_MUTATION_FAILED').slice(0, 120),
                error: String(taskError.message || taskError).slice(0, 500),
              }
            : { ok: true },
        });
        assertActive();
      } catch (completionError) {
        if (taskError) {
          logger.error?.('[Mailbox][CampaignMutationComplete]', completionError?.message || completionError);
          throw taskError;
        }
        throw completionError;
      }
      if (taskError) throw taskError;
      return taskResult;
    })();
    try {
      return await Promise.race([lifecycle, deadlinePromise]);
    } finally {
      clearTimer(timer);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    }
  }
  return { isAvailable, run };
}
module.exports = {
  MAILBOX_CAMPAIGN_MUTATION_DEADLINE_MS, MAILBOX_CAMPAIGN_MUTATION_LEASE_MARGIN_MS,
  MAILBOX_CAMPAIGN_MUTATION_LEASE_SECONDS, createMailboxCampaignMutationRunner,
  createMutationDeadlineError,
};
