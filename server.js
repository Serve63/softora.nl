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
const APP_BUILD_ID = String(
  process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    ''
).trim();
const VAPI_BASE_URL = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const ELEVENLABS_API_BASE_URL = process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io/v1';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_BASE_URL = process.env.ANTHROPIC_API_BASE_URL || 'https://api.anthropic.com/v1';
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-4-6';
const WEBSITE_ANTHROPIC_MODEL =
  process.env.WEBSITE_ANTHROPIC_MODEL ||
  process.env.ANTHROPIC_WEBSITE_MODEL ||
  'claude-opus-4-6';
const WEBSITE_GENERATION_PROVIDER = String(
  process.env.WEBSITE_GENERATION_PROVIDER || process.env.SITE_GENERATION_PROVIDER || ''
)
  .trim()
  .toLowerCase();
const WEBSITE_GENERATION_STRICT_ANTHROPIC = !/^(0|false|no)$/i.test(
  String(process.env.WEBSITE_GENERATION_STRICT_ANTHROPIC || 'true')
);
const WEBSITE_GENERATION_STRICT_HTML = !/^(0|false|no)$/i.test(
  String(process.env.WEBSITE_GENERATION_STRICT_HTML || 'true')
);
const WEBSITE_GENERATION_TIMEOUT_MS = Math.max(
  60_000,
  Math.min(600_000, Number(process.env.WEBSITE_GENERATION_TIMEOUT_MS || 300_000) || 300_000)
);
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
const MAIL_IMAP_EXTRA_MAILBOXES = String(process.env.MAIL_IMAP_MAILBOXES || '')
  .split(',')
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const MAIL_IMAP_POLL_COOLDOWN_MS = Math.max(
  5_000,
  Math.min(300_000, Number(process.env.MAIL_IMAP_POLL_COOLDOWN_MS || 20_000) || 20_000)
);
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();
const ELEVENLABS_TOOL_CALL_SOUND_SYNC_CACHE_TTL_MS = Math.max(
  60_000,
  Math.min(
    86_400_000,
    Number(process.env.ELEVENLABS_TOOL_CALL_SOUND_SYNC_CACHE_TTL_MS || 900_000) || 900_000
  )
);
let elevenLabsConversationListCache = {
  fetchedAtMs: 0,
  agentId: '',
  conversations: [],
};
let vapiAssistantConfigCache = {
  assistantId: '',
  fetchedAtMs: 0,
  assistant: null,
  error: '',
  promise: null,
};
let elevenLabsToolCallSoundSyncState = {
  agentId: '',
  sound: '',
  behavior: '',
  result: 'idle',
  syncedAtMs: 0,
  touchedToolCount: 0,
  changedToolCount: 0,
  error: '',
  promise: null,
};
let elevenLabsAgentVoiceOverrideCache = {
  agentId: '',
  fetchedAtMs: 0,
  voiceOverride: null,
  source: '',
  error: '',
  promise: null,
};
let elevenLabsAgentConfigCache = {
  agentId: '',
  fetchedAtMs: 0,
  data: null,
  error: '',
  promise: null,
};
let latestVapiPayloadDebug = null;
let latestCustomVoiceDebug = null;
let coldcallingHistoryVisibleAfterMs = 0;
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
const PREMIUM_ACTIVE_ORDERS_SCOPE = 'premium_active_orders';
const PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
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

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function clipText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) return '';
  const limit = Math.floor(Number(maxLength));
  return text.length > limit ? text.slice(0, limit) : text;
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

async function fetchSupabaseRowByKeyViaRest(rowKey, selectColumns = 'payload,updated_at') {
  const normalizedRowKey = normalizeString(rowKey);
  if (!normalizedRowKey) {
    return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };
  }

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const url =
    `${baseUrl}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}` +
    `?select=${encodeURIComponent(selectColumns)}` +
    `&state_key=eq.${encodeURIComponent(normalizedRowKey)}` +
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

