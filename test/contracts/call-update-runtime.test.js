const test = require('node:test');
const assert = require('node:assert/strict');

const { createCallUpdateRuntime } = require('../../server/services/call-update-runtime');

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeColdcallingStack(value) {
  const raw = normalizeString(value).toLowerCase();
  if (raw === 'openai' || raw === 'openai_realtime_1_5') return 'openai_realtime_1_5';
  if (raw === 'gemini' || raw === 'gemini_flash_3_1_live') return 'gemini_flash_3_1_live';
  return 'retell_ai';
}

function normalizeLeadLikePhoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 10) return `31${digits.slice(1)}`;
  if (digits.startsWith('31')) return digits;
  if (digits.startsWith('6') && digits.length === 9) return `31${digits}`;
  return digits;
}

function createRuntime(overrides = {}) {
  const recentCallUpdates = overrides.recentCallUpdates || [];
  const callUpdatesById = overrides.callUpdatesById || new Map();
  const recentAiCallInsights = overrides.recentAiCallInsights || [];
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const retellCallStatusRefreshByCallId = overrides.retellCallStatusRefreshByCallId || new Map();
  const logs = [];

  const runtime = createCallUpdateRuntime({
    normalizeString,
    normalizeColdcallingStack,
    normalizeLeadLikePhoneKey,
    extractCallIdFromRecordingUrl: (value) => {
      const raw = normalizeString(value);
      const match = raw.match(/[?&]callId=([^&#]+)/i);
      return match ? normalizeString(match[1]) : '';
    },
    extractTwilioRecordingSidFromUrl: (value) => {
      const raw = normalizeString(value);
      const match = raw.match(/(RE[0-9a-z]+)/i);
      return match ? normalizeString(match[1]) : '';
    },
    normalizeRecordingReference: (value) => {
      const raw = normalizeString(value);
      if (!raw) return '';
      return raw.replace(/([?&]foo=[^&]+)/g, '').replace(/[?&]$/, '');
    },
    getLatestCallUpdateByCallId: (callId) => callUpdatesById.get(callId) || null,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    generatedAgendaAppointments,
    inferCallProvider:
      overrides.inferCallProvider ||
      ((callId, fallbackProvider = 'retell') =>
        /^CA/i.test(callId) ? 'twilio' : fallbackProvider),
    fetchRetellCallStatusById:
      overrides.fetchRetellCallStatusById ||
      (async (callId) => ({
        data: { call_id: callId, call_status: 'completed', end_timestamp: 1_700_000_000 },
      })),
    fetchTwilioCallStatusById:
      overrides.fetchTwilioCallStatusById ||
      (async (callId) => ({
        data: { sid: callId, status: 'queued', direction: 'outbound-api', to: '+31612345678' },
      })),
    extractCallUpdateFromRetellCallStatusResponse:
      overrides.extractCallUpdateFromRetellCallStatusResponse ||
      ((callId, data) => ({ callId, provider: 'retell', status: data.call_status })),
    extractCallUpdateFromTwilioCallStatusResponse:
      overrides.extractCallUpdateFromTwilioCallStatusResponse ||
      ((callId, data, options = {}) => ({
        callId,
        provider: 'twilio',
        status: data.status,
        direction: options.direction || '',
      })),
    upsertRecentCallUpdate:
      overrides.upsertRecentCallUpdate ||
      ((update) => {
        callUpdatesById.set(update.callId, update);
        return update;
      }),
    isTwilioStatusApiConfigured: overrides.isTwilioStatusApiConfigured || (() => true),
    hasRetellApiKey: overrides.hasRetellApiKey || (() => true),
    isTerminalColdcallingStatus:
      overrides.isTerminalColdcallingStatus ||
      ((status) => ['completed', 'failed', 'busy', 'cancelled', 'canceled'].includes(status)),
    retellCallStatusRefreshByCallId,
    retellStatusRefreshCooldownMs: overrides.retellStatusRefreshCooldownMs || 8000,
    logger: {
      warn: (...args) => logs.push(args.join(' ')),
    },
  });

  return { runtime, recentCallUpdates, callUpdatesById, retellCallStatusRefreshByCallId, logs };
}

test('call update runtime resolves call updates from direct ids, recording refs and phone fallbacks', () => {
  const directMatch = { callId: 'call-1', phone: '0612345678', recordingUrl: '/recording?callId=call-1' };
  const phoneMatch = {
    callId: 'call-2',
    phone: '06 12 34 56 78',
    recordingUrl: '',
    updatedAt: '2026-04-16T18:00:00Z',
  };
  const { runtime, callUpdatesById } = createRuntime({
    recentCallUpdates: [phoneMatch],
    callUpdatesById: new Map([['call-1', directMatch]]),
  });

  assert.equal(runtime.findCallUpdateByRecordingReference({ callId: 'call-1' }), directMatch);
  assert.equal(
    runtime.findCallUpdateByRecordingReference({
      recordingUrl: '/api/coldcalling/recording-proxy?callId=call-1&foo=bar',
    }),
    directMatch
  );

  const byPhone = runtime.findCallUpdateByRecordingReference({
    phone: '06 12 34 56 78',
    date: '2026-04-16',
    time: '18:00',
  });
  assert.equal(byPhone?.callId, 'call-2');

  const resolved = runtime.resolveAppointmentCallId({
    recordingUrl: '/api/coldcalling/recording-proxy?callId=call-1&foo=bar',
  });
  assert.equal(resolved, 'call-1');
  assert.equal(callUpdatesById.get('call-1')?.callId, 'call-1');
});

test('call update runtime refreshes retell and twilio status safely and logs failures', async () => {
  const retellUpdates = [];
  const twilioUpdates = [];
  const { runtime, logs } = createRuntime({
    upsertRecentCallUpdate: (update) => {
      if (update.provider === 'retell') retellUpdates.push(update);
      if (update.provider === 'twilio') twilioUpdates.push(update);
      return update;
    },
    extractCallUpdateFromRetellCallStatusResponse: (callId) => ({
      callId,
      provider: 'retell',
      status: 'completed',
    }),
    extractCallUpdateFromTwilioCallStatusResponse: (callId, _data, options) => ({
      callId,
      provider: 'twilio',
      status: 'ringing',
      direction: options.direction || '',
    }),
  });

  const retell = await runtime.refreshCallUpdateFromRetellStatusApi('call-9');
  const twilio = await runtime.refreshCallUpdateFromTwilioStatusApi('CA9', { direction: 'outbound' });
  assert.equal(retell?.status, 'completed');
  assert.equal(twilio?.direction, 'outbound');
  assert.equal(retellUpdates.length, 1);
  assert.equal(twilioUpdates.length, 1);

  const failed = createRuntime({
    fetchTwilioCallStatusById: async () => {
      const error = new Error('timeout');
      error.status = 504;
      throw error;
    },
  });
  const result = await failed.runtime.refreshCallUpdateFromTwilioStatusApi('CA-fail');
  assert.equal(result, null);
  assert.equal(failed.logs.length > 0, true);
  assert.match(failed.logs[0], /Twilio Call Status Refresh Failed/);
  assert.equal(logs.length, 0);
});

test('call update runtime throttles refresh decisions and skips terminal updates', () => {
  const { runtime, retellCallStatusRefreshByCallId } = createRuntime({
    inferCallProvider: (callId) => (/^CA/i.test(callId) ? 'twilio' : 'retell'),
    retellStatusRefreshCooldownMs: 5000,
  });

  assert.equal(
    runtime.shouldRefreshRetellCallStatus({
      callId: 'call-1',
      provider: 'retell',
      status: 'in_progress',
      updatedAtMs: 1000,
    }, 10_000),
    true
  );
  assert.equal(retellCallStatusRefreshByCallId.get('call-1'), 10_000);

  assert.equal(
    runtime.shouldRefreshRetellCallStatus({
      callId: 'call-1',
      provider: 'retell',
      status: 'in_progress',
      updatedAtMs: 9_000,
    }, 12_000),
    false
  );

  retellCallStatusRefreshByCallId.set('call-2', 1000);
  assert.equal(
    runtime.shouldRefreshRetellCallStatus({
      callId: 'call-2',
      provider: 'retell',
      status: 'completed',
      endedReason: '',
    }, 20_000),
    false
  );
  assert.equal(retellCallStatusRefreshByCallId.has('call-2'), false);
});

test('call update runtime collects missing refresh candidates from appointments and insights', () => {
  const { runtime } = createRuntime({
    callUpdatesById: new Map([['call-known', { callId: 'call-known' }]]),
    generatedAgendaAppointments: [
      { callId: 'call-known', stack: 'openai', updatedAt: '2026-04-16T18:00:00Z' },
      { callId: 'call-a', stack: 'openai', updatedAt: '2026-04-16T18:03:00Z' },
    ],
    recentAiCallInsights: [
      { callId: 'demo-ignore', stack: 'gemini', updatedAt: '2026-04-16T18:04:00Z' },
      { callId: 'CA123', provider: 'twilio', updatedAt: '2026-04-16T18:02:00Z' },
    ],
  });

  const candidates = runtime.collectMissingCallUpdateRefreshCandidates(10);
  assert.deepEqual(
    candidates.map((item) => item.callId),
    ['call-a', 'CA123']
  );
  assert.equal(candidates[0].stack, 'openai_realtime_1_5');
  assert.equal(candidates[1].provider, 'twilio');
});
