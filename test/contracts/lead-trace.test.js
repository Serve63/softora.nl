const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLeadTraceContext,
  logLeadTrace,
  shouldLogLeadTrace,
} = require('../../server/services/lead-trace');

function captureConsoleLogs(callback) {
  const originalConsoleLog = console.log;
  const logs = [];
  console.log = (message) => {
    logs.push(String(message || ''));
  };
  try {
    callback();
  } finally {
    console.log = originalConsoleLog;
  }
  return logs;
}

function withLeadTraceEnv(value, callback) {
  const previousValue = process.env.SOFTORA_LEAD_TRACE_LOGS;
  if (value === undefined) {
    delete process.env.SOFTORA_LEAD_TRACE_LOGS;
  } else {
    process.env.SOFTORA_LEAD_TRACE_LOGS = value;
  }
  try {
    callback();
  } finally {
    if (previousValue === undefined) {
      delete process.env.SOFTORA_LEAD_TRACE_LOGS;
    } else {
      process.env.SOFTORA_LEAD_TRACE_LOGS = previousValue;
    }
  }
}

test('lead trace logging stays quiet by default for internal state events', () => {
  withLeadTraceEnv(undefined, () => {
    assert.equal(shouldLogLeadTrace({ callId: 'call-1' }), false);
    const logs = captureConsoleLogs(() => {
      logLeadTrace('dismiss-state', 'identity-dismissed', { callId: 'call-1' });
    });
    assert.deepEqual(logs, []);
  });
});

test('lead trace logging still writes explicit request traces', () => {
  withLeadTraceEnv(undefined, () => {
    const trace = buildLeadTraceContext({
      query: {
        traceLead: 'true',
        traceId: 'lead-debug-1',
      },
      headers: {},
    });

    assert.equal(trace.traceId, 'lead-debug-1');
    assert.equal(shouldLogLeadTrace({ traceId: trace.traceId }), true);

    const logs = captureConsoleLogs(() => {
      logLeadTrace('interested-leads', 'response', {
        traceId: trace.traceId,
        count: 2,
      });
    });

    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[LeadTrace\]\[interested-leads\]\[response\]/);
    assert.match(logs[0], /lead-debug-1/);
  });
});

test('lead trace logging can be globally enabled for deep diagnostics', () => {
  withLeadTraceEnv('true', () => {
    assert.equal(shouldLogLeadTrace({ callId: 'call-2' }), true);
    const logs = captureConsoleLogs(() => {
      logLeadTrace('dismiss-state', 'identity-dismissed', { callId: 'call-2' });
    });

    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[LeadTrace\]\[dismiss-state\]\[identity-dismissed\]/);
  });
});
