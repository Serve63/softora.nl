'use strict';

const express = require('express');
const crypto = require('crypto');

const PORT = Math.max(1, Number(process.env.PORT || 10001) || 10001);
const CONTROL_API_KEY = String(process.env.SIP_MIXER_CONTROL_API_KEY || '').trim();
const ENGINE_MODE = String(process.env.SIP_MIXER_ENGINE_MODE || 'mock').trim().toLowerCase() || 'mock';
const REQUEST_TIMEOUT_MS = Math.max(
  3000,
  Math.min(60000, Number(process.env.SIP_MIXER_REQUEST_TIMEOUT_MS || 15000) || 15000)
);

const ENGINE_BASE_URL = String(process.env.SIP_MIXER_ENGINE_BASE_URL || '').trim().replace(/\/+$/, '');
const ENGINE_BEARER_TOKEN = String(process.env.SIP_MIXER_ENGINE_BEARER_TOKEN || '').trim();
const ENGINE_START_PATH = String(process.env.SIP_MIXER_ENGINE_START_PATH || '/v1/calls/start').trim();
const ENGINE_STATUS_PATH_TEMPLATE = String(
  process.env.SIP_MIXER_ENGINE_STATUS_PATH_TEMPLATE || '/v1/calls/{callId}'
).trim();

const MOCK_RING_DELAY_MS = Math.max(100, Number(process.env.SIP_MIXER_MOCK_RING_DELAY_MS || 900) || 900);
const MOCK_CONNECT_DELAY_MS = Math.max(
  MOCK_RING_DELAY_MS + 100,
  Number(process.env.SIP_MIXER_MOCK_CONNECT_DELAY_MS || 2200) || 2200
);
const MOCK_DURATION_MS = Math.max(1000, Number(process.env.SIP_MIXER_MOCK_DURATION_MS || 18000) || 18000);
const MOCK_TERMINAL_STATUS = String(process.env.SIP_MIXER_MOCK_TERMINAL_STATUS || 'completed').trim().toLowerCase();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const callsById = new Map();
const mockTimersByCallId = new Map();

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createCallId() {
  return `sipmix_${crypto.randomUUID().replace(/-/g, '')}`;
}

function sanitizeLead(lead) {
  return {
    name: normalizeString(lead?.name),
    company: normalizeString(lead?.company),
    phone: normalizeString(lead?.phone),
    region: normalizeString(lead?.region),
  };
}

function sanitizeCampaign(campaign) {
  return {
    sector: normalizeString(campaign?.sector),
    region: normalizeString(campaign?.region),
    minProjectValue: parseNumberSafe(campaign?.minProjectValue, null),
    maxDiscountPct: parseNumberSafe(campaign?.maxDiscountPct, null),
    extraInstructions: normalizeString(campaign?.extraInstructions),
    dispatchMode: normalizeString(campaign?.dispatchMode),
    dispatchDelaySeconds: parseNumberSafe(campaign?.dispatchDelaySeconds, 0),
  };
}

function buildCallStateFromStartPayload(payload = {}, defaults = {}) {
  return {
    callId: normalizeString(payload.callId || payload.sessionId || payload.id || defaults.callId || createCallId()),
    status: normalizeString(payload.status || defaults.status || 'queued') || 'queued',
    startedAt: normalizeString(payload.startedAt || payload.createdAt || defaults.startedAt || nowIso()),
    endedAt: normalizeString(payload.endedAt || defaults.endedAt || ''),
    endedReason: normalizeString(payload.endedReason || payload.reason || defaults.endedReason || ''),
    durationSeconds: parseNumberSafe(payload.durationSeconds, defaults.durationSeconds ?? null),
    recordingUrl: normalizeString(payload.recordingUrl || defaults.recordingUrl || ''),
    lead: sanitizeLead(payload.lead || defaults.lead || {}),
    campaign: sanitizeCampaign(payload.campaign || defaults.campaign || {}),
    dynamicVariables:
      payload.dynamicVariables && typeof payload.dynamicVariables === 'object'
        ? { ...payload.dynamicVariables }
        : defaults.dynamicVariables && typeof defaults.dynamicVariables === 'object'
          ? { ...defaults.dynamicVariables }
          : {},
    profileId: normalizeString(payload.profileId || defaults.profileId || ''),
    providerMetadata:
      payload.providerMetadata && typeof payload.providerMetadata === 'object'
        ? { ...payload.providerMetadata }
        : defaults.providerMetadata && typeof defaults.providerMetadata === 'object'
          ? { ...defaults.providerMetadata }
          : {},
    createdAt: normalizeString(defaults.createdAt || nowIso()),
    updatedAt: nowIso(),
  };
}

