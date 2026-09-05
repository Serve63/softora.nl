'use strict';

// Keep only protocol verbs, never IMAP arguments, server responses or mail data.
const SAFE_COMMAND = /^\S+ (CAPABILITY|ID|STARTTLS|LOGIN|AUTHENTICATE|NAMESPACE|COMPRESS|ENABLE|LIST|LSUB|SELECT|EXAMINE|SEARCH|FETCH|UID|LOGOUT|NOOP)(?: |$)/;

function observeMailboxImapClient(client, now = Date.now) {
  const startedAt = now();
  const commandTimings = [];
  let lastCommand = '';
  let authenticated = false;
  let stage = 'connect';
  let rejectOperation;
  const failure = new Promise((_resolve, reject) => { rejectOperation = reject; });
  // A transport can report an error after its operation deadline has closed it.
  // Keep the listener for the client's lifetime, including asynchronous teardown.
  client.on?.('error', (error) => rejectOperation(error));
  client.on?.('log', (entry) => {
    if (entry?.src === 'auth' && entry.msg === 'User authenticated') authenticated = true;
    if (entry?.src !== 'c' || typeof entry.msg !== 'string') return;
    const match = entry.msg.match(SAFE_COMMAND);
    if (match) {
      lastCommand = match[1];
      if (commandTimings.length === 12) commandTimings.shift();
      commandTimings.push({ command: lastCommand, afterMs: Math.max(0, now() - startedAt) });
    }
  });
  failure.catch(() => {});
  return {
    setStage(value) { stage = value; },
    snapshot() { return { operationStage: stage, lastCommand, authenticated, commandTimings: commandTimings.slice() }; },
    run(operation) { return Promise.race([Promise.resolve().then(operation), failure]); },
  };
}

module.exports = { observeMailboxImapClient };
