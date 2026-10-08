'use strict';

const EMAIL_MODE = 'emode_all';
const text = (value) => String(value || '').trim();

function readSyncContinuation(values, owner, initialMinTimestamp) {
  // A focused-mail cursor/checkpoint cannot prove coverage of the Others inbox.
  if (values[`email_mode_${owner}`] !== EMAIL_MODE) {
    return { cursor: '', minTimestamp: initialMinTimestamp };
  }
  return {
    cursor: text(values[`cursor_${owner}`]),
    minTimestamp: text(values[`min_timestamp_${owner}`]),
  };
}

function buildSyncContinuationPatch(owner, continuation = {}) {
  return {
    [`email_mode_${owner}`]: EMAIL_MODE,
    [`cursor_${owner}`]: text(continuation.cursor),
    [`min_timestamp_${owner}`]: text(continuation.minTimestamp),
  };
}

module.exports = { readSyncContinuation, buildSyncContinuationPatch };
