const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const VERBOSE_VAPI_WEBHOOK_LOGS = /^(1|true|yes)$/i.test(
  String(process.env.VERBOSE_VAPI_WEBHOOK_LOGS || '')
);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STATE_TABLE = String(process.env.SUPABASE_STATE_TABLE || 'softora_runtime_state').trim();
const SUPABASE_STATE_KEY = String(process.env.SUPABASE_STATE_KEY || 'core').trim();
const MAIL_SMTP_HOST = String(
  process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || process.env.STRATO_SMTP_HOST || ''
).trim();
const MAIL_SMTP_PORT = Number(
  process.env.MAIL_SMTP_PORT || process.env.SMTP_PORT || process.env.STRATO_SMTP_PORT || 587
);
const MAIL_SMTP_USER = String(
  process.env.MAIL_SMTP_USER || process.env.SMTP_USER || process.env.STRATO_SMTP_USER || ''
).trim();
const MAIL_SMTP_PASS = String(
  process.env.MAIL_SMTP_PASS || process.env.SMTP_PASS || process.env.STRATO_SMTP_PASS || ''
).trim();
const MAIL_SMTP_SECURE = /^(1|true|yes)$/i.test(
  String(
    process.env.MAIL_SMTP_SECURE ||
      process.env.SMTP_SECURE ||
      (MAIL_SMTP_PORT === 465 ? 'true' : '')
  )
);
const MAIL_FROM_ADDRESS = String(
  process.env.CONFIRMATION_MAIL_FROM ||
    process.env.MAIL_FROM ||
    process.env.STRATO_SMTP_FROM ||
    MAIL_SMTP_USER ||
    ''
).trim();
const MAIL_FROM_NAME = String(
  process.env.CONFIRMATION_MAIL_FROM_NAME || process.env.MAIL_FROM_NAME || 'Softora'
).trim();
const MAIL_REPLY_TO = String(
  process.env.CONFIRMATION_MAIL_REPLY_TO || process.env.MAIL_REPLY_TO || ''
).trim();
const MAIL_IMAP_HOST = String(
  process.env.MAIL_IMAP_HOST ||
    process.env.IMAP_HOST ||
    process.env.STRATO_IMAP_HOST ||
    (/strato/i.test(String(process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || process.env.STRATO_SMTP_HOST || ''))
      ? 'imap.strato.com'
      : '')
).trim();
const MAIL_IMAP_PORT = Number(
  process.env.MAIL_IMAP_PORT || process.env.IMAP_PORT || process.env.STRATO_IMAP_PORT || 993
);
const MAIL_IMAP_SECURE = /^(1|true|yes)$/i.test(
  String(
    process.env.MAIL_IMAP_SECURE ||
      process.env.IMAP_SECURE ||
      (MAIL_IMAP_PORT === 993 ? 'true' : '')
  )
);
const MAIL_IMAP_USER = String(
  process.env.MAIL_IMAP_USER || process.env.IMAP_USER || process.env.STRATO_IMAP_USER || MAIL_SMTP_USER || ''
).trim();
const MAIL_IMAP_PASS = String(
  process.env.MAIL_IMAP_PASS || process.env.IMAP_PASS || process.env.STRATO_IMAP_PASS || MAIL_SMTP_PASS || ''
).trim();
const MAIL_IMAP_MAILBOX = String(process.env.MAIL_IMAP_MAILBOX || process.env.IMAP_MAILBOX || 'INBOX').trim() || 'INBOX';
const MAIL_IMAP_POLL_COOLDOWN_MS = Math.max(
  5_000,
  Math.min(300_000, Number(process.env.MAIL_IMAP_POLL_COOLDOWN_MS || 20_000) || 20_000)
);
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();
const recentAiCallInsights = [];
const recentDashboardActivities = [];
const inMemoryUiStateByScope = new Map();
const aiCallInsightsByCallId = new Map();
const aiAnalysisFingerprintByCallId = new Map();
const aiAnalysisInFlightCallIds = new Set();
const generatedAgendaAppointments = [];
const agendaAppointmentIdByCallId = new Map();
let nextGeneratedAgendaAppointmentId = 100000;
const sequentialDispatchQueues = new Map();
const sequentialDispatchQueueIdByCallId = new Map();
let nextSequentialDispatchQueueId = 1;
let supabaseClient = null;
let smtpTransporter = null;
let inboundConfirmationMailSyncPromise = null;
let inboundConfirmationMailSyncNotBeforeMs = 0;
let inboundConfirmationMailSyncLastResult = null;
let supabaseStateHydrationPromise = null;
let supabaseStateHydrated = false;
let supabasePersistChain = Promise.resolve();
let supabaseHydrateRetryNotBeforeMs = 0;
let supabaseLastHydrateError = '';
let supabaseLastPersistError = '';
const UI_STATE_SCOPE_PREFIX = 'ui_state:';
const DEMO_CONFIRMATION_TASK_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.ENABLE_DEMO_CONFIRMATION_TASK || '')
);

// Vercel bundelt dynamische sendFile-doelen niet altijd mee. Door de root-dir
// één keer te scannen op .html bestanden worden die files traceable voor de
// serverless bundle en blijven pagina-links zoals /premium-website.html werken.
function getKnownHtmlPageFiles() {
  try {
    return new Set(
      fs
        .readdirSync(__dirname, { withFileTypes: true })
        .filter((entry) => entry && entry.isFile() && /\.html$/i.test(entry.name))
        .map((entry) => entry.name)
    );
  } catch (error) {
    console.warn('[Startup] Kon HTML-pagina lijst niet lezen:', error?.message || error);
    return new Set(['index.html']);
  }
}

const knownHtmlPageFiles = getKnownHtmlPageFiles();
const knownPrettyPageSlugToFile = new Map(
  Array.from(knownHtmlPageFiles)
    .filter((file) => /\.html$/i.test(file))
    .map((file) => [file.replace(/\.html$/i, ''), file])
);

function toPrettyPagePathFromHtmlFile(fileName) {
  const base = String(fileName || '').replace(/\.html$/i, '');
  if (!base || base === 'index') return '/';
  return `/${base}`;
}

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use((req, _res, next) => {
  const requestPath = String(req.path || '');
  if (!isSupabaseConfigured()) return next();
  if (!requestPath.startsWith('/api/')) return next();

  ensureRuntimeStateHydratedFromSupabase()
    .then(() => next())
    .catch((error) => {
      console.error('[Supabase][HydrateMiddlewareError]', error?.message || error);
      next();
    });
});

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function redactSupabaseUrlForDebug(url) {
  const raw = normalizeString(url || '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return truncateText(raw, 80);
  }
}

async function fetchSupabaseStateRowViaRest(selectColumns = 'payload,updated_at') {
  if (!isSupabaseConfigured()) return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const url =
    `${baseUrl}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}` +
    `?select=${encodeURIComponent(selectColumns)}` +
    `&state_key=eq.${encodeURIComponent(SUPABASE_STATE_KEY)}` +
    '&limit=1';

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body, error: null };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: truncateText(error?.message || String(error), 500),
    };
  }
}

