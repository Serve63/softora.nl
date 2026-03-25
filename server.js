const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const RETELL_API_BASE_URL = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
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
const ACTIVE_ORDER_AUTOMATION_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_ENABLED || '')
);
const ACTIVE_ORDER_AUTOMATION_OUTPUT_ROOT = path.resolve(
  String(
    process.env.ACTIVE_ORDER_AUTOMATION_OUTPUT_ROOT ||
      path.join(process.cwd(), 'output', 'generated-sites')
  ).trim()
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER || process.env.GITHUB_OWNER || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE = !/^(0|false|no)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE || 'true')
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG = /^(1|true|yes)$/i.test(
  String(process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG || '')
);
const ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX || 'softora-case-'
)
  .trim()
  .toLowerCase();
const ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH = String(
  process.env.ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH || 'main'
).trim() || 'main';
const ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN || process.env.VERCEL_TOKEN || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE = String(
  process.env.ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE || process.env.VERCEL_SCOPE || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL || ''
).trim();
const ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN = String(
  process.env.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN || ''
).trim();
const VERBOSE_CALL_WEBHOOK_LOGS = /^(1|true|yes)$/i.test(
  String(process.env.VERBOSE_CALL_WEBHOOK_LOGS || '')
);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STATE_TABLE = String(process.env.SUPABASE_STATE_TABLE || 'softora_runtime_state').trim();
const SUPABASE_STATE_KEY = String(process.env.SUPABASE_STATE_KEY || 'core').trim();
const DEFAULT_TWILIO_MEDIA_WS_URL = 'wss://twilio-media-bridge-pjzd.onrender.com/twilio-media';
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
const retellCallStatusRefreshByCallId = new Map();
const RETELL_STATUS_REFRESH_COOLDOWN_MS = 8000;
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
const PREMIUM_ACTIVE_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
const PREMIUM_CUSTOMERS_SCOPE = 'premium_customers_database';
const PREMIUM_CUSTOMERS_KEY = 'softora_customers_premium_v1';
const SEO_UI_STATE_SCOPE = 'seo';
const SEO_UI_STATE_CONFIG_KEY = 'config_json';
const SEO_CONFIG_CACHE_TTL_MS = 15_000;
const SEO_MAX_IMAGES_PER_PAGE = 2000;
const SEO_PAGE_FIELD_DEFS = [
  { key: 'title', maxLength: 300 },
  { key: 'metaDescription', maxLength: 1000 },
  { key: 'metaKeywords', maxLength: 1000 },
  { key: 'canonical', maxLength: 1200 },
  { key: 'robots', maxLength: 250 },
  { key: 'ogTitle', maxLength: 300 },
  { key: 'ogDescription', maxLength: 1000 },
  { key: 'ogImage', maxLength: 1200 },
  { key: 'twitterTitle', maxLength: 300 },
  { key: 'twitterDescription', maxLength: 1000 },
  { key: 'twitterImage', maxLength: 1200 },
  { key: 'h1', maxLength: 300 },
];
let seoConfigCache = {
  loadedAtMs: 0,
  config: {
    version: 1,
    pages: {},
    images: {},
  },
};
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
    limit: '8mb',
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

function getDefaultSeoConfig() {
  return {
    version: 1,
    pages: {},
    images: {},
  };
}

function sanitizeKnownHtmlFileName(fileNameRaw) {
  const fileName = normalizeString(fileNameRaw);
  if (!fileName || !/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
  if (!knownHtmlPageFiles.has(fileName)) return '';
  return fileName;
}

function normalizeSeoFieldValue(value, maxLength = 1000) {
  return truncateText(normalizeString(value), maxLength);
}

function normalizeSeoPageOverridePatch(raw) {
  const patch = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return patch;

  for (const field of SEO_PAGE_FIELD_DEFS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field.key)) continue;
    patch[field.key] = normalizeSeoFieldValue(raw[field.key], field.maxLength);
  }
  return patch;
}

function normalizeSeoImageOverridePatch(raw) {
  const patch = {};
  if (!raw) return patch;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const src = truncateText(normalizeString(entry.src), 1800);
      if (!src) continue;
      patch[src] = truncateText(normalizeString(entry.alt), 1200);
    }
    return patch;
  }

  if (typeof raw !== 'object') return patch;

  for (const [srcRaw, altRaw] of Object.entries(raw)) {
    const src = truncateText(normalizeString(srcRaw), 1800);
    if (!src) continue;
    patch[src] = truncateText(normalizeString(altRaw), 1200);
  }
  return patch;
}

function normalizeSeoStoredPageOverrides(raw) {
  const patch = normalizeSeoPageOverridePatch(raw);
  const stored = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!value) continue;
    stored[key] = value;
  }
  return stored;
}

function normalizeSeoStoredImageOverrides(raw) {
  const patch = normalizeSeoImageOverridePatch(raw);
  const stored = {};
  for (const [src, alt] of Object.entries(patch)) {
    if (!alt) continue;
    stored[src] = alt;
  }
  return stored;
}

function normalizeSeoConfig(raw) {
  const base = getDefaultSeoConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const pagesRaw = raw.pages && typeof raw.pages === 'object' ? raw.pages : {};
  for (const [fileNameRaw, pageOverridesRaw] of Object.entries(pagesRaw)) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    if (!fileName) continue;
    const pageOverrides = normalizeSeoStoredPageOverrides(pageOverridesRaw);
    if (Object.keys(pageOverrides).length === 0) continue;
    base.pages[fileName] = pageOverrides;
  }

  const imagesRaw = raw.images && typeof raw.images === 'object' ? raw.images : {};
  for (const [fileNameRaw, imageOverridesRaw] of Object.entries(imagesRaw)) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    if (!fileName) continue;
    const imageOverrides = normalizeSeoStoredImageOverrides(imageOverridesRaw);
    if (Object.keys(imageOverrides).length === 0) continue;
    base.images[fileName] = imageOverrides;
  }

  return base;
}

async function readSeoConfigFromUiState() {
  const state = await getUiStateValues(SEO_UI_STATE_SCOPE);
  const rawJson = normalizeString(state?.values?.[SEO_UI_STATE_CONFIG_KEY] || '');
  if (!rawJson) return getDefaultSeoConfig();

  try {
    const parsed = JSON.parse(rawJson);
    return normalizeSeoConfig(parsed);
  } catch (error) {
    console.warn('[SEO Config][ParseError]', error?.message || error);
    return getDefaultSeoConfig();
  }
}

async function getSeoConfigCached(forceFresh = false) {
  const nowMs = Date.now();
  if (!forceFresh && nowMs - seoConfigCache.loadedAtMs < SEO_CONFIG_CACHE_TTL_MS) {
    return seoConfigCache.config;
  }

  const config = await readSeoConfigFromUiState();
  seoConfigCache = {
    loadedAtMs: nowMs,
    config,
  };
  return config;
}

async function persistSeoConfig(config, meta = {}) {
  const normalizedConfig = normalizeSeoConfig(config);
  const payload = {
    [SEO_UI_STATE_CONFIG_KEY]: JSON.stringify(normalizedConfig),
  };

  const state = await setUiStateValues(SEO_UI_STATE_SCOPE, payload, {
    source: normalizeString(meta.source || 'seo-dashboard'),
    actor: normalizeString(meta.actor || ''),
  });

  if (!state) return null;

  seoConfigCache = {
    loadedAtMs: Date.now(),
    config: normalizedConfig,
  };
  return normalizedConfig;
}

function getSeoEditableHtmlFiles() {
  return Array.from(knownHtmlPageFiles)
    .filter((fileName) => fileName !== 'premium-seo.html')
    .sort((a, b) => a.localeCompare(b));
}

function decodeBasicHtmlEntities(valueRaw) {
  const value = String(valueRaw || '');
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlTags(valueRaw) {
  return String(valueRaw || '').replace(/<[^>]*>/g, ' ');
}

function parseHtmlTagAttributes(tagRaw) {
  const tag = String(tagRaw || '');
  const attrs = {};
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    const key = normalizeString(match[1]).toLowerCase();
    const value = decodeBasicHtmlEntities(match[3] || match[4] || match[5] || '');
    if (!key) continue;
    attrs[key] = value;
  }
  return attrs;
}

function extractTitleFromHtml(htmlRaw) {
  const html = String(htmlRaw || '');
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return truncateText(normalizeString(decodeBasicHtmlEntities(stripHtmlTags(match[1]))), 300);
}

function extractMetaContentFromHtml(htmlRaw, selectorAttr, selectorValue) {
  const html = String(htmlRaw || '');
  const tagPattern = /<meta\b[^>]*>/gi;
  const attrName = normalizeString(selectorAttr).toLowerCase();
  const attrValue = normalizeString(selectorValue).toLowerCase();
  let match;
  while ((match = tagPattern.exec(html))) {
    const attrs = parseHtmlTagAttributes(match[0]);
    const selectedValue = normalizeString(attrs[attrName]).toLowerCase();
    if (selectedValue !== attrValue) continue;
    return truncateText(normalizeString(attrs.content || ''), 1200);
  }
  return '';
}

function extractCanonicalHrefFromHtml(htmlRaw) {
  const html = String(htmlRaw || '');
  const tagPattern = /<link\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html))) {
    const attrs = parseHtmlTagAttributes(match[0]);
    const rel = normalizeString(attrs.rel || '').toLowerCase();
    if (!rel.split(/\s+/).includes('canonical')) continue;
    return truncateText(normalizeString(attrs.href || ''), 1200);
  }
  return '';
}

function extractFirstH1FromHtml(htmlRaw) {
  const html = String(htmlRaw || '');
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return '';
  return truncateText(normalizeString(decodeBasicHtmlEntities(stripHtmlTags(match[1]))), 300);
}

function extractImageEntriesFromHtml(htmlRaw) {
  const html = String(htmlRaw || '');
  const out = [];
  const seen = new Set();
  const pattern = /<img\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (out.length >= SEO_MAX_IMAGES_PER_PAGE) break;
    const attrs = parseHtmlTagAttributes(match[0]);
    const src = truncateText(normalizeString(attrs.src || attrs['data-src'] || ''), 1800);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({
      src,
      alt: truncateText(normalizeString(attrs.alt || ''), 1200),
    });
  }
  return out;
}

function extractSeoSourceFromHtml(htmlRaw) {
  const html = String(htmlRaw || '');
  return {
    title: extractTitleFromHtml(html),
    metaDescription: extractMetaContentFromHtml(html, 'name', 'description'),
    metaKeywords: extractMetaContentFromHtml(html, 'name', 'keywords'),
    canonical: extractCanonicalHrefFromHtml(html),
    robots: extractMetaContentFromHtml(html, 'name', 'robots'),
    ogTitle: extractMetaContentFromHtml(html, 'property', 'og:title'),
    ogDescription: extractMetaContentFromHtml(html, 'property', 'og:description'),
    ogImage: extractMetaContentFromHtml(html, 'property', 'og:image'),
    twitterTitle: extractMetaContentFromHtml(html, 'name', 'twitter:title'),
    twitterDescription: extractMetaContentFromHtml(html, 'name', 'twitter:description'),
    twitterImage: extractMetaContentFromHtml(html, 'name', 'twitter:image'),
    h1: extractFirstH1FromHtml(html),
  };
}

function mergeSeoSourceWithOverrides(sourceRaw, overridesRaw) {
  const source = normalizeSeoPageOverridePatch(sourceRaw);
  const overrides = normalizeSeoStoredPageOverrides(overridesRaw);
  const merged = {};
  for (const field of SEO_PAGE_FIELD_DEFS) {
    merged[field.key] = overrides[field.key] || source[field.key] || '';
  }
  return merged;
}

function escapeHtmlAttribute(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegex(valueRaw) {
  return String(valueRaw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setOrUpdateTagAttribute(tagRaw, attrNameRaw, valueRaw) {
  const tag = String(tagRaw || '');
  const attrName = normalizeString(attrNameRaw).toLowerCase();
  if (!attrName) return tag;
  const escapedValue = escapeHtmlAttribute(valueRaw);
  const attrPattern = new RegExp(`\\s${escapeRegex(attrName)}\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)`, 'i');

  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, ` ${attrName}="${escapedValue}"`);
  }

  if (tag.endsWith('/>')) {
    return tag.replace(/\/>$/, ` ${attrName}="${escapedValue}" />`);
  }

  return tag.replace(/>$/, ` ${attrName}="${escapedValue}">`);
}

function upsertTitleInHtml(htmlRaw, title) {
  const html = String(htmlRaw || '');
  const value = normalizeSeoFieldValue(title, 300);
  if (!value) return html;

  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title>${escapeHtmlText(value)}</title>`
    );
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    <title>${escapeHtmlText(value)}</title>\n</head>`);
  }

  return html;
}