async function upsertSupabaseRowViaRest(row) {
  const stateKey = normalizeString(row?.state_key || '');
  if (!stateKey) {
    return { ok: false, status: null, body: null, error: 'Ongeldige state key.' };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, status: null, body: null, error: 'Supabase niet geconfigureerd.' };
  }

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(SUPABASE_STATE_TABLE)}?on_conflict=state_key`;

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
    version: 3,
    savedAt: new Date().toISOString(),
    coldcallingHistoryVisibleAfterMs: getColdcallingHistoryVisibleAfterMs(),
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

  coldcallingHistoryVisibleAfterMs = Math.max(
    0,
    Number(payload.coldcallingHistoryVisibleAfterMs || 0) || 0
  );

  const nextWebhookEvents = Array.isArray(payload.recentWebhookEvents) ? payload.recentWebhookEvents.slice(0, 200) : [];
  const nextCallUpdates = Array.isArray(payload.recentCallUpdates)
    ? payload.recentCallUpdates.slice(0, 500).filter((item) => isCallUpdateVisibleForHistory(item))
    : [];
  const visibleCallIds = new Set(
    nextCallUpdates
      .map((item) => normalizeString(item?.callId || ''))
      .filter(Boolean)
  );
  const nextAiCallInsights = Array.isArray(payload.recentAiCallInsights)
    ? payload.recentAiCallInsights
        .slice(0, 500)
        .filter((item) => visibleCallIds.has(normalizeString(item?.callId || '')))
    : [];
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
  if (supabaseStateHydrated && !force) return true;
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

function getColdcallingHistoryVisibleAfterMs() {
  const value = Number(coldcallingHistoryVisibleAfterMs || 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function getCallUpdateRelevantMs(update) {
  const candidates = [update?.endedAt, update?.startedAt, update?.updatedAt];
  for (const candidate of candidates) {
    const parsed = Date.parse(normalizeString(candidate || ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const updatedAtMs = Number(update?.updatedAtMs);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return Math.round(updatedAtMs);

  return 0;
}

function isCallUpdateVisibleForHistory(update) {
  const cutoffMs = getColdcallingHistoryVisibleAfterMs();
  if (!cutoffMs) return true;
  const updateMs = getCallUpdateRelevantMs(update);
  return Number.isFinite(updateMs) && updateMs >= cutoffMs;
}

function clearColdcallingHistoryRuntime(options = {}) {
  const nowMs = Date.now();
  const requestedCutoffMs = Number(options.visibleAfterMs || nowMs) || nowMs;
  coldcallingHistoryVisibleAfterMs = Math.max(nowMs, requestedCutoffMs);

  recentWebhookEvents.splice(0, recentWebhookEvents.length);
  recentCallUpdates.splice(0, recentCallUpdates.length);
  callUpdatesById.clear();
  recentAiCallInsights.splice(0, recentAiCallInsights.length);
  aiCallInsightsByCallId.clear();
  aiAnalysisFingerprintByCallId.clear();
  aiAnalysisInFlightCallIds.clear();
  elevenLabsConversationListCache = {
    fetchedAtMs: 0,
    agentId: '',
    conversations: [],
  };

  return {
    visibleAfterMs: getColdcallingHistoryVisibleAfterMs(),
    visibleAfter: new Date(getColdcallingHistoryVisibleAfterMs()).toISOString(),
    counts: {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      appointments: generatedAgendaAppointments.length,
    },
  };
}

function parseHttpByteRange(rangeHeader, totalLength) {
  const total = Number(totalLength);
  if (!Number.isFinite(total) || total <= 0) return null;

  const raw = normalizeString(rangeHeader || '');
  const match = raw.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  let start = startRaw === '' ? null : Number(startRaw);
  let end = endRaw === '' ? null : Number(endRaw);

  if (startRaw === '' && endRaw === '') return null;

  if (startRaw === '') {
    const suffixLength = Number(end);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) return null;
    if (endRaw === '') {
      end = total - 1;
    } else if (!Number.isFinite(end) || end < start) {
      return null;
    }
  }

  if (start >= total) return { unsatisfiable: true, total };

  end = Math.min(Number(end), total - 1);
  return {
    start,
    end,
    length: end - start + 1,
    total,
    unsatisfiable: false,
  };
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
      const fallback = await fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
      if (!fallback.ok) {
        console.error('[UI State][Supabase][GetError]', error.message || error);
        return { values: { ...(inMemoryUiStateByScope.get(normalizedScope) || {}) }, source: 'memory' };
      }

      const row = Array.isArray(fallback.body) ? fallback.body[0] || null : fallback.body;
      const values = sanitizeUiStateValues(row?.payload?.values || {});
      inMemoryUiStateByScope.set(normalizedScope, values);
      return {
        values: { ...values },
        updatedAt: normalizeString(row?.updated_at || '') || null,
        source: 'supabase',
      };
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
  const updatedAt = new Date().toISOString();
  inMemoryUiStateByScope.set(normalizedScope, sanitizedValues);

  if (!isSupabaseConfigured()) {
    return { values: { ...sanitizedValues }, source: 'memory', updatedAt };
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
      updated_at: updatedAt,
    };

    const { error } = await client.from(SUPABASE_STATE_TABLE).upsert(row, {
      onConflict: 'state_key',
    });

    if (error) {
      const fallback = await upsertSupabaseRowViaRest(row);
      if (!fallback.ok) {
        console.error('[UI State][Supabase][SetError]', error.message || error);
        return { values: { ...sanitizedValues }, source: 'memory', updatedAt };
      }
      return { values: { ...sanitizedValues }, source: 'supabase', updatedAt };
    }

    return { values: { ...sanitizedValues }, source: 'supabase', updatedAt };
  } catch (error) {
    console.error('[UI State][Supabase][SetCrash]', error?.message || error);
    return { values: { ...sanitizedValues }, source: 'memory', updatedAt };
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
      const normalizedSpeaker = speaker.toLowerCase();
      if (normalizedSpeaker === 'system') return '';

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

function removeSystemOnlyTranscriptText(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';

  const lowered = normalized.toLowerCase();
  const hasSystem = /\bsystem\s*:/.test(lowered);
  const hasSpokenTurn = /\b(?:user|assistant|bot|ai|customer|caller|human)\s*:/.test(lowered);
  if (hasSystem && !hasSpokenTurn) {
    return '';
  }

  return normalized;
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
      const cleaned = removeSystemOnlyTranscriptText(candidate);
      if (cleaned) {
        return truncateText(cleaned, maxLength);
      }
      continue;
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
  }).map((candidate) => removeSystemOnlyTranscriptText(candidate)).filter(Boolean);
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

function normalizeIsoTimestamp(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
}

function looksLikeAudioUrl(value) {
  const raw = normalizeString(value);
  return /^https?:\/\//i.test(raw) || /^data:audio\//i.test(raw);
}

function extractTimestampFromVapiPayload(payload, directPaths, keyRegex) {
  for (const path of directPaths) {
    const normalized = normalizeIsoTimestamp(getByPath(payload, path));
    if (normalized) return normalized;
  }

  const candidates = collectStringValuesByKey(payload, keyRegex, {
    maxItems: 10,
    minLength: 10,
  });

  for (const candidate of candidates) {
    const normalized = normalizeIsoTimestamp(candidate);
    if (normalized) return normalized;
  }

  return '';
}

function extractCallStartedAt(payload) {
  return extractTimestampFromVapiPayload(
    payload,
    ['message.call.startedAt', 'call.startedAt', 'message.startedAt', 'startedAt'],
    /startedat|starttime|start(ed)?/i
  );
}

function extractCallEndedAt(payload) {
  return extractTimestampFromVapiPayload(
    payload,
    ['message.call.endedAt', 'call.endedAt', 'message.endedAt', 'endedAt'],
    /endedat|endtime|end(ed)?/i
  );
}

function extractCallDurationSeconds(payload) {
  const directPaths = [
    'message.call.durationSeconds',
    'message.call.duration',
    'message.call.artifact.durationSeconds',
    'message.call.artifact.duration',
    'call.durationSeconds',
    'call.duration',
    'message.durationSeconds',
    'message.duration',
    'durationSeconds',
    'duration',
  ];

  for (const path of directPaths) {
    const numeric = parseNumberSafe(getByPath(payload, path), null);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    if (numeric > 86400 && numeric < 86400000) {
      return Math.max(1, Math.round(numeric / 1000));
    }
    if (numeric <= 86400) {
      return Math.max(1, Math.round(numeric));
    }
  }

  const startedAt = extractCallStartedAt(payload);
  const endedAt = extractCallEndedAt(payload);
  const startTs = Date.parse(startedAt);
  const endTs = Date.parse(endedAt);
  if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs) {
    return Math.max(1, Math.round((endTs - startTs) / 1000));
  }

  return null;
}

function extractCallRecordingUrl(payload) {
  const directPaths = [
    'message.call.recordingUrl',
    'message.call.recording.url',
    'message.call.artifact.recordingUrl',
    'message.call.artifact.recording.url',
    'message.artifact.recordingUrl',
    'message.artifact.recording.url',
    'call.recordingUrl',
    'call.recording.url',
    'call.artifact.recordingUrl',
    'call.artifact.recording.url',
    'recordingUrl',
    'audioUrl',
    'mediaUrl',
  ];

  for (const path of directPaths) {
    const value = normalizeString(getByPath(payload, path));
    if (looksLikeAudioUrl(value)) return value;
  }

  const candidates = collectStringValuesByKey(payload, /recording|audio|media/i, {
    maxItems: 20,
    minLength: 8,
  });

  return candidates.find((candidate) => looksLikeAudioUrl(candidate)) || '';
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
  const startedAt = extractCallStartedAt(payload);
  const endedAt = extractCallEndedAt(payload);
  const durationSeconds = extractCallDurationSeconds(payload);
  const recordingUrl = extractCallRecordingUrl(payload);

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
    startedAt,
    endedAt,
    durationSeconds,
    recordingUrl,
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
        startedAt: update.startedAt || existing.startedAt || '',
        endedAt: update.endedAt || existing.endedAt || '',
        durationSeconds:
          Number.isFinite(Number(update.durationSeconds)) && Number(update.durationSeconds) > 0
            ? Math.round(Number(update.durationSeconds))
            : Number.isFinite(Number(existing.durationSeconds)) && Number(existing.durationSeconds) > 0
              ? Math.round(Number(existing.durationSeconds))
              : null,
        recordingUrl: update.recordingUrl || existing.recordingUrl || '',
        provider: update.provider || existing.provider || '',
        messageType: update.messageType || existing.messageType || '',
        updatedAt: update.updatedAt,
        updatedAtMs: update.updatedAtMs,
      }
    : update;

  if (!isCallUpdateVisibleForHistory(merged)) {
    const existingIndex = recentCallUpdates.findIndex((item) => item.callId === merged.callId);
    if (existingIndex >= 0) {
      recentCallUpdates.splice(existingIndex, 1);
    }
    callUpdatesById.delete(merged.callId);
    return null;
  }

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

function normalizePhoneComparisonKey(input) {
  const raw = normalizeString(input);
  if (!raw) return '';

  try {
    return normalizeNlPhoneToE164(raw).replace(/\D/g, '');
  } catch {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0031') && digits.length === 13) {
      return `31${digits.slice(4)}`;
    }
    if (digits.startsWith('31') && digits.length === 11) {
      return digits;
    }
    if (digits.startsWith('0') && digits.length === 10) {
      return `31${digits.slice(1)}`;
    }
    if (digits.length === 9 && digits.startsWith('6')) {
      return `31${digits}`;
    }
    return digits;
  }
}

function getConfiguredBlockedColdcallingTargetKeys() {
  const rawValues = [
    process.env.COLDCALLING_BLOCKED_TARGET_NUMBERS,
    process.env.ELEVENLABS_OUTBOUND_CALLER_NUMBER,
    process.env.TWILIO_OUTBOUND_CALLER_NUMBER,
    process.env.COMPANY_PHONE_NUMBER,
    process.env.SOFTORA_PHONE_NUMBER,
  ];

  const keys = new Set();
  rawValues
    .flatMap((value) => String(value || '').split(/[\n,;]+/))
    .map((value) => normalizePhoneComparisonKey(value))
    .filter(Boolean)
    .forEach((value) => keys.add(value));

  return keys;
}

function buildBlockedColdcallingLeadResult(lead, index) {
  return {
    index,
    success: false,
    lead: {
      name: normalizeString(lead?.name),
      company: normalizeString(lead?.company),
      phone: normalizeString(lead?.phone),
      region: normalizeString(lead?.region),
    },
    error: 'Doelnummer is geblokkeerd.',
    cause: 'blocked target number',
    causeExplanation:
      'Dit nummer is geblokkeerd als doelnummer zodat je eigen lijn alleen uitbelt en nooit zelf door een campagne wordt gebeld.',
    details: {
      blockedPhone: normalizeString(lead?.phone),
    },
  };
}

function filterBlockedColdcallingLeads(leads) {
  const blockedKeys = getConfiguredBlockedColdcallingTargetKeys();
  if (blockedKeys.size === 0) {
    return {
      allowedLeads: Array.isArray(leads) ? leads.slice() : [],
      blockedResults: [],
    };
  }

  const allowedLeads = [];
  const blockedResults = [];

  (Array.isArray(leads) ? leads : []).forEach((lead, index) => {
    const phoneKey = normalizePhoneComparisonKey(lead?.phone);
    if (phoneKey && blockedKeys.has(phoneKey)) {
      blockedResults.push(buildBlockedColdcallingLeadResult(lead, index));
      return;
    }
    allowedLeads.push(lead);
  });

  return { allowedLeads, blockedResults };
}

function getRequiredVapiEnv() {
  return ['VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID'];
}

function isVapiColdcallingConfigured() {
  return getRequiredVapiEnv().every((key) => normalizeString(process.env[key]));
}

function getRequiredElevenLabsEnv() {
  return ['ELEVENLABS_API_KEY', 'ELEVENLABS_PHONE_NUMBER_ID', 'ELEVENLABS_AGENT_ID'];
}

function getRequiredVapiColdcallingElevenLabsEnv() {
  return ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID'];
}

function getConfiguredElevenLabsAgentId() {
  return normalizeString(process.env.ELEVENLABS_AGENT_ID);
}

function normalizeColdcallingBackgroundSound(value) {
  const raw = normalizeString(value);
  if (!raw) return 'office';
  if (/^(0|false|no|nee|off|disabled|none)$/i.test(raw)) return 'off';
  if (/^(office|kantoor)$/i.test(raw)) return 'office';
  if (/^https?:\/\//i.test(raw)) return raw;
  return 'office';
}

function getConfiguredColdcallingBackgroundSound() {
  return normalizeColdcallingBackgroundSound(
    process.env.COLDCALLING_BACKGROUND_SOUND || process.env.VAPI_BACKGROUND_SOUND || 'office'
  );
}

function isContinuousColdcallingBackgroundSoundEnabled() {
  return getConfiguredColdcallingBackgroundSound() !== 'off';
}

function normalizeElevenLabsToolCallSound(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized || /^(0|false|off|disabled|none)$/.test(normalized)) {
    return '';
  }

  if (normalized === 'typing' || normalized === 'office' || normalized === 'office_typing') {
    return 'typing';
  }

  const elevatorMatch = normalized.match(/^elevator(?:_music)?_?([1-4])$/);
  if (elevatorMatch) {
    return `elevator_music_${elevatorMatch[1]}`;
  }

  return 'typing';
}

function normalizeElevenLabsToolCallSoundBehavior(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized) return 'always';
  if (normalized === 'always' || normalized === 'always_play' || normalized === 'alwaysplay') {
    return 'always';
  }
  if (
    normalized === 'auto' ||
    normalized === 'with_pre_speech' ||
    normalized === 'with_prespeech' ||
    normalized === 'prespeech' ||
    normalized === 'pre_speech'
  ) {
    return 'auto';
  }

  return 'always';
}

function getConfiguredElevenLabsToolCallSound() {
  return normalizeElevenLabsToolCallSound(
    process.env.ELEVENLABS_TOOL_CALL_SOUND ||
      process.env.ELEVENLABS_AGENT_TOOL_CALL_SOUND ||
      'typing'
  );
}

function getConfiguredElevenLabsToolCallSoundBehavior() {
  return normalizeElevenLabsToolCallSoundBehavior(
    process.env.ELEVENLABS_TOOL_CALL_SOUND_BEHAVIOR ||
      process.env.ELEVENLABS_AGENT_TOOL_CALL_SOUND_BEHAVIOR ||
      'always'
  );
}

function isElevenLabsToolCallSoundSyncEnabled() {
  return !/^(0|false|no|nee|off|disabled)$/i.test(
    normalizeString(
      process.env.ELEVENLABS_TOOL_CALL_SOUND_SYNC ||
        process.env.ELEVENLABS_AGENT_TOOL_CALL_SOUND_SYNC ||
        'true'
    )
  );
}

function isElevenLabsColdcallingConfigured() {
  return getRequiredElevenLabsEnv().every((key) => normalizeString(process.env[key]));
}

function getColdcallingProvider() {
  const configured = normalizeString(process.env.COLDCALLING_PROVIDER).toLowerCase();
  if (isContinuousColdcallingBackgroundSoundEnabled() && isVapiColdcallingConfigured()) {
    return 'vapi';
  }
  if (configured === 'elevenlabs') return 'elevenlabs';
  if (configured === 'vapi') return 'vapi';
  if (isElevenLabsColdcallingConfigured()) return 'elevenlabs';
  return 'vapi';
}

function getMissingEnvVars(provider = getColdcallingProvider()) {
  if (provider === 'elevenlabs') {
    return getRequiredElevenLabsEnv().filter((key) => !process.env[key]);
  }
  if (provider === 'vapi') {
    return [...getRequiredVapiEnv(), ...getRequiredVapiColdcallingElevenLabsEnv()].filter(
      (key, index, list) => !process.env[key] && list.indexOf(key) === index
    );
  }
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

function getAnthropicApiKey() {
  return normalizeString(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

function getWebsiteAnthropicModel() {
  const candidates = [
    normalizeString(process.env.WEBSITE_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_WEBSITE_MODEL || ''),
    normalizeString(WEBSITE_ANTHROPIC_MODEL || ''),
    normalizeString(process.env.ANTHROPIC_MODEL || ''),
    normalizeString(process.env.CLAUDE_MODEL || ''),
    normalizeString(ANTHROPIC_MODEL || ''),
    'claude-opus-4-6',
  ];
  return candidates.find((value) => Boolean(value)) || 'claude-opus-4-6';
}

function getWebsiteGenerationProvider() {
  if (WEBSITE_GENERATION_PROVIDER === 'anthropic' || WEBSITE_GENERATION_PROVIDER === 'claude') {
    return 'anthropic';
  }
  if (WEBSITE_GENERATION_PROVIDER === 'openai') {
    return 'openai';
  }
  return getAnthropicApiKey() ? 'anthropic' : 'openai';
}

function extractAnthropicTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (Array.isArray(part.content)) return extractAnthropicTextContent(part.content);
        if (part.type === 'text') return normalizeString(part.text || '');
        return normalizeString(part.text || part.content || '');
      })
      .filter(Boolean)
      .join('\n');
  }

  if (content && typeof content === 'object') {
    if (Array.isArray(content.content)) return extractAnthropicTextContent(content.content);
    return normalizeString(content.text || content.content || '');
  }

  return '';
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
    60000
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

async function generateWebsitePromptFromTranscriptWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 20000);
  if (!transcript) {
    const err = new Error('Transcript ontbreekt');
    err.status = 400;
    throw err;
  }

  const language = normalizeString(options.language || 'nl') || 'nl';
  const context = truncateText(normalizeString(options.context || ''), 2000);

  const systemPrompt = [
    'Je bent een senior digital strategist en prompt engineer.',
    'Taak: zet een gesprekstranscript om naar EEN direct uitvoerbare prompt voor een AI die websites bouwt.',
    'Belangrijk:',
    '- Gebruik alleen feiten uit transcriptie/context, verzin niets.',
    '- Als info ontbreekt, gebruik placeholders in vorm [VUL IN: ...].',
    '- Output alleen de prompttekst, zonder markdown fences of extra uitleg.',
    '- Schrijf in duidelijke professionele taal in de gevraagde taal.',
  ].join('\n');

  const userPrompt = [
    `Taal: ${language}`,
    '',
    'Maak een complete prompt met deze secties en volgorde:',
    '1) Rol en doel van de website-AI',
    '2) Bedrijfscontext',
    '3) Doelgroep(en)',
    '4) Hoofddoel + conversiedoelen',
    '5) Paginastructuur (navigatie + secties per pagina)',
    '6) Copy-richting per sectie',
    '7) Designrichting (stijl, kleur, typografie, tone-of-voice)',
    '8) Functionaliteit (formulieren, CTA, contact, eventuele integraties)',
    '9) SEO-basis (title, meta, headings, keywords, interne links)',
    '10) Technische eisen (performance, mobile-first, toegankelijkheid)',
    '11) Opleverchecklist',
    '',
    'Regels voor nauwkeurigheid:',
    '- Gebruik concrete details uit de transcriptie waar beschikbaar.',
    '- Houd placeholders zichtbaar voor alles wat ontbreekt.',
    '- Schrijf zo dat de prompt direct in een AI website-builder geplakt kan worden.',
    context ? `- Extra context: ${context}` : '',
    '',
    'Transcriptie bron:',
    transcript,
  ]
    .filter(Boolean)
    .join('\n');

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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    30000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI prompt generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const prompt = normalizeString(extractOpenAiTextContent(content));
  if (!prompt) {
    const err = new Error('OpenAI gaf een lege prompt terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    prompt: truncateText(prompt, 12000),
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    language,
  };
}

function buildWebsitePromptFallback(options = {}) {
  const language = normalizeString(options.language || 'nl') || 'nl';
  const context = truncateText(normalizeString(options.context || ''), 2000);
  const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 12000);

  const headerNl = [
    'ROL',
    'Je bent een senior webdesigner + conversion copywriter + front-end developer.',
    '',
    'DOEL',
    'Bouw een conversiegerichte website op basis van de transcriptie hieronder.',
    'Gebruik alleen feiten uit de transcriptie. Als iets ontbreekt: gebruik [VUL IN: ...].',
    '',
    'OUTPUTVORM',
    'Lever concreet op in deze volgorde:',
    '1) Merkprofiel (bedrijf, dienst, propositie)',
    '2) Doelgroepen + pijnpunten',
    '3) Sitemap met pagina-doelen',
    '4) Wireframe per pagina (secties in volgorde)',
    '5) Definitieve copy per sectie',
    '6) Designrichting (kleur, typografie, sfeer, beeldstijl)',
    '7) Conversie-elementen (CTA, formulieren, vertrouwen)',
    '8) Technische bouwinstructies (responsive, performance, toegankelijkheid)',
    '9) SEO-basis (title, meta, H1-H3, keywords)',
    '10) TODO-lijst met open vragen [VUL IN: ...]',
    '',
    context ? `EXTRA CONTEXT\n${context}\n` : '',
    'BRONTRANSCRIPTIE (LETTERLIJK)',
    transcript || '[VUL IN: transcriptie ontbreekt]',
  ];

  if (language.toLowerCase().startsWith('en')) {
    return [
      'ROLE',
      'You are a senior web designer + conversion copywriter + front-end developer.',
      '',
      'GOAL',
      'Build a conversion-focused website from the transcript below.',
      'Use only facts from the transcript. If something is missing: use [FILL IN: ...].',
      '',
      'OUTPUT FORMAT',
      'Deliver in this order:',
      '1) Brand profile',
      '2) Target audiences + pain points',
      '3) Sitemap with page goals',
      '4) Wireframe per page',
      '5) Final copy per section',
      '6) Design direction',
      '7) Conversion elements',
      '8) Technical build instructions',
      '9) SEO basics',
      '10) Open questions [FILL IN: ...]',
      '',
      context ? `EXTRA CONTEXT\n${context}\n` : '',
      'SOURCE TRANSCRIPT (VERBATIM)',
      transcript || '[FILL IN: missing transcript]',
    ].join('\n');
  }

  return headerNl.join('\n');
}

function stripHtmlCodeFence(text) {
  const raw = normalizeString(text || '');
  if (!raw) return '';
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return fenced ? normalizeString(fenced[1]) : raw;
}

function ensureHtmlDocument(rawHtml, meta = {}) {
  const text = stripHtmlCodeFence(rawHtml);
  if (!text) return '';

  if (/<html[\s>]/i.test(text) && /<body[\s>]/i.test(text)) {
    return clipText(text, 200000);
  }

  const title = truncateText(normalizeString(meta.title || meta.company || 'Generated Website'), 120);
  const bodyContent = text;
  const wrapped = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title || 'Generated Website'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; padding: 0; }
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
  return clipText(wrapped, 200000);
}

function ensureStrictAnthropicHtml(rawHtml) {
  const text = stripHtmlCodeFence(rawHtml);
  if (!text) return '';
  const trimmed = clipText(text, 200000);
  const hasHtmlRoot = /<html[\s>]/i.test(trimmed) && /<body[\s>]/i.test(trimmed);
  if (!hasHtmlRoot) return '';
  return trimmed;
}

function extractVisibleTextFromHtml(html) {
  const raw = normalizeString(html || '');
  if (!raw) return '';
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyUsableWebsiteHtml(html) {
  const raw = normalizeString(html || '');
  if (!raw) return false;
  const lower = raw.toLowerCase();

  const semanticCount = (lower.match(/<(header|main|section|footer|nav|form)\b/g) || []).length;
  const ctaCount = (lower.match(/<(a|button)\b/g) || []).length;
  const headingCount = (lower.match(/<h[1-4]\b/g) || []).length;
  const textLen = extractVisibleTextFromHtml(raw).length;

  return semanticCount >= 3 && ctaCount >= 2 && headingCount >= 2 && textLen >= 180;
}

function getOpenAiModelCostRates(model) {
  const explicitInput = Number(process.env.OPENAI_COST_INPUT_PER_1M || '');
  const explicitOutput = Number(process.env.OPENAI_COST_OUTPUT_PER_1M || '');
  if (Number.isFinite(explicitInput) && Number.isFinite(explicitOutput) && explicitInput >= 0 && explicitOutput >= 0) {
    return { inputPer1mUsd: explicitInput, outputPer1mUsd: explicitOutput, source: 'env' };
  }

  const key = normalizeString(model || OPENAI_MODEL).toLowerCase();
  if (key.includes('gpt-5-mini')) return { inputPer1mUsd: 0.25, outputPer1mUsd: 2.0, source: 'default-mini' };
  if (key.includes('gpt-5-nano')) return { inputPer1mUsd: 0.05, outputPer1mUsd: 0.4, source: 'default-nano' };
  if (key.includes('gpt-5')) return { inputPer1mUsd: 1.25, outputPer1mUsd: 10.0, source: 'default-gpt5' };
  if (key.includes('gpt-4.1-mini')) return { inputPer1mUsd: 0.4, outputPer1mUsd: 1.6, source: 'default-4.1-mini' };
  if (key.includes('gpt-4.1')) return { inputPer1mUsd: 2.0, outputPer1mUsd: 8.0, source: 'default-4.1' };
  if (key.includes('gpt-4o-mini')) return { inputPer1mUsd: 0.15, outputPer1mUsd: 0.6, source: 'default-4o-mini' };
  return { inputPer1mUsd: 1.0, outputPer1mUsd: 4.0, source: 'default-generic' };
}

function buildOpenAiCostEstimate({ promptTokens, completionTokens, totalTokens, model, method = 'usage' }) {
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens) || promptTokens < 0 || completionTokens < 0) {
    return null;
  }

  const rates = getOpenAiModelCostRates(model);
  const usdToEur = Number(process.env.OPENAI_COST_USD_TO_EUR || 0.92);
  const safeUsdToEur = Number.isFinite(usdToEur) && usdToEur > 0 ? usdToEur : 0.92;

  const inputUsd = (promptTokens / 1_000_000) * rates.inputPer1mUsd;
  const outputUsd = (completionTokens / 1_000_000) * rates.outputPer1mUsd;
  const totalUsd = inputUsd + outputUsd;
  const totalEur = totalUsd * safeUsdToEur;

  return {
    model: normalizeString(model || OPENAI_MODEL),
    promptTokens: Math.round(promptTokens),
    completionTokens: Math.round(completionTokens),
    totalTokens: Number.isFinite(totalTokens)
      ? Math.round(totalTokens)
      : Math.round(promptTokens + completionTokens),
    usd: Number(totalUsd.toFixed(8)),
    eur: Number(totalEur.toFixed(8)),
    rates,
    usdToEur: safeUsdToEur,
    estimated: true,
    method,
  };
}

function estimateTokenCountFromText(value) {
  const text = normalizeString(value || '');
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateOpenAiUsageCost(usage, model) {
  if (!usage || typeof usage !== 'object') return null;
  const hasTokenSignal = [
    usage.prompt_tokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.inputTokens,
    usage.completion_tokens,
    usage.output_tokens,
    usage.completionTokens,
    usage.outputTokens,
    usage.total_tokens,
    usage.totalTokens,
  ].some((value) => Number.isFinite(Number(value)));
  if (!hasTokenSignal) return null;

  const promptTokens = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0
  );
  const completionTokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0
  );
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens);
  if (
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    promptTokens < 0 ||
    completionTokens < 0
  ) {
    return null;
  }

  return buildOpenAiCostEstimate({
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    method: 'usage',
  });
}

function estimateOpenAiTextCost(inputText, outputText, model) {
  const promptTokens = estimateTokenCountFromText(inputText);
  const completionTokens = estimateTokenCountFromText(outputText);
  if (promptTokens <= 0 && completionTokens <= 0) return null;
  return buildOpenAiCostEstimate({
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    model,
    method: 'text-fallback',
  });
}

function getAnthropicModelCostRates(model) {
  const explicitInput = Number(process.env.ANTHROPIC_COST_INPUT_PER_1M || '');
  const explicitOutput = Number(process.env.ANTHROPIC_COST_OUTPUT_PER_1M || '');
  if (Number.isFinite(explicitInput) && Number.isFinite(explicitOutput) && explicitInput >= 0 && explicitOutput >= 0) {
    return { inputPer1mUsd: explicitInput, outputPer1mUsd: explicitOutput, source: 'env' };
  }

  const key = normalizeString(model || ANTHROPIC_MODEL).toLowerCase();
  if (key.includes('claude-opus-4-6')) {
    return { inputPer1mUsd: 5, outputPer1mUsd: 25, source: 'default-opus-4.6' };
  }
  if (key.includes('claude-opus')) return { inputPer1mUsd: 15, outputPer1mUsd: 75, source: 'default-opus' };
  if (key.includes('claude-sonnet')) return { inputPer1mUsd: 3, outputPer1mUsd: 15, source: 'default-sonnet' };
  if (key.includes('claude-haiku')) return { inputPer1mUsd: 0.8, outputPer1mUsd: 4, source: 'default-haiku' };
  return null;
}

function buildAnthropicCostEstimate({ promptTokens, completionTokens, totalTokens, model, method = 'usage' }) {
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens) || promptTokens < 0 || completionTokens < 0) {
    return null;
  }

  const rates = getAnthropicModelCostRates(model);
  if (!rates) return null;

  const usdToEur = Number(process.env.AI_COST_USD_TO_EUR || process.env.OPENAI_COST_USD_TO_EUR || 0.92);
  const safeUsdToEur = Number.isFinite(usdToEur) && usdToEur > 0 ? usdToEur : 0.92;

  const inputUsd = (promptTokens / 1_000_000) * rates.inputPer1mUsd;
  const outputUsd = (completionTokens / 1_000_000) * rates.outputPer1mUsd;
  const totalUsd = inputUsd + outputUsd;
  const totalEur = totalUsd * safeUsdToEur;

  return {
    model: normalizeString(model || ANTHROPIC_MODEL),
    promptTokens: Math.round(promptTokens),
    completionTokens: Math.round(completionTokens),
    totalTokens: Number.isFinite(totalTokens)
      ? Math.round(totalTokens)
      : Math.round(promptTokens + completionTokens),
    usd: Number(totalUsd.toFixed(8)),
    eur: Number(totalEur.toFixed(8)),
    rates,
    usdToEur: safeUsdToEur,
    estimated: true,
    method,
  };
}

function estimateAnthropicUsageCost(usage, model) {
  if (!usage || typeof usage !== 'object') return null;
  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0);
  const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens);
  if (
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    promptTokens < 0 ||
    completionTokens < 0
  ) {
    return null;
  }

  return buildAnthropicCostEstimate({
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    method: 'usage',
  });
}

function estimateAnthropicTextCost(inputText, outputText, model) {
  const promptTokens = estimateTokenCountFromText(inputText);
  const completionTokens = estimateTokenCountFromText(outputText);
  if (promptTokens <= 0 && completionTokens <= 0) return null;
  return buildAnthropicCostEstimate({
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    model,
    method: 'text-fallback',
  });
}

function inferWebsiteIndustryProfile(context = {}) {
  const sourceText = [
    normalizeString(context.company || ''),
    normalizeString(context.title || ''),
    normalizeString(context.description || ''),
    normalizeString(context.promptText || ''),
  ]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();

  const profiles = [
    {
      key: 'hair_salon',
      pattern: /\b(kapper|kapsalon|barber|barbershop|hairstyl|haarstudio|salon)\b/i,
      label: 'Kapsalon / barber',
      audience:
        'Lokale bezoekers die snel vertrouwen willen voelen en direct een afspraak willen boeken.',
      offers:
        'Knippen, kleuren, stylen, baardverzorging, advies, arrangementen en terugkerende afspraken.',
      style:
        'Editorial, verzorgd, premium maar toegankelijk, met tastbare sfeer en een modieuze uitstraling.',
      trust:
        'Laat openingstijden, locatie, service-overzicht, reviews, voor/na-proof of klantgericht vakmanschap duidelijk terugkomen.',
      cta: 'Plan een afspraak',
    },
    {
      key: 'restaurant',
      pattern: /\b(restaurant|bistro|brasserie|cafe|café|horeca|lunchroom|eten|menu)\b/i,
      label: 'Restaurant / horeca',
      audience: 'Bezoekers die sfeer, menukeuze en praktische info razendsnel willen begrijpen.',
      offers: 'Menu, specialiteiten, reserveren, openingstijden, locatie, groepsmogelijkheden.',
      style: 'Sfeervol, smaakvol, warm en gastvrij met duidelijke hiërarchie en ambiance.',
      trust: 'Laat sfeer, specialiteiten, locatie, openingstijden en reserverings-CTA sterk landen.',
      cta: 'Reserveer nu',
    },
    {
      key: 'construction',
      pattern: /\b(aannemer|bouw|verbouw|renovatie|schilder|klus|dak|installatie|timmer)\b/i,
      label: 'Bouw / vakwerk',
      audience:
        'Huiseigenaren en bedrijven die betrouwbaarheid, aanpak en tastbaar vakmanschap willen zien.',
      offers: 'Projecttypen, werkwijze, offerte-aanvraag, servicegebied, referenties, garanties.',
      style: 'Stevig, betrouwbaar, helder en professioneel met veel structuur en vertrouwen.',
      trust: 'Gebruik een no-nonsense opbouw met proces, voorbeelden, contact en duidelijke CTA.',
      cta: 'Vraag een offerte aan',
    },
    {
      key: 'consulting',
      pattern: /\b(coach|consult|advies|consultant|marketing|agency|bureau|seo|strateg)\b/i,
      label: 'Consultancy / bureau',
      audience: 'Beslissers die snel grip willen op resultaat, expertise en vervolgstap.',
      offers: 'Diensten, trajecten, aanpak, cases, expertise, intake of strategiegesprek.',
      style: 'Scherp, modern, intelligent en conversion-first met een duidelijke premium uitstraling.',
      trust: 'Laat expertise, werkwijze, resultaat en heldere CTA’s de kern vormen.',
      cta: 'Plan een gesprek',
    },
  ];

  const matched = profiles.find((profile) => profile.pattern.test(sourceText));
  if (matched) return matched;

  return {
    key: 'local_service',
    label: 'Lokale dienstverlener',
    audience: 'Mensen die snel willen begrijpen wat het aanbod is en direct contact willen opnemen.',
    offers: 'Kernservices, voordelen, werkwijze, vertrouwen, contact en conversiegerichte CTA’s.',
    style: 'Premium, helder, eigentijds en doelgericht zonder generieke template-uitstraling.',
    trust: 'Focus op helder aanbod, sterke positionering, vertrouwen en een logische contactflow.',
    cta: 'Neem contact op',
  };
}

function buildWebsiteGenerationContext(options = {}) {
  const promptText = truncateText(normalizeString(options.prompt || ''), 40000);
  if (!promptText) {
    const err = new Error('Prompt ontbreekt voor website generatie.');
    err.status = 400;
    throw err;
  }

  const company = truncateText(normalizeString(options.company || ''), 160);
  const title = truncateText(normalizeString(options.title || ''), 200);
  const description = truncateText(normalizeString(options.description || ''), 3000);
  const language = normalizeString(options.language || 'nl') || 'nl';
  const industry = inferWebsiteIndustryProfile({ company, title, description, promptText });

  return {
    company,
    title,
    description,
    language,
    promptText,
    industry,
  };
}

function buildWebsiteGenerationPrompts(options = {}) {
  const context = buildWebsiteGenerationContext(options);
  const { company, title, description, language, promptText, industry } = context;

  const systemPrompt = [
    'Je bent een elite webdesigner, conversion strategist en senior front-end engineer.',
    'Genereer exact één volledig HTML-document met inline CSS en alleen indien functioneel nodig inline JavaScript.',
    'Werk als een art director: intentional, premium, logisch, ruimtelijk sterk en consistent.',
    'Geen markdown, geen uitleg, alleen de HTML-code.',
    'Je mag wel logische standaard-aanbodstructuur afleiden uit het type bedrijf, maar verzin geen concrete awards, adressen, reviews of claims die niet onderbouwd zijn.',
    'Voorkom generieke blokken, slordige spacing, vreemde overlaps of sections die los van elkaar voelen.',
  ].join('\n');

  const userPrompt = [
    '<website_request>',
    `<language>${escapeHtml(language)}</language>`,
    company ? `<company>${escapeHtml(company)}</company>` : '',
    title ? `<project_title>${escapeHtml(title)}</project_title>` : '',
    description ? `<project_description>${escapeHtml(description)}</project_description>` : '',
    `<industry>${escapeHtml(industry.label)}</industry>`,
    `<likely_audience>${escapeHtml(industry.audience)}</likely_audience>`,
    `<likely_offers>${escapeHtml(industry.offers)}</likely_offers>`,
    `<style_direction>${escapeHtml(industry.style)}</style_direction>`,
    `<trust_notes>${escapeHtml(industry.trust)}</trust_notes>`,
    `<primary_cta>${escapeHtml(industry.cta)}</primary_cta>`,
    '<quality_bar>',
    'Maak een premium website die voelt als maatwerk, niet als template.',
    'Zorg dat compositie, breedtes, hiërarchie, witruimte, CTA-flow en mobiele layout coherent zijn.',
    'Gebruik een duidelijk visueel systeem: sterke typografie, ritme tussen secties, onderscheidende hero en consequente componenten.',
    'Als informatie ontbreekt, vul dan geen nep-feiten in maar ontwerp de structuur slim en geloofwaardig.',
    '</quality_bar>',
    '<project_prompt>',
    promptText,
    '</project_prompt>',
    '</website_request>',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ...context,
    systemPrompt,
    userPrompt,
  };
}

function buildAnthropicWebsiteHtmlPrompts(options = {}, blueprintText = '') {
  const context = buildWebsiteGenerationContext(options);
  const { company, title, description, language, promptText } = context;

  const systemPrompt = [
    'Je bent een elite front-end designer en engineer die premium marketingwebsites bouwt.',
    'Schrijf exact één volledig HTML-document met inline CSS en alleen functioneel noodzakelijke inline JavaScript.',
    'Lever maatwerk, geen templategevoel: sterke hero, duidelijke visuele hiërarchie, ritme, compositie, contrast en polish.',
    'De pagina moet coherent zijn op desktop EN mobiel. Geen overlappende elementen, geen vreemde lege stroken, geen kapotte breedtes, geen debugtekst.',
    'De bovenkant van de site moet uitzonderlijk sterk zijn: header en hero moeten als één premium geheel voelen.',
    'Vermijd een klein los contentblok in het midden van een groot leeg vlak. Above-the-fold moet breed, intentioneel en visueel kloppend zijn.',
    'Gebruik semantische HTML, logische CTA-flow en copy die geloofwaardig blijft.',
    'Geen markdown of uitleg. Alleen HTML die begint met <!doctype html>.',
    'Voer intern eerst een kwaliteitscontrole uit op spacing, alignment, section flow, readability, responsiveness en visuele consistentie voordat je antwoordt.',
  ].join('\n');

  const userPrompt = [
    '<website_build_request>',
    `<language>${escapeHtml(language)}</language>`,
    company ? `<company>${escapeHtml(company)}</company>` : '',
    title ? `<project_title>${escapeHtml(title)}</project_title>` : '',
    description ? `<project_description>${escapeHtml(description)}</project_description>` : '',
    '<source_prompt>',
    promptText,
    '</source_prompt>',
    '<approved_blueprint>',
    blueprintText,
    '</approved_blueprint>',
    '<build_rules>',
    '- Bouw een premium single-page marketingwebsite tenzij de brief expliciet meerdere pagina’s vereist.',
    '- Gebruik een duidelijke container-structuur en consistente max-widths.',
    '- Geef elke sectie een heldere functie; geen willekeurige kaarten of losse blokken.',
    '- Zorg dat de hero visueel royaal is en de bovenkant van de pagina overtuigend opent.',
    '- Laat header en hero dezelfde sfeer delen; geen top die voelt alsof componenten uit verschillende templates komen.',
    '- Vermijd een smalle gecentreerde hero-card op een willekeurige achtergrond tenzij de briefing dat expliciet vraagt.',
    '- Laat navigatie, hero, aanbod, vertrouwen, over-ons, contact en footer als één logisch verhaal voelen.',
    '- Gebruik onderscheidende maar betrouwbare typografie en een kleurpalet dat past bij de briefing.',
    '- Geen fake testimonials, nep-statistieken of verzonnen adressen.',
    '- Contactformulier en CTA moeten visueel kloppen en logisch geplaatst zijn.',
    '- Alle content moet direct renderen zonder externe assets of libraries.',
    '</build_rules>',
    '</website_build_request>',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ...context,
    systemPrompt,
    userPrompt,
  };
}

function buildLocalWebsiteBlueprint(options = {}) {
  const context = buildWebsiteGenerationContext(options);
  const { company, title, description, industry, promptText } = context;
  const brandName = company || title || industry.label;

  return [
    '<website_blueprint>',
    `<brand_core>${escapeHtml(
      `${brandName}: premium positionering, duidelijke waardepropositie en een geloofwaardige lokale of specialistische uitstraling.`
    )}</brand_core>`,
    `<audience>${escapeHtml(industry.audience)}</audience>`,
    `<conversion_goal>${escapeHtml(
      `Primaire conversie: ${industry.cta}. Secundair: vertrouwen opbouwen en contact laagdrempelig maken.`
    )}</conversion_goal>`,
    `<art_direction>${escapeHtml(
      `${industry.style} Werk met een duidelijke hero-compositie, sterke typografie, ritme tussen secties en een kleurpalet dat premium voelt zonder onlogisch te worden. Laat de bovenkant breed, rijk en samenhangend openen in plaats van als een klein los blok te voelen.`
    )}</art_direction>`,
    `<page_structure>${escapeHtml(
      'Header/navigatie, hero met kernbelofte en CTA, aanbod of diensten, onderscheidend vermogen of voordelen, vertrouwen/social proof zonder nepclaims, over ons of vakmanschap, contact/afspraaksectie en footer.'
    )}</page_structure>`,
    `<section_notes>${escapeHtml(
      `Zorg dat elke sectie een eigen functie heeft. Verwerk ${industry.offers} alleen voor zover geloofwaardig binnen de prompt en hou de tekst concreet, conversiegericht en logisch opgebouwd.`
    )}</section_notes>`,
    `<content_plan>${escapeHtml(
      `Gebruik de bronprompt en projectomschrijving als primaire waarheid. Omschrijving: ${description || 'niet opgegeven'}. Verzin geen concrete feitelijke claims, adressen, cijfers of reviews. Bronprompt: ${promptText}`
    )}</content_plan>`,
    `<quality_checks>${escapeHtml(
      'Geen templategevoel, geen overlapping, geen slordige spacing, consistente containerbreedtes, mobiele logica, sterke CTA-flow, geloofwaardige copy, een overtuigende above-the-fold en een visueel samenhangend geheel.'
    )}</quality_checks>`,
    '</website_blueprint>',
  ].join('\n');
}

function getAnthropicWebsiteStageEffort(stage = 'build') {
  const envKey =
    stage === 'blueprint'
      ? 'ANTHROPIC_WEBSITE_BLUEPRINT_EFFORT'
      : stage === 'review'
        ? 'ANTHROPIC_WEBSITE_REVIEW_EFFORT'
        : 'ANTHROPIC_WEBSITE_BUILD_EFFORT';
  const raw = normalizeString(process.env[envKey] || '').toLowerCase();
  if (['low', 'medium', 'high', 'max'].includes(raw)) return raw;
  if (stage === 'blueprint') return 'medium';
  if (stage === 'review') return 'medium';
  return 'high';
}

function getAnthropicWebsiteStageMaxTokens(stage = 'build') {
  const envKey =
    stage === 'blueprint'
      ? 'ANTHROPIC_WEBSITE_BLUEPRINT_MAX_TOKENS'
      : stage === 'review'
        ? 'ANTHROPIC_WEBSITE_REVIEW_MAX_TOKENS'
        : 'ANTHROPIC_WEBSITE_MAX_TOKENS';
  const fallback = stage === 'blueprint' ? 6000 : stage === 'review' ? 8000 : 12000;
  return Math.max(2000, Math.min(48000, Number(process.env[envKey] || fallback) || fallback));
}

function supportsAnthropicAdaptiveThinking(model = ANTHROPIC_MODEL) {
  const enabled = /^(1|true|yes)$/i.test(
    String(process.env.ANTHROPIC_WEBSITE_ENABLE_ADAPTIVE_THINKING || '')
  );
  if (!enabled) return false;
  const key = normalizeString(model).toLowerCase();
  return key.includes('claude-opus-4-6') || key.includes('claude-sonnet-4-6');
}

async function sendAnthropicMessage(options = {}) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const systemPrompt = normalizeString(options.systemPrompt || '');
  const userPrompt = normalizeString(options.userPrompt || '');
  if (!systemPrompt || !userPrompt) {
    const err = new Error('Anthropic prompt is onvolledig.');
    err.status = 500;
    throw err;
  }

  const maxTokens = Math.max(2000, Math.min(48000, Number(options.maxTokens || 12000) || 12000));
  const model = normalizeString(options.model || getWebsiteAnthropicModel());
  if (!model) {
    const err = new Error('Anthropic model voor website generatie ontbreekt.');
    err.status = 500;
    throw err;
  }
  const effort = getAnthropicWebsiteStageEffort(options.stage || 'build');
  const basePayload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userPrompt }],
      },
    ],
  };

  const enhancedPayload = supportsAnthropicAdaptiveThinking(model)
    ? {
        ...basePayload,
        thinking: { type: 'adaptive' },
        output_config: { effort },
      }
    : basePayload;

  const sendRequest = async (payload) =>
    fetchJsonWithTimeout(
      `${ANTHROPIC_API_BASE_URL}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': process.env.ANTHROPIC_API_VERSION || '2023-06-01',
        },
        body: JSON.stringify(payload),
      },
      WEBSITE_GENERATION_TIMEOUT_MS
    );

  let result = await sendRequest(enhancedPayload);
  if (
    !result.response.ok &&
    enhancedPayload !== basePayload &&
    Number(result.response.status) === 400
  ) {
    result = await sendRequest(basePayload);
  }

  if (!result.response.ok) {
    const err = new Error(`Anthropic website generatie mislukt (${result.response.status})`);
    err.status = result.response.status;
    err.data = result.data;
    throw err;
  }

  return result.data;
}

async function generateWebsiteHtmlWithOpenAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const { company, title, userPrompt, systemPrompt } = buildWebsiteGenerationPrompts(options);

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
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    WEBSITE_GENERATION_TIMEOUT_MS
  );

  if (!response.ok) {
    const err = new Error(`OpenAI website generatie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const generatedText = normalizeString(extractOpenAiTextContent(content));
  if (!generatedText) {
    const err = new Error('OpenAI gaf lege HTML terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  const html = ensureHtmlDocument(generatedText, { title, company });
  if (!html) {
    const err = new Error('Kon HTML output niet valideren.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    html,
    source: 'openai',
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    apiCost:
      estimateOpenAiUsageCost(data?.usage || null, OPENAI_MODEL) ||
      estimateOpenAiTextCost(userPrompt, html, OPENAI_MODEL),
  };
}

async function generateWebsiteHtmlWithAnthropic(options = {}) {
  const blueprintText = buildLocalWebsiteBlueprint(options);
  const websiteModel = getWebsiteAnthropicModel();
  const buildPrompts = buildAnthropicWebsiteHtmlPrompts(options, blueprintText);
  const htmlData = await sendAnthropicMessage({
    model: websiteModel,
    systemPrompt: buildPrompts.systemPrompt,
    userPrompt: buildPrompts.userPrompt,
    maxTokens: getAnthropicWebsiteStageMaxTokens('build'),
    stage: 'build',
  });

  const generatedText = normalizeString(extractAnthropicTextContent(htmlData?.content));
  if (!generatedText) {
    const err = new Error('Anthropic gaf lege HTML terug.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  const html = WEBSITE_GENERATION_STRICT_HTML
    ? ensureStrictAnthropicHtml(generatedText)
    : ensureHtmlDocument(generatedText, {
        title: buildPrompts.title,
        company: buildPrompts.company,
      });
  if (!html) {
    const err = new Error('Kon HTML output niet valideren.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  if (!isLikelyUsableWebsiteHtml(html)) {
    const err = new Error('AI output lijkt onvolledig of visueel defect.');
    err.status = 502;
    err.data = htmlData;
    throw err;
  }

  const resolvedModel = normalizeString(htmlData?.model || websiteModel || ANTHROPIC_MODEL);

  return {
    html,
    source: 'anthropic',
    model: resolvedModel,
    usage: htmlData?.usage || null,
    apiCost:
      estimateAnthropicUsageCost(htmlData?.usage || null, resolvedModel) ||
      estimateAnthropicTextCost(
        `${buildPrompts.userPrompt}\n\n${blueprintText}`,
        html,
        resolvedModel
      ),
  };
}

async function generateWebsiteHtmlWithAi(options = {}) {
  const provider = getWebsiteGenerationProvider();
  if (WEBSITE_GENERATION_STRICT_ANTHROPIC && provider !== 'anthropic') {
    const err = new Error('Website generatie is strict op Anthropic/Claude gezet.');
    err.status = 503;
    throw err;
  }
  if (provider === 'anthropic') {
    return generateWebsiteHtmlWithAnthropic(options);
  }
  return generateWebsiteHtmlWithOpenAi(options);
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
        postCallStatus:
          normalizeString(existing?.postCallStatus || appointment?.postCallStatus || '') || null,
        postCallNotesTranscript:
          normalizeString(
            existing?.postCallNotesTranscript || appointment?.postCallNotesTranscript || ''
          ) || null,
        postCallPrompt:
          normalizeString(existing?.postCallPrompt || appointment?.postCallPrompt || '') || null,
        postCallUpdatedAt:
          normalizeString(existing?.postCallUpdatedAt || appointment?.postCallUpdatedAt || '') || null,
        postCallUpdatedBy:
          normalizeString(existing?.postCallUpdatedBy || appointment?.postCallUpdatedBy || '') || null,
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
    postCallStatus: normalizeString(appointment?.postCallStatus || '') || null,
    postCallNotesTranscript: normalizeString(appointment?.postCallNotesTranscript || '') || null,
    postCallPrompt: normalizeString(appointment?.postCallPrompt || '') || null,
    postCallUpdatedAt: normalizeString(appointment?.postCallUpdatedAt || '') || null,
    postCallUpdatedBy: normalizeString(appointment?.postCallUpdatedBy || '') || null,
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

function normalizeEmailAddressForMatching(value) {
  const email = normalizeEmailAddress(value);
  if (!email || !email.includes('@')) return '';
  const [localRaw, domainRaw] = email.split('@');
  const local = normalizeString(localRaw);
  const domain = normalizeString(domainRaw);
  if (!local || !domain) return '';

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const noPlus = local.split('+')[0];
    const noDots = noPlus.replace(/\./g, '');
    return `${noDots}@gmail.com`;
  }

  return `${local}@${domain}`;
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
    replyTo: MAIL_REPLY_TO || MAIL_IMAP_USER || MAIL_FROM_ADDRESS || undefined,
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

function getImapMailboxesForSync() {
  const defaults = ['INBOX', 'Spam', 'Junk', 'INBOX.Spam', 'INBOX.Junk'];
  const combined = [MAIL_IMAP_MAILBOX, ...MAIL_IMAP_EXTRA_MAILBOXES, ...defaults].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const mailbox of combined) {
    const key = String(mailbox || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(mailbox || '').trim());
  }
  return out;
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

function findAppointmentIndexForInboundConfirmationMail(parsedMail, decisionInfo = null) {
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
    const normalizedFrom = normalizeEmailAddressForMatching(from.address);
    const candidates = generatedAgendaAppointments
      .map((appt, idx) => ({ appt, idx }))
      .filter(({ appt }) => appt && mapAppointmentToConfirmationTask(appt))
      .filter(({ appt }) => {
        const candidateEmail = normalizeEmailAddressForMatching(appt.contactEmail || appt.email || '');
        return Boolean(candidateEmail && normalizedFrom && candidateEmail === normalizedFrom);
      });
    if (candidates.length === 1) return candidates[0].idx;
  }

  const decision = normalizeString(decisionInfo?.decision || '');
  if (decision === 'confirm' || decision === 'cancel') {
    const fallbackCandidates = generatedAgendaAppointments
      .map((appt, idx) => ({ appt, idx }))
      .filter(({ appt }) => appt && mapAppointmentToConfirmationTask(appt))
      .filter(({ appt }) => Boolean(appt.confirmationEmailSent || appt.confirmationEmailSentAt))
      .filter(({ appt }) => {
        const sentAt = Date.parse(normalizeString(appt.confirmationEmailSentAt || ''));
        if (!Number.isFinite(sentAt)) return true;
        const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
        return Date.now() - sentAt <= maxAgeMs;
      })
      .sort((a, b) => {
        const aTs = Date.parse(normalizeString(a.appt?.confirmationEmailSentAt || '')) || 0;
        const bTs = Date.parse(normalizeString(b.appt?.confirmationEmailSentAt || '')) || 0;
        return bTs - aTs;
      });

    if (fallbackCandidates.length === 1) {
      return fallbackCandidates[0].idx;
    }
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
      mailboxes: getImapMailboxesForSync(),
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

    try {
      await client.connect();
      const mailboxList = getImapMailboxesForSync();
      for (const mailboxName of mailboxList) {
        let lock = null;
        try {
          lock = await client.getMailboxLock(mailboxName);
          const unseenUids = await client.search(['UNSEEN']);
          const allUids = await client.search(['ALL']);
          stats.unseenFound += Array.isArray(unseenUids) ? unseenUids.length : 0;

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
                stats.errors.push(
                  `Parse error mailbox=${mailboxName} uid=${message.uid}: ${truncateText(error?.message || String(error), 120)}`
                );
                continue;
              }

              const decision = detectInboundConfirmationDecision(parsedMail);
              const idx = findAppointmentIndexForInboundConfirmationMail(parsedMail, decision);
              if (idx < 0) {
                stats.ignored += 1;
                continue;
              }

              stats.matched += 1;
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
            stats.markedSeen += uidsToMarkSeen.length;
          }
        } catch (error) {
          stats.errors.push(
            `Mailbox ${mailboxName}: ${truncateText(error?.message || String(error), 180)}`
          );
        } finally {
          try {
            if (lock) lock.release();
          } catch (_) {}
        }
      }
    } catch (error) {
      stats.ok = false;
      stats.error = truncateText(error?.message || String(error), 500);
    } finally {
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

async function fetchVapiAssistant(assistantId) {
  const normalizedAssistantId = normalizeString(assistantId);
  if (!normalizedAssistantId) {
    throw new Error('Vapi assistantId ontbreekt');
  }

  const endpoints = [`/assistant/${encodeURIComponent(normalizedAssistantId)}`, `/assistants/${encodeURIComponent(normalizedAssistantId)}`];
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
        }
      );

      if (response.ok) {
        return { endpoint, data };
      }

      const statusError = new Error(
        data?.message || data?.error || data?.raw || `Vapi assistant fout (${response.status})`
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
        throw new Error('Timeout bij ophalen Vapi assistant');
      }
      if (error?.status === 404 && endpoint !== endpoints[endpoints.length - 1]) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Kon Vapi assistant niet ophalen');
}

async function getConfiguredVapiAssistant() {
  const assistantId = normalizeString(process.env.VAPI_ASSISTANT_ID);
  if (!normalizeString(process.env.VAPI_API_KEY) || !assistantId) {
    return {
      assistant: null,
      source: 'none',
    };
  }

  if (
    vapiAssistantConfigCache.assistantId === assistantId &&
    vapiAssistantConfigCache.assistant &&
    Date.now() - Number(vapiAssistantConfigCache.fetchedAtMs || 0) <
      ELEVENLABS_TOOL_CALL_SOUND_SYNC_CACHE_TTL_MS
  ) {
    return {
      assistant: cloneJsonSafe(vapiAssistantConfigCache.assistant, null),
      source: 'cache',
    };
  }

  if (vapiAssistantConfigCache.assistantId === assistantId && vapiAssistantConfigCache.promise) {
    return vapiAssistantConfigCache.promise;
  }

  const syncPromise = (async () => {
    const { data } = await fetchVapiAssistant(assistantId);
    vapiAssistantConfigCache = {
      assistantId,
      fetchedAtMs: Date.now(),
      assistant: cloneJsonSafe(data, null),
      error: '',
      promise: null,
    };

    return {
      assistant: cloneJsonSafe(data, null),
      source: 'api',
    };
  })().catch((error) => {
    vapiAssistantConfigCache = {
      assistantId,
      fetchedAtMs: Date.now(),
      assistant: null,
      error: normalizeString(error?.message || error),
      promise: null,
    };
    throw error;
  });

  vapiAssistantConfigCache = {
    ...vapiAssistantConfigCache,
    assistantId,
    promise: syncPromise,
  };

  return syncPromise;
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

function getElevenLabsConversationConfigRoot(agentData) {
  const conversationConfig =
    agentData?.conversation_config && typeof agentData.conversation_config === 'object'
      ? agentData.conversation_config
      : agentData?.conversationConfig && typeof agentData.conversationConfig === 'object'
        ? agentData.conversationConfig
        : null;
  return conversationConfig;
}

function getElevenLabsAgentConfig(agentData) {
  const conversationConfig = getElevenLabsConversationConfigRoot(agentData);
  if (!conversationConfig || typeof conversationConfig !== 'object') return null;

  if (conversationConfig.agent && typeof conversationConfig.agent === 'object') {
    return conversationConfig.agent;
  }

  if (conversationConfig.agent_config && typeof conversationConfig.agent_config === 'object') {
    return conversationConfig.agent_config;
  }

  return null;
}

function getElevenLabsPromptConfig(agentData) {
  const agentConfig = getElevenLabsAgentConfig(agentData);
  if (!agentConfig || typeof agentConfig !== 'object') return null;

  if (agentConfig.prompt && typeof agentConfig.prompt === 'object') {
    return agentConfig.prompt;
  }

  if (agentConfig.prompt_config && typeof agentConfig.prompt_config === 'object') {
    return agentConfig.prompt_config;
  }

  return null;
}

function getElevenLabsAsrConfig(agentData) {
  const conversationConfig = getElevenLabsConversationConfigRoot(agentData);
  if (!conversationConfig || typeof conversationConfig !== 'object') return null;

  if (conversationConfig.asr && typeof conversationConfig.asr === 'object') {
    return conversationConfig.asr;
  }

  if (conversationConfig.asr_config && typeof conversationConfig.asr_config === 'object') {
    return conversationConfig.asr_config;
  }

  return null;
}

function getElevenLabsTtsConfig(agentData) {
  const conversationConfig = getElevenLabsConversationConfigRoot(agentData);
  if (!conversationConfig || typeof conversationConfig !== 'object') return null;

  if (conversationConfig.tts && typeof conversationConfig.tts === 'object') {
    return conversationConfig.tts;
  }

  if (conversationConfig.tts_config && typeof conversationConfig.tts_config === 'object') {
    return conversationConfig.tts_config;
  }

  return null;
}

function getElevenLabsConversationLimitsConfig(agentData) {
  const conversationConfig = getElevenLabsConversationConfigRoot(agentData);
  if (!conversationConfig || typeof conversationConfig !== 'object') return null;

  if (conversationConfig.conversation && typeof conversationConfig.conversation === 'object') {
    return conversationConfig.conversation;
  }

  if (conversationConfig.conversation_config && typeof conversationConfig.conversation_config === 'object') {
    return conversationConfig.conversation_config;
  }

  return null;
}

function getElevenLabsAgentRuntimeSettings(agentData) {
  const agentConfig = getElevenLabsAgentConfig(agentData);
  const promptConfig = getElevenLabsPromptConfig(agentData);
  const asrConfig = getElevenLabsAsrConfig(agentData);
  const limitsConfig = getElevenLabsConversationLimitsConfig(agentData);

  return {
    firstMessage: normalizeString(agentConfig?.firstMessage || agentConfig?.first_message),
    language: normalizeString(agentConfig?.language),
    disableFirstMessageInterruptions:
      typeof (agentConfig?.disableFirstMessageInterruptions ?? agentConfig?.disable_first_message_interruptions) === 'boolean'
        ? Boolean(agentConfig?.disableFirstMessageInterruptions ?? agentConfig?.disable_first_message_interruptions)
        : null,
    promptText: normalizeString(promptConfig?.prompt),
    llm: normalizeString(promptConfig?.llm),
    temperature: parseNumberSafe(promptConfig?.temperature, null),
    maxTokens: parseNumberSafe(promptConfig?.maxTokens ?? promptConfig?.max_tokens, null),
    asrProvider: normalizeString(asrConfig?.provider),
    asrQuality: normalizeString(asrConfig?.quality),
    maxDurationSeconds: parseNumberSafe(
      limitsConfig?.maxDurationSeconds ?? limitsConfig?.max_duration_seconds,
      null
    ),
  };
}

function normalizeVapiElevenLabsVoiceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';

  const aliases = {
    eleven_v3: 'eleven_turbo_v2_5',
    eleven_v3_conversational: 'eleven_turbo_v2_5',
    eleven_flash_v2: 'eleven_flash_v2',
    eleven_flash_v2_5: 'eleven_flash_v2_5',
    eleven_flash_v25: 'eleven_flash_v2_5',
    eleven_monolingual_v1: 'eleven_monolingual_v1',
    eleven_multilingual_v2: 'eleven_multilingual_v2',
    eleven_turbo_v2: 'eleven_turbo_v2',
    eleven_turbo_v2_5: 'eleven_turbo_v2_5',
    eleven_turbo_v25: 'eleven_turbo_v2_5',
  };

  return aliases[normalized] || '';
}

function normalizeElevenLabsCustomSpeechModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'eleven_v3' || normalized === 'eleven_v3_conversational') {
    return 'eleven_v3';
  }
  return '';
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeVapiCompatibleElevenLabsLlm(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return '';

  const aliases = {
    'claude-sonnet-4': 'claude-sonnet-4-20250514',
    'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
    'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-v1': 'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-v2': 'claude-3-5-sonnet-20241022',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'claude-sonnet-4@20250514': 'claude-sonnet-4-20250514',
    'claude-sonnet-4-5@20250929': 'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5@20251001': 'claude-haiku-4-5-20251001',
    'claude-3-7-sonnet@20250219': 'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet@20240620': 'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-v2@20241022': 'claude-3-5-sonnet-20241022',
    'claude-3-haiku@20240307': 'claude-3-haiku-20240307',
    'gemini-3-pro-preview': 'gemini-2.5-pro',
    'gemini-3-flash-preview': 'gemini-2.5-flash',
    'gemini-3.1-flash-lite-preview': 'gemini-2.5-flash-lite',
    'gemini-2.5-flash-preview-09-2025': 'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-09-2025': 'gemini-2.5-flash-lite',
    'gemini-2.5-flash-preview-05-20': 'gemini-2.5-flash',
    'gemini-2.5-flash-preview-04-17': 'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-06-17': 'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite-001': 'gemini-2.0-flash-lite',
    'gemini-2.0-flash-001': 'gemini-2.0-flash',
    'gemini-1.5-flash-001': 'gemini-1.5-flash',
    'gemini-1.5-pro-001': 'gemini-1.5-pro',
    'gpt-5-2025-08-07': 'gpt-5',
    'gpt-5.1-2025-11-13': 'gpt-5.1',
    'gpt-5.2-2025-12-11': 'gpt-5.2',
    'gpt-5-mini-2025-08-07': 'gpt-5-mini',
    'gpt-5-nano-2025-08-07': 'gpt-5-nano',
    'gpt-4-0314': 'gpt-4',
  };

  if (aliases[raw]) {
    return aliases[raw];
  }

  return raw;
}

function isUndesiredColdcallingFirstMessage(value) {
  const normalized = normalizeString(value);
  if (!normalized) return true;

  return (
    /\b(?:ik|i)\s+(?:begrijp|understand|snap|volg|follow|received|gelezen)\b/i.test(normalized) &&
    /\b(?:instructies?|instructions?|prompt|rol|role|systeem|system)\b/i.test(normalized)
  ) || /\b(?:als een ai|as an ai)\b/i.test(normalized) ||
    /\b(?:how can i help you today|waarmee kan ik (?:je|u) helpen|hoe kan ik (?:je|u) helpen)\b/i.test(normalized);
}

function resolveColdcallingFirstMessage(settings) {
  const explicitFirstMessage = normalizeString(settings?.firstMessage);
  if (explicitFirstMessage && !isUndesiredColdcallingFirstMessage(explicitFirstMessage)) {
    return {
      text: explicitFirstMessage,
      source: 'elevenlabs-agent',
    };
  }

  if (explicitFirstMessage) {
    return {
      text: '',
      source: 'blocked-invalid-elevenlabs-first-message',
    };
  }

  return {
    text: '',
    source: 'wait-for-user',
  };
}

function buildVapiSafeSystemPrompt(promptText) {
  const normalizedPrompt = normalizeString(promptText);
  if (!normalizedPrompt) return '';

  const guardrail =
    'Kritieke spreekregel: benoem nooit dat je instructies, een prompt, een rol, regels of systeemtekst hebt ontvangen of begrijpt. Zeg nooit dat je de instructies begrijpt. Open altijd direct natuurlijk in karakter en in rol.';

  if (/zeg nooit dat je de instructies begrijpt|benoem nooit dat je instructies/i.test(normalizedPrompt)) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt}\n\n${guardrail}`;
}

function isSupportedVapiModelOverride(provider, model) {
  const normalizedProvider = normalizeString(provider).toLowerCase();
  const normalizedModel = normalizeString(model).toLowerCase();
  if (!normalizedProvider || !normalizedModel) return false;

  if (normalizedProvider === 'openai') {
    return /^(gpt-5(?:\.2(?:-chat-latest)?|\.1(?:-chat-latest)?|-chat-latest|-mini|-nano)?|gpt-4\.1(?:-mini|-nano)?(?:-2025-04-14)?(?:[:][a-z0-9]+)?|chatgpt-4o-latest|o3(?:-mini)?|o4-mini|o1-mini(?:-2024-09-12)?|gpt-4o-realtime-preview-2024-(10-01|12-17)|gpt-4o-mini-realtime-preview-2024-12-17|gpt-realtime-(?:2025-08-28|mini-2025-12-15)|gpt-4o-mini(?:-2024-07-18)?(?:[:][a-z0-9]+)?|gpt-4o(?:-2024-(05-13|08-06|11-20))?(?:[:][a-z0-9]+)?|gpt-4-turbo(?:-2024-04-09)?(?:[:][a-z0-9]+)?|gpt-4-turbo-preview|gpt-4-0125-preview(?:[:][a-z0-9]+)?|gpt-4-1106-preview(?:[:][a-z0-9]+)?|gpt-4(?:-0613(?:[:][a-z0-9]+)?)?|gpt-3\.5-turbo(?:-(?:0125|1106|16k|0613))?(?:[:][a-z0-9]+)?)$/.test(
      normalizedModel
    );
  }

  if (normalizedProvider === 'anthropic') {
    return new Set([
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-7-sonnet-20250219',
      'claude-opus-4-20250514',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ]).has(normalizedModel);
  }

  if (normalizedProvider === 'google') {
    return new Set([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.0-pro-exp-02-05',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-realtime-exp',
      'gemini-1.5-flash',
      'gemini-1.5-flash-002',
      'gemini-1.5-pro',
      'gemini-1.5-pro-002',
      'gemini-1.0-pro',
    ]).has(normalizedModel);
  }

  return false;
}

function mapElevenLabsLlmToVapiModel(value) {
  const llm = normalizeVapiCompatibleElevenLabsLlm(value);
  if (!llm) return null;

  if (
    llm.startsWith('gpt-') ||
    llm.startsWith('chatgpt-') ||
    /^o[134](?:-|$)/.test(llm) ||
    llm.startsWith('gpt-realtime-')
  ) {
    return {
      provider: 'openai',
      model: llm,
    };
  }

  if (llm.startsWith('claude-')) {
    return {
      provider: 'anthropic',
      model: llm,
    };
  }

  if (llm.startsWith('gemini-')) {
    return {
      provider: 'google',
      model: llm,
    };
  }

  return null;
}

function buildVapiModelOverrideFromElevenLabsAgent(agentData, fallbackModel = null) {
  const settings = getElevenLabsAgentRuntimeSettings(agentData);
  const mappedModelCandidate = mapElevenLabsLlmToVapiModel(settings.llm);
  const mappedModel =
    mappedModelCandidate &&
    isSupportedVapiModelOverride(mappedModelCandidate.provider, mappedModelCandidate.model)
      ? mappedModelCandidate
      : null;
  const nextModel =
    fallbackModel && typeof fallbackModel === 'object' ? cloneJsonSafe(fallbackModel, {}) : {};

  if (mappedModel) {
    nextModel.provider = mappedModel.provider;
    nextModel.model = mappedModel.model;
  } else if (settings.llm) {
    console.warn(
      '[Coldcalling][Unsupported ElevenLabs LLM]',
      JSON.stringify(
        {
          llm: settings.llm,
          normalizedCandidateProvider: normalizeString(mappedModelCandidate?.provider),
          normalizedCandidateModel: normalizeString(mappedModelCandidate?.model),
          fallbackProvider: normalizeString(nextModel.provider),
          fallbackModel: normalizeString(nextModel.model),
        },
        null,
        2
      )
    );
  }

  if (!normalizeString(nextModel.provider) || !normalizeString(nextModel.model)) {
    if (!mappedModel) return null;
    nextModel.provider = mappedModel.provider;
    nextModel.model = mappedModel.model;
  }

  const safePromptText = buildVapiSafeSystemPrompt(settings.promptText);
  if (safePromptText) {
    nextModel.messages = [{ role: 'system', content: safePromptText }];
  }

  if (Number.isFinite(settings.temperature)) {
    nextModel.temperature = Math.max(0, Math.min(2, Number(settings.temperature)));
  }

  if (Number.isFinite(settings.maxTokens) && Number(settings.maxTokens) > 0) {
    nextModel.maxTokens = Math.round(Number(settings.maxTokens));
  }

  if (
    !safePromptText &&
    !mappedModel &&
    !Number.isFinite(settings.temperature) &&
    !Number.isFinite(settings.maxTokens)
  ) {
    return null;
  }

  return nextModel;
}

function buildVapiTranscriberOverrideFromElevenLabsAgent(agentData, fallbackAssistant = null) {
  const fallbackTranscriber =
    fallbackAssistant?.transcriber && typeof fallbackAssistant.transcriber === 'object'
      ? cloneJsonSafe(fallbackAssistant.transcriber, {})
      : {};
  const fallbackProvider = normalizeString(fallbackTranscriber.provider).toLowerCase();
  if (fallbackProvider) {
    return fallbackTranscriber;
  }

  const settings = getElevenLabsAgentRuntimeSettings(agentData);
  const nextTranscriber = {
    provider: '11labs',
    model: 'scribe_v1',
  };
  const language = normalizeString(settings.language).toLowerCase();

  if (/^[a-z]{2,3}$/.test(language)) {
    nextTranscriber.language = language;
  }

  return nextTranscriber;
}

const VAPI_TRANSIENT_ASSISTANT_ALLOWED_KEYS = new Set([
  'credentials',
  'transcriber',
  'model',
  'voice',
  'firstMessage',
  'firstMessageInterruptionsEnabled',
  'firstMessageMode',
  'voicemailDetection',
  'clientMessages',
  'serverMessages',
  'maxDurationSeconds',
  'backgroundSound',
  'modelOutputInMessagesEnabled',
  'transportConfigurations',
  'observabilityPlan',
  'hooks',
  'name',
  'voicemailMessage',
  'endCallMessage',
  'endCallPhrases',
  'compliancePlan',
  'metadata',
  'backgroundSpeechDenoisingPlan',
  'analysisPlan',
  'artifactPlan',
  'startSpeakingPlan',
  'stopSpeakingPlan',
  'monitorPlan',
  'credentialIds',
  'server',
  'keypadInputPlan',
]);

function sanitizeVapiAssistantForTransientCall(assistant) {
  const source = assistant && typeof assistant === 'object' ? cloneJsonSafe(assistant, {}) : {};
  const nextAssistant = {};

  VAPI_TRANSIENT_ASSISTANT_ALLOWED_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    nextAssistant[key] = cloneJsonSafe(source[key], source[key]);
  });

  return nextAssistant;
}