async function upsertSupabaseStateRowViaRest(row) {
  if (!isSupabaseConfigured()) return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(
    SUPABASE_STATE_TABLE
  )}?on_conflict=state_key`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body, error: null };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: truncateText(error?.message || String(error), 500),
    };
  }
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

function buildRuntimeStateSnapshotPayload() {
  const compactWebhookEvents = recentWebhookEvents.slice(0, 80).map((event) => ({
    receivedAt: normalizeString(event?.receivedAt || ''),
    messageType: normalizeString(event?.messageType || ''),
    callId: normalizeString(event?.callId || ''),
    callStatus: normalizeString(event?.callStatus || ''),
    // Volledige webhook payloads (met transcript/messages) maken de snapshot snel te groot
    // voor serverless + Supabase sync. Call updates bevatten de relevante transcriptdata al.
    payload: null,
  }));

  return {
    version: 2,
    savedAt: new Date().toISOString(),
    recentWebhookEvents: compactWebhookEvents,
    recentCallUpdates: recentCallUpdates.slice(0, 500),
    recentAiCallInsights: recentAiCallInsights.slice(0, 500),
    recentDashboardActivities: recentDashboardActivities.slice(0, 500),
    generatedAgendaAppointments: generatedAgendaAppointments.slice(),
    nextGeneratedAgendaAppointmentId,
  };
}

function applyRuntimeStateSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const nextWebhookEvents = Array.isArray(payload.recentWebhookEvents) ? payload.recentWebhookEvents.slice(0, 200) : [];
  const nextCallUpdates = Array.isArray(payload.recentCallUpdates) ? payload.recentCallUpdates.slice(0, 500) : [];
  const nextAiCallInsights = Array.isArray(payload.recentAiCallInsights) ? payload.recentAiCallInsights.slice(0, 500) : [];
  const nextDashboardActivities = Array.isArray(payload.recentDashboardActivities)
    ? payload.recentDashboardActivities.slice(0, 500)
    : [];
  const nextAppointments = Array.isArray(payload.generatedAgendaAppointments)
    ? payload.generatedAgendaAppointments.slice()
    : [];

  recentWebhookEvents.splice(0, recentWebhookEvents.length, ...nextWebhookEvents);

  recentCallUpdates.splice(0, recentCallUpdates.length, ...nextCallUpdates);
  callUpdatesById.clear();
  recentCallUpdates.forEach((item) => {
    if (item && item.callId) {
      callUpdatesById.set(item.callId, item);
    }
  });

  recentAiCallInsights.splice(0, recentAiCallInsights.length, ...nextAiCallInsights);
  aiCallInsightsByCallId.clear();
  recentAiCallInsights.forEach((item) => {
    if (item && item.callId) {
      aiCallInsightsByCallId.set(item.callId, item);
    }
  });

  recentDashboardActivities.splice(0, recentDashboardActivities.length, ...nextDashboardActivities);

  generatedAgendaAppointments.splice(0, generatedAgendaAppointments.length, ...nextAppointments);
  agendaAppointmentIdByCallId.clear();
  let maxAppointmentId = 99999;
  generatedAgendaAppointments.forEach((item) => {
    const id = Number(item?.id);
    const callId = normalizeString(item?.callId || '');
    if (Number.isFinite(id) && id > maxAppointmentId) maxAppointmentId = id;
    if (Number.isFinite(id) && callId) {
      agendaAppointmentIdByCallId.set(callId, id);
    }
  });

  const payloadNextId = Number(payload.nextGeneratedAgendaAppointmentId);
  nextGeneratedAgendaAppointmentId = Number.isFinite(payloadNextId)
    ? Math.max(payloadNextId, maxAppointmentId + 1)
    : maxAppointmentId + 1;

  return true;
}

async function ensureRuntimeStateHydratedFromSupabase(options = {}) {
  const force = Boolean(options && options.force);
  if (!isSupabaseConfigured()) return false;
  if (supabaseStateHydrated) return true;
  if (supabaseStateHydrationPromise) return supabaseStateHydrationPromise;
  if (!force && Date.now() < supabaseHydrateRetryNotBeforeMs) return false;

  supabaseStateHydrationPromise = (async () => {
    try {
      const client = getSupabaseClient();
      if (!client) return false;

      const { data, error } = await client
        .from(SUPABASE_STATE_TABLE)
        .select('payload, updated_at')
        .eq('state_key', SUPABASE_STATE_KEY)
        .maybeSingle();

      if (error) {
        const fallback = await fetchSupabaseStateRowViaRest('payload,updated_at');
        if (!fallback.ok) {
          console.error('[Supabase][HydrateError]', error.message || error);
          const fallbackMsg = fallback.error
            ? ` | REST fallback: ${fallback.error}`
            : fallback.status
              ? ` | REST fallback status: ${fallback.status}`
              : '';
          supabaseLastHydrateError = truncateText(`${error.message || String(error)}${fallbackMsg}`, 500);
          supabaseHydrateRetryNotBeforeMs = Date.now() + 60_000;
          return false;
        }

        const row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
        if (row && row.payload && typeof row.payload === 'object') {
          applyRuntimeStateSnapshotPayload(row.payload);
        }
        supabaseStateHydrated = true;
        supabaseLastHydrateError = '';
        supabaseHydrateRetryNotBeforeMs = 0;
        return true;
      }

      if (data && data.payload && typeof data.payload === 'object') {
        applyRuntimeStateSnapshotPayload(data.payload);
        console.log(
          '[Supabase] Runtime state geladen',
          JSON.stringify({
            table: SUPABASE_STATE_TABLE,
            stateKey: SUPABASE_STATE_KEY,
            updatedAt: data.updated_at || null,
            callUpdates: recentCallUpdates.length,
            insights: recentAiCallInsights.length,
            dashboardActivities: recentDashboardActivities.length,
            appointments: generatedAgendaAppointments.length,
          })
        );
      }

      supabaseStateHydrated = true;
      supabaseLastHydrateError = '';
      supabaseHydrateRetryNotBeforeMs = 0;
      return true;
    } catch (error) {
      console.error('[Supabase][HydrateCrash]', error?.message || error);
      supabaseLastHydrateError = truncateText(error?.message || String(error), 500);
      supabaseHydrateRetryNotBeforeMs = Date.now() + 60_000;
      return false;
    } finally {
      supabaseStateHydrationPromise = null;
    }
  })();

  return supabaseStateHydrationPromise;
}

async function forceHydrateRuntimeStateWithRetries(maxAttempts = 3) {
  if (!isSupabaseConfigured()) return false;
  if (supabaseStateHydrated) return true;

  const attempts = Math.max(1, Math.min(5, Number(maxAttempts) || 1));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    supabaseHydrateRetryNotBeforeMs = 0;
    const ok = await ensureRuntimeStateHydratedFromSupabase({ force: true });
    if (ok) return true;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return false;
}

async function persistRuntimeStateToSupabase(reason = 'unknown') {
  if (!isSupabaseConfigured()) return false;
  try {
    const client = getSupabaseClient();
    if (!client) return false;
    const payload = buildRuntimeStateSnapshotPayload();
    const row = {
      state_key: SUPABASE_STATE_KEY,
      payload,
      updated_at: new Date().toISOString(),
      meta: {
        reason,
        counts: {
          webhookEvents: recentWebhookEvents.length,
          callUpdates: recentCallUpdates.length,
          aiCallInsights: recentAiCallInsights.length,
          dashboardActivities: recentDashboardActivities.length,
          appointments: generatedAgendaAppointments.length,
        },
      },
    };

    const { error } = await client.from(SUPABASE_STATE_TABLE).upsert(row, {
      onConflict: 'state_key',
    });

    if (error) {
      const fallback = await upsertSupabaseStateRowViaRest(row);
      if (!fallback.ok) {
        console.error('[Supabase][PersistError]', error.message || error);
        const fallbackMsg = fallback.error
          ? ` | REST fallback: ${fallback.error}`
          : fallback.status
            ? ` | REST fallback status: ${fallback.status}`
            : '';
        supabaseLastPersistError = truncateText(`${error.message || String(error)}${fallbackMsg}`, 500);
        return false;
      }
      supabaseLastPersistError = '';
      return true;
    }

    supabaseLastPersistError = '';
    return true;
  } catch (error) {
    console.error('[Supabase][PersistCrash]', error?.message || error);
    supabaseLastPersistError = truncateText(error?.message || String(error), 500);
    return false;
  }
}

function queueRuntimeStatePersist(reason = 'unknown') {
  if (!isSupabaseConfigured()) return;

  supabasePersistChain = supabasePersistChain
    .catch(() => null)
    .then(() => persistRuntimeStateToSupabase(reason))
    .catch((error) => {
      console.error('[Supabase][PersistQueueError]', error?.message || error);
      return false;
    });
}

function createDashboardActivityEntry(input) {
  const nowIso = new Date().toISOString();
  const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: normalizeString(input?.id || entryId),
    type: normalizeString(input?.type || input?.action || 'dashboard_action'),
    title: truncateText(normalizeString(input?.title || ''), 200) || 'Dashboard actie',
    detail: truncateText(normalizeString(input?.detail || input?.description || ''), 500),
    company: truncateText(normalizeString(input?.company || ''), 120),
    source: truncateText(normalizeString(input?.source || 'personeel-dashboard'), 80),
    actor: truncateText(normalizeString(input?.actor || ''), 120),
    taskId: Number.isFinite(Number(input?.taskId)) ? Number(input.taskId) : null,
    callId: truncateText(normalizeString(input?.callId || ''), 120),
    createdAt: normalizeString(input?.createdAt || nowIso) || nowIso,
  };
}

function appendDashboardActivity(input, reason = 'dashboard_activity') {
  const entry = createDashboardActivityEntry(input);
  recentDashboardActivities.unshift(entry);
  if (recentDashboardActivities.length > 500) {
    recentDashboardActivities.length = 500;
  }
  queueRuntimeStatePersist(reason);
  return entry;
}

function normalizeUiStateScope(scope) {
  const value = normalizeString(scope || '').toLowerCase();
  if (!/^[a-z0-9:_-]{1,80}$/.test(value)) return '';
  return value;
}

function getUiStateRowKey(scope) {
  const normalizedScope = normalizeUiStateScope(scope);
  return normalizedScope ? `${UI_STATE_SCOPE_PREFIX}${normalizedScope}` : '';
}

function sanitizeUiStateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(values)) {
    const key = normalizeString(rawKey);
    if (!key || key.length > 120) continue;
    if (rawValue === undefined) continue;
    if (rawValue === null) {
      out[key] = '';
      continue;
    }
    out[key] = truncateText(String(rawValue), 200000);
  }
  return out;
}

async function getUiStateValues(scope) {
  const normalizedScope = normalizeUiStateScope(scope);
  if (!normalizedScope) return null;

  if (!isSupabaseConfigured()) {
    return { values: { ...(inMemoryUiStateByScope.get(normalizedScope) || {}) }, source: 'memory' };
  }

  try {
    const client = getSupabaseClient();
    const rowKey = getUiStateRowKey(normalizedScope);
    const { data, error } = await client
      .from(SUPABASE_STATE_TABLE)
      .select('payload, updated_at')
      .eq('state_key', rowKey)
      .maybeSingle();

    if (error) {
      console.error('[UI State][Supabase][GetError]', error.message || error);
      return { values: { ...(inMemoryUiStateByScope.get(normalizedScope) || {}) }, source: 'memory' };
    }

    const values = sanitizeUiStateValues(data?.payload?.values || {});
    inMemoryUiStateByScope.set(normalizedScope, values);
    return {
      values: { ...values },
      updatedAt: normalizeString(data?.updated_at || '') || null,
      source: 'supabase',
    };
  } catch (error) {
    console.error('[UI State][Supabase][GetCrash]', error?.message || error);
    return { values: { ...(inMemoryUiStateByScope.get(normalizedScope) || {}) }, source: 'memory' };
  }
}

async function setUiStateValues(scope, values, meta = {}) {
  const normalizedScope = normalizeUiStateScope(scope);
  if (!normalizedScope) return null;

  const sanitizedValues = sanitizeUiStateValues(values);
  inMemoryUiStateByScope.set(normalizedScope, sanitizedValues);

  if (!isSupabaseConfigured()) {
    return { values: { ...sanitizedValues }, source: 'memory' };
  }

  try {
    const client = getSupabaseClient();
    const rowKey = getUiStateRowKey(normalizedScope);
    const row = {
      state_key: rowKey,
      payload: {
        scope: normalizedScope,
        values: sanitizedValues,
      },
      meta: {
        type: 'ui_state',
        scope: normalizedScope,
        source: normalizeString(meta.source || 'frontend'),
        actor: normalizeString(meta.actor || ''),
      },
      updated_at: new Date().toISOString(),
    };

    const { error } = await client.from(SUPABASE_STATE_TABLE).upsert(row, {
      onConflict: 'state_key',
    });

    if (error) {
      console.error('[UI State][Supabase][SetError]', error.message || error);
      return { values: { ...sanitizedValues }, source: 'memory' };
    }

    return { values: { ...sanitizedValues }, source: 'supabase' };
  } catch (error) {
    console.error('[UI State][Supabase][SetCrash]', error?.message || error);
    return { values: { ...sanitizedValues }, source: 'memory' };
  }
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function collectStringValuesByKey(root, keyRegex, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const maxItems = options.maxItems ?? 10;
  const minLength = options.minLength ?? 1;
  const out = [];
  const seen = new Set();

  function walk(node, depth) {
    if (out.length >= maxItems) return;
    if (depth > maxDepth) return;
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
        if (out.length >= maxItems) return;
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && keyRegex.test(key)) {
        const normalized = normalizeString(value);
        if (normalized.length >= minLength && !seen.has(normalized)) {
          seen.add(normalized);
          out.push(normalized);
          if (out.length >= maxItems) return;
        }
      }

      if (value && typeof value === 'object') {
        walk(value, depth + 1);
        if (out.length >= maxItems) return;
      }
    }
  }

  walk(root, 0);
  return out;
}

function formatTranscriptPartsFromEntries(entries, options = {}) {
  if (!Array.isArray(entries)) return '';
  const preferFull = options.preferFull !== false;
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 4000;

  const parts = entries
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return normalizeString(entry);
      if (typeof entry !== 'object') return '';

      const speaker = normalizeString(
        entry.role ||
          entry.speaker ||
          entry.name ||
          entry.from ||
          entry.participant ||
          entry.channel ||
          entry.actor
      );

      const nestedMessage =
        (entry.message && typeof entry.message === 'object' ? entry.message : null) ||
        (entry.content && typeof entry.content === 'object' ? entry.content : null);

      const text = normalizeString(
        entry.text ||
          entry.content ||
          entry.message ||
          entry.utterance ||
          entry.transcript ||
          entry.value ||
          nestedMessage?.text ||
          nestedMessage?.content ||
          nestedMessage?.message
      );
      if (!text) return '';
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter(Boolean);

  if (parts.length === 0) return '';
  const joined = preferFull ? parts.join('\n') : parts.slice(-6).join(' | ');
  return truncateText(joined, maxLength);
}

function extractTranscriptText(payload, options = {}) {
  const maxLength = Number.isFinite(options.maxLength) ? Math.max(80, options.maxLength) : 4000;
  const preferFull = options.preferFull !== false;
  const transcriptCandidates = [
    getByPath(payload, 'message.call.transcript'),
    getByPath(payload, 'message.call.artifact.transcript'),
    getByPath(payload, 'message.artifact.transcript'),
    getByPath(payload, 'call.artifact.transcript'),
    getByPath(payload, 'message.transcript'),
    getByPath(payload, 'call.transcript'),
    getByPath(payload, 'transcript'),
    getByPath(payload, 'message.call.artifact.messages'),
    getByPath(payload, 'message.artifact.messages'),
    getByPath(payload, 'call.artifact.messages'),
    getByPath(payload, 'message.call.messages'),
    getByPath(payload, 'message.messages'),
    getByPath(payload, 'call.messages'),
    getByPath(payload, 'message.call.conversation'),
    getByPath(payload, 'message.conversation'),
    getByPath(payload, 'call.conversation'),
    getByPath(payload, 'message.call.utterances'),
    getByPath(payload, 'message.utterances'),
    getByPath(payload, 'call.utterances'),
  ];

  for (const candidate of transcriptCandidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      return truncateText(candidate, maxLength);
    }

    if (Array.isArray(candidate)) {
      const formatted = formatTranscriptPartsFromEntries(candidate, { preferFull, maxLength });
      if (formatted) return formatted;
    }

    if (candidate && typeof candidate === 'object') {
      const nestedArrays = [
        candidate.messages,
        candidate.items,
        candidate.utterances,
        candidate.turns,
        candidate.entries,
        candidate.segments,
        candidate.transcript,
      ];
      for (const nested of nestedArrays) {
        if (!Array.isArray(nested)) continue;
        const formatted = formatTranscriptPartsFromEntries(nested, { preferFull, maxLength });
        if (formatted) return formatted;
      }
    }
  }

  const utteranceCandidates = collectStringValuesByKey(payload, /utterance|transcript/i, {
    maxItems: preferFull ? 40 : 8,
    minLength: 8,
  });
  if (utteranceCandidates.length > 0) {
    return truncateText(
      preferFull ? utteranceCandidates.join('\n') : utteranceCandidates.slice(-4).join(' | '),
      maxLength
    );
  }

  return '';
}

function extractTranscriptSnippet(payload) {
  return extractTranscriptText(payload, { maxLength: 450, preferFull: false });
}

function extractTranscriptFull(payload) {
  return extractTranscriptText(payload, { maxLength: 8000, preferFull: true });
}

function extractSummaryFromVapiPayload(payload) {
  const directSummaryPaths = [
    'message.call.analysis.summary',
    'message.analysis.summary',
    'call.analysis.summary',
    'analysis.summary',
    'message.summary',
    'summary',
    'message.call.summary',
    'message.artifact.summary',
  ];

  for (const path of directSummaryPaths) {
    const value = getByPath(payload, path);
    if (typeof value === 'string' && normalizeString(value)) {
      return truncateText(value, 700);
    }
  }

  const summaries = collectStringValuesByKey(payload, /summary|recap|synopsis/i, {
    maxItems: 5,
    minLength: 12,
  });
  if (summaries.length > 0) {
    return truncateText(summaries[0], 700);
  }

  return '';
}

function extractCallUpdateFromWebhookPayload(payload) {
  const messageType = normalizeString(payload?.message?.type || payload?.type || 'unknown');
  const call = payload?.message?.call || payload?.call || {};
  const callId = normalizeString(call?.id || payload?.callId || payload?.message?.callId);
  const phone =
    normalizeString(call?.customer?.number) ||
    normalizeString(payload?.message?.customer?.number) ||
    normalizeString(call?.phoneNumber) ||
    normalizeString(payload?.customer?.number);
  const company =
    normalizeString(call?.metadata?.leadCompany) ||
    normalizeString(payload?.message?.call?.metadata?.leadCompany) ||
    normalizeString(call?.customer?.name) ||
    normalizeString(call?.metadata?.company);
  const name =
    normalizeString(call?.metadata?.leadName) ||
    normalizeString(call?.customer?.name) ||
    normalizeString(payload?.message?.customer?.name);
  const status = normalizeString(call?.status || payload?.status || '');
  const summary = extractSummaryFromVapiPayload(payload);
  const transcriptSnippet = extractTranscriptSnippet(payload);
  const transcriptFull = extractTranscriptFull(payload);
  const endedReason =
    normalizeString(call?.endedReason) ||
    normalizeString(getByPath(payload, 'message.call.endedReason')) ||
    normalizeString(getByPath(payload, 'message.endedReason'));

  if (!callId && !phone && !company && !summary && !transcriptSnippet && !status) {
    return null;
  }

  return {
    callId: callId || `anon-${Date.now()}`,
    phone,
    company,
    name,
    status,
    messageType,
    summary,
    transcriptSnippet,
    transcriptFull,
    endedReason,
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  };
}

function extractCallUpdateFromVapiCallStatusResponse(callId, data) {
  const call =
    data?.call && typeof data.call === 'object'
      ? data.call
      : data && typeof data === 'object'
        ? data
        : null;
  if (!call || typeof call !== 'object') return null;

  const syntheticPayload = {
    type: 'vapi-call-status-fetch',
    message: {
      type: 'vapi-call-status-fetch',
      call,
      analysis: call.analysis || data?.analysis || null,
      artifact: call.artifact || data?.artifact || null,
      summary: call.summary || data?.summary || null,
      transcript: call.transcript || data?.transcript || null,
      messages: call.messages || data?.messages || null,
      conversation: call.conversation || data?.conversation || null,
      customer: call.customer || data?.customer || null,
    },
    call,
    analysis: call.analysis || data?.analysis || null,
    artifact: call.artifact || data?.artifact || null,
    summary: call.summary || data?.summary || null,
    transcript: call.transcript || data?.transcript || null,
    messages: call.messages || data?.messages || null,
  };

  const extracted = extractCallUpdateFromWebhookPayload(syntheticPayload);
  if (!extracted) return null;

  return {
    ...extracted,
    callId: normalizeString(call?.id || callId || extracted.callId),
    messageType: 'vapi-call-status-fetch',
    updatedAt: normalizeString(call?.updatedAt || data?.updatedAt || '') || new Date().toISOString(),
    updatedAtMs:
      Date.parse(normalizeString(call?.updatedAt || data?.updatedAt || '')) || Date.now(),
  };
}

async function refreshCallUpdateFromVapiStatusApi(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  if (!normalizeString(process.env.VAPI_API_KEY)) return null;

  try {
    const { data } = await fetchVapiCallStatusById(normalizedCallId);
    const update = extractCallUpdateFromVapiCallStatusResponse(normalizedCallId, data);
    if (!update) return null;
    return upsertRecentCallUpdate(update);
  } catch (error) {
    console.warn(
      '[Vapi Call Status Refresh Failed]',
      JSON.stringify(
        {
          callId: normalizedCallId,
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
        },
        null,
        2
      )
    );
    return null;
  }
}

function upsertRecentCallUpdate(update) {
  if (!update) return null;

  const existing = callUpdatesById.get(update.callId);
  const merged = existing
    ? {
        ...existing,
        ...update,
        phone: update.phone || existing.phone || '',
        company: update.company || existing.company || '',
        name: update.name || existing.name || '',
        status: update.status || existing.status || '',
        summary: update.summary || existing.summary || '',
        transcriptSnippet: update.transcriptSnippet || existing.transcriptSnippet || '',
        transcriptFull: update.transcriptFull || existing.transcriptFull || '',
        endedReason: update.endedReason || existing.endedReason || '',
        messageType: update.messageType || existing.messageType || '',
        updatedAt: update.updatedAt,
        updatedAtMs: update.updatedAtMs,
      }
    : update;

  callUpdatesById.set(merged.callId, merged);

  const existingIndex = recentCallUpdates.findIndex((item) => item.callId === merged.callId);
  if (existingIndex >= 0) {
    recentCallUpdates.splice(existingIndex, 1);
  }
  recentCallUpdates.unshift(merged);
  if (recentCallUpdates.length > 500) {
    const removed = recentCallUpdates.pop();
    if (removed) {
      callUpdatesById.delete(removed.callId);
    }
  }

  queueRuntimeStatePersist('call_update');

  return merged;
}

function normalizeNlPhoneToE164(input) {
  const raw = normalizeString(input);

  if (!raw) {
    throw new Error('Telefoonnummer ontbreekt');
  }

  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    const normalized = `+${cleaned.slice(1).replace(/\D/g, '')}`;

    if (!/^\+\d{8,15}$/.test(normalized)) {
      throw new Error(`Ongeldig E.164 nummer: ${raw}`);
    }

    if (normalized.startsWith('+31')) {
      const nlDigits = normalized.slice(3);
      if (nlDigits.length !== 9) {
        throw new Error(`NL nummer heeft niet 9 cijfers na +31: ${raw}`);
      }
    }

    return normalized;
  }

  const digits = cleaned.replace(/\D/g, '');

  if (digits.startsWith('31')) {
    const nlDigits = digits.slice(2);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 9 cijfers na 31: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.startsWith('0')) {
    const nlDigits = digits.slice(1);
    if (nlDigits.length !== 9) {
      throw new Error(`NL nummer heeft niet 10 cijfers inclusief 0: ${raw}`);
    }
    return `+31${nlDigits}`;
  }

  if (digits.length === 9 && digits.startsWith('6')) {
    return `+31${digits}`;
  }

  throw new Error(`Kan nummer niet omzetten naar NL E.164 formaat: ${raw}`);
}

function getRequiredVapiEnv() {
  return ['VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID'];
}

function getMissingEnvVars() {
  return getRequiredVapiEnv().filter((key) => !process.env[key]);
}

function toBooleanSafe(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'ja'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nee'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDateYyyyMmDd(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) return '';
  const y = asDate.getFullYear();
  const m = String(asDate.getMonth() + 1).padStart(2, '0');
  const d = String(asDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTimeHhMm(value) {
  const raw = normalizeString(value);
  if (!raw) return '';

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hours = Math.max(0, Math.min(23, Number(hhmm[1])));
    const mins = Math.max(0, Math.min(59, Number(hhmm[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  const compact = raw.match(/^(\d{1,2})(\d{2})$/);
  if (compact) {
    const hours = Math.max(0, Math.min(23, Number(compact[1])));
    const mins = Math.max(0, Math.min(59, Number(compact[2])));
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  return '';
}

function formatEuroLabel(amount) {
  const numeric = parseNumberSafe(amount, null);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Onbekend';

  try {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `EUR ${Math.round(numeric)}`;
  }
}

function parseJsonLoose(text) {
  const raw = normalizeString(text);
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractOpenAiTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return normalizeString(part.text || part.content || part.output_text || '');
      })
      .filter(Boolean)
      .join('\n');
  }

  if (content && typeof content === 'object') {
    return normalizeString(content.text || content.content || '');
  }

  return '';
}

function getOpenAiApiKey() {
  return normalizeString(process.env.OPENAI_API_KEY);
}

function normalizeAiSummaryStyle(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'medium';
  if (['short', 'medium', 'long', 'bullets'].includes(raw)) return raw;
  return '';
}

async function generateTextSummaryWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const sourceText = truncateText(normalizeString(options.text || ''), 20000);
  const style = normalizeAiSummaryStyle(options.style) || 'medium';
  const language = normalizeString(options.language || 'nl') || 'nl';
  const maxSentences = Math.max(1, Math.min(12, parseIntSafe(options.maxSentences, style === 'short' ? 2 : 4)));

  const systemPrompt = [
    'Je bent een nauwkeurige tekstassistent.',
    'Vat de input samen op basis van de gevraagde stijl.',
    'Gebruik de gevraagde taal.',
    'Verzin geen feiten die niet in de bron staan.',
    'Geef alleen de samenvatting terug (geen markdown-uitleg of extra labels).',
  ].join('\n');

  const userPayload = {
    task: 'summarize',
    style,
    language,
    maxSentences,
    extraInstructions: normalizeString(options.extraInstructions || ''),
    text: sourceText,
  };

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              `Maak een samenvatting in taal: ${language}.`,
              `Stijl: ${style}.`,
              style === 'bullets'
                ? `Geef maximaal ${Math.max(3, maxSentences)} bullets, elke regel start met "- ".`
                : `Geef maximaal ${maxSentences} zinnen.`,
              normalizeString(options.extraInstructions || '')
                ? `Extra instructies: ${normalizeString(options.extraInstructions || '')}`
                : '',
              '',
              'Brontekst:',
              sourceText,
              '',
              'JSON context (ter controle):',
              JSON.stringify(userPayload),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }),
    },
    30000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI samenvatting mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = normalizeString(extractOpenAiTextContent(content));
  if (!text) {
    const err = new Error('OpenAI gaf een lege samenvatting terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    summary: truncateText(text, 5000),
    style,
    language,
    maxSentences,
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
  };
}

function shouldAnalyzeCallUpdateWithAi(callUpdate) {
  if (!callUpdate || !getOpenAiApiKey()) return false;

  const summary = normalizeString(callUpdate.summary);
  const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet);
  if (!summary && transcriptSnippet.length < 20) return false;

  const statusText = `${normalizeString(callUpdate.status).toLowerCase()} ${normalizeString(
    callUpdate.messageType
  ).toLowerCase()} ${normalizeString(callUpdate.endedReason).toLowerCase()}`;
  const looksFinal = /(end|ended|complete|completed|hang|finish|final|analysis|summary)/i.test(
    statusText
  );

  // Analyseer pas op (waarschijnlijk) finale updates om webhook-load tijdens live calls te beperken.
  return looksFinal;
}

function getCallUpdateAiFingerprint(callUpdate) {
  return [
    normalizeString(callUpdate?.status),
    normalizeString(callUpdate?.endedReason),
    normalizeString(callUpdate?.summary),
    normalizeString(callUpdate?.transcriptSnippet),
    truncateText(normalizeString(callUpdate?.transcriptFull), 1200),
  ].join('|');
}

function addDaysToIsoDate(dateValue, days) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const next = new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractLikelyAppointmentDateFromText(text, baseIso) {
  const raw = normalizeString(text);
  if (!raw) return '';

  const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return normalizeDateYyyyMmDd(isoMatch[1]);
  }

  const dmyMatch = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmyMatch) {
    const now = new Date(baseIso || Date.now());
    const yearRaw = normalizeString(dmyMatch[3]);
    const year =
      yearRaw.length === 4
        ? Number(yearRaw)
        : yearRaw.length === 2
          ? 2000 + Number(yearRaw)
          : now.getFullYear();
    const month = Math.max(1, Math.min(12, Number(dmyMatch[2])));
    const day = Math.max(1, Math.min(31, Number(dmyMatch[1])));
    return normalizeDateYyyyMmDd(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  const lower = raw.toLowerCase();
  const baseDate = normalizeDateYyyyMmDd(baseIso) || normalizeDateYyyyMmDd(new Date().toISOString());
  if (!baseDate) return '';
  if (/\bovermorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 2);
  if (/\bmorgen\b/.test(lower)) return addDaysToIsoDate(baseDate, 1);
  if (/\bvandaag\b/.test(lower)) return addDaysToIsoDate(baseDate, 0);

  return '';
}

function extractLikelyAppointmentTimeFromText(text) {
  const raw = normalizeString(text);
  if (!raw) return '';

  const hhmm = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) {
    return normalizeTimeHhMm(`${hhmm[1]}:${hhmm[2]}`);
  }

  const lower = raw.toLowerCase();
  const uurMatch = lower.match(/\b(?:om\s+)?(\d{1,2})\s*uur(?:\s+([a-z]+(?:\s+[a-z]+)?))?\b/);
  if (!uurMatch) return '';

  let hour = Math.max(0, Math.min(23, Number(uurMatch[1])));
  const suffix = normalizeString(uurMatch[2] || '').toLowerCase();

  if (/(middag|des middags|vanmiddag|avond)/.test(suffix) && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  if (/(ochtend|smorgens|morgens)/.test(suffix) && hour === 12) {
    hour = 0;
  }

  return normalizeTimeHhMm(`${String(hour).padStart(2, '0')}:00`);
}

function createRuleBasedInsightFromCallUpdate(callUpdate) {
  if (!callUpdate?.callId) return null;

  const summary = normalizeString(callUpdate.summary || '');
  const transcriptFull = normalizeString(callUpdate.transcriptFull || '');
  const transcriptSnippet = normalizeString(callUpdate.transcriptSnippet || '');
  const sourceText = [summary, transcriptFull, transcriptSnippet].filter(Boolean).join('\n');
  if (!sourceText) return null;

  const lower = sourceText.toLowerCase();
  const hasAppointmentLanguage =
    /(afspraak|intake|kennismaking|langs\s+kom)/.test(lower) &&
    /(ingepland|gepland|bevestigd|morgen|overmorgen|\bom\b\s*\d{1,2}(:\d{2})?\s*uur|\b\d{1,2}:\d{2}\b)/.test(
      lower
    );

  const vapiSummaryStrong =
    /er is een afspraak ingepland|afspraak ingepland|afspraak gepland|intake ingepland/.test(lower);

  const appointmentBooked = hasAppointmentLanguage || vapiSummaryStrong;
  const appointmentDate = extractLikelyAppointmentDateFromText(sourceText, callUpdate.updatedAt);
  const appointmentTime = extractLikelyAppointmentTimeFromText(sourceText);

  const ruleSummary =
    summary ||
    truncateText(
      transcriptSnippet || transcriptFull || 'Call verwerkt op basis van transcriptie.',
      900
    );

  return {
    callId: normalizeString(callUpdate.callId),
    company: normalizeString(callUpdate.company || ''),
    contactName: normalizeString(callUpdate.name || ''),
    phone: normalizeString(callUpdate.phone || ''),
    branche: '',
    summary: ruleSummary,
    appointmentBooked: Boolean(appointmentBooked && appointmentDate),
    appointmentDate: appointmentBooked ? appointmentDate : '',
    appointmentTime: appointmentBooked ? appointmentTime : '',
    estimatedValueEur: null,
    followUpRequired: Boolean(appointmentBooked),
    followUpReason: appointmentBooked
      ? 'Bevestigingsmail sturen op basis van gedetecteerde afspraak in Vapi transcriptie.'
      : '',
    source: 'rule',
    model: 'rule',
    analyzedAt: new Date().toISOString(),
  };
}

function ensureRuleBasedInsightAndAppointment(callUpdate) {
  if (!callUpdate || !callUpdate.callId) return null;

  const existingInsight = aiCallInsightsByCallId.get(callUpdate.callId) || null;
  const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);

  let nextInsight = existingInsight;

  if (!existingInsight && ruleInsight) {
    nextInsight = upsertAiCallInsight(ruleInsight);
  } else if (existingInsight && ruleInsight) {
    let changed = false;
    const merged = { ...existingInsight };

    if (!normalizeString(merged.summary) && normalizeString(ruleInsight.summary)) {
      merged.summary = ruleInsight.summary;
      changed = true;
    }

    if (!toBooleanSafe(merged.appointmentBooked, false) && toBooleanSafe(ruleInsight.appointmentBooked, false)) {
      merged.appointmentBooked = true;
      if (!normalizeDateYyyyMmDd(merged.appointmentDate)) merged.appointmentDate = ruleInsight.appointmentDate;
      if (!normalizeTimeHhMm(merged.appointmentTime)) merged.appointmentTime = ruleInsight.appointmentTime;
      if (!normalizeString(merged.followUpReason)) merged.followUpReason = ruleInsight.followUpReason;
      if (!toBooleanSafe(merged.followUpRequired, false)) merged.followUpRequired = true;
      if (!normalizeString(merged.model)) merged.model = 'rule';
      if (!normalizeString(merged.source)) merged.source = 'rule';
      changed = true;
    }

    if (changed) {
      merged.analyzedAt = new Date().toISOString();
      nextInsight = upsertAiCallInsight(merged);
    }
  }

  if (!nextInsight) return null;

  const existingAppointmentId = agendaAppointmentIdByCallId.get(callUpdate.callId);
  if (
    !existingAppointmentId &&
    toBooleanSafe(nextInsight.appointmentBooked, false)
  ) {
    const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
      ...nextInsight,
      callId: callUpdate.callId,
      leadCompany: callUpdate.company,
      leadName: callUpdate.name,
    });

    if (agendaAppointment) {
      const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
      if (savedAppointment) {
        nextInsight = upsertAiCallInsight({
          ...nextInsight,
          agendaAppointmentId: savedAppointment.id,
        });
      }
    }
  }

  return nextInsight;
}

function backfillInsightsAndAppointmentsFromRecentCallUpdates() {
  let touched = 0;
  for (const callUpdate of recentCallUpdates) {
    const callId = normalizeString(callUpdate?.callId || '');
    if (!callId || callId.startsWith('demo-')) continue;

    const beforeInsight = aiCallInsightsByCallId.get(callId) || null;
    const beforeApptId = agendaAppointmentIdByCallId.get(callId) || null;
    const afterInsight = ensureRuleBasedInsightAndAppointment(callUpdate);
    const afterApptId = agendaAppointmentIdByCallId.get(callId) || null;

    if (
      (afterInsight && !beforeInsight) ||
      (afterInsight && beforeInsight && JSON.stringify(afterInsight) !== JSON.stringify(beforeInsight)) ||
      (!beforeApptId && afterApptId)
    ) {
      touched += 1;
    }
  }
  return touched;
}

function compareAgendaAppointments(a, b) {
  const aKey = `${normalizeDateYyyyMmDd(a?.date)}T${normalizeTimeHhMm(a?.time) || '00:00'}`;
  const bKey = `${normalizeDateYyyyMmDd(b?.date)}T${normalizeTimeHhMm(b?.time) || '00:00'}`;
  if (aKey === bKey) return Number(a?.id || 0) - Number(b?.id || 0);
  return aKey.localeCompare(bKey);
}

function isGeneratedAppointmentConfirmedForAgenda(appointment) {
  if (!appointment || typeof appointment !== 'object') return false;
  if (
    appointment.confirmationAppointmentCancelled ||
    appointment.confirmationAppointmentCancelledAt
  ) {
    return false;
  }
  if (!toBooleanSafe(appointment.aiGenerated, false)) return true;
  return Boolean(appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt);
}

function compareConfirmationTasks(a, b) {
  const aTs = Date.parse(normalizeString(a?.confirmationTaskCreatedAt || a?.createdAt || '')) || 0;
  const bTs = Date.parse(normalizeString(b?.confirmationTaskCreatedAt || b?.createdAt || '')) || 0;
  if (aTs === bTs) return Number(a?.id || 0) - Number(b?.id || 0);
  return bTs - aTs;
}

function formatDateTimeLabelNl(dateYmd, timeHm) {
  const date = normalizeDateYyyyMmDd(dateYmd);
  const time = normalizeTimeHhMm(timeHm) || '09:00';
  if (!date) return '';
  const dt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(dt.getTime())) return `${date} ${time}`;
  return dt.toLocaleString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapAppointmentToConfirmationTask(appointment) {
  if (!appointment || typeof appointment !== 'object') return null;
  const needsConfirmation = toBooleanSafe(
    appointment.needsConfirmationEmail,
    toBooleanSafe(appointment.aiGenerated, false)
  );
  const alreadyDone = Boolean(
    appointment.confirmationResponseReceived ||
      appointment.confirmationResponseReceivedAt ||
      appointment.confirmationAppointmentCancelled ||
      appointment.confirmationAppointmentCancelledAt
  );
  if (!needsConfirmation || alreadyDone) return null;

  return {
    id: Number(appointment.id) || 0,
    type: 'send_confirmation_email',
    title: 'Bevestigingsmail sturen',
    company: normalizeString(appointment.company || 'Onbekende lead'),
    contact: normalizeString(appointment.contact || 'Onbekend'),
    phone: normalizeString(appointment.phone || ''),
    date: normalizeDateYyyyMmDd(appointment.date) || '',
    time: normalizeTimeHhMm(appointment.time) || '09:00',
    datetimeLabel: formatDateTimeLabelNl(appointment.date, appointment.time),
    source: normalizeString(appointment.source || 'AI Cold Calling'),
    summary: truncateText(normalizeString(appointment.summary || ''), 300),
    value: normalizeString(appointment.value || ''),
    createdAt: normalizeString(appointment.confirmationTaskCreatedAt || appointment.createdAt || ''),
    appointmentId: Number(appointment.id) || 0,
    callId: normalizeString(appointment.callId || ''),
    contactEmail: normalizeEmailAddress(appointment.contactEmail || appointment.email || '') || '',
    mailDraftAvailable: Boolean(normalizeString(appointment.confirmationEmailDraft || '')),
    mailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
    mailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || null,
    mailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || null,
    confirmationReceived: Boolean(
      appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt
    ),
    confirmationReceivedAt: normalizeString(appointment.confirmationResponseReceivedAt || '') || null,
    confirmationReceivedBy: normalizeString(appointment.confirmationResponseReceivedBy || '') || null,
    appointmentCancelled: Boolean(
      appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt
    ),
    appointmentCancelledAt:
      normalizeString(appointment.confirmationAppointmentCancelledAt || '') || null,
    appointmentCancelledBy:
      normalizeString(appointment.confirmationAppointmentCancelledBy || '') || null,
  };
}

function getGeneratedAppointmentIndexById(id) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId) || taskId <= 0) return -1;
  return generatedAgendaAppointments.findIndex((item) => Number(item?.id) === taskId);
}

function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, reason = 'agenda_appointment_update') {
  if (!Number.isInteger(idx) || idx < 0 || idx >= generatedAgendaAppointments.length) return null;
  if (!nextValue || typeof nextValue !== 'object') return null;

  generatedAgendaAppointments[idx] = nextValue;
  const id = Number(nextValue.id);
  const callId = normalizeString(nextValue.callId || '');
  if (Number.isFinite(id) && id > 0 && callId) {
    agendaAppointmentIdByCallId.set(callId, id);
  }
  queueRuntimeStatePersist(reason);
  return generatedAgendaAppointments[idx];
}

function getLatestCallUpdateByCallId(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  return callUpdatesById.get(normalizedCallId) || null;
}

function findTranscriptFromWebhookEvents(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return '';
  for (const event of recentWebhookEvents) {
    if (normalizeString(event?.callId) !== normalizedCallId) continue;
    const text = extractTranscriptFull(event.payload);
    if (text) return text;
  }
  return '';
}

function getAppointmentTranscriptText(appointment) {
  if (!appointment) return '';
  const callId = normalizeString(appointment.callId || '');
  const fromCallUpdate = getLatestCallUpdateByCallId(callId);
  const transcript = normalizeString(fromCallUpdate?.transcriptFull || fromCallUpdate?.transcriptSnippet || '');
  if (transcript) return transcript;
  const fromEvents = findTranscriptFromWebhookEvents(callId);
  if (fromEvents) return fromEvents;
  return '';
}

function buildConfirmationTaskDetail(appointment) {
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) return null;

  const callUpdate = getLatestCallUpdateByCallId(task.callId);
  const aiInsight = task.callId ? aiCallInsightsByCallId.get(task.callId) || null : null;
  const transcript = getAppointmentTranscriptText(appointment) || '';

  return {
    ...task,
    contactEmail: normalizeEmailAddress(appointment.contactEmail || appointment.email || '') || '',
    transcript,
    transcriptAvailable: Boolean(transcript),
    vapiSummary: normalizeString(callUpdate?.summary || ''),
    transcriptSnippet: normalizeString(callUpdate?.transcriptSnippet || ''),
    aiSummary: normalizeString(aiInsight?.summary || ''),
    confirmationEmailDraft: normalizeString(appointment.confirmationEmailDraft || ''),
    confirmationEmailDraftGeneratedAt: normalizeString(appointment.confirmationEmailDraftGeneratedAt || '') || null,
    confirmationEmailDraftSource: normalizeString(appointment.confirmationEmailDraftSource || '') || null,
    confirmationEmailLastError: normalizeString(appointment.confirmationEmailLastError || '') || null,
    confirmationEmailLastSentMessageId:
      normalizeString(appointment.confirmationEmailLastSentMessageId || '') || null,
    rawStatus: {
      callStatus: normalizeString(callUpdate?.status || ''),
      callMessageType: normalizeString(callUpdate?.messageType || ''),
      endedReason: normalizeString(callUpdate?.endedReason || ''),
    },
  };
}

function ensureConfirmationEmailDraftAtIndex(idx, options = {}) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= generatedAgendaAppointments.length) return null;
  const appointment = generatedAgendaAppointments[idx];
  if (!appointment || typeof appointment !== 'object') return null;
  if (normalizeString(appointment.confirmationEmailDraft || '')) return appointment;

  const detail = buildConfirmationTaskDetail(appointment) || {};
  const fallbackDraft = buildConfirmationEmailDraftFallback(appointment, detail);
  const nowIso = new Date().toISOString();
  return setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      confirmationEmailDraft: fallbackDraft,
      confirmationEmailDraftGeneratedAt:
        normalizeString(appointment.confirmationEmailDraftGeneratedAt || '') || nowIso,
      confirmationEmailDraftSource:
        normalizeString(appointment.confirmationEmailDraftSource || '') || 'template-auto',
    },
    normalizeString(options.reason || 'confirmation_task_auto_draft')
  );
}

function upsertGeneratedAgendaAppointment(appointment, callId) {
  if (!appointment || !callId) return null;

  const existingId = agendaAppointmentIdByCallId.get(callId);
  if (existingId) {
    const idx = generatedAgendaAppointments.findIndex((item) => item.id === existingId);
    if (idx >= 0) {
      const existing = generatedAgendaAppointments[idx];
      const updated = {
        ...existing,
        ...appointment,
        id: existingId,
        needsConfirmationEmail: toBooleanSafe(
          existing?.needsConfirmationEmail,
          toBooleanSafe(appointment?.aiGenerated, false)
        ),
        confirmationEmailSent: Boolean(existing?.confirmationEmailSent || existing?.confirmationEmailSentAt),
        confirmationEmailSentAt: normalizeString(existing?.confirmationEmailSentAt || '') || null,
        confirmationEmailSentBy: normalizeString(existing?.confirmationEmailSentBy || '') || null,
        confirmationResponseReceived: Boolean(
          existing?.confirmationResponseReceived || existing?.confirmationResponseReceivedAt
        ),
        confirmationResponseReceivedAt:
          normalizeString(existing?.confirmationResponseReceivedAt || '') || null,
        confirmationResponseReceivedBy:
          normalizeString(existing?.confirmationResponseReceivedBy || '') || null,
        confirmationAppointmentCancelled: Boolean(
          existing?.confirmationAppointmentCancelled || existing?.confirmationAppointmentCancelledAt
        ),
        confirmationAppointmentCancelledAt:
          normalizeString(existing?.confirmationAppointmentCancelledAt || '') || null,
        confirmationAppointmentCancelledBy:
          normalizeString(existing?.confirmationAppointmentCancelledBy || '') || null,
        confirmationEmailDraft: normalizeString(existing?.confirmationEmailDraft || '') || null,
        confirmationEmailDraftGeneratedAt:
          normalizeString(existing?.confirmationEmailDraftGeneratedAt || '') || null,
        confirmationEmailDraftSource:
          normalizeString(existing?.confirmationEmailDraftSource || '') || null,
        contactEmail:
          normalizeEmailAddress(
            appointment?.contactEmail || appointment?.email || existing?.contactEmail || existing?.email || ''
          ) || null,
        confirmationEmailLastError:
          normalizeString(existing?.confirmationEmailLastError || '') || null,
        confirmationEmailLastSentMessageId:
          normalizeString(existing?.confirmationEmailLastSentMessageId || '') || null,
        confirmationTaskCreatedAt:
          normalizeString(existing?.confirmationTaskCreatedAt || '') ||
          normalizeString(existing?.createdAt || '') ||
          new Date().toISOString(),
      };
      if (!normalizeString(updated.confirmationEmailDraft || '')) {
        updated.confirmationEmailDraft = buildConfirmationEmailDraftFallback(updated, updated);
        updated.confirmationEmailDraftGeneratedAt =
          normalizeString(updated.confirmationEmailDraftGeneratedAt || '') || new Date().toISOString();
        updated.confirmationEmailDraftSource =
          normalizeString(updated.confirmationEmailDraftSource || '') || 'template-auto';
      }
      return setGeneratedAgendaAppointmentAtIndex(idx, updated, 'agenda_appointment_upsert');
    }
  }

  const createdAtIso = normalizeString(appointment?.createdAt) || new Date().toISOString();
  const needsConfirmationEmail = toBooleanSafe(appointment?.needsConfirmationEmail, toBooleanSafe(appointment?.aiGenerated, false));
  const withId = {
    ...appointment,
    id: nextGeneratedAgendaAppointmentId++,
    createdAt: createdAtIso,
    needsConfirmationEmail,
    confirmationEmailSent: false,
    confirmationEmailSentAt: null,
    confirmationEmailSentBy: null,
    confirmationResponseReceived: false,
    confirmationResponseReceivedAt: null,
    confirmationResponseReceivedBy: null,
    confirmationAppointmentCancelled: false,
    confirmationAppointmentCancelledAt: null,
    confirmationAppointmentCancelledBy: null,
    contactEmail: normalizeEmailAddress(appointment?.contactEmail || appointment?.email || '') || null,
    confirmationEmailDraft: buildConfirmationEmailDraftFallback(appointment, appointment),
    confirmationEmailDraftGeneratedAt: createdAtIso,
    confirmationEmailDraftSource: 'template-auto',
    confirmationEmailLastError: null,
    confirmationEmailLastSentMessageId: null,
    confirmationTaskCreatedAt: createdAtIso,
  };
  generatedAgendaAppointments.push(withId);
  agendaAppointmentIdByCallId.set(callId, withId.id);
  queueRuntimeStatePersist('agenda_appointment_insert');
  return withId;
}

function buildGeneratedAgendaAppointmentFromAiInsight(insight) {
  if (!insight || !toBooleanSafe(insight.appointmentBooked, false)) return null;

  const date = normalizeDateYyyyMmDd(insight.appointmentDate);
  if (!date) return null;

  const time = normalizeTimeHhMm(insight.appointmentTime) || '09:00';
  const timeWasGuessed = !normalizeTimeHhMm(insight.appointmentTime);
  const company = normalizeString(insight.company || insight.leadCompany || '') || 'Onbekende lead';
  const contact = normalizeString(insight.contactName || insight.leadName || '') || 'Onbekend';
  const phone = normalizeString(insight.phone || '');
  const branche = normalizeString(insight.branche || insight.sector || '') || 'Onbekend';
  const summaryCore = truncateText(
    normalizeString(insight.summary || insight.shortSummary || insight.short_summary || ''),
    900
  );
  const summary = timeWasGuessed
    ? `${summaryCore}${summaryCore ? ' ' : ''}(Tijd niet expliciet genoemd; standaard op 09:00 gezet.)`
    : summaryCore;

  return {
    company,
    contact,
    phone,
    contactEmail: normalizeEmailAddress(insight.contactEmail || insight.email || insight.leadEmail || ''),
    type: 'meeting',
    date,
    time,
    value: formatEuroLabel(insight.estimatedValueEur || insight.estimated_value_eur),
    branche,
    source: 'AI Cold Calling (Vapi + AI)',
    summary: summary || 'AI-samenvatting aangemaakt op basis van Vapi call update.',
    aiGenerated: true,
    callId: normalizeString(insight.callId),
    createdAt: new Date().toISOString(),
  };
}

async function createAiInsightFromCallUpdate(callUpdate) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const nowIso = new Date().toISOString();
  const systemPrompt = [
    'Je bent een sales-operations assistent voor een Nederlands coldcalling team.',
    'Analyseer een call-update en geef EEN geldig JSON-object terug (geen markdown).',
    'Doelen:',
    '1) Maak een korte Nederlandse samenvatting van max 3 zinnen.',
    '2) Bepaal of er een afspraak is ingepland.',
    '3) Extraheer afspraakdatum en tijd alleen als deze expliciet of zeer duidelijk genoemd zijn.',
    '4) Gebruik null als datum/tijd onbekend zijn.',
    '5) Raad geen bedragen of branche als dit niet uit de tekst blijkt; gebruik null of lege string.',
    'JSON keys exact:',
    'summary, appointmentBooked, appointmentDate, appointmentTime, contactName, company, phone, branche, estimatedValueEur, followUpRequired, followUpReason',
    'Datumformaat: YYYY-MM-DD. Tijdsformaat: HH:MM (24u).',
    'Taal output: Nederlands.',
  ].join('\n');

  const userPayload = {
    nowIso,
    timezone: 'Europe/Amsterdam',
    callUpdate: {
      callId: callUpdate.callId,
      status: callUpdate.status,
      messageType: callUpdate.messageType,
      endedReason: callUpdate.endedReason,
      company: callUpdate.company,
      name: callUpdate.name,
      phone: callUpdate.phone,
      vapiSummary: callUpdate.summary,
      transcriptSnippet: callUpdate.transcriptSnippet,
      transcriptFull: truncateText(normalizeString(callUpdate.transcriptFull || ''), 5000),
      updatedAt: callUpdate.updatedAt,
    },
  };

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
      }),
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI analyse mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = extractOpenAiTextContent(content);
  const parsed = parseJsonLoose(text);

  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('OpenAI gaf geen geldig JSON-object terug.');
    err.data = { rawContent: text };
    throw err;
  }

  return {
    callId: normalizeString(callUpdate.callId),
    company: normalizeString(parsed.company || callUpdate.company),
    contactName: normalizeString(parsed.contactName || parsed.contact_name || callUpdate.name),
    phone: normalizeString(parsed.phone || callUpdate.phone),
    branche: normalizeString(parsed.branche || parsed.branch || ''),
    summary: truncateText(
      normalizeString(parsed.summary || parsed.shortSummary || parsed.short_summary || callUpdate.summary),
      900
    ),
    appointmentBooked: toBooleanSafe(parsed.appointmentBooked ?? parsed.appointment_booked, false),
    appointmentDate: normalizeDateYyyyMmDd(parsed.appointmentDate || parsed.appointment_date),
    appointmentTime: normalizeTimeHhMm(parsed.appointmentTime || parsed.appointment_time),
    estimatedValueEur: parseNumberSafe(parsed.estimatedValueEur ?? parsed.estimated_value_eur, null),
    followUpRequired: toBooleanSafe(parsed.followUpRequired ?? parsed.follow_up_required, false),
    followUpReason: truncateText(
      normalizeString(parsed.followUpReason || parsed.follow_up_reason),
      300
    ),
    source: 'openai',
    model: OPENAI_MODEL,
    analyzedAt: new Date().toISOString(),
  };
}

function upsertAiCallInsight(insight) {
  if (!insight || !insight.callId) return null;

  const existing = aiCallInsightsByCallId.get(insight.callId);
  const merged = existing ? { ...existing, ...insight, callId: existing.callId } : insight;
  aiCallInsightsByCallId.set(merged.callId, merged);

  const idx = recentAiCallInsights.findIndex((item) => item.callId === merged.callId);
  if (idx >= 0) {
    recentAiCallInsights.splice(idx, 1);
  }
  recentAiCallInsights.unshift(merged);
  if (recentAiCallInsights.length > 500) {
    recentAiCallInsights.pop();
  }

  queueRuntimeStatePersist('ai_call_insight');

  return merged;
}

async function maybeAnalyzeCallUpdateWithAi(callUpdate) {
  if (!shouldAnalyzeCallUpdateWithAi(callUpdate)) return null;
  if (!callUpdate?.callId) return null;

  const fingerprint = getCallUpdateAiFingerprint(callUpdate);
  if (aiAnalysisFingerprintByCallId.get(callUpdate.callId) === fingerprint) {
    return aiCallInsightsByCallId.get(callUpdate.callId) || null;
  }
  if (aiAnalysisInFlightCallIds.has(callUpdate.callId)) {
    return null;
  }

  aiAnalysisInFlightCallIds.add(callUpdate.callId);
  try {
    let insight = null;
    let aiError = null;
    try {
      insight = await createAiInsightFromCallUpdate(callUpdate);
    } catch (error) {
      aiError = error;
      console.error(
        '[AI Call Insight Create Error]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
            data: error?.data || null,
          },
          null,
          2
        )
      );
    }

    const ruleInsight = createRuleBasedInsightFromCallUpdate(callUpdate);
    if (!insight && ruleInsight) {
      insight = ruleInsight;
      console.log(
        '[AI Call Insight Fallback]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            source: 'rule',
            appointmentBooked: ruleInsight.appointmentBooked,
            appointmentDate: ruleInsight.appointmentDate || null,
            appointmentTime: ruleInsight.appointmentTime || null,
          },
          null,
          2
        )
      );
    } else if (insight && ruleInsight) {
      if (!insight.summary && ruleInsight.summary) {
        insight.summary = ruleInsight.summary;
      }
      if (!toBooleanSafe(insight.appointmentBooked, false) && toBooleanSafe(ruleInsight.appointmentBooked, false)) {
        insight.appointmentBooked = true;
        if (!normalizeDateYyyyMmDd(insight.appointmentDate)) insight.appointmentDate = ruleInsight.appointmentDate;
        if (!normalizeTimeHhMm(insight.appointmentTime)) insight.appointmentTime = ruleInsight.appointmentTime;
        if (!normalizeString(insight.followUpReason)) insight.followUpReason = ruleInsight.followUpReason;
        if (!toBooleanSafe(insight.followUpRequired, false)) insight.followUpRequired = true;
      }
    }

    if (!insight) {
      if (aiError) throw aiError;
      return null;
    }

    const savedInsight = upsertAiCallInsight(insight);
    aiAnalysisFingerprintByCallId.set(callUpdate.callId, fingerprint);

    if (!normalizeString(callUpdate.summary) && normalizeString(savedInsight?.summary)) {
      upsertRecentCallUpdate({
        callId: callUpdate.callId,
        summary: savedInsight.summary,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
    }

    const agendaAppointment = buildGeneratedAgendaAppointmentFromAiInsight({
      ...savedInsight,
      callId: callUpdate.callId,
      leadCompany: callUpdate.company,
      leadName: callUpdate.name,
    });
    if (agendaAppointment) {
      const savedAppointment = upsertGeneratedAgendaAppointment(agendaAppointment, callUpdate.callId);
      if (savedAppointment) {
        savedInsight.agendaAppointmentId = savedAppointment.id;
      }
    }

    console.log(
      '[AI Call Insight]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          appointmentBooked: savedInsight.appointmentBooked,
          appointmentDate: savedInsight.appointmentDate || null,
          appointmentTime: savedInsight.appointmentTime || null,
          hasSummary: Boolean(savedInsight.summary),
          agendaAppointmentId: savedInsight.agendaAppointmentId || null,
        },
        null,
        2
      )
    );

    return savedInsight;
  } finally {
    aiAnalysisInFlightCallIds.delete(callUpdate.callId);
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs = 15000) {
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

function buildConfirmationEmailDraftFallback(appointment, detail = {}) {
  const contact = normalizeString(appointment?.contact || detail?.contact || '') || 'heer/mevrouw';
  const company = normalizeString(appointment?.company || detail?.company || '') || 'uw bedrijf';
  const date = normalizeDateYyyyMmDd(appointment?.date || detail?.date);
  const time = normalizeTimeHhMm(appointment?.time || detail?.time) || '09:00';
  const datetimeLabel = formatDateTimeLabelNl(date, time) || `${date} ${time}`;

  const summary =
    normalizeString(detail?.aiSummary || detail?.vapiSummary || appointment?.summary || '').trim() ||
    'Bedankt voor het prettige gesprek.';

  return [
    `Onderwerp: Bevestiging afspraak ${company} - ${date || ''} ${time}`.trim(),
    '',
    `Beste ${contact},`,
    '',
    'Bedankt voor het prettige gesprek van vandaag.',
    `Hierbij bevestig ik onze afspraak op ${datetimeLabel}.`,
    '',
    'Korte samenvatting:',
    summary,
    '',
    'Laat het gerust weten als de tijd aangepast moet worden of als er nog aanvullende vragen zijn.',
    '',
    'Met vriendelijke groet,',
    'Softora',
  ].join('\n');
}

function isSmtpMailConfigured() {
  return Boolean(
    MAIL_SMTP_HOST &&
      Number.isFinite(MAIL_SMTP_PORT) &&
      MAIL_SMTP_PORT > 0 &&
      MAIL_SMTP_USER &&
      MAIL_SMTP_PASS &&
      MAIL_FROM_ADDRESS
  );
}

function getSmtpTransporter() {
  if (!isSmtpMailConfigured()) return null;
  if (smtpTransporter) return smtpTransporter;

  smtpTransporter = nodemailer.createTransport({
    host: MAIL_SMTP_HOST,
    port: MAIL_SMTP_PORT,
    secure: MAIL_SMTP_SECURE,
    auth: {
      user: MAIL_SMTP_USER,
      pass: MAIL_SMTP_PASS,
    },
  });

  return smtpTransporter;
}

function normalizeEmailAddress(value) {
  return normalizeString(String(value || '').trim().toLowerCase());
}

function isLikelyValidEmail(value) {
  const email = normalizeEmailAddress(value);
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function formatMailFromHeader() {
  const address = normalizeEmailAddress(MAIL_FROM_ADDRESS);
  if (!address) return '';
  const name = normalizeString(MAIL_FROM_NAME || 'Softora');
  return name ? `${name} <${address}>` : address;
}

function parseConfirmationDraftToMailParts(draftText, appointment = null) {
  const raw = normalizeString(draftText || '');
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let subject = '';
  let bodyStartIdx = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeString(lines[i]);
    if (!line) continue;
    const match = line.match(/^onderwerp\s*:\s*(.+)$/i);
    if (match) {
      subject = normalizeString(match[1]);
      bodyStartIdx = i + 1;
    } else {
      bodyStartIdx = i;
    }
    break;
  }

  if (!subject) {
    const company = normalizeString(appointment?.company || '') || 'afspraak';
    const date = normalizeDateYyyyMmDd(appointment?.date) || '';
    const time = normalizeTimeHhMm(appointment?.time) || '';
    subject = truncateText(
      `Bevestiging afspraak ${company}${date ? ` - ${date}` : ''}${time ? ` ${time}` : ''}`.trim(),
      200
    );
  }

  const text = lines
    .slice(bodyStartIdx)
    .join('\n')
    .replace(/^\s+/, '')
    .trim();

  return {
    subject: subject || 'Bevestiging afspraak',
    text: text || raw || 'Bedankt voor het gesprek. Hierbij bevestigen wij de afspraak.',
  };
}

function getConfirmationTaskReplyReferenceToken(appointment) {
  const taskId = Number(appointment?.id || appointment?.appointmentId || 0);
  if (!Number.isFinite(taskId) || taskId <= 0) return '';
  return `CT-${taskId}`;
}

async function sendConfirmationEmailViaSmtp({ appointment, recipientEmail, draftText }) {
  if (!isSmtpMailConfigured()) {
    const error = new Error('SMTP mail is nog niet geconfigureerd op de server.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const toEmail = normalizeEmailAddress(recipientEmail);
  if (!isLikelyValidEmail(toEmail)) {
    const error = new Error('Vul een geldig e-mailadres in voor de ontvanger.');
    error.code = 'INVALID_RECIPIENT_EMAIL';
    throw error;
  }

  const transporter = getSmtpTransporter();
  if (!transporter) {
    const error = new Error('SMTP transporter kon niet worden opgebouwd.');
    error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
    throw error;
  }

  const parts = parseConfirmationDraftToMailParts(draftText, appointment);
  const refToken = getConfirmationTaskReplyReferenceToken(appointment);
  const subject = refToken && !new RegExp(`\\b${refToken}\\b`, 'i').test(parts.subject)
    ? `[${refToken}] ${parts.subject}`
    : parts.subject;
  const text = refToken && !new RegExp(`\\b${refToken}\\b`, 'i').test(parts.text)
    ? `${parts.text}\n\nReferentie: ${refToken}`
    : parts.text;
  const info = await transporter.sendMail({
    from: formatMailFromHeader(),
    to: toEmail,
    replyTo: MAIL_REPLY_TO || undefined,
    subject,
    text,
  });

  return {
    messageId: normalizeString(info?.messageId || ''),
    response: truncateText(normalizeString(info?.response || ''), 500),
    accepted: Array.isArray(info?.accepted) ? info.accepted : [],
    rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    envelope: info?.envelope || null,
  };
}

function isImapMailConfigured() {
  return Boolean(
    MAIL_IMAP_HOST &&
      Number.isFinite(MAIL_IMAP_PORT) &&
      MAIL_IMAP_PORT > 0 &&
      MAIL_IMAP_USER &&
      MAIL_IMAP_PASS
  );
}

function normalizeMessageIdToken(value) {
  return normalizeString(String(value || '').trim()).replace(/[<>]/g, '').toLowerCase();
}

function collectMessageIdReferenceTokens(parsedMail) {
  const out = new Set();
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    const raw = String(value || '');
    raw
      .split(/\s+/)
      .map(normalizeMessageIdToken)
      .filter(Boolean)
      .forEach((token) => out.add(token));
  };

  add(parsedMail?.inReplyTo);
  add(parsedMail?.references);
  try {
    const refsHeader = parsedMail?.headers?.get?.('references');
    add(refsHeader);
  } catch (_) {}

  return out;
}

function getParsedMailFromEmail(parsedMail) {
  const fromList = Array.isArray(parsedMail?.from?.value) ? parsedMail.from.value : [];
  const first = fromList.find((entry) => normalizeEmailAddress(entry?.address || ''));
  return {
    address: normalizeEmailAddress(first?.address || ''),
    name: normalizeString(first?.name || ''),
  };
}

function normalizeInboundReplyTextForDecision(textValue) {
  const raw = String(textValue || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';

  let text = raw;
  const splitPatterns = [
    /\n[-_]{2,}\s*oorspronkelijk bericht\s*[-_]{2,}/i,
    /\non .+ wrote:/i,
    /\nop .+ schreef .+:/i,
    /\nvan:\s.+/i,
  ];
  for (const pattern of splitPatterns) {
    const match = text.match(pattern);
    if (match && Number.isFinite(match.index)) {
      text = text.slice(0, match.index);
    }
  }

  const cleanedLines = text
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => line && !line.startsWith('>'))
    .filter((line) => !/^(from|to|subject|onderwerp|sent|verzonden|cc):/i.test(line));

  return cleanedLines.join('\n').trim();
}

function detectInboundConfirmationDecision(parsedMail) {
  const subject = normalizeString(parsedMail?.subject || '');
  const bodyText = normalizeInboundReplyTextForDecision(parsedMail?.text || parsedMail?.html || '');
  const full = `${subject}\n${bodyText}`.toLowerCase();

  const cancelPatterns = [
    /\b(annuleer|annuleren|geannuleerd|afzeggen|afgezegd|kan niet doorgaan|gaat niet door)\b/i,
    /\b(niet akkoord|niet goed|komt niet uit)\b/i,
  ];
  if (cancelPatterns.some((pattern) => pattern.test(full))) {
    return { decision: 'cancel', reason: 'negative_reply', bodyText };
  }

  const positivePatterns = [
    /\bbevestig(?:\s+ik)?\b/i,
    /\bbevestigd\b/i,
    /\bakkoord\b/i,
    /\bklopt\b/i,
    /\bgaat door\b/i,
    /\bprima\b/i,
    /\bis goed\b/i,
    /^\s*ja[\s!.,]*$/i,
    /\bja[, ]/i,
  ];
  if (positivePatterns.some((pattern) => pattern.test(full))) {
    return { decision: 'confirm', reason: 'positive_reply', bodyText };
  }

  return { decision: '', reason: 'undetermined', bodyText };
}

function findAppointmentIndexBySentMessageIdReference(refTokens) {
  if (!refTokens || !refTokens.size) return -1;
  for (let i = 0; i < generatedAgendaAppointments.length; i += 1) {
    const appt = generatedAgendaAppointments[i];
    if (!appt || !mapAppointmentToConfirmationTask(appt)) continue;
    const sentId = normalizeMessageIdToken(appt.confirmationEmailLastSentMessageId || '');
    if (!sentId) continue;
    if (refTokens.has(sentId)) return i;
  }
  return -1;
}

function findAppointmentIndexForInboundConfirmationMail(parsedMail) {
  const subject = normalizeString(parsedMail?.subject || '');
  const text = normalizeString(parsedMail?.text || '');
  const combined = `${subject}\n${text}`;

  const refMatch = combined.match(/\bCT-(\d{3,})\b/i);
  if (refMatch) {
    const idx = getGeneratedAppointmentIndexById(refMatch[1]);
    if (idx >= 0) return idx;
  }

  const refTokens = collectMessageIdReferenceTokens(parsedMail);
  const byMsgRefIdx = findAppointmentIndexBySentMessageIdReference(refTokens);
  if (byMsgRefIdx >= 0) return byMsgRefIdx;

  const from = getParsedMailFromEmail(parsedMail);
  if (from.address) {
    const candidates = generatedAgendaAppointments
      .map((appt, idx) => ({ appt, idx }))
      .filter(({ appt }) => appt && mapAppointmentToConfirmationTask(appt))
      .filter(({ appt }) => normalizeEmailAddress(appt.contactEmail || appt.email || '') === from.address);
    if (candidates.length === 1) return candidates[0].idx;
  }

  return -1;
}

function applyInboundMailDecisionToAppointment(idx, decision, metadata = {}) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= generatedAgendaAppointments.length) {
    return { ok: false, changed: false, reason: 'not_found' };
  }
  const appointment = generatedAgendaAppointments[idx];
  if (!appointment || !mapAppointmentToConfirmationTask(appointment)) {
    return { ok: false, changed: false, reason: 'no_open_task' };
  }

  const actor = 'Klant reply e-mail (IMAP)';
  const nowIso = new Date().toISOString();
  const inboundFrom = normalizeEmailAddress(metadata.fromEmail || '');
  const inboundSubject = truncateText(normalizeString(metadata.subject || ''), 220);

  if (decision === 'confirm') {
    if (appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt) {
      return { ok: true, changed: false, reason: 'already_confirmed' };
    }
    const updated = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        contactEmail: inboundFrom || normalizeEmailAddress(appointment.contactEmail || '') || null,
        confirmationEmailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
        confirmationEmailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || 'SMTP',
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
        confirmationEmailLastError: null,
      },
      'confirmation_task_imap_reply_confirm'
    );
    appendDashboardActivity(
      {
        type: 'appointment_confirmed_by_mail',
        title: 'Afspraak bevestigd per mail',
        detail: inboundSubject ? `Reply verwerkt: ${inboundSubject}` : 'Klantreply via mailbox verwerkt.',
        company: updated?.company || appointment?.company || '',
        actor,
        taskId: Number(updated?.id || appointment?.id || 0) || null,
        callId: normalizeString(updated?.callId || appointment?.callId || ''),
        source: 'imap-mailbox-sync',
      },
      'dashboard_activity_imap_confirm'
    );
    return { ok: true, changed: true, status: 'confirmed', appointment: updated };
  }

  if (decision === 'cancel') {
    if (appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt) {
      return { ok: true, changed: false, reason: 'already_cancelled' };
    }
    const updated = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        contactEmail: inboundFrom || normalizeEmailAddress(appointment.contactEmail || '') || null,
        confirmationEmailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
        confirmationEmailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || 'SMTP',
        confirmationResponseReceived: false,
        confirmationResponseReceivedAt: null,
        confirmationResponseReceivedBy: null,
        confirmationAppointmentCancelled: true,
        confirmationAppointmentCancelledAt: nowIso,
        confirmationAppointmentCancelledBy: actor,
        confirmationEmailLastError: null,
      },
      'confirmation_task_imap_reply_cancel'
    );
    appendDashboardActivity(
      {
        type: 'appointment_cancelled',
        title: 'Afspraak geannuleerd',
        detail: inboundSubject ? `Reply verwerkt: ${inboundSubject}` : 'Klantreply via mailbox verwerkt.',
        company: updated?.company || appointment?.company || '',
        actor,
        taskId: Number(updated?.id || appointment?.id || 0) || null,
        callId: normalizeString(updated?.callId || appointment?.callId || ''),
        source: 'imap-mailbox-sync',
      },
      'dashboard_activity_imap_cancel'
    );
    return { ok: true, changed: true, status: 'cancelled', appointment: updated };
  }

  return { ok: false, changed: false, reason: 'no_decision' };
}

async function syncInboundConfirmationEmailsFromImap(options = {}) {
  const force = Boolean(options?.force);
  const maxMessages = Math.max(10, Math.min(400, Number(options?.maxMessages || 120) || 120));

  if (!isImapMailConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: 'imap_not_configured',
      missingEnv: [
        !MAIL_IMAP_HOST ? 'MAIL_IMAP_HOST' : null,
        !MAIL_IMAP_USER ? 'MAIL_IMAP_USER' : null,
        !MAIL_IMAP_PASS ? 'MAIL_IMAP_PASS' : null,
      ].filter(Boolean),
    };
  }

  if (!force && Date.now() < inboundConfirmationMailSyncNotBeforeMs) {
    return inboundConfirmationMailSyncLastResult || {
      ok: true,
      skipped: true,
      reason: 'cooldown',
    };
  }
  if (inboundConfirmationMailSyncPromise) return inboundConfirmationMailSyncPromise;

  inboundConfirmationMailSyncPromise = (async () => {
    const stats = {
      ok: true,
      startedAt: new Date().toISOString(),
      mailbox: MAIL_IMAP_MAILBOX,
      unseenFound: 0,
      scanned: 0,
      matched: 0,
      confirmed: 0,
      cancelled: 0,
      markedSeen: 0,
      ignored: 0,
      errors: [],
    };

    const client = new ImapFlow({
      host: MAIL_IMAP_HOST,
      port: MAIL_IMAP_PORT,
      secure: MAIL_IMAP_SECURE,
      auth: {
        user: MAIL_IMAP_USER,
        pass: MAIL_IMAP_PASS,
      },
      logger: false,
    });

    let lock = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock(MAIL_IMAP_MAILBOX);
      const unseenUids = await client.search(['UNSEEN']);
      const allUids = await client.search(['ALL']);
      stats.unseenFound = Array.isArray(unseenUids) ? unseenUids.length : 0;

      const selectedUidSet = new Set();
      if (Array.isArray(allUids) && allUids.length) {
        allUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
      }
      if (Array.isArray(unseenUids) && unseenUids.length) {
        unseenUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
      }
      const selectedUids = Array.from(selectedUidSet).sort((a, b) => a - b);

      const uidsToMarkSeen = [];
      if (selectedUids.length) {
        for await (const message of client.fetch(
          selectedUids,
          {
            uid: true,
            source: true,
            envelope: true,
            internalDate: true,
            flags: true,
          },
          { uid: true }
        )) {
          stats.scanned += 1;
          let parsedMail = null;
          try {
            parsedMail = await simpleParser(message.source);
          } catch (error) {
            stats.errors.push(`Parse error uid=${message.uid}: ${truncateText(error?.message || String(error), 120)}`);
            continue;
          }

          const idx = findAppointmentIndexForInboundConfirmationMail(parsedMail);
          if (idx < 0) {
            stats.ignored += 1;
            continue;
          }

          stats.matched += 1;
          const decision = detectInboundConfirmationDecision(parsedMail);
          const from = getParsedMailFromEmail(parsedMail);
          const result = applyInboundMailDecisionToAppointment(idx, decision.decision, {
            fromEmail: from.address,
            subject: normalizeString(parsedMail?.subject || ''),
            bodyText: decision.bodyText,
          });

          if (result.changed && result.status === 'confirmed') stats.confirmed += 1;
          if (result.changed && result.status === 'cancelled') stats.cancelled += 1;

          const flagsSet = message.flags instanceof Set
            ? message.flags
            : new Set(Array.isArray(message.flags) ? message.flags : []);
          const alreadySeen = flagsSet.has('\\Seen');
          if (!alreadySeen) {
            // Markeer alleen ongelezen matched replies als gelezen.
            uidsToMarkSeen.push(message.uid);
          }
        }
      }

      if (uidsToMarkSeen.length) {
        await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], { uid: true });
        stats.markedSeen = uidsToMarkSeen.length;
      }
    } catch (error) {
      stats.ok = false;
      stats.error = truncateText(error?.message || String(error), 500);
    } finally {
      try {
        if (lock) lock.release();
      } catch (_) {}
      try {
        if (client.usable) await client.logout();
      } catch (_) {}
      inboundConfirmationMailSyncNotBeforeMs = Date.now() + MAIL_IMAP_POLL_COOLDOWN_MS;
      stats.finishedAt = new Date().toISOString();
      inboundConfirmationMailSyncLastResult = stats;
      inboundConfirmationMailSyncPromise = null;
    }

    return stats;
  })();

  return inboundConfirmationMailSyncPromise;
}

async function generateConfirmationEmailDraftWithAi(appointment, detail = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      draft: buildConfirmationEmailDraftFallback(appointment, detail),
      source: 'template',
      model: null,
    };
  }

  const payload = {
    timezone: 'Europe/Amsterdam',
    appointment: {
      company: normalizeString(appointment?.company || ''),
      contact: normalizeString(appointment?.contact || ''),
      phone: normalizeString(appointment?.phone || ''),
      date: normalizeDateYyyyMmDd(appointment?.date),
      time: normalizeTimeHhMm(appointment?.time),
      source: normalizeString(appointment?.source || ''),
      branche: normalizeString(appointment?.branche || ''),
      value: normalizeString(appointment?.value || ''),
    },
    context: {
      aiSummary: truncateText(normalizeString(detail?.aiSummary || ''), 1000),
      vapiSummary: truncateText(normalizeString(detail?.vapiSummary || ''), 1000),
      transcriptSnippet: truncateText(normalizeString(detail?.transcriptSnippet || ''), 1200),
      transcript: truncateText(normalizeString(detail?.transcript || ''), 4000),
    },
  };

  const systemPrompt = [
    'Je bent een Nederlandse sales assistent.',
    'Schrijf een professionele maar korte bevestigingsmail na een telefonisch gesprek.',
    'Doel: afspraak bevestigen en de klant vragen om per mail te bevestigen dat tijd/datum klopt.',
    'Gebruik Nederlands.',
    'Geef alleen de emailtekst terug (met onderwerpregel bovenaan), geen markdown.',
    'Wees concreet over datum/tijd als aanwezig.',
    'Maximaal ongeveer 220 woorden.',
  ].join('\n');

  const { response, data } = await fetchJsonWithTimeout(
    `${OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    },
    25000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI bevestigingsmail generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = extractOpenAiTextContent(content);
  const draft = normalizeString(text);
  if (!draft) {
    return {
      draft: buildConfirmationEmailDraftFallback(appointment, detail),
      source: 'template-fallback-empty',
      model: null,
    };
  }

  return {
    draft: truncateText(draft, 5000),
    source: 'openai',
    model: OPENAI_MODEL,
  };
}