function serializeCall(call) {
  return {
    callId: normalizeString(call?.callId),
    status: normalizeString(call?.status),
    startedAt: normalizeString(call?.startedAt),
    endedAt: normalizeString(call?.endedAt),
    endedReason: normalizeString(call?.endedReason),
    durationSeconds: parseNumberSafe(call?.durationSeconds, null),
    recordingUrl: normalizeString(call?.recordingUrl),
    lead: sanitizeLead(call?.lead || {}),
    campaign: sanitizeCampaign(call?.campaign || {}),
    profileId: normalizeString(call?.profileId),
    providerMetadata:
      call?.providerMetadata && typeof call.providerMetadata === 'object' ? { ...call.providerMetadata } : {},
    createdAt: normalizeString(call?.createdAt),
    updatedAt: normalizeString(call?.updatedAt),
  };
}

function patchCall(callId, patch = {}) {
  const existing = callsById.get(callId);
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  };
  if (normalizeString(next.status).toLowerCase() === 'completed' && !normalizeString(next.endedAt)) {
    next.endedAt = nowIso();
  }
  if (normalizeString(next.endedAt) && normalizeString(next.startedAt) && !Number.isFinite(Number(next.durationSeconds))) {
    const duration = Math.max(0, Math.round((Date.parse(next.endedAt) - Date.parse(next.startedAt)) / 1000));
    next.durationSeconds = Number.isFinite(duration) ? duration : null;
  }
  callsById.set(callId, next);
  return next;
}

function clearMockTimers(callId) {
  const timers = mockTimersByCallId.get(callId) || [];
  timers.forEach((timerId) => clearTimeout(timerId));
  mockTimersByCallId.delete(callId);
}

function scheduleMockLifecycle(callId) {
  clearMockTimers(callId);
  const timers = [];
  timers.push(
    setTimeout(() => {
      patchCall(callId, { status: 'ringing' });
    }, MOCK_RING_DELAY_MS)
  );
  timers.push(
    setTimeout(() => {
      patchCall(callId, { status: 'in-progress' });
    }, MOCK_CONNECT_DELAY_MS)
  );
  timers.push(
    setTimeout(() => {
      patchCall(callId, {
        status: MOCK_TERMINAL_STATUS || 'completed',
        endedReason: MOCK_TERMINAL_STATUS === 'completed' ? 'completed' : MOCK_TERMINAL_STATUS,
        endedAt: nowIso(),
      });
      clearMockTimers(callId);
    }, MOCK_CONNECT_DELAY_MS + MOCK_DURATION_MS)
  );
  mockTimersByCallId.set(callId, timers);
}

function resolveEngineStatusPath(callId) {
  const encoded = encodeURIComponent(normalizeString(callId));
  const template = normalizeString(ENGINE_STATUS_PATH_TEMPLATE || '/v1/calls/{callId}');
  return template.includes('{callId}') ? template.replace('{callId}', encoded) : `${template.replace(/\/+$/, '')}/${encoded}`;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function buildEngineHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (normalizeString(ENGINE_BEARER_TOKEN)) {
    headers.Authorization = `Bearer ${normalizeString(ENGINE_BEARER_TOKEN)}`;
  }
  return headers;
}

async function startCallWithMockEngine(payload) {
  const call = buildCallStateFromStartPayload(payload, {
    callId: createCallId(),
    status: 'queued',
  });
  callsById.set(call.callId, call);
  scheduleMockLifecycle(call.callId);
  return call;
}

async function getCallWithMockEngine(callId) {
  const normalizedCallId = normalizeString(callId);
  return callsById.get(normalizedCallId) || null;
}