function upsertMetaInHtml(htmlRaw, selectorAttrRaw, selectorValueRaw, contentRaw) {
  const html = String(htmlRaw || '');
  const selectorAttr = normalizeString(selectorAttrRaw).toLowerCase();
  const selectorValue = normalizeString(selectorValueRaw);
  const content = normalizeString(contentRaw);

  if (!selectorAttr || !selectorValue || !content) return html;

  const tagPattern = new RegExp(
    `<meta\\b[^>]*${escapeRegex(selectorAttr)}\\s*=\\s*["']${escapeRegex(selectorValue)}["'][^>]*>`,
    'i'
  );

  if (tagPattern.test(html)) {
    return html.replace(tagPattern, (tag) => setOrUpdateTagAttribute(tag, 'content', content));
  }

  const newTag = `    <meta ${selectorAttr}="${escapeHtmlAttribute(selectorValue)}" content="${escapeHtmlAttribute(content)}">`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${newTag}\n</head>`);
  }
  return html;
}

function upsertCanonicalInHtml(htmlRaw, canonicalRaw) {
  const html = String(htmlRaw || '');
  const canonical = normalizeString(canonicalRaw);
  if (!canonical) return html;

  const tagPattern = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i;
  if (tagPattern.test(html)) {
    return html.replace(tagPattern, (tag) => setOrUpdateTagAttribute(tag, 'href', canonical));
  }

  const newTag = `    <link rel="canonical" href="${escapeHtmlAttribute(canonical)}">`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${newTag}\n</head>`);
  }
  return html;
}