async function createVapiOutboundCall(payload) {
  const endpoints = ['/call', '/call/phone'];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const { response, data } = await fetchJsonWithTimeout(
        `${VAPI_BASE_URL}${endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      console.log(
        '[Vapi Response]',
        JSON.stringify(
          {
            endpoint,
            statusCode: response.status,
            ok: response.ok,
            body: data,
          },
          null,
          2
        )
      );

      if (response.ok) {
        return { endpoint, data };
      }

      const statusError = new Error(
        data?.message ||
          data?.error ||
          data?.raw ||
          `Vapi API fout (${response.status}) op ${endpoint}`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;

      if (response.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        lastError = statusError;
        continue;
      }

      throw statusError;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        throw new Error('Timeout bij aanroepen van Vapi API');
      }
      if (error.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Onbekende fout bij starten Vapi call');
}

async function fetchVapiCallStatusById(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) {
    throw new Error('callId ontbreekt');
  }

  const encodedCallId = encodeURIComponent(normalizedCallId);
  const endpoints = [`/call/${encodedCallId}`, `/calls/${encodedCallId}`];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const { response, data } = await fetchJsonWithTimeout(
        `${VAPI_BASE_URL}${endpoint}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
        10000
      );

      if (response.ok) {
        return { endpoint, data };
      }

      const statusError = new Error(
        data?.message || data?.error || data?.raw || `Vapi call status fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      lastError = statusError;

      if (response.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }

      throw statusError;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') {
        throw new Error('Timeout bij ophalen Vapi call status');
      }
      if (error?.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Kon Vapi call status niet ophalen');
}

function classifyVapiFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const detailText = JSON.stringify(error?.data || {}).toLowerCase();
  const combined = `${message} ${detailText}`;
  const status = Number(error?.status || 0);

  if (
    status === 402 ||
    /credit|credits|balance|billing|payment required|insufficient funds/.test(combined)
  ) {
    return {
      cause: 'credits',
      explanation: 'Waarschijnlijk onvoldoende Vapi-credits/balance om de call te starten.',
    };
  }

  if (
    /free vapi number|free vapi numbers/.test(combined) &&
    /international call|international calls/.test(combined)
  ) {
    return {
      cause: 'wrong phoneNumberId',
      explanation:
        'Je VAPI_PHONE_NUMBER_ID verwijst naar een gratis Vapi-nummer. Gratis Vapi-nummers ondersteunen geen internationale outbound calls (zoals +31). Gebruik een betaald/extern nummer met internationale outbound.',
    };
  }

  if (
    /assistant/.test(combined) &&
    /(not found|unknown|invalid|does not exist|no .*assistant)/.test(combined)
  ) {
    return {
      cause: 'wrong assistantId',
      explanation: 'De opgegeven VAPI_ASSISTANT_ID lijkt ongeldig of bestaat niet.',
    };
  }

  if (
    /(phone.?number.?id|phone number id|from number|caller id)/.test(combined) &&
    /(not found|unknown|invalid|does not exist|unauthorized)/.test(combined)
  ) {
    return {
      cause: 'wrong phoneNumberId',
      explanation: 'De opgegeven VAPI_PHONE_NUMBER_ID lijkt ongeldig of niet beschikbaar voor dit account.',
    };
  }

  if (
    /invalid.*(phone|number)|invalid number|e\\.164|phone.*format|number.*format|telefoonnummer|kan nummer niet omzetten/.test(
      combined
    )
  ) {
    return {
      cause: 'invalid number',
      explanation: 'Het doelnummer is ongeldig of niet in het verwachte formaat beschikbaar.',
    };
  }

  if (
    status >= 500 ||
    /provider|twilio|carrier|sip|telecom|downstream|upstream|timeout|temporar|rate limit|service unavailable/.test(
      combined
    )
  ) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een issue bij Vapi/provider/carrier (tijdelijk of extern).',
    };
  }

  return {
    cause: 'unknown',
    explanation:
      'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte foutmelding en Vapi response body.',
  };
}

function buildVariableValues(lead, campaign) {
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);

  return {
    name: normalizeString(lead.name),
    company: normalizeString(lead.company),
    sector: normalizeString(campaign.sector),
    region: effectiveRegion,
    minProjectValue: campaign.minProjectValue,
    maxDiscountPct: campaign.maxDiscountPct,
    extraInstructions: normalizeString(campaign.extraInstructions),
  };
}

function buildVapiPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);

  return {
    assistantId: process.env.VAPI_ASSISTANT_ID,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: {
      name: normalizeString(lead.name) || normalizeString(lead.company) || 'Onbekende lead',
      number: normalizedPhone,
    },
    assistantOverrides: {
      variableValues: buildVariableValues(
        {
          ...lead,
          phone: normalizedPhone,
        },
        campaign
      ),
    },
    metadata: {
      source: 'softora-coldcalling-dashboard',
      leadCompany: normalizeString(lead.company),
      leadName: normalizeString(lead.name),
      leadPhoneE164: normalizedPhone,
      sector: normalizeString(campaign.sector),
      region: effectiveRegion,
    },
  };
}

async function processColdcallingLead(lead, campaign, index) {
  try {
    const payload = buildVapiPayload(lead, campaign);
    const normalizedPhone = payload.customer.number;
    const { endpoint, data } = await createVapiOutboundCall(payload);
    const callId = data?.id || data?.call?.id || null;
    const callStatus = data?.status || data?.call?.status || null;

    if (callId) {
      upsertRecentCallUpdate({
        callId,
        phone: normalizedPhone,
        company: normalizeString(lead.company),
        name: normalizeString(lead.name),
        status: normalizeString(callStatus),
        messageType: 'coldcalling.start.response',
        summary: '',
        transcriptSnippet: '',
        endedReason: '',
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
    }

    return {
      index,
      success: true,
      lead: {
        name: normalizeString(lead.name),
        company: normalizeString(lead.company),
        phone: normalizeString(lead.phone),
        region: normalizeString(lead.region),
        phoneE164: normalizedPhone,
      },
      vapi: {
        endpoint,
        callId,
        status: callStatus,
      },
    };
  } catch (error) {
    const failure = classifyVapiFailure(error);
    console.error(
      '[Coldcalling][Lead Error]',
      JSON.stringify(
        {
          lead: {
            name: normalizeString(lead?.name),
            company: normalizeString(lead?.company),
            phone: normalizeString(lead?.phone),
          },
          error: error.message || 'Onbekende fout',
          statusCode: error.status || null,
          cause: failure.cause,
          explanation: failure.explanation,
          vapiBody: error.data || null,
        },
        null,
        2
      )
    );

    return {
      index,
      success: false,
      lead: {
        name: normalizeString(lead?.name),
        company: normalizeString(lead?.company),
        phone: normalizeString(lead?.phone),
        region: normalizeString(lead?.region),
      },
      error: error.message || 'Onbekende fout',
      statusCode: error.status || null,
      cause: failure.cause,
      causeExplanation: failure.explanation,
      details: error.data || null,
    };
  }
}

function validateStartPayload(body) {
  const campaign = body?.campaign ?? {};
  const leads = Array.isArray(body?.leads) ? body.leads : null;

  if (!leads) {
    return { error: 'Body moet een "leads" array bevatten.' };
  }

  if (leads.length === 0) {
    return { error: 'Leads array is leeg.' };
  }

  const dispatchModeRaw = normalizeString(campaign.dispatchMode).toLowerCase();
  const dispatchMode = ['parallel', 'sequential', 'delay'].includes(dispatchModeRaw)
    ? dispatchModeRaw
    : 'sequential';
  const dispatchDelaySecondsInput = parseNumberSafe(campaign.dispatchDelaySeconds, 0);
  const dispatchDelaySeconds = Number.isFinite(dispatchDelaySecondsInput)
    ? Math.max(0, Math.min(3600, dispatchDelaySecondsInput))
    : 0;

  const normalizedCampaign = {
    amount: Math.max(1, parseIntSafe(campaign.amount, leads.length)),
    sector: normalizeString(campaign.sector),
    region: normalizeString(campaign.region),
    minProjectValue: parseNumberSafe(campaign.minProjectValue, null),
    maxDiscountPct: parseNumberSafe(campaign.maxDiscountPct, null),
    extraInstructions: normalizeString(campaign.extraInstructions),
    dispatchMode,
    dispatchDelaySeconds,
  };

  return {
    campaign: normalizedCampaign,
    leads,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function phoneDispatchKey(value) {
  return String(value || '').replace(/\D/g, '');
}

function isCallUpdateTerminalForSequentialDispatch(callUpdate) {
  if (!callUpdate) return false;

  const messageType = normalizeString(callUpdate.messageType).toLowerCase();
  const status = normalizeString(callUpdate.status).toLowerCase();
  const endedReason = normalizeString(callUpdate.endedReason).toLowerCase();

  if (endedReason) return true;
  if (messageType.includes('call.ended') || messageType.includes('end-of-call')) return true;

  if (
    /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected)/.test(
      status
    )
  ) {
    return true;
  }

  return false;
}

function createSequentialDispatchQueue(campaign, leads) {
  const id = `seq-${nextSequentialDispatchQueueId++}`;
  const queue = {
    id,
    createdAt: new Date().toISOString(),
    campaign: { ...campaign },
    leads: Array.isArray(leads) ? leads.slice() : [],
    nextLeadIndex: 0,
    waitingForCallId: null,
    waitingForPhoneKey: null,
    isAdvancing: false,
    completed: false,
    results: [],
  };
  sequentialDispatchQueues.set(id, queue);
  return queue;
}

function finalizeSequentialDispatchQueueIfDone(queue) {
  if (!queue) return;
  if (queue.completed) return;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return;
  if (queue.nextLeadIndex < queue.leads.length) return;

  queue.completed = true;
  console.log(
    `[Coldcalling][Sequential Queue] Voltooid ${queue.id}: ${queue.results.filter((r) => r.success).length}/${
      queue.results.length
    } gestart`
  );

  // Opruimen na korte tijd zodat debugging nog even mogelijk blijft.
  const queueId = queue.id;
  setTimeout(() => {
    const current = sequentialDispatchQueues.get(queueId);
    if (!current || !current.completed) return;
    if (current.waitingForCallId) {
      sequentialDispatchQueueIdByCallId.delete(current.waitingForCallId);
    }
    sequentialDispatchQueues.delete(queueId);
  }, 10 * 60 * 1000);
}

async function advanceSequentialDispatchQueue(queueId, reason = 'unknown') {
  const queue = sequentialDispatchQueues.get(queueId);
  if (!queue || queue.completed) return queue || null;
  if (queue.isAdvancing) return queue;
  if (queue.waitingForCallId || queue.waitingForPhoneKey) return queue;

  queue.isAdvancing = true;
  try {
    console.log(
      `[Coldcalling][Sequential Queue] Advance ${queue.id} (reason=${reason}) idx=${queue.nextLeadIndex}/${queue.leads.length}`
    );

    while (
      !queue.completed &&
      !queue.waitingForCallId &&
      !queue.waitingForPhoneKey &&
      queue.nextLeadIndex < queue.leads.length
    ) {
      const index = queue.nextLeadIndex;
      const lead = queue.leads[index];
      queue.nextLeadIndex += 1;

      const result = await processColdcallingLead(lead, queue.campaign, index);
      queue.results.push(result);

      const callId = normalizeString(result?.vapi?.callId);
      const phoneKey = phoneDispatchKey(result?.lead?.phoneE164 || result?.lead?.phone);
      if (result.success && callId) {
        queue.waitingForCallId = callId;
        queue.waitingForPhoneKey = phoneKey || null;
        sequentialDispatchQueueIdByCallId.set(callId, queue.id);
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde (${callId}) voor lead ${index + 1}/${
            queue.leads.length
          }`
        );
        break;
      }

      if (result.success && phoneKey) {
        queue.waitingForPhoneKey = phoneKey;
        console.log(
          `[Coldcalling][Sequential Queue] ${queue.id} wacht op call einde via telefoon (${phoneKey}) voor lead ${
            index + 1
          }/${queue.leads.length} (geen callId ontvangen)`
        );
        break;
      }

      console.log(
        `[Coldcalling][Sequential Queue] ${queue.id} lead ${index + 1}/${queue.leads.length} ${
          result.success ? 'gestart (zonder callId)' : 'mislukt'
        }, ga door`
      );
    }

    finalizeSequentialDispatchQueueIfDone(queue);
    return queue;
  } finally {
    queue.isAdvancing = false;
  }
}

