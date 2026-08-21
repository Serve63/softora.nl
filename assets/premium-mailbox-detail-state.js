(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SoftoraMailboxDetailState = api.createMailboxDetailState();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATES = Object.freeze(['idle', 'loading', 'partial', 'ready', 'retryScheduled', 'failed']);

  function createMailboxDetailState(options = {}) {
    const maxRetries = Math.max(0, Math.min(3, Number(options.maxRetries) || 2));
    const retryBaseMs = Math.max(10, Number(options.retryBaseMs) || 900);
    const timers = new Map();
    const attempts = new Map();
    const flights = new Map();
    let selectedTarget = '';
    let generation = 0;
    let state = 'idle';

    function select(target) {
      const next = String(target || '');
      if (next === selectedTarget) return snapshot();
      selectedTarget = next;
      generation += 1;
      state = next ? 'loading' : 'idle';
      try { if (next && typeof CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('softora:mailbox-detail-priority', { detail: { target: next, generation } })); } catch (_) {}
      for (const [key, flight] of flights) {
        if (key !== next) { flight.controller.abort(); flights.delete(key); }
      }
      return snapshot();
    }

    function begin(target, { partial = false, signal } = {}) {
      const key = String(target || '');
      if (key !== selectedTarget) select(key);
      const existing = flights.get(key);
      if (existing && !existing.controller.signal.aborted) return { ...existing, duplicate: true };
      if (existing) {
        flights.delete(key);
        generation += 1;
      }
      const flight = {
        target: key,
        generation,
        controller: new AbortController(),
        attempt: Number(attempts.get(key)) || 0,
        duplicate: false,
      };
      signal?.addEventListener?.('abort', () => flight.controller.abort(), { once: true });
      if (signal?.aborted) flight.controller.abort();
      flights.set(key, flight);
      state = partial ? 'partial' : 'loading';
      return flight;
    }

    function isCurrent(flight) {
      return Boolean(flight && flight.target === selectedTarget && flight.generation === generation);
    }

    function finish(flight, nextState) {
      if (flights.get(flight && flight.target) === flight) flights.delete(flight.target);
      if (isCurrent(flight) && STATES.includes(nextState)) state = nextState;
      if (nextState === 'ready') { cancelRetry(flight.target); attempts.delete(flight.target); }
      return snapshot();
    }

    function scheduleRetry(flight, callback) {
      if (!isCurrent(flight) || typeof callback !== 'function' || flight.attempt >= maxRetries) return false;
      cancelRetry(flight.target);
      const attempt = flight.attempt + 1;
      attempts.set(flight.target, attempt);
      const jitterMs = Math.floor(retryBaseMs * 0.2 * ((attempt * 17) % 5) / 4);
      const timer = setTimeout(() => {
        timers.delete(flight.target);
        if (isCurrent(flight)) callback(attempt);
      }, retryBaseMs * attempt + jitterMs);
      timers.set(flight.target, { timer, attempt });
      state = 'retryScheduled';
      return true;
    }

    function cancelRetry(target) {
      const pending = timers.get(String(target || ''));
      if (!pending) return;
      clearTimeout(pending.timer);
      timers.delete(String(target || ''));
    }

    function snapshot() {
      return { selectedTarget, generation, state, inFlight: flights.size, retryScheduled: timers.has(selectedTarget) };
    }

    function reset() {
      for (const flight of flights.values()) flight.controller.abort();
      for (const pending of timers.values()) clearTimeout(pending.timer);
      flights.clear(); timers.clear(); attempts.clear(); selectedTarget = ''; generation += 1; state = 'idle';
    }

    return { STATES, begin, cancelRetry, finish, isCurrent, reset, scheduleRetry, select, snapshot };
  }

  return { STATES, createMailboxDetailState };
});