function upsertFirstH1InHtml(htmlRaw, h1Raw) {
  const html = String(htmlRaw || '');
  const h1 = normalizeSeoFieldValue(h1Raw, 300);
  if (!h1) return html;

  return html.replace(/<h1\b([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${escapeHtmlText(h1)}</h1>`);
}

function applyImageAltOverridesToHtml(htmlRaw, imageOverridesRaw) {
  const html = String(htmlRaw || '');
  const imageOverrides = normalizeSeoStoredImageOverrides(imageOverridesRaw);
  if (Object.keys(imageOverrides).length === 0) return html;

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const attrs = parseHtmlTagAttributes(tag);
    const src = truncateText(normalizeString(attrs.src || attrs['data-src'] || ''), 1800);
    if (!src) return tag;
    const alt = imageOverrides[src];
    if (!alt) return tag;
    return setOrUpdateTagAttribute(tag, 'alt', alt);
  });
}

function applySeoOverridesToHtml(fileNameRaw, htmlRaw, configRaw) {
  const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
  const html = String(htmlRaw || '');
  if (!fileName || !html) return html;

  const config = normalizeSeoConfig(configRaw || {});
  const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
  const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});

  let nextHtml = html;
  if (pageOverrides.title) nextHtml = upsertTitleInHtml(nextHtml, pageOverrides.title);
  if (pageOverrides.metaDescription) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'description', pageOverrides.metaDescription);
  }
  if (pageOverrides.metaKeywords) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'keywords', pageOverrides.metaKeywords);
  }
  if (pageOverrides.canonical) nextHtml = upsertCanonicalInHtml(nextHtml, pageOverrides.canonical);
  if (pageOverrides.robots) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'robots', pageOverrides.robots);
  }
  if (pageOverrides.ogTitle) {
    nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:title', pageOverrides.ogTitle);
  }
  if (pageOverrides.ogDescription) {
    nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:description', pageOverrides.ogDescription);
  }
  if (pageOverrides.ogImage) {
    nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:image', pageOverrides.ogImage);
  }
  if (pageOverrides.twitterTitle) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:title', pageOverrides.twitterTitle);
  }
  if (pageOverrides.twitterDescription) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:description', pageOverrides.twitterDescription);
  }
  if (pageOverrides.twitterImage) {
    nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:image', pageOverrides.twitterImage);
  }
  if (pageOverrides.h1) {
    nextHtml = upsertFirstH1InHtml(nextHtml, pageOverrides.h1);
  }
  if (Object.keys(imageOverrides).length > 0) {
    nextHtml = applyImageAltOverridesToHtml(nextHtml, imageOverrides);
  }
  return nextHtml;
}

async function readHtmlPageContent(fileNameRaw) {
  const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
  if (!fileName) return '';
  try {
    return await fs.promises.readFile(path.join(__dirname, fileName), 'utf8');
  } catch (error) {
    console.error('[SEO][ReadPageError]', fileName, error?.message || error);
    return '';
  }
}

function resolveSeoPageFileFromRequest(fileRaw, slugRaw = '') {
  const directFile = sanitizeKnownHtmlFileName(fileRaw);
  if (directFile) return directFile;

  const slug = normalizeString(slugRaw).toLowerCase();
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return '';

  const mappedFile = knownPrettyPageSlugToFile.get(slug);
  return sanitizeKnownHtmlFileName(mappedFile);
}

async function sendSeoManagedHtmlPageResponse(req, res, next, fileNameRaw) {
  const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
  if (!fileName) return next();

  try {
    const html = await readHtmlPageContent(fileName);
    if (!html) return next();
    const config = await getSeoConfigCached();
    const rendered = applySeoOverridesToHtml(fileName, html, config);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(rendered);
  } catch (error) {
    console.error('[SEO][RenderPageError]', fileName, error?.message || error);
    return res.sendFile(path.join(__dirname, fileName), (sendErr) => {
      if (sendErr) next();
    });
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

function extractRetellTranscriptText(call, options = {}) {
  const maxLength = Number.isFinite(options.maxLength) ? Math.max(80, options.maxLength) : 8000;
  const preferFull = options.preferFull !== false;
  if (!call || typeof call !== 'object') return '';

  const transcript = normalizeString(call?.transcript || '');
  if (transcript) return truncateText(transcript, maxLength);

  const transcriptCandidates = [call?.transcript_with_tool_calls, call?.transcript_object];
  for (const candidate of transcriptCandidates) {
    if (!Array.isArray(candidate)) continue;
    const formatted = formatTranscriptPartsFromEntries(candidate, { preferFull, maxLength });
    if (formatted) return formatted;
  }

  return '';
}

function extractCallUpdateFromRetellPayload(payload) {
  const event = normalizeString(payload?.event || payload?.type || 'retell.webhook.unknown');
  const call = payload?.call && typeof payload.call === 'object' ? payload.call : {};
  const callId = normalizeString(call?.call_id || payload?.call_id || payload?.callId || '');
  const status = normalizeString(call?.call_status || payload?.call_status || payload?.status || '');
  const phone =
    normalizeString(call?.to_number) ||
    normalizeString(call?.metadata?.leadPhoneE164) ||
    normalizeString(call?.from_number);
  const company =
    normalizeString(call?.metadata?.leadCompany) ||
    normalizeString(call?.metadata?.company);
  const name =
    normalizeString(call?.metadata?.leadName) ||
    normalizeString(call?.metadata?.lead_name);
  const summary =
    normalizeString(call?.call_analysis?.call_summary) ||
    normalizeString(call?.call_analysis?.summary);
  const transcriptFull = extractRetellTranscriptText(call, { maxLength: 9000, preferFull: true });
  const transcriptSnippet = transcriptFull
    ? truncateText(transcriptFull.replace(/\s+/g, ' '), 450)
    : '';
  const endedReason = normalizeString(call?.disconnection_reason || '');
  const startedAt = toIsoFromUnixMilliseconds(call?.start_timestamp);
  const endedAt = toIsoFromUnixMilliseconds(call?.end_timestamp);
  const durationFromMs = parseNumberSafe(call?.duration_ms, null);
  const durationSeconds =
    Number.isFinite(durationFromMs) && durationFromMs > 0
      ? Math.max(1, Math.round(durationFromMs / 1000))
      : Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(endedAt))
        ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
        : null;
  const recordingUrl =
    normalizeString(call?.recording_url) ||
    normalizeString(call?.recording_multi_channel_url) ||
    normalizeString(call?.scrubbed_recording_url) ||
    normalizeString(call?.scrubbed_recording_multi_channel_url);
  const terminal = isTerminalColdcallingStatus(status, endedReason);
  const updatedAtMs = terminal
    ? Number(call?.end_timestamp || call?.start_timestamp || Date.now())
    : Date.now();

  if (!callId && !phone && !company && !summary && !transcriptSnippet && !status) {
    return null;
  }

  return {
    callId: callId || `retell-anon-${Date.now()}`,
    phone,
    company,
    name,
    status,
    messageType: `retell.${event || 'webhook'}`,
    summary,
    transcriptSnippet,
    transcriptFull,
    endedReason,
    startedAt,
    endedAt,
    durationSeconds,
    recordingUrl,
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    provider: 'retell',
  };
}

function extractCallUpdateFromRetellCallStatusResponse(callId, data) {
  const call =
    data && typeof data === 'object'
      ? data
      : null;
  if (!call) return null;

  const extracted = extractCallUpdateFromRetellPayload({
    event: 'call_status_fetch',
    call,
  });
  if (!extracted) return null;

  return {
    ...extracted,
    callId: normalizeString(call?.call_id || callId || extracted.callId),
    messageType: 'retell.call_status_fetch',
    updatedAtMs: Number(call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now()),
    updatedAt:
      toIsoFromUnixMilliseconds(call?.end_timestamp || call?.start_timestamp) ||
      new Date(
        Number(call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now())
      ).toISOString(),
  };
}

async function refreshCallUpdateFromRetellStatusApi(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) return null;
  if (!normalizeString(process.env.RETELL_API_KEY)) return null;

  try {
    const { data } = await fetchRetellCallStatusById(normalizedCallId);
    const update = extractCallUpdateFromRetellCallStatusResponse(normalizedCallId, data);
    if (!update) return null;
    return upsertRecentCallUpdate(update);
  } catch (error) {
    console.warn(
      '[Retell Call Status Refresh Failed]',
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

function shouldRefreshRetellCallStatus(update, nowMs = Date.now()) {
  const callId = normalizeString(update?.callId || '');
  if (!callId || !callId.startsWith('call_')) return false;

  const provider = normalizeString(update?.provider || 'retell').toLowerCase();
  if (provider && provider !== 'retell') return false;

  const status = normalizeString(update?.status || '').toLowerCase();
  const endedReason = normalizeString(update?.endedReason || '');
  if (isTerminalColdcallingStatus(status, endedReason)) {
    retellCallStatusRefreshByCallId.delete(callId);
    return false;
  }

  const updatedAtMs = Number(update?.updatedAtMs || 0);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && nowMs - updatedAtMs < 2500) {
    return false;
  }

  const lastRefreshMs = Number(retellCallStatusRefreshByCallId.get(callId) || 0);
  if (Number.isFinite(lastRefreshMs) && nowMs - lastRefreshMs < RETELL_STATUS_REFRESH_COOLDOWN_MS) {
    return false;
  }

  retellCallStatusRefreshByCallId.set(callId, nowMs);
  return true;
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

  callUpdatesById.set(merged.callId, merged);

  if (isTerminalColdcallingStatus(merged.status, merged.endedReason)) {
    retellCallStatusRefreshByCallId.delete(merged.callId);
  }

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

function getRequiredRetellEnv() {
  return ['RETELL_API_KEY', 'RETELL_FROM_NUMBER', 'RETELL_AGENT_ID'];
}

function isRetellColdcallingConfigured() {
  return getRequiredRetellEnv().every((key) => normalizeString(process.env[key]));
}

function getColdcallingProvider() {
  const configured = normalizeString(process.env.COLDCALLING_PROVIDER).toLowerCase();
  if (configured === 'retell') return 'retell';
  if (isRetellColdcallingConfigured()) return 'retell';
  return 'retell';
}

function getMissingEnvVars(provider = getColdcallingProvider()) {
  if (provider === 'retell') {
    return getRequiredRetellEnv().filter((key) => !process.env[key]);
  }
  return getRequiredRetellEnv().filter((key) => !process.env[key]);
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

async function extractMeetingNotesFromImageWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const imageDataUrl = normalizeString(options.imageDataUrl || options.image || '').replace(/\s+/g, '');
  if (!imageDataUrl) {
    const err = new Error('Afbeelding ontbreekt');
    err.status = 400;
    throw err;
  }
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(imageDataUrl)) {
    const err = new Error('Ongeldige afbeelding. Gebruik PNG, JPG of WEBP als data URL.');
    err.status = 400;
    throw err;
  }
  if (imageDataUrl.length > 900000) {
    const err = new Error('Afbeelding te groot. Lever een compactere foto aan.');
    err.status = 413;
    throw err;
  }

  const language = normalizeString(options.language || 'nl') || 'nl';
  const systemPrompt = [
    'Je bent een nauwkeurige notitie-assistent.',
    'Lees de geuploade foto van meetingnotities en zet dit om naar leesbare tekst.',
    'Verzin geen feiten. Als een woord onduidelijk is, gebruik [ONLEESBAAR].',
    'Output exact JSON met veld "transcript". Geen markdown, geen extra velden.',
  ].join('\n');

  const userPrompt = [
    `Taal voor transcript: ${language}.`,
    'Zet de notities om naar een compacte, duidelijke transcriptie met regeleinden.',
    'Behoud concrete wensen, functionaliteiten, planning, budget en stijlkeuzes als die zichtbaar zijn.',
    'Output JSON voorbeeld: {"transcript":"..."}',
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
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    },
    70000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI image-notes extractie mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const textContent = normalizeString(extractOpenAiTextContent(content));
  if (!textContent) {
    const err = new Error('OpenAI gaf geen notities terug uit de afbeelding.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  const parsed = parseJsonLoose(textContent);
  const transcript = truncateText(
    normalizeString(
      parsed && typeof parsed === 'object' && typeof parsed.transcript === 'string'
        ? parsed.transcript
        : textContent
    ),
    20000
  );

  if (!transcript) {
    const err = new Error('Er kon geen transcriptie uit de notitiefoto worden gehaald.');
    err.status = 502;
    throw err;
  }

  return {
    transcript,
    source: 'openai-vision',
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
  const referenceImages = sanitizeReferenceImages(options.referenceImages || options.attachments || [], {
    maxItems: 6,
    maxBytesPerImage: 550 * 1024,
    maxTotalBytes: 3 * 1024 * 1024,
  });
  const industry = inferWebsiteIndustryProfile({ company, title, description, promptText });

  return {
    company,
    title,
    description,
    language,
    promptText,
    referenceImages,
    industry,
  };
}

function buildWebsiteGenerationPrompts(options = {}) {
  const context = buildWebsiteGenerationContext(options);
  const { company, title, description, language, promptText, referenceImages, industry } = context;

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
    referenceImages.length ? `<reference_image_count>${referenceImages.length}</reference_image_count>` : '',
    referenceImages.length
      ? `<reference_images>${escapeHtml(referenceImages.map((item) => item.name).join(', '))}</reference_images>`
      : '',
    '<quality_bar>',
    'Maak een premium website die voelt als maatwerk, niet als template.',
    'Zorg dat compositie, breedtes, hiërarchie, witruimte, CTA-flow en mobiele layout coherent zijn.',
    'Gebruik een duidelijk visueel systeem: sterke typografie, ritme tussen secties, onderscheidende hero en consequente componenten.',
    'Als informatie ontbreekt, vul dan geen nep-feiten in maar ontwerp de structuur slim en geloofwaardig.',
    referenceImages.length
      ? 'Gebruik de meegeleverde referentiebeelden als visuele input voor stijl, compositie en sfeer.'
      : '',
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
  const { company, title, description, language, promptText, referenceImages } = context;

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
    referenceImages.length ? `<reference_image_count>${referenceImages.length}</reference_image_count>` : '',
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
    referenceImages.length
      ? '- Er zijn referentiebeelden meegestuurd: gebruik die als visuele richting voor stijl, compositie en sfeer.'
      : '',
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
  const referenceImages = sanitizeReferenceImages(options.referenceImages || options.attachments || [], {
    maxItems: 6,
    maxBytesPerImage: 550 * 1024,
    maxTotalBytes: 3 * 1024 * 1024,
  });
  const imageBlocks = referenceImages
    .map((item) => {
      const parsed = parseImageDataUrl(item?.dataUrl || '');
      if (!parsed) return null;
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mimeType,
          data: parsed.base64Payload,
        },
      };
    })
    .filter(Boolean);
  const userContentBlocks = [
    ...imageBlocks,
    { type: 'text', text: userPrompt },
  ];

  const basePayload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContentBlocks,
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

  const { company, title, userPrompt, systemPrompt, referenceImages } = buildWebsiteGenerationPrompts(options);
  const userContent = referenceImages.length
    ? [
        { type: 'text', text: userPrompt },
        ...referenceImages.map((item) => ({
          type: 'image_url',
          image_url: { url: item.dataUrl },
        })),
      ]
    : userPrompt;

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
          { role: 'user', content: userContent },
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
    referenceImages: buildPrompts.referenceImages,
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

  const callSummaryStrong =
    /er is een afspraak ingepland|afspraak ingepland|afspraak gepland|intake ingepland/.test(lower);

  const appointmentBooked = hasAppointmentLanguage || callSummaryStrong;
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
      ? 'Bevestigingsmail sturen op basis van gedetecteerde afspraak in gesprekstranscriptie.'
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

function sanitizeAppointmentLocation(value) {
  return truncateText(normalizeString(value || ''), 220);
}

function sanitizeAppointmentWhatsappInfo(value) {
  return truncateText(normalizeString(value || ''), 6000);
}

function buildLeadToAgendaSummary(baseSummary, location, whatsappInfo) {
  const parts = [];
  const summaryText = normalizeString(baseSummary || '');
  const locationText = sanitizeAppointmentLocation(location || '');
  const whatsappText = sanitizeAppointmentWhatsappInfo(whatsappInfo || '');

  if (summaryText) parts.push(summaryText);
  if (locationText) parts.push(`Locatie afspraak: ${locationText}`);
  if (whatsappText) parts.push(`Overige info uit WhatsApp:\n${whatsappText}`);

  const merged = parts.join('\n\n');
  return truncateText(merged, 4000) || 'Lead handmatig ingepland vanuit Leads.';
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
    location: sanitizeAppointmentLocation(appointment.location || appointment.appointmentLocation || ''),
    whatsappInfo: sanitizeAppointmentWhatsappInfo(
      appointment.whatsappInfo || appointment.whatsappNotes || appointment.whatsapp || ''
    ),
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
  const recordingUrl = normalizeString(
    callUpdate?.recordingUrl ||
      callUpdate?.recording_url ||
      callUpdate?.recordingUrlProxy ||
      callUpdate?.audioUrl ||
      appointment?.recordingUrl ||
      appointment?.recording_url ||
      appointment?.recordingUrlProxy ||
      appointment?.audioUrl ||
      ''
  );

  return {
    ...task,
    contactEmail: normalizeEmailAddress(appointment.contactEmail || appointment.email || '') || '',
    location: sanitizeAppointmentLocation(appointment.location || appointment.appointmentLocation || ''),
    whatsappInfo: sanitizeAppointmentWhatsappInfo(
      appointment.whatsappInfo || appointment.whatsappNotes || appointment.whatsapp || ''
    ),
    transcript,
    transcriptAvailable: Boolean(transcript),
    recordingUrl,
    recordingUrlAvailable: Boolean(recordingUrl),
    callSummary: normalizeString(callUpdate?.summary || ''),
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
    source: 'AI Cold Calling (Retell + AI)',
    summary: summary || 'AI-samenvatting aangemaakt op basis van call update.',
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
      callSummary: callUpdate.summary,
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
    normalizeString(detail?.aiSummary || detail?.callSummary || appointment?.summary || '').trim() ||
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
      callSummary: truncateText(normalizeString(detail?.callSummary || ''), 1000),
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

async function createRetellOutboundCall(payload) {
  const endpoint = '/v2/create-phone-call';
  const { response, data } = await fetchJsonWithTimeout(
    buildRetellApiUrl(endpoint),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    15000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message ||
        data?.error ||
        data?.detail ||
        data?.raw ||
        `Retell API fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

async function fetchRetellCallStatusById(callId) {
  const normalizedCallId = normalizeString(callId);
  if (!normalizedCallId) {
    throw new Error('callId ontbreekt');
  }

  const endpoint = `/v2/get-call/${encodeURIComponent(normalizedCallId)}`;
  const { response, data } = await fetchJsonWithTimeout(
    buildRetellApiUrl(endpoint),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    },
    10000
  );

  if (!response.ok) {
    const statusError = new Error(
      data?.message || data?.error || data?.detail || data?.raw || `Retell call status fout (${response.status})`
    );
    statusError.status = response.status;
    statusError.endpoint = endpoint;
    statusError.data = data;
    throw statusError;
  }

  return { endpoint, data };
}

function classifyRetellFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  const detailText = JSON.stringify(error?.data || {}).toLowerCase();
  const combined = `${message} ${detailText}`;
  const status = Number(error?.status || 0);

  if (
    status === 402 ||
    /credit|credits|balance|billing|payment required|insufficient funds|no_valid_payment/.test(combined)
  ) {
    return {
      cause: 'credits',
      explanation: 'Waarschijnlijk onvoldoende Retell-credits/balance om de call te starten.',
    };
  }

  if (status === 401 || /unauthorized|invalid api key|bearer/.test(combined)) {
    return {
      cause: 'wrong retell api key',
      explanation: 'RETELL_API_KEY lijkt ongeldig of ontbreekt.',
    };
  }

  if (/override_agent_id|agent/.test(combined) && /(invalid|unknown|not found|missing|does not exist)/.test(combined)) {
    return {
      cause: 'wrong retell agent',
      explanation: 'RETELL_AGENT_ID lijkt ongeldig of niet beschikbaar.',
    };
  }

  if (
    /from_number|to_number|invalid_destination|e\\.164|phone|number|nummer/.test(combined) &&
    /(invalid|format|not found|permission|omzetten|ongeldig)/.test(combined)
  ) {
    return {
      cause: 'invalid number',
      explanation: 'Het doelnummer of belnummer voor Retell is ongeldig of niet toegestaan.',
    };
  }

  if (/dynamic variables?|retell_llm_dynamic_variables|key value pairs of strings/.test(combined)) {
    return {
      cause: 'invalid dynamic variables',
      explanation:
        'Retell verwacht platte dynamic variables met alleen string-waarden. De payload is nu aangepast om alleen string -> string mee te sturen.',
    };
  }

  if (
    status >= 500 ||
    /provider|carrier|telecom|twilio|sip|timeout|temporar|rate limit|service unavailable|unavailable/.test(
      combined
    )
  ) {
    return {
      cause: 'provider issue',
      explanation: 'Waarschijnlijk een issue bij Retell/provider/carrier (tijdelijk of extern).',
    };
  }

  return {
    cause: 'unknown',
    explanation:
      'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte foutmelding en Retell response body.',
  };
}

function buildVariableValues(lead, campaign) {
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
  const minProjectValue = parseNumberSafe(campaign.minProjectValue, null);
  const maxDiscountPct = parseNumberSafe(campaign.maxDiscountPct, null);
  const rawValues = {
    name: normalizeString(lead.name),
    company: normalizeString(lead.company),
    sector: normalizeString(campaign.sector),
    region: effectiveRegion,
    minProjectValue: Number.isFinite(minProjectValue) ? String(minProjectValue) : '',
    maxDiscountPct: Number.isFinite(maxDiscountPct) ? String(maxDiscountPct) : '',
    extraInstructions: normalizeString(campaign.extraInstructions),
  };

  return Object.fromEntries(
    Object.entries(rawValues).filter(
      ([key, value]) => normalizeString(key) && typeof value === 'string'
    )
  );
}

function buildRetellApiUrl(relativePath, searchParams = null) {
  const normalizedBase = `${normalizeString(RETELL_API_BASE_URL).replace(/\/+$/, '')}/`;
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

function toIsoFromUnixMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  if (numeric < 1e11) {
    return new Date(numeric * 1000).toISOString();
  }
  return new Date(numeric).toISOString();
}

function isTerminalColdcallingStatus(status, endedReason = '') {
  const combined = `${normalizeString(status).toLowerCase()} ${normalizeString(endedReason).toLowerCase()}`;
  return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|done|error|not_connected|dial_)/.test(
    combined
  );
}

function buildRetellPayload(lead, campaign) {
  const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
  const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
  const overrideAgentId = normalizeString(process.env.RETELL_AGENT_ID);
  const overrideAgentVersion = parseIntSafe(process.env.RETELL_AGENT_VERSION, 0);

  return {
    from_number: normalizeString(process.env.RETELL_FROM_NUMBER),
    to_number: normalizedPhone,
    ...(overrideAgentId ? { override_agent_id: overrideAgentId } : {}),
    ...(overrideAgentVersion > 0 ? { override_agent_version: overrideAgentVersion } : {}),
    retell_llm_dynamic_variables: buildVariableValues(
      {
        ...lead,
        phone: normalizedPhone,
      },
      campaign
    ),
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

async function processRetellColdcallingLead(lead, campaign, index) {
  try {
    const payload = buildRetellPayload(lead, campaign);
    const normalizedPhone = payload.to_number;
    const { endpoint, data } = await createRetellOutboundCall(payload);
    const callId = normalizeString(data?.call_id || data?.callId || data?.id);
    const callStatus = normalizeString(data?.call_status || data?.status || 'registered');
    let latestUpdate = null;

    if (callId) {
      latestUpdate = upsertRecentCallUpdate({
        callId,
        phone: normalizedPhone,
        company: normalizeString(lead.company),
        name: normalizeString(lead.name),
        status: callStatus,
        messageType: 'coldcalling.start.response',
        summary: '',
        transcriptSnippet: '',
        endedReason: '',
        startedAt: toIsoFromUnixMilliseconds(data?.start_timestamp) || new Date().toISOString(),
        endedAt: '',
        durationSeconds: null,
        recordingUrl: '',
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        provider: 'retell',
      });

      // Bij sommige providerfouten (zoals dial_failed) wordt de call vrijwel direct terminal.
      // Een korte status-refresh voorkomt dat de UI vals "gestart" meldt.
      if (/^(registered|queued|initiated|dialing)$/i.test(callStatus)) {
        await sleep(1200);
        const refreshed = await refreshCallUpdateFromRetellStatusApi(callId);
        if (refreshed) {
          latestUpdate = refreshed;
        }
      }
    }

    const effectiveStatus = normalizeString(latestUpdate?.status || callStatus).toLowerCase();
    const effectiveEndedReason = normalizeString(latestUpdate?.endedReason || '');
    const effectiveStartedAt = normalizeString(
      latestUpdate?.startedAt || toIsoFromUnixMilliseconds(data?.start_timestamp) || new Date().toISOString()
    );

    if (
      effectiveStatus === 'not_connected' ||
      /dial_failed|dial-failed|dial failed/.test(effectiveEndedReason.toLowerCase())
    ) {
      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
          region: normalizeString(lead.region),
          phoneE164: normalizedPhone,
        },
        error: `Call kon niet verbinden (${effectiveEndedReason || effectiveStatus || 'onbekende reden'}).`,
        statusCode: null,
        cause: 'dial failed',
        causeExplanation:
          'Retell kon het gesprek niet opzetten. Controleer outbound nummer/SIP-auth configuratie in Retell.',
        details: {
          endpoint,
          callId,
          status: effectiveStatus,
          endedReason: effectiveEndedReason,
          startedAt: effectiveStartedAt,
        },
      };
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
      call: {
        endpoint,
        callId,
        status: effectiveStatus || callStatus,
        endedReason: effectiveEndedReason,
      },
    };
  } catch (error) {
    const failure = classifyRetellFailure(error);
    console.error(
      '[Coldcalling][Lead Error]',
      JSON.stringify(
        {
          provider: 'retell',
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
  return processRetellColdcallingLead(lead, campaign, index);
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
    /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|error|not_connected|dial_)/.test(
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

      const callId = normalizeString(result?.call?.callId);
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

  const headerCandidates = [req.get('x-retell-signature'), req.get('authorization')].filter(Boolean);

  for (const candidate of headerCandidates) {
    if (candidate === secret) return true;
    if (candidate.toLowerCase().startsWith('bearer ') && candidate.slice(7).trim() === secret) {
      return true;
    }
  }

  return false;
}

function parseRetellSignatureHeader(signatureHeader) {
  const raw = normalizeString(signatureHeader);
  if (!raw) return null;
  const match = raw.match(/v=(\d+),d=([a-fA-F0-9]+)/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  const digest = normalizeString(match[2]).toLowerCase();
  if (!Number.isFinite(timestamp) || !digest) return null;
  return { timestamp, digest };
}

function verifyRetellWebhookSignature(req, maxSkewMs = 5 * 60 * 1000) {
  const apiKey = normalizeString(process.env.RETELL_API_KEY);
  const signatureHeader = normalizeString(req.get('x-retell-signature'));
  if (!apiKey || !signatureHeader) return false;

  const parsed = parseRetellSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const now = Date.now();
  if (Math.abs(now - parsed.timestamp) > maxSkewMs) {
    return false;
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : normalizeString(req.rawBody) || JSON.stringify(req.body || {});
  const expectedDigest = crypto
    .createHmac('sha256', apiKey)
    .update(`${rawBody}${parsed.timestamp}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const incomingBuffer = Buffer.from(parsed.digest, 'hex');
  if (expectedBuffer.length !== incomingBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
}

function isRetellWebhookAuthorized(req) {
  const hasSecret = Boolean(normalizeString(process.env.WEBHOOK_SECRET));
  const secretAuthorized = isWebhookAuthorized(req);
  const hasRetellSignature = Boolean(normalizeString(req.get('x-retell-signature')));
  const signatureAuthorized = hasRetellSignature ? verifyRetellWebhookSignature(req) : false;

  if (hasSecret) {
    return secretAuthorized || signatureAuthorized;
  }

  if (hasRetellSignature) {
    return signatureAuthorized;
  }

  return true;
}

async function sendColdcallingStatusResponse(res, callId) {
  const cached = callUpdatesById.get(callId) || null;
  const provider = 'retell';

  if (provider === 'retell') {
    if (!normalizeString(process.env.RETELL_API_KEY)) {
      if (cached) {
        return res.status(200).json({
          ok: true,
          source: 'cache',
          provider: 'retell',
          callId: normalizeString(cached.callId || callId),
          status: normalizeString(cached.status || ''),
          endedReason: normalizeString(cached.endedReason || ''),
          startedAt: normalizeString(cached.startedAt || ''),
          endedAt: normalizeString(cached.endedAt || ''),
          durationSeconds: parseNumberSafe(cached.durationSeconds, null),
          recordingUrl: normalizeString(cached.recordingUrl || ''),
        });
      }
      return res.status(500).json({ ok: false, error: 'RETELL_API_KEY ontbreekt op server.' });
    }

    try {
      const { endpoint, data } = await fetchRetellCallStatusById(callId);
      const update = extractCallUpdateFromRetellCallStatusResponse(callId, data);
      if (update) {
        upsertRecentCallUpdate(update);
        triggerPostCallAutomation(update);
      }

      return res.status(200).json({
        ok: true,
        endpoint,
        source: 'retell',
        provider: 'retell',
        callId: normalizeString(update?.callId || data?.call_id || callId),
        status: normalizeString(update?.status || data?.call_status || ''),
        endedReason: normalizeString(update?.endedReason || data?.disconnection_reason || ''),
        startedAt: normalizeString(update?.startedAt || toIsoFromUnixMilliseconds(data?.start_timestamp)),
        endedAt: normalizeString(update?.endedAt || toIsoFromUnixMilliseconds(data?.end_timestamp)),
        durationSeconds:
          parseNumberSafe(update?.durationSeconds, null) ||
          (Number.isFinite(Number(data?.duration_ms)) && Number(data.duration_ms) > 0
            ? Math.max(1, Math.round(Number(data.duration_ms) / 1000))
            : null),
        recordingUrl: normalizeString(
          update?.recordingUrl ||
            data?.recording_url ||
            data?.recording_multi_channel_url ||
            data?.scrubbed_recording_url ||
            ''
        ),
      });
    } catch (error) {
      return res.status(Number(error?.status || 500)).json({
        ok: false,
        error: error?.message || 'Kon Retell call status niet ophalen.',
        endpoint: error?.endpoint || null,
        details: error?.data || null,
      });
    }
  }
}

function buildTwilioAllowedCallerSet() {
  const raw = normalizeString(process.env.TWILIO_ALLOWED_CALLERS || '');
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\n]/)
      .map((item) => normalizePhoneForTwilioMatch(item))
      .filter(Boolean)
  );
}

function normalizePhoneForTwilioMatch(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `31${digits.slice(1)}`;
  return digits;
}

function isTwilioInboundCallerAllowed(rawCaller) {
  const allowed = buildTwilioAllowedCallerSet();
  if (allowed.size === 0) return true;
  const normalizedCaller = normalizePhoneForTwilioMatch(rawCaller);
  if (!normalizedCaller) return false;
  return allowed.has(normalizedCaller);
}

function sendTwimlXml(res, xml) {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}

function handleTwilioInboundVoice(req, res) {
  const caller = normalizeString(req.body?.From || req.query?.From || '');

  if (!isTwilioInboundCallerAllowed(caller)) {
    return sendTwimlXml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="rejected" />
</Response>`
    );
  }

  const mediaWsUrl = normalizeString(process.env.TWILIO_MEDIA_WS_URL || DEFAULT_TWILIO_MEDIA_WS_URL);
  if (!/^wss?:\/\//i.test(mediaWsUrl)) {
    return res.status(500).json({
      ok: false,
      error: 'TWILIO_MEDIA_WS_URL ontbreekt of is ongeldig (verwacht ws:// of wss:// URL).',
      value: mediaWsUrl || null,
    });
  }

  return sendTwimlXml(
    res,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeHtml(mediaWsUrl)}" />
  </Connect>
</Response>`
  );
}

app.get('/api/twilio/voice', handleTwilioInboundVoice);
app.post('/api/twilio/voice', express.urlencoded({ extended: false }), handleTwilioInboundVoice);

app.post('/api/coldcalling/start', async (req, res) => {
  const provider = getColdcallingProvider();
  const missingEnv = getMissingEnvVars(provider);

  if (missingEnv.length > 0) {
    return res.status(500).json({
      ok: false,
      error: 'Server mist vereiste environment variables voor Retell outbound calling.',
      missingEnv,
      provider,
    });
  }

  const validated = validateStartPayload(req.body);
  if (validated.error) {
    return res.status(400).json({ ok: false, error: validated.error });
  }

  const { campaign, leads } = validated;
  const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));

  console.log(
    `[Coldcalling] Start campagne ontvangen via ${provider}: ${leadsToProcess.length}/${leads.length} leads, sector="${campaign.sector}", regio="${campaign.region}", mode="${campaign.dispatchMode}", delay=${campaign.dispatchDelaySeconds}s`
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
        provider,
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
      provider,
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

app.post('/api/retell/webhook', (req, res) => {
  if (!isRetellWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Retell webhook signature/secret ongeldig.' });
  }

  const eventType = normalizeString(req.body?.event || req.body?.type || 'unknown');
  const callData = req.body?.call && typeof req.body.call === 'object' ? req.body.call : null;

  const record = {
    receivedAt: new Date().toISOString(),
    messageType: `retell.${eventType || 'unknown'}`,
    callId: normalizeString(callData?.call_id || ''),
    callStatus: normalizeString(callData?.call_status || ''),
    payload: req.body,
  };

  recentWebhookEvents.unshift(record);
  if (recentWebhookEvents.length > 200) {
    recentWebhookEvents.pop();
  }

  if (VERBOSE_CALL_WEBHOOK_LOGS) {
    console.log(
      '[Retell Webhook]',
      JSON.stringify(
        {
          eventType,
          call: callData,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      '[Retell Webhook]',
      JSON.stringify({
        eventType,
        callId: normalizeString(callData?.call_id || ''),
        status: normalizeString(callData?.call_status || ''),
        endedReason: normalizeString(callData?.disconnection_reason || ''),
      })
    );
  }

  const callUpdate = upsertRecentCallUpdate(extractCallUpdateFromRetellPayload(req.body));
  if (callUpdate) {
    triggerPostCallAutomation(callUpdate);
  }

  return res.status(200).json({ ok: true });
});

app.get('/api/coldcalling/call-updates', async (req, res) => {
  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 200)));
  const sinceMs = parseNumberSafe(req.query.sinceMs, null);
  const nowMs = Date.now();

  const callIdsToRefresh = [];
  const seenCallIds = new Set();
  for (const item of recentCallUpdates) {
    if (callIdsToRefresh.length >= 8) break;
    const callId = normalizeString(item?.callId || '');
    if (!callId || seenCallIds.has(callId)) continue;
    if (!shouldRefreshRetellCallStatus(item, nowMs)) continue;
    seenCallIds.add(callId);
    callIdsToRefresh.push(callId);
  }

  if (callIdsToRefresh.length > 0) {
    await Promise.allSettled(
      callIdsToRefresh.map(async (callId) => {
        await refreshCallUpdateFromRetellStatusApi(callId);
      })
    );
  }

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

app.get('/api/coldcalling/webhook-debug', (req, res) => {
  const limit = Math.max(1, Math.min(100, parseIntSafe(req.query.limit, 20)));
  const demoCallIdPrefix = 'demo-';

  const latestWebhookEvents = recentWebhookEvents.slice(0, limit).map((event) => {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
    const call = payload?.call && typeof payload.call === 'object' ? payload.call : null;

    return {
      receivedAt: normalizeString(event?.receivedAt || ''),
      messageType: normalizeString(event?.messageType || ''),
      callId: normalizeString(event?.callId || call?.call_id || ''),
      callStatus: normalizeString(event?.callStatus || call?.call_status || ''),
      endedReason: normalizeString(call?.disconnection_reason || ''),
      topLevelKeys: payload ? Object.keys(payload).slice(0, 30) : [],
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

function normalizeDashboardChatHistory(historyRaw) {
  if (!Array.isArray(historyRaw)) return [];
  return historyRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const roleRaw = normalizeString(item.role || '').toLowerCase();
      const role = roleRaw === 'assistant' ? 'assistant' : 'user';
      const content = truncateText(normalizeString(item.content || ''), 3000);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-12);
}

function parseDashboardChatRuntimeByOrderId(rawValue) {
  const parsed = parseJsonLoose(rawValue);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out = {};
  for (const [rawId, rawRuntime] of Object.entries(parsed)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!rawRuntime || typeof rawRuntime !== 'object' || Array.isArray(rawRuntime)) continue;
    out[String(id)] = {
      statusKey: normalizeString(rawRuntime.statusKey || ''),
      progressPct: parseNumberSafe(rawRuntime.progressPct, null),
      paidAt: normalizeString(rawRuntime.paidAt || ''),
      updatedAt: parseNumberSafe(rawRuntime.updatedAt, 0),
    };
  }
  return out;
}

function parseDashboardChatCustomers(rawValue) {
  const parsed = parseJsonLoose(rawValue);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;

      const legacyAmount = parseNumberSafe(item.bedrag, null);
      const type = truncateText(normalizeString(item.type || 'Website'), 80) || 'Website';
      const websiteRaw = parseNumberSafe(item.websiteBedrag, null);
      const maintenanceRaw = parseNumberSafe(item.onderhoudPerMaand, null);

      const websiteBedrag = Number.isFinite(websiteRaw)
        ? Math.max(0, Math.round(websiteRaw))
        : ((type === 'Website' || type === 'Website + onderhoud') && Number.isFinite(legacyAmount)
            ? Math.max(0, Math.round(legacyAmount))
            : null);

      const onderhoudPerMaand = Number.isFinite(maintenanceRaw)
        ? Math.max(0, Math.round(maintenanceRaw))
        : (type === 'Onderhoud' && Number.isFinite(legacyAmount)
            ? Math.max(0, Math.round(legacyAmount))
            : null);

      const statusRaw = normalizeString(item.status || '').toLowerCase();
      const status = statusRaw === 'open' ? 'Open' : 'Betaald';

      return {
        id: normalizeString(item.id || '') || `dashboard-customer-${index + 1}`,
        naam: truncateText(normalizeString(item.naam || ''), 160) || 'Onbekend',
        bedrijf: truncateText(normalizeString(item.bedrijf || ''), 160) || '-',
        telefoon: truncateText(normalizeString(item.telefoon || ''), 80) || '-',
        website: truncateText(normalizeString(item.website || ''), 220) || '-',
        type,
        status,
        datum: normalizeDateYyyyMmDd(item.datum || ''),
        websiteBedrag,
        onderhoudPerMaand,
      };
    })
    .filter(Boolean);
}

function buildDashboardChatStatusCounts(rows, fieldName, fallback = 'Onbekend') {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = truncateText(normalizeString(row?.[fieldName] || ''), 80) || fallback;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function trimDashboardChatContextForModel(rawContext, maxChars = 52000) {
  const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
  const cloned = JSON.parse(JSON.stringify(context));

  const listTargets = [
    ['orders', 'items', 24],
    ['customers', 'items', 30],
    ['calls', 'items', 24],
    ['agenda', 'items', 24],
    ['aiCallInsights', 'items', 24],
    ['recentActivities', null, 24],
  ];

  const safeStringify = () => {
    try {
      return JSON.stringify(cloned);
    } catch {
      return '{}';
    }
  };

  let serialized = safeStringify();
  if (serialized.length <= maxChars) return cloned;

  for (const [section, key, minCount] of listTargets) {
    const current =
      key === null
        ? (Array.isArray(cloned?.[section]) ? cloned[section] : null)
        : (Array.isArray(cloned?.[section]?.[key]) ? cloned[section][key] : null);
    if (!current || current.length <= minCount) continue;

    const reduced = current.slice(0, Math.max(minCount, Math.floor(current.length / 2)));
    if (key === null) cloned[section] = reduced;
    else cloned[section][key] = reduced;

    serialized = safeStringify();
    if (serialized.length <= maxChars) return cloned;
  }

  for (const [section, key, minCount] of listTargets) {
    const current =
      key === null
        ? (Array.isArray(cloned?.[section]) ? cloned[section] : null)
        : (Array.isArray(cloned?.[section]?.[key]) ? cloned[section][key] : null);
    if (!current || current.length <= minCount) continue;
    const reduced = current.slice(0, minCount);
    if (key === null) cloned[section] = reduced;
    else cloned[section][key] = reduced;
  }

  serialized = safeStringify();
  if (serialized.length <= maxChars) return cloned;

  for (const [section, key] of listTargets) {
    if (key === null) cloned[section] = [];
    else if (cloned?.[section] && typeof cloned[section] === 'object') cloned[section][key] = [];
  }

  return cloned;
}

async function buildPremiumDashboardChatContext() {
  const [orderState, customerState] = await Promise.all([
    getUiStateValues(PREMIUM_ACTIVE_ORDERS_SCOPE),
    getUiStateValues(PREMIUM_CUSTOMERS_SCOPE),
  ]);

  const orderValues = orderState?.values && typeof orderState.values === 'object' ? orderState.values : {};
  const customerValues =
    customerState?.values && typeof customerState.values === 'object' ? customerState.values : {};

  const customOrders = parseCustomOrdersFromUiState(orderValues[PREMIUM_ACTIVE_CUSTOM_ORDERS_KEY]);
  const runtimeByOrderId = parseDashboardChatRuntimeByOrderId(orderValues[PREMIUM_ACTIVE_RUNTIME_KEY]);
  const customers = parseDashboardChatCustomers(customerValues[PREMIUM_CUSTOMERS_KEY]);

  const orders = customOrders
    .map((item) => {
      const runtime = runtimeByOrderId[String(item.id)] || {};
      const paidAt = normalizeString(runtime.paidAt || item.paidAt || '');
      const updatedAtRaw =
        (Number.isFinite(Number(runtime.updatedAt)) && Number(runtime.updatedAt) > 0
          ? Number(runtime.updatedAt)
          : Date.parse(normalizeString(item.updatedAt || item.createdAt || ''))) || 0;
      return {
        id: Number(item.id) || null,
        klant: truncateText(normalizeString(item.clientName || ''), 160),
        titel: truncateText(normalizeString(item.title || ''), 220),
        locatie: truncateText(normalizeString(item.location || ''), 160),
        status: truncateText(normalizeString(runtime.statusKey || item.status || ''), 80) || 'wacht',
        bedragEur: Math.max(0, Math.round(Number(item.amount) || 0)),
        betaaldOp: paidAt ? paidAt.slice(0, 10) : '',
        laatstBijgewerkt: normalizeString(item.updatedAt || item.createdAt || ''),
        updatedAtMs: Number(updatedAtRaw) || 0,
      };
    })
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

  const callUpdates = recentCallUpdates
    .map((item) => {
      const updatedAt =
        normalizeString(item?.updatedAt || item?.createdAt || '') || new Date().toISOString();
      const updatedAtMs =
        (Number.isFinite(Number(item?.updatedAtMs)) && Number(item.updatedAtMs) > 0
          ? Number(item.updatedAtMs)
          : Date.parse(updatedAt)) || 0;
      const recordingUrl =
        normalizeString(item?.recordingUrl || '') ||
        normalizeString(item?.recording_url || '') ||
        normalizeString(item?.recordingUrlProxy || '') ||
        normalizeString(item?.audioUrl || '');
      const hasRecording =
        Boolean(recordingUrl) ||
        toBooleanSafe(item?.recorded, false) ||
        toBooleanSafe(item?.hasRecording, false);

      return {
        callId: truncateText(normalizeString(item?.callId || ''), 160),
        bedrijf: truncateText(normalizeString(item?.company || ''), 160) || 'Onbekend',
        contactpersoon: truncateText(normalizeString(item?.name || ''), 160),
        telefoon: truncateText(normalizeString(item?.phone || ''), 80),
        status: truncateText(normalizeString(item?.status || item?.messageType || ''), 80) || 'onbekend',
        duur: truncateText(normalizeString(item?.durationLabel || ''), 40),
        hasRecording,
        samenvatting: truncateText(normalizeString(item?.summary || ''), 220),
        transcriptSnippet: truncateText(normalizeString(item?.transcriptSnippet || ''), 220),
        updatedAt,
        updatedAtMs,
      };
    })
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

  const agenda = generatedAgendaAppointments
    .map((item) => {
      const createdAt = normalizeString(item?.createdAt || '');
      const updatedAt = normalizeString(item?.updatedAt || createdAt);
      const updatedAtMs = Date.parse(updatedAt || createdAt || '') || 0;
      return {
        id: Number(item?.id) || null,
        bedrijf: truncateText(normalizeString(item?.company || item?.leadCompany || ''), 160) || 'Onbekend',
        contactpersoon: truncateText(
          normalizeString(item?.contactName || item?.leadName || item?.name || ''),
          160
        ),
        telefoon: truncateText(normalizeString(item?.phone || item?.leadPhone || ''), 80),
        datum: normalizeDateYyyyMmDd(item?.date || item?.appointmentDate || ''),
        tijd: normalizeTimeHhMm(item?.time || item?.appointmentTime || ''),
        status: truncateText(
          normalizeString(item?.status || item?.postCallStatus || item?.confirmationStatus || ''),
          80
        ) || 'onbekend',
        notitie: truncateText(normalizeString(item?.summary || item?.notes || ''), 500),
        updatedAt,
        updatedAtMs,
      };
    })
    .sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

  const aiInsights = recentAiCallInsights
    .map((item) => ({
      callId: truncateText(normalizeString(item?.callId || ''), 160),
      bedrijf: truncateText(normalizeString(item?.company || ''), 160) || 'Onbekend',
      contactpersoon: truncateText(normalizeString(item?.contactName || ''), 160),
      telefoon: truncateText(normalizeString(item?.phone || ''), 80),
      branche: truncateText(normalizeString(item?.branche || ''), 120),
      afspraakIngepland: toBooleanSafe(item?.appointmentBooked, false),
      afspraakDatum: normalizeDateYyyyMmDd(item?.appointmentDate || ''),
      afspraakTijd: normalizeTimeHhMm(item?.appointmentTime || ''),
      followUpNodig: toBooleanSafe(item?.followUpRequired, false),
      followUpReden: truncateText(normalizeString(item?.followUpReason || ''), 120),
      samenvatting: truncateText(normalizeString(item?.summary || ''), 220),
      analyzedAt: normalizeString(item?.analyzedAt || ''),
    }))
    .sort((a, b) => {
      const aTs = Date.parse(a.analyzedAt || '') || 0;
      const bTs = Date.parse(b.analyzedAt || '') || 0;
      return bTs - aTs;
    });

  const activities = recentDashboardActivities
    .map((item) => ({
      tijd: normalizeString(item?.createdAt || ''),
      titel: truncateText(normalizeString(item?.title || ''), 200),
      detail: truncateText(normalizeString(item?.detail || ''), 180),
      bedrijf: truncateText(normalizeString(item?.company || ''), 160),
      bron: truncateText(normalizeString(item?.source || ''), 80),
      actor: truncateText(normalizeString(item?.actor || ''), 120),
    }))
    .sort((a, b) => {
      const aTs = Date.parse(a.tijd || '') || 0;
      const bTs = Date.parse(b.tijd || '') || 0;
      return bTs - aTs;
    });

  const orderTotalValueEur = orders.reduce((sum, item) => sum + (Number(item?.bedragEur) || 0), 0);
  const orderPaidCount = orders.reduce((sum, item) => sum + (item?.betaaldOp ? 1 : 0), 0);
  const customerPaidCount = customers.reduce(
    (sum, item) => sum + (normalizeString(item?.status) === 'Betaald' ? 1 : 0),
    0
  );
  const customerOpenCount = customers.length - customerPaidCount;
  const customerWebsiteRevenueEur = customers.reduce(
    (sum, item) => sum + (Number.isFinite(Number(item?.websiteBedrag)) ? Number(item.websiteBedrag) : 0),
    0
  );
  const customerMaintenanceMonthlyEur = customers.reduce(
    (sum, item) =>
      sum + (Number.isFinite(Number(item?.onderhoudPerMaand)) ? Number(item.onderhoudPerMaand) : 0),
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    workspace: 'softora-premium-personeel-dashboard',
    overview: {
      totaalOpdrachten: orders.length,
      totaalKlanten: customers.length,
      totaalCalls: callUpdates.length,
      totaalAgendaItems: agenda.length,
      totaalAiInsights: aiInsights.length,
      totaalActiviteiten: activities.length,
    },
    orders: {
      total: orders.length,
      paidCount: orderPaidCount,
      statusCounts: buildDashboardChatStatusCounts(orders, 'status'),
      totalValueEur: orderTotalValueEur,
      items: orders.slice(0, 60),
    },
    customers: {
      total: customers.length,
      paidCount: customerPaidCount,
      openCount: customerOpenCount,
      websiteRevenueEur: customerWebsiteRevenueEur,
      monthlyMaintenanceEur: customerMaintenanceMonthlyEur,
      statusCounts: buildDashboardChatStatusCounts(customers, 'status'),
      items: customers.slice(0, 80),
    },
    calls: {
      total: callUpdates.length,
      statusCounts: buildDashboardChatStatusCounts(callUpdates, 'status'),
      withRecordingCount: callUpdates.reduce((sum, item) => sum + (item?.hasRecording ? 1 : 0), 0),
      items: callUpdates.slice(0, 60),
    },
    agenda: {
      total: agenda.length,
      statusCounts: buildDashboardChatStatusCounts(agenda, 'status'),
      items: agenda.slice(0, 60),
    },
    aiCallInsights: {
      total: aiInsights.length,
      appointmentsBooked: aiInsights.reduce(
        (sum, item) => sum + (toBooleanSafe(item?.afspraakIngepland, false) ? 1 : 0),
        0
      ),
      followUpsRequired: aiInsights.reduce(
        (sum, item) => sum + (toBooleanSafe(item?.followUpNodig, false) ? 1 : 0),
        0
      ),
      items: aiInsights.slice(0, 60),
    },
    recentActivities: activities.slice(0, 60),
  };
}

async function generatePremiumDashboardChatReplyWithAi(options = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY ontbreekt');
    err.status = 503;
    throw err;
  }

  const question = truncateText(normalizeString(options.question || ''), 4000);
  if (!question) {
    const err = new Error('Vraag ontbreekt');
    err.status = 400;
    throw err;
  }

  const history = normalizeDashboardChatHistory(options.history);
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const trimmedContext = trimDashboardChatContextForModel(context, 52000);
  const contextJson = JSON.stringify(trimmedContext);

  const systemPrompt = [
    'Je bent de interne Softora AI-assistent voor het personeel-dashboard.',
    'Je antwoordt altijd in duidelijk Nederlands.',
    'Gebruik uitsluitend de aangeleverde dashboard-context.',
    'Als data ontbreekt of niet zeker is, zeg dat expliciet en verzin niets.',
    'Als de gebruiker vraagt om "alles", geef een compact overzicht per domein: omzet/opdrachten, klanten, calls, agenda en recente activiteiten.',
    'Geef concrete aantallen en namen als die in de context staan.',
    'Noem geen technische interne details (zoals API keys of serverconfiguratie).',
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: `DASHBOARD_CONTEXT_JSON:\n${contextJson}` },
    ...history,
    { role: 'user', content: question },
  ];

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
        temperature: 0.15,
        messages,
      }),
    },
    65000
  );

  if (!response.ok) {
    const err = new Error(`OpenAI dashboard-chat mislukt (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  const answer = truncateText(normalizeString(extractOpenAiTextContent(content)), 12000);
  if (!answer) {
    const err = new Error('AI gaf geen antwoord terug.');
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    answer,
    model: OPENAI_MODEL,
    usage: data?.usage || null,
  };
}

async function sendPremiumDashboardChatResponse(req, res) {
  try {
    if (isSupabaseConfigured() && !supabaseStateHydrated) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const question = normalizeString(body.question || body.message || body.prompt || '');
    if (!question) {
      return res.status(400).json({
        ok: false,
        error: 'Vraag ontbreekt',
        detail: 'Stuur JSON met { question: "..." }',
      });
    }
    if (question.length > 4000) {
      return res.status(400).json({
        ok: false,
        error: 'Vraag te lang',
        detail: 'Gebruik maximaal 4000 tekens.',
      });
    }

    const context = await buildPremiumDashboardChatContext();
    const result = await generatePremiumDashboardChatReplyWithAi({
      question,
      history: body.history,
      context,
    });

    return res.status(200).json({
      ok: true,
      answer: result.answer,
      model: result.model,
      usage: result.usage,
      contextMeta: {
        generatedAt: context.generatedAt || null,
        totals: context.overview || {},
      },
      openAiEnabled: true,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    return res.status(safeStatus).json({
      ok: false,
      error:
        safeStatus === 503
          ? 'AI dashboard assistent niet beschikbaar'
          : 'AI dashboard assistent mislukt',
      detail: String(error?.message || 'Onbekende fout'),
      openAiEnabled: Boolean(getOpenAiApiKey()),
    });
  }
}

app.post('/api/ai/dashboard-chat', async (req, res) => {
  return sendPremiumDashboardChatResponse(req, res);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/ai-dashboard-chat', async (req, res) => {
  return sendPremiumDashboardChatResponse(req, res);
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

async function sendAiNotesImageToTextResponse(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const imageDataUrl = normalizeString(body.imageDataUrl || body.image || '').replace(/\s+/g, '');
  const language = normalizeString(body.language || 'nl') || 'nl';
  const context = normalizeString(body.context || '');

  if (!imageDataUrl) {
    return res.status(400).json({
      ok: false,
      error: 'Afbeelding ontbreekt',
      detail: 'Stuur een JSON body met { imageDataUrl: "data:image/...;base64,..." }',
    });
  }

  if (imageDataUrl.length > 900000) {
    return res.status(413).json({
      ok: false,
      error: 'Afbeelding te groot',
      detail: 'Lever een compactere afbeelding aan (max ~700KB geadviseerd).',
    });
  }

  try {
    const extraction = await extractMeetingNotesFromImageWithAi({
      imageDataUrl,
      language,
    });

    let promptResult = null;
    try {
      promptResult = await generateWebsitePromptFromTranscriptWithAi({
        transcript: extraction.transcript,
        language,
        context,
      });
    } catch (promptError) {
      promptResult = {
        prompt: buildWebsitePromptFallback({
          transcript: extraction.transcript,
          language,
          context,
        }),
        source: 'template-fallback',
        model: null,
        usage: null,
      };
    }

    return res.status(200).json({
      ok: true,
      transcript: extraction.transcript,
      prompt: String(promptResult?.prompt || '').trim(),
      source: extraction.source,
      model: extraction.model,
      promptSource: String(promptResult?.source || ''),
      usage: {
        extraction: extraction.usage || null,
        prompt: promptResult?.usage || null,
      },
      language,
      openAiEnabled: true,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    return res.status(safeStatus).json({
      ok: false,
      error:
        safeStatus === 503
          ? 'AI notitie-herkenning niet beschikbaar'
          : 'AI notitie-herkenning mislukt',
      detail: String(error?.message || 'Onbekende fout'),
      openAiEnabled: Boolean(getOpenAiApiKey()),
    });
  }
}

app.post('/api/ai/notes-image-to-text', async (req, res) => {
  return sendAiNotesImageToTextResponse(req, res);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/ai-notes-image-to-text', async (req, res) => {
  return sendAiNotesImageToTextResponse(req, res);
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
    const referenceImages = sanitizeReferenceImages(body.referenceImages || body.attachments || [], {
      maxItems: 6,
      maxBytesPerImage: 550 * 1024,
      maxTotalBytes: 3 * 1024 * 1024,
    });

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
      referenceImages,
    });

    appendDashboardActivity(
      {
        type: 'active_order_generated',
        title: 'AI website gegenereerd',
        detail: `HTML-opzet gegenereerd${company ? ` voor ${company}` : ''}${referenceImages.length ? ` met ${referenceImages.length} referentiebeeld(en)` : ''}.`,
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
        referenceImageCount: referenceImages.length,
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

async function sendActiveOrderLaunchSiteResponse(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const html = String(body.html || '');
    const orderId = Number(body.orderId) || null;
    const company = truncateText(normalizeString(body.company || body.clientName || ''), 160);
    const title = truncateText(normalizeString(body.title || ''), 200);
    const description = truncateText(normalizeString(body.description || ''), 3000);
    const deliveryTime = truncateText(normalizeString(body.deliveryTime || ''), 200);
    const domainName = sanitizeLaunchDomainName(body.domainName || body.domain || '');

    if (!html.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'HTML ontbreekt',
        detail: 'Stuur een body met minimaal { html: "..." }.'
      });
    }

    const launchResult = await runActiveOrderLaunchPipeline({
      orderId,
      company,
      title,
      description,
      deliveryTime,
      domainName,
      html
    });

    appendDashboardActivity(
      {
        type: 'active_order_automation_completed',
        title: 'Case automatisch gelanceerd',
        detail: `${company || 'Case'} is doorgezet naar lokaal, GitHub en Vercel.`,
        company,
        actor: 'api',
        taskId: Number.isFinite(orderId) ? orderId : null,
        source: 'premium-actieve-opdrachten'
      },
      'dashboard_activity_active_order_launch'
    );

    return res.status(200).json(launchResult);
  } catch (error) {
    const detail = String(error?.message || 'Onbekende launch fout');
    const status = /ontbreekt|missing|niet compleet|staat uit|verwacht/i.test(detail) ? 400 : 500;
    return res.status(status).json({
      ok: false,
      error: 'Launch pipeline mislukt',
      detail
    });
  }
}

app.post('/api/active-orders/launch-site', async (req, res) => {
  return sendActiveOrderLaunchSiteResponse(req, res);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/active-order-launch-site', async (req, res) => {
  return sendActiveOrderLaunchSiteResponse(req, res);
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

app.get('/api/seo/pages', async (req, res) => {
  const files = getSeoEditableHtmlFiles();
  const query = normalizeString(req.query.q || '').toLowerCase();

  try {
    const config = await getSeoConfigCached();
    const pages = [];

    for (const fileName of files) {
      const html = await readHtmlPageContent(fileName);
      if (!html) continue;
      const source = extractSeoSourceFromHtml(html);
      const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
      const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
      const effective = mergeSeoSourceWithOverrides(source, pageOverrides);
      const images = extractImageEntriesFromHtml(html);
      const slug = String(fileName).replace(/\.html$/i, '');
      const pathName = slug === 'index' ? '/' : `/${slug}`;
      const searchIndex = `${fileName} ${pathName} ${effective.title || ''}`.toLowerCase();

      if (query && !searchIndex.includes(query)) continue;

      pages.push({
        file: fileName,
        slug,
        path: pathName,
        title: effective.title || source.title || slug,
        metaDescription: effective.metaDescription || source.metaDescription || '',
        imageCount: images.length,
        pageOverrideCount: Object.keys(pageOverrides).length,
        imageOverrideCount: Object.keys(imageOverrides).length,
      });
    }

    return res.status(200).json({
      ok: true,
      count: pages.length,
      pages,
    });
  } catch (error) {
    console.error('[SEO][PagesError]', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Kon SEO pagina-overzicht niet ophalen.',
    });
  }
});

app.get('/api/seo/page', async (req, res) => {
  const fileName = resolveSeoPageFileFromRequest(req.query.file, req.query.slug);
  if (!fileName) {
    return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
  }

  const html = await readHtmlPageContent(fileName);
  if (!html) {
    return res.status(404).json({ ok: false, error: 'Pagina niet gevonden of onleesbaar.' });
  }

  try {
    const config = await getSeoConfigCached();
    const source = extractSeoSourceFromHtml(html);
    const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
    const effective = mergeSeoSourceWithOverrides(source, pageOverrides);
    const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
    const images = extractImageEntriesFromHtml(html).map((entry) => {
      const overrideAlt = normalizeString(imageOverrides[entry.src] || '');
      return {
        src: entry.src,
        sourceAlt: entry.alt || '',
        overrideAlt,
        effectiveAlt: overrideAlt || entry.alt || '',
      };
    });

    return res.status(200).json({
      ok: true,
      file: fileName,
      slug: String(fileName).replace(/\.html$/i, ''),
      seo: {
        source,
        overrides: pageOverrides,
        effective,
      },
      imageCount: images.length,
      images,
    });
  } catch (error) {
    console.error('[SEO][PageError]', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Kon SEO data voor deze pagina niet ophalen.',
    });
  }
});

app.post('/api/seo/page', async (req, res) => {
  const fileName = resolveSeoPageFileFromRequest(req.body?.file, req.body?.slug);
  if (!fileName) {
    return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
  }

  const pageOverridePatch = normalizeSeoPageOverridePatch(req.body?.pageOverrides || req.body?.page || {});
  const imageOverridePatch = normalizeSeoImageOverridePatch(
    req.body?.imageAltOverrides || req.body?.imageOverrides || req.body?.images || {}
  );

  try {
    const currentConfig = await getSeoConfigCached(true);
    const nextConfig = normalizeSeoConfig(currentConfig);

    const nextPageOverrides = {
      ...(nextConfig.pages[fileName] || {}),
    };
    for (const field of SEO_PAGE_FIELD_DEFS) {
      if (!Object.prototype.hasOwnProperty.call(pageOverridePatch, field.key)) continue;
      const value = normalizeString(pageOverridePatch[field.key]);
      if (!value) {
        delete nextPageOverrides[field.key];
        continue;
      }
      nextPageOverrides[field.key] = value;
    }
    if (Object.keys(nextPageOverrides).length > 0) {
      nextConfig.pages[fileName] = nextPageOverrides;
    } else {
      delete nextConfig.pages[fileName];
    }

    const nextImageOverrides = {
      ...(nextConfig.images[fileName] || {}),
    };
    for (const [src, altRaw] of Object.entries(imageOverridePatch)) {
      const alt = normalizeString(altRaw);
      if (!alt) {
        delete nextImageOverrides[src];
        continue;
      }
      nextImageOverrides[src] = alt;
    }
    if (Object.keys(nextImageOverrides).length > 0) {
      nextConfig.images[fileName] = nextImageOverrides;
    } else {
      delete nextConfig.images[fileName];
    }

    const saved = await persistSeoConfig(nextConfig, {
      source: 'seo-dashboard',
      actor: normalizeString(req.body?.actor || 'dashboard'),
    });
    if (!saved) {
      return res.status(500).json({ ok: false, error: 'Kon SEO wijzigingen niet opslaan.' });
    }

    appendDashboardActivity(
      {
        type: 'seo_page_updated',
        title: 'SEO-instellingen opgeslagen',
        detail: `SEO updates opgeslagen voor ${fileName}.`,
        source: 'premium-seo',
        actor: normalizeString(req.body?.actor || 'dashboard'),
      },
      'dashboard_activity_seo_updated'
    );

    return res.status(200).json({
      ok: true,
      file: fileName,
      saved: {
        pageOverrideCount: Object.keys(saved.pages[fileName] || {}).length,
        imageOverrideCount: Object.keys(saved.images[fileName] || {}).length,
      },
    });
  } catch (error) {
    console.error('[SEO][SaveError]', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'SEO wijzigingen opslaan mislukt.',
    });
  }
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

function parseImageDataUrl(rawValue) {
  const raw = normalizeString(rawValue || '').replace(/\s+/g, '');
  if (!raw) return null;
  const match = raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  const mimeType = String(match[1] || '').toLowerCase();
  const base64Payload = String(match[2] || '');
  if (!base64Payload) return null;

  let sizeBytes = 0;
  try {
    sizeBytes = Buffer.from(base64Payload, 'base64').length;
  } catch {
    return null;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;

  return {
    mimeType,
    base64Payload,
    sizeBytes,
    dataUrl: `data:${mimeType};base64,${base64Payload}`,
  };
}

function sanitizeReferenceImages(input, options = {}) {
  const maxItems = Math.max(0, Math.min(12, Number(options.maxItems || 8) || 8));
  const maxBytesPerImage = Math.max(
    50 * 1024,
    Math.min(2 * 1024 * 1024, Number(options.maxBytesPerImage || 550 * 1024) || 550 * 1024)
  );
  const maxTotalBytes = Math.max(
    maxBytesPerImage,
    Math.min(8 * 1024 * 1024, Number(options.maxTotalBytes || 3 * 1024 * 1024) || 3 * 1024 * 1024)
  );

  const source = Array.isArray(input) ? input : [];
  const out = [];
  let totalBytes = 0;

  for (let i = 0; i < source.length; i += 1) {
    if (out.length >= maxItems) break;
    const item = source[i];
    if (!item || typeof item !== 'object') continue;

    const parsed = parseImageDataUrl(item.dataUrl || item.imageDataUrl || item.url || '');
    if (!parsed) continue;
    if (parsed.sizeBytes > maxBytesPerImage) continue;
    if (totalBytes + parsed.sizeBytes > maxTotalBytes) continue;

    const name = truncateText(normalizeString(item.name || item.fileName || `bijlage-${i + 1}`), 140) || `bijlage-${i + 1}`;
    const id =
      truncateText(normalizeString(item.id || ''), 80) ||
      `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    out.push({
      id,
      name,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      dataUrl: parsed.dataUrl,
    });
    totalBytes += parsed.sizeBytes;
  }

  return out;
}

function slugifyAutomationText(value, fallback = 'project') {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function sanitizeLaunchDomainName(value) {
  const raw = normalizeString(value || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
  if (!raw) return '';
  if (!raw.includes('.')) return '';
  if (!/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(raw)) return '';
  if (raw.includes('..')) return '';
  return raw;
}

async function ensureDirectoryExists(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function makeUniqueProjectDirectory(baseDir, preferredName) {
  await ensureDirectoryExists(baseDir);
  const base = slugifyAutomationText(preferredName || 'project', 'project');
  for (let i = 0; i < 9999; i += 1) {
    const suffix = i === 0 ? '' : `-${i + 1}`;
    const candidate = path.join(baseDir, `${base}${suffix}`);
    try {
      await fs.promises.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (String(error?.code || '') === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Kon geen unieke projectmap aanmaken.');
}

async function runCommandWithOutput(command, args = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = Math.max(1_000, Math.min(900_000, Number(options.timeoutMs || 300_000)));
  const env = {
    ...process.env,
    ...(options.env && typeof options.env === 'object' ? options.env : {})
  };

  return await new Promise((resolve, reject) => {
    const child = spawn(command, Array.isArray(args) ? args : [], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {
        // ignore kill errors
      }
      const error = new Error(`Command timeout na ${Math.round(timeoutMs / 1000)}s: ${command}`);
      error.code = 'COMMAND_TIMEOUT';
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    child.on('error', (error) => {
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    });
    child.on('close', (code, signal) => {
      const exitCode = Number(code);
      if (Number.isFinite(exitCode) && exitCode === 0) {
        finish(null, {
          code: exitCode,
          signal: signal || null,
          stdout,
          stderr
        });
        return;
      }
      const error = new Error(`Command faalde (${command}) met code ${Number.isFinite(exitCode) ? exitCode : 'onbekend'}`);
      error.code = 'COMMAND_FAILED';
      error.exitCode = Number.isFinite(exitCode) ? exitCode : null;
      error.signal = signal || null;
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    });
  });
}

function parseFirstVercelUrl(text) {
  const match = String(text || '').match(/https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app/gi);
  if (!match || !match.length) return '';
  return String(match[match.length - 1] || '').trim();
}

async function fetchGitHubApi(pathname, options = {}) {
  const token = String(options.token || ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN || '').trim();
  if (!token) {
    throw new Error('ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN ontbreekt.');
  }

  const method = String(options.method || 'GET').toUpperCase();
  const endpoint = `https://api.github.com${pathname}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'softora-automation'
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(endpoint, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  return {
    ok: response.ok,
    status: Number(response.status) || 0,
    data,
    text
  };
}

async function ensureGitHubRepository(owner, repoName) {
  const lookup = await fetchGitHubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`);
  if (lookup.ok) {
    const htmlUrl = normalizeString(lookup?.data?.html_url || '');
    return {
      owner,
      repo: repoName,
      htmlUrl: htmlUrl || `https://github.com/${owner}/${repoName}`,
      created: false
    };
  }
  if (lookup.status !== 404) {
    throw new Error(`GitHub repository check mislukt (${lookup.status}).`);
  }

  const payload = {
    name: repoName,
    private: ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE,
    auto_init: false,
    description: 'Automatisch gegenereerde Softora website case'
  };
  const createPath = ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG
    ? `/orgs/${encodeURIComponent(owner)}/repos`
    : '/user/repos';
  const createRes = await fetchGitHubApi(createPath, {
    method: 'POST',
    body: payload
  });
  if (!createRes.ok) {
    const detail = normalizeString(createRes?.data?.message || createRes?.text || '');
    throw new Error(`GitHub repository aanmaken mislukt (${createRes.status})${detail ? `: ${detail}` : ''}`);
  }
  const htmlUrl = normalizeString(createRes?.data?.html_url || '');
  return {
    owner,
    repo: repoName,
    htmlUrl: htmlUrl || `https://github.com/${owner}/${repoName}`,
    created: true
  };
}

async function upsertGitHubFile(owner, repo, filePath, content, message) {
  const encodedPath = String(filePath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  let sha = null;
  const current = await fetchGitHubApi(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH)}`
  );
  if (current.ok && current?.data?.sha) {
    sha = String(current.data.sha);
  } else if (!current.ok && current.status !== 404) {
    throw new Error(`GitHub bestand lezen mislukt (${filePath})`);
  }

  const body = {
    message: String(message || `Update ${filePath}`),
    content: Buffer.from(String(content || ''), 'utf8').toString('base64'),
    branch: ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH
  };
  if (sha) body.sha = sha;

  const save = await fetchGitHubApi(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      method: 'PUT',
      body
    }
  );
  if (!save.ok) {
    const detail = normalizeString(save?.data?.message || save?.text || '');
    throw new Error(`GitHub bestand opslaan mislukt (${filePath})${detail ? `: ${detail}` : ''}`);
  }
  return save?.data?.content || null;
}

async function runStratoAutomationHook({ domainName, projectDir, deploymentUrl }) {
  const domain = sanitizeLaunchDomainName(domainName);
  if (!domain) {
    return {
      status: 'skipped',
      message: 'Geen domein opgegeven; Strato stap overgeslagen.'
    };
  }

  if (ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND) {
    const escapedDomain = domain.replace(/'/g, `'\\''`);
    const escapedProjectDir = String(projectDir || '').replace(/'/g, `'\\''`);
    const escapedDeploymentUrl = String(deploymentUrl || '').replace(/'/g, `'\\''`);
    const command = ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND
      .replace(/\{\{domain\}\}/g, escapedDomain)
      .replace(/\{\{projectDir\}\}/g, escapedProjectDir)
      .replace(/\{\{deploymentUrl\}\}/g, escapedDeploymentUrl);
    const result = await runCommandWithOutput('bash', ['-lc', command], {
      cwd: projectDir || process.cwd(),
      timeoutMs: 300000
    });
    const info = parseFirstVercelUrl(result.stdout || '') || normalizeString(result.stdout || result.stderr || '');
    return {
      status: 'ok',
      message: info ? truncateText(info, 220) : 'Strato command uitgevoerd.'
    };
  }

  if (ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL) {
    const response = await fetch(ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify({
        domain: domain,
        deploymentUrl: String(deploymentUrl || ''),
        projectDir: String(projectDir || '')
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Strato webhook faalde (${response.status})${text ? `: ${truncateText(text, 180)}` : ''}`);
    }
    return {
      status: 'ok',
      message: 'Strato webhook uitgevoerd.'
    };
  }

  throw new Error('Strato automatisering niet geconfigureerd (set ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND of _WEBHOOK_URL).');
}

async function runActiveOrderLaunchPipeline(input = {}) {
  if (!ACTIVE_ORDER_AUTOMATION_ENABLED) {
    return {
      ok: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outputs: {
        domainStatus: 'skipped',
        domainMessage: 'Automation disabled'
      },
      steps: [
        {
          id: 'automation_toggle',
          label: 'Automation',
          status: 'skipped',
          message: 'ACTIVE_ORDER_AUTOMATION_ENABLED staat uit.'
        }
      ]
    };
  }

  const orderId = Number(input.orderId) || null;
  const company = truncateText(normalizeString(input.company || input.clientName || ''), 160) || 'Softora Case';
  const title = truncateText(normalizeString(input.title || ''), 200) || 'Website';
  const description = truncateText(normalizeString(input.description || ''), 2000);
  const deliveryTime = truncateText(normalizeString(input.deliveryTime || ''), 200);
  const html = String(input.html || '');
  const domainName = sanitizeLaunchDomainName(input.domainName || input.domain || '');

  if (!html.trim()) {
    throw new Error('Launch pipeline verwacht HTML in body.html.');
  }

  if (!ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN || !ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER) {
    throw new Error('GitHub automation niet compleet: set ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN en ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER.');
  }
  if (!ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN) {
    throw new Error('Vercel automation niet compleet: set ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN.');
  }

  const steps = [];
  const outputs = {};
  const startedAt = new Date().toISOString();

  const projectBase = domainName
    ? slugifyAutomationText(domainName.replace(/\.[^.]+$/, ''), 'project')
    : slugifyAutomationText(`${company}-${title}`, 'project');
  const projectFolderLabel = orderId ? `${projectBase}-${orderId}` : `${projectBase}-${Date.now()}`;
  const projectDir = await makeUniqueProjectDirectory(
    ACTIVE_ORDER_AUTOMATION_OUTPUT_ROOT,
    projectFolderLabel
  );
  outputs.localDir = projectDir;

  const meta = {
    orderId,
    company,
    title,
    description,
    deliveryTime,
    domainName: domainName || null,
    generatedAt: startedAt
  };
  await fs.promises.writeFile(path.join(projectDir, 'index.html'), html, 'utf8');
  await fs.promises.writeFile(path.join(projectDir, 'softora-case.json'), JSON.stringify(meta, null, 2), 'utf8');
  await fs.promises.writeFile(
    path.join(projectDir, 'README.md'),
    [
      `# ${title}`,
      '',
      `- Bedrijf: ${company}`,
      `- Order: ${orderId || 'n/a'}`,
      domainName ? `- Domein: ${domainName}` : '- Domein: niet opgegeven',
      `- Gegenereerd: ${startedAt}`,
      '',
      'Deze map is automatisch aangemaakt door Softora Active Order Automation.'
    ].join('\n'),
    'utf8'
  );
  steps.push({
    id: 'local_files',
    label: 'Lokale projectmap',
    status: 'ok',
    message: `Bestanden opgeslagen in ${projectDir}`
  });

  const repoName = `${ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX}${projectBase}${orderId ? `-${orderId}` : ''}`.slice(0, 95);
  const repoInfo = await ensureGitHubRepository(ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER, repoName);
  await upsertGitHubFile(
    repoInfo.owner,
    repoInfo.repo,
    'index.html',
    html,
    `Publish case ${orderId || ''}`.trim()
  );
  await upsertGitHubFile(
    repoInfo.owner,
    repoInfo.repo,
    'softora-case.json',
    JSON.stringify(meta, null, 2),
    `Update case metadata ${orderId || ''}`.trim()
  );
  await upsertGitHubFile(
    repoInfo.owner,
    repoInfo.repo,
    'README.md',
    [
      `# ${title}`,
      '',
      `Automatisch gepubliceerd vanuit Softora Active Opdrachten.`,
      '',
      `- Bedrijf: ${company}`,
      `- Order ID: ${orderId || 'n/a'}`,
      domainName ? `- Domein: ${domainName}` : '- Domein: niet opgegeven',
      `- Laatste update: ${new Date().toISOString()}`
    ].join('\n'),
    `Update README ${orderId || ''}`.trim()
  );
  outputs.githubRepoUrl = repoInfo.htmlUrl;
  steps.push({
    id: 'github',
    label: 'GitHub push',
    status: 'ok',
    message: repoInfo.created
      ? `Repo aangemaakt + bestanden gepusht (${repoInfo.htmlUrl})`
      : `Bestanden gepusht (${repoInfo.htmlUrl})`
  });

  const vercelArgs = [
    '--yes',
    'vercel',
    'deploy',
    projectDir,
    '--prod',
    '--yes',
    '--token',
    ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN
  ];
  if (ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE) {
    vercelArgs.push('--scope', ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE);
  }
  const vercelResult = await runCommandWithOutput('npx', vercelArgs, {
    cwd: projectDir,
    timeoutMs: 600000,
    env: {
      HOME: process.env.HOME || os.homedir()
    }
  });
  const deploymentUrl = parseFirstVercelUrl(`${vercelResult.stdout}\n${vercelResult.stderr}`);
  if (!deploymentUrl) {
    throw new Error('Vercel deploy uitgevoerd, maar deployment URL niet gevonden in output.');
  }
  outputs.deploymentUrl = deploymentUrl;
  steps.push({
    id: 'vercel',
    label: 'Vercel deploy',
    status: 'ok',
    message: deploymentUrl
  });

  if (domainName) {
    const stratoResult = await runStratoAutomationHook({
      domainName,
      projectDir,
      deploymentUrl
    });
    outputs.domainStatus = stratoResult.status;
    outputs.domainMessage = stratoResult.message || '';
    steps.push({
      id: 'strato',
      label: 'Strato domein',
      status: stratoResult.status === 'ok' ? 'ok' : 'skipped',
      message: stratoResult.message || (stratoResult.status === 'ok' ? 'Domeinstap gereed.' : 'Overgeslagen.')
    });

    try {
      const aliasArgs = [
        '--yes',
        'vercel',
        'alias',
        'set',
        deploymentUrl,
        domainName,
        '--token',
        ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN
      ];
      if (ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE) {
        aliasArgs.push('--scope', ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE);
      }
      await runCommandWithOutput('npx', aliasArgs, {
        cwd: projectDir,
        timeoutMs: 180000,
        env: {
          HOME: process.env.HOME || os.homedir()
        }
      });
      outputs.domainStatus = 'ok';
      outputs.domainMessage = `Domein alias gezet op ${domainName}`;
      steps.push({
        id: 'vercel_domain_alias',
        label: 'Vercel domein alias',
        status: 'ok',
        message: domainName
      });
    } catch (error) {
      const message = truncateText(normalizeString(error?.stderr || error?.message || ''), 220) || 'Alias mislukt.';
      outputs.domainStatus = outputs.domainStatus || 'pending';
      outputs.domainMessage = outputs.domainMessage || message;
      steps.push({
        id: 'vercel_domain_alias',
        label: 'Vercel domein alias',
        status: 'skipped',
        message
      });
    }
  } else {
    outputs.domainStatus = 'skipped';
    outputs.domainMessage = 'Geen domein opgegeven.';
    steps.push({
      id: 'strato',
      label: 'Strato domein',
      status: 'skipped',
      message: 'Geen domein opgegeven; stap overgeslagen.'
    });
  }

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    outputs,
    steps
  };
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
    postCallDomainName: sanitizeLaunchDomainName(
      body.domainName || body.domain || body.postCallDomainName || ''
    ),
    referenceImages: sanitizeReferenceImages(body.referenceImages || body.attachments || []),
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
      postCallDomainName:
        payload.postCallDomainName ||
        sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
      referenceImages:
        (Array.isArray(payload.referenceImages) && payload.referenceImages.length
          ? sanitizeReferenceImages(payload.referenceImages)
          : sanitizeReferenceImages(appointment?.referenceImages || [])),
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
          domainName: sanitizeLaunchDomainName(item.domainName || item.domain || ''),
          status: normalizeActiveOrderStatusKey(item.status),
          sourceAppointmentId: Number(item.sourceAppointmentId) || null,
          sourceCallId: normalizeString(item.sourceCallId || '') || null,
          referenceImages: sanitizeReferenceImages(item.referenceImages || item.attachments || []),
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
  const domainName = sanitizeLaunchDomainName(
    input.domainName || input.domain || appointment?.postCallDomainName || appointment?.domainName || ''
  );
  const referenceImages = sanitizeReferenceImages(
    input.referenceImages || input.attachments || appointment?.referenceImages || []
  );

  return {
    id: Number(nextId) || 1,
    clientName: company,
    location: truncateText(normalizeString(input.location || ''), 160),
    title,
    description,
    amount,
    domainName,
    status: normalizeActiveOrderStatusKey(input.status || 'wacht'),
    source: 'agenda_post_call_prompt',
    sourceAppointmentId: Number(appointment?.id) || null,
    sourceCallId: normalizeString(appointment?.callId || '') || null,
    contact,
    referenceImages,
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
  const domainName = sanitizeLaunchDomainName(
    req.body?.domainName || req.body?.domain || appointment?.postCallDomainName || appointment?.domainName || ''
  );
  const referenceImages = sanitizeReferenceImages(
    req.body?.referenceImages || req.body?.attachments || appointment?.referenceImages || []
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
      domainName: domainName || sanitizeLaunchDomainName(existingOrder?.domainName || existingOrder?.domain || ''),
      referenceImages:
        referenceImages.length > 0
          ? referenceImages
          : sanitizeReferenceImages(existingOrder?.referenceImages || []),
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
      postCallDomainName: domainName || sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
      referenceImages:
        referenceImages.length > 0
          ? referenceImages
          : sanitizeReferenceImages(appointment?.referenceImages || []),
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
      postCallDomainName: domainName || sanitizeLaunchDomainName(appointment?.postCallDomainName || appointment?.domainName || ''),
      referenceImages:
        referenceImages.length > 0
          ? referenceImages
          : sanitizeReferenceImages(appointment?.referenceImages || []),
      postCallUpdatedAt: nowIso,
      postCallUpdatedBy: actor || null,
      activeOrderId: Number(existingOrder?.id) || null,
      activeOrderAddedAt: nowIso,
      activeOrderAddedBy: actor || null,
      activeOrderReferenceImageCount: referenceImages.length,
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
  const includeDemo = /^(1|true|yes)$/i.test(String(req.query.includeDemo || ''));
  const quickMode = /^(1|true|yes)$/i.test(String(req.query.quick || req.query.fast || ''));
  const countOnly = /^(1|true|yes)$/i.test(String(req.query.countOnly || req.query.count_only || ''));

  if (isSupabaseConfigured() && !supabaseStateHydrated) {
    await forceHydrateRuntimeStateWithRetries(3);
  }
  if (!quickMode && isImapMailConfigured()) {
    await syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
  }
  backfillInsightsAndAppointmentsFromRecentCallUpdates();
  if (!quickMode) {
    generatedAgendaAppointments.forEach((appointment, idx) => {
      if (!appointment) return;
      if (!mapAppointmentToConfirmationTask(appointment)) return;
      ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_list_auto_draft' });
    });
  }

  const tasks = generatedAgendaAppointments
    .filter((appointment) => {
      if (includeDemo) return true;
      if (DEMO_CONFIRMATION_TASK_ENABLED) return true;
      const callId = normalizeString(appointment?.callId || '');
      return !callId.startsWith('demo-');
    })
    .map(mapAppointmentToConfirmationTask)
    .filter(Boolean);

  if (countOnly) {
    const dedupe = new Set();
    tasks.forEach((task) => {
      const key = [
        normalizeString(task?.company || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim(),
        normalizeString(task?.contact || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim(),
        normalizeString(task?.phone || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim(),
        normalizeString(task?.date || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim(),
        normalizeString(task?.time || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim(),
      ].join('|');
      dedupe.add(key);
    });
    return res.status(200).json({
      ok: true,
      count: dedupe.size,
    });
  }

  const limit = Math.max(1, Math.min(1000, parseIntSafe(req.query.limit, 100)));
  tasks.sort(compareConfirmationTasks);

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
    await refreshCallUpdateFromRetellStatusApi(appointment.callId);
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

function setLeadTaskInAgendaById(req, res, taskIdRaw) {
  const idx = getGeneratedAppointmentIndexById(taskIdRaw);
  if (idx < 0) {
    return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
  }

  const appointment = generatedAgendaAppointments[idx];
  const task = mapAppointmentToConfirmationTask(appointment);
  if (!task) {
    return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
  }

  const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
  const appointmentDate = normalizeDateYyyyMmDd(
    req.body?.appointmentDate || req.body?.date || appointment?.date || ''
  );
  const appointmentTime = normalizeTimeHhMm(
    req.body?.appointmentTime || req.body?.time || appointment?.time || ''
  );
  const location = sanitizeAppointmentLocation(
    req.body?.location || req.body?.appointmentLocation || appointment?.location || ''
  );
  const whatsappInfo = sanitizeAppointmentWhatsappInfo(
    req.body?.whatsappInfo ||
      req.body?.whatsappNotes ||
      req.body?.notes ||
      appointment?.whatsappInfo ||
      ''
  );

  if (!appointmentDate) {
    return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
  }
  if (!appointmentTime) {
    return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
  }

  const nowIso = new Date().toISOString();
  const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
    idx,
    {
      ...appointment,
      date: appointmentDate,
      time: appointmentTime,
      location: location || null,
      whatsappInfo: whatsappInfo || null,
      summary: buildLeadToAgendaSummary(appointment?.summary, location, whatsappInfo),
      needsConfirmationEmail: false,
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
    'confirmation_task_set_in_agenda'
  );

  appendDashboardActivity(
    {
      type: 'lead_set_in_agenda',
      title: 'Lead in agenda gezet',
      detail: `Lead handmatig ingepland op ${appointmentDate} om ${appointmentTime}${
        location ? ` (${location})` : ''
      }.`,
      company: updatedAppointment?.company || appointment?.company || '',
      actor,
      taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
      callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      source: 'premium-ai-lead-generator',
    },
    'dashboard_activity_lead_set_in_agenda'
  );

  return res.status(200).json({
    ok: true,
    taskCompleted: true,
    appointment: updatedAppointment,
  });
}

app.post('/api/agenda/confirmation-tasks/:id/set-in-agenda', (req, res) => {
  return setLeadTaskInAgendaById(req, res, req.params.id);
});

// Vercel fallback voor diepe API-paths in sommige regio's.
app.post('/api/agenda/lead-to-agenda', (req, res) => {
  return setLeadTaskInAgendaById(req, res, req.query.taskId);
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
    service: 'softora-retell-coldcalling-backend',
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
    service: 'softora-retell-coldcalling-backend',
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

app.get('/', async (req, res, next) => {
  return sendSeoManagedHtmlPageResponse(req, res, next, 'premium-website.html');
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

app.get('/:slug', async (req, res, next) => {
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

  return sendSeoManagedHtmlPageResponse(req, res, next, fileName);
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