function handleSequentialDispatchQueueWebhookProgress(callUpdate) {
  if (!callUpdate || !isCallUpdateTerminalForSequentialDispatch(callUpdate)) return;

  const callId = normalizeString(callUpdate.callId);
  const webhookPhoneKey = phoneDispatchKey(callUpdate.phone);

  let queueId = callId ? sequentialDispatchQueueIdByCallId.get(callId) : null;
  let queue = queueId ? sequentialDispatchQueues.get(queueId) : null;

  if (!queue && callId) {
    sequentialDispatchQueueIdByCallId.delete(callId);
  }

  if (!queue && webhookPhoneKey) {
    for (const candidate of sequentialDispatchQueues.values()) {
      if (candidate.completed) continue;
      // Gebruik telefoon-fallback alleen als de webhook zelf geen callId heeft.
      // Als de webhook wel een callId heeft, willen we geen false positive match op telefoon.
      if (candidate.waitingForCallId && callId) continue;
      if (candidate.waitingForPhoneKey && candidate.waitingForPhoneKey === webhookPhoneKey) {
        queue = candidate;
        queueId = candidate.id;
        break;
      }
    }
  }

  if (!queue || !queueId) return;

  const matchesCallId = Boolean(callId && queue.waitingForCallId && queue.waitingForCallId === callId);
  const matchesPhone = Boolean(
    (!callId || !queue.waitingForCallId) &&
      webhookPhoneKey &&
      queue.waitingForPhoneKey &&
      queue.waitingForPhoneKey === webhookPhoneKey
  );
  if (!matchesCallId && !matchesPhone) return;

  if (queue.waitingForCallId) {
    sequentialDispatchQueueIdByCallId.delete(queue.waitingForCallId);
  }
  queue.waitingForCallId = null;
  queue.waitingForPhoneKey = null;

  console.log(
    `[Coldcalling][Sequential Queue] Call beëindigd (${callId || webhookPhoneKey}), volgende lead starten voor queue ${queueId}`
  );

  void advanceSequentialDispatchQueue(queueId, 'webhook-ended').catch((error) => {
    console.error(
      '[Coldcalling][Sequential Queue Error]',
      JSON.stringify(
        {
          queueId,
          callId: callId || null,
          message: error?.message || 'Onbekende fout',
        },
        null,
        2
      )
    );
  });
}

