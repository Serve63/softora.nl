const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxDetailState } = require('../../assets/premium-mailbox-detail-state.js');

test('mailbox detail state houdt selectie-generation stabiel en verwerpt obsolete responses', () => {
  const state = createMailboxDetailState();
  state.select('imap:a');
  const firstA = state.begin('imap:a', { partial: true });
  assert.equal(state.snapshot().state, 'partial');

  state.select('instantly:b');
  const b = state.begin('instantly:b');
  assert.equal(firstA.controller.signal.aborted, true);
  assert.equal(state.isCurrent(firstA), false);
  assert.equal(state.isCurrent(b), true);

  state.select('imap:a');
  const secondA = state.begin('imap:a');
  assert.equal(state.isCurrent(firstA), false);
  assert.equal(state.isCurrent(secondA), true);
  assert.ok(secondA.generation > firstA.generation);
});

test('mailbox detail state dedupliceert dezelfde target single-flight', () => {
  const state = createMailboxDetailState();
  state.select('aggregate:equans');
  const first = state.begin('aggregate:equans');
  const duplicate = state.begin('aggregate:equans');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.controller, first.controller);
  assert.equal(state.snapshot().inFlight, 1);
  state.finish(first, 'ready');
  assert.equal(state.snapshot().state, 'ready');
  assert.equal(state.snapshot().inFlight, 0);
});

test('mailbox detail state vervangt een geaborteerde same-target flight direct', () => {
  const state = createMailboxDetailState();
  const owner = new AbortController();
  state.select('imap:same');
  const stale = state.begin('imap:same', { signal: owner.signal });
  owner.abort();

  const replacement = state.begin('imap:same');
  assert.equal(replacement.duplicate, false);
  assert.notEqual(replacement.controller, stale.controller);
  assert.ok(replacement.generation > stale.generation);
  assert.equal(state.isCurrent(stale), false);
  assert.equal(state.isCurrent(replacement), true);
  assert.equal(state.snapshot().inFlight, 1);

  state.finish(stale, 'failed');
  assert.equal(state.snapshot().inFlight, 1);
  assert.equal(state.snapshot().state, 'loading');
  state.finish(replacement, 'ready');
  assert.equal(state.snapshot().state, 'ready');
});

test('mailbox detail state plant begrensde automatische retries zonder dubbele timer', () => {
  const callbacks = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback) => { callbacks.push(callback); return callbacks.length; };
  global.clearTimeout = () => {};
  try {
    const state = createMailboxDetailState({ maxRetries: 2, retryBaseMs: 10 });
    state.select('imap:slow');
    const first = state.begin('imap:slow', { partial: true });
    state.finish(first, 'partial');
    let retries = 0;
    assert.equal(state.scheduleRetry(first, () => { retries += 1; }), true);
    assert.equal(state.scheduleRetry(first, () => { retries += 10; }), true);
    assert.equal(state.snapshot().retryScheduled, true);
    callbacks.at(-1)();
    assert.equal(retries, 10);

    const second = state.begin('imap:slow', { partial: true });
    state.finish(second, 'partial');
    assert.equal(state.scheduleRetry(second, () => {}), true);
    callbacks.at(-1)();
    const third = state.begin('imap:slow', { partial: true });
    state.finish(third, 'failed');
    assert.equal(state.scheduleRetry(third, () => {}), false);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('tab- of ownerwissel breekt alleen de obsolete detailrequest af', () => {
  const state = createMailboxDetailState();
  const ownerSignal = new AbortController();
  state.select('imap:mobile');
  const request = state.begin('imap:mobile', { signal: ownerSignal.signal });
  ownerSignal.abort();
  assert.equal(request.controller.signal.aborted, true);
  assert.equal(state.snapshot().selectedTarget, 'imap:mobile');
});