function buildColdcallingVapiServerMessages(existingMessages) {
  const nextMessages = [];
  const seen = new Set();

  function append(value) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    nextMessages.push(normalized);
  }

  [
    'assistant.started',
    'conversation-update',
    'end-of-call-report',
    'function-call',
    'hang',
    'model-output',
    'speech-update',
    'status-update',
    'tool-calls',
    'transfer-destination-request',
    'handoff-destination-request',
    'user-interrupted',
    'voice-input',
    'transcript',
    'transcript[transcriptType="final"]',
  ].forEach(append);

  if (Array.isArray(existingMessages)) {
    existingMessages.forEach(append);
  }

  return nextMessages;
}

function buildVapiTransientAssistantForColdcalling(
  fallbackAssistant,
  runtimeAssistantConfig = {},
  syncSummary = {}
) {
  const nextAssistant = sanitizeVapiAssistantForTransientCall(fallbackAssistant);
  const runtimeConfig =
    runtimeAssistantConfig && typeof runtimeAssistantConfig === 'object'
      ? runtimeAssistantConfig
      : {};
  const normalizedFirstMessage = normalizeString(runtimeConfig.firstMessage);
  const normalizedFirstMessageMode = normalizeString(runtimeConfig.firstMessageMode);
  const firstMessageSource = normalizeString(syncSummary.firstMessageSource);

  if (runtimeConfig.model && typeof runtimeConfig.model === 'object') {
    nextAssistant.model = cloneJsonSafe(runtimeConfig.model, {});
  }

  if (runtimeConfig.transcriber && typeof runtimeConfig.transcriber === 'object') {
    nextAssistant.transcriber = cloneJsonSafe(runtimeConfig.transcriber, {});
  }

  if (runtimeConfig.voice && typeof runtimeConfig.voice === 'object') {
    nextAssistant.voice = cloneJsonSafe(runtimeConfig.voice, {});
  }

  if (Array.isArray(runtimeConfig.credentials) && runtimeConfig.credentials.length > 0) {
    nextAssistant.credentials = cloneJsonSafe(runtimeConfig.credentials, []);
  }

  if (typeof runtimeConfig.firstMessageInterruptionsEnabled === 'boolean') {
    nextAssistant.firstMessageInterruptionsEnabled =
      runtimeConfig.firstMessageInterruptionsEnabled;
  }

  if (
    Number.isFinite(Number(runtimeConfig.maxDurationSeconds)) &&
    Number(runtimeConfig.maxDurationSeconds) > 0
  ) {
    nextAssistant.maxDurationSeconds = Math.round(Number(runtimeConfig.maxDurationSeconds));
  }

  if (normalizeString(runtimeConfig.backgroundSound)) {
    nextAssistant.backgroundSound = normalizeString(runtimeConfig.backgroundSound);
  }

  if (normalizedFirstMessage) {
    nextAssistant.firstMessage = normalizedFirstMessage;
    nextAssistant.firstMessageMode =
      normalizedFirstMessageMode || 'assistant-speaks-first';
  } else if (
    firstMessageSource === 'wait-for-user' ||
    firstMessageSource === 'blocked-invalid-elevenlabs-first-message'
  ) {
    delete nextAssistant.firstMessage;
    delete nextAssistant.firstMessageMode;
  }

  nextAssistant.serverMessages = buildColdcallingVapiServerMessages(
    nextAssistant.serverMessages
  );

  return nextAssistant;
}

function buildVapiAssistantOverridesFromElevenLabsAgent(agentData, fallbackAssistant = null) {
  const settings = getElevenLabsAgentRuntimeSettings(agentData);
  const overrides = {};
  const resolvedFirstMessage = resolveColdcallingFirstMessage(settings);

  if (normalizeString(resolvedFirstMessage.text)) {
    overrides.firstMessage = resolvedFirstMessage.text;
    overrides.firstMessageMode = 'assistant-speaks-first';
  }

  if (typeof settings.disableFirstMessageInterruptions === 'boolean') {
    overrides.firstMessageInterruptionsEnabled = !settings.disableFirstMessageInterruptions;
  }

  const fallbackModel =
    fallbackAssistant?.model && typeof fallbackAssistant.model === 'object'
      ? fallbackAssistant.model
      : null;
  const modelOverride = buildVapiModelOverrideFromElevenLabsAgent(agentData, fallbackModel);
  if (modelOverride) {
    overrides.model = modelOverride;
  }

  const transcriberOverride = buildVapiTranscriberOverrideFromElevenLabsAgent(
    agentData,
    fallbackAssistant
  );
  if (transcriberOverride) {
    overrides.transcriber = transcriberOverride;
  }

  if (Number.isFinite(settings.maxDurationSeconds) && Number(settings.maxDurationSeconds) > 0) {
    overrides.maxDurationSeconds = Math.round(Number(settings.maxDurationSeconds));
  }

  return {
    overrides,
    summary: {
      syncedFirstMessage: Boolean(settings.firstMessage),
      effectiveFirstMessage: truncateText(normalizeString(overrides.firstMessage), 220),
      firstMessageSource: normalizeString(resolvedFirstMessage.source),
      firstMessageMode: normalizeString(overrides.firstMessageMode),
      syncedPrompt: Boolean(settings.promptText),
      syncedModel: Boolean(modelOverride),
      syncedTranscriber: Boolean(transcriberOverride),
      fallbackTranscriberProvider: normalizeString(transcriberOverride?.provider),
      syncedMaxDuration: Boolean(overrides.maxDurationSeconds),
      llm: settings.llm || '',
      asrProvider: settings.asrProvider || '',
      asrQuality: settings.asrQuality || '',
    },
  };
}

function buildVapiElevenLabsVoiceOverrideFromSource(source) {
  if (!source || typeof source !== 'object') return null;

  const nestedVoice =
    source.voice && typeof source.voice === 'object' && !Array.isArray(source.voice)
      ? source.voice
      : null;
  const voiceId = normalizeString(
    source.voiceId ||
      source.voice_id ||
      source.voiceID ||
      nestedVoice?.voiceId ||
      nestedVoice?.voice_id ||
      nestedVoice?.voiceID ||
      nestedVoice?.id
  );
  if (!voiceId) return null;

  const voiceOverride = {
    provider: '11labs',
    voiceId,
  };
  const stability = clampNumber(source.stability, 0, 1);
  const similarityBoost = clampNumber(
    source.similarityBoost ?? source.similarity_boost,
    0,
    1
  );
  const style = clampNumber(source.style, 0, 1);
  const speed = clampNumber(source.speed, 0.7, 1.2);
  const optimizeStreamingLatency = clampNumber(
    source.optimizeStreamingLatency ?? source.optimize_streaming_latency,
    0,
    4
  );
  const model = normalizeVapiElevenLabsVoiceModel(source.model || source.model_id);
  const language = normalizeString(source.language);
  const supportsLanguageEnforcement = model === 'eleven_turbo_v2_5';

  if (stability !== null) voiceOverride.stability = stability;
  if (similarityBoost !== null) voiceOverride.similarityBoost = similarityBoost;
  if (style !== null) voiceOverride.style = style;
  if (speed !== null) voiceOverride.speed = speed;
  if (optimizeStreamingLatency !== null) {
    voiceOverride.optimizeStreamingLatency = Math.round(optimizeStreamingLatency);
  }
  if (model) voiceOverride.model = model;
  if (language && supportsLanguageEnforcement) voiceOverride.language = language;

  const hasUseSpeakerBoost =
    Object.prototype.hasOwnProperty.call(source, 'useSpeakerBoost') ||
    Object.prototype.hasOwnProperty.call(source, 'use_speaker_boost');
  if (hasUseSpeakerBoost) {
    voiceOverride.useSpeakerBoost = toBooleanSafe(
      source.useSpeakerBoost ?? source.use_speaker_boost,
      false
    );
  }

  return voiceOverride;
}

function buildVapiElevenLabsCredentialsOverride() {
  const apiKey = normalizeString(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) return null;

  return [
    {
      provider: '11labs',
      apiKey,
      name: 'runtime-elevenlabs',
    },
  ];
}

function buildConfiguredVapiElevenLabsVoiceOverrideFromEnv() {
  return buildVapiElevenLabsVoiceOverrideFromSource({
    voiceId:
      process.env.VAPI_ELEVENLABS_VOICE_ID ||
      process.env.COLDCALLING_ELEVENLABS_VOICE_ID ||
      process.env.ELEVENLABS_VOICE_ID,
    model: process.env.VAPI_ELEVENLABS_VOICE_MODEL,
    stability: process.env.VAPI_ELEVENLABS_STABILITY,
    similarityBoost: process.env.VAPI_ELEVENLABS_SIMILARITY_BOOST,
    style: process.env.VAPI_ELEVENLABS_STYLE,
    speed: process.env.VAPI_ELEVENLABS_SPEED,
    optimizeStreamingLatency: process.env.VAPI_ELEVENLABS_OPTIMIZE_STREAMING_LATENCY,
    useSpeakerBoost: process.env.VAPI_ELEVENLABS_USE_SPEAKER_BOOST,
    language: process.env.VAPI_ELEVENLABS_LANGUAGE,
  });
}

function getPublicAppBaseUrl() {
  const configured = normalizeString(
    process.env.PUBLIC_BASE_URL ||
      process.env.APP_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
      'https://www.softora.nl'
  );
  return configured.replace(/\/+$/, '');
}

function findLikelyElevenLabsTtsConfig(value, visited = new WeakSet()) {
  if (!value || typeof value !== 'object') return null;
  if (visited.has(value)) return null;
  visited.add(value);

  if (!Array.isArray(value)) {
    if (normalizeString(value.voice_id || value.voiceId)) {
      return value;
    }

    for (const nestedValue of Object.values(value)) {
      const match = findLikelyElevenLabsTtsConfig(nestedValue, visited);
      if (match) return match;
    }
  } else {
    for (const item of value) {
      const match = findLikelyElevenLabsTtsConfig(item, visited);
      if (match) return match;
    }
  }

  return null;
}

function collectLikelyElevenLabsTtsConfigs(value, visited = new WeakSet(), results = []) {
  if (!value || typeof value !== 'object') return results;
  if (visited.has(value)) return results;
  visited.add(value);

  if (!Array.isArray(value)) {
    if (normalizeString(value.voice_id || value.voiceId || value.voiceID)) {
      results.push(value);
    }

    Object.values(value).forEach((nestedValue) => {
      collectLikelyElevenLabsTtsConfigs(nestedValue, visited, results);
    });
  } else {
    value.forEach((item) => {
      collectLikelyElevenLabsTtsConfigs(item, visited, results);
    });
  }

  return results;
}

function buildVapiElevenLabsVoiceOverrideFromAgent(agent) {
  const conversationConfig = getElevenLabsConversationConfigRoot(agent);
  if (!conversationConfig) return null;
  const explicitTtsConfig = getElevenLabsTtsConfig(agent);
  const runtimeSettings = getElevenLabsAgentRuntimeSettings(agent);
  return buildVapiElevenLabsVoiceOverrideFromSource(
    {
      ...(explicitTtsConfig || findLikelyElevenLabsTtsConfig(conversationConfig) || {}),
      language:
        normalizeString(explicitTtsConfig?.language) ||
        normalizeString(runtimeSettings.language) ||
        '',
    }
  );
}

function buildVapiCustomElevenLabsV3VoiceFromAgent(agent) {
  // Safety switch: custom v3 bridge kan audio-corruptie geven op sommige live calls.
  // Alleen activeren als deze expliciet aanstaat.
  if (!toBooleanSafe(process.env.VAPI_ENABLE_CUSTOM_ELEVENLABS_V3, true)) {
    return null;
  }

  const explicitTtsConfig = getElevenLabsTtsConfig(agent);
  const conversationConfig = getElevenLabsConversationConfigRoot(agent);
  const runtimeSettings = getElevenLabsAgentRuntimeSettings(agent);
  const sourceConfig = explicitTtsConfig || findLikelyElevenLabsTtsConfig(conversationConfig);
  const voiceId = normalizeString(
    sourceConfig?.voiceId ||
      sourceConfig?.voice_id ||
      sourceConfig?.voiceID ||
      sourceConfig?.voice?.voiceId ||
      sourceConfig?.voice?.voice_id ||
      sourceConfig?.voice?.id
  );
  const requestedModel = normalizeString(
    sourceConfig?.model ||
      sourceConfig?.model_id ||
      sourceConfig?.voice?.model ||
      sourceConfig?.voice?.model_id
  );
  const customModel = normalizeElevenLabsCustomSpeechModel(requestedModel);

  if (!voiceId || !customModel) return null;

  const params = new URLSearchParams();
  params.set('voice_id', voiceId);
  params.set('model_id', customModel);

  const languageCode =
    normalizeString(sourceConfig?.language) || normalizeString(runtimeSettings.language);
  if (languageCode) {
    params.set('language_code', languageCode);
  }

  const stability = clampNumber(sourceConfig?.stability, 0, 1);
  const similarityBoost = clampNumber(
    sourceConfig?.similarityBoost ?? sourceConfig?.similarity_boost,
    0,
    1
  );
  const style = clampNumber(sourceConfig?.style, 0, 1);
  const speed = clampNumber(sourceConfig?.speed, 0.7, 1.2);
  const useSpeakerBoost = toBooleanSafe(
    sourceConfig?.useSpeakerBoost ?? sourceConfig?.use_speaker_boost,
    false
  );

  if (stability !== null) params.set('stability', String(stability));
  if (similarityBoost !== null) params.set('similarity_boost', String(similarityBoost));
  if (style !== null) params.set('style', String(style));
  if (speed !== null) params.set('speed', String(speed));
  if (
    Object.prototype.hasOwnProperty.call(sourceConfig || {}, 'useSpeakerBoost') ||
    Object.prototype.hasOwnProperty.call(sourceConfig || {}, 'use_speaker_boost')
  ) {
    params.set('use_speaker_boost', String(useSpeakerBoost));
  }

  const server = {
    url: `${getPublicAppBaseUrl()}/api/custom-voice-elevenlabs?${params.toString()}`,
    timeoutSeconds: 40,
  };

  const webhookSecret = normalizeString(process.env.WEBHOOK_SECRET);
  if (webhookSecret) {
    server.headers = {
      'x-vapi-secret': webhookSecret,
    };
  }

  const fallbackVoice = buildVapiElevenLabsVoiceOverrideFromSource({
    ...(sourceConfig || {}),
    language: languageCode || normalizeString(sourceConfig?.language),
  });

  const customVoice = {
    provider: 'custom-voice',
    cachingEnabled: false,
    server,
  };

  if (fallbackVoice) {
    customVoice.fallbackPlan = {
      voices: [fallbackVoice],
    };
  }

  return customVoice;
}