function isWebhookAuthorized(req) {
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    return true;
  }

  const headerCandidates = [
    req.get('x-vapi-secret'),
    req.get('x-vapi-signature'),
    req.get('authorization'),
  ].filter(Boolean);

  for (const candidate of headerCandidates) {
    if (candidate === secret) return true;
    if (candidate.toLowerCase().startsWith('bearer ') && candidate.slice(7).trim() === secret) {
      return true;
    }
  }

  return false;
}

app.post('/api/coldcalling/start', async (req, res) => {
  const missingEnv = getMissingEnvVars();

  if (missingEnv.length > 0) {
    return res.status(500).json({
      ok: false,
      error: 'Server mist vereiste environment variables voor Vapi.',
      missingEnv,
    });
  }

  const validated = validateStartPayload(req.body);
  if (validated.error) {
    return res.status(400).json({ ok: false, error: validated.error });
  }

  const { campaign, leads } = validated;
  const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

  console.log(
    `[Coldcalling] Start campagne ontvangen: ${leadsToProcess.length}/${leads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
  );

  let results = [];

  if (campaign.dispatchMode === 'parallel') {
    results = await Promise.all(
      leadsToProcess.map((lead, index) => processColdcallingLead(lead, campaign, index))
    );
  } else if (campaign.dispatchMode === 'sequential' && leadsToProcess.length > 1) {
    const queue = createSequentialDispatchQueue(campaign, leadsToProcess);
    await advanceSequentialDispatchQueue(queue.id, 'start-request');
    results = queue.results.slice();

    const startedNow = results.filter((item) => item.success).length;
    const failedNow = results.length - startedNow;
    const queuedRemaining = Math.max(0, queue.leads.length - queue.results.length);

    console.log(
      `[Coldcalling][Sequential Queue] ${queue.id} gestart: direct ${results.length}/${queue.leads.length} verwerkt, ${queuedRemaining} wachtend`
    );

    return res.status(200).json({
      ok: true,
      summary: {
        requested: leads.length,
        attempted: leadsToProcess.length,
        started: startedNow,
        failed: failedNow,
        dispatchMode: campaign.dispatchMode,
        dispatchDelaySeconds: 0,
        sequentialWaitForCallEnd: true,
        queueId: queue.id,
        queuedRemaining,
      },
      results,
    });
  } else {
    results = [];
    const delayMs =
      campaign.dispatchMode === 'delay' ? Math.round(campaign.dispatchDelaySeconds * 1000) : 0;

    for (let index = 0; index < leadsToProcess.length; index += 1) {
      const lead = leadsToProcess[index];
      const result = await processColdcallingLead(lead, campaign, index);
      results.push(result);

      const isLast = index === leadsToProcess.length - 1;
      if (!isLast && delayMs > 0) {
        console.log(
          `[Coldcalling] Wacht ${campaign.dispatchDelaySeconds}s voor volgende lead (${index + 1}/${leadsToProcess.length})`
        );
        await sleep(delayMs);
      }
    }
  }

  const started = results.filter((item) => item.success).length;
  const failed = results.length - started;

  return res.status(200).json({
    ok: true,
    summary: {
      requested: leads.length,
      attempted: leadsToProcess.length,
      started,
      failed,
      dispatchMode: campaign.dispatchMode,
      dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
    },
    results,
  });
});

app.get('/api/coldcalling/call-status/:callId', async (req, res) => {
  const callId = normalizeString(req.params?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }

  if (!normalizeString(process.env.VAPI_API_KEY)) {
    return res.status(500).json({ ok: false, error: 'VAPI_API_KEY ontbreekt op server.' });
  }

  try {
    const { endpoint, data } = await fetchVapiCallStatusById(callId);
    const call = data?.call && typeof data.call === 'object' ? data.call : data;

    return res.status(200).json({
      ok: true,
      endpoint,
      callId: normalizeString(call?.id || callId),
      status: normalizeString(call?.status || data?.status || ''),
      endedReason: normalizeString(call?.endedReason || data?.endedReason || ''),
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || 'Kon Vapi call status niet ophalen.',
      endpoint: error?.endpoint || null,
      details: error?.data || null,
    });
  }
});

// Vercel route-fallback: sommige serverless route-combinaties geven NOT_FOUND op diepere paden.
// Deze variant gebruikt een ondiep pad met querystring en werkt betrouwbaarder.
app.get('/api/coldcalling/status', async (req, res) => {
  const callId = normalizeString(req.query?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }

  if (!normalizeString(process.env.VAPI_API_KEY)) {
    return res.status(500).json({ ok: false, error: 'VAPI_API_KEY ontbreekt op server.' });
  }

  try {
    const { endpoint, data } = await fetchVapiCallStatusById(callId);
    const call = data?.call && typeof data.call === 'object' ? data.call : data;

    return res.status(200).json({
      ok: true,
      endpoint,
      callId: normalizeString(call?.id || callId),
      status: normalizeString(call?.status || data?.status || ''),
      endedReason: normalizeString(call?.endedReason || data?.endedReason || ''),
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || 'Kon Vapi call status niet ophalen.',
      endpoint: error?.endpoint || null,
      details: error?.data || null,
    });
  }
});

app.post('/api/vapi/webhook', (req, res) => {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Webhook secret ongeldig.' });
  }

  const messageType = req.body?.message?.type || req.body?.type || 'unknown';
  const callData = req.body?.message?.call || req.body?.call || null;

  const record = {
    receivedAt: new Date().toISOString(),
    messageType,
    callId: callData?.id || null,
    callStatus: callData?.status || null,
    payload: req.body,
  };

  recentWebhookEvents.unshift(record);
  if (recentWebhookEvents.length > 200) {
    recentWebhookEvents.pop();
  }

  if (VERBOSE_VAPI_WEBHOOK_LOGS) {
    console.log(
      '[Vapi Webhook]',
      JSON.stringify(
        {
          messageType,
          call: callData,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      '[Vapi Webhook]',
      JSON.stringify({
        messageType,
        callId: callData?.id || null,
        status: callData?.status || null,
        endedReason: callData?.endedReason || null,
      })
    );
  }

  const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromWebhookPayload(req.body));
  if (callUpdate) {
    console.log(
      '[Vapi Webhook -> CallUpdate]',
      JSON.stringify(
        {
          callId: callUpdate.callId,
          phone: callUpdate.phone,
          company: callUpdate.company,
          status: callUpdate.status,
          messageType: callUpdate.messageType,
          hasSummary: Boolean(callUpdate.summary),
          hasTranscriptSnippet: Boolean(callUpdate.transcriptSnippet),
          transcriptSnippetLen: normalizeString(callUpdate.transcriptSnippet).length || 0,
          hasTranscriptFull: Boolean(callUpdate.transcriptFull),
          transcriptFullLen: normalizeString(callUpdate.transcriptFull).length || 0,
        },
        null,
        2
      )
    );

    handleSequentialDispatchQueueWebhookProgress(callUpdate);

    // Cruciale backoffice-functie (bevestigingstaak) synchroon doen zodat Vercel serverless
    // background-cancellation dit niet kan verliezen. OpenAI-enrichment blijft asynchroon.
    ensureRuleBasedInsightAndAppointment(callUpdate);

    void maybeAnalyzeCallUpdateWithAi(callUpdate).catch((error) => {
      console.error(
        '[AI Call Insight Error]',
        JSON.stringify(
          {
            callId: callUpdate.callId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
            data: error?.data || null,
          },
          null,
          2
        )
      );
    });
  }

  // Reageer na de snelle lokale verwerking. Dit blijft snel genoeg en voorkomt gemiste taken.
  res.status(200).json({ ok: true });

  // TODO: Sla call-status updates op (bijv. queued/ringing/in-progress/ended).
  // TODO: Sla transcript/events op zodra je transcriptie wilt tonen in het dashboard.
  // TODO: Sla afspraken of opvolgacties op wanneer de call een afspraak boekt.
  return;
});

app.get('/api/vapi/call-updates', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
  const sinceMs = parseNumberSafe(req.query.sinceMs, null);

  const filtered = recentCallUpdates.filter((item) => {
    if (!Number.isFinite(sinceMs)) return true;
    return Number(item.updatedAtMs || 0) > Number(sinceMs);
  });

  return res.status(200).json({
    ok: true,
    count: Math.min(limit, filtered.length),
    updates: filtered.slice(0, limit),
  });
});

app.get('/api/vapi/webhook-debug', (req, res) => {
  const limit = Math.max(1, Math.min(100, parseIntSafe(req.query.limit, 20)));
  const demoCallIdPrefix = 'demo-';

  const latestWebhookEvents = recentWebhookEvents.slice(0, limit).map((event) => {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
    const message = payload?.message && typeof payload.message === 'object' ? payload.message : null;
    const call = (message?.call && typeof message.call === 'object' ? message.call : null) ||
      (payload?.call && typeof payload.call === 'object' ? payload.call : null);
    const transcriptSnippet = extractTranscriptSnippet(payload || {});
    const transcriptFull = extractTranscriptFull(payload || {});
    const summary = extractSummaryFromVapiPayload(payload || {});

    return {
      receivedAt: normalizeString(event?.receivedAt || ''),
      messageType: normalizeString(event?.messageType || ''),
      callId: normalizeString(event?.callId || call?.id || ''),
      callStatus: normalizeString(event?.callStatus || call?.status || ''),
      endedReason: normalizeString(call?.endedReason || ''),
      hasSummary: Boolean(summary),
      summaryLen: normalizeString(summary).length || 0,
      hasTranscriptSnippet: Boolean(transcriptSnippet),
      transcriptSnippetLen: normalizeString(transcriptSnippet).length || 0,
      hasTranscriptFull: Boolean(transcriptFull),
      transcriptFullLen: normalizeString(transcriptFull).length || 0,
      topLevelKeys: payload ? Object.keys(payload).slice(0, 30) : [],
      messageKeys: message ? Object.keys(message).slice(0, 30) : [],
      callKeys: call ? Object.keys(call).slice(0, 30) : [],
    };
  });

  const latestRealCallUpdates = recentCallUpdates
    .filter((item) => {
      const callId = normalizeString(item?.callId || '');
      return callId && !callId.startsWith(demoCallIdPrefix);
    })
    .slice(0, limit)
    .map((item) => ({
      callId: normalizeString(item?.callId || ''),
      phone: normalizeString(item?.phone || ''),
      company: normalizeString(item?.company || ''),
      status: normalizeString(item?.status || ''),
      messageType: normalizeString(item?.messageType || ''),
      hasSummary: Boolean(normalizeString(item?.summary || '')),
      hasTranscriptSnippet: Boolean(normalizeString(item?.transcriptSnippet || '')),
      transcriptSnippetLen: normalizeString(item?.transcriptSnippet || '').length || 0,
      hasTranscriptFull: Boolean(normalizeString(item?.transcriptFull || '')),
      transcriptFullLen: normalizeString(item?.transcriptFull || '').length || 0,
      updatedAt: normalizeString(item?.updatedAt || ''),
      updatedAtMs: Number(item?.updatedAtMs || 0) || 0,
    }));

  const allCallUpdateCount = recentCallUpdates.length;
  const realCallUpdateCount = recentCallUpdates.filter((item) => {
    const callId = normalizeString(item?.callId || '');
    return callId && !callId.startsWith(demoCallIdPrefix);
  }).length;

  return res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    webhookEventCount: recentWebhookEvents.length,
    callUpdateCount: allCallUpdateCount,
    realCallUpdateCount,
    demoOnlyCallUpdates: allCallUpdateCount > 0 && realCallUpdateCount === 0,
    latestWebhookEvents,
    latestRealCallUpdates,
  });
});

app.get('/api/ai/call-insights', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  backfillInsightsAndAppointmentsFromRecentCallUpdates();
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, recentAiCallInsights.length),
    insights: recentAiCallInsights.slice(0, limit),
    openAiEnabled: Boolean(getOpenAiApiKey()),
    model: OPENAI_MODEL,
  });
});

app.post('/api/ai/summarize', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const text = normalizeString(body.text || '');
    const style = normalizeAiSummaryStyle(body.style);
    const language = normalizeString(body.language || 'nl') || 'nl';
    const extraInstructions = normalizeString(body.extraInstructions || '');
    const maxSentences = Math.max(1, Math.min(12, parseIntSafe(body.maxSentences, 4)));

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Tekst ontbreekt',
        detail: 'Stuur een JSON body met { text: "..." }',
      });
    }

    if (text.length > 50000) {
      return res.status(400).json({
        ok: false,
        error: 'Tekst te lang',
        detail: 'Maximaal 50.000 tekens per request.',
      });
    }

    if (body.style !== undefined && !style) {
      return res.status(400).json({
        ok: false,
        error: 'Ongeldige stijl',
        detail: 'Gebruik: short, medium, long of bullets',
      });
    }

    const result = await generateTextSummaryWithAi({
      text,
      style: style || 'medium',
      language,
      maxSentences,
      extraInstructions,
    });

    return res.status(200).json({
      ok: true,
      summary: result.summary,
      style: result.style,
      language: result.language,
      maxSentences: result.maxSentences,
      source: result.source,
      model: result.model,
      usage: result.usage,
      openAiEnabled: true,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    return res.status(safeStatus).json({
      ok: false,
      error:
        safeStatus === 503
          ? 'AI samenvatting niet beschikbaar'
          : 'AI samenvatting mislukt',
      detail: String(error?.message || 'Onbekende fout'),
      openAiEnabled: Boolean(getOpenAiApiKey()),
    });
  }
});

app.get('/api/dashboard/activity', (req, res) => {
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, recentDashboardActivities.length),
    activities: recentDashboardActivities.slice(0, limit),
  });
});

app.get('/api/ui-state/:scope', async (req, res) => {
  const scope = normalizeUiStateScope(req.params.scope);
  if (!scope) {
    return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });
  }

  const state = await getUiStateValues(scope);
  if (!state) {
    return res.status(400).json({ ok: false, error: 'Kon UI state niet laden' });
  }

  return res.status(200).json({
    ok: true,
    scope,
    values: state.values || {},
    source: state.source || 'memory',
    updatedAt: state.updatedAt || null,
  });
});

app.post('/api/ui-state/:scope', async (req, res) => {
  const scope = normalizeUiStateScope(req.params.scope);
  if (!scope) {
    return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });
  }

  const patchProvided = req.body && typeof req.body === 'object' && req.body.patch && typeof req.body.patch === 'object';
  let valuesToSave;

  if (patchProvided) {
    const current = await getUiStateValues(scope);
    const currentValues = current && current.values && typeof current.values === 'object' ? current.values : {};
    const patchValues = sanitizeUiStateValues(req.body.patch);
    valuesToSave = { ...currentValues, ...patchValues };
  } else {
    valuesToSave = sanitizeUiStateValues(req.body?.values || {});
  }

  const state = await setUiStateValues(scope, valuesToSave, {
    source: normalizeString(req.body?.source || 'frontend'),
    actor: normalizeString(req.body?.actor || ''),
  });
  if (!state) {
    return res.status(500).json({ ok: false, error: 'Kon UI state niet opslaan' });
  }

  return res.status(200).json({
    ok: true,
    scope,
    values: state.values || {},
    source: state.source || 'memory',
  });
});

app.post('/api/dashboard/activity', (req, res) => {
  const entry = appendDashboardActivity(
    {
      ...req.body,
      source: normalizeString(req.body?.source || 'personeel-dashboard'),
      actor: normalizeString(req.body?.actor || ''),
    },
    'dashboard_activity_manual'
  );

  return res.status(201).json({
    ok: true,
    activity: entry,
  });
});

app.get('/api/agenda/appointments', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  if (isImapMailConfigured()) {
    await syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
  }
  const limit = Math.max(1, Math.min(1000, parseIntSafe(req.query.limit, 200)));
  const sorted = generatedAgendaAppointments
    .filter(isGeneratedAppointmentConfirmedForAgenda)
    .slice()
    .sort(compareAgendaAppointments);
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, sorted.length),
    appointments: sorted.slice(0, limit),
  });
});

app.get('/api/agenda/confirmation-tasks', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  if (isImapMailConfigured()) {
    await syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
  }
  backfillInsightsAndAppointmentsFromRecentCallUpdates();
  generatedAgendaAppointments.forEach((appointment, idx) => {
    if (!appointment) return;
    if (!mapAppointmentToConfirmationTask(appointment)) return;
    ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_list_auto_draft' });
  });
  const limit = Math.max(1, Math.min(1000, parseIntSafe(req.query.limit, 100)));
  const includeDemo = /^(1|true|yes)$/i.test(String(req.query.includeDemo || ''));
  const tasks = generatedAgendaAppointments
    .filter((appointment) => {
      if (includeDemo) return true;
      if (DEMO_CONFIRMATION_TASK_ENABLED) return true;
      const callId = normalizeString(appointment?.callId || '');
      return !callId.startsWith('demo-');
    })
    .map(mapAppointmentToConfirmationTask)
    .filter(Boolean)
    .sort(compareConfirmationTasks);

  return res.status(200).json({
    ok: true,
    count: Math.min(limit, tasks.length),
    tasks: tasks.slice(0, limit),
  });
});

app.post('/api/agenda/confirmation-mail-sync', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  const result = await syncInboundConfirmationEmailsFromImap({
    force: true,
    maxMessages: Math.max(1, Math.min(50, parseIntSafe(req.body?.maxMessages, 20))),
  });
  return res.status(result?.ok === false && !result?.skipped ? 500 : 200).json({
    ok: result?.ok !== false,
    sync: result || null,
  });
});

async function sendConfirmationTaskDetailResponse(req, res, taskIdRaw) {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  if (isImapMailConfigured()) {
    await syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
  }
  backfillInsightsAndAppointmentsFromRecentCallUpdates();

  const idx = getGeneratedAppointmentIndexById(taskIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_detail_auto_draft' });
  const appointment = generatedAgendaAppointments[idx];
  let detail = buildConfirmationTaskDetail(appointment);
  if (detail && !detail.transcriptAvailable && normalizeString(appointment?.callId || '')) {
    await refreshCallUpdateFromVapiStatusApi(appointment.callId);
    detail = buildConfirmationTaskDetail(generatedAgendaAppointments[idx] || appointment);
  }
  if (!detail) {
    return res.status(404).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
  }

  return res.status(200).json({
    ok: true,
    task: detail,
  });
}

app.get('/api/agenda/confirmation-tasks/:id', async (req, res) => {
  return sendConfirmationTaskDetailResponse(req, res, req.params.id);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.get('/api/agenda/confirmation-task', async (req, res) => {
  return sendConfirmationTaskDetailResponse(req, res, req.query.taskId);
});

async function sendConfirmationTaskDraftEmailResponse(req, res, taskIdRaw) {
  const idx = getGeneratedAppointmentIndexById(taskIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  const detail = buildConfirmationTaskDetail(appointment);
  if (!detail) {
    return res.status(409).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
  }

  try {
    const generated = await generateConfirmationEmailDraftWithAi(appointment, detail);
    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...generatedAgendaAppointments[idx],
        confirmationEmailDraft: generated.draft,
        confirmationEmailDraftGeneratedAt: nowIso,
        confirmationEmailDraftSource: normalizeString(generated.source || 'template'),
        confirmationEmailLastError: null,
      },
      'confirmation_task_draft_email'
    );

    appendDashboardActivity(
      {
        type: 'confirmation_mail_draft_generated',
        title: 'Bevestigingsmail concept gemaakt',
        detail: `Concept gegenereerd (${normalizeString(generated.source || 'template') || 'onbekende bron'}).`,
        company: updatedAppointment?.company || appointment?.company || '',
        actor: normalizeString(req.body?.actor || req.body?.doneBy || ''),
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_draft_email'
    );

    return res.status(200).json({
      ok: true,
      task: buildConfirmationTaskDetail(updatedAppointment),
      generated: {
        source: normalizeString(generated.source || ''),
        model: normalizeString(generated.model || '') || null,
      },
    });
  } catch (error) {
    console.error(
      '[ConfirmationTask][DraftEmailError]',
      JSON.stringify(
        {
          appointmentId: Number(appointment?.id) || null,
          callId: normalizeString(appointment?.callId || '') || null,
          message: error?.message || 'Onbekende fout',
          status: Number(error?.status || 0) || null,
        },
        null,
        2
      )
    );

    return res.status(500).json({
      ok: false,
      error: 'Kon geen bevestigingsmail opstellen.',
      detail: normalizeString(error?.message || '') || null,
    });
  }
}

app.post('/api/agenda/confirmation-tasks/:id/draft-email', async (req, res) => {
  return sendConfirmationTaskDraftEmailResponse(req, res, req.params.id);
});

app.post('/api/agenda/confirmation-task-draft-email', async (req, res) => {
  return sendConfirmationTaskDraftEmailResponse(req, res, req.query.taskId);
});

async function sendConfirmationTaskEmailResponse(req, res, taskIdRaw) {
  const idx = getGeneratedAppointmentIndexById(taskIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_send_auto_draft' });
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const recipientEmail = normalizeEmailAddress(
    req.body?.recipientEmail || req.body?.email || appointment?.contactEmail || appointment?.email || ''
  );
  if (!isLikelyValidEmail(recipientEmail)) {
    return res.status(400).json({
      ok: false,
      error: 'Vul een geldig ontvanger e-mailadres in.',
      code: 'INVALID_RECIPIENT_EMAIL',
    });
  }

  if (!isSmtpMailConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Mail verzending is nog niet geconfigureerd op de server (SMTP ontbreekt).',
      code: 'SMTP_NOT_CONFIGURED',
      missingEnv: [
        !MAIL_SMTP_HOST ? 'MAIL_SMTP_HOST' : null,
        !MAIL_SMTP_USER ? 'MAIL_SMTP_USER' : null,
        !MAIL_SMTP_PASS ? 'MAIL_SMTP_PASS' : null,
        !MAIL_FROM_ADDRESS ? 'MAIL_FROM_ADDRESS' : null,
      ].filter(Boolean),
    });
  }

  try {
    const delivery = await sendConfirmationEmailViaSmtp({
      appointment,
      recipientEmail,
      draftText: normalizeString(appointment?.confirmationEmailDraft || ''),
    });

    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        contactEmail: recipientEmail,
        confirmationEmailSent: true,
        confirmationEmailSentAt: nowIso,
        confirmationEmailSentBy: actor || null,
        confirmationEmailLastError: null,
        confirmationEmailLastSentMessageId:
          normalizeString(delivery?.messageId || '') || null,
      },
      'confirmation_task_send_email'
    );

    appendDashboardActivity(
      {
        type: 'confirmation_mail_sent',
        title: 'Bevestigingsmail verstuurd',
        detail: `E-mail verstuurd naar ${recipientEmail} via SMTP.`,
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_send_email'
    );

    return res.status(200).json({
      ok: true,
      sent: true,
      task: buildConfirmationTaskDetail(updatedAppointment),
      delivery,
    });
  } catch (error) {
    console.error(
      '[ConfirmationTask][SendEmailError]',
      JSON.stringify(
        {
          appointmentId: Number(appointment?.id) || null,
          callId: normalizeString(appointment?.callId || '') || null,
          recipientEmail,
          code: normalizeString(error?.code || ''),
          message: error?.message || 'Onbekende fout',
        },
        null,
        2
      )
    );

    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        contactEmail: recipientEmail || normalizeEmailAddress(appointment?.contactEmail || '') || null,
        confirmationEmailLastError:
          truncateText(normalizeString(error?.message || 'Bevestigingsmail verzenden mislukt.'), 500),
      },
      'confirmation_task_send_email_error'
    );

    return res.status(500).json({
      ok: false,
      error: 'Bevestigingsmail verzenden mislukt.',
      detail: normalizeString(error?.message || '') || null,
      code: normalizeString(error?.code || '') || null,
      task: updatedAppointment ? buildConfirmationTaskDetail(updatedAppointment) : null,
    });
  }
}

app.post('/api/agenda/confirmation-tasks/:id/send-email', async (req, res) => {
  return sendConfirmationTaskEmailResponse(req, res, req.params.id);
});

app.post('/api/agenda/confirmation-task-send-email', async (req, res) => {
  return sendConfirmationTaskEmailResponse(req, res, req.query.taskId);
});

app.post('/api/agenda/confirmation-tasks/:id/mark-sent', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      confirmationEmailSent: true,
      confirmationEmailSentAt: nowIso,
      confirmationEmailSentBy: actor || null,
    },
    'confirmation_task_mark_sent'
  );

  appendDashboardActivity(
    {
      type: 'confirmation_mail_sent',
      title: 'Bevestigingsmail verstuurd',
      detail: 'Bevestigingsmail is als verstuurd gemarkeerd in het personeel dashboard.',
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'premium-personeel-dashboard',
    },
    'dashboard_activity_mark_sent'
  );

  return res.status(200).json({
    ok: true,
    taskUpdated: true,
    task: buildConfirmationTaskDetail(updatedAppointment),
  });
});

app.post('/api/agenda/confirmation-tasks/:id/mark-response-received', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      confirmationEmailSent: true,
      confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
      confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
      confirmationResponseReceived: true,
      confirmationResponseReceivedAt: nowIso,
      confirmationResponseReceivedBy: actor || null,
      confirmationAppointmentCancelled: false,
      confirmationAppointmentCancelledAt: null,
      confirmationAppointmentCancelledBy: null,
    },
    'confirmation_task_mark_response_received'
  );

  appendDashboardActivity(
    {
      type: 'appointment_confirmed_by_mail',
      title: 'Afspraak bevestigd per mail',
      detail: 'De klant heeft de afspraak per mail bevestigd.',
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'premium-personeel-dashboard',
    },
    'dashboard_activity_mark_response_received'
  );

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    appointment: updatedAppointment,
  });
});

app.post('/api/agenda/confirmation-tasks/:id/mark-cancelled', (req, res) => {
  const idx = getGeneratedAppointmentIndexById(req.params.id);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }
  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      confirmationEmailSent: true,
      confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
      confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
      confirmationResponseReceived: false,
      confirmationResponseReceivedAt: null,
      confirmationResponseReceivedBy: null,
      confirmationAppointmentCancelled: true,
      confirmationAppointmentCancelledAt: nowIso,
      confirmationAppointmentCancelledBy: actor || null,
    },
    'confirmation_task_mark_cancelled'
  );

  appendDashboardActivity(
    {
      type: 'appointment_cancelled',
      title: 'Afspraak geannuleerd',
      detail: 'Afspraak is geannuleerd vanuit het bevestigingsmailproces.',
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'premium-personeel-dashboard',
    },
    'dashboard_activity_mark_cancelled'
  );

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    cancelled: true,
    appointment: updatedAppointment,
  });
});

app.post('/api/agenda/confirmation-tasks/:id/complete', (req, res) => {
  const taskId = Number(req.params.id);
  const idx = getGeneratedAppointmentIndexById(taskId);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  if (!mapAppointmentToConfirmationTask(appointment)) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      confirmationEmailSent: true,
      confirmationEmailSentAt: nowIso,
      confirmationEmailSentBy: actor || null,
      confirmationResponseReceived: true,
      confirmationResponseReceivedAt: nowIso,
      confirmationResponseReceivedBy: actor || null,
      confirmationAppointmentCancelled: false,
      confirmationAppointmentCancelledAt: null,
      confirmationAppointmentCancelledBy: null,
    },
    'confirmation_task_complete'
  );

  appendDashboardActivity(
    {
      type: 'confirmation_task_completed',
      title: 'Bevestigingstaak afgerond',
      detail: 'Bevestigingsmail + bevestiging ontvangen via snelle complete-route.',
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'personeel-dashboard',
    },
    'dashboard_activity_complete_task'
  );

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    taskId,
    appointment: updatedAppointment,
  });
});

// Simpele healthcheck voor hosting platforms (Render/Railway).
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'softora-vapi-coldcalling-backend',
    supabase: {
      enabled: isSupabaseConfigured(),
      hydrated: supabaseStateHydrated,
      table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
      stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
    },
    timestamp: new Date().toISOString(),
  });
});

// Alias voor serverless setups waar de backend onder /api/* hangt (zoals Vercel).
app.get('/api/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'softora-vapi-coldcalling-backend',
    supabase: {
      enabled: isSupabaseConfigured(),
      hydrated: supabaseStateHydrated,
      table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
      stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
    },
    timestamp: new Date().toISOString(),
  });
});

function sendRuntimeHealthDebug(_req, res) {
  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    runtime: {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      appointments: generatedAgendaAppointments.length,
      realCallUpdates: recentCallUpdates.filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith('demo-');
      }).length,
    },
    supabase: {
      enabled: isSupabaseConfigured(),
      hydrated: supabaseStateHydrated,
      hydrateRetryNotBeforeMs: supabaseHydrateRetryNotBeforeMs,
      table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
      stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
      host: redactSupabaseUrlForDebug(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      lastHydrateError: supabaseLastHydrateError || null,
      lastPersistError: supabaseLastPersistError || null,
    },
    mail: {
      smtpConfigured: isSmtpMailConfigured(),
      imapConfigured: isImapMailConfigured(),
      imapMailbox: isImapMailConfigured() ? MAIL_IMAP_MAILBOX : null,
      imapPollCooldownMs: MAIL_IMAP_POLL_COOLDOWN_MS,
      imapNextPollAfterMs: inboundConfirmationMailSyncNotBeforeMs,
      imapLastSync: inboundConfirmationMailSyncLastResult || null,
    },
  });
}

app.get('/api/debug/runtime-health', sendRuntimeHealthDebug);
app.get('/api/runtime-health', sendRuntimeHealthDebug);

/* app.get('/api/debug/runtime-health', (_req, res) => {
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    runtime: {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      appointments: generatedAgendaAppointments.length,
      realCallUpdates: recentCallUpdates.filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith('demo-');
      }).length,
    },
    supabase: {
      enabled: isSupabaseConfigured(),
      hydrated: supabaseStateHydrated,
      hydrateRetryNotBeforeMs: supabaseHydrateRetryNotBeforeMs,
      table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
      stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
      host: redactSupabaseUrlForDebug(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      lastHydrateError: supabaseLastHydrateError || null,
      lastPersistError: supabaseLastPersistError || null,
    },
  });
}); */

app.get('/api/supabase-probe', async (_req, res) => {
  if (!isSupabaseConfigured()) {
    return res.status(200).json({
      ok: false,
      configured: false,
      error: 'Supabase niet geconfigureerd.',
    });
  }

  const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(
    SUPABASE_STATE_TABLE
  )}?select=state_key&limit=1`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = truncateText(text, 800);
    }

    return res.status(200).json({
      ok: response.ok,
      configured: true,
      status: response.status,
      supabaseHost: redactSupabaseUrlForDebug(SUPABASE_URL),
      table: SUPABASE_STATE_TABLE,
      stateKey: SUPABASE_STATE_KEY,
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      body,
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      configured: true,
      status: null,
      supabaseHost: redactSupabaseUrlForDebug(SUPABASE_URL),
      table: SUPABASE_STATE_TABLE,
      stateKey: SUPABASE_STATE_KEY,
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      error: truncateText(error?.message || String(error), 500),
    });
  }
});

