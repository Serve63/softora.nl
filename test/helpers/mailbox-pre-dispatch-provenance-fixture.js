'use strict';

function normalizeIntent(input = {}, intent = {}) {
  return {
    ...input,
    ...intent,
    status: intent.status || 'prepared',
    dispatchState: intent.dispatchState || 'reserved',
    transitionToken: intent.transitionToken || 'test-claim-token',
    preDispatchClaimFingerprint:
      intent.preDispatchClaimFingerprint || 'a'.repeat(64),
    preDispatchFinalizedAt: intent.preDispatchFinalizedAt || '',
  };
}

function withMailboxPreDispatchProvenance(rawStore = {}) {
  const store = rawStore || {};
  const rawStartDispatch = typeof store.startDispatch === 'function'
    ? store.startDispatch.bind(store)
    : null;
  const wrapped = { ...store };

  if (typeof wrapped.findByIdempotencyKey !== 'function') {
    wrapped.findByIdempotencyKey = async () => null;
  }
  if (typeof wrapped.claimPreDispatch !== 'function') {
    wrapped.claimPreDispatch = async (input) => {
      const existing = await wrapped.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return { created: false, intent: existing };
      const reserved = typeof store.reserve === 'function'
        ? await store.reserve(input)
        : { created: true, intent: input };
      if (!reserved?.created) return reserved;
      const intent = normalizeIntent(input, reserved.intent);
      return { ...reserved, intent, claimToken: intent.transitionToken };
    };
  }
  if (typeof wrapped.finalizeClaim !== 'function') {
    wrapped.finalizeClaim = async (handle, input) => {
      const intent = {
        ...normalizeIntent(input, handle?.intent),
        transitionToken: 'test-final-token',
        preDispatchFinalizedAt: '2026-08-27T12:00:00.000Z',
      };
      return { intent, finalToken: intent.transitionToken };
    };
  }
  if (typeof wrapped.failPreDispatch !== 'function') {
    wrapped.failPreDispatch = async (handle, error) => {
      if (typeof store.fail === 'function') {
        const failed = await store.fail(handle?.intent?.intentId, error);
        return {
          ...(failed || {}),
          intentId: failed?.intentId || handle?.intent?.intentId,
          status: 'failed',
          dispatchState: 'finished',
        };
      }
      return {
        ...handle?.intent,
        status: 'failed',
        dispatchState: 'finished',
      };
    };
  }
  wrapped.startDispatch = async (handle) => {
    const started = rawStartDispatch
      ? await rawStartDispatch(handle?.intent?.intentId || handle)
      : null;
    return started && typeof started === 'object' ? started : {
      ...handle?.intent,
      dispatchState: 'started',
      transitionToken: 'test-started-token',
    };
  };
  if (typeof wrapped.accept !== 'function') {
    wrapped.accept = async (intentId, values = {}) => ({
      intentId,
      status: 'accepted',
      dispatchState: 'finished',
      ...values,
    });
  }
  if (typeof wrapped.fail !== 'function') {
    wrapped.fail = async (intentId, error) => ({
      intentId,
      status: 'failed',
      dispatchState: 'finished',
      error,
    });
  }
  if (typeof wrapped.markUnknown !== 'function') {
    wrapped.markUnknown = async (intentId, error, values = {}) => ({
      intentId,
      status: 'unknown',
      dispatchState: 'started',
      reconcileRequired: true,
      error,
      ...values,
    });
  }
  return wrapped;
}

module.exports = { withMailboxPreDispatchProvenance };