function parseVoiceRequestSampleRate(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return 16000;
  return numeric;
}

function resolveElevenLabsOutputSampleRate(sampleRate, modelId = '') {
  const requestedRate = parseVoiceRequestSampleRate(sampleRate);
  const normalizedModelId = normalizeString(modelId).toLowerCase();

  // eleven_v3 is stabieler op 24k PCM; resample daarna lokaal naar de gevraagde sampleRate.
  if (normalizedModelId === 'eleven_v3' || normalizedModelId === 'eleven_v3_conversational') {
    return {
      requestedRate,
      sourceRate: 24000,
      outputFormat: 'pcm_24000',
    };
  }

  const supportedRates = [8000, 16000, 22050, 24000];
  if (supportedRates.includes(requestedRate)) {
    return {
      requestedRate,
      sourceRate: requestedRate,
      outputFormat: `pcm_${requestedRate}`,
    };
  }

  if (requestedRate < 16000) {
    return {
      requestedRate,
      sourceRate: 16000,
      outputFormat: 'pcm_16000',
    };
  }

  const nearestRate = supportedRates.reduce((best, current) => {
    if (Math.abs(current - requestedRate) < Math.abs(best - requestedRate)) {
      return current;
    }
    return best;
  }, 24000);

  return {
    requestedRate,
    sourceRate: nearestRate,
    outputFormat: `pcm_${nearestRate}`,
  };
}

function resamplePcm16Mono(buffer, inputRate, outputRate) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!source.length || inputRate === outputRate) return source;

  const inputSamples = Math.floor(source.length / 2);
  if (inputSamples <= 1) return source;

  const outputSamples = Math.max(1, Math.floor((inputSamples * outputRate) / inputRate));
  const output = Buffer.allocUnsafe(outputSamples * 2);

  for (let index = 0; index < outputSamples; index += 1) {
    const sourcePosition = (index * inputRate) / outputRate;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(inputSamples - 1, lowerIndex + 1);
    const mix = sourcePosition - lowerIndex;
    const lowerSample = source.readInt16LE(lowerIndex * 2);
    const upperSample = source.readInt16LE(upperIndex * 2);
    const sample = Math.max(
      -32768,
      Math.min(32767, Math.round(lowerSample + (upperSample - lowerSample) * mix))
    );
    output.writeInt16LE(sample, index * 2);
  }

  return output;
}

function buildPcm16MonoDebugSummary(buffer, sampleRate) {
  const audio = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedRate = parseVoiceRequestSampleRate(sampleRate);
  const totalSamples = Math.floor(audio.length / 2);

  if (!audio.length || totalSamples <= 0) {
    return {
      bytes: audio.length,
      sampleRate: normalizedRate,
      durationSeconds: 0,
      rms: 0,
      peakAbs: 0,
    };
  }

  let sumSquares = 0;
  let peakAbs = 0;

  for (let offset = 0; offset + 1 < audio.length; offset += 2) {
    const sample = audio.readInt16LE(offset);
    const abs = Math.abs(sample);
    if (abs > peakAbs) peakAbs = abs;
    sumSquares += sample * sample;
  }

  return {
    bytes: audio.length,
    sampleRate: normalizedRate,
    durationSeconds: Number((totalSamples / normalizedRate).toFixed(3)),
    rms: Math.round(Math.sqrt(sumSquares / totalSamples)),
    peakAbs,
  };
}

function extractPcm16MonoFromWav(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (source.length < 44) return null;
  if (source.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (source.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let formatCode = null;
  let channelCount = null;
  let bitsPerSample = null;
  let sampleRate = null;
  let dataChunk = null;

  while (offset + 8 <= source.length) {
    const chunkId = source.toString('ascii', offset, offset + 4);
    const chunkSize = source.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(source.length, chunkStart + chunkSize);

    if (chunkId === 'fmt ' && chunkStart + 16 <= source.length) {
      formatCode = source.readUInt16LE(chunkStart);
      channelCount = source.readUInt16LE(chunkStart + 2);
      sampleRate = source.readUInt32LE(chunkStart + 4);
      bitsPerSample = source.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      dataChunk = source.subarray(chunkStart, chunkEnd);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (formatCode !== 1 || channelCount !== 1 || bitsPerSample !== 16 || !dataChunk?.length) {
    return null;
  }

  return {
    pcmBuffer: dataChunk,
    sampleRate: Number(sampleRate) || 24000,
  };
}

function parseSampleRateFromOutputFormat(value) {
  const normalized = normalizeString(value).toLowerCase();
  const match = normalized.match(/_(\d{4,6})(?:_|$)/);
  if (!match) return null;
  const rate = Number(match[1]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(rate);
}

function detectAudioContainerFormat(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (source.length < 4) return 'unknown';
  if (source.toString('ascii', 0, 4) === 'RIFF' && source.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav';
  }
  if (source.toString('ascii', 0, 3) === 'ID3') {
    return 'mp3';
  }
  if (source[0] === 0xff && (source[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }
  if (source.toString('ascii', 0, 4) === 'OggS') {
    return 'ogg';
  }
  if (source.toString('ascii', 0, 4) === 'fLaC') {
    return 'flac';
  }
  if (source.length >= 8 && source.toString('ascii', 4, 8) === 'ftyp') {
    return 'mp4';
  }
  return 'unknown';
}

function decodeUlawToPcm16Mono(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const output = Buffer.allocUnsafe(source.length * 2);

  for (let index = 0; index < source.length; index += 1) {
    const ulawByte = (~source[index]) & 0xff;
    let sample = ((ulawByte & 0x0f) << 3) + 0x84;
    sample <<= (ulawByte & 0x70) >> 4;
    sample = (ulawByte & 0x80) ? 0x84 - sample : sample - 0x84;
    output.writeInt16LE(sample, index * 2);
  }

  return output;
}

function decodeAlawToPcm16Mono(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const output = Buffer.allocUnsafe(source.length * 2);

  for (let index = 0; index < source.length; index += 1) {
    const aLawByte = source[index] ^ 0x55;
    let sample = (aLawByte & 0x0f) << 4;
    const exponent = (aLawByte & 0x70) >> 4;

    if (exponent === 0) {
      sample += 8;
    } else if (exponent === 1) {
      sample += 0x108;
    } else {
      sample += 0x108;
      sample <<= exponent - 1;
    }

    sample = (aLawByte & 0x80) ? sample : -sample;
    output.writeInt16LE(sample, index * 2);
  }

  return output;
}

function extractPcm16MonoFromElevenLabsAudio(
  buffer,
  { contentType = '', assumedSampleRate = 24000, outputFormat = '' } = {}
) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedContentType = normalizeString(contentType).toLowerCase();
  const normalizedOutputFormat = normalizeString(outputFormat).toLowerCase();
  const parsedRateFromOutputFormat = parseSampleRateFromOutputFormat(outputFormat);
  const assumedRate = parseVoiceRequestSampleRate(parsedRateFromOutputFormat || assumedSampleRate);
  const detectedFormat = detectAudioContainerFormat(source);
  const isCompressedByMagic = new Set(['mp3', 'ogg', 'flac', 'mp4']).has(detectedFormat);
  const isCompressedByContentType =
    /(audio\/mpeg|audio\/mp3|audio\/ogg|audio\/opus|audio\/aac|audio\/webm|audio\/flac|application\/ogg)/.test(
      normalizedContentType
    );

  if (!source.length) {
    return {
      pcmBuffer: Buffer.alloc(0),
      sampleRate: assumedRate,
      parseMode: 'empty',
      detectedFormat: 'empty',
      error: '',
    };
  }

  if (
    /(application\/json|text\/plain|text\/html|text\/xml|application\/xml)/.test(
      normalizedContentType
    )
  ) {
    return {
      pcmBuffer: Buffer.alloc(0),
      sampleRate: assumedRate,
      parseMode: 'unsupported',
      detectedFormat: detectedFormat === 'unknown' ? normalizedContentType || 'unknown' : detectedFormat,
      error: `unsupported-content-type:${normalizedContentType || 'none'}`,
    };
  }

  if (isCompressedByMagic || isCompressedByContentType) {
    return {
      pcmBuffer: Buffer.alloc(0),
      sampleRate: assumedRate,
      parseMode: 'unsupported',
      detectedFormat: detectedFormat === 'unknown' ? normalizedContentType || 'unknown' : detectedFormat,
      error: isCompressedByMagic
        ? `unsupported-${detectedFormat}`
        : `unsupported-content-type:${normalizedContentType || 'none'}`,
    };
  }

  if (normalizedOutputFormat.startsWith('ulaw_')) {
    if (
      normalizedContentType &&
      !/(application\/octet-stream|audio\/basic|audio\/ulaw|audio\/x-mulaw|audio\/x-ulaw)/.test(
        normalizedContentType
      )
    ) {
      return {
        pcmBuffer: Buffer.alloc(0),
        sampleRate: assumedRate,
        parseMode: 'unsupported',
        detectedFormat: detectedFormat === 'unknown' ? normalizedContentType || 'unknown' : detectedFormat,
        error: `unsupported-ulaw-content-type:${normalizedContentType}`,
      };
    }
    return {
      pcmBuffer: decodeUlawToPcm16Mono(source),
      sampleRate: assumedRate,
      parseMode: 'ulaw-decoded',
      detectedFormat: 'ulaw',
      error: '',
    };
  }

  if (normalizedOutputFormat.startsWith('alaw_')) {
    if (
      normalizedContentType &&
      !/(application\/octet-stream|audio\/basic|audio\/alaw|audio\/x-alaw)/.test(
        normalizedContentType
      )
    ) {
      return {
        pcmBuffer: Buffer.alloc(0),
        sampleRate: assumedRate,
        parseMode: 'unsupported',
        detectedFormat: detectedFormat === 'unknown' ? normalizedContentType || 'unknown' : detectedFormat,
        error: `unsupported-alaw-content-type:${normalizedContentType}`,
      };
    }
    return {
      pcmBuffer: decodeAlawToPcm16Mono(source),
      sampleRate: assumedRate,
      parseMode: 'alaw-decoded',
      detectedFormat: 'alaw',
      error: '',
    };
  }

  const wav = extractPcm16MonoFromWav(source);
  if (wav?.pcmBuffer?.length) {
    return {
      pcmBuffer: wav.pcmBuffer,
      sampleRate: parseVoiceRequestSampleRate(wav.sampleRate || assumedRate),
      parseMode: 'wav-data-chunk',
      detectedFormat: 'wav',
      error: '',
    };
  }

  if (source.length % 2 !== 0) {
    return {
      pcmBuffer: Buffer.alloc(0),
      sampleRate: assumedRate,
      parseMode: 'invalid',
      detectedFormat,
      error: 'odd-byte-length',
    };
  }

  return {
    pcmBuffer: source,
    sampleRate: assumedRate,
    parseMode: 'raw-pcm',
    detectedFormat: detectedFormat === 'unknown' ? 'pcm' : detectedFormat,
    error: '',
  };
}

function preprocessCustomVoiceText(value) {
  const raw = normalizeString(value);
  if (!raw) return '';

  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,!?;:'"()%&+\-\/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasReadableCustomVoiceText(value) {
  return /[\p{L}\p{N}]/u.test(normalizeString(value));
}

function buildSilencePcm16Mono(sampleRate, durationMs = 120) {
  const normalizedRate = parseVoiceRequestSampleRate(sampleRate);
  const duration = Math.max(40, Math.min(1000, Math.round(Number(durationMs) || 120)));
  const sampleCount = Math.max(1, Math.round((normalizedRate * duration) / 1000));
  return Buffer.alloc(sampleCount * 2);
}

function isLikelyCorruptPcm16Mono(buffer, sampleRate) {
  const summary = buildPcm16MonoDebugSummary(buffer, sampleRate);
  const suspicious =
    summary.bytes <= 0 ||
    summary.rms >= 14000 ||
    (summary.peakAbs >= 32760 && summary.rms >= 9000);

  return {
    suspicious,
    summary,
  };
}

async function getConfiguredVapiElevenLabsVoiceOverride(agentData = null) {
  const agentId = getConfiguredElevenLabsAgentId();
  const resolvedAgentData = agentData || (await getConfiguredElevenLabsAgentData()).data;
  if (resolvedAgentData && agentId) {
    const voiceOverride = buildVapiElevenLabsVoiceOverrideFromAgent(resolvedAgentData);
    elevenLabsAgentVoiceOverrideCache = {
      agentId,
      fetchedAtMs: Date.now(),
      voiceOverride: cloneJsonSafe(voiceOverride, null),
      source: voiceOverride ? 'agent' : 'agent-missing-voice',
      error: '',
      promise: null,
    };

    if (voiceOverride) {
      return {
        voiceOverride: cloneJsonSafe(voiceOverride, null),
        source: elevenLabsAgentVoiceOverrideCache.source,
      };
    }
  }

  return {
    voiceOverride: null,
    source: agentId ? 'agent-missing-voice' : 'none',
  };
}

function buildElevenLabsApiUrl(relativePath, searchParams = null) {
  const normalizedBase = `${normalizeString(ELEVENLABS_API_BASE_URL).replace(/\/+$/, '')}/`;
  const url = new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);

  if (searchParams && typeof searchParams === 'object') {
    Object.entries(searchParams).forEach(([key, value]) => {
      const normalizedValue = normalizeString(value);
      if (!normalizedValue) return;
      url.searchParams.set(key, normalizedValue);
    });
  }

  return url;
}

function cloneJsonSafe(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return fallback;
  }
}

function isLikelyElevenLabsToolDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  return (
    Object.prototype.hasOwnProperty.call(value, 'tool_call_sound') ||
    Object.prototype.hasOwnProperty.call(value, 'tool_call_sound_behavior') ||
    Object.prototype.hasOwnProperty.call(value, 'type') ||
    Object.prototype.hasOwnProperty.call(value, 'name') ||
    Object.prototype.hasOwnProperty.call(value, 'description') ||
    Object.prototype.hasOwnProperty.call(value, 'url') ||
    Object.prototype.hasOwnProperty.call(value, 'tool_id') ||
    Object.prototype.hasOwnProperty.call(value, 'tool_type') ||
    Object.prototype.hasOwnProperty.call(value, 'system_tool_type')
  );
}

function applyElevenLabsToolCallSoundToConversationConfig(conversationConfig, sound, behavior) {
  const clonedConfig = cloneJsonSafe(conversationConfig, {});
  let touchedToolCount = 0;
  let changedToolCount = 0;
  const visited = new WeakSet();

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item) => visit(item));
      return;
    }

    Object.entries(node).forEach(([key, value]) => {
      if (key === 'tools' && Array.isArray(value) && value.some((item) => isLikelyElevenLabsToolDefinition(item))) {
        value.forEach((tool) => {
          if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return;
          touchedToolCount += 1;

          if (normalizeString(tool.tool_call_sound) !== sound) {
            tool.tool_call_sound = sound;
            changedToolCount += 1;
          }

          if (normalizeString(tool.tool_call_sound_behavior) !== behavior) {
            tool.tool_call_sound_behavior = behavior;
            changedToolCount += 1;
          }
        });
      }

      visit(value);
    });
  }

  visit(clonedConfig);

  return {
    conversationConfig: clonedConfig,
    touchedToolCount,
    changedToolCount,
    changed: changedToolCount > 0,
  };
}