app.post('/api/runtime-sync-now', async (_req, res) => {
  const before = {
    hydrated: supabaseStateHydrated,
    lastHydrateError: supabaseLastHydrateError || null,
    lastPersistError: supabaseLastPersistError || null,
  };

  const persistOk = await persistRuntimeStateToSupabase('debug_runtime_sync_now');

  // Forceer een nieuwe hydrate-attempt op deze instance voor directe diagnose.
  supabaseStateHydrated = false;
  supabaseHydrateRetryNotBeforeMs = 0;

  const hydratedOk = await ensureRuntimeStateHydratedFromSupabase();

  return res.status(200).json({
    ok: Boolean(persistOk && hydratedOk),
    before,
    after: {
      hydrated: supabaseStateHydrated,
      lastHydrateError: supabaseLastHydrateError || null,
      lastPersistError: supabaseLastPersistError || null,
      counts: {
        webhookEvents: recentWebhookEvents.length,
        callUpdates: recentCallUpdates.length,
        aiCallInsights: recentAiCallInsights.length,
        appointments: generatedAgendaAppointments.length,
      },
    },
    persistOk,
    hydratedOk,
    supabase: {
      host: redactSupabaseUrlForDebug(SUPABASE_URL),
      table: SUPABASE_STATE_TABLE,
      stateKey: SUPABASE_STATE_KEY,
    },
  });
});