async function startCallWithWebhookEngine(payload) {
  if (!normalizeString(ENGINE_BASE_URL)) {
    throw new Error('SIP_MIXER_ENGINE_BASE_URL ontbreekt voor webhook engine mode.');
  }

  const { response, data } = await fetchJsonWithTimeout(
    `${ENGINE_BASE_URL}${ENGINE_START_PATH.startsWith('/') ? '' : '/'}${ENGINE_START_PATH}`,
    {
      method: 'POST',
      headers: buildEngineHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.error || data?.message || data?.detail) ||
        `SIP mixer engine start failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  const call = buildCallStateFromStartPayload(data || {}, {
    callId: createCallId(),
    status: 'queued',
    lead: payload?.lead,
    campaign: payload?.campaign,
    dynamicVariables: payload?.dynamicVariables,
    profileId: payload?.profileId,
    providerMetadata: {
      engineMode: 'webhook',
    },
  });
  callsById.set(call.callId, call);
  return call;
}

async function getCallWithWebhookEngine(callId) {
  const normalizedCallId = normalizeString(callId);
  const cached = callsById.get(normalizedCallId) || null;
  if (!normalizeString(ENGINE_BASE_URL)) {
    return cached;
  }

  const statusPath = resolveEngineStatusPath(normalizedCallId);
  const { response, data } = await fetchJsonWithTimeout(
    `${ENGINE_BASE_URL}${statusPath.startsWith('/') ? '' : '/'}${statusPath}`,
    {
      method: 'GET',
      headers: buildEngineHeaders(),
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.error || data?.message || data?.detail) ||
        `SIP mixer engine status failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  const call = buildCallStateFromStartPayload(data || {}, {
    callId: normalizedCallId,
    status: normalizeString(cached?.status || 'queued'),
    lead: cached?.lead,
    campaign: cached?.campaign,
    dynamicVariables: cached?.dynamicVariables,
    profileId: cached?.profileId,
    providerMetadata: {
      ...(cached?.providerMetadata && typeof cached.providerMetadata === 'object' ? cached.providerMetadata : {}),
      engineMode: 'webhook',
    },
    createdAt: normalizeString(cached?.createdAt || nowIso()),
  });
  callsById.set(call.callId, call);
  return call;
}

async function startCall(payload) {
  if (ENGINE_MODE === 'webhook') {
    return startCallWithWebhookEngine(payload);
  }
  return startCallWithMockEngine(payload);
}

async function getCall(callId) {
  if (ENGINE_MODE === 'webhook') {
    return getCallWithWebhookEngine(callId);
  }
  return getCallWithMockEngine(callId);
}

function requireApiAuth(req, res, next) {
  if (!normalizeString(CONTROL_API_KEY)) {
    return res.status(503).json({
      ok: false,
      error: 'SIP_MIXER_CONTROL_API_KEY ontbreekt op service.',
    });
  }

  const authHeader = normalizeString(req.get('authorization') || '');
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (bearerToken !== CONTROL_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

function validateStartPayload(payload) {
  const lead = payload?.lead;
  if (!lead || typeof lead !== 'object') {
    return 'lead ontbreekt.';
  }
  const phone = normalizeString(lead.phone);
  if (!phone) {
    return 'lead.phone ontbreekt.';
  }
  return '';
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'softora-sip-mixer-control-service',
    engineMode: ENGINE_MODE,
    authConfigured: Boolean(normalizeString(CONTROL_API_KEY)),
    engineBaseUrl: normalizeString(ENGINE_BASE_URL) || null,
    callsInMemory: callsById.size,
    timestamp: nowIso(),
  });
});

app.post('/v1/outbound/start', requireApiAuth, async (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const validationError = validateStartPayload(payload);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  try {
    const call = await startCall(payload);
    return res.status(200).json({
      ok: true,
      callId: call.callId,
      status: call.status,
      startedAt: call.startedAt,
      profileId: call.profileId,
      providerMetadata: call.providerMetadata,
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: normalizeString(error?.message || 'Kon outbound call niet starten.'),
      details: error?.data || null,
    });
  }
});

app.get('/v1/outbound/calls/:callId', requireApiAuth, async (req, res) => {
  const callId = normalizeString(req.params?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }

  try {
    const call = await getCall(callId);
    if (!call) {
      return res.status(404).json({ ok: false, error: 'Call niet gevonden.' });
    }
    return res.status(200).json(serializeCall(call));
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: normalizeString(error?.message || 'Kon call status niet ophalen.'),
      details: error?.data || null,
    });
  }
});

app.post('/v1/outbound/calls/:callId/events', requireApiAuth, (req, res) => {
  const callId = normalizeString(req.params?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }

  const existing = callsById.get(callId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Call niet gevonden.' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const patched = patchCall(callId, {
    status: normalizeString(payload.status || existing.status),
    endedReason: normalizeString(payload.endedReason || existing.endedReason),
    endedAt: normalizeString(payload.endedAt || existing.endedAt),
    durationSeconds: parseNumberSafe(payload.durationSeconds, parseNumberSafe(existing.durationSeconds, null)),
    recordingUrl: normalizeString(payload.recordingUrl || existing.recordingUrl),
    providerMetadata:
      payload.providerMetadata && typeof payload.providerMetadata === 'object'
        ? {
            ...(existing.providerMetadata && typeof existing.providerMetadata === 'object'
              ? existing.providerMetadata
              : {}),
            ...payload.providerMetadata,
          }
        : existing.providerMetadata,
  });

  if (normalizeString(payload.status).toLowerCase() === 'completed') {
    clearMockTimers(callId);
  }

  return res.status(200).json({ ok: true, call: serializeCall(patched) });
});

app.listen(PORT, () => {
  console.log(
    `softora-sip-mixer-control-service listening on http://localhost:${PORT} (engineMode=${ENGINE_MODE})`
  );
});