async function fetchElevenLabsAgent(agentId) {
  const normalizedAgentId = normalizeString(agentId);
  const endpoint = `/convai/agents/${encodeURIComponent(normalizedAgentId)}`;
  const response = await fetch(buildElevenLabsApiUrl(endpoint), {
    method: 'GET',
    headers: {
      'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs agent ophalen mislukt (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  return { endpoint, data };
}

async function updateElevenLabsAgent(agentId, payload) {
  const normalizedAgentId = normalizeString(agentId);
  const endpoint = `/convai/agents/${encodeURIComponent(normalizedAgentId)}`;
  const response = await fetch(buildElevenLabsApiUrl(endpoint), {
    method: 'PATCH',
    headers: {
      'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs agent updaten mislukt (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  return { endpoint, data };
}

async function getConfiguredElevenLabsAgentData() {
  const agentId = getConfiguredElevenLabsAgentId();
  if (!normalizeString(process.env.ELEVENLABS_API_KEY) || !agentId) {
    return {
      data: null,
      source: 'none',
    };
  }

  if (
    elevenLabsAgentConfigCache.agentId === agentId &&
    elevenLabsAgentConfigCache.data &&
    Date.now() - Number(elevenLabsAgentConfigCache.fetchedAtMs || 0) <
      ELEVENLABS_TOOL_CALL_SOUND_SYNC_CACHE_TTL_MS
  ) {
    return {
      data: cloneJsonSafe(elevenLabsAgentConfigCache.data, null),
      source: 'cache',
    };
  }

  if (
    elevenLabsAgentConfigCache.agentId === agentId &&
    elevenLabsAgentConfigCache.promise
  ) {
    return elevenLabsAgentConfigCache.promise;
  }

  const syncPromise = (async () => {
    const { data } = await fetchElevenLabsAgent(agentId);
    elevenLabsAgentConfigCache = {
      agentId,
      fetchedAtMs: Date.now(),
      data: cloneJsonSafe(data, null),
      error: '',
      promise: null,
    };

    return {
      data: cloneJsonSafe(data, null),
      source: 'api',
    };
  })().catch((error) => {
    elevenLabsAgentConfigCache = {
      agentId,
      fetchedAtMs: Date.now(),
      data: null,
      error: normalizeString(error?.message || error),
      promise: null,
    };
    throw error;
  });

  elevenLabsAgentConfigCache = {
    ...elevenLabsAgentConfigCache,
    agentId,
    promise: syncPromise,
  };

  return syncPromise;
}

async function ensureElevenLabsToolCallSoundConfigured({ force = false } = {}) {
  if (!isElevenLabsToolCallSoundSyncEnabled()) {
    return {
      ok: false,
      skipped: true,
      result: 'disabled',
    };
  }

  const agentId = getConfiguredElevenLabsAgentId();
  const sound = getConfiguredElevenLabsToolCallSound();
  const behavior = getConfiguredElevenLabsToolCallSoundBehavior();

  if (!normalizeString(process.env.ELEVENLABS_API_KEY) || !agentId || !sound) {
    return {
      ok: false,
      skipped: true,
      result: 'missing_config',
    };
  }

  const cacheMatchesRequestedConfig =
    elevenLabsToolCallSoundSyncState.agentId === agentId &&
    elevenLabsToolCallSoundSyncState.sound === sound &&
    elevenLabsToolCallSoundSyncState.behavior === behavior;

  if (!force && cacheMatchesRequestedConfig && elevenLabsToolCallSoundSyncState.promise) {
    return elevenLabsToolCallSoundSyncState.promise;
  }

  if (
    !force &&
    cacheMatchesRequestedConfig &&
    Date.now() - Number(elevenLabsToolCallSoundSyncState.syncedAtMs || 0) <
      ELEVENLABS_TOOL_CALL_SOUND_SYNC_CACHE_TTL_MS &&
    elevenLabsToolCallSoundSyncState.result !== 'idle' &&
    elevenLabsToolCallSoundSyncState.result !== 'error'
  ) {
    return {
      ok: elevenLabsToolCallSoundSyncState.result === 'synced' ||
        elevenLabsToolCallSoundSyncState.result === 'already_synced',
      skipped: true,
      cached: true,
      result: elevenLabsToolCallSoundSyncState.result,
      touchedToolCount: elevenLabsToolCallSoundSyncState.touchedToolCount,
      changedToolCount: elevenLabsToolCallSoundSyncState.changedToolCount,
    };
  }

  const syncPromise = (async () => {
    const { data } = await fetchElevenLabsAgent(agentId);
    const conversationConfig =
      data?.conversation_config && typeof data.conversation_config === 'object'
        ? data.conversation_config
        : null;

    if (!conversationConfig) {
      elevenLabsToolCallSoundSyncState = {
        ...elevenLabsToolCallSoundSyncState,
        agentId,
        sound,
        behavior,
        result: 'no_conversation_config',
        syncedAtMs: Date.now(),
        touchedToolCount: 0,
        changedToolCount: 0,
        error: '',
        promise: null,
      };

      return {
        ok: false,
        skipped: true,
        result: 'no_conversation_config',
      };
    }

    const nextConfig = applyElevenLabsToolCallSoundToConversationConfig(conversationConfig, sound, behavior);

    if (nextConfig.touchedToolCount === 0) {
      elevenLabsToolCallSoundSyncState = {
        ...elevenLabsToolCallSoundSyncState,
        agentId,
        sound,
        behavior,
        result: 'no_tools',
        syncedAtMs: Date.now(),
        touchedToolCount: 0,
        changedToolCount: 0,
        error: '',
        promise: null,
      };

      return {
        ok: false,
        skipped: true,
        result: 'no_tools',
      };
    }

    if (!nextConfig.changed) {
      elevenLabsToolCallSoundSyncState = {
        ...elevenLabsToolCallSoundSyncState,
        agentId,
        sound,
        behavior,
        result: 'already_synced',
        syncedAtMs: Date.now(),
        touchedToolCount: nextConfig.touchedToolCount,
        changedToolCount: 0,
        error: '',
        promise: null,
      };

      return {
        ok: true,
        skipped: true,
        result: 'already_synced',
        touchedToolCount: nextConfig.touchedToolCount,
        changedToolCount: 0,
      };
    }

    await updateElevenLabsAgent(agentId, {
      conversation_config: nextConfig.conversationConfig,
    });

    elevenLabsToolCallSoundSyncState = {
      ...elevenLabsToolCallSoundSyncState,
      agentId,
      sound,
      behavior,
      result: 'synced',
      syncedAtMs: Date.now(),
      touchedToolCount: nextConfig.touchedToolCount,
      changedToolCount: nextConfig.changedToolCount,
      error: '',
      promise: null,
    };

    console.log(
      '[ElevenLabs Tool Sound Sync]',
      JSON.stringify(
        {
          agentId,
          sound,
          behavior,
          touchedToolCount: nextConfig.touchedToolCount,
          changedToolCount: nextConfig.changedToolCount,
        },
        null,
        2
      )
    );

    return {
      ok: true,
      result: 'synced',
      touchedToolCount: nextConfig.touchedToolCount,
      changedToolCount: nextConfig.changedToolCount,
    };
  })().catch((error) => {
    elevenLabsToolCallSoundSyncState = {
      ...elevenLabsToolCallSoundSyncState,
      agentId,
      sound,
      behavior,
      result: 'error',
      syncedAtMs: Date.now(),
      touchedToolCount: 0,
      changedToolCount: 0,
      error: normalizeString(error?.message || error),
      promise: null,
    };
    throw error;
  });

  elevenLabsToolCallSoundSyncState = {
    ...elevenLabsToolCallSoundSyncState,
    agentId,
    sound,
    behavior,
    promise: syncPromise,
  };

  return syncPromise;
}

function toIsoFromUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return new Date(numeric * 1000).toISOString();
}

function buildElevenLabsRecordingProxyUrl(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return '';
  return `/api/coldcalling/recording?callId=${encodeURIComponent(normalizedCallId)}`;
}

function isTerminalColdcallingStatus(status, endedReason = '') {
  const combined = `${normalizeString(status).toLowerCase()} ${normalizeString(endedReason).toLowerCase()}`;
  return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|done)/.test(
    combined
  );
}

function extractElevenLabsTranscriptText(transcript) {
  if (!transcript) return '';
  if (typeof transcript === 'string') return normalizeString(transcript);
  if (!Array.isArray(transcript)) return '';

  return transcript
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const text =
        normalizeString(item.message) ||
        normalizeString(item.text) ||
        normalizeString(item.transcript) ||
        normalizeString(item.content);
      if (!text) return '';
      const role =
        normalizeString(item.role) ||
        normalizeString(item.speaker) ||
        normalizeString(item.source) ||
        normalizeString(item.type);
      return role ? `${role}: ${text}` : text;
    })
    .filter(Boolean)
    .join('\n');
}

function buildElevenLabsConversationInitiationData(lead, campaign, normalizedPhone) {
  return {
    dynamic_variables: {
      ...buildVariableValues(
        {
          ...lead,
          phone: normalizedPhone,
        },
        campaign
      ),
      phone: normalizedPhone,
    },
  };
}

function buildElevenLabsConversationUpdate(callId, details, fallback = {}) {
  const metadata = details?.metadata && typeof details.metadata === 'object' ? details.metadata : {};
  const transcriptFull = extractElevenLabsTranscriptText(details?.transcript);
  const transcriptSnippet = transcriptFull
    ? truncateText(transcriptFull.replace(/\s+/g, ' '), 280)
    : normalizeString(fallback.transcriptSnippet || '');
  const summary =
    normalizeString(details?.analysis?.transcript_summary) ||
    normalizeString(details?.analysis?.summary) ||
    normalizeString(fallback.summary || '');
  const startedAt =
    toIsoFromUnixSeconds(metadata.start_time_unix_secs) ||
    normalizeString(details?.created_at) ||
    normalizeString(fallback.startedAt || '');
  const durationSeconds =
    parseNumberSafe(metadata.call_duration_secs, null) ||
    parseNumberSafe(details?.call_duration_secs, null) ||
    parseNumberSafe(fallback.durationSeconds, null);
  const endedAt =
    toIsoFromUnixSeconds(metadata.end_time_unix_secs) ||
    (startedAt && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString()
      : normalizeString(fallback.endedAt || ''));
  const status = normalizeString(details?.status || fallback.status || '');
  const endedReason =
    normalizeString(details?.analysis?.call_successful === false ? 'unsuccessful' : '') ||
    normalizeString(details?.termination_reason) ||
    normalizeString(details?.error?.message) ||
    normalizeString(fallback.endedReason || '');
  const hasAudio = Boolean(details?.has_audio);
  const updatedAtMs =
    isTerminalColdcallingStatus(status, endedReason) && endedAt
      ? Date.parse(endedAt) || Date.now()
      : Date.now();

  return {
    callId,
    phone: normalizeString(fallback.phone || ''),
    company: normalizeString(fallback.company || ''),
    name: normalizeString(fallback.name || ''),
    status,
    messageType: 'elevenlabs.conversation',
    summary,
    transcriptSnippet,
    transcriptFull: transcriptFull || normalizeString(fallback.transcriptFull || ''),
    endedReason,
    startedAt,
    endedAt,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
    recordingUrl: hasAudio ? buildElevenLabsRecordingProxyUrl(callId) : normalizeString(fallback.recordingUrl || ''),
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    provider: 'elevenlabs',
  };
}

async function createElevenLabsOutboundCall(lead, campaign) {
  try {
    await ensureElevenLabsToolCallSoundConfigured();
  } catch (error) {
    console.warn(
      '[ElevenLabs Tool Sound Sync Failed]',
      JSON.stringify(
        {
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
          endpoint: error?.endpoint || null,
        },
        null,
        2
      )
    );
  }

  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const payload = {
    agent_id: getConfiguredElevenLabsAgentId(),
    agent_phone_number_id: normalizeString(process.env.ELEVENLABS_PHONE_NUMBER_ID),
    to_number: normalizedPhone,
    conversation_initiation_client_data: buildElevenLabsConversationInitiationData(
      lead,
      campaign,
      normalizedPhone
    ),
  };

  const endpoint = '/convai/twilio/outbound-call';
  const response = await fetch(buildElevenLabsApiUrl(endpoint), {
    method: 'POST',
    headers: {
      'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs outbound call fout (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  return { endpoint, data, normalizedPhone };
}

async function fetchElevenLabsConversationById(callId) {
  const normalizedCallId = normalizeString(callId);
  const endpoint = `/convai/conversations/${encodeURIComponent(normalizedCallId)}`;
  const response = await fetch(buildElevenLabsApiUrl(endpoint), {
    method: 'GET',
    headers: {
      'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs conversation ophalen mislukt (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  return { endpoint, data };
}

async function fetchElevenLabsConversationAudioResponse(callId) {
  const normalizedCallId = normalizeString(callId);
  const endpoint = `/convai/conversations/${encodeURIComponent(normalizedCallId)}/audio`;
  const response = await fetch(buildElevenLabsApiUrl(endpoint), {
    method: 'GET',
    headers: {
      'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs audio ophalen mislukt (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  return { endpoint, response };
}

function buildElevenLabsListCallUpdate(item, fallback = {}) {
  const callId = normalizeString(item?.conversation_id || fallback.callId || '');
  const status = normalizeString(item?.status || fallback.status || '');
  const summary = normalizeString(item?.transcript_summary || fallback.summary || '');
  const startedAt =
    toIsoFromUnixSeconds(item?.start_time_unix_secs) ||
    normalizeString(fallback.startedAt || '');
  const durationSeconds =
    parseNumberSafe(item?.call_duration_secs, null) ||
    parseNumberSafe(fallback.durationSeconds, null);
  const endedAt =
    isTerminalColdcallingStatus(status, fallback.endedReason) && startedAt && Number.isFinite(durationSeconds)
      ? new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString()
      : normalizeString(fallback.endedAt || '');
  const fingerprint = JSON.stringify({
    status,
    summary,
    durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
    endedAt,
  });
  const previousFingerprint = JSON.stringify({
    status: normalizeString(fallback.status || ''),
    summary: normalizeString(fallback.summary || ''),
    durationSeconds: Number.isFinite(Number(fallback.durationSeconds))
      ? Math.round(Number(fallback.durationSeconds))
      : null,
    endedAt: normalizeString(fallback.endedAt || ''),
  });
  const changed = fingerprint !== previousFingerprint;
  const updatedAtMs = changed
    ? Date.now()
    : Number(fallback.updatedAtMs || Date.parse(startedAt) || Date.now());

  return {
    callId,
    phone: normalizeString(fallback.phone || ''),
    company: normalizeString(fallback.company || ''),
    name: normalizeString(fallback.name || ''),
    status,
    messageType: 'elevenlabs.conversation.list',
    summary,
    transcriptSnippet: normalizeString(fallback.transcriptSnippet || ''),
    transcriptFull: normalizeString(fallback.transcriptFull || ''),
    endedReason: normalizeString(fallback.endedReason || ''),
    startedAt,
    endedAt,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
    recordingUrl:
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? buildElevenLabsRecordingProxyUrl(callId)
        : normalizeString(fallback.recordingUrl || ''),
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    provider: 'elevenlabs',
  };
}

async function listElevenLabsConversations(pageSize = 100) {
  const agentId = getConfiguredElevenLabsAgentId();
  const now = Date.now();
  if (
    elevenLabsConversationListCache.agentId === agentId &&
    now - Number(elevenLabsConversationListCache.fetchedAtMs || 0) < 3000
  ) {
    return elevenLabsConversationListCache.conversations.slice();
  }

  const endpoint = '/convai/conversations';
  const response = await fetch(
    buildElevenLabsApiUrl(endpoint, {
      agent_id: agentId,
      page_size: String(Math.max(1, Math.min(100, pageSize))),
      summary_mode: 'include',
    }),
    {
      method: 'GET',
      headers: {
        'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
      },
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      normalizeString(data?.detail?.message || data?.detail || data?.message || data?.error) ||
        `ElevenLabs conversations laden mislukt (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    error.endpoint = endpoint;
    throw error;
  }

  const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
  elevenLabsConversationListCache = {
    fetchedAtMs: now,
    agentId,
    conversations: conversations.slice(),
  };
  return conversations;
}

async function refreshElevenLabsRecentCallUpdates(limit = 200) {
  const conversations = await listElevenLabsConversations(limit);
  conversations.forEach((conversation) => {
    const callId = normalizeString(conversation?.conversation_id);
    if (!callId) return;
    const fallback = callUpdatesById.get(callId) || {};
    const update = upsertRecentCallUpdate(buildElevenLabsListCallUpdate(conversation, fallback));
    triggerPostCallAutomation(update);
  });
}

function classifyElevenLabsFailure(error) {
  const status = Number(error?.status || 0);
  const combined = `${normalizeString(error?.message)} ${JSON.stringify(error?.data || {})}`.toLowerCase();

  if (status === 401 || /unauthorized|invalid api key|xi-api-key/.test(combined)) {
    return {
      cause: 'wrong elevenlabs api key',
      explanation: 'ELEVENLABS_API_KEY lijkt ongeldig of ontbreekt.',
    };
  }

  if (/phone number|agent_phone_number_id|phnum_/.test(combined) && /(invalid|unknown|not found|missing)/.test(combined)) {
    return {
      cause: 'wrong elevenlabs phone number',
      explanation: 'ELEVENLABS_PHONE_NUMBER_ID lijkt ongeldig of niet beschikbaar voor outbound calls.',
    };
  }

  if (/agent/.test(combined) && /(invalid|unknown|not found|missing)/.test(combined)) {
    return {
      cause: 'wrong elevenlabs agent',
      explanation: 'ELEVENLABS_AGENT_ID lijkt ongeldig of niet beschikbaar.',
    };
  }

  if (/twilio|carrier|telecom|rate limit|timeout|temporar|service unavailable/.test(combined) || status >= 500) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een issue bij ElevenLabs/Twilio/provider (tijdelijk of extern).',
    };
  }

  return {
    cause: 'unknown',
    explanation: 'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte ElevenLabs response body.',
  };
}

async function buildVapiPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
  const elevenLabsCredentials = buildVapiElevenLabsCredentialsOverride();
  const configuredBackgroundSound = getConfiguredColdcallingBackgroundSound();
  let transientAssistant = null;
  let transientAssistantSource = 'saved-assistant';
  let syncedAgentSummary = null;
  const assistantOverrides = {
    variableValues: buildVariableValues(
      {
        ...lead,
        phone: normalizedPhone,
      },
      campaign
    ),
    backgroundSound: configuredBackgroundSound,
  };
  if (elevenLabsCredentials) {
    assistantOverrides.credentials = elevenLabsCredentials;
  }

  try {
    const [{ assistant: vapiAssistant, source: vapiAssistantSource }, { data: elevenLabsAgentData, source: elevenLabsAgentSource }] =
      await Promise.all([getConfiguredVapiAssistant(), getConfiguredElevenLabsAgentData()]);

    if (!elevenLabsAgentData) {
      throw new Error(
        'ELEVENLABS_AGENT_ID ontbreekt of de ElevenLabs agent kon niet worden geladen voor Vapi coldcalling.'
      );
    }

    const customVoiceOverride = buildVapiCustomElevenLabsV3VoiceFromAgent(elevenLabsAgentData);
    const { voiceOverride, source } = customVoiceOverride
      ? {
          voiceOverride: customVoiceOverride,
          source: 'agent-custom-v3',
        }
      : await getConfiguredVapiElevenLabsVoiceOverride(elevenLabsAgentData);
    if (!voiceOverride) {
      throw new Error(
        'Geen bruikbare ElevenLabs voice gevonden in de geconfigureerde agent. Vapi mag niet terugvallen op een andere stem.'
      );
    }
    if (voiceOverride) {
      assistantOverrides.voice = voiceOverride;
    }

    if (elevenLabsAgentData) {
      const syncedAgentConfig = buildVapiAssistantOverridesFromElevenLabsAgent(
        elevenLabsAgentData,
        vapiAssistant
      );
      syncedAgentSummary = syncedAgentConfig.summary;
      Object.assign(assistantOverrides, syncedAgentConfig.overrides);
      assistantOverrides.backgroundSound = configuredBackgroundSound;

      console.log(
        '[Coldcalling][ElevenLabs -> Vapi Sync]',
        JSON.stringify(
          {
            backgroundSound: assistantOverrides.backgroundSound,
            vapiAssistantSource,
            elevenLabsAgentSource,
            voiceSource: source,
            voiceProvider: voiceOverride?.provider || '',
            voiceId: voiceOverride?.voiceId || '',
            credentialProviders: Array.isArray(assistantOverrides.credentials)
              ? assistantOverrides.credentials
                  .map((credential) => normalizeString(credential?.provider))
                  .filter(Boolean)
              : [],
            syncedFirstMessage: syncedAgentConfig.summary.syncedFirstMessage,
            firstMessageSource: syncedAgentConfig.summary.firstMessageSource,
            effectiveFirstMessage: syncedAgentConfig.summary.effectiveFirstMessage,
            firstMessageMode: syncedAgentConfig.summary.firstMessageMode,
            syncedPrompt: syncedAgentConfig.summary.syncedPrompt,
            syncedModel: syncedAgentConfig.summary.syncedModel,
            syncedTranscriber: syncedAgentConfig.summary.syncedTranscriber,
            fallbackTranscriberProvider: syncedAgentConfig.summary.fallbackTranscriberProvider,
            syncedMaxDuration: syncedAgentConfig.summary.syncedMaxDuration,
            llm: syncedAgentConfig.summary.llm,
            asrProvider: syncedAgentConfig.summary.asrProvider,
            asrQuality: syncedAgentConfig.summary.asrQuality,
          },
          null,
          2
        )
      );

      if (vapiAssistant && typeof vapiAssistant === 'object') {
        transientAssistant = buildVapiTransientAssistantForColdcalling(
          vapiAssistant,
          assistantOverrides,
          syncedAgentConfig.summary
        );
        transientAssistantSource = 'transient-synced-assistant';
      }
    } else if (voiceOverride) {
      console.log(
        '[Coldcalling][Vapi Voice Override]',
        JSON.stringify(
          {
            source,
            provider: voiceOverride.provider,
            voiceId: voiceOverride.voiceId,
            backgroundSound: assistantOverrides.backgroundSound,
            credentialProviders: Array.isArray(assistantOverrides.credentials)
              ? assistantOverrides.credentials
                  .map((credential) => normalizeString(credential?.provider))
                  .filter(Boolean)
              : [],
          },
          null,
          2
        )
      );

      if (vapiAssistant && typeof vapiAssistant === 'object') {
        transientAssistant = buildVapiTransientAssistantForColdcalling(vapiAssistant, assistantOverrides);
        transientAssistantSource = 'transient-voice-assistant';
      }
    } else if (vapiAssistant && typeof vapiAssistant === 'object') {
      transientAssistant = buildVapiTransientAssistantForColdcalling(vapiAssistant, assistantOverrides);
      transientAssistantSource = 'transient-base-assistant';
    }
  } catch (error) {
    console.warn(
      '[Coldcalling][ElevenLabs Sync Failed]',
      JSON.stringify(
        {
          message: error?.message || 'Onbekende fout',
          status: error?.status || null,
          endpoint: error?.endpoint || null,
        },
        null,
        2
      )
    );
  }

  latestVapiPayloadDebug = {
    builtAt: new Date().toISOString(),
    leadCompany: normalizeString(lead.company),
    leadName: normalizeString(lead.name),
    leadPhoneE164: normalizedPhone,
    transportMode: transientAssistant ? 'transient-assistant' : 'assistant-id-overrides',
    transientAssistantSource,
    backgroundSound: normalizeString(assistantOverrides.backgroundSound),
    firstMessage: truncateText(normalizeString(assistantOverrides.firstMessage), 240),
    firstMessageMode: normalizeString(assistantOverrides.firstMessageMode),
    firstMessageSource: normalizeString(syncedAgentSummary?.firstMessageSource),
    credentialProviders: Array.isArray(assistantOverrides.credentials)
      ? assistantOverrides.credentials.map((credential) => normalizeString(credential?.provider)).filter(Boolean)
      : [],
    voice:
      assistantOverrides.voice && typeof assistantOverrides.voice === 'object'
        ? {
            provider: normalizeString(assistantOverrides.voice.provider),
            voiceId: normalizeString(assistantOverrides.voice.voiceId),
            model: normalizeString(assistantOverrides.voice.model),
          }
        : null,
    transcriber:
      assistantOverrides.transcriber && typeof assistantOverrides.transcriber === 'object'
        ? {
            provider: normalizeString(assistantOverrides.transcriber.provider),
            model: normalizeString(assistantOverrides.transcriber.model),
            language: normalizeString(assistantOverrides.transcriber.language),
          }
        : null,
    model:
      assistantOverrides.model && typeof assistantOverrides.model === 'object'
        ? {
            provider: normalizeString(assistantOverrides.model.provider),
            model: normalizeString(assistantOverrides.model.model),
          }
        : null,
    transientAssistant:
      transientAssistant && typeof transientAssistant === 'object'
        ? {
            name: normalizeString(transientAssistant.name),
            backgroundSound: normalizeString(transientAssistant.backgroundSound),
            firstMessage: truncateText(normalizeString(transientAssistant.firstMessage), 240),
            firstMessageMode: normalizeString(transientAssistant.firstMessageMode),
            voice:
              transientAssistant.voice && typeof transientAssistant.voice === 'object'
                ? {
                    provider: normalizeString(transientAssistant.voice.provider),
                    voiceId: normalizeString(transientAssistant.voice.voiceId),
                    model: normalizeString(transientAssistant.voice.model),
                  }
                : null,
            transcriber:
              transientAssistant.transcriber && typeof transientAssistant.transcriber === 'object'
                ? {
                    provider: normalizeString(transientAssistant.transcriber.provider),
                    model: normalizeString(transientAssistant.transcriber.model),
                    language: normalizeString(transientAssistant.transcriber.language),
                  }
                : null,
            model:
              transientAssistant.model && typeof transientAssistant.model === 'object'
                ? {
                    provider: normalizeString(transientAssistant.model.provider),
                    model: normalizeString(transientAssistant.model.model),
                  }
                : null,
            serverMessages: Array.isArray(transientAssistant.serverMessages)
              ? transientAssistant.serverMessages.slice(0, 20)
              : [],
          }
        : null,
  };

  const payload = {
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: {
      name: normalizeString(lead.name) || normalizeString(lead.company) || 'Onbekende lead',
      number: normalizedPhone,
    },
    assistantOverrides: transientAssistant
      ? {
          variableValues: assistantOverrides.variableValues,
        }
      : assistantOverrides,
    metadata: {
      source: 'softora-coldcalling-dashboard',
      leadCompany: normalizeString(lead.company),
      leadName: normalizeString(lead.name),
      leadPhoneE164: normalizedPhone,
      sector: normalizeString(campaign.sector),
      region: effectiveRegion,
    },
  };

  if (transientAssistant) {
    payload.assistant = transientAssistant;
  } else {
    payload.assistantId = process.env.VAPI_ASSISTANT_ID;
  }

  return payload;
}

async function processVapiColdcallingLead(lead, campaign, index) {
  try {
    const payload = await buildVapiPayload(lead, campaign);
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

async function processElevenLabsColdcallingLead(lead, campaign, index) {
  try {
    const { endpoint, data, normalizedPhone } = await createElevenLabsOutboundCall(lead, campaign);
    const callId = normalizeString(data?.conversation_id || data?.conversationId || data?.id);
    const callStatus = normalizeString(data?.status || 'initiated');
    const callSid = normalizeString(data?.callSid || data?.call_sid);

    if (callId) {
      upsertRecentCallUpdate({
        callId,
        phone: normalizedPhone,
        company: normalizeString(lead.company),
        name: normalizeString(lead.name),
        status: callStatus,
        messageType: 'coldcalling.start.response',
        summary: '',
        transcriptSnippet: '',
        endedReason: '',
        startedAt: new Date().toISOString(),
        endedAt: '',
        durationSeconds: null,
        recordingUrl: '',
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        provider: 'elevenlabs',
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
      elevenlabs: {
        endpoint,
        conversationId: callId,
        callSid,
        status: callStatus,
      },
    };
  } catch (error) {
    const failure = classifyElevenLabsFailure(error);
    console.error(
      '[Coldcalling][Lead Error]',
      JSON.stringify(
        {
          provider: 'elevenlabs',
          lead: {
            name: normalizeString(lead?.name),
            company: normalizeString(lead?.company),
            phone: normalizeString(lead?.phone),
          },
          error: error.message || 'Onbekende fout',
          statusCode: error.status || null,
          cause: failure.cause,
          explanation: failure.explanation,
          responseBody: error.data || null,
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

async function processColdcallingLead(lead, campaign, index) {
  if (getColdcallingProvider() === 'elevenlabs') {
    return processElevenLabsColdcallingLead(lead, campaign, index);
  }
  return processVapiColdcallingLead(lead, campaign, index);
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

function triggerPostCallAutomation(callUpdate) {
  if (!callUpdate) return;

  handleSequentialDispatchQueueWebhookProgress(callUpdate);
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

function isAdminMutationAuthorized(req) {
  const sharedSecrets = [
    normalizeString(process.env.WEBHOOK_SECRET || ''),
    normalizeString(process.env.ELEVENLABS_API_KEY || ''),
    normalizeString(process.env.VAPI_API_KEY || ''),
  ].filter(Boolean);

  if (!sharedSecrets.length) return false;

  const headerCandidates = [
    req.get('x-admin-secret'),
    req.get('authorization'),
  ].filter(Boolean);

  for (const candidate of headerCandidates) {
    const normalizedCandidate = normalizeString(candidate);
    if (!normalizedCandidate) continue;
    if (sharedSecrets.includes(normalizedCandidate)) return true;
    if (
      normalizedCandidate.toLowerCase().startsWith('bearer ') &&
      sharedSecrets.includes(normalizedCandidate.slice(7).trim())
    ) {
      return true;
    }
  }

  return false;
}

async function fetchElevenLabsCallStatusPayload(callId) {
  const cached = callUpdatesById.get(callId) || null;
  const { endpoint, data } = await fetchElevenLabsConversationById(callId);
  const update = upsertRecentCallUpdate(
    buildElevenLabsConversationUpdate(callId, data, cached || {})
  );
  triggerPostCallAutomation(update);

  return {
    endpoint,
    update,
    data,
  };
}

async function sendColdcallingStatusResponse(res, callId) {
  const cached = callUpdatesById.get(callId) || null;
  const provider = normalizeString(cached?.provider || getColdcallingProvider());

  if (provider === 'elevenlabs') {
    if (!normalizeString(process.env.ELEVENLABS_API_KEY)) {
      if (cached) {
        return res.status(200).json({
          ok: true,
          source: 'cache',
          provider: 'elevenlabs',
          callId: normalizeString(cached.callId || callId),
          status: normalizeString(cached.status || ''),
          endedReason: normalizeString(cached.endedReason || ''),
          startedAt: normalizeString(cached.startedAt || ''),
          endedAt: normalizeString(cached.endedAt || ''),
          durationSeconds: parseNumberSafe(cached.durationSeconds, null),
          recordingUrl: normalizeString(cached.recordingUrl || ''),
        });
      }
      return res.status(500).json({ ok: false, error: 'ELEVENLABS_API_KEY ontbreekt op server.' });
    }

    try {
      const { endpoint, update } = await fetchElevenLabsCallStatusPayload(callId);
      return res.status(200).json({
        ok: true,
        endpoint,
        source: 'elevenlabs',
        provider: 'elevenlabs',
        callId: normalizeString(update?.callId || callId),
        status: normalizeString(update?.status || ''),
        endedReason: normalizeString(update?.endedReason || ''),
        startedAt: normalizeString(update?.startedAt || ''),
        endedAt: normalizeString(update?.endedAt || ''),
        durationSeconds: parseNumberSafe(update?.durationSeconds, null),
        recordingUrl: normalizeString(update?.recordingUrl || ''),
      });
    } catch (error) {
      return res.status(Number(error?.status || 500)).json({
        ok: false,
        error: error?.message || 'Kon ElevenLabs call status niet ophalen.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
    }
  }

  if (!normalizeString(process.env.VAPI_API_KEY)) {
    if (cached) {
      return res.status(200).json({
        ok: true,
        source: 'cache',
        provider: 'vapi',
        callId: normalizeString(cached.callId || callId),
        status: normalizeString(cached.status || ''),
        endedReason: normalizeString(cached.endedReason || ''),
        startedAt: normalizeString(cached.startedAt || ''),
        endedAt: normalizeString(cached.endedAt || ''),
        durationSeconds: parseNumberSafe(cached.durationSeconds, null),
        recordingUrl: normalizeString(cached.recordingUrl || ''),
      });
    }
    return res.status(500).json({ ok: false, error: 'VAPI_API_KEY ontbreekt op server.' });
  }

  try {
    const { endpoint, data } = await fetchVapiCallStatusById(callId);
    const update = extractCallUpdateFromVapiCallStatusResponse(callId, data);
    if (update) {
      upsertRecentCallUpdate(update);
    }
    const call = data?.call && typeof data.call === 'object' ? data.call : data;

    return res.status(200).json({
      ok: true,
      endpoint,
      source: 'vapi',
      provider: 'vapi',
      callId: normalizeString(update?.callId || call?.id || callId),
      status: normalizeString(update?.status || call?.status || data?.status || ''),
      endedReason: normalizeString(update?.endedReason || call?.endedReason || data?.endedReason || ''),
      startedAt: normalizeString(update?.startedAt || ''),
      endedAt: normalizeString(update?.endedAt || ''),
      durationSeconds: parseNumberSafe(update?.durationSeconds, null),
      recordingUrl: normalizeString(update?.recordingUrl || ''),
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || 'Kon Vapi call status niet ophalen.',
      endpoint: error?.endpoint || null,
      details: error?.data || null,
    });
  }
}

app.post('/api/coldcalling/start', async (req, res) => {
  const provider = getColdcallingProvider();
  const configuredProvider = normalizeString(process.env.COLDCALLING_PROVIDER).toLowerCase();
  const missingEnv = getMissingEnvVars(provider);

  if (missingEnv.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        provider === 'elevenlabs'
          ? 'Server mist vereiste environment variables voor ElevenLabs outbound calling.'
          : 'Server mist vereiste environment variables voor Vapi.',
      missingEnv,
      provider,
    });
  }

  const validated = validateStartPayload(req.body);
  if (validated.error) {
    return res.status(400).json({ ok: false, error: validated.error });
  }

  const campaign = validated.campaign;
  const originalLeads = Array.isArray(validated.leads) ? validated.leads : [];
  const { allowedLeads, blockedResults } = filterBlockedColdcallingLeads(originalLeads);

  if (blockedResults.length > 0) {
    console.warn(
      `[Coldcalling] ${blockedResults.length} lead(s) geblokkeerd omdat het doelnummer op de blocklist staat.`
    );
  }

  if (allowedLeads.length === 0) {
    return res.status(400).json({
      ok: false,
      error:
        'Alle geselecteerde leads zijn geblokkeerd als doelnummer. Je eigen lijn wordt daarom niet gebeld.',
      provider,
      results: blockedResults,
    });
  }

  const leads = allowedLeads;
  const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

  if (provider !== configuredProvider && configuredProvider) {
    console.log(
      `[Coldcalling] Provider-resolutie: configured="${configuredProvider}" -> active="${provider}".`
    );
  }

  console.log(
    `[Coldcalling] Start campagne ontvangen via ${provider}: ${leadsToProcess.length}/${originalLeads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
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

    const queuedRemaining = Math.max(0, queue.leads.length - queue.results.length);
    const allResults = blockedResults.concat(results);
    const totalStartedNow = allResults.filter((item) => item.success).length;
    const totalFailedNow = allResults.length - totalStartedNow;

    console.log(
      `[Coldcalling][Sequential Queue] ${queue.id} gestart: direct ${results.length}/${queue.leads.length} verwerkt, ${queuedRemaining} wachtend`
    );

    return res.status(200).json({
      ok: true,
      summary: {
        requested: originalLeads.length,
        attempted: leadsToProcess.length,
        started: totalStartedNow,
        failed: totalFailedNow,
        provider,
        dispatchMode: campaign.dispatchMode,
        dispatchDelaySeconds: 0,
        sequentialWaitForCallEnd: true,
        queueId: queue.id,
        queuedRemaining,
        blocked: blockedResults.length,
      },
      results: allResults,
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

  const allResults = blockedResults.concat(results);
  const started = allResults.filter((item) => item.success).length;
  const failed = allResults.length - started;

  return res.status(200).json({
    ok: true,
    summary: {
      requested: originalLeads.length,
      attempted: leadsToProcess.length,
      started,
      failed,
      blocked: blockedResults.length,
      provider,
      dispatchMode: campaign.dispatchMode,
      dispatchDelaySeconds: campaign.dispatchMode === 'delay' ? campaign.dispatchDelaySeconds : 0,
    },
    results: allResults,
  });
});

app.get('/api/coldcalling/call-status/:callId', async (req, res) => {
  const callId = normalizeString(req.params?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }
  return sendColdcallingStatusResponse(res, callId);
});

// Vercel route-fallback: sommige serverless route-combinaties geven NOT_FOUND op diepere paden.
// Deze variant gebruikt een ondiep pad met querystring en werkt betrouwbaarder.
app.get('/api/coldcalling/status', async (req, res) => {
  const callId = normalizeString(req.query?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }
  return sendColdcallingStatusResponse(res, callId);
});

app.post('/api/custom-voice-elevenlabs', async (req, res) => {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Ongeldige Vapi custom voice secret.' });
  }

  const message = req.body?.message && typeof req.body.message === 'object' ? req.body.message : null;
  const rawText = normalizeString(message?.text);
  const text = preprocessCustomVoiceText(rawText);
  const voiceId = normalizeString(req.query.voice_id || req.query.voiceId);
  const modelId =
    normalizeElevenLabsCustomSpeechModel(req.query.model_id || req.query.modelId || 'eleven_v3') ||
    'eleven_v3';
  const languageCode = normalizeString(req.query.language_code || req.query.languageCode);

  if (!voiceId) {
    return res.status(400).json({ ok: false, error: 'voice_id ontbreekt voor custom ElevenLabs voice.' });
  }

  if (!rawText) {
    return res.status(400).json({ ok: false, error: 'voice-request bevat geen tekst.' });
  }

  const requestedSampleRate =
    message?.sampleRate ??
    message?.sample_rate ??
    req.body?.sampleRate ??
    req.body?.sample_rate ??
    req.query.sampleRate ??
    req.query.sample_rate;
  const { requestedRate, sourceRate, outputFormat } = resolveElevenLabsOutputSampleRate(
    requestedSampleRate,
    modelId
  );
  const voiceSettings = {};
  const stability = clampNumber(req.query.stability, 0, 1);
  const similarityBoost = clampNumber(req.query.similarity_boost, 0, 1);
  const style = clampNumber(req.query.style, 0, 1);
  const speed = clampNumber(req.query.speed, 0.7, 1.2);
  const hasUseSpeakerBoost = normalizeString(req.query.use_speaker_boost) !== '';

  if (stability !== null) voiceSettings.stability = stability;
  if (similarityBoost !== null) voiceSettings.similarity_boost = similarityBoost;
  if (style !== null) voiceSettings.style = style;
  if (speed !== null) voiceSettings.speed = speed;
  if (hasUseSpeakerBoost) {
    voiceSettings.use_speaker_boost = toBooleanSafe(req.query.use_speaker_boost, false);
  }

  if (!hasReadableCustomVoiceText(text)) {
    const silenceBuffer = buildSilencePcm16Mono(requestedRate, 160);
    latestCustomVoiceDebug = {
      at: new Date().toISOString(),
      request: {
        type: normalizeString(message?.type),
        voiceId,
        modelId,
        textPreview: truncateText(rawText, 180),
        sanitizedTextPreview: truncateText(text, 180),
        requestedRate,
        sourceRate: requestedRate,
        outputFormat: `pcm_${requestedRate}`,
        languageCode: languageCode || null,
      },
      response: {
        ...buildPcm16MonoDebugSummary(silenceBuffer, requestedRate),
        handledAsSilence: true,
      },
    };

    res.status(200);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'no-store, no-transform');
    res.set('Content-Length', String(silenceBuffer.length));
    res.set('X-Content-Type-Options', 'nosniff');
    return res.end(silenceBuffer);
  }

  const requestBody = {
    text,
    model_id: modelId,
  };
  if (languageCode) {
    requestBody.language_code = languageCode;
  }
  if (Object.keys(voiceSettings).length > 0) {
    requestBody.voice_settings = voiceSettings;
  }

  const endpointPath = `/text-to-speech/${encodeURIComponent(voiceId)}`;

  const fetchElevenLabsAudioAttempt = async (attemptLabel, attemptOutputFormat, attemptSourceRate) => {
    const endpoint = buildElevenLabsApiUrl(endpointPath, {
      output_format: attemptOutputFormat,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': normalizeString(process.env.ELEVENLABS_API_KEY),
        'Content-Type': 'application/json',
        Accept: 'audio/*,application/octet-stream',
      },
      body: JSON.stringify(requestBody),
    });

    const contentType = normalizeString(response.headers.get('content-type') || '');
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      return {
        label: attemptLabel,
        ok: false,
        endpoint: endpoint.toString(),
        status: response.status,
        contentType,
        bytes: audioBuffer.length,
        outputFormat: attemptOutputFormat,
        sourceRate: attemptSourceRate,
        failureBody: truncateText(audioBuffer.toString('utf8'), 1000),
      };
    }

    const parsedAudio = extractPcm16MonoFromElevenLabsAudio(audioBuffer, {
      contentType,
      assumedSampleRate: attemptSourceRate,
      outputFormat: attemptOutputFormat,
    });

    return {
      label: attemptLabel,
      ok: true,
      endpoint: endpoint.toString(),
      status: response.status,
      contentType,
      bytes: audioBuffer.length,
      outputFormat: attemptOutputFormat,
      sourceRate: attemptSourceRate,
      parsedAudio,
    };
  };

  try {
    const attemptPlan = [
      { label: 'primary', outputFormat, sourceRate },
    ];
    if (outputFormat !== 'pcm_16000') {
      attemptPlan.push({ label: 'fallback-pcm-16000', outputFormat: 'pcm_16000', sourceRate: 16000 });
    }

    const attempts = [];
    let selectedAttempt = null;

    for (const plan of attemptPlan) {
      const attempt = await fetchElevenLabsAudioAttempt(
        plan.label,
        plan.outputFormat,
        plan.sourceRate
      );
      attempts.push(attempt);

      if (!attempt.ok) {
        continue;
      }

      if (!normalizeString(attempt.parsedAudio?.error)) {
        selectedAttempt = attempt;
        break;
      }
    }

    if (!selectedAttempt) {
      const firstFailure = attempts.find((attempt) => !attempt.ok) || null;
      latestCustomVoiceDebug = {
        at: new Date().toISOString(),
        request: {
          type: normalizeString(message?.type),
          voiceId,
          modelId,
          textPreview: truncateText(rawText, 180),
          sanitizedTextPreview: truncateText(text, 180),
          requestedRate,
          sourceRate,
          outputFormat,
          languageCode: languageCode || null,
        },
        error: {
          status: firstFailure?.status || null,
          message:
            normalizeString(firstFailure?.failureBody) ||
            'Custom voice response kon niet naar PCM16 worden geconverteerd.',
        },
        attempts: attempts.map((attempt) => ({
          label: attempt.label,
          ok: attempt.ok,
          status: attempt.status,
          outputFormat: attempt.outputFormat,
          sourceRate: attempt.sourceRate,
          contentType: attempt.contentType,
          bytes: attempt.bytes,
          parseMode: normalizeString(attempt.parsedAudio?.parseMode),
          detectedFormat: normalizeString(attempt.parsedAudio?.detectedFormat),
          parseError: normalizeString(attempt.parsedAudio?.error),
        })),
      };
      console.error(
        '[Custom Voice][All Attempts Failed]',
        JSON.stringify(
          {
            voiceId,
            modelId,
            requestedRate,
            sourceRate,
            attempts: attempts.map((attempt) => ({
              label: attempt.label,
              ok: attempt.ok,
              status: attempt.status,
              outputFormat: attempt.outputFormat,
              sourceRate: attempt.sourceRate,
              contentType: attempt.contentType,
              bytes: attempt.bytes,
              parseMode: normalizeString(attempt.parsedAudio?.parseMode),
              detectedFormat: normalizeString(attempt.parsedAudio?.detectedFormat),
              parseError: normalizeString(attempt.parsedAudio?.error),
              failureBody: normalizeString(attempt.failureBody),
            })),
          },
          null,
          2
        )
      );
      return res.status(502).json({
        ok: false,
        error: 'Custom ElevenLabs voice kon niet worden omgezet naar valide PCM audio.',
      });
    }

    const selectedPcmBuffer = Buffer.isBuffer(selectedAttempt.parsedAudio?.pcmBuffer)
      ? selectedAttempt.parsedAudio.pcmBuffer
      : Buffer.alloc(0);
    const selectedSourceRate = parseVoiceRequestSampleRate(
      selectedAttempt.parsedAudio?.sampleRate || selectedAttempt.sourceRate || sourceRate
    );
    const outputBufferBase =
      selectedSourceRate === requestedRate
        ? selectedPcmBuffer
        : resamplePcm16Mono(selectedPcmBuffer, selectedSourceRate, requestedRate);
    const outputBuffer =
      outputBufferBase.length > 0
        ? outputBufferBase
        : buildSilencePcm16Mono(requestedRate, 160);
    const audioQualityCheck = isLikelyCorruptPcm16Mono(outputBuffer, requestedRate);

    if (audioQualityCheck.suspicious) {
      latestCustomVoiceDebug = {
        at: new Date().toISOString(),
        request: {
          type: normalizeString(message?.type),
          voiceId,
          modelId,
          textPreview: truncateText(rawText, 180),
          sanitizedTextPreview: truncateText(text, 180),
          requestedRate,
          sourceRate,
          outputFormat,
          languageCode: languageCode || null,
        },
        error: {
          message: 'Corrupt/suspicious PCM gedetecteerd, custom audio afgewezen voor fallback.',
        },
        response: {
          ...audioQualityCheck.summary,
          selectedAttempt: selectedAttempt.label,
          selectedOutputFormat: selectedAttempt.outputFormat,
          selectedSourceRate,
          selectedParseMode: normalizeString(selectedAttempt.parsedAudio?.parseMode),
          selectedDetectedFormat: normalizeString(selectedAttempt.parsedAudio?.detectedFormat),
          selectedContentType: selectedAttempt.contentType,
          attemptCount: attempts.length,
        },
      };

      console.error(
        '[Custom Voice][Suspicious PCM Rejected]',
        JSON.stringify(
          {
            voiceId,
            modelId,
            requestedRate,
            sourceRate,
            selectedAttempt: selectedAttempt.label,
            selectedOutputFormat: selectedAttempt.outputFormat,
            selectedSourceRate,
            selectedParseMode: normalizeString(selectedAttempt.parsedAudio?.parseMode),
            selectedDetectedFormat: normalizeString(selectedAttempt.parsedAudio?.detectedFormat),
            selectedContentType: selectedAttempt.contentType,
            summary: audioQualityCheck.summary,
          },
          null,
          2
        )
      );

      return res.status(502).json({
        ok: false,
        error: 'Custom ElevenLabs audio was verdacht/corrupt en is afgewezen.',
      });
    }

    latestCustomVoiceDebug = {
      at: new Date().toISOString(),
      request: {
        type: normalizeString(message?.type),
        voiceId,
        modelId,
        textPreview: truncateText(rawText, 180),
        sanitizedTextPreview: truncateText(text, 180),
        requestedRate,
        sourceRate,
        outputFormat,
        languageCode: languageCode || null,
      },
      response: {
        ...buildPcm16MonoDebugSummary(outputBuffer, requestedRate),
        selectedAttempt: selectedAttempt.label,
        selectedOutputFormat: selectedAttempt.outputFormat,
        selectedSourceRate,
        selectedParseMode: normalizeString(selectedAttempt.parsedAudio?.parseMode),
        selectedDetectedFormat: normalizeString(selectedAttempt.parsedAudio?.detectedFormat),
        selectedContentType: selectedAttempt.contentType,
        attemptCount: attempts.length,
        attempts: attempts.map((attempt) => ({
          label: attempt.label,
          ok: attempt.ok,
          status: attempt.status,
          outputFormat: attempt.outputFormat,
          sourceRate: attempt.sourceRate,
          contentType: attempt.contentType,
          bytes: attempt.bytes,
          parseMode: normalizeString(attempt.parsedAudio?.parseMode),
          detectedFormat: normalizeString(attempt.parsedAudio?.detectedFormat),
          parseError: normalizeString(attempt.parsedAudio?.error),
        })),
        handledAsSilence: outputBufferBase.length === 0,
      },
    };

    res.status(200);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'no-store, no-transform');
    res.set('Content-Length', String(outputBuffer.length));
    res.set('X-Content-Type-Options', 'nosniff');

    return res.end(outputBuffer);
  } catch (error) {
    latestCustomVoiceDebug = {
      at: new Date().toISOString(),
      request: {
        type: normalizeString(message?.type),
        voiceId,
        modelId,
        textPreview: truncateText(rawText, 180),
        sanitizedTextPreview: truncateText(text, 180),
        requestedRate,
        sourceRate,
        outputFormat,
        languageCode: languageCode || null,
      },
      error: {
        message: error?.message || 'Onbekende fout',
      },
    };
    console.error(
      '[Custom Voice][Unhandled Error]',
      JSON.stringify(
        {
          message: error?.message || 'Onbekende fout',
          voiceId,
          modelId,
          requestedRate,
          sourceRate,
        },
        null,
        2
      )
    );
    return res.status(502).json({
      ok: false,
      error: 'Custom ElevenLabs voice kon niet worden opgehaald.',
    });
  }
});

app.get('/api/coldcalling/recording', async (req, res) => {
  const callId = normalizeString(req.query?.callId);
  if (!callId) {
    return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
  }

  if (!normalizeString(process.env.ELEVENLABS_API_KEY)) {
    return res.status(500).json({ ok: false, error: 'ELEVENLABS_API_KEY ontbreekt op server.' });
  }

  try {
    const { response } = await fetchElevenLabsConversationAudioResponse(callId);
    const contentType = normalizeString(response.headers.get('content-type') || 'audio/mpeg');
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const range = parseHttpByteRange(req.headers.range, audioBuffer.length);

    res.setHeader('Content-Type', contentType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');

    if (range && range.unsatisfiable) {
      res.setHeader('Content-Range', `bytes */${range.total}`);
      return res.status(416).end();
    }

    if (range) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
      res.setHeader('Content-Length', String(range.length));
      return res.status(206).send(audioBuffer.subarray(range.start, range.end + 1));
    }

    res.setHeader('Content-Length', String(audioBuffer.length));
    res.setHeader('Content-Type', contentType || 'audio/mpeg');
    return res.status(200).send(audioBuffer);
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      ok: false,
      error: error?.message || 'Kon ElevenLabs audio niet ophalen.',
      endpoint: error?.endpoint || null,
      details: error?.data || null,
    });
  }
});

async function sendColdcallingHistoryResetResponse(req, res) {
  if (!isAdminMutationAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Niet geautoriseerd.' });
  }

  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }

  const before = {
    webhookEvents: recentWebhookEvents.length,
    callUpdates: recentCallUpdates.length,
    aiCallInsights: recentAiCallInsights.length,
    appointments: generatedAgendaAppointments.length,
    visibleAfterMs: getColdcallingHistoryVisibleAfterMs(),
  };

  const reset = clearColdcallingHistoryRuntime({ visibleAfterMs: Date.now() });
  const persisted = await persistRuntimeStateToSupabase('coldcalling_history_reset');

  return res.status(200).json({
    ok: true,
    persisted,
    before,
    after: reset,
  });
}

app.post('/api/coldcalling/history/reset', async (req, res) => {
  return sendColdcallingHistoryResetResponse(req, res);
});

app.post('/api/coldcalling-history-reset', async (req, res) => {
  return sendColdcallingHistoryResetResponse(req, res);
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

    triggerPostCallAutomation(callUpdate);
  }

  // Reageer na de snelle lokale verwerking. Dit blijft snel genoeg en voorkomt gemiste taken.
  res.status(200).json({ ok: true });

  // TODO: Sla call-status updates op (bijv. queued/ringing/in-progress/ended).
  // TODO: Sla transcript/events op zodra je transcriptie wilt tonen in het dashboard.
  // TODO: Sla afspraken of opvolgacties op wanneer de call een afspraak boekt.
  return;
});

app.get('/api/vapi/call-updates', async (req, res) => {
  if (isSupabaseConfigured()) {
    await ensureRuntimeStateHydratedFromSupabase({ force: true });
  }
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
  const sinceMs = parseNumberSafe(req.query.sinceMs, null);

  if (getColdcallingProvider() === 'elevenlabs' && normalizeString(process.env.ELEVENLABS_API_KEY)) {
    try {
      await refreshElevenLabsRecentCallUpdates(limit);
    } catch (error) {
      console.warn(
        '[ElevenLabs Call Updates Refresh Failed]',
        JSON.stringify(
          {
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
          },
          null,
          2
        )
      );
    }
  }

  const filtered = recentCallUpdates.filter((item) => {
    if (!isCallUpdateVisibleForHistory(item)) return false;
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

async function sendAiTranscriptToPromptResponse(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const transcript = normalizeString(body.transcript || body.text || '');
  const language = normalizeString(body.language || 'nl') || 'nl';
  const context = normalizeString(body.context || '');

  if (!transcript) {
    return res.status(400).json({
      ok: false,
      error: 'Transcript ontbreekt',
      detail: 'Stuur een JSON body met { transcript: "..." }',
    });
  }

  if (transcript.length > 50000) {
    return res.status(400).json({
      ok: false,
      error: 'Transcript te lang',
      detail: 'Maximaal 50.000 tekens per request.',
    });
  }

  try {
    const result = await generateWebsitePromptFromTranscriptWithAi({
      transcript,
      language,
      context,
    });

    return res.status(200).json({
      ok: true,
      prompt: result.prompt,
      source: result.source,
      model: result.model,
      usage: result.usage,
      language: result.language,
      openAiEnabled: true,
    });
  } catch (error) {
    const fallbackPrompt = buildWebsitePromptFallback({
      transcript,
      language,
      context,
    });

    console.error(
      '[AI][TranscriptToPrompt][Fallback]',
      JSON.stringify(
        {
          reason: String(error?.message || 'Onbekende fout'),
          status: Number(error?.status || 0) || null,
          openAiEnabled: Boolean(getOpenAiApiKey()),
        },
        null,
        2
      )
    );

    return res.status(200).json({
      ok: true,
      prompt: fallbackPrompt,
      source: 'template-fallback',
      model: null,
      usage: null,
      language,
      warning: 'AI prompt generatie faalde, template fallback gebruikt.',
      detail: String(error?.message || 'Onbekende fout'),
      openAiEnabled: Boolean(getOpenAiApiKey()),
    });
  }
}

app.post('/api/ai/transcript-to-prompt', async (req, res) => {
  return sendAiTranscriptToPromptResponse(req, res);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/ai-transcript-to-prompt', async (req, res) => {
  return sendAiTranscriptToPromptResponse(req, res);
});

async function sendActiveOrderGenerateSiteResponse(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prompt = normalizeString(body.prompt || '');
    const company = truncateText(normalizeString(body.company || body.clientName || ''), 160);
    const title = truncateText(normalizeString(body.title || ''), 200);
    const description = truncateText(normalizeString(body.description || ''), 3000);
    const language = normalizeString(body.language || 'nl') || 'nl';
    const orderId = Number(body.orderId) || null;
    const buildMode = normalizeString(body.buildMode || '') || null;

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: 'Prompt ontbreekt',
        detail: 'Stuur een body met minimaal { prompt: "..." }',
      });
    }

    const generated = await generateWebsiteHtmlWithAi({
      prompt,
      company,
      title,
      description,
      language,
    });

    appendDashboardActivity(
      {
        type: 'active_order_generated',
        title: 'AI website gegenereerd',
        detail: `HTML-opzet gegenereerd${company ? ` voor ${company}` : ''}.`,
        company,
        actor: 'api',
        taskId: Number.isFinite(orderId) ? orderId : null,
        source: 'premium-actieve-opdrachten',
      },
      'dashboard_activity_active_order_generated'
    );

    return res.status(200).json({
      ok: true,
      html: generated.html,
      source: generated.source,
      model: generated.model,
      generator: {
        strictAnthropic: WEBSITE_GENERATION_STRICT_ANTHROPIC,
        strictHtml: WEBSITE_GENERATION_STRICT_HTML,
      },
      usage: generated.usage,
      apiCost: generated.apiCost,
      order: {
        orderId,
        company,
        title,
        buildMode,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const upstreamDetail = truncateText(
      normalizeString(
        error?.data?.error?.message ||
          error?.data?.error?.detail ||
          error?.data?.error ||
          error?.data?.detail ||
          ''
      ),
      500
    );
    return res.status(safeStatus).json({
      ok: false,
      error:
        safeStatus === 503
          ? 'AI website generatie niet beschikbaar'
          : 'AI website generatie mislukt',
      detail: String(error?.message || 'Onbekende fout'),
      openAiEnabled: Boolean(getOpenAiApiKey()),
      anthropicEnabled: Boolean(getAnthropicApiKey()),
      websiteGenerationProvider: getWebsiteGenerationProvider(),
      websiteGenerationModel:
        getWebsiteGenerationProvider() === 'anthropic' ? getWebsiteAnthropicModel() : OPENAI_MODEL,
      upstreamDetail: upstreamDetail || null,
    });
  }
}

app.post('/api/active-orders/generate-site', async (req, res) => {
  return sendActiveOrderGenerateSiteResponse(req, res);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/active-order-generate-site', async (req, res) => {
  return sendActiveOrderGenerateSiteResponse(req, res);
});

app.get('/api/dashboard/activity', (req, res) => {
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
  return res.status(200).json({
    ok: true,
    count: Math.min(limit, recentDashboardActivities.length),
    activities: recentDashboardActivities.slice(0, limit),
  });
});

async function sendUiStateGetResponse(req, res, scopeRaw) {
  const scope = normalizeUiStateScope(scopeRaw);
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
}

app.get('/api/ui-state/:scope', async (req, res) => {
  return sendUiStateGetResponse(req, res, req.params.scope);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.get('/api/ui-state-get', async (req, res) => {
  return sendUiStateGetResponse(req, res, req.query.scope);
});

async function sendUiStateSetResponse(req, res, scopeRaw) {
  const scope = normalizeUiStateScope(scopeRaw);
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
    updatedAt: state.updatedAt || null,
  });
}

app.post('/api/ui-state/:scope', async (req, res) => {
  return sendUiStateSetResponse(req, res, req.params.scope);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/ui-state-set', async (req, res) => {
  return sendUiStateSetResponse(req, res, req.query.scope);
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

function normalizePostCallStatus(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return 'customer_wants_to_proceed';
  if (raw === 'customer_wants_to_proceed') return raw;
  if (raw === 'klant_wil_door') return 'customer_wants_to_proceed';
  return truncateText(raw, 80);
}

function sanitizePostCallText(value, maxLen = 20000) {
  return truncateText(normalizeString(value || ''), maxLen);
}

function buildPostCallPayload(body = {}) {
  return {
    postCallStatus: normalizePostCallStatus(body.status || body.postCallStatus),
    postCallNotesTranscript: sanitizePostCallText(
      body.transcript || body.postCallNotesTranscript || body.voiceTranscript,
      25000
    ),
    postCallPrompt: sanitizePostCallText(
      body.prompt || body.postCallPrompt || body.generatedPrompt,
      25000
    ),
    postCallUpdatedBy: truncateText(normalizeString(body.actor || body.doneBy || ''), 120),
  };
}

function updateAgendaAppointmentPostCallDataById(req, res, appointmentIdRaw) {
  const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  const payload = buildPostCallPayload(req.body || {});
  const nowIso = new Date().toISOString();
  const updated = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      postCallStatus: payload.postCallStatus || normalizePostCallStatus(appointment?.postCallStatus),
      postCallNotesTranscript:
        payload.postCallNotesTranscript ||
        sanitizePostCallText(appointment?.postCallNotesTranscript || '', 25000),
      postCallPrompt: payload.postCallPrompt || sanitizePostCallText(appointment?.postCallPrompt || '', 25000),
      postCallUpdatedAt: nowIso,
      postCallUpdatedBy: payload.postCallUpdatedBy || null,
    },
    'agenda_post_call_update'
  );

  if (!updated) {
    return res.status(500).json({ ok: false, error: 'Kon afspraak niet opslaan' });
  }

  appendDashboardActivity(
    {
      type: 'post_call_notes_saved',
      title: 'Klantwens opgeslagen',
      detail: 'Na-afspraak transcriptie/prompt bijgewerkt.',
      company: updated?.company || appointment?.company || '',
      actor: payload.postCallUpdatedBy || '',
      taskId: Number(updated?.id || appointment?.id || 0) || null,
      callId: normalizeString(updated?.callId || appointment?.callId || ''),
      source: 'premium-personeel-agenda',
    },
    'dashboard_activity_post_call_saved'
  );

  return res.status(200).json({
    ok: true,
    appointment: updated,
  });
}

function normalizeActiveOrderStatusKey(value) {
  const key = normalizeString(value || '').toLowerCase();
  if (key === 'actief') return 'actief';
  if (key === 'bezig') return 'bezig';
  if (key === 'klaar') return 'klaar';
  return 'wacht';
}

function parseAmountFromEuroLabel(value) {
  const raw = normalizeString(value || '');
  if (!raw) return null;
  const digitsOnly = raw.replace(/[^\d]/g, '');
  const amount = Number(digitsOnly);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

function parseCustomOrdersFromUiState(rawValue) {
  const raw = normalizeString(rawValue || '');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const id = Number(item.id);
        const amount = Math.round(Number(item.amount));
        const clientName = truncateText(normalizeString(item.clientName || ''), 160);
        const location = truncateText(normalizeString(item.location || ''), 160);
        const title = truncateText(normalizeString(item.title || ''), 200);
        const description = truncateText(normalizeString(item.description || ''), 3000);
        if (!Number.isFinite(id) || id <= 0) return null;
        if (!clientName || !title || !description) return null;
        if (!Number.isFinite(amount) || amount <= 0) return null;

        return {
          ...item,
          id,
          clientName,
          location,
          title,
          description,
          amount,
          status: normalizeActiveOrderStatusKey(item.status),
          sourceAppointmentId: Number(item.sourceAppointmentId) || null,
          sourceCallId: normalizeString(item.sourceCallId || '') || null,
          prompt: sanitizePostCallText(item.prompt || '', 25000),
          transcript: sanitizePostCallText(item.transcript || '', 25000),
          createdAt: normalizeString(item.createdAt || '') || null,
          updatedAt: normalizeString(item.updatedAt || '') || null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getNextCustomOrderId(customOrders) {
  const maxId = (Array.isArray(customOrders) ? customOrders : [])
    .map((item) => Number(item?.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .reduce((max, id) => (id > max ? id : max), 0);
  return maxId + 1;
}

function buildActiveOrderDescriptionFromAppointment(appointment, transcript, prompt) {
  const summary = normalizeString(appointment?.summary || '');
  if (summary) return truncateText(summary, 1000);
  if (transcript) return truncateText(transcript, 1000);
  if (prompt) return truncateText(prompt, 1000);
  return 'Nieuwe website-opdracht op basis van intakegesprek.';
}

function buildActiveOrderRecordFromAppointment(appointment, input = {}, nextId = 1) {
  const company = truncateText(normalizeString(appointment?.company || ''), 160) || 'Nieuwe lead';
  const contact = truncateText(normalizeString(appointment?.contact || ''), 160);
  const prompt = sanitizePostCallText(input.prompt || appointment?.postCallPrompt || '', 25000);
  const transcript = sanitizePostCallText(
    input.transcript || appointment?.postCallNotesTranscript || '',
    25000
  );
  const title =
    truncateText(normalizeString(input.title || ''), 200) ||
    `Website opdracht voor ${company}`;
  const description =
    truncateText(normalizeString(input.description || ''), 3000) ||
    buildActiveOrderDescriptionFromAppointment(appointment, transcript, prompt);
  const amountCandidate = Math.round(Number(input.amount));
  const amount =
    (Number.isFinite(amountCandidate) && amountCandidate > 0
      ? amountCandidate
      : parseAmountFromEuroLabel(appointment?.value || '')) || 2500;

  return {
    id: Number(nextId) || 1,
    clientName: company,
    location: truncateText(normalizeString(input.location || ''), 160),
    title,
    description,
    amount,
    status: normalizeActiveOrderStatusKey(input.status || 'wacht'),
    source: 'agenda_post_call_prompt',
    sourceAppointmentId: Number(appointment?.id) || null,
    sourceCallId: normalizeString(appointment?.callId || '') || null,
    contact,
    prompt,
    transcript,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function addAgendaAppointmentToPremiumActiveOrders(req, res, appointmentIdRaw) {
  const idx = getGeneratedAppointmentIndexById(appointmentIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  if (!appointment || typeof appointment !== 'object') {
    return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden' });
  }

  const actor = truncateText(normalizeString(req.body?.actor || req.body?.doneBy || ''), 120);
  const promptText = sanitizePostCallText(req.body?.prompt || appointment?.postCallPrompt || '', 25000);
  const transcriptText = sanitizePostCallText(
    req.body?.transcript || appointment?.postCallNotesTranscript || '',
    25000
  );
  if (!promptText) {
    return res.status(400).json({
      ok: false,
      error: 'Maak eerst een prompt voordat je toevoegt aan actieve opdrachten.',
    });
  }

  const currentState = await getUiStateValues(PREMIUM_ACTIVE_ORDERS_SCOPE);
  const currentValues =
    currentState && currentState.values && typeof currentState.values === 'object'
      ? currentState.values
      : {};
  const customOrders = parseCustomOrdersFromUiState(currentValues[PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY]);

  const appointmentId = Number(appointment?.id) || null;
  let existingOrder = appointmentId
    ? customOrders.find((item) => Number(item?.sourceAppointmentId) === appointmentId)
    : null;
  const hadExistingOrder = Boolean(existingOrder);

  if (existingOrder) {
    existingOrder = {
      ...existingOrder,
      prompt: promptText,
      transcript: transcriptText || sanitizePostCallText(existingOrder?.transcript || '', 25000),
      updatedAt: new Date().toISOString(),
    };
    for (let i = 0; i < customOrders.length; i += 1) {
      if (Number(customOrders[i]?.id) !== Number(existingOrder.id)) continue;
      customOrders[i] = existingOrder;
      break;
    }
  } else {
    const nextId = getNextCustomOrderId(customOrders);
    const record = buildActiveOrderRecordFromAppointment(
      {
        ...appointment,
        postCallPrompt: promptText,
        postCallNotesTranscript: transcriptText,
      },
      req.body || {},
      nextId
    );
    customOrders.push(record);
    existingOrder = record;
  }

  const nextValues = {
    ...currentValues,
    [PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY]: JSON.stringify(customOrders),
  };

  const savedUiState = await setUiStateValues(PREMIUM_ACTIVE_ORDERS_SCOPE, nextValues, {
    source: 'premium-personeel-agenda',
    actor,
  });
  if (!savedUiState) {
    return res.status(500).json({ ok: false, error: 'Kon actieve opdrachten niet opslaan.' });
  }

  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      postCallStatus: normalizePostCallStatus(req.body?.status || appointment?.postCallStatus),
      postCallNotesTranscript: transcriptText,
      postCallPrompt: promptText,
      postCallUpdatedAt: nowIso,
      postCallUpdatedBy: actor || null,
      activeOrderId: Number(existingOrder?.id) || null,
      activeOrderAddedAt: nowIso,
      activeOrderAddedBy: actor || null,
    },
    'agenda_add_active_order'
  );

  appendDashboardActivity(
    {
      type: 'active_order_added_from_agenda',
      title: 'Toegevoegd aan actieve opdrachten',
      detail: `Afspraak omgezet naar actieve opdracht (#${Number(existingOrder?.id) || '?'})`,
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'premium-personeel-agenda',
    },
    'dashboard_activity_active_order_added'
  );

  return res.status(200).json({
    ok: true,
    order: existingOrder,
    appointment: updatedAppointment,
    alreadyExisted: hadExistingOrder,
  });
}

app.post('/api/agenda/appointments/:id/post-call', (req, res) => {
  return updateAgendaAppointmentPostCallDataById(req, res, req.params.id);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/agenda/appointment-post-call', (req, res) => {
  return updateAgendaAppointmentPostCallDataById(req, res, req.query.appointmentId);
});

app.post('/api/agenda/appointments/:id/add-active-order', async (req, res) => {
  return addAgendaAppointmentToPremiumActiveOrders(req, res, req.params.id);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/agenda/add-active-order', async (req, res) => {
  return addAgendaAppointmentToPremiumActiveOrders(req, res, req.query.appointmentId);
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
    maxMessages: Math.max(10, Math.min(400, parseIntSafe(req.body?.maxMessages, 120))),
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
    build: APP_BUILD_ID || null,
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
    build: APP_BUILD_ID || null,
    supabase: {
      enabled: isSupabaseConfigured(),
      hydrated: supabaseStateHydrated,
      table: isSupabaseConfigured() ? SUPABASE_STATE_TABLE : null,
      stateKey: isSupabaseConfigured() ? SUPABASE_STATE_KEY : null,
    },
    timestamp: new Date().toISOString(),
  });
});

async function sendRuntimeHealthDebug(_req, res) {
  const coldcallingVoice = await buildColdcallingVoiceDebugSnapshot();
  return res.status(200).json({
    ok: true,
    build: APP_BUILD_ID || null,
    timestamp: new Date().toISOString(),
    runtime: {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      appointments: generatedAgendaAppointments.length,
      callHistoryVisibleAfterMs: getColdcallingHistoryVisibleAfterMs(),
      callHistoryVisibleAfter:
        getColdcallingHistoryVisibleAfterMs() > 0
          ? new Date(getColdcallingHistoryVisibleAfterMs()).toISOString()
          : null,
      realCallUpdates: recentCallUpdates.filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith('demo-');
      }).length,
      latestVapiPayloadDebug,
      latestCustomVoiceDebug,
      coldcallingVoice,
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

async function buildColdcallingVoiceDebugSnapshot() {
  const configuredProvider = getColdcallingProvider();
  const agentId = getConfiguredElevenLabsAgentId();
  const envVoiceOverride = buildConfiguredVapiElevenLabsVoiceOverrideFromEnv();
  let agentData = null;
  let agentSource = 'none';
  let agentError = null;

  try {
    const agentResult = await getConfiguredElevenLabsAgentData();
    agentData = agentResult?.data || null;
    agentSource = normalizeString(agentResult?.source || 'none');
  } catch (error) {
    agentError = error?.message || 'Onbekende fout';
  }

  const agentVoiceOverride = agentData
    ? buildVapiElevenLabsVoiceOverrideFromAgent(agentData)
    : null;
  const explicitTtsConfig = agentData ? getElevenLabsTtsConfig(agentData) : null;
  const voiceCandidates = agentData
    ? collectLikelyElevenLabsTtsConfigs(getElevenLabsConversationConfigRoot(agentData))
        .map((candidate) => ({
          voiceId: normalizeString(
            candidate?.voiceId ||
              candidate?.voice_id ||
              candidate?.voiceID ||
              candidate?.voice?.voiceId ||
              candidate?.voice?.voice_id ||
              candidate?.voice?.id
          ),
          model: normalizeString(
            candidate?.model ||
              candidate?.model_id ||
              candidate?.voice?.model ||
              candidate?.voice?.model_id
          ),
        }))
        .filter((candidate) => candidate.voiceId)
    : [];

  let resolvedVoiceOverride = null;
  let resolvedVoiceSource = 'none';
  let resolvedVoiceError = null;

  try {
    const resolved = await getConfiguredVapiElevenLabsVoiceOverride(agentData);
    resolvedVoiceOverride = resolved?.voiceOverride || null;
    resolvedVoiceSource = normalizeString(resolved?.source || 'none');
  } catch (error) {
    resolvedVoiceError = error?.message || 'Onbekende fout';
  }

  return {
    provider: configuredProvider,
    backgroundSound: getConfiguredColdcallingBackgroundSound(),
    missingEnvForVapiColdcalling: getMissingEnvVars('vapi'),
    elevenLabs: {
      agentId,
      agentSource,
      agentError,
      agentName: normalizeString(agentData?.name || agentData?.agent?.name || ''),
      envVoiceOverride:
        envVoiceOverride && typeof envVoiceOverride === 'object'
          ? {
              voiceId: normalizeString(envVoiceOverride.voiceId),
              model: normalizeString(envVoiceOverride.model),
            }
          : null,
      agentVoiceOverride:
        agentVoiceOverride && typeof agentVoiceOverride === 'object'
          ? {
              voiceId: normalizeString(agentVoiceOverride.voiceId),
              model: normalizeString(agentVoiceOverride.model),
            }
          : null,
      explicitTtsConfig:
        explicitTtsConfig && typeof explicitTtsConfig === 'object'
          ? {
              voiceId: normalizeString(
                explicitTtsConfig.voiceId ||
                  explicitTtsConfig.voice_id ||
                  explicitTtsConfig.voice?.voiceId ||
                  explicitTtsConfig.voice?.voice_id ||
                  explicitTtsConfig.voice?.id
              ),
              model: normalizeString(
                explicitTtsConfig.model ||
                  explicitTtsConfig.model_id ||
                  explicitTtsConfig.voice?.model ||
                  explicitTtsConfig.voice?.model_id
              ),
            }
          : null,
      voiceCandidates: voiceCandidates.slice(0, 20),
      resolvedVoiceSource,
      resolvedVoiceError,
      resolvedVoiceOverride:
        resolvedVoiceOverride && typeof resolvedVoiceOverride === 'object'
          ? {
              voiceId: normalizeString(resolvedVoiceOverride.voiceId),
              model: normalizeString(resolvedVoiceOverride.model),
            }
          : null,
    },
  };
}

app.get('/api/debug/runtime-health', sendRuntimeHealthDebug);
app.get('/api/runtime-health', sendRuntimeHealthDebug);
app.get('/api/coldcalling/voice-debug', async (_req, res) => {
  const snapshot = await buildColdcallingVoiceDebugSnapshot();
  return res.status(200).json({
    ok: true,
    build: APP_BUILD_ID || null,
    timestamp: new Date().toISOString(),
    snapshot,
  });
});
app.get('/api/coldcalling/custom-voice-debug', (_req, res) => {
  return res.status(200).json({
    ok: true,
    build: APP_BUILD_ID || null,
    timestamp: new Date().toISOString(),
    snapshot: latestCustomVoiceDebug,
  });
});
app.get('/api/debug/coldcalling-voice', async (_req, res) => {
  const snapshot = await buildColdcallingVoiceDebugSnapshot();
  return res.status(200).json({
    ok: true,
    build: APP_BUILD_ID || null,
    timestamp: new Date().toISOString(),
    snapshot,
  });
});

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
    durationSeconds: 94,
    recordingUrl:
      'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==',
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
    const provider = getColdcallingProvider();
    console.log(`Softora coldcalling backend draait op http://localhost:${PORT} (provider: ${provider})`);
    if (
      provider === 'vapi' &&
      isContinuousColdcallingBackgroundSoundEnabled() &&
      normalizeString(process.env.COLDCALLING_PROVIDER).toLowerCase() === 'elevenlabs'
    ) {
      console.log(
        `[Startup] Vapi transport geforceerd voor continue background sound "${getConfiguredColdcallingBackgroundSound()}".`
      );
    }
    const missingEnv = getMissingEnvVars(provider);
    if (missingEnv.length > 0) {
      console.warn(
        `[Startup] Let op: ontbrekende env vars voor ${provider} (${missingEnv.join(', ')}). /api/coldcalling/start zal falen totdat deze zijn ingevuld.`
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