// API routes eerst, daarna statische frontend assets/html serveren.
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'premium-website.html'));
});

app.get('/:page', (req, res, next) => {
  const page = req.params.page;

  if (!/^[a-zA-Z0-9._-]+\.html$/.test(page)) {
    return next();
  }

  if (!knownHtmlPageFiles.has(page)) {
    return next();
  }

  const destination = toPrettyPagePathFromHtmlFile(page);
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  return res.redirect(301, `${destination}${query}`);
});

app.get('/:slug', (req, res, next) => {
  const slug = String(req.params.slug || '').trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return next();
  }

  if (slug === 'index') {
    return res.redirect(301, '/');
  }

  const fileName = knownPrettyPageSlugToFile.get(slug);
  if (!fileName) {
    return next();
  }

  return res.sendFile(path.join(__dirname, fileName), (err) => {
    if (err) next();
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Niet gevonden' });
});

app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    ok: false,
    error: 'Interne serverfout',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

function seedDemoConfirmationTaskForUiTesting() {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction && !DEMO_CONFIRMATION_TASK_ENABLED) return;

  const demoCallId = 'demo-confirmation-task-call-1';
  if (generatedAgendaAppointments.some((item) => normalizeString(item?.callId) === demoCallId)) {
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  upsertRecentCallUpdate({
    callId: demoCallId,
    phone: '+31612345678',
    company: 'Testbedrijf Demo BV',
    name: 'Servé Creusen',
    status: 'ended',
    messageType: 'call.ended',
    summary:
      'Afspraak ingepland voor een korte intake over de AI coldcalling setup. Klant wil eerst per mail bevestiging ontvangen.',
    transcriptSnippet:
      'AI: Zullen we morgen om 14:00 een intake plannen? | Klant: Ja, stuur even een bevestigingsmail dan bevestig ik per mail terug.',
    transcriptFull: [
      'assistant: Goedemiddag, u spreekt met de AI assistent van Softora.',
      'customer: Goedemiddag.',
      'assistant: Ik bel kort over het automatiseren van leadopvolging en intakeplanning.',
      'customer: Interessant, vertel.',
      'assistant: Zullen we een intake plannen om de workflow door te nemen?',
      'customer: Ja, dat is goed.',
      'assistant: Past morgen om 14:00 uur?',
      'customer: Ja, stuur even een bevestigingsmail. Als ik die heb, bevestig ik terug.',
      'assistant: Helemaal goed, dan zetten we dat zo door.',
    ].join('\n'),
    endedReason: 'completed',
    updatedAt: now.toISOString(),
    updatedAtMs: now.getTime(),
  });

  const insight = upsertAiCallInsight({
    callId: demoCallId,
    company: 'Testbedrijf Demo BV',
    contactName: 'Servé Creusen',
    phone: '+31612345678',
    branche: 'Zakelijke Dienstverlening',
    summary:
      'Prospect staat open voor intake. Afspraak mondeling ingepland en wil eerst een bevestigingsmail ontvangen en daarna per mail bevestigen.',
    appointmentBooked: true,
    appointmentDate: date,
    appointmentTime: '14:00',
    estimatedValueEur: 2800,
    followUpRequired: true,
    followUpReason: 'Bevestigingsmail sturen en wachten op schriftelijke bevestiging.',
    source: 'seed',
    model: 'seed',
    analyzedAt: now.toISOString(),
  });

  const appointment = upsertGeneratedAgendaAppointment(
    {
      company: 'Testbedrijf Demo BV',
      contact: 'Servé Creusen',
      phone: '+31612345678',
      type: 'meeting',
      date,
      time: '14:00',
      value: '€2.800',
      branche: 'Zakelijke Dienstverlening',
      source: 'AI Cold Calling (Testdata UI)',
      summary:
        'Testafspraak voor UI-testen. Eerst bevestigingsmail sturen, daarna wachten op mailbevestiging voordat de afspraak in de agenda verschijnt.',
      aiGenerated: true,
      callId: demoCallId,
      createdAt: now.toISOString(),
    },
    demoCallId
  );

  if (appointment) {
    appointment.confirmationEmailDraft = [
      'Onderwerp: Bevestiging intakeafspraak Testbedrijf Demo BV - morgen 14:00',
      '',
      'Beste Servé,',
      '',
      'Bedankt voor het prettige telefoongesprek van zojuist.',
      'Hierbij bevestig ik onze intakeafspraak voor morgen om 14:00 uur.',
      '',
      'Zoals besproken lopen we tijdens de intake kort de AI coldcalling workflow door en bekijken we de opvolging in het dashboard.',
      '',
      'Wil je deze tijd per mail bevestigen? Dan zetten wij de afspraak definitief in de agenda.',
      '',
      'Met vriendelijke groet,',
      'Softora',
    ].join('\n');
    appointment.confirmationEmailDraftGeneratedAt = now.toISOString();
    appointment.confirmationEmailDraftSource = 'seed';
    if (insight) {
      insight.agendaAppointmentId = appointment.id;
    }
    queueRuntimeStatePersist('demo_seed_confirmation_task');
  }

  console.log('[Startup] Demo bevestigingstaak toegevoegd voor UI-testen.');
}

// In serverless (zoals Vercel) wordt startServer() niet aangeroepen, dus seed de
// demo-taak ook bij module-load. De functie is idempotent op basis van callId.
seedDemoConfirmationTaskForUiTesting();
void ensureRuntimeStateHydratedFromSupabase();

function startServer() {
  seedDemoConfirmationTaskForUiTesting();
  void ensureRuntimeStateHydratedFromSupabase();
  app.listen(PORT, () => {
    console.log(`Softora Vapi backend draait op http://localhost:${PORT}`);
    const missingEnv = getMissingEnvVars();
    if (missingEnv.length > 0) {
      console.warn(
        `[Startup] Let op: ontbrekende env vars voor Vapi (${missingEnv.join(', ')}). /api/coldcalling/start zal falen totdat deze zijn ingevuld.`
      );
    }
    if (isSupabaseConfigured()) {
      console.log(
        `[Startup] Supabase state persistence actief (${SUPABASE_STATE_TABLE}:${SUPABASE_STATE_KEY}).`
      );
    } else {
      console.log('[Startup] Supabase state persistence uit (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ontbreken).');
    }
  });
}

const isServerlessRuntime =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.LAMBDA_TASK_ROOT);

if (require.main === module && !isServerlessRuntime) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.normalizeNlPhoneToE164 = normalizeNlPhoneToE164;
module.exports.startServer = startServer;
